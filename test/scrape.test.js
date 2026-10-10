// test/scrape.test.js
// Runs the real scrape.js as a child process against the mock server, with a
// throwaway data folder per test. Never touches ./data.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMock, makeInmate, listPage, REBUILD_PAGE } from './mock-server.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ISO_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;

let mock, dir;
before(async () => { mock = await startMock(); });
after(async () => { await mock.close(); });
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wahk-test-'));
  mock.state = { roster: [], detainedNotListed: [], failures: {}, listOverride: null, listOptions: {}, detailOptions: {} };
  mock.hits = [];
});

function scrape(env = {}) {
  return new Promise(resolve => {
    execFile(process.execPath, [path.join(ROOT, 'scrape.js')], {
      env: {
        ...process.env,
        DATA_DIR: dir,
        WAHKIAKUM_BASE_URL: mock.baseUrl,
        WAHKIAKUM_RETRY_DELAY_MS: '5',
        WAHKIAKUM_REQUEST_GAP_MS: '0',
        ALLOW_FRESH_START: '', CONFIRM_ZERO: '',
        ...env,
      },
    }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, out: stdout + stderr }));
  });
}
const fresh = () => scrape({ ALLOW_FRESH_START: '1' });
const read = f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const byBn = bn => read('change_log.json').find(e => e.bookingNumber === bn);
const snapshot = () => Object.fromEntries(fs.readdirSync(dir).map(f => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));

const A = makeInmate(1), B = makeInmate(2), C = makeInmate(3);

// ── Data files ────────────────────────────────────────────────────────────────

test('missing data files without ALLOW_FRESH_START: exit 1, nothing written', async () => {
  mock.state.roster = [A];
  const r = await scrape();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /change_log\.json is missing/);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('corrupt change_log.json: exit 1 even with ALLOW_FRESH_START, file untouched', async () => {
  mock.state.roster = [A];
  assert.equal((await fresh()).code, 0);
  fs.writeFileSync(path.join(dir, 'change_log.json'), '[{"bookingNumber": "B26');
  const before = snapshot();
  const r = await fresh();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /unreadable/);
  assert.deepEqual(snapshot(), before);
});

// ── First run ─────────────────────────────────────────────────────────────────

test('first run: records everyone as launch cohort with ISO times and parsed details', async () => {
  mock.state.roster = [A, B];
  const r = await fresh();
  assert.equal(r.code, 0, r.out);
  const a = byBn(A.bookingNumber);
  assert.equal(a.status, 'in_custody');
  assert.equal(a.seenOnFirstRun, true);
  assert.equal(a.inmateId, 'A09001');                 // alphanumeric ID survives
  assert.equal(a.bookingDate, '2026-09-01');
  assert.match(a.firstSeen, ISO_OFFSET);
  assert.match(a.lastSeenInCustodyAt, ISO_OFFSET);
  assert.equal(a.charges.length, 2);
  assert.equal(a.charges[0].level, 'B');
  assert.equal(a.charges[0].bondAmount, 25000);
  assert.equal(a.charges[1].bondAmount, 0);
  assert.equal(a.charges[1].nextCourtDate, null);     // 01/01/1900 sentinel
  assert.equal(a.detailStatus, 'ok');
  assert.equal(read('status.json').inCustody, 2);
  assert.equal(read('status.json').countyTotal, 2);
});

test('first run with an empty jail is valid', async () => {
  const r = await fresh();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(read('change_log.json'), []);
  assert.equal(read('status.json').inCustody, 0);
});

test('stats.json contains no names, booking numbers or inmate IDs', async () => {
  mock.state.roster = [A, B];
  await fresh();
  mock.state.roster = [A];
  await scrape();
  const s = fs.readFileSync(path.join(dir, 'stats.json'), 'utf8');
  for (const p of [A, B]) {
    for (const v of [p.first, p.last, p.bookingNumber, p.inmateId]) assert.ok(!s.includes(v), `stats.json contains ${v}`);
  }
  const stats = JSON.parse(s);
  assert.equal(stats.stay.n, 1);
  assert.equal(stats.stay.approximate, true);
  assert.equal(stats.bookingCounts.launchCohort, 2);
});

// ── Bookings and releases ─────────────────────────────────────────────────────

test('new booking on a later run is not launch cohort', async () => {
  mock.state.roster = [A];
  await fresh();
  mock.state.roster = [A, B];
  assert.equal((await scrape()).code, 0);
  assert.equal(byBn(B.bookingNumber).seenOnFirstRun, false);
});

