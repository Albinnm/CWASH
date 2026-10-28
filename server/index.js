import express from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createStore } from './store.js';
import { createApp } from './app.js';

if (existsSync('.env')) process.loadEnvFile('.env');
const production = process.argv.includes('--production');
const store = createStore();
const app = createApp({ store, production });
let vite;
if (production) {
  if (!existsSync('dist/index.html')) throw new Error('Run npm run build before npm start.');
  app.use(express.static(resolve('dist')));
  app.get(['/', '/admin', '/admin/*path'], (_req, res) => res.sendFile(resolve('dist/index.html')));
} else {
  const { createServer } = await import('vite');
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'spa' });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT || 3000), host = process.env.HOST || '127.0.0.1';
const server = app.listen(port, host, () => console.log(`CWASH ${production ? 'production' : 'development'} server listening on ${host}:${port}`));
async function close() { server.close(); await vite?.close(); store.close(); process.exit(0); }
process.on('SIGTERM', close); process.on('SIGINT', close);
