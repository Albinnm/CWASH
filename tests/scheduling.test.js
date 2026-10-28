import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../server/store.js';
import { dateTimeEpoch, getSlots, validDate } from '../server/scheduling.js';

test('New York appointments use the correct winter, summer, and transition-day UTC offsets', () => {
  for (const [date, expected] of [
    ['2026-01-15', '2026-01-15T14:00:00.000Z'],
    ['2026-07-15', '2026-07-15T13:00:00.000Z'],
    ['2026-03-08', '2026-03-08T13:00:00.000Z'],
    ['2026-11-01', '2026-11-01T14:00:00.000Z'],
  ]) {
    assert.equal(new Date(dateTimeEpoch(date, '09:00')).toISOString(), expected, date);
  }
});

test('the spring daylight-saving gap cannot become a different appointment time', () => {
  assert.ok(Number.isNaN(dateTimeEpoch('2026-03-08', '02:30')));
  assert.equal(new Date(dateTimeEpoch('2026-03-08', '03:30')).toISOString(), '2026-03-08T07:30:00.000Z');
});

test('invalid calendar dates and unsupported early years are rejected without conversion errors', t => {
  const store = createStore({ memory: true });
  t.after(() => store.close());
  for (const date of ['0000-01-01', '0001-01-01', '0099-01-01', '0999-01-01', '1999-01-01', '2026-02-29', '2026-04-31', '2026-13-01', '2026-1-01']) {
    assert.equal(validDate(date), false, date);
    assert.deepEqual(getSlots(store, { date, duration: 90 }), [], date);
  }
  assert.equal(validDate('2000-02-29'), true);
  assert.equal(validDate('2028-02-29'), true);
});

test('admin notice override preserves the same 90-day horizon as public availability', t => {
  const store = createStore({ memory: true });
  t.after(() => store.close());
  const { settings } = store.getCatalog();
  store.db.prepare('UPDATE settings SET value=? WHERE id=1').run(JSON.stringify({ ...settings, workingDays: [0, 1, 2, 3, 4, 5, 6] }));
  // Exactly 90 days later is April 5 at 09:00 New York time, after DST begins.
  const now = Date.parse('2026-01-05T13:00:00Z');
  const selection = { date: '2026-04-05', duration: 90, now };
  const publicSlots = getSlots(store, selection);
  const adminSlots = getSlots(store, { ...selection, noticeHours: 0 });
  assert.ok(publicSlots.includes('08:30'));
  assert.ok(publicSlots.includes('09:00'));
  assert.ok(!publicSlots.includes('09:30'));
  assert.deepEqual(adminSlots, publicSlots);
});

test('admin can waive advance notice without offering appointments in the past', t => {
  const store = createStore({ memory: true });
  t.after(() => store.close());
  const now = Date.parse('2026-01-05T14:15:00Z'); // 09:15 in New York.
  const selection = { date: '2026-01-05', duration: 90, now };
  assert.deepEqual(getSlots(store, selection), []);
  const adminSlots = getSlots(store, { ...selection, noticeHours: 0 });
  assert.ok(adminSlots.includes('09:30'));
  assert.ok(!adminSlots.includes('09:00'));
});
