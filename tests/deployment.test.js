import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/app.js';
import { createStore } from '../server/store.js';
import { deploymentSettings } from '../server/deployment.js';

async function fixture(t, env = {}, production = false) {
  const store = createStore({ memory: true });
  let databaseOpen = true;
  const app = createApp({ store, production, rateLimits: false, deployment: deploymentSettings({ env, production }) });
  app.get('/deployment-test/client', (req, res) => res.json({ ip: req.ip, protocol: req.protocol }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (databaseOpen) store.close();
  });
  return {
    baseUrl,
    request: (path, options) => fetch(baseUrl + path, options),
    closeDatabase: () => { store.close(); databaseOpen = false; },
  };
}

test('deployment settings default to no trusted proxies and prefer an explicit public origin', () => {
  assert.deepEqual(deploymentSettings({ env: {} }), { origin: null, trustProxyHops: 0 });
  assert.deepEqual(deploymentSettings({ production: true, env: { RENDER_EXTERNAL_URL: 'https://cwash.example.test/' } }), { origin: 'https://cwash.example.test', trustProxyHops: 0 });
  assert.equal(deploymentSettings({ production: true, env: { CWASH_PUBLIC_ORIGIN: 'https://custom.example.test', RENDER_EXTERNAL_URL: 'https://cwash.example.test' } }).origin, 'https://custom.example.test');
  assert.equal(deploymentSettings({ env: { CWASH_PUBLIC_ORIGIN: 'http://localhost:3000/' } }).origin, 'http://localhost:3000');
});

test('unsafe or malformed deployment configuration fails before the server starts', () => {
  for (const value of ['', 'true', '-1', '6', '1.5', '1,2']) {
    assert.throws(() => deploymentSettings({ env: { CWASH_TRUST_PROXY_HOPS: value } }), /CWASH_TRUST_PROXY_HOPS/);
  }
  for (const value of ['', 'example.test', 'https:example.test', 'ftp://example.test', 'https://user:password@example.test', 'https://example.test/path', 'https://example.test/?q=1', 'https://example.test/#fragment', 'https://example.test?', 'https://example.test\\']) {
    assert.throws(() => deploymentSettings({ env: { CWASH_PUBLIC_ORIGIN: value } }), /CWASH_PUBLIC_ORIGIN/);
  }
  assert.throws(() => deploymentSettings({ production: true, env: { RENDER_EXTERNAL_URL: 'http://example.test' } }), /HTTPS/);
});

test('HTTP requests trust only the configured number of proxy hops', async t => {
  const headers = { 'X-Forwarded-For': '198.51.100.10, 203.0.113.20', 'X-Forwarded-Proto': 'https' };
  for (const [hops, expectedIp] of [['0', '127.0.0.1'], ['1', '203.0.113.20'], ['2', '198.51.100.10']]) {
    const f = await fixture(t, { CWASH_TRUST_PROXY_HOPS: hops });
    const result = await (await f.request('/deployment-test/client', { headers })).json();
    assert.equal(result.ip, expectedIp);
    assert.equal(result.protocol, hops === '0' ? 'http' : 'https');
  }
});

test('hosted browser writes require the public origin while native writes need no Origin header', async t => {
  const f = await fixture(t, { CWASH_PUBLIC_ORIGIN: 'https://cwash.example.test', CWASH_TRUST_PROXY_HOPS: '1' }, true);
  const post = (headers = {}) => f.request('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: '{}' });
  // 400 is the login payload validation: the request passed the origin gate.
  assert.equal((await post()).status, 400);
  assert.equal((await post({ Origin: 'https://cwash.example.test' })).status, 400);
  for (const origin of [f.baseUrl, 'http://cwash.example.test', 'https://another.example.test', 'https://cwash.example.test/path', 'https://user@cwash.example.test', 'null']) {
    assert.equal((await post({ Origin: origin })).status, 403, origin);
  }
  assert.equal((await post({ Origin: 'https://cwash.example.test', 'Sec-Fetch-Site': 'cross-site' })).status, 403);
});

test('unconfigured local deployments retain same-host browser behavior', async t => {
  const f = await fixture(t);
  const response = await f.request('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: f.baseUrl }, body: '{}' });
  assert.equal(response.status, 400);
  assert.equal((await f.request('/api/admin/login', { method: 'POST', headers: { Origin: 'https://other.example.test' } })).status, 403);
});

test('readiness checks the actual database and reports failure without leaking details', async t => {
  const f = await fixture(t);
  const healthy = await f.request('/api/health');
  assert.equal(healthy.status, 200);
  assert.deepEqual(await healthy.json(), { status: 'ok' });
  f.closeDatabase();
  const unavailable = await f.request('/api/health');
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { status: 'unavailable' });
});
