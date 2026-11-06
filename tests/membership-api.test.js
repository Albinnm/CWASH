import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createStore } from '../server/store.js';
import { createApp } from '../server/app.js';
import { nyParts } from '../server/scheduling.js';

async function fixture(t){
  const store=createStore({memory:true});
  const settings={...store.getCatalog().settings,workingDays:[0,1,2,3,4,5,6],noticeHours:0};
  store.db.prepare('UPDATE settings SET value=?').run(JSON.stringify(settings));
  const env={STRIPE_SECRET_KEY:'sk_test_fixture_only',STRIPE_WEBHOOK_SECRET:'whsec_fixture_only',CWASH_PUBLIC_ORIGIN:'https://cwash.example.test'};
  const app=createApp({store,rateLimits:false,billingEnv:env,billingClient:{}});
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));store.close();});
  async function req(path,{method='GET',body,auth,csrf=true}={}){
    const r=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(auth?{Cookie:auth.cookie}:{}),...(auth&&csrf?{'X-CSRF-Token':auth.csrfToken}:{})},...(body?{body:JSON.stringify(body)}:{})});
    return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
  }
  async function register(email){
    const r=await req('/api/customer/register',{method:'POST',body:{firstName:'Test',lastName:'Member',email,password:'Membership-test-only-42!'}});
    assert.equal(r.status,201);return{...r.data,cookie:r.cookie};
  }
  const auth=await register('member@example.test'),other=await register('other@example.test');
  const periodEnd=Math.floor(Date.now()/1000)+30*86400;
  store.db.prepare('INSERT INTO billing_memberships(subscription_id,user_id,mode,status,cancel_at_period_end,current_period_end,created) VALUES (?,?,?,?,?,?,?)').run('sub_fixture',auth.user.id,'test','active',0,periodEnd,Math.floor(Date.now()/1000));
  store.db.prepare('INSERT INTO billing_membership_entitlements(subscription_id,paid_period_end) VALUES (?,?)').run('sub_fixture',periodEnd);
  store.createAdmin('owner@example.test','Owner-test-only-password!');
  const ownerResponse=await req('/api/admin/login',{method:'POST',body:{email:'owner@example.test',password:'Owner-test-only-password!'}});
  const owner={...ownerResponse.data,cookie:ownerResponse.cookie};
  const p=nyParts();
  function day(offset){const d=new Date(`${p.year}-${p.month}-${p.day}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10);}
  function book(patch={},account=auth){return req('/api/bookings',{method:'POST',auth:account,body:{coverage:'membership',serviceId:'full',vehicleId:'sedan',date:day(2),time:'09:00',firstName:'Test',lastName:'Member',email:'member@example.test',phone:'2125550100',address:'123 Test Street',zip:'11201',parking:'driveway',consent:true,...patch}});}
  async function stored(reference){return (await req('/api/customer/bookings',{auth})).data.bookings.find(b=>b.reference===reference);}
  return {store,req,auth,other,owner,day,book,stored};
}

test('included booking API grants only verified paid members a zero-balance visit and reserves the allowance atomically',async t=>{
  const f=await fixture(t);
  assert.equal((await f.book({},null)).status,401);
  assert.equal((await f.book({},f.other)).status,403);
  assert.equal((await f.book({serviceId:'maintenance',coverage:'standard'})).status,400);
  const result=await f.book({total:1,membershipIncluded:false});assert.equal(result.status,201,JSON.stringify(result.data));
  assert.equal(result.data.booking.total,0);assert.equal(result.data.booking.coverage,'membership');assert.equal(result.data.booking.membershipIncluded,true);
  assert.equal((await f.req('/api/customer/billing',{auth:f.auth})).data.benefits.fullDetailAvailable,false);
  assert.equal((await f.book()).status,409);
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM membership_visits').get().n,1);
  const extras=await f.book({coverage:'standard',total:0,membershipIncluded:true});assert.equal(extras.status,201);assert.equal(extras.data.booking.total,199);assert.equal(extras.data.booking.membershipIncluded,false);
  const b=await f.stored(result.data.booking.reference);
  assert.equal((await f.req(`/api/admin/bookings/${b.id}`,{method:'PATCH',auth:f.owner,body:{status:'confirmed'}})).status,200);
  assert.equal((await f.req(`/api/customer/bookings/${b.reference}/checkout`,{method:'POST',auth:f.auth,body:{}})).status,409);
});

test('membership availability and submission enforce weekly spacing and paid-period limits',async t=>{
  const f=await fixture(t);assert.equal((await f.book()).status,201);
  const slots=async(offset,account=f.auth)=>f.req(`/api/availability?date=${f.day(offset)}&serviceId=maintenance&vehicleId=sedan&coverage=membership`,{auth:account});
  assert.equal((await slots(9,null)).status,401);
  assert.equal((await slots(9,f.other)).status,403);
  assert.deepEqual((await slots(8)).data.slots,[]);
  assert.ok((await slots(9)).data.slots.includes('09:00'));
  assert.equal((await f.book({serviceId:'maintenance',date:f.day(8)})).status,409);
  assert.equal((await f.book({serviceId:'maintenance',date:f.day(9)})).status,201);
  assert.equal((await f.book({serviceId:'maintenance',date:f.day(15)})).status,409);
  assert.equal((await f.book({serviceId:'maintenance',date:f.day(16)})).status,201);
  assert.equal((await f.book({serviceId:'maintenance',date:f.day(37)})).status,409);
  assert.deepEqual((await slots(37)).data.slots,[]);
});

test('admin changes cannot bypass membership dependencies or restore unpaid coverage',async t=>{
  const f=await fixture(t);
  const full=await f.stored((await f.book()).data.booking.reference);
  const maintenance=await f.stored((await f.book({serviceId:'maintenance',date:f.day(9)})).data.booking.reference);
  const update=(b,changes)=>f.req(`/api/admin/bookings/${b.id}`,{method:'PATCH',body:changes,auth:f.owner});
  assert.equal((await update(full,{status:'cancelled'})).status,409);
  assert.equal((await update(maintenance,{date:f.day(8)})).status,409);
  f.store.db.prepare('UPDATE billing_membership_entitlements SET paid_period_end=0').run();
  assert.equal((await update(maintenance,{status:'confirmed'})).status,403);
  assert.equal((await f.req('/api/customer/billing',{auth:f.auth})).data.benefits.active,false);
  assert.equal((await update(maintenance,{status:'cancelled'})).status,200);
  assert.equal((await update(full,{status:'cancelled'})).status,200);
});
