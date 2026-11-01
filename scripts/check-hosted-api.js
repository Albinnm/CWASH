import { pathToFileURL } from 'node:url';

export function publicOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Enter the HTTPS address of your deployed CWASH server.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Use an HTTPS origin without a path, credentials, query, or fragment.');
  }
  if (/^(localhost|127\.|0\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[|169\.254\.)/.test(url.hostname) || /\.(local|localhost|test|invalid|example)$/.test(url.hostname)) {
    throw new Error('Use your public hosting address, not a local or example address.');
  }
  return url.origin;
}

export async function checkHostedApi(value, fetcher = fetch) {
  const origin = publicOrigin(value);
  async function read(path) {
    const response = await fetcher(`${origin}${path}`, { signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}.`);
    return response.json();
  }
  const health = await read('/api/health');
  if (health.status !== 'ok') throw new Error('The hosted database/API is not ready.');
  const catalog = await read('/api/catalog');
  if (!Array.isArray(catalog.services) || !catalog.services.length || !Array.isArray(catalog.vehicles) || !catalog.vehicles.length) throw new Error('The service catalog is missing.');
  const session = await read('/api/admin/session');
  if (session.configured !== true) throw new Error('Create the hosted owner account before building the iPhone app.');
  return { origin, preview: catalog.settings?.preview !== false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await checkHostedApi(process.argv[2]);
    console.log(`CWASH backend is responding at ${result.origin}. Owner account and catalog are configured.`);
    console.log(result.preview ? 'Preview pricing is enabled: suitable for internal testing, not customer launch.' : 'Preview pricing notice is disabled.');
    console.log('Use this same HTTPS address as EXPO_PUBLIC_API_URL in the Expo production environment.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
