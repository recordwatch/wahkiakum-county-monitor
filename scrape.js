// scrape.js
// One run: read the county list, update data/change_log.json, write status and stats.
//
// Exit codes:
//   0  success
//   1  fatal: source unreadable/unrecognized, or a data file missing/corrupt.
//      Nothing is written.
//   2  data written, but something needs a human (a detail fetch failed, the
//      list and a detail page disagree, a field didn't parse). The workflow
//      still commits the data, and the run shows red.
//
// Env:
//   DATA_DIR             data folder (default ./data). The dry run points this at a copy.
//   ALLOW_FRESH_START=1  allow starting with no data files (first run only).
//   CONFIRM_ZERO=1       accept an empty roster on the first zero run instead of waiting for a second.
//   WAHKIAKUM_BASE_URL   point at the mock server in tests.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchRoster, fetchDetail, delay, REQUEST_GAP_MS } from './scrapers/wahkiakum.js';
import { nowISO } from './utils.js';
import { buildStats } from './stats.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const LOG_FILE    = path.join(DATA_DIR, 'change_log.json');
const STATE_FILE  = path.join(DATA_DIR, 'state.json');
const STATUS_FILE = path.join(DATA_DIR, 'status.json');
const STATS_FILE  = path.join(DATA_DIR, 'stats.json');

class DataError extends Error {}

// Strict read: a missing file is only OK with ALLOW_FRESH_START=1, and a file
// that exists but doesn't parse is never OK. Falling back to empty here would
// overwrite the whole history on the next write.
function readJSONStrict(file, fallback, isValid) {
  if (!fs.existsSync(file)) {
    if (process.env.ALLOW_FRESH_START === '1') return fallback;
    throw new DataError(`${path.basename(file)} is missing. Set ALLOW_FRESH_START=1 only for the very first run.`);
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    throw new DataError(`${path.basename(file)} is unreadable: ${err.message}`);
  }
  if (!isValid(data)) throw new DataError(`${path.basename(file)} has the wrong shape`);
  return data;
}

