import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { hashPassword, verifyPassword } from './store.js';
import { getSlots, validDate, TIMEZONE } from './scheduling.js';
import { deploymentSettings } from './deployment.js';
import { customerAuth } from './customers.js';
import { createBilling } from './billing.js';
import { createMembership, maintenanceService, MembershipError } from './membership.js';

const dateSchema = z.string().refine(validDate, 'Enter a valid date.');
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const text = (max) => z.string().trim().min(1).max(max);
const bookingSchema = z.object({
  coverage: z.enum(['standard', 'membership']).default('standard'),
  serviceId: text(50), vehicleId: text(50), date: dateSchema, time: timeSchema,
  firstName: text(80), lastName: text(80), email: z.email().max(200).transform(v => v.toLowerCase()),
  phone: z.string().trim().min(10).max(30).refine(v => /^\+?[\d\s().-]+$/.test(v) && v.replace(/\D/g, '').length >= 10, 'Enter a valid phone number.'),
  address: text(200), unit: z.string().trim().max(80).default(''), zip: z.string().regex(/^\d{5}$/),
  parking: z.enum(['driveway', 'private-lot', 'garage', 'street']), notes: z.string().trim().max(2000).default(''), consent: z.literal(true),
});
const settingsSchema = z.object({
  preview: z.boolean().optional(), zipPrefixes: z.array(z.string().regex(/^\d{3,5}$/)).min(1).max(200).optional(),
  workingDays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
  startHour: z.number().int().min(6).max(20).optional(), endHour: z.number().int().min(7).max(22).optional(),
  slotInterval: z.union([z.literal(15), z.literal(30), z.literal(60)]).optional(),
  travelBuffer: z.number().int().min(0).max(180).optional(), blockedDates: z.array(dateSchema).max(365).optional(), noticeHours: z.number().int().min(0).max(168).optional(),
}).strict();
const statusSchema = z.enum(['pending', 'confirmed', 'completed', 'cancelled']);
const tokenHash = token => createHash('sha256').update(token).digest('hex');
const dummyHash = hashPassword(randomBytes(32).toString('hex'));
function fail(res, status, error) { return res.status(status).json({ error }); }
function parse(schema, input, res) {
  const r = schema.safeParse(input);
  if (!r.success) { fail(res, 400, r.error.issues.map(i => `${i.path.join('.') || 'Request'}: ${i.message}`).join(' ')); return null; }
  return r.data;
}
function selection(store, serviceId, vehicleId, coverage = 'standard') {
  const c = store.getCatalog();
  if (coverage === 'membership' && !['full', 'maintenance'].includes(serviceId)) return null;
  const service = coverage === 'membership' && serviceId === 'maintenance' ? maintenanceService : c.services.find(s => s.id === serviceId), vehicle = c.vehicles.find(v => v.id === vehicleId);
  return service && vehicle ? { service, vehicle, total: coverage === 'membership' ? 0 : service.price + vehicle.surcharge, duration: service.duration + vehicle.durationExtra } : null;
}

