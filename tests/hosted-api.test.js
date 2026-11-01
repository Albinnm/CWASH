import test from 'node:test';
import assert from 'node:assert/strict';
import { publicOrigin, checkHostedApi } from '../scripts/check-hosted-api.js';

test('release preflight rejects local, insecure, and credential-bearing URLs', () => {
  for (const url of ['http://cwash.onrender.com','https://localhost','https://192.168.1.34:3000','https://172.18.0.1','https://[::1]','https://example.test','https://user:password@cwash.onrender.com','https://cwash.onrender.com/path','https://cwash.onrender.com?key=secret']) assert.throws(() => publicOrigin(url));
  assert.equal(publicOrigin('https://cwash.onrender.com/'), 'https://cwash.onrender.com');
});
test('release preflight checks the backend and requires a hosted owner account', async () => {
  const fixtures = {'/api/health':{status:'ok'},'/api/catalog':{services:[{}],vehicles:[{}],settings:{preview:true}},'/api/admin/session':{configured:false}};
  const fetcher = async url => ({ok:true,json:async()=>fixtures[new URL(url).pathname]});
  await assert.rejects(checkHostedApi('https://cwash.onrender.com',fetcher),/owner account/);
  fixtures['/api/admin/session'].configured = true;
  assert.deepEqual(await checkHostedApi('https://cwash.onrender.com',fetcher),{origin:'https://cwash.onrender.com',preview:true});
});