test('release confirmed by detail page: detected, with the uncertainty window', async () => {
  mock.state.roster = [A, B];
  await fresh();
  const lastSeen = byBn(B.bookingNumber).lastSeenInCustodyAt;
  mock.state.roster = [A];
  const r = await scrape();
  assert.equal(r.code, 0, r.out);
  const b = byBn(B.bookingNumber);
  assert.equal(b.status, 'released');
  assert.equal(b.releaseSource, 'detected');
  assert.match(b.releasedAt, ISO_OFFSET);
  assert.equal(b.lastSeenInCustodyAt, lastSeen);
  assert.equal(b.charges.length, 2, 'charges kept from the last good snapshot');
  assert.equal(b.missingSince, undefined);
});

test('gone from list but detail says IN CUSTODY: not released, exit 2, released later at first-missing time', async () => {
  mock.state.roster = [A, B];
  await fresh();
  mock.state.roster = [A];
  mock.state.detainedNotListed = [B];
  const r = await scrape();
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /detail page says IN CUSTODY/);
  const b1 = byBn(B.bookingNumber);
  assert.equal(b1.status, 'in_custody');
  assert.match(b1.missingSince, ISO_OFFSET);

  mock.state.detainedNotListed = [];
  assert.equal((await scrape()).code, 0);
  const b2 = byBn(B.bookingNumber);
  assert.equal(b2.status, 'released');
  assert.equal(b2.releasedAt, b1.missingSince);
});

test('gone from list and detail fetch fails: not released, exit 2, retried next run', async () => {
  mock.state.roster = [A, B];
  await fresh();
  mock.state.roster = [A];
  mock.state.failures = {};
  // A's refresh succeeds; make every detail request fail.
  mock.state.failures['/Home/BookingSearchDetail'] = 4;
  const r = await scrape();
  assert.equal(r.code, 2, r.out);
  assert.equal(byBn(B.bookingNumber).status, 'in_custody');
  assert.equal((await scrape()).code, 0);
  assert.equal(byBn(B.bookingNumber).status, 'released');
});

test('reappearance reverses the release and keeps the old guess', async () => {
  mock.state.roster = [A, B];
  await fresh();
  mock.state.roster = [A];
  await scrape();
  const releasedAt = byBn(B.bookingNumber).releasedAt;
  mock.state.roster = [A, B];
  const r = await scrape();
  assert.equal(r.code, 0, r.out);
  const b = byBn(B.bookingNumber);
  assert.equal(b.status, 'in_custody');
  assert.equal(b.releasedAt, null);
  assert.equal(b.releaseReversals.length, 1);
  assert.equal(b.releaseReversals[0].releasedAt, releasedAt);
  assert.equal(b.releaseReversals[0].releaseSource, 'detected');
  assert.equal(read('change_log.json').length, 2, 'no duplicate record');
});

test('rebooking: same inmate ID, new booking number = new record', async () => {
  mock.state.roster = [A];
  await fresh();
  mock.state.roster = [];
  await scrape({ CONFIRM_ZERO: '1' });
  const A2 = makeInmate(9, { inmateId: A.inmateId, bookingDate: '10/05/2026' });
  mock.state.roster = [A2];
  await scrape();
  const log = read('change_log.json');
  assert.equal(log.length, 2);
  assert.equal(log.filter(e => e.inmateId === A.inmateId).length, 2);
  assert.equal(read('stats.json').repeatBookings.withMoreThanOneBooking, 1);
});

// ── Empty roster (small-jail guard) ───────────────────────────────────────────

test('empty roster needs two runs in a row; release time is the first empty run', async () => {
  mock.state.roster = [A, B];
  await fresh();
  mock.state.roster = [];
  const r1 = await scrape();
  assert.equal(r1.code, 0, r1.out);
  assert.match(r1.out, /waiting for the next run/);
  assert.equal(read('change_log.json').filter(e => e.status === 'released').length, 0);
  const firstEmpty = read('state.json').pendingZero.since;

  const r2 = await scrape();
  assert.equal(r2.code, 0, r2.out);
  const log = read('change_log.json');
  assert.equal(log.filter(e => e.status === 'released').length, 2);
  assert.ok(log.every(e => e.releasedAt === firstEmpty));
  assert.equal(read('state.json').pendingZero, null);
});

test('empty roster that recovers on the next run releases nobody', async () => {
  mock.state.roster = [A, B];
  await fresh();
  mock.state.roster = [];
  await scrape();
  mock.state.roster = [A, B];
  const r = await scrape();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /transient/);
  const log = read('change_log.json');
  assert.ok(log.every(e => e.status === 'in_custody' && e.missingSince === undefined));
});