export function createApp({ store, rateLimits = true, production = false, deployment = deploymentSettings({ production }), billingEnv = process.env, billingClient }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', deployment.trustProxyHops);
  app.use(helmet({ contentSecurityPolicy: production ? { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'], fontSrc: ["'self'", 'https://fonts.gstatic.com'], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], upgradeInsecureRequests: null } } : false, strictTransportSecurity: process.env.COOKIE_SECURE === 'true' ? undefined : false }));
  const billing = createBilling({ store, env: billingEnv, client: billingClient, rateLimits });
  const membership = createMembership({ store, getMembership: billing.getMembership });
  app.post('/api/billing/webhook', express.raw({ type: 'application/json', limit: '1mb' }), billing.webhook);
  app.use(express.json({ limit: '20kb' }));
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many login attempts. Try again in 15 minutes.' }, skip: () => !rateLimits });
  const bookingLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many requests. Please try again later.' }, skip: () => !rateLimits });
  const cookieOptions = { httpOnly: true, sameSite: 'strict', secure: process.env.COOKIE_SECURE === 'true', path: '/api/admin' };
  function session(req) {
    const raw = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('cwash_session='))?.slice('cwash_session='.length);
    if (!raw || !/^[a-f0-9]{64}$/.test(raw)) return null;
    return store.db.prepare('SELECT sessions.*, admins.email FROM sessions JOIN admins ON admins.id=sessions.admin_id WHERE token=? AND expires>?').get(tokenHash(raw), Date.now());
  }
  function auth(req, res, next) {
    const s = session(req);
    if (!s) return fail(res, 401, 'Please sign in to continue.');
    req.adminSession = s;
    if (!['GET','HEAD','OPTIONS'].includes(req.method)) {
      const csrf = req.headers['x-csrf-token'];
      if (typeof csrf !== 'string' || !/^[a-f0-9]{64}$/.test(csrf) || !timingSafeEqual(Buffer.from(csrf), Buffer.from(s.csrf))) return fail(res, 403, 'Your session could not be verified. Sign in again.');
    }
    next();
  }
  // Reject cross-site mutations, including login, in addition to CSRF on admin writes.
  app.use('/api', (req, res, next) => {
    if (!['GET','HEAD','OPTIONS'].includes(req.method)) {
      if (req.headers['sec-fetch-site'] === 'cross-site') return fail(res, 403, 'Cross-site requests are not allowed.');
      if (req.headers.origin) {
        try {
          const origin = new URL(req.headers.origin);
          if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== req.headers.origin) return fail(res, 403, 'Invalid request origin.');
          if (deployment.origin ? origin.origin !== deployment.origin : origin.host !== req.headers.host) return fail(res, 403, 'Cross-site requests are not allowed.');
        }
        catch { return fail(res, 403, 'Invalid request origin.'); }
      }
    }
    next();
  });
  const customers = customerAuth({ store, rateLimits });
  app.use('/api/customer', billing.customerRouter(customers.authorize, membership.benefits));
  app.use('/api/customer', customers.router);
  app.get('/api/health', (_req, res) => {
    try { store.db.prepare('SELECT 1 AS ready').get(); res.json({ status: 'ok' }); }
    catch { res.status(503).json({ status: 'unavailable' }); }
  });
  app.get('/api/catalog', (_req, res) => res.json({ ...store.getCatalog(), membershipService: maintenanceService }));
  app.get('/api/availability', customers.optionalBookingAuth, (req, res) => {
    const input = parse(z.object({ date: dateSchema, serviceId: text(50), vehicleId: text(50), coverage: z.enum(['standard','membership']).default('standard') }), req.query, res);
    if (!input) return;
    const selected = selection(store, input.serviceId, input.vehicleId, input.coverage);
    if (!selected) return fail(res, 400, 'Choose a valid service and vehicle.');
    if (input.coverage === 'membership' && !req.customer) return fail(res,401,'Sign in to use your membership.');
    if (input.coverage === 'membership' && !membership.benefits(req.customer.user.id).active) return fail(res,403,'An active paid membership is required for included visits.');
    let slots = getSlots(store, { date: input.date, duration: selected.duration });
    if (input.coverage === 'membership') slots = slots.filter(time => {
      try { membership.validateReservation(req.customer.user.id, { ...input, time }); return true; }
      catch (e) { if (e instanceof MembershipError) return false; throw e; }
    });
    res.json({ slots, timezone: TIMEZONE });
  });
  app.post('/api/bookings', bookingLimiter, customers.optionalBookingAuth, (req, res) => {
    const input = parse(bookingSchema, req.customer ? { ...req.body, email:req.customer.user.email } : req.body, res); if (!input) return;
    const selected = selection(store, input.serviceId, input.vehicleId, input.coverage);
    if (!selected) return fail(res, 400, 'Choose a valid service and vehicle.');
    if (!store.getCatalog().settings.zipPrefixes.some(prefix => input.zip.startsWith(prefix))) return fail(res, 400, 'This ZIP code is outside our current service area.');
    if (!getSlots(store, { date: input.date, duration: selected.duration }).includes(input.time)) return fail(res, 409, 'That appointment is no longer available. Please choose another time.');
    const b = { ...input, id: randomUUID(), reference: `CW-${randomBytes(5).toString('hex').toUpperCase()}`, status: 'pending', serviceName: selected.service.name, vehicleName: selected.vehicle.name, total: selected.total, duration: selected.duration, createdAt: new Date().toISOString() };
    if (input.coverage === 'membership') {
      membership.validateReservation(req.customer?.user.id, b);
      b.membershipIncluded = true;
    }
    const accessToken = req.customer ? null : randomBytes(32).toString('hex');
    store.db.exec('BEGIN IMMEDIATE');
    try {
      store.db.prepare('INSERT INTO bookings (id,reference,date,time,status,value) VALUES (?,?,?,?,?,?)').run(b.id, b.reference, b.date, b.time, b.status, JSON.stringify(b));
      if (accessToken) store.db.prepare('INSERT INTO booking_access (booking_id,token_hash) VALUES (?,?)').run(b.id, tokenHash(accessToken));
      if (req.customer) store.db.prepare('INSERT INTO booking_customers (booking_id,user_id) VALUES (?,?)').run(b.id,req.customer.user.id);
      if (b.membershipIncluded) membership.reserve(req.customer.user.id, b);
      store.db.exec('COMMIT');
    } catch (error) { store.db.exec('ROLLBACK'); throw error; }
    res.status(201).json({ booking: { reference: b.reference, status: b.status, serviceName: b.serviceName, vehicleName: b.vehicleName, date: b.date, time: b.time, total: b.total, duration: b.duration, coverage: b.coverage, membershipIncluded: !!b.membershipIncluded, ...(accessToken ? {accessToken} : {}) } });
  });
  app.get('/api/bookings/:reference', (req, res) => {
    const token = req.headers.authorization?.replace(/^Bearer /, '');
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return fail(res, 401, 'A valid booking access key is required.');
    const row = store.db.prepare('SELECT bookings.value FROM bookings JOIN booking_access ON bookings.id=booking_access.booking_id WHERE bookings.reference=? AND booking_access.token_hash=?').get(req.params.reference, tokenHash(token));
    if (!row) return fail(res, 401, 'A valid booking access key is required.');
    const b = JSON.parse(row.value);
    res.json({ booking: { reference: b.reference, status: b.status, serviceName: b.serviceName, vehicleName: b.vehicleName, date: b.date, time: b.time, total: b.total, duration: b.duration } });
  });
  app.get('/api/admin/session', (req, res) => {
    const s = session(req);
    res.json({ authenticated: !!s, configured: !!store.db.prepare('SELECT id FROM admins LIMIT 1').get(), ...(s ? { admin: { email: s.email }, csrfToken: s.csrf } : {}) });
  });
  app.post('/api/admin/login', loginLimiter, (req, res) => {
    const input = parse(z.object({ email: z.email().max(200), password: z.string().min(1).max(200) }), req.body, res); if (!input) return;
    const admin = store.db.prepare('SELECT * FROM admins WHERE email=?').get(input.email.toLowerCase().trim());
    const valid = verifyPassword(input.password, admin?.password || dummyHash);
    if (!admin || !valid) return fail(res, 401, 'Email or password is incorrect.');
    store.db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());
    const old = session(req); if (old) store.db.prepare('DELETE FROM sessions WHERE token=?').run(old.token);
    const token = randomBytes(32).toString('hex'), csrf = randomBytes(32).toString('hex');
    store.db.prepare('INSERT INTO sessions (token,admin_id,csrf,expires) VALUES (?,?,?,?)').run(tokenHash(token), admin.id, csrf, Date.now() + 8 * 3600000);
    res.cookie('cwash_session', token, { ...cookieOptions, maxAge: 8 * 3600000 });
    res.json({ admin: { email: admin.email }, csrfToken: csrf });
  });
  app.use('/api/admin', auth);
  app.post('/api/admin/logout', (req, res) => {
    store.db.prepare('DELETE FROM sessions WHERE token=?').run(req.adminSession.token);
    res.clearCookie('cwash_session', cookieOptions); res.json({ ok: true });
  });
  app.get('/api/admin/billing', billing.adminSummary);
  app.get('/api/admin/bookings', (_req, res) => res.json({ bookings: store.db.prepare('SELECT value FROM bookings ORDER BY date,time').all().map(r => JSON.parse(r.value)) }));
  app.patch('/api/admin/bookings/:id', async (req, res) => {
    const input = parse(z.object({ status: statusSchema.optional(), date: dateSchema.optional(), time: timeSchema.optional() }).strict().refine(v => Object.keys(v).length > 0, 'No changes provided.'), req.body, res); if (!input) return;
    try { await billing.bookingChange(req.params.id, input.status === 'cancelled', () => {
    store.db.exec('BEGIN IMMEDIATE');
    try {
      const row = store.db.prepare('SELECT value FROM bookings WHERE id=?').get(req.params.id);
      if (!row) { store.db.exec('ROLLBACK'); return fail(res, 404, 'Booking not found.'); }
      const old = JSON.parse(row.value), b = { ...old, ...input };
      const transitions = { pending: ['pending','confirmed','cancelled'], confirmed: ['confirmed','completed','cancelled'], completed: ['completed'], cancelled: ['cancelled'] };
      if (!transitions[old.status].includes(b.status)) { store.db.exec('ROLLBACK'); return fail(res, 400, 'This status change is not allowed.'); }
      const rescheduled = b.date !== old.date || b.time !== old.time;
      if (rescheduled && ['completed','cancelled'].includes(b.status)) { store.db.exec('ROLLBACK'); return fail(res, 400, 'Completed or cancelled bookings cannot be rescheduled.'); }
      if ((b.status === 'confirmed' && old.status !== 'confirmed') || rescheduled) {
        if (!getSlots(store, { date: b.date, duration: b.duration, excludeId: b.id, noticeHours: 0 }).includes(b.time)) { store.db.exec('ROLLBACK'); return fail(res, 409, 'This time conflicts with availability or another confirmed appointment.'); }
      }
      membership.validateAdminChange(old, b);
      b.updatedAt = new Date().toISOString();
      store.db.prepare('UPDATE bookings SET date=?,time=?,status=?,value=? WHERE id=?').run(b.date,b.time,b.status,JSON.stringify(b),b.id);
      store.db.exec('COMMIT'); res.json({ booking: b });
    } catch (e) { store.db.exec('ROLLBACK'); throw e; }
    }); } catch (e) { if (e.billingStatus) return fail(res,e.billingStatus,e.message); throw e; }
  });
  app.put('/api/admin/settings', (req, res) => {
    const input = parse(settingsSchema, req.body, res); if (!input) return;
    const settings = { ...store.getCatalog().settings, ...input };
    if (settings.startHour >= settings.endHour) return fail(res, 400, 'Closing time must be after opening time.');
    store.db.prepare('UPDATE settings SET value=? WHERE id=1').run(JSON.stringify(settings)); res.json({ settings });
  });
  app.put('/api/admin/services/:id', (req, res) => {
    const input = parse(z.object({ price: z.number().min(1).max(10000).refine(v => Math.abs(v * 100 - Math.round(v * 100)) < 0.00001, 'Use at most two decimal places.').optional(), duration: z.number().int().min(30).max(600).optional() }).strict().refine(v => Object.keys(v).length > 0), req.body, res); if (!input) return;
    const service = store.getCatalog().services.find(s => s.id === req.params.id);
    if (!service) return fail(res, 404, 'Service not found.');
    const updated = { ...service, ...input }; store.db.prepare('UPDATE services SET value=? WHERE id=?').run(JSON.stringify(updated), updated.id); res.json({ service: updated });
  });
  app.use('/api', (_req, res) => fail(res, 404, 'API endpoint not found.'));
  app.use((err, _req, res, _next) => {
    if (err instanceof MembershipError) return fail(res, err.status, err.message);
    if (err.type === 'entity.parse.failed') return fail(res, 400, 'Invalid JSON request.');
    if (err.type === 'entity.too.large') return fail(res, 413, 'Request too large.');
    console.error('Request failed:', err.name);
    return fail(res, 500, 'Something went wrong. Please try again.');
  });
  return app;
}
