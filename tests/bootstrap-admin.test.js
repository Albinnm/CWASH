import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, verifyPassword } from '../server/store.js';
import { bootstrapAdmin } from '../server/bootstrap-admin.js';

test('hosted bootstrap creates a hashed account once and never resets it on restart', t => {
  const store = createStore({ memory: true }); t.after(() => store.close());
  const password = 'Test-only-bootstrap-42!';
  assert.equal(bootstrapAdmin(store, {email:'owner@example.test',password}), 'created');
  const first = store.db.prepare('SELECT * FROM admins').get();
  assert.notEqual(first.password, password);
  assert.ok(verifyPassword(password, first.password));
  assert.equal(bootstrapAdmin(store, {email:'another@example.test',password:'Other-test-password-42!'}), 'existing');
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM admins').get().count, 1);
  assert.deepEqual(store.db.prepare('SELECT * FROM admins').get(), first);
  assert.equal(bootstrapAdmin(store, {email:'',password:''}), 'existing');
});
test('hosted bootstrap fails on partial or invalid input without creating an account', t => {
  const store = createStore({memory:true}); t.after(() => store.close());
  assert.equal(bootstrapAdmin(store, {email:'',password:''}), 'unconfigured');
  assert.throws(() => bootstrapAdmin(store, {email:'owner@example.test',password:''}), /both/);
  assert.throws(() => bootstrapAdmin(store, {email:'owner@example.test',password:'short'}), /password/);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM admins').get().count, 0);
});
