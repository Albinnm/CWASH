import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import Stripe from 'stripe';
import { createStore } from '../server/store.js';
import { createApp } from '../server/app.js';
import { billingSettings } from '../server/billing.js';

const secret='whsec_test_fixture_only';
const config={STRIPE_SECRET_KEY:'sk_test_fixture_only',STRIPE_WEBHOOK_SECRET:secret,STRIPE_MEMBERSHIP_PRICE_ID:'price_monthly',CWASH_PUBLIC_ORIGIN:'https://cwash.example.test'};
const password='Billing-test-password-42!';
function fakeStripe(){
  const sessions=new Map(),intents=new Map(),subscriptionRecords=new Map(),invoices=new Map(),invoicePayments=new Map(),idempotency=new Map();
  const calls={customers:0,checkouts:0,expires:0,retrieves:0,portal:[]};
  const api={calls,sessions,intents,subscriptionRecords,invoicesRecords:invoices,invoicePaymentRecords:invoicePayments,
    webhooks:new Stripe(config.STRIPE_SECRET_KEY).webhooks,
    customers:{create:async(data)=>({id:`cus_${++calls.customers}`,livemode:false,...data})},
    prices:{retrieve:async()=>({id:'price_monthly',livemode:false,active:true,type:'recurring',currency:'usd',unit_amount:15900,recurring:{interval:'month',interval_count:1,usage_type:'licensed'},billing_scheme:'per_unit',product:{id:'prod_member',active:true,name:'Monthly care',description:'Test plan'}})},
    checkout:{sessions:{
      create:async(data,options)=>{
        if(idempotency.has(options.idempotencyKey))return sessions.get(idempotency.get(options.idempotencyKey));
        const sid=`cs_test_${++calls.checkouts}`;
        const session={id:sid,livemode:false,status:'open',payment_status:'unpaid',url:`https://checkout.stripe.com/c/pay/${sid}`,customer:data.customer,mode:data.mode,metadata:data.metadata,amount_total:data.line_items[0].price_data?.unit_amount??15900,currency:'usd',request:data};
        sessions.set(sid,session);idempotency.set(options.idempotencyKey,sid);return session;
      },
      retrieve:async sid=>{calls.retrieves++;if(!sessions.has(sid))throw new Error('Unknown session');return sessions.get(sid);},
      expire:async sid=>{calls.expires++;const session=sessions.get(sid);if(session.status!=='open')throw new Error('Not open');session.status='expired';return session;},
    }},
    paymentIntents:{retrieve:async pid=>{if(!intents.has(pid))throw new Error('Unknown intent');return intents.get(pid);}},
    subscriptions:{list:async({customer})=>({data:[...subscriptionRecords.values()].filter(s=>s.customer===customer),has_more:false}),retrieve:async sid=>{if(!subscriptionRecords.has(sid))throw new Error('Unknown subscription');return subscriptionRecords.get(sid);}},
    invoices:{retrieve:async invoiceId=>invoices.get(invoiceId)},
    invoicePayments:{list:async query=>({has_more:false,data:[...invoicePayments.values()].filter(p=>query.invoice?p.invoice===query.invoice:p.payment.payment_intent===query.payment.payment_intent)})},
    billingPortal:{sessions:{create:async data=>{calls.portal.push(data);return{url:'https://billing.stripe.com/p/session_test'};}}},
  };
  api.finish=(sid)=>{
    const session=sessions.get(sid);session.status='complete';session.payment_status='paid';
    if(session.mode==='payment'){
      session.payment_intent=`pi_${sid}`;
      intents.set(session.payment_intent,{id:session.payment_intent,livemode:false,status:'succeeded',customer:session.customer,currency:'usd',amount_received:session.amount_total,metadata:session.request.payment_intent_data.metadata,latest_charge:{id:`ch_${sid}`,amount_refunded:0}});
    }else{
      session.subscription=`sub_${sid}`;
      subscriptionRecords.set(session.subscription,{id:session.subscription,livemode:false,customer:session.customer,status:'active',metadata:session.request.subscription_data.metadata,items:{data:[{price:{id:'price_monthly',unit_amount:15900,currency:'usd'},quantity:1,current_period_start:Math.floor(Date.now()/1000),current_period_end:Math.floor(Date.now()/1000)+30*86400}]},cancel_at_period_end:false,created:Math.floor(Date.now()/1000)});
      const subscription=subscriptionRecords.get(session.subscription),item=subscription.items.data[0];
      const invoice={id:`in_${sid}`,livemode:false,customer:session.customer,status:'paid',currency:'usd',amount_paid:15900,amount_remaining:0,parent:{subscription_details:{subscription:subscription.id}},lines:{has_more:false,data:[{amount:15900,currency:'usd',pricing:{price_details:{price:'price_monthly'}},period:{start:item.current_period_start,end:item.current_period_end}}]}};
      subscription.latest_invoice=invoice;invoices.set(invoice.id,invoice);
      const intent={id:`pi_member_${sid}`,livemode:false,status:'succeeded',customer:session.customer,currency:'usd',amount_received:15900,latest_charge:{id:`ch_member_${sid}`,amount_refunded:0}};
      intents.set(intent.id,intent);
      invoicePayments.set(invoice.id,{id:`inpay_${sid}`,invoice:invoice.id,livemode:false,status:'paid',currency:'usd',amount_paid:15900,payment:{type:'payment_intent',payment_intent:intent.id}});

    }
    return session;
  };
  return api;
}
async function fixture(t,{env=config}={}){
  const store=createStore({memory:true}),stripe=fakeStripe();
  const app=createApp({store,rateLimits:false,billingEnv:env,billingClient:stripe});
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));store.close();});
  async function req(path,{method='GET',body,auth,csrf=true,headers={},raw}={}){
    const response=await fetch(base+path,{method,headers:{...((body||raw)?{'Content-Type':'application/json'}:{}),...(auth?.cookie?{Cookie:auth.cookie}:{}),...(auth?.token?{Authorization:`Bearer ${auth.token}`} :{}),...(csrf&&auth?.csrfToken?{'X-CSRF-Token':auth.csrfToken}:{}),...headers},...((body||raw)?{body:raw||JSON.stringify(body)}:{})});
    return {status:response.status,data:await response.json(),headers:response.headers};
  }
  async function register(email='one@example.test',client='web'){
    const r=await req('/api/customer/register',{method:'POST',body:{firstName:'Test',lastName:'Customer',email,password,phone:'2125550100',client}});
    assert.equal(r.status,201,JSON.stringify(r.data));return{...r.data,cookie:r.headers.get('set-cookie')?.split(';')[0]};
  }
  async function admin(){
    store.createAdmin('admin@example.test',password);
    const r=await req('/api/admin/login',{method:'POST',body:{email:'admin@example.test',password}});
    return{...r.data,cookie:r.headers.get('set-cookie')?.split(';')[0]};
  }
  function book(auth,patch={}){
    const count=store.db.prepare('SELECT COUNT(*) n FROM bookings').get().n;
    const booking={id:`booking-${count}`,reference:`CW-BILL${count}`,status:'confirmed',serviceName:'Full detail',vehicleName:'Sedan',serviceId:'full',vehicleId:'sedan',date:'2030-01-10',time:'09:00',total:199,duration:180,email:auth.user.email,...patch};
    store.db.prepare('INSERT INTO bookings(id,reference,date,time,status,value) VALUES(?,?,?,?,?,?)').run(booking.id,booking.reference,booking.date,booking.time,booking.status,JSON.stringify(booking));
    store.db.prepare('INSERT INTO booking_customers(booking_id,user_id) VALUES(?,?)').run(booking.id,auth.user.id);return booking;
  }
  async function event(type,object,{eventId=`evt_${Math.random()}`,livemode=false,signed=true}={}){
    const raw=JSON.stringify({id:eventId,type,livemode,data:{object}});
    const signature=signed?stripe.webhooks.generateTestHeaderString({payload:raw,secret}):'bad';
    return req('/api/billing/webhook',{method:'POST',raw,headers:{'stripe-signature':signature}});
  }
  return{store,stripe,req,register,admin,book,event};
}

