// test/site.test.js
// Frontend display helpers and the site-data build (windowing + trimming).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatCountyDate, formatDateTime, pacificDay, pacificMidnightMs,
  aboutDuration, formatHeight, formatMoney,
} from '../frontend/src/format.js';
import { buildRoster, WINDOW_DAYS } from '../scripts/build-site-data.js';

test('formatCountyDate never shifts the day', () => {
  assert.equal(formatCountyDate('2026-04-30'), '04/30/2026');
  assert.equal(formatCountyDate('2026-01-01'), '01/01/2026');
  assert.equal(formatCountyDate(null), '');
  assert.equal(formatCountyDate('04/30/2026'), '');
});

test('timestamps display in Pacific regardless of offset', () => {
  assert.match(formatDateTime('2026-10-10T13:10:45-07:00'), /^10\/10\/2026, 1:10\sPM$/);
  assert.match(formatDateTime('2026-10-10T20:10:45Z'), /^10\/10\/2026, 1:10\sPM$/);
  assert.equal(pacificDay('2026-10-11T06:30:00Z'), '2026-10-10');
  assert.equal(formatDateTime('garbage'), '');
});

test('pacificMidnightMs handles both DST offsets', () => {
  assert.equal(new Date(pacificMidnightMs('2026-01-15')).toISOString(), '2026-01-15T08:00:00.000Z');
  assert.equal(new Date(pacificMidnightMs('2026-07-04')).toISOString(), '2026-07-04T07:00:00.000Z');
  assert.equal(new Date(pacificMidnightMs('2026-03-08')).toISOString(), '2026-03-08T08:00:00.000Z');
  assert.equal(new Date(pacificMidnightMs('2026-11-01')).toISOString(), '2026-11-01T07:00:00.000Z');
  assert.equal(pacificMidnightMs(''), null);
});

test('aboutDuration is always labeled approximate', () => {
  assert.equal(aboutDuration('2026-10-01', '2026-10-03T12:00:00-07:00'), 'about 3 days');
  assert.equal(aboutDuration('2026-10-10', '2026-10-10T13:00:00-07:00'), 'about 1 day or less');
  assert.equal(aboutDuration('2026-10-01', '2026-10-02T01:00:00-07:00'), 'about 1 day');
  assert.equal(aboutDuration('2026-10-05', '2026-10-03T12:00:00-07:00'), null);
  assert.equal(aboutDuration(null, '2026-10-03T12:00:00-07:00'), null);
});

test('formatHeight and formatMoney', () => {
  assert.equal(formatHeight('509'), `5'9"`);
  assert.equal(formatHeight('603'), `6'3"`);
  assert.equal(formatHeight('511'), `5'11"`);
  assert.equal(formatHeight(null), null);
  assert.equal(formatMoney(500000), '$500,000');
  assert.equal(formatMoney(0), '$0');
  assert.equal(formatMoney(null), null);
});

test('site roster: in custody + recent releases only, trimmed fields', () => {
  const now = new Date('2026-10-10T12:00:00-07:00');
  const old = new Date(now.getTime() - (WINDOW_DAYS + 1) * 864e5).toISOString();
  const recent = new Date(now.getTime() - 5 * 864e5).toISOString();
  const charge = { violation: 'X', level: 'B', bondAmount: 5, courtCase: '26-1-00001-35', warrantNumber: 'W1', caseNumber: '1', obts: 'O' };
  const log = [
    { bookingNumber: 'B1', name: 'A', status: 'in_custody', inmateId: 'A1', charges: [charge] },
    { bookingNumber: 'B2', name: 'B', status: 'released', releasedAt: recent, charges: [] },
    { bookingNumber: 'B3', name: 'C', status: 'released', releasedAt: old, charges: [] },
  ];
  const r = buildRoster(log, now);
  assert.deepEqual(r.map(e => e.bookingNumber), ['B1', 'B2']);
  assert.equal(r[0].inmateId, undefined, 'inmate ID not served');
  assert.deepEqual(r[0].charges[0], { violation: 'X', level: 'B', bondAmount: 5 }, 'court/warrant/case numbers not served');
});
