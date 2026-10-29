import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createStore } from '../server/store.js';
import { createApp } from '../server/app.js';

const ADMIN_EMAIL = 'owner@example.test';
const ADMIN_PASSWORD = 'Test-only-password-8!';

test('mobile receipt keys expose only their own booking and reflect admin updates', async t => {
  const { request, login, available, book, adminBooking } = await fixture(t);
  const first = await book(await available());
  const other = await book(await available(10));
  assert.match(first.accessToken, /^[a-f0-9]{64}$/);
  assert.equal((await request(`/api/bookings/${first.reference}`)).status, 401);
  assert.equal((await request(`/api/bookings/${first.reference}`, { headers: { Authorization: `Bearer ${other.accessToken}` } })).status, 401);
  const headers = { Authorization: `Bearer ${first.accessToken}` };
  const result = await request(`/api/bookings/${first.reference}`, { headers });
  assert.equal(result.status, 200);
  assert.equal(result.data.booking.status, 'pending');
  assert.equal(result.data.booking.email, undefined);
  assert.equal(result.data.booking.accessToken, undefined);
  const auth = await login();
  const saved = await adminBooking(auth, first.reference);
  assert.equal(saved.accessToken, undefined);
  await request(`/api/admin/bookings/${saved.id}`, { method: 'PATCH', auth, body: { status: 'confirmed' } });
  assert.equal((await request(`/api/bookings/${first.reference}`, { headers })).data.booking.status, 'confirmed');
});

function futureDate(offset = 3) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