test('billing remains disabled without complete settings and live payments require explicit enablement',async t=>{
  assert.equal(billingSettings({...config,STRIPE_SECRET_KEY:'sk_live_fixture'}).enabled,false);
  assert.equal(billingSettings({...config,STRIPE_SECRET_KEY:'sk_live_fixture',CWASH_ENABLE_LIVE_PAYMENTS:'true'}).mode,'live');
  assert.equal(billingSettings({...config,CWASH_PUBLIC_ORIGIN:'https://evil.test/path'}).enabled,false);
  assert.equal(billingSettings({...config,CWASH_PUBLIC_ORIGIN:'http://public.test'}).enabled,false);
  const f=await fixture(t,{env:{}}),auth=await f.register();
  const summary=await f.req('/api/customer/billing',{auth});assert.equal(summary.status,200);assert.equal(summary.data.enabled,false);assert.equal(summary.data.plan,null);
  assert.equal((await f.req('/api/customer/membership/checkout',{method:'POST',body:{},auth})).status,503);assert.equal(f.stripe.calls.checkouts,0);
});
test('billing requires customer ownership and CSRF and ignores no client supplied prices or return addresses',async t=>{
  const f=await fixture(t),auth=await f.register(),other=await f.register('other@example.test','mobile'),booking=f.book(auth);
  const path=`/api/customer/bookings/${booking.reference}/checkout`;
  assert.equal((await f.req('/api/customer/billing')).status,401);
  assert.equal((await f.req(path,{method:'POST',body:{},auth:other})).status,404);
  assert.equal((await f.req(path,{method:'POST',body:{},auth,csrf:false})).status,403);
  assert.equal((await f.req('/api/customer/membership/checkout',{method:'POST',body:{},auth,csrf:false})).status,403);
  assert.equal((await f.req('/api/customer/billing/portal',{method:'POST',body:{},auth,csrf:false})).status,403);
  assert.equal((await f.req(path,{method:'POST',body:{amount:1,returnUrl:'https://evil.test'},auth})).status,400);
  const checkout=await f.req(path,{method:'POST',body:{},auth});assert.equal(checkout.status,200);
  const session=[...f.stripe.sessions.values()][0];assert.equal(session.amount_total,19900);assert.equal(session.request.success_url,'https://cwash.example.test/account?billing=returned');
  assert.equal(session.request.customer,f.store.db.prepare('SELECT stripe_customer_id FROM billing_customers WHERE user_id=?').get(auth.user.id).stripe_customer_id);
});
test('only confirmed non-membership bookings can be paid and concurrent checkout retries reuse one session',async t=>{
  const f=await fixture(t),auth=await f.register();
  for(const patch of [{status:'pending'},{status:'cancelled'},{coverage:'membership',total:0}]){
    const booking=f.book(auth,patch);assert.equal((await f.req(`/api/customer/bookings/${booking.reference}/checkout`,{method:'POST',body:{},auth})).status,409);
  }
  const booking=f.book(auth),path=`/api/customer/bookings/${booking.reference}/checkout`;
  const results=await Promise.all([f.req(path,{method:'POST',body:{},auth}),f.req(path,{method:'POST',body:{},auth})]);
  assert.equal(results[0].status,200);assert.deepEqual(results[0].data,results[1].data);assert.equal(f.stripe.calls.checkouts,1);assert.equal(f.stripe.calls.customers,1);
});
test('payment changes only through verified webhook, event replay is idempotent and other accounts cannot see it',async t=>{
  const f=await fixture(t),auth=await f.register(),other=await f.register('other@example.test'),booking=f.book(auth);
  await f.req(`/api/customer/bookings/${booking.reference}/checkout`,{method:'POST',body:{},auth});const session=f.stripe.finish('cs_test_1');
  assert.equal((await f.req('/api/customer/billing',{auth})).data.payments[0].status,'pending');
  assert.equal((await f.event('checkout.session.completed',session,{signed:false})).status,400);
  assert.equal((await f.event('checkout.session.completed',session,{livemode:true})).status,400);
  assert.equal((await f.event('checkout.session.completed',session,{eventId:'evt_paid'})).status,200);
  const retrieves=f.stripe.calls.retrieves;
  assert.equal((await f.event('checkout.session.completed',session,{eventId:'evt_paid'})).status,200);assert.equal(f.stripe.calls.retrieves,retrieves);
  assert.equal((await f.req('/api/customer/billing',{auth})).data.payments[0].status,'paid');assert.deepEqual((await f.req('/api/customer/billing',{auth:other})).data.payments,[]);
  assert.equal((await f.req(`/api/customer/bookings/${booking.reference}/checkout`,{method:'POST',body:{},auth})).status,409);
});
test('webhook rejects mismatched paid amounts and supports retries after reconciliation',async t=>{
  const f=await fixture(t),auth=await f.register(),booking=f.book(auth);
  await f.req(`/api/customer/bookings/${booking.reference}/checkout`,{method:'POST',body:{},auth});const session=f.stripe.finish('cs_test_1');
  session.amount_total=1;
  assert.equal((await f.event('checkout.session.completed',session,{eventId:'evt_amount'})).status,500);
  assert.equal((await f.req('/api/customer/billing',{auth})).data.payments[0].status,'pending');
  session.amount_total=19900;
  assert.equal((await f.event('checkout.session.completed',session,{eventId:'evt_amount'})).status,200);
  assert.equal((await f.req('/api/customer/billing',{auth})).data.payments[0].status,'paid');
});
test('refunds arriving before completion are reconciled and older checkout events cannot undo them',async t=>{
  const f=await fixture(t),auth=await f.register(),booking=f.book(auth);
  await f.req(`/api/customer/bookings/${booking.reference}/checkout`,{method:'POST',body:{},auth});const session=f.stripe.finish('cs_test_1');
  const intent=f.stripe.intents.get(session.payment_intent);intent.latest_charge.amount_refunded=19900;
  assert.equal((await f.event('charge.refunded',{payment_intent:intent.id})).status,200);
  assert.equal((await f.event('checkout.session.completed',session)).status,200);
  assert.equal((await f.req('/api/customer/billing',{auth})).data.payments[0].status,'refunded');
});
test('membership checkout prevents duplicate subscriptions and tracks authoritative cancellation and past-due state',async t=>{
  const f=await fixture(t),auth=await f.register('native@example.test','mobile');
  const result=await f.req('/api/customer/membership/checkout',{method:'POST',body:{},auth});assert.equal(result.status,200);
  assert.deepEqual((await f.req('/api/customer/membership/checkout',{method:'POST',body:{},auth})).data,result.data);
  const session=f.stripe.finish('cs_test_1');
  assert.equal((await f.req('/api/customer/membership/checkout',{method:'POST',body:{},auth})).status,409);
  await f.event('checkout.session.completed',session);
  const subscription=f.stripe.subscriptionRecords.get(session.subscription);
  subscription.cancel_at_period_end=true;
  await f.event('customer.subscription.updated',{id:subscription.id,status:'canceled'});
  let state=(await f.req('/api/customer/billing',{auth})).data;assert.equal(state.membership.status,'active');assert.equal(state.membership.cancelAtPeriodEnd,true);assert.equal(state.plan.amount,15900);
  subscription.status='past_due';await f.event('invoice.payment_failed',{parent:{subscription_details:{subscription:subscription.id}}});
  assert.equal((await f.req('/api/customer/billing',{auth})).data.membership.status,'past_due');
  assert.equal((await f.req('/api/customer/membership/checkout',{method:'POST',body:{},auth})).status,409);
  subscription.status='canceled';await f.event('customer.subscription.deleted',{id:subscription.id});
  assert.equal((await f.req('/api/customer/billing',{auth})).data.membership.status,'canceled');
  assert.equal((await f.req('/api/customer/membership/checkout',{method:'POST',body:{},auth})).status,200);assert.equal(f.stripe.calls.checkouts,2);
});
test('billing portal always belongs to current account and fixed server return URL',async t=>{
  const f=await fixture(t),auth=await f.register(),other=await f.register('other@example.test');
  await f.req('/api/customer/membership/checkout',{method:'POST',body:{},auth});
  assert.equal((await f.req('/api/customer/billing/portal',{method:'POST',body:{},auth:other})).status,409);
  assert.equal((await f.req('/api/customer/billing/portal',{method:'POST',body:{customer:'cus_other'},auth})).status,400);
  assert.equal((await f.req('/api/customer/billing/portal',{method:'POST',body:{},auth})).status,200);
  assert.deepEqual(f.stripe.calls.portal[0],{customer:'cus_1',return_url:'https://cwash.example.test/account?billing=returned'});
});
test('admin cancellation expires open checkout before changing appointment status',async t=>{
  const f=await fixture(t),auth=await f.register(),owner=await f.admin(),booking=f.book(auth);
  await f.req(`/api/customer/bookings/${booking.reference}/checkout`,{method:'POST',body:{},auth});
  const r=await f.req(`/api/admin/bookings/${booking.id}`,{method:'PATCH',body:{status:'cancelled'},auth:owner});assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(f.stripe.calls.expires,1);assert.equal(f.stripe.sessions.get('cs_test_1').status,'expired');
  assert.equal((await f.req(`/api/customer/bookings/${booking.reference}/checkout`,{method:'POST',body:{},auth})).status,409);
});
test('admin cancellation blocks processing payment then preserves paid state after webhook and restricts billing summary',async t=>{
  const f=await fixture(t),auth=await f.register(),owner=await f.admin(),booking=f.book(auth);
  await f.req(`/api/customer/bookings/${booking.reference}/checkout`,{method:'POST',body:{},auth});const session=f.stripe.finish('cs_test_1');
  assert.equal((await f.req(`/api/admin/bookings/${booking.id}`,{method:'PATCH',body:{status:'cancelled'},auth:owner})).status,409);
  await f.event('checkout.session.completed',session);
  assert.equal((await f.req(`/api/admin/bookings/${booking.id}`,{method:'PATCH',body:{status:'cancelled'},auth:owner})).status,200);
  assert.equal((await f.req('/api/admin/billing',{auth})).status,401);
  const summary=await f.req('/api/admin/billing',{auth:owner});assert.equal(summary.status,200);assert.equal(summary.data.payments[0].status,'paid');assert.equal(summary.data.payments[0].customerEmail,auth.user.email);
});

