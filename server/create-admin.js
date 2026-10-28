import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { existsSync } from 'node:fs';
import { createStore } from './store.js';

if (existsSync('.env')) process.loadEnvFile('.env');
let muted = false;
const output = new Writable({ write(chunk, encoding, callback) { if (!muted) process.stdout.write(chunk, encoding); callback(); } });
output.isTTY = process.stdout.isTTY;
const rl = createInterface({ input: process.stdin, output, terminal: !!process.stdin.isTTY });
const store = createStore();
try {
  const email = (await rl.question('Admin email: ')).trim();
  process.stdout.write('Password (12+ characters, hidden): '); muted = true;
  const password = await rl.question(''); muted = false; process.stdout.write('\n');
  process.stdout.write('Repeat password (hidden): '); muted = true;
  const confirm = await rl.question(''); muted = false; process.stdout.write('\n');
  if (password !== confirm) throw new Error('Passwords do not match.');
  store.createAdmin(email, password);
  console.log('Admin account created. You can now sign in at /admin.');
} catch (error) {
  muted = false;
  console.error(error.code?.startsWith('ERR_SQLITE') ? 'That email already has an account, or the database could not be updated.' : error.message);
  process.exitCode = 1;
} finally { rl.close(); store.close(); }
