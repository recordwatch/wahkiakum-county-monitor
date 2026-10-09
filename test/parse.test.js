// test/parse.test.js
// Parser and helper edge cases that don't need a server.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseList, parseDetail } from '../scrapers/wahkiakum.js';
import { countyDateToISO, parseDollars, toPacificISO } from '../utils.js';
import { pacificMidnightMs, stayDays } from '../stats.js';
import { makeInmate, listPage, detailPage, REBUILD_PAGE } from './mock-server.js';

test('countyDateToISO', () => {
  assert.equal(countyDateToISO('04/30/2026'), '2026-04-30');
  assert.equal(countyDateToISO(''), null);
  assert.equal(countyDateToISO('  '), null);
  assert.equal(countyDateToISO('01/01/1900'), null);
  assert.equal(countyDateToISO('02/30/2026'), undefined);
  assert.equal(countyDateToISO('2026-04-30'), undefined);
  assert.equal(countyDateToISO('4/30/2026'), undefined);
});

test('parseDollars', () => {
  assert.equal(parseDollars('$500,000.00'), 500000);
  assert.equal(parseDollars('$0.00'), 0);
  assert.equal(parseDollars(''), null);
  assert.equal(parseDollars('Bail Denied'), undefined);
});

test('toPacificISO uses the right offset on both sides of DST', () => {
  assert.equal(toPacificISO(new Date('2026-01-15T20:00:00Z')), '2026-01-15T12:00:00-08:00');
  assert.equal(toPacificISO(new Date('2026-07-15T19:00:00Z')), '2026-07-15T12:00:00-07:00');
  assert.equal(toPacificISO(new Date('2026-10-09T07:30:00Z')), '2026-10-09T00:30:00-07:00');
});

test('pacificMidnightMs and stayDays', () => {
  assert.equal(new Date(pacificMidnightMs('2026-03-08')).toISOString(), '2026-03-08T08:00:00.000Z');
  assert.equal(new Date(pacificMidnightMs('2026-07-04')).toISOString(), '2026-07-04T07:00:00.000Z');
  assert.equal(pacificMidnightMs(null), null);
  assert.equal(stayDays({ status: 'released', bookingDate: '2026-10-01', releasedAt: '2026-10-03T12:00:00-07:00' }), 2.5);
  assert.equal(stayDays({ status: 'in_custody', bookingDate: '2026-10-01', releasedAt: null }), null);
  assert.equal(stayDays({ status: 'released', bookingDate: '2026-10-05', releasedAt: '2026-10-03T12:00:00-07:00' }), null);
});

test('parseList maps columns by header and validates', () => {
  const r = parseList(listPage([makeInmate(1, { schRel: '11/25/2026' })]));
  assert.equal(r.totalCandidates, 1);
  assert.equal(r.inmates[0].bookingNumber, 'B2600001');
  assert.equal(r.inmates[0].schedRelease, '2026-11-25');
  assert.equal(r.inmates[0].dob, undefined, 'DOB is not stored');
  assert.deepEqual(parseList(listPage([])), { totalCandidates: 0, inmates: [] });
  assert.throws(() => parseList(REBUILD_PAGE), /unrecognized page/);
  assert.throws(() => parseList(listPage([makeInmate(1, { bookingDate: '' })])), /unparseable booking date/);
  assert.throws(() => parseList(listPage([makeInmate(1), makeInmate(1)])), /duplicate/);
});

test('parseDetail states', () => {
  const p = makeInmate(1);
  const d = parseDetail(detailPage(p), p.bookingNumber);
  assert.equal(d.state, 'in_custody');
  assert.equal(d.age, 31);
  assert.equal(d.charges[0].violation, '9A.36.021(2)(A) - ASSAULT-2');
  assert.equal(d.charges[0].addDesc, 'DOMESTIC VIOLENCE');
  assert.equal(d.charges[0].caseNumber, '260070');
  assert.equal(d.charges[1].addDesc, null);
  assert.deepEqual(parseDetail(detailPage({}, { released: true }), 'B2600099'), { state: 'released' });
  assert.throws(() => parseDetail(detailPage(p), 'B2600002'), /page is for booking/);
  assert.throws(() => parseDetail(REBUILD_PAGE, p.bookingNumber), /banner/);
});

test('parseDetail flags unparseable amounts instead of guessing', () => {
  const p = makeInmate(1);
  p.charges[0].bail = 'Bail Denied';
  const d = parseDetail(detailPage(p), p.bookingNumber);
  assert.equal(d.charges[0].bondAmount, null);
  assert.match(d.parseWarnings[0], /unparseable amount "Bail Denied"/);
});