test('CONFIRM_ZERO=1 accepts an empty roster immediately', async () => {
  mock.state.roster = [A];
  await fresh();
  mock.state.roster = [];
  await scrape({ CONFIRM_ZERO: '1' });
  assert.equal(byBn(A.bookingNumber).status, 'released');
});

// ── Bad source pages: exit 1, data byte-identical ─────────────────────────────

async function assertFatalUnchanged(setup, pattern) {
  mock.state.roster = [A, B];
  await fresh();
  const before = snapshot();
  setup();
  const r = await scrape();
  assert.equal(r.code, 1, r.out);
  if (pattern) assert.match(r.out, pattern);
  assert.deepEqual(snapshot(), before);
}

test('count mismatch (partial list): fatal, data unchanged', () =>
  assertFatalUnchanged(() => { mock.state.listOptions = { total: 3 }; }, /Total Candidates: 3/));

test('missing Total Candidates: fatal, data unchanged', () =>
  assertFatalUnchanged(() => { mock.state.listOptions = { omitTotal: true }; }, /count missing/));

test('rebuild / placeholder page: fatal, not retried, data unchanged', async () => {
  await assertFatalUnchanged(() => { mock.state.listOverride = REBUILD_PAGE; }, /unrecognized page/);
  assert.equal(mock.hits.filter(h => h.startsWith('/Home/BookingSearchResult')).length, 1 + 1, 'one list hit per run');
});

test('list 500 twice: fatal, data unchanged', () =>
  assertFatalUnchanged(() => { mock.state.failures['/Home/BookingSearchResult'] = 2; }, /HTTP 500/));

test('list 500 once: retried and succeeds', async () => {
  mock.state.roster = [A];
  mock.state.failures['/Home/BookingSearchResult'] = 1;
  const r = await fresh();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /retrying once/);
});

test('bad booking number in a row: fatal', () =>
  assertFatalUnchanged(() => { mock.state.roster = [A, makeInmate(4, { bookingNumber: '' })]; }, /valid booking number/));

// ── Detail failures keep the old snapshot ─────────────────────────────────────

test('detail page fails twice for a listed person: exit 2, old snapshot kept', async () => {
  mock.state.roster = [A];
  await fresh();
  mock.state.failures['/Home/BookingSearchDetail'] = 2;
  const r = await scrape();
  assert.equal(r.code, 2, r.out);
  const a = byBn(A.bookingNumber);
  assert.equal(a.detailStatus, 'failed');
  assert.equal(a.charges.length, 2);
  assert.equal(a.status, 'in_custody');
});

test('detail charge count mismatch is a failed fetch, not partial data', async () => {
  mock.state.roster = [A];
  await fresh();
  mock.state.detailOptions[A.bookingNumber] = { chargeCountOverride: 3 };
  const r = await scrape();
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /parsed 2 charges but page says Charges: 3/);
  assert.equal(byBn(A.bookingNumber).charges.length, 2);
});

test('new booking whose detail fails is still recorded and fetched next run', async () => {
  mock.state.roster = [A];
  mock.state.failures['/Home/BookingSearchDetail'] = 2;
  assert.equal((await fresh()).code, 2);
  assert.equal(byBn(A.bookingNumber).detailStatus, 'failed');
  assert.equal(byBn(A.bookingNumber).charges.length, 0);
  assert.equal((await scrape()).code, 0);
  assert.equal(byBn(A.bookingNumber).charges.length, 2);
});

test('listed but detail says RELEASED: kept in custody, exit 2', async () => {
  mock.state.roster = [A];
  await fresh();
  mock.state.detailOptions[A.bookingNumber] = { released: true };
  const r = await scrape();
  assert.equal(r.code, 2, r.out);
  assert.equal(byBn(A.bookingNumber).status, 'in_custody');
  assert.equal(byBn(A.bookingNumber).detailStatus, 'disagrees');
});

test('list shows a Release Date while still listed: recorded raw, flagged', async () => {
  mock.state.roster = [makeInmate(5, { listRelease: '10/08/2026' })];
  const r = await fresh();
  assert.equal(r.code, 2, r.out);
  assert.equal(read('change_log.json')[0].listReleaseDateRaw, '10/08/2026');
  assert.equal(read('change_log.json')[0].status, 'in_custody');
});

test('status.json changes every run (its git history is the run log)', async () => {
  mock.state.roster = [A];
  await fresh();
  const s1 = read('status.json').lastUpdated;
  await new Promise(r => setTimeout(r, 1100));
  await scrape();
  assert.notEqual(read('status.json').lastUpdated, s1);
  assert.equal(read('state.json').runs, 2);
});