test('active membership benefits require a verified paid invoice for the current recurring period',async t=>{
  const f=await fixture(t),auth=await f.register();
  await f.req('/api/customer/membership/checkout',{method:'POST',body:{},auth});
  const session=f.stripe.finish('cs_test_1'),subscription=f.stripe.subscriptionRecords.get(session.subscription);
  const invoice=subscription.latest_invoice;
  invoice.status='open';invoice.amount_paid=0;invoice.amount_remaining=15900;
  await f.event('customer.subscription.created',{id:subscription.id});
  let state=(await f.req('/api/customer/billing',{auth})).data;
  assert.equal(state.membership.status,'active');assert.equal(state.benefits.active,false);
  invoice.status='paid';invoice.amount_paid=15900;invoice.amount_remaining=0;
  await f.event('invoice.paid',{parent:{subscription_details:{subscription:subscription.id}}});
  state=(await f.req('/api/customer/billing',{auth})).data;
  assert.equal(state.benefits.active,true);assert.equal(state.benefits.fullDetailAvailable,true);
  subscription.items.data[0].current_period_end+=30*86400;
  await f.event('customer.subscription.updated',{id:subscription.id});
  assert.equal((await f.req('/api/customer/billing',{auth})).data.benefits.active,false,'an old paid invoice must not grant an unpaid renewal period');
});

