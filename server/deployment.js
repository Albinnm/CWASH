// Deployment values are explicit: never trust arbitrary forwarded headers by default.
export function deploymentSettings({ production = false, env = process.env } = {}) {
  const rawHops = env.CWASH_TRUST_PROXY_HOPS ?? '0';
  if (typeof rawHops !== 'string' || !/^[0-5]$/.test(rawHops.trim())) {
    throw new Error('CWASH_TRUST_PROXY_HOPS must be an integer from 0 to 5 for the verified proxy topology.');
  }
  const trustProxyHops = Number(rawHops.trim());
  const rawOrigin = env.CWASH_PUBLIC_ORIGIN ?? env.RENDER_EXTERNAL_URL;
  if (rawOrigin === undefined) return { origin: null, trustProxyHops };

  let parsed;
  try {
    if (typeof rawOrigin !== 'string' || !/^https?:\/\//i.test(rawOrigin.trim()) || /[\\?#]/.test(rawOrigin)) throw new Error();
    parsed = new URL(rawOrigin.trim());
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/') throw new Error();
    if (production && parsed.protocol !== 'https:') throw new Error();
  } catch {
    throw new Error(`CWASH_PUBLIC_ORIGIN (or RENDER_EXTERNAL_URL) must be a valid ${production ? 'HTTPS' : 'HTTP or HTTPS'} origin without a path, query, fragment, or credentials.`);
  }
  return { origin: parsed.origin, trustProxyHops };
}
