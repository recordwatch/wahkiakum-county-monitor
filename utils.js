// utils.js
// Timestamp and date helpers. Everything we store is ISO 8601: full timestamps
// carry a Pacific offset (2026-10-09T06:37:16-07:00), county date-only values
// are stored as YYYY-MM-DD. Never MM/DD/YYYY text or zoneless "YYYY-MM-DD hh:mm:ss"
// — those sort wrong and Safari rejects some of them.

const TZ = 'America/Los_Angeles';

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23',
});

/** ISO 8601 with the Pacific offset for the given instant. */
export function toPacificISO(date) {
  const p = Object.fromEntries(partsFmt.formatToParts(date).map(x => [x.type, x.value]));
  const wallAsUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const offsetMin = Math.round((wallAsUTC - Math.floor(date.getTime() / 1000) * 1000) / 60000);
  const sign = offsetMin < 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);
  const off = `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${off}`;
}

export function nowISO() {
  return toPacificISO(new Date());
}

// The county uses 01/01/1900 as "no date".
const COUNTY_NULL_DATES = new Set(['01/01/1900']);

/**
 * County MM/DD/YYYY → YYYY-MM-DD.
 * Returns null for blank or the 01/01/1900 sentinel.
 * Returns undefined for a non-blank value that doesn't parse, so callers can
 * tell "county left it blank" apart from "we couldn't read it".
 */
export function countyDateToISO(raw) {
  const s = (raw || '').trim();
  if (!s || COUNTY_NULL_DATES.has(s)) return null;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return undefined;
  const [, mm, dd, yyyy] = m;
  const d = new Date(Date.UTC(+yyyy, +mm - 1, +dd));
  if (d.getUTCFullYear() !== +yyyy || d.getUTCMonth() !== +mm - 1 || d.getUTCDate() !== +dd) return undefined;
  return `${yyyy}-${mm}-${dd}`;
}

/** "$250,000.00" → 250000, "$0.00" → 0, blank → null, unparseable → undefined. */
export function parseDollars(raw) {
  const s = (raw || '').trim();
  if (!s) return null;
  const m = s.match(/^\$\s*([\d,]+(?:\.\d{1,2})?)$/);
  if (!m) return undefined;
  return parseFloat(m[1].replace(/,/g, ''));
}