test('invoice association, amounts, currency and recurring line must all match before granting benefits',async t=>{
  const f=await fixture(t),auth=await f.register();
  await f.req('/api/customer/membership/checkout',{method:'POST',body:{},auth});
  const session=f.stripe.finish('cs_test_1'),subscription=f.stripe.subscriptionRecords.get(session.subscription);
  const invoice=subscription.latest_invoice;
  for(const patch of [{customer:'cus_other'},{currency:'eur'},{amount_paid:1},{parent:{subscription_details:{subscription:'sub_other'}}},{lines:{has_more:false,data:[{...invoice.lines.data[0],pricing:{price_details:{price:'price_other'}}}]}}]){
    const original=structuredClone(invoice);Object.assign(invoice,patch);
    assert.equal((await f.event('customer.subscription.updated',{id:subscription.id})).status,200);
    assert.equal((await f.req('/api/customer/billing',{auth})).data.benefits.active,false);
    Object.assign(invoice,original);
  }
  await f.event('customer.subscription.updated',{id:subscription.id});
  assert.equal((await f.req('/api/customer/billing',{auth})).data.benefits.active,true);
});

test('membership refunds revoke included visits and replayed subscription updates cannot restore refunded coverage',async t=>{
  const f=await fixture(t),auth=await f.register();
  await f.req('/api/customer/membership/checkout',{method:'POST',body:{},auth});
  const session=f.stripe.finish('cs_test_1'),subscription=f.stripe.subscriptionRecords.get(session.subscription);
  await f.event('checkout.session.completed',session);
  assert.equal((await f.req('/api/customer/billing',{auth})).data.benefits.active,true);
  const intent=f.stripe.intents.get('pi_member_cs_test_1');intent.latest_charge.amount_refunded=100;
  assert.equal((await f.event('charge.refunded',{payment_intent:intent.id})).status,200);
  await f.event('customer.subscription.updated',{id:subscription.id,status:'active'});
  assert.equal((await f.req('/api/customer/billing',{auth})).data.benefits.active,false);
  intent.latest_charge.amount_refunded=15900;
  assert.equal((await f.event('charge.refunded',{payment_intent:intent.id})).status,200);
  assert.equal((await f.req('/api/customer/billing',{auth})).data.benefits.active,false);
});

