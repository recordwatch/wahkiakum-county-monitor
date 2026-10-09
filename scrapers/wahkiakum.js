// scrapers/wahkiakum.js
// Reads the Wahkiakum County EIS "Web Jail Viewer" (same vendor as Kitsap).
//
// Source map (verified by hand 2026-10-09):
//   List:   /Home/BookingSearchResult?LastName=%  — current inmates only.
//           A blank LastName returns 0, so the % wildcard is required.
//           Page prints "Total Candidates: N".
//   Detail: /Home/BookingSearchDetail?BookingNumber=B2600066 — no cookie needed.
//           In custody: banner "IN CUSTODY as of MM/DD/YY", full fields.
//           Released OR unknown booking: banner "RELEASED as of <today>", every
//           field blank. The date is today's date, not the release date.
//   No release times are published anywhere we can find, so every release
//   is detected by disappearance.
//
// Every function here either returns a fully validated result or throws
// SourceError. Nothing is silently turned into "empty".

import * as cheerio from 'cheerio';
import { countyDateToISO, parseDollars } from '../utils.js';

const BASE_URL = (process.env.WAHKIAKUM_BASE_URL || 'https://jailviewer.co.wahkiakum.wa.us').replace(/\/$/, '');
const REQUEST_TIMEOUT_MS = 30_000;
const RETRY_DELAY_MS = Number(process.env.WAHKIAKUM_RETRY_DELAY_MS ?? 5000);
export const REQUEST_GAP_MS = Number(process.env.WAHKIAKUM_REQUEST_GAP_MS ?? 1000);

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; wahkiakum-jail-roster-monitor)',
  'Accept': 'text/html,application/xhtml+xml',
};

export class SourceError extends Error {
  constructor(message) { super(message); this.name = 'SourceError'; }
}

export const delay = ms => new Promise(r => setTimeout(r, ms));

export function listUrl() {
  const q = new URLSearchParams({ LastName: '%', FirstName: '', BookingFrom: '', BookingTo: '', sort: 'BookingDate', sortdir: 'DESC' });
  return `${BASE_URL}/Home/BookingSearchResult?${q}`;
}

export function detailUrl(bookingNumber) {
  return `${BASE_URL}/Home/BookingSearchDetail?BookingNumber=${encodeURIComponent(bookingNumber)}`;
}

