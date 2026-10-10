// scripts/build-site-data.js
// Writes the files the public site serves (frontend/public/data/) from data/.
//
// The site gets a WINDOWED, TRIMMED roster, not change_log.json:
//   - everyone in custody, plus releases from the last WINDOW_DAYS days
//   - only the fields the page displays
// The full history is still in the public repo (see CLAUDE.md, Hosting
// decision); this keeps the served site from being a one-click bulk export.
//
// Court case # and warrant # are left out until the GR 31 question is decided.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const OUT_DIR = path.resolve(process.env.SITE_DATA_DIR || path.join(ROOT, 'frontend', 'public', 'data'));
export const WINDOW_DAYS = 90;

const PERSON_FIELDS = [
  'bookingNumber', 'name', 'bookingDate', 'schedRelease', 'status',
  'firstSeen', 'seenOnFirstRun', 'lastSeenInCustodyAt', 'releasedAt', 'releaseSource',
  'missingSince', 'detailStatus', 'detailFetchedAt',
  'age', 'sex', 'race', 'height', 'weight', 'hair', 'eyes',
];
const CHARGE_FIELDS = [
  'violation', 'cleared', 'level', 'addDesc', 'arrestAgency', 'arrestDate',
  'nextCourtDate', 'bondBailType', 'bondAmount', 'cashAmount',
];

const pick = (obj, keys) => Object.fromEntries(keys.filter(k => obj[k] !== undefined).map(k => [k, obj[k]]));

export function buildRoster(log, now = new Date()) {
  const cutoff = now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return log
    .filter(e => e.status === 'in_custody' || (e.releasedAt && Date.parse(e.releasedAt) >= cutoff))
    .map(e => ({
      ...pick(e, PERSON_FIELDS),
      charges: (e.charges || []).map(c => pick(c, CHARGE_FIELDS)),
    }));
}

function readStrict(file) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const log = readStrict('change_log.json');
  const status = readStrict('status.json');
  const stats = readStrict('stats.json');
  const roster = buildRoster(log);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'roster.json'), JSON.stringify({ windowDays: WINDOW_DAYS, records: roster }));
  fs.writeFileSync(path.join(OUT_DIR, 'status.json'), JSON.stringify(status));
  fs.writeFileSync(path.join(OUT_DIR, 'stats.json'), JSON.stringify(stats));
  console.log(`Site data: ${roster.length} of ${log.length} records (in custody + released in last ${WINDOW_DAYS} days).`);
}
