// Isolated browser-test server. This account only exists in this in-memory fixture.
import express from 'express';
import { resolve } from 'node:path';
import { createStore } from '../server/store.js';
import { createApp } from '../server/app.js';
const store = createStore({ memory: true });
store.createAdmin('browser@example.test', 'Browser-fixture-only-42!');
const app = createApp({ store, rateLimits: false, production: true });
app.use(express.static(resolve('dist')));
app.get(['/', '/admin', '/account'], (_req, res) => res.sendFile(resolve('dist/index.html')));
const server = app.listen(3100, '127.0.0.1');
process.on('SIGTERM', () => { server.close(); store.close(); process.exit(0); });
