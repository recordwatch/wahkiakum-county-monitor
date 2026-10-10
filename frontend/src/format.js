// format.js
// Display helpers. Plain JS (no JSX) so the root test suite can import it.
//
// Stored formats: full timestamps are ISO with offset; county dates are
// YYYY-MM-DD with no time. Never pass a date-only string to new Date():
// it's read as midnight UTC and shows as the previous day in Pacific.

const TZ = 'America/Los_Angeles';
const DAY_MS = 24 * 60 * 60 * 1000;

/** "2026-04-30" → "04/30/2026" (no Date object, no timezone shift). */
export function formatCountyDate(isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate || '');
  return m ? `${m[2]}/${m[3]}/${m[1]}` : '';
}

/** ISO timestamp → "10/10/2026, 1:10 PM" in Pacific. */
export function formatDateTime(iso) {
  const d = new Date(iso);
  if (!iso || isNaN(d)) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(d);
}

/** ISO timestamp → "1:10 PM" in Pacific. */
export function formatTime(iso) {
  const d = new Date(iso);
  if (!iso || isNaN(d)) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(d);
}

/** ISO timestamp → "2026-10-10" (Pacific calendar day), for grouping/sorting. */
export function pacificDay(iso) {
  const d = new Date(iso);
  if (!iso || isNaN(d)) return '';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/** Midnight Pacific on a YYYY-MM-DD date, as epoch ms. */
export function pacificMidnightMs(isoDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate || '')) return null;
  const hourFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' });
  for (const off of ['-08:00', '-07:00']) {
    const t = Date.parse(`${isoDate}T00:00:00${off}`);
    if (isNaN(t)) continue;
    const iso = new Date(t).toISOString();
    if (pacificDay(iso) === isoDate && hourFmt.format(new Date(t)) === '00') return t;
  }
  return null;
}

/**
 * Approximate time held, from the county booking DATE (midnight Pacific) to
 * an end time. Always "about", because the booking date has no time and
 * detected release times are only known to within one scrape interval.
 */
export function aboutDuration(bookingDate, endIso) {
  const start = pacificMidnightMs(bookingDate);
  const end = endIso ? Date.parse(endIso) : NaN;
  if (start === null || isNaN(end) || end < start) return null;
  const days = (end - start) / DAY_MS;
  if (days < 1) return 'about 1 day or less';
  const whole = Math.round(days);
  return `about ${whole} day${whole === 1 ? '' : 's'}`;
}

/** Days since a booking date, for in-custody records. */
export function aboutDaysSince(bookingDate, now = new Date()) {
  return aboutDuration(bookingDate, now.toISOString());
}

export function formatMoney(n) {
  if (n == null) return null;
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** Height stored as FII: 509 → 5'9". */
export function formatHeight(raw) {
  const s = String(raw ?? '');
  if (!/^\d{3}$/.test(s)) return raw ? s : null;
  return `${s[0]}'${String(parseInt(s.slice(1), 10))}"`;
}

const RACE = { W: 'White', B: 'Black', H: 'Hispanic', I: 'Native American', A: 'Asian / Pacific Islander', U: 'Unknown', O: 'Other' };
const SEX = { M: 'Male', F: 'Female', U: 'Unknown' };
export const formatRace = c => (c ? RACE[c.toUpperCase()] || c : null);
export const formatSex = c => (c ? SEX[c.toUpperCase()] || c : null);
