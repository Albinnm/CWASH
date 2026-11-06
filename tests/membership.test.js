import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../server/store.js';
import { createMembership, MembershipError } from '../server/membership.js';
import { dateTimeEpoch } from '../server/scheduling.js';

function fixture(t, { dataDir, now = dateTimeEpoch('2030-11-01','08:00'), periodEnd = dateTimeEpoch('2030-12-01','08:00')/1000 } = {}) {
  const store=createStore(dataDir?{dataDir}:{memory:true});
  const memberships=new Map(['one','two'].map(id=>[id,{status:'active',entitlementPaid:true,currentPeriodEnd:periodEnd,mode:'test'}]));
  for(const id of memberships.keys()) store.db.prepare('INSERT OR IGNORE INTO customers(id,email,password,first_name,last_name,created_at) VALUES (?,?,?,?,?,?)').run(id,`${id}@example.test`,'unused-fixture-hash','Test','Member','2030-01-01');
  const member=createMembership({store,getMembership:id=>memberships.get(id),clock:()=>now});
  t.after(()=>store.close());
  function reserve(userId='one', overrides={}) {
    const booking={id:randomUUID(),reference:randomUUID(),serviceId:'full',date:'2030-11-02',time:'09:00',status:'pending',coverage:'membership',membershipIncluded:true,total:0,...overrides};
    store.db.exec('BEGIN IMMEDIATE');
    try {
      store.db.prepare('INSERT INTO bookings(id,reference,date,time,status,value) VALUES (?,?,?,?,?,?)').run(booking.id,booking.reference,booking.date,booking.time,booking.status,JSON.stringify(booking));
      member.reserve(userId,booking);
      store.db.exec('COMMIT');return booking;
    }catch(e){store.db.exec('ROLLBACK');throw e;}
  }
  function update(booking, changes) {
    const next={...booking,...changes};
    member.validateAdminChange(booking,next);
    store.db.prepare('UPDATE bookings SET date=?,time=?,status=?,value=? WHERE id=?').run(next.date,next.time,next.status,JSON.stringify(next),next.id);
    return next;
  }
  return {store,member,memberships,reserve,update};
}

test('a pending included full detail reserves the one-time allowance and keeps customer histories isolated',t=>{
  const f=fixture(t);
  assert.equal(f.member.benefits('one').fullDetailAvailable,true);
  f.reserve();
  assert.equal(f.member.benefits('one').fullDetailAvailable,false);
  assert.equal(f.member.benefits('two').fullDetailAvailable,true);
  assert.throws(()=>f.reserve(),/one introductory full detail/);
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM membership_visits').get().n,1);
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM bookings').get().n,1);
});

test('membership cannot grant free bookings for guests, unpaid, expired or invalid sessions',t=>{
  const f=fixture(t);
  assert.throws(()=>f.reserve(null),e=>e instanceof MembershipError&&e.status===401);
  for(const status of ['past_due','incomplete','trialing','canceled']) {
    f.memberships.get('one').status=status;
    assert.throws(()=>f.reserve(),/active paid membership/);
  }
  f.memberships.get('one').status='active';
  f.memberships.get('one').entitlementPaid=false;
  assert.throws(()=>f.reserve(),/active paid membership/);
  f.memberships.get('one').entitlementPaid=true;
  f.memberships.get('one').currentPeriodEnd=1;
  assert.throws(()=>f.reserve(),/active paid membership/);
  assert.equal(f.member.benefits('one').active,false);
  f.memberships.get('two').mode='unknown';
  assert.throws(()=>f.reserve('two'),/active paid membership/);
});