// One retry on network errors and 5xx, after a pause. 4xx and unrecognized
// pages are never retried — retrying won't change them.
async function get(url) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    let res;
    try {
      res = await fetch(url, { headers: HEADERS, redirect: 'manual', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (err) {
      if (attempt === 2) throw new SourceError(`network error for ${url}: ${err.message}`);
      console.error(`  network error (${err.message}), retrying once in ${RETRY_DELAY_MS / 1000}s`);
      await delay(RETRY_DELAY_MS);
      continue;
    }
    if (res.status >= 500 && attempt === 1) {
      console.error(`  HTTP ${res.status}, retrying once in ${RETRY_DELAY_MS / 1000}s`);
      await delay(RETRY_DELAY_MS);
      continue;
    }
    if (res.status !== 200) throw new SourceError(`HTTP ${res.status} for ${url}`);
    return res.text();
  }
}

const clean = s => (s || '').replace(/\s+/g, ' ').trim();
const labelKey = s => clean(s).replace(/[:#.]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

// ─── List page ────────────────────────────────────────────────────────────────

const LIST_COLUMNS = {
  'booking': 'bookingNumber',
  'first name': 'firstName',
  'last name': 'lastName',
  'middle name': 'middleName',
  'race': 'race',
  'sex': 'sex',
  'booking date': 'bookingDateRaw',
  'release date': 'listReleaseDateRaw',
  'sch rel date': 'schedReleaseRaw',
};
const BOOKING_NUMBER_RE = /^[A-Z]\d{5,}$/;

export function parseList(html) {
  const $ = cheerio.load(html);
  if (!/Booking Search Results/i.test($('body').text())) {
    throw new SourceError('list page: "Booking Search Results" heading missing (unrecognized page)');
  }
  const table = $('table.table');
  if (table.length !== 1) throw new SourceError(`list page: expected 1 results table, found ${table.length}`);

  // Map columns by header text, not position.
  const headers = table.find('thead th').map((_, th) => labelKey($(th).text())).get();
  const colIndex = {};
  headers.forEach((h, i) => { if (LIST_COLUMNS[h]) colIndex[LIST_COLUMNS[h]] = i; });
  const missingCols = Object.values(LIST_COLUMNS).filter(k => colIndex[k] === undefined);
  if (missingCols.length) throw new SourceError(`list page: missing columns ${missingCols.join(', ')} (headers: ${headers.join(' | ')})`);

  const m = clean($('body').text()).match(/Total Candidates:\s*(\d+)/i);
  if (!m) throw new SourceError('list page: "Total Candidates" count missing');
  const totalCandidates = parseInt(m[1], 10);

  const inmates = [];
  const seen = new Set();
  table.find('tbody tr').each((_, tr) => {
    const cells = $(tr).find('td').map((_, td) => clean($(td).text())).get();
    if (!cells.length) return;
    const row = {};
    for (const [key, i] of Object.entries(colIndex)) row[key] = cells[i] ?? '';
    if (!BOOKING_NUMBER_RE.test(row.bookingNumber)) {
      throw new SourceError(`list page: row without a valid booking number (${JSON.stringify(row.bookingNumber)})`);
    }
    if (seen.has(row.bookingNumber)) throw new SourceError(`list page: duplicate booking ${row.bookingNumber}`);
    seen.add(row.bookingNumber);

    const bookingDate = countyDateToISO(row.bookingDateRaw);
    if (!bookingDate) throw new SourceError(`list page: booking ${row.bookingNumber} has unparseable booking date ${JSON.stringify(row.bookingDateRaw)}`);
    const schedRelease = countyDateToISO(row.schedReleaseRaw);
    const listReleaseDate = countyDateToISO(row.listReleaseDateRaw);

    inmates.push({
      bookingNumber: row.bookingNumber,
      firstName: row.firstName,
      lastName: row.lastName,
      middleName: row.middleName,
      race: row.race || null,
      sex: row.sex || null,
      bookingDate,
      // Keep the raw text when it doesn't parse, so nothing is silently dropped.
      schedRelease: schedRelease === undefined ? null : schedRelease,
      schedReleaseRaw: schedRelease === undefined ? row.schedReleaseRaw : undefined,
      // Always blank so far. If it's ever filled in we want to know.
      listReleaseDate: listReleaseDate === undefined ? null : listReleaseDate,
      listReleaseDateRaw: row.listReleaseDateRaw || undefined,
    });
  });

  // The page has paging links, but page=2 returned the same rows in testing and
  // the roster has never been big enough to page. Rather than guess at paging,
  // fail loudly if the count doesn't match what we parsed.
  if (inmates.length !== totalCandidates) {
    throw new SourceError(`list page: parsed ${inmates.length} rows but county says Total Candidates: ${totalCandidates} (paging?)`);
  }
  return { totalCandidates, inmates };
}

export async function fetchRoster() {
  return parseList(await get(listUrl()));
}

// ─── Detail page ──────────────────────────────────────────────────────────────

// Value for a ".text-primary" label: the <strong> after a <span> label, or the
// <strong> inside a <p> label (the Violation row).
function labelValue($, el) {
  const $el = $(el);
  if (el.tagName === 'p') {
    const label = $el.contents().filter((_, n) => n.type === 'text').first().text();
    return [labelKey(label), clean($el.find('strong').first().text())];
  }
  return [labelKey($el.text()), clean($el.nextAll('strong').first().text())];
}

function fieldsIn($, scope) {
  const out = {};
  $(scope).find('.text-primary').each((_, el) => {
    const [k, v] = labelValue($, el);
    if (k && !(k in out)) out[k] = v;
  });
  return out;
}

function dateField(raw, name, warnings) {
  const v = countyDateToISO(raw);
  if (v === undefined) { warnings.push(`${name}: unparseable date ${JSON.stringify(raw)}`); return null; }
  return v;
}

function moneyField(raw, name, warnings) {
  const v = parseDollars(raw);
  if (v === undefined) { warnings.push(`${name}: unparseable amount ${JSON.stringify(raw)}`); return null; }
  return v;
}

const intOrNull = s => (/^\d+$/.test(s || '') ? parseInt(s, 10) : null);

/**
 * Returns one of:
 *   { state: 'released' }                    banner says RELEASED (or unknown booking)
 *   { state: 'in_custody', ...fields }       banner says IN CUSTODY and the page is for this booking
 * Throws SourceError for anything else.
 */
export function parseDetail(html, bookingNumber) {
  const $ = cheerio.load(html);
  const banner = clean($('.panel-heading a.btn').first().text());
  const bm = banner.match(/^(IN CUSTODY|RELEASED) as of (\d{2}\/\d{2}\/\d{2})$/i);
  if (!bm) throw new SourceError(`detail ${bookingNumber}: no IN CUSTODY / RELEASED banner (unrecognized page)`);
  if (bm[1].toUpperCase() === 'RELEASED') return { state: 'released' };

  const panels = $('div.panel');
  const bookingPanel = panels.first();
  const f = fieldsIn($, bookingPanel);
  if (f['booking number'] !== bookingNumber) {
    throw new SourceError(`detail ${bookingNumber}: page is for booking ${JSON.stringify(f['booking number'])}`);
  }

  const warnings = [];
  const detail = {
    state: 'in_custody',
    inmateId: f['inmate id'] || null,
    detailBookingDate: dateField(f['booking date'], 'booking date', warnings),
    location: f['location'] || null,
    detailSchedRelease: dateField(f['sched release'], 'sched release', warnings),
    // Blank on every in-custody page so far. If it's ever filled in, it's a
    // county-published release date and we keep it.
    countyReleased: dateField(f['released'], 'released', warnings),
    age: intOrNull(f['age']),
    sex: f['sex'] || null,
    race: f['race'] || null,
    hair: f['hair'] || null,
    eyes: f['eyes'] || null,
    height: f['height'] || null,   // FII integer: 509 = 5'9"
    weight: intOrNull(f['weight']),
    charges: [],
    parseWarnings: warnings,
  };

  // Charges panel: header "Charges: N", then repeating blocks that start with
  // a row holding only the charge number.
  const chargePanel = panels.filter((_, p) => /^Charges:/i.test(clean($(p).find('.panel-heading').first().text())));
  if (chargePanel.length !== 1) throw new SourceError(`detail ${bookingNumber}: charges panel missing`);
  const cm = clean(chargePanel.find('.panel-heading').first().text()).match(/^Charges:\s*(\d+)$/i);
  if (!cm) throw new SourceError(`detail ${bookingNumber}: charges count unreadable`);
  const expectedCharges = parseInt(cm[1], 10);

  let cur = null;
  const flush = () => { if (cur) detail.charges.push(cur); cur = null; };
  chargePanel.find('tr').each((_, tr) => {
    const tds = $(tr).children('td');
    if (tds.length === 1 && /^\d+$/.test(clean(tds.first().text())) && !$(tr).find('.text-primary').length) {
      flush();
      cur = { _fields: {} };
      return;
    }
    if (!cur) return;
    Object.assign(cur._fields, Object.fromEntries(
      Object.entries(fieldsIn($, tr)).filter(([k]) => !(k in cur._fields))
    ));
  });
  flush();

  detail.charges = detail.charges.map((c, i) => {
    const g = c._fields;
    const n = i + 1;
    const rawViolation = g['violation'] || '';
    return {
      violation: rawViolation.replace(/\s*\(Cleared\)\s*$/i, '').trim() || null,
      cleared: /\(Cleared\)\s*$/i.test(rawViolation),
      level: g['level'] || null,               // county severity code (A, B, F, …)
      addDesc: g['add desc'] || null,
      obts: g['obts'] || null,
      warrantNumber: g['war'] || null,
      endOfSentence: dateField(g['end of sentence date'], `charge ${n} end of sentence`, warnings),
      clearance: g['clearance'] || null,
      arrestAgency: g['arrest agency'] || null,
      caseNumber: g['case'] || null,
      arrestDate: dateField(g['arrest date'], `charge ${n} arrest date`, warnings),
      courtType: g['court type'] || null,
      courtCase: g['court case'] || null,
      nextCourtDate: dateField(g['next court date'], `charge ${n} next court date`, warnings),
      // Bail SET by the court (not posted), per charge as the county lists it.
      bondBailType: g['req bond/bail'] || null,
      bondGroup: g['bond group'] || null,
      bondAmount: moneyField(g['req bond amt'], `charge ${n} bond amount`, warnings),
      cashAmount: moneyField(g['req cash amt'], `charge ${n} cash amount`, warnings),
      bondCo: g['bond co'] || null,
    };
  });

  if (detail.charges.length !== expectedCharges) {
    throw new SourceError(`detail ${bookingNumber}: parsed ${detail.charges.length} charges but page says Charges: ${expectedCharges}`);
  }
  if (detail.charges.some(c => !c.violation)) {
    throw new SourceError(`detail ${bookingNumber}: a charge has no Violation text`);
  }
  return detail;
}

export async function fetchDetail(bookingNumber) {
  return parseDetail(await get(detailUrl(bookingNumber)), bookingNumber);
}
