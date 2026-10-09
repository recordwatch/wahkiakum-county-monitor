// stats.js
// Aggregations over change_log.json. Rules (see CLAUDE.md):
//   - Counts only. No function here returns a name, booking number or inmate ID.
//   - Every stat carries its n. buildStats adds the date range and "as of".
//   - Durations start at the county booking date, never firstSeen.
//   - Every release here is detected (we noticed them gone), so every duration
//     is approximate and is labeled that way.

import { normalizeRace, normalizeSex, getCrimeType, resolveEffectiveCategory } from './chargeMap.js';
import { toPacificISO } from './utils.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
const mean = arr => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null);
const round1 = v => (v === null ? null : +v.toFixed(1));

function breakdown(items, keyFn) {
  const counts = {};
  items.forEach(it => { const k = keyFn(it) || 'Unknown'; counts[k] = (counts[k] || 0) + 1; });
  const n = items.length;
  return {
    n,
    rows: Object.entries(counts).sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({ label, count, pct: n ? +((count / n) * 100).toFixed(1) : 0 })),
  };
}

// Count each category once per booking.
function perBookingCategories(log, catFn) {
  const withCharges = log.filter(e => (e.charges || []).length);
  const counts = {};
  withCharges.forEach(e => {
    new Set(e.charges.map(catFn)).forEach(c => { counts[c] = (counts[c] || 0) + 1; });
  });
  return {
    n: withCharges.length,
    unit: 'bookings',
    rows: Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count })),
  };
}

// County booking date is date-only. Anchor it at midnight Pacific; for a
// stay that started late in the day this overstates the stay by up to 24h.
export function pacificMidnightMs(isoDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate || '')) return null;
  for (const off of ['-08:00', '-07:00']) {
    const t = Date.parse(`${isoDate}T00:00:00${off}`);
    if (!isNaN(t) && toPacificISO(new Date(t)) === `${isoDate}T00:00:00${off}`) return t;
  }
  return null;
}

export function stayDays(e) {
  if (e.status !== 'released' || !e.releasedAt) return null;
  const start = pacificMidnightMs(e.bookingDate);
  const end = Date.parse(e.releasedAt);
  if (start === null || isNaN(end) || end < start) return null;
  return (end - start) / DAY_MS;
}

export function getBookingCounts(log) {
  return {
    total: log.length,
    inCustody: log.filter(e => e.status === 'in_custody').length,
    released: log.filter(e => e.status === 'released').length,
    launchCohort: log.filter(e => e.seenOnFirstRun).length,
  };
}

export function getAgeStats(log) {
  const ages = log.map(e => e.age).filter(a => Number.isInteger(a) && a > 0 && a < 120);
  if (!ages.length) return { n: 0 };
  const buckets = { '18–25': 0, '26–35': 0, '36–45': 0, '46–55': 0, '56–65': 0, '65+': 0 };
  ages.forEach(a => {
    const k = a <= 25 ? '18–25' : a <= 35 ? '26–35' : a <= 45 ? '36–45' : a <= 55 ? '46–55' : a <= 65 ? '56–65' : '65+';
    buckets[k]++;
  });
  return {
    n: ages.length,
    note: 'Age as shown on the county detail page the last time we read it.',
    median: median(ages),
    mean: round1(mean(ages)),
    histogram: Object.entries(buckets).map(([label, count]) => ({ label, count })),
  };
}

// The county publishes a Level code per charge (A, B, F, M, …). We report the
// codes as published and don't guess what each one means.
export function getChargeLevels(log) {
  const charges = log.flatMap(e => e.charges || []);
  return { ...breakdown(charges, c => c.level), unit: 'charges', note: 'County-published Level code, per charge.' };
}

// Agency per booking: a booking counts once per agency on any of its charges.
export function getAgencies(log) {
  return { ...perBookingCategories(log, c => (c.arrestAgency || 'Unknown').trim()), note: 'Arresting agency as published per charge; each booking counted once per agency.' };
}