test('only future full or maintenance visits within the paid period can be included',t=>{
  const f=fixture(t);
  assert.throws(()=>f.reserve('one',{serviceId:'exterior'}),/not included/);
  assert.throws(()=>f.reserve('one',{date:'2030-10-31'}),/future/);
  assert.throws(()=>f.reserve('one',{date:'2030-12-01',time:'08:00'}),/paid membership period/);
  assert.throws(()=>f.reserve('one',{date:'2030-11-31'}),/valid appointment/);
  assert.throws(()=>f.reserve('one',{total:199}),/zero balance/);
  assert.throws(()=>f.reserve('one',{membershipIncluded:false}),/verified membership marker/);
  assert.throws(()=>f.reserve('one',{coverage:'standard'}),/not included/);
});

test('weekly maintenance requires onboarding and seven calendar days between included visits',t=>{
  const f=fixture(t);
  assert.throws(()=>f.reserve('one',{serviceId:'maintenance',date:'2030-11-09'}),/introductory full detail/);
  f.reserve();
  assert.throws(()=>f.reserve('one',{serviceId:'maintenance',date:'2030-11-09',time:'08:30'}),/seven days after/);
  f.reserve('one',{serviceId:'maintenance',date:'2030-11-09'});
  assert.throws(()=>f.reserve('one',{serviceId:'maintenance',date:'2030-11-15'}),/every seven days/);
  f.reserve('one',{serviceId:'maintenance',date:'2030-11-16'});
  assert.throws(()=>f.reserve('one',{serviceId:'maintenance',date:'2030-11-12'}),/every seven days/);
});

test('weekly visits preserve their New York appointment time across spring daylight saving',t=>{
  const f=fixture(t,{now:dateTimeEpoch('2030-03-01','08:00'),periodEnd:dateTimeEpoch('2030-04-01','08:00')/1000});
  f.reserve('one',{date:'2030-03-03'});
  // The 2030 DST transition is March 10: these visits are 167 elapsed hours apart.
  f.reserve('one',{serviceId:'maintenance',date:'2030-03-10'});
  f.reserve('one',{serviceId:'maintenance',date:'2030-03-17'});
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM membership_visits').get().n,3);
});

test('cancellation releases an unused allowance but completing or renewing never repeats the introductory detail',t=>{
  const f=fixture(t);
  let full=f.reserve();
  f.update(full,{status:'cancelled'});
  assert.equal(f.member.benefits('one').fullDetailAvailable,true);
  full=f.reserve();f.update(full,{status:'completed'});
  f.memberships.set('one',{status:'active',entitlementPaid:true,mode:'test',currentPeriodEnd:dateTimeEpoch('2031-01-01','08:00')/1000});
  assert.throws(()=>f.reserve(),/one introductory full detail/);
  f.memberships.get('one').mode='live';
  assert.equal(f.member.benefits('one').fullDetailAvailable,true);
  f.reserve(); // A test charge must not consume a real launch entitlement.
});

test('admin rescheduling cannot bypass spacing, expired billing periods or onboarding dependencies',t=>{
  const f=fixture(t);
  const full=f.reserve();
  const maintenance=f.reserve('one',{serviceId:'maintenance',date:'2030-11-09'});
  assert.throws(()=>f.update(full,{status:'cancelled'}),/dependent/);
  assert.throws(()=>f.update(full,{date:'2030-11-04'}),/seven days before/);
  assert.throws(()=>f.update(maintenance,{date:'2030-11-08'}),/seven days after/);
  assert.throws(()=>f.update(maintenance,{date:'2030-12-03'}),/paid membership period/);
  f.memberships.get('one').status='past_due';
  assert.throws(()=>f.update(maintenance,{status:'confirmed'}),/active paid membership/);
  f.update(maintenance,{status:'cancelled'});
  f.update(full,{status:'cancelled'});
});

test('included visit reservations survive a separate persistent database connection',t=>{
  const dataDir=mkdtempSync(join(tmpdir(),'cwash-membership-'));
  t.after(()=>rmSync(dataDir,{recursive:true,force:true}));
  const first=fixture(t,{dataDir});first.reserve();
  const second=fixture(t,{dataDir});
  assert.equal(second.member.benefits('one').fullDetailAvailable,false);
  assert.throws(()=>second.reserve(),/one introductory full detail/);
});
