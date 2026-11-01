import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { createStore } from '../server/store.js';
import { createApp } from '../server/app.js';

const password='Customer-test-password-42!';
async function fixture(t,rateLimits=false){
  const store=createStore({memory:true});
  const app=createApp({store,rateLimits});
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));store.close();});
  async function req(path,{method='GET',body,auth,csrf=true,headers={}}={}){
    const response=await fetch(base+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(auth?.cookie?{Cookie:auth.cookie}:{}),...(auth?.token?{Authorization:`Bearer ${auth.token}`} :{}),...(csrf&&auth?.csrfToken?{'X-CSRF-Token':auth.csrfToken}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,data:await response.json(),headers:response.headers};
  }
  async function register(email='one@example.test',client='web'){
    const response=await req('/api/customer/register',{method:'POST',body:{firstName:'Test',lastName:'Customer',email,password,phone:'2125550100',client}});
    assert.equal(response.status,201,JSON.stringify(response.data));
    return {...response.data,cookie:response.headers.get('set-cookie')?.split(';')[0],headers:response.headers};
  }
  async function book(auth,overrides={}){
    let date,time;
    for(let day=3;day<10;day++){
      date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()+day*86400000));
      const result=await req(`/api/availability?date=${date}&serviceId=full&vehicleId=sedan`);
      if(result.data.slots.length){time=result.data.slots[0];break;}
    }
    return req('/api/bookings',{method:'POST',auth,body:{serviceId:'full',vehicleId:'sedan',date,time,firstName:'Test',lastName:'Customer',email:'guest@example.test',phone:'2125550100',address:'123 Test Street',zip:'11201',parking:'driveway',consent:true,...overrides}});
  }
  return {store,req,register,book};
}
test('web signup normalizes email, hashes password, uses HttpOnly cookies and never exposes password or token',async t=>{
  const {store,req,register}=await fixture(t);const auth=await register('One@EXAMPLE.test');
  assert.equal(auth.user.email,'one@example.test');assert.equal(auth.token,undefined);assert.equal(auth.user.password,undefined);
  assert.match(auth.headers.get('set-cookie'),/HttpOnly/);assert.match(auth.headers.get('set-cookie'),/SameSite=Strict/);assert.match(auth.headers.get('set-cookie'),/Path=\/api;/);
  const row=store.db.prepare('SELECT * FROM customers').get();assert.notEqual(row.password,password);
  assert.equal((await req('/api/customer/session',{auth})).data.authenticated,true);
  const duplicate=await req('/api/customer/register',{method:'POST',body:{firstName:'Other',lastName:'Person',email:' ONE@example.test ',password}});assert.equal(duplicate.status,409);
});
test('signup validates password and profile input and cannot grant an admin role',async t=>{
  const {req}=await fixture(t);
  for(const patch of [{password:'short'},{email:'invalid'},{role:'admin'},{firstName:''}]){
    const r=await req('/api/customer/register',{method:'POST',body:{firstName:'Test',lastName:'User',email:'test@example.test',password,...patch}});assert.equal(r.status,400);
  }
});
test('customer and administrator authentication remain separate',async t=>{
  const {store,req,register}=await fixture(t);store.createAdmin('admin@example.test',password);const auth=await register();
  assert.equal((await req('/api/admin/bookings',{auth})).status,401);
  const login=await req('/api/admin/login',{method:'POST',body:{email:'admin@example.test',password}});
  assert.equal((await req('/api/customer/bookings',{headers:{Cookie:login.headers.get('set-cookie').split(';')[0]}})).status,401);
  assert.equal((await req('/api/customer/login',{method:'POST',body:{email:'admin@example.test',password}})).status,401);
});
test('native sessions are hashed, revocable and cannot be substituted for web cookies',async t=>{
  const {store,req,register}=await fixture(t);const auth=await register('mobile@example.test','mobile');assert.equal(auth.cookie,undefined);assert.match(auth.token,/^[a-f0-9]{64}$/);
  const row=store.db.prepare('SELECT * FROM customer_sessions').get();assert.equal(row.token,createHash('sha256').update(auth.token).digest('hex'));assert.equal(row.kind,'mobile');
  assert.equal((await req('/api/customer/session',{auth})).data.authenticated,true);
  assert.equal((await req('/api/customer/bookings',{headers:{Cookie:`cwash_customer=${auth.token}`}})).status,401);
  const web=await register('web@example.test');assert.equal((await req('/api/customer/bookings',{auth:{token:web.cookie.split('=')[1]}})).status,401);
  assert.equal((await req('/api/customer/logout',{method:'POST',body:{},auth})).status,200);
  assert.equal((await req('/api/customer/bookings',{auth})).status,401);
});
test('cookie mutations require CSRF including account-linked booking creation',async t=>{
  const {req,register,book}=await fixture(t);const auth=await register();
  const body={firstName:'New',lastName:'Name',phone:''};
  assert.equal((await req('/api/customer/profile',{method:'PATCH',body,auth,csrf:false})).status,403);
  assert.equal((await req('/api/customer/logout',{method:'POST',body:{},auth,headers:{'X-CSRF-Token':'é'.repeat(64)}})).status,403);
  assert.equal((await book({...auth,csrfToken:undefined})).status,403);
  assert.equal((await req('/api/customer/profile',{method:'PATCH',body,auth})).status,200);
});
test('bookings follow authenticated identity, never a submitted user ID or matching guest email',async t=>{
  const {req,register,book}=await fixture(t);
  assert.equal((await book(null,{email:'one@example.test'})).status,201);
  const one=await register(),two=await register('two@example.test','mobile');
  assert.deepEqual((await req('/api/customer/bookings',{auth:one})).data.bookings,[]);
  const result=await book(one,{userId:two.user.id,email:'two@example.test'});assert.equal(result.status,201);assert.equal(result.data.booking.accessToken,undefined);
  const mine=(await req('/api/customer/bookings',{auth:one})).data.bookings;assert.equal(mine.length,1);assert.equal(mine[0].email,one.user.email);
  assert.deepEqual((await req('/api/customer/bookings',{auth:two})).data.bookings,[]);
  assert.equal((await req(`/api/bookings/${mine[0].reference}`,{auth:two})).status,401);
});
test('a second-device login sees the same account history',async t=>{
  const {req,register,book}=await fixture(t);const auth=await register();await book(auth);
  const login=await req('/api/customer/login',{method:'POST',body:{email:auth.user.email,password,client:'mobile'}});assert.equal(login.status,200);
  assert.equal((await req('/api/customer/bookings',{auth:login.data})).data.bookings.length,1);
});
test('password changes require the old password and revoke every session',async t=>{
  const {req,register}=await fixture(t);const auth=await register();
  const second=(await req('/api/customer/login',{method:'POST',body:{email:auth.user.email,password,client:'mobile'}})).data;
  assert.equal((await req('/api/customer/password',{method:'POST',auth,body:{currentPassword:'wrong',newPassword:'New-test-password-42!'}})).status,400);
  assert.equal((await req('/api/customer/password',{method:'POST',auth,body:{currentPassword:password,newPassword:'New-test-password-42!'}})).status,200);
  assert.equal((await req('/api/customer/bookings',{auth})).status,401);assert.equal((await req('/api/customer/bookings',{auth:second})).status,401);
  assert.equal((await req('/api/customer/login',{method:'POST',body:{email:auth.user.email,password}})).status,401);
  assert.equal((await req('/api/customer/login',{method:'POST',body:{email:auth.user.email,password:'New-test-password-42!'}})).status,200);
});
test('expired credentials cannot silently submit a guest booking',async t=>{
  const {store,req,register,book}=await fixture(t);const auth=await register();store.db.prepare('UPDATE customer_sessions SET expires=0').run();
  assert.equal((await book(auth)).status,401);
  // Browsers stop sending expired cookies before a mounted page notices.
  assert.equal((await book({csrfToken:auth.csrfToken})).status,401);
  assert.equal((await req('/api/customer/session',{auth})).data.authenticated,false);
});
test('profile changes persist but cannot modify email, role or another customer',async t=>{
  const {req,register}=await fixture(t);const auth=await register();
  assert.equal((await req('/api/customer/profile',{method:'PATCH',auth,body:{firstName:'New',lastName:'Person',phone:'2125550199',email:'other@example.test'}})).status,400);
  assert.equal((await req('/api/customer/profile',{method:'PATCH',auth,body:{firstName:'New',lastName:'Person',phone:'2125550199'}})).status,200);
  const user=(await req('/api/customer/session',{auth})).data.user;assert.equal(user.firstName,'New');assert.equal(user.email,auth.user.email);
});
test('cross-site registration is rejected and account attempts are rate limited',async t=>{
  const {req}=await fixture(t,true);const body={email:'nobody@example.test',password};
  assert.equal((await req('/api/customer/login',{method:'POST',body,headers:{Origin:'https://foreign.example'}})).status,403);
  for(let i=0;i<15;i++)assert.equal((await req('/api/customer/login',{method:'POST',body})).status,401);
  assert.equal((await req('/api/customer/login',{method:'POST',body})).status,429);
});