test('a broken membership price does not hide existing booking payments or membership status',async t=>{
  const f=await fixture(t),auth=await f.register(),booking=f.book(auth);
  await f.req(`/api/customer/bookings/${booking.reference}/checkout`,{method:'POST',body:{},auth});
  f.stripe.prices.retrieve=async()=>{throw new Error('price unavailable');};
  const state=await f.req('/api/customer/billing',{auth});
  assert.equal(state.status,200);assert.equal(state.data.plan,null);assert.match(state.data.planError,/temporarily unavailable/);assert.equal(state.data.payments.length,1);
});

test('checkout and portal reject credential-bearing, foreign-host and nonstandard-port URLs',async t=>{
  const f=await fixture(t),auth=await f.register();
  await f.req('/api/customer/membership/checkout',{method:'POST',body:{},auth});
  const session=f.stripe.sessions.get('cs_test_1');
  for(const url of ['http://checkout.stripe.com/pay','https://checkout.stripe.com.evil.test/pay','https://user:password@checkout.stripe.com/pay','https://checkout.stripe.com:444/pay']){
    session.url=url;
    assert.equal((await f.req('/api/customer/membership/checkout',{method:'POST',body:{},auth})).status,502);
  }
  for(const url of ['https://billing.stripe.com.evil.test/pay','https://user:password@billing.stripe.com/pay','https://billing.stripe.com:444/pay']){
    f.stripe.billingPortal.sessions.create=async()=>({url});
    assert.equal((await f.req('/api/customer/billing/portal',{method:'POST',body:{},auth})).status,502);
  }
});