function minutes(time) {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

async function fixture(t) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'cwash-api-'));
  const store = createStore({ dataDir });
  await store.createAdmin(ADMIN_EMAIL, ADMIN_PASSWORD);
  const app = createApp({ store, rateLimits: false });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    store.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  async function request(url, { method = 'GET', body, auth, csrf = true, headers = {} } = {}) {
    const response = await fetch(baseUrl + url, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(auth ? { Cookie: auth.cookie } : {}),
        ...(auth && csrf ? { 'X-CSRF-Token': auth.csrfToken } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const raw = await response.text();
    let data;
    try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
    return { status: response.status, data, headers: response.headers };
  }

  async function login() {
    const result = await request('/api/admin/login', {
      method: 'POST', body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.ok(result.data.csrfToken);
    const cookieHeader = result.headers.get('set-cookie');
    assert.ok(cookieHeader);
    return { cookie: cookieHeader.split(';')[0], csrfToken: result.data.csrfToken, cookieHeader };
  }

  const catalogResult = await request('/api/catalog');
  assert.equal(catalogResult.status, 200);
  const catalog = catalogResult.data;

  async function available(offset = 3, serviceId = catalog.services[0].id, vehicleId = catalog.vehicles[0].id) {
    for (let day = offset; day < offset + 14; day++) {
      const date = futureDate(day);
      const result = await request(`/api/availability?${new URLSearchParams({ date, serviceId, vehicleId })}`);
      assert.equal(result.status, 200, JSON.stringify(result.data));
      if (result.data.slots.length) return { date, time: result.data.slots[0], slots: result.data.slots, serviceId, vehicleId };
    }
    assert.fail('Expected an available appointment within the next two weeks.');
  }

  function bookingBody(slot, overrides = {}) {
    return {
      serviceId: slot.serviceId, vehicleId: slot.vehicleId, date: slot.date, time: slot.time,
      firstName: 'Alex', lastName: 'Customer', email: 'customer@example.test',
      phone: '2125550100', address: '123 Example Street', unit: 'Private driveway',
      zip: '10001', parking: 'driveway', notes: 'Please call on arrival.', consent: true,
      ...overrides,
    };
  }

  async function book(slot, overrides = {}) {
    const result = await request('/api/bookings', { method: 'POST', body: bookingBody(slot, overrides) });
    assert.equal(result.status, 201, JSON.stringify(result.data));
    return result.data.booking;
  }

  async function adminBooking(auth, reference) {
    const result = await request('/api/admin/bookings', { auth });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    const booking = result.data.bookings.find(item => item.reference === reference);
    assert.ok(booking, `Missing booking ${reference}`);
    return booking;
  }

  return { request, login, catalog, available, bookingBody, book, adminBooking, store, dataDir };
}

test('public catalog exposes services, vehicle pricing, and New York appointment availability', async t => {
  const { request, catalog, available } = await fixture(t);
  assert.ok(catalog.services.length >= 3);
  assert.ok(catalog.vehicles.length >= 2);
  for (const service of catalog.services) {
    assert.equal(typeof service.id, 'string');
    assert.ok(service.price > 0);
    assert.ok(service.duration > 0);
  }
  const slot = await available();
  const result = await request(`/api/availability?${new URLSearchParams({ date: slot.date, serviceId: slot.serviceId, vehicleId: slot.vehicleId })}`);
  assert.equal(result.data.timezone, 'America/New_York');
  assert.ok(result.data.slots.every(time => /^\d{2}:\d{2}$/.test(time)));
  assert.ok(result.data.slots.every(time => minutes(time) >= catalog.settings.startHour * 60));
});

test('guest reservations start pending and retain a server-calculated price and duration', async t => {
  const { catalog, available, book, login, adminBooking } = await fixture(t);
  const service = catalog.services[0];
  const vehicle = catalog.vehicles.find(item => item.surcharge > 0) ?? catalog.vehicles[0];
  const booking = await book(await available(3, service.id, vehicle.id), { total: 1, duration: 1, status: 'confirmed' });
  assert.equal(booking.status, 'pending');
  assert.ok(booking.reference);
  assert.equal(booking.total, service.price + vehicle.surcharge);
  assert.equal(booking.duration, service.duration + vehicle.durationExtra);
  const saved = await adminBooking(await login(), booking.reference);
  assert.equal(saved.status, 'pending');
  assert.equal(saved.total, service.price + vehicle.surcharge);
  assert.equal(saved.address, '123 Example Street');
  assert.equal(saved.parking, 'driveway');
});

test('booking validation rejects unsupported locations, invalid choices, and missing consent', async t => {
  const { request, available, bookingBody } = await fixture(t);
  const slot = await available();
  for (const invalid of [
    { zip: '90210' }, { serviceId: 'made-up-service' }, { vehicleId: 'made-up-vehicle' },
    { email: 'invalid' }, { consent: false }, { parking: 'unspecified' },
    { time: '25:00' }, { date: '2027-02-30' },
  ]) {
    const result = await request('/api/bookings', { method: 'POST', body: bookingBody(slot, invalid) });
    assert.equal(result.status, 400, `Accepted ${JSON.stringify(invalid)}: ${JSON.stringify(result.data)}`);
    assert.equal(typeof result.data.error, 'string');
  }
});

test('past appointments cannot be requested', async t => {
  const { request, available, bookingBody } = await fixture(t);
  const result = await request('/api/bookings', {
    method: 'POST', body: bookingBody(await available(), { date: '2020-01-01', time: '10:00' }),
  });
  assert.ok([400, 409].includes(result.status), JSON.stringify(result.data));
});

test('admin data requires authentication and login issues an HttpOnly same-site session', async t => {
  const { request, login } = await fixture(t);
  assert.equal((await request('/api/admin/bookings')).status, 401);
  assert.equal((await request('/api/admin/login', {
    method: 'POST', body: { email: ADMIN_EMAIL, password: 'incorrect-password' },
  })).status, 401);
  const auth = await login();
  assert.match(auth.cookieHeader, /HttpOnly/i);
  assert.match(auth.cookieHeader, /SameSite=Strict/i);
  const session = await request('/api/admin/session', { auth });
  assert.equal(session.data.authenticated, true);
  assert.equal(session.data.admin.email, ADMIN_EMAIL);
  assert.equal((await request('/api/admin/bookings', { auth })).status, 200);
});

test('authenticated mutations require the session CSRF token', async t => {
  const { request, login, available, book, adminBooking } = await fixture(t);
  const auth = await login();
  const booking = await adminBooking(auth, (await book(await available())).reference);
  for (const headers of [{}, { 'X-CSRF-Token': 'not-the-session-token' }, { 'X-CSRF-Token': 'é'.repeat(64) }]) {
    const result = await request(`/api/admin/bookings/${booking.id}`, {
      method: 'PATCH', auth, csrf: false, headers, body: { status: 'confirmed' },
    });
    assert.equal(result.status, 403);
  }
  assert.equal((await adminBooking(auth, booking.reference)).status, 'pending');
  const confirmed = await request(`/api/admin/bookings/${booking.id}`, {
    method: 'PATCH', auth, body: { status: 'confirmed' },
  });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
});

test('pending requests may share a slot but overlapping confirmations cannot', async t => {
  const { request, login, available, book, adminBooking } = await fixture(t);
  const auth = await login();
  const slot = await available();
  const first = await adminBooking(auth, (await book(slot)).reference);
  const second = await adminBooking(auth, (await book(slot, { email: 'second@example.test' })).reference);
  assert.equal((await request(`/api/admin/bookings/${first.id}`, {
    method: 'PATCH', auth, body: { status: 'confirmed' },
  })).status, 200);
  const conflict = await request(`/api/admin/bookings/${second.id}`, {
    method: 'PATCH', auth, body: { status: 'confirmed' },
  });
  assert.equal(conflict.status, 409, JSON.stringify(conflict.data));
  assert.equal((await adminBooking(auth, second.reference)).status, 'pending');
});

test('availability reserves the whole service duration plus travel time and cancellation releases it', async t => {
  const { request, login, catalog, available, book, adminBooking } = await fixture(t);
  const auth = await login();
  const slot = await available();
  const booking = await adminBooking(auth, (await book(slot)).reference);
  await request(`/api/admin/bookings/${booking.id}`, { method: 'PATCH', auth, body: { status: 'confirmed' } });
  const query = `/api/availability?${new URLSearchParams({ date: slot.date, serviceId: slot.serviceId, vehicleId: slot.vehicleId })}`;
  const after = await request(query);
  const finishWithTravel = minutes(slot.time) + booking.duration + catalog.settings.travelBuffer;
  assert.ok(!after.data.slots.includes(slot.time));
  assert.ok(after.data.slots.every(time => minutes(time) >= finishWithTravel));
  assert.equal((await request(`/api/admin/bookings/${booking.id}`, {
    method: 'PATCH', auth, body: { status: 'cancelled' },
  })).status, 200);
  assert.ok((await request(query)).data.slots.includes(slot.time));
});

test('rescheduling checks conflicts and leaves the original appointment intact on failure', async t => {
  const { request, login, available, book, adminBooking } = await fixture(t);
  const auth = await login();
  const firstSlot = await available(3);
  const secondSlot = await available(10);
  const first = await adminBooking(auth, (await book(firstSlot)).reference);
  const second = await adminBooking(auth, (await book(secondSlot)).reference);
  for (const booking of [first, second]) {
    assert.equal((await request(`/api/admin/bookings/${booking.id}`, {
      method: 'PATCH', auth, body: { status: 'confirmed' },
    })).status, 200);
  }
  const conflict = await request(`/api/admin/bookings/${second.id}`, {
    method: 'PATCH', auth, body: { date: first.date, time: first.time },
  });
  assert.equal(conflict.status, 409);
  const unchanged = await adminBooking(auth, second.reference);
  assert.equal(unchanged.date, second.date);
  assert.equal(unchanged.time, second.time);
  const nextSlot = await available(17);
  const moved = await request(`/api/admin/bookings/${second.id}`, {
    method: 'PATCH', auth, body: { date: nextSlot.date, time: nextSlot.time },
  });
  assert.equal(moved.status, 200, JSON.stringify(moved.data));
  assert.equal((await adminBooking(auth, second.reference)).date, nextSlot.date);
});

test('admin settings block dates and service edits do not rewrite existing booking prices', async t => {
  const { request, login, available, book, adminBooking, catalog } = await fixture(t);
  const auth = await login();
  const slot = await available();
  const booking = await book(slot);
  assert.equal((await request('/api/admin/settings', {
    method: 'PUT', body: { blockedDates: [slot.date] },
  })).status, 401);
  const changed = await request('/api/admin/settings', {
    method: 'PUT', auth, body: { blockedDates: [slot.date] },
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.data));
  const slots = await request(`/api/availability?${new URLSearchParams({ date: slot.date, serviceId: slot.serviceId, vehicleId: slot.vehicleId })}`);
  assert.deepEqual(slots.data.slots, []);
  const oldService = catalog.services.find(service => service.id === slot.serviceId);
  const updated = await request(`/api/admin/services/${slot.serviceId}`, {
    method: 'PUT', auth, body: { price: oldService.price + 25, duration: oldService.duration },
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.data));
  assert.equal((await request('/api/catalog')).data.services.find(service => service.id === slot.serviceId).price, oldService.price + 25);
  assert.equal((await adminBooking(auth, booking.reference)).total, booking.total);
});

test('logout revokes the server-side session', async t => {
  const { request, login } = await fixture(t);
  const auth = await login();
  const logout = await request('/api/admin/logout', { method: 'POST', auth });
  assert.ok([200, 204].includes(logout.status), JSON.stringify(logout.data));
  assert.equal((await request('/api/admin/bookings', { auth })).status, 401);
  assert.equal((await request('/api/admin/session', { auth })).data.authenticated, false);
});

test('bookings survive opening another connection to the persistent SQLite store', async t => {
  const { available, book, dataDir } = await fixture(t);
  const booking = await book(await available());
  const reopened = createStore({ dataDir });
  const server = createApp({ store: reopened, rateLimits: false }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const login = await fetch(baseUrl + '/api/admin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const result = await fetch(baseUrl + '/api/admin/bookings', { headers: { Cookie: cookie } });
    assert.equal(result.status, 200);
    const data = await result.json();
    assert.ok(data.bookings.some(item => item.reference === booking.reference));
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    reopened.close();
  }
});