function writeJSON(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

const fullName = i => [`${i.lastName},`, i.firstName, i.middleName].filter(Boolean).join(' ').replace(/,$/, '');

export async function run() {
  const now = nowISO();
  console.log(`[${now}] Running scrape (data: ${DATA_DIR})`);

  const log = readJSONStrict(LOG_FILE, [], d => Array.isArray(d) && d.every(e => e && e.bookingNumber));
  const state = readJSONStrict(STATE_FILE, { runs: 0, pendingZero: null }, d => d && typeof d === 'object' && !Array.isArray(d));
  const isFirstRun = log.length === 0 && !state.runs;
  const byId = new Map(log.map(e => [e.bookingNumber, e]));
  if (byId.size !== log.length) throw new DataError('change_log.json has duplicate booking numbers');

  const warnings = [];
  const warn = msg => { warnings.push(msg); console.warn(`  WARN: ${msg}`); };

  // Fatal if the list can't be read or doesn't validate. Nothing is written.
  const { totalCandidates, inmates } = await fetchRoster();
  console.log(`  county says Total Candidates: ${totalCandidates}; parsed ${inmates.length}`);

  const listed = new Set(inmates.map(i => i.bookingNumber));
  const prevInCustody = log.filter(e => e.status === 'in_custody');
  let booked = 0, reappeared = 0, released = 0;

  // ── People on the list ────────────────────────────────────────────────────
  for (const i of inmates) {
    let rec = byId.get(i.bookingNumber);
    if (!rec) {
      rec = {
        bookingNumber: i.bookingNumber,
        inmateId: null,
        firstSeen: now,
        seenOnFirstRun: isFirstRun,   // launch cohort: firstSeen is NOT their arrival
        status: 'in_custody',
        releasedAt: null,
        releaseSource: null,
        lastSeenInCustodyAt: null,
        releaseReversals: [],
        charges: [],
        detailStatus: 'pending',
      };
      log.push(rec);
      byId.set(rec.bookingNumber, rec);
      booked++;
      console.log(`  NEW: ${i.bookingNumber}`);
    } else if (rec.status === 'released') {
      // Came back after we marked them released: undo it, keep the old guess.
      rec.releaseReversals = rec.releaseReversals || [];
      rec.releaseReversals.push({
        releasedAt: rec.releasedAt,
        releaseSource: rec.releaseSource,
        lastSeenInCustodyAt: rec.lastSeenInCustodyAt,
        reversedAt: now,
      });
      rec.status = 'in_custody';
      rec.releasedAt = null;
      rec.releaseSource = null;
      reappeared++;
      console.log(`  REAPPEARED: ${i.bookingNumber} (release reversed)`);
    }
    // List fields are refreshed every run (names get corrected, sched dates move).
    Object.assign(rec, {
      name: fullName(i),
      firstName: i.firstName,
      lastName: i.lastName,
      middleName: i.middleName,
      race: i.race,
      sex: i.sex,
      bookingDate: i.bookingDate,
      schedRelease: i.schedRelease,
      lastSeenInCustodyAt: now,
    });
    delete rec.missingSince;
    if (i.schedReleaseRaw) warn(`${i.bookingNumber}: unparseable Sch Rel Date ${JSON.stringify(i.schedReleaseRaw)}`);
    if (i.listReleaseDateRaw) {
      // Never seen filled in. If it ever is, a human should look before we trust it.
      rec.listReleaseDateRaw = i.listReleaseDateRaw;
      warn(`${i.bookingNumber}: list shows a Release Date (${i.listReleaseDateRaw}) while still listed — unverified`);
    }
  }

  // ── Detail refresh for everyone listed (roster is tiny) ───────────────────
  // A failed fetch keeps the previous snapshot and is retried next run.
  for (const i of inmates) {
    const rec = byId.get(i.bookingNumber);
    await delay(REQUEST_GAP_MS);
    let d;
    try {
      d = await fetchDetail(i.bookingNumber);
    } catch (err) {
      rec.detailStatus = 'failed';
      warn(`${i.bookingNumber}: detail fetch failed, keeping previous snapshot (${err.message})`);
      continue;
    }
    if (d.state === 'released') {
      rec.detailStatus = 'disagrees';
      warn(`${i.bookingNumber}: on the list but detail page says RELEASED — keeping in custody`);
      continue;
    }
    const { state: _s, parseWarnings, detailBookingDate, detailSchedRelease, ...fields } = d;
    Object.assign(rec, fields, { detailStatus: 'ok', detailFetchedAt: now });
    if (d.sex) rec.sex = d.sex;
    if (d.race) rec.race = d.race;
    if (detailBookingDate && detailBookingDate !== rec.bookingDate) {
      warn(`${i.bookingNumber}: list booking date ${rec.bookingDate} ≠ detail ${detailBookingDate}`);
    }
    if (d.countyReleased) warn(`${i.bookingNumber}: detail shows Released ${d.countyReleased} while still listed — unverified`);
    parseWarnings.forEach(w => warn(`${i.bookingNumber}: ${w}`));
  }

  // ── People who left the list ──────────────────────────────────────────────
  const missing = prevInCustody.filter(e => !listed.has(e.bookingNumber));
  if (inmates.length === 0 && missing.length > 0 && !state.pendingZero && process.env.CONFIRM_ZERO !== '1') {
    // Empty roster after a non-empty one: could be real, could be a bad load.
    // Wait for a second run to agree. The release time will still be this run.
    state.pendingZero = { since: now, bookingNumbers: missing.map(e => e.bookingNumber) };
    missing.forEach(e => { e.missingSince = e.missingSince || now; });
    console.log(`  Roster empty after ${missing.length} in custody — waiting for the next run to confirm before recording releases.`);
  } else {
    if (state.pendingZero) {
      console.log(inmates.length === 0 ? '  Second empty run in a row — confirming releases.' : '  Roster no longer empty — previous empty run treated as transient.');
      state.pendingZero = null;
    }
    // Cross-check each disappearance against its detail page before releasing.
    for (const rec of missing) {
      rec.missingSince = rec.missingSince || now;
      await delay(REQUEST_GAP_MS);
      let d;
      try {
        d = await fetchDetail(rec.bookingNumber);
      } catch (err) {
        warn(`${rec.bookingNumber}: gone from list, detail fetch failed — will retry next run (${err.message})`);
        continue;
      }
      if (d.state === 'in_custody') {
        warn(`${rec.bookingNumber}: gone from list but detail page says IN CUSTODY — not releasing`);
        continue;
      }
      // Release happened between lastSeenInCustodyAt and missingSince.
      rec.status = 'released';
      rec.releasedAt = rec.missingSince;
      rec.releaseSource = 'detected';
      delete rec.missingSince;
      released++;
      console.log(`  RELEASED: ${rec.bookingNumber} (detected; last seen ${rec.lastSeenInCustodyAt})`);
    }
  }

  // Newest booking first, stable.
  log.sort((a, b) => (b.bookingDate || '').localeCompare(a.bookingDate || '') || b.bookingNumber.localeCompare(a.bookingNumber));

  state.runs = (state.runs || 0) + 1;
  state.lastRunAt = now;

  const inCustody = log.filter(e => e.status === 'in_custody').length;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  writeJSON(LOG_FILE, log);
  writeJSON(STATE_FILE, state);
  writeJSON(STATUS_FILE, { inCustody, countyTotal: totalCandidates, lastUpdated: now, warnings: warnings.length });
  writeJSON(STATS_FILE, buildStats(log, now));

  console.log(`[${nowISO()}] Done. ${booked} new, ${released} released, ${reappeared} reappeared, ${inCustody} in custody, ${warnings.length} warnings.`);
  return warnings.length ? 2 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().then(code => process.exit(code)).catch(err => {
    console.error(`FATAL (${err.name}): ${err.message}`);
    process.exit(1);
  });
}
