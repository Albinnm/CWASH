// Optional, first-run-only account creation for a hosted environment.
// Values must come from the hosting provider's private environment settings.
export function bootstrapAdmin(store, {
  email = process.env.CWASH_INITIAL_ADMIN_EMAIL,
  password = process.env.CWASH_INITIAL_ADMIN_PASSWORD,
} = {}) {
  if (store.db.prepare('SELECT id FROM admins LIMIT 1').get()) return 'existing';
  if (!email && !password) return 'unconfigured';
  if (!email || !password) throw new Error('Provide both initial admin settings, or remove both and use npm run admin:create.');
  store.createAdmin(email, password);
  return 'created';
}
