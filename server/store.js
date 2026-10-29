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