// Bail SET (not posted). Per booking we report the highest amount set on any
// single charge. We do NOT sum charges: it's unverified whether charges in the
// same bond group share one bail or add up.
export function getBailStats(log) {
  const withCharges = log.filter(e => (e.charges || []).length);
  const maxes = withCharges
    .map(e => Math.max(0, ...e.charges.flatMap(c => [c.bondAmount, c.cashAmount]).filter(v => typeof v === 'number')))
    .filter(v => v > 0);
  return {
    n: withCharges.length,
    withBailSet: maxes.length,
    noBailAmount: withCharges.length - maxes.length,
    median: median(maxes),
    min: maxes.length ? Math.min(...maxes) : null,
    max: maxes.length ? Math.max(...maxes) : null,
    note: 'Bail set by the court, not bail posted. Per booking: the highest amount set on any one charge. $0.00 is ambiguous (no bail, held without bail, or not yet set).',
  };
}

export function getStayStats(log) {
  const released = log.filter(e => e.status === 'released');
  const stays = released.map(stayDays).filter(d => d !== null);
  const buckets = { '< 1 day': 0, '1–2 days': 0, '2–3 days': 0, '3–7 days': 0, '7–30 days': 0, '30+ days': 0 };
  stays.forEach(d => {
    const k = d < 1 ? '< 1 day' : d < 2 ? '1–2 days' : d < 3 ? '2–3 days' : d < 7 ? '3–7 days' : d < 30 ? '7–30 days' : '30+ days';
    buckets[k]++;
  });
  return {
    n: stays.length,
    releasedTotal: released.length,
    approximate: true,
    medianDays: round1(median(stays)),
    meanDays: round1(mean(stays)),
    histogram: Object.entries(buckets).map(([label, count]) => ({ label, count })),
    caveats: [
      'Release times are detected (when we noticed someone was gone), not published by the county.',
      'The county booking date has no time, so stays are counted from midnight of the booking day and can be overstated by up to a day.',
      'Only people who have left are counted. Current long holds are not included.',
    ],
  };
}

// Bookings per month by county booking date, only from the first scrape
// onward. Earlier months only contain people still held on launch day.
export function getBookingsByMonth(log, sinceDate) {
  const counts = {};
  log.forEach(e => {
    if (!e.bookingDate || (sinceDate && e.bookingDate < sinceDate)) return;
    const k = e.bookingDate.slice(0, 7);
    counts[k] = (counts[k] || 0) + 1;
  });
  return {
    since: sinceDate,
    rows: Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0])).map(([month, count]) => ({ month, count })),
  };
}

// Repeat bookings keyed on the county's Inmate ID, never on names. Counts only.
export function getRepeatBookings(log) {
  const byPerson = {};
  log.forEach(e => { if (e.inmateId) byPerson[e.inmateId] = (byPerson[e.inmateId] || 0) + 1; });
  const people = Object.values(byPerson);
  return {
    people: people.length,
    withMoreThanOneBooking: people.filter(c => c > 1).length,
    note: 'Matched on the county Inmate ID. Only bookings seen since tracking began.',
  };
}

export function buildStats(log, asOf) {
  const firstSeens = log.map(e => e.firstSeen).filter(Boolean).sort();
  const trackingSince = firstSeens[0] || null;
  const bookingDates = log.map(e => e.bookingDate).filter(Boolean).sort();
  return {
    generatedAt: asOf,
    trackingSince,
    bookingDateRange: { from: bookingDates[0] || null, to: bookingDates.at(-1) || null },
    bookingCounts: getBookingCounts(log),
    gender: breakdown(log, e => normalizeSex(e.sex)),
    race: breakdown(log, e => normalizeRace(e.race)),
    age: getAgeStats(log),
    topCharges: perBookingCategories(log, c => resolveEffectiveCategory(c.violation, c.addDesc)),
    crimeTypes: perBookingCategories(log, c => getCrimeType(resolveEffectiveCategory(c.violation, c.addDesc))),
    chargeLevels: getChargeLevels(log),
    agencies: getAgencies(log),
    bail: getBailStats(log),
    stay: getStayStats(log),
    bookingsByMonth: getBookingsByMonth(log, trackingSince ? trackingSince.slice(0, 10) : null),
    repeatBookings: getRepeatBookings(log),
  };
}
