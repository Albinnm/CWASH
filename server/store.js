import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const defaultSettings = {
  businessName: 'CWASH', preview: true,
  zipPrefixes: ['100', '101', '102', '103', '104', '11004', '11005', '111', '112', '113', '114', '116'],
  workingDays: [1, 2, 3, 4, 5, 6], startHour: 8, endHour: 18,
  slotInterval: 30, travelBuffer: 45, blockedDates: [], noticeHours: 12,
};
const services = [
  { id: 'interior', name: 'Interior reset', description: 'A fresh start for the space you spend time in.', price: 129, duration: 120, features: ['Thorough vacuum & surface cleaning', 'Seats, mats & upholstery care', 'Interior windows & finishing touches'] },
  { id: 'exterior', name: 'Exterior refresh', description: 'Bring back that clean-car feeling, from every angle.', price: 99, duration: 90, features: ['Careful hand wash & dry', 'Wheels & tire dressing', 'Paint-safe finish & exterior glass'] },
  { id: 'full', name: 'The full detail', description: 'The complete inside-and-out treatment.', price: 199, duration: 180, features: ['Everything in Interior reset', 'Everything in Exterior refresh', 'A complete, considered finish'] },
];
const vehicles = [
  { id: 'sedan', name: 'Sedan / coupe', surcharge: 0, durationExtra: 0 },
  { id: 'suv', name: 'SUV / crossover', surcharge: 30, durationExtra: 30 },
  { id: 'large', name: 'Large SUV / truck / van', surcharge: 50, durationExtra: 45 },
];

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function verifyPassword(password, hashed) {
  const [salt, key] = hashed.split(':');
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(key, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export function createStore({ dataDir = process.env.CWASH_DATA_DIR || './data', memory = false } = {}) {
  if (!memory) mkdirSync(resolve(dataDir), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(memory ? ':memory:' : join(resolve(dataDir), 'cwash.sqlite'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id = 1), value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS services (id TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS bookings (id TEXT PRIMARY KEY, reference TEXT UNIQUE NOT NULL, date TEXT NOT NULL, time TEXT NOT NULL, status TEXT NOT NULL, value TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS bookings_day ON bookings(date,status);
    CREATE TABLE IF NOT EXISTS booking_access (booking_id TEXT PRIMARY KEY REFERENCES bookings(id), token_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS admins (id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, admin_id INTEGER REFERENCES admins(id), csrf TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, first_name TEXT NOT NULL, last_name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS customer_sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE, csrf TEXT NOT NULL, expires INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('web','mobile')));
    CREATE TABLE IF NOT EXISTS booking_customers (booking_id TEXT PRIMARY KEY REFERENCES bookings(id), user_id TEXT NOT NULL REFERENCES customers(id));
    CREATE INDEX IF NOT EXISTS customer_booking_owner ON booking_customers(user_id);
    CREATE TABLE IF NOT EXISTS billing_customers (user_id TEXT NOT NULL REFERENCES customers(id), mode TEXT NOT NULL, stripe_customer_id TEXT UNIQUE NOT NULL, PRIMARY KEY(user_id,mode));
    CREATE TABLE IF NOT EXISTS billing_checkouts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES customers(id), mode TEXT NOT NULL, kind TEXT NOT NULL, booking_id TEXT REFERENCES bookings(id), session_id TEXT UNIQUE, state TEXT NOT NULL, request_json TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS billing_open_booking ON billing_checkouts(mode,booking_id) WHERE booking_id IS NOT NULL AND state IN ('creating','open');
    CREATE UNIQUE INDEX IF NOT EXISTS billing_open_membership ON billing_checkouts(mode,user_id) WHERE kind='membership' AND state IN ('creating','open');
    CREATE TABLE IF NOT EXISTS billing_payments (booking_id TEXT NOT NULL REFERENCES bookings(id), user_id TEXT NOT NULL REFERENCES customers(id), mode TEXT NOT NULL, status TEXT NOT NULL, amount INTEGER NOT NULL, currency TEXT NOT NULL, payment_intent_id TEXT UNIQUE, PRIMARY KEY(booking_id,mode));
    CREATE TABLE IF NOT EXISTS billing_memberships (subscription_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES customers(id), mode TEXT NOT NULL, status TEXT NOT NULL, cancel_at_period_end INTEGER NOT NULL, current_period_end INTEGER, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS billing_membership_entitlements (subscription_id TEXT PRIMARY KEY REFERENCES billing_memberships(subscription_id), paid_period_end INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS billing_events (id TEXT NOT NULL, mode TEXT NOT NULL, processed_at INTEGER NOT NULL, PRIMARY KEY(id,mode));
  `);
  db.prepare('INSERT OR IGNORE INTO settings (id,value) VALUES (1,?)').run(JSON.stringify(defaultSettings));
  for (const s of services) db.prepare('INSERT OR IGNORE INTO services (id,value) VALUES (?,?)').run(s.id, JSON.stringify(s));
  return {
    db,
    getCatalog() {
      return { services: db.prepare('SELECT value FROM services ORDER BY rowid').all().map(r => JSON.parse(r.value)), vehicles, settings: JSON.parse(db.prepare('SELECT value FROM settings WHERE id=1').get().value) };
    },
    createAdmin(email, password) {
      if (typeof password !== 'string' || password.length < 12 || password.length > 200) throw new Error('Use a password of 12–200 characters.');
      const parsed = z.string().trim().toLowerCase().pipe(z.email().max(200)).safeParse(email);
      if (!parsed.success) throw new Error('Enter a valid email address.');
      return db.prepare('INSERT INTO admins (email,password) VALUES (?,?)').run(parsed.data, hashPassword(password));
    },
    close() { db.close(); },
  };
}