test('a verified payment webhook recovers a lost checkout creation response without charging twice',async t=>{
  const f=await fixture(t),auth=await f.register(),booking=f.book(auth);
  const path=`/api/customer/bookings/${booking.reference}/checkout`;
  await f.req(path,{method:'POST',body:{},auth});
  const session=f.stripe.finish('cs_test_1');
  f.store.db.prepare("UPDATE billing_checkouts SET session_id=NULL,state='creating'").run();
  assert.equal((await f.event('checkout.session.completed',session)).status,200);
  assert.equal((await f.req('/api/customer/billing',{auth})).data.payments[0].status,'paid');
  assert.equal((await f.req(path,{method:'POST',body:{},auth})).status,409);
  assert.equal(f.stripe.calls.checkouts,1);
  assert.equal(f.store.db.prepare('SELECT session_id FROM billing_checkouts').get().session_id,session.id);
});

test('failed refund verification revokes old membership coverage until a successful event retry',async t=>{
  const f=await fixture(t),auth=await f.register();
  await f.req('/api/customer/membership/checkout',{method:'POST',body:{},auth});
  const session=f.stripe.finish('cs_test_1');
  await f.event('checkout.session.completed',session);
  assert.equal((await f.req('/api/customer/billing',{auth})).data.benefits.active,true);
  const list=f.stripe.invoicePayments.list;
  f.stripe.invoicePayments.list=async()=>{throw new Error('temporary network failure');};
  assert.equal((await f.event('customer.subscription.updated',{id:session.subscription},{eventId:'evt_reconcile'})).status,500);
  assert.equal((await f.req('/api/customer/billing',{auth})).data.benefits.active,false);
  f.stripe.invoicePayments.list=list;
  assert.equal((await f.event('customer.subscription.updated',{id:session.subscription},{eventId:'evt_reconcile'})).status,200);
  assert.equal((await f.req('/api/customer/billing',{auth})).data.benefits.active,true);
});
