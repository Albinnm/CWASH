import { dateTimeEpoch, validDate } from './scheduling.js';

const WEEK = 7 * 86400000;
const RESERVED = new Set(['pending', 'confirmed', 'completed']);
export const maintenanceService = Object.freeze({
  id: 'maintenance', name: 'Weekly maintenance', price: 0, duration: 60,
  description: 'Maintenance visit included with an active membership.',
  features: ['Routine upkeep for members'], membershipOnly: true,
});
export class MembershipError extends Error {
  constructor(message, status = 409) { super(message); this.name = 'MembershipError'; this.status = status; }
}
const reject = (message, status) => { throw new MembershipError(message, status); };
// Entitlements repeat by New York calendar days, preserving weekly appointment
// times when daylight saving changes the actual number of elapsed hours.
const wallTime = booking => Date.parse(`${booking.date}T${booking.time}:00Z`);
function appointment(booking) {
  if (!validDate(booking.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(booking.time)) reject('Choose a valid appointment date and time.', 400);
  const value = dateTimeEpoch(booking.date, booking.time);
  if (!Number.isFinite(value)) reject('Choose a valid New York appointment time.', 400);
  return value;
}

export function createMembership({ store, getMembership, clock = () => Date.now() }) {
  const db = store.db;
  db.exec(`
    CREATE TABLE IF NOT EXISTS membership_visits (
      booking_id TEXT PRIMARY KEY REFERENCES bookings(id),
      user_id TEXT NOT NULL REFERENCES customers(id),
      mode TEXT NOT NULL CHECK(mode IN ('test','live')),
      kind TEXT NOT NULL CHECK(kind IN ('full','maintenance'))
    );
    CREATE INDEX IF NOT EXISTS membership_visits_customer ON membership_visits(user_id,mode);
  `);
  function snapshot(userId) {
    const membership = userId ? getMembership(userId) : null;
    const periodEnd = Number(membership?.currentPeriodEnd);
    const mode = membership?.mode;
    return {
      mode, periodEnd: Number.isFinite(periodEnd) && periodEnd > 0 ? periodEnd : null,
      active: membership?.status === 'active' && membership.entitlementPaid === true && ['test','live'].includes(mode) && periodEnd * 1000 > clock(),
    };
  }
  function visits(userId, mode, excludeBookingId) {
    return db.prepare(`SELECT b.value,v.kind FROM membership_visits v JOIN bookings b ON b.id=v.booking_id
      WHERE v.user_id=? AND v.mode=? AND b.status IN ('pending','confirmed','completed')`).all(userId, mode)
      .map(row => ({ ...JSON.parse(row.value), kind: row.kind })).filter(b => b.id !== excludeBookingId);
  }
  function benefits(userId) {
    const membership = snapshot(userId);
    const full = membership.mode ? visits(userId, membership.mode).find(b => b.kind === 'full') : null;
    return {
      active: membership.active,
      fullDetailAvailable: membership.active && !full,
      maintenanceAvailable: membership.active && !!full,
      periodEnd: membership.periodEnd,
    };
  }
  function validateSpacing(booking, existing, kind) {
    if (kind === 'full') {
      if (existing.some(b => b.kind === 'full')) reject('Your membership includes one introductory full detail. Book additional details as a separate paid service.');
      if (existing.some(b => b.kind === 'maintenance' && wallTime(b) - wallTime(booking) < WEEK)) reject('This full detail must be at least seven days before your maintenance visits. Reschedule or cancel those requests first.');
    } else {
      const full = existing.find(b => b.kind === 'full');
      if (!full) reject('Request your introductory full detail before booking weekly maintenance.');
      if (wallTime(booking) - wallTime(full) < WEEK) reject('Your first maintenance visit must be at least seven days after your introductory full detail.');
      if (existing.some(b => b.kind === 'maintenance' && Math.abs(wallTime(b) - wallTime(booking)) < WEEK)) reject('Your membership includes one maintenance visit every seven days. Choose a date at least seven days from your other maintenance visits.');
    }
  }
  function validateReservation(userId, booking) {
    if (!userId) reject('Sign in to use your membership.', 401);
    if (booking.coverage !== 'membership' || !['full','maintenance'].includes(booking.serviceId)) reject('This service is not included in the membership.', 400);
    const membership = snapshot(userId);
    if (!membership.active) reject('An active paid membership is required for included visits.', 403);
    const start = appointment(booking);
    if (start <= clock()) reject('Included visits must be scheduled in the future.');
    if (start >= membership.periodEnd * 1000) reject('Choose a visit within your current paid membership period. More dates become available after renewal.');
    validateSpacing(booking, visits(userId, membership.mode, booking.id), booking.serviceId);
    return { kind: booking.serviceId, mode: membership.mode };
  }
  function reserve(userId, booking) {
    // The caller inserts the booking and reserves this allowance in one SQLite
    // transaction. Pending requests count, so parallel requests cannot reuse it.
    const { kind, mode } = validateReservation(userId, booking);
    if (booking.total !== 0 || booking.membershipIncluded !== true) reject('Included visits must have a zero balance and a verified membership marker.', 400);
    db.prepare('INSERT INTO membership_visits(booking_id,user_id,mode,kind) VALUES (?,?,?,?)').run(booking.id,userId,mode,kind);
  }
  function validateAdminChange(oldBooking, nextBooking) {
    const link = db.prepare('SELECT user_id,mode,kind FROM membership_visits WHERE booking_id=?').get(oldBooking.id);
    if (!link) return;
    const existing = visits(link.user_id, link.mode, oldBooking.id);
    if (nextBooking.status === 'cancelled') {
      if (link.kind === 'full' && existing.some(b => b.kind === 'maintenance')) reject('Cancel the dependent membership maintenance visits before cancelling the introductory full detail.');
      return;
    }
    if (!RESERVED.has(nextBooking.status)) return;
    const rescheduled = nextBooking.date !== oldBooking.date || nextBooking.time !== oldBooking.time;
    if (rescheduled || (nextBooking.status === 'confirmed' && oldBooking.status === 'pending')) {
      const membership = snapshot(link.user_id);
      if (membership.mode !== link.mode) reject('This visit belongs to a different payment environment.');
      validateReservation(link.user_id, { ...nextBooking, coverage: 'membership', serviceId: link.kind });
    }
  }
  return { benefits, validateReservation, reserve, validateAdminChange };
}
