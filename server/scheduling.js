export const TIMEZONE = 'America/New_York';
const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export function nyParts(timestamp = Date.now()) {
  return Object.fromEntries(formatter.formatToParts(new Date(timestamp)).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
}
export function validDate(date) {
  if (!/^[2-9]\d{3}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(`${date}T12:00:00Z`);
  return Number.isFinite(+d) && d.toISOString().slice(0, 10) === date;
}
export function minutes(time) { const [h, m] = time.split(':').map(Number); return h * 60 + m; }
export function dateTimeEpoch(date, time) {
  // Convert NY wall time to an instant, using Intl for the applicable DST offset.
  const target = Date.parse(`${date}T${time}:00Z`);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = nyParts(guess);
    const represented = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`);
    guess += target - represented;
  }
  const p = nyParts(guess);
  return `${p.year}-${p.month}-${p.day}` === date && `${p.hour}:${p.minute}` === time ? guess : NaN;
}
export function getSlots(store, { date, duration, excludeId, now = Date.now(), noticeHours }) {
  if (!validDate(date)) return [];
  const { settings } = store.getCatalog();
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (!settings.workingDays.includes(day) || settings.blockedDates.includes(date)) return [];
  const end = settings.endHour * 60;
  const occupied = store.db.prepare("SELECT value FROM bookings WHERE date=? AND status IN ('confirmed','completed')").all(date).map(r => JSON.parse(r.value)).filter(b => b.id !== excludeId);
  const slots = [];
  for (let start = settings.startHour * 60; start + duration <= end; start += settings.slotInterval) {
    const time = `${Math.floor(start / 60)}`.padStart(2, '0') + ':' + `${start % 60}`.padStart(2, '0');
    const instant = dateTimeEpoch(date, time);
    if (!Number.isFinite(instant) || instant < now + (noticeHours ?? settings.noticeHours) * 3600000 || instant > now + 90 * 86400000) continue;
    const overlap = occupied.some(b => start < minutes(b.time) + b.duration + settings.travelBuffer && start + duration + settings.travelBuffer > minutes(b.time));
    if (!overlap) slots.push(time);
  }
  return slots;
}
