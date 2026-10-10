# Wahkiakum County Jail Roster Monitor

Public jail roster monitor for Wahkiakum County, WA. Same EIS "Web Jail Viewer"
software as Kitsap (`recordwatch/ksco-scraper`); this repo was built from that
template, with the audit-doc fixes applied on day one.

## Standing rules (every session)
1. Always paste the full, real diff. Never a summary.
2. Never commit until the user replies "commit".
3. Any field claiming a county value (release time, release reason, status) must be backed by a value that actually parses. Otherwise it's labeled detected or unverified.
4. Test edge cases and list them: blank, unparseable, small populations, reappearance, rebuild/error pages.
5. Flag anything uncertain instead of deciding silently.
6. After pushing any data backfill, wait for the next scrape run and confirm the backfill counts survived.
7. Check "Pending verification" below first, every session.

Hard constraints: no DELETE / DROP / TRUNCATE / UPDATE on stored data and no
schema changes unless explicitly approved; don't touch the scraper/parsers
unless that's the task; row counts identical before and after; before/after
numbers for anything that changes a published stat.

Before auditing: `git pull` so the tree matches deployed main. Cloud sessions
need `jailviewer.co.wahkiakum.wa.us` allowed; `co.wahkiakum.wa.us` is blocked
by the current network policy. Never mark a check done that couldn't run.

## Pending verification
- [x] **First real workflow run** — done 2026-10-10, run #1: green, "county says
      Total Candidates: 4; parsed 4", 4 bookings all `detailStatus: ok`, 0 warnings,
      data commit `d33cefc`.
- [x] **cron-job.org trigger** — done 2026-10-10: test returned 204 and started run #2
      (green, `runs: 2`, no duplicate records, `firstSeen` unchanged).
- [ ] **Run frequency, first day**: `data/status.json` commit times should show about
      48 commits/day with no gaps over an hour. Check after 2026-10-11.
- [ ] **Site on an iPhone (Safari)**: dates and "about N days" show correctly, no
      "Invalid Date", font loads. WebKit isn't available in the cloud session.
- [ ] **First deploy**: after Pages source is set to GitHub Actions, the `deploy`
      job is green and the site loads at https://recordwatch.github.io/wahkiakum-county-monitor/
      with `noindex` in view-source.
- [ ] **First real release**: record shows `releaseSource: detected`,
      `lastSeenInCustodyAt` = previous run, `releasedAt` = first run they were missing.
- [ ] **Paging**: never seen. Roster has always fit on one page and `page=2`
      returned the same rows. If the roster grows past one page the scraper
      fails loudly with "parsed X rows but county says Total Candidates: Y" —
      then work out paging by hand.
- [ ] **Bail across charges**: booking B2600036 shows $500,000 on 2 of 7 charges
      (different court cases), all Bond Group 0. Unknown whether that's $500k or $1M
      total. Stats report the highest single-charge amount per booking, never a sum.
- [ ] **Level codes**: seen A, B, F, M, U. A/B are probably felony classes, M
      misdemeanor, F and U unknown. Reported as published, not mapped. Verify meaning.
- [ ] **Released / Release Date fields**: blank on every in-custody page and list
      row seen. If either is ever filled in, the scraper warns (exit 2) and stores
      the raw value; decide then whether it's a real county release date.
- [ ] **chargeMap.js** (copied from Kitsap): "ATTEMPT MURDER" lands in Homicide.
      Decide whether attempts get their own category (Kitsap too).

## Source map (verified by hand 2026-10-09)
**Gap tolerance: low.** The list shows current inmates only. A released person's
detail page is wiped (every field blank, banner "RELEASED as of <today>"). No
release times are published; no "released last 24h" feed like Kitsap's
(user checked the sheriff's site by hand). Every release is **detected**.
→ Run every 30 minutes via cron-job.org. A missed run makes release times wrong
by the gap and can miss short stays entirely.

| Source | URL | Notes |
|---|---|---|
| List | `/Home/BookingSearchResult?LastName=%` | Blank LastName returns 0, `%` required. Prints "Total Candidates: N". Columns: Booking #, First/Last/Middle, DOB, Race, Sex, Booking Date, Release Date, Sch Rel Date. |
| Detail | `/Home/BookingSearchDetail?BookingNumber=B2600066` | No cookie needed. Banner "IN CUSTODY as of MM/DD/YY" or "RELEASED as of MM/DD/YY" (also shown for unknown booking numbers). "Charges: N" header. |
| About | `/Home/About` | EIS JMS Web Jail Viewer 19.5.0.0 |

- **Keys:** booking number (`B2600036`, per booking) and Inmate ID (`A03987`,
  per person, alphanumeric — Kitsap's digits-only regex would drop it). A new
  booking number under a known Inmate ID is a new record.
- **Times:** booking date is date-only (no time). Stays are counted from
  midnight Pacific on the booking day. `01/01/1900` = blank.
- **Bail:** "Req. Bond Amt" / "Req. Cash Amt" per charge = bail *set*, not posted.
- **Roster size:** about 4 people. Real, per the user. 0 is possible on a quiet night.
- **Not stored:** DOB (identifying; age from the detail page is kept instead).
- **Terms:** none on the viewer pages fetched (search, results, detail, About).
  The county's main site was not checked (blocked here) — check by hand. GR 31 applies to court data
  (court case #, warrant #); decide consciously before publishing court fields.

## Guards (why each exists)
- Data files read strictly: missing → exit 1 unless `ALLOW_FRESH_START=1`;
  unreadable → always exit 1. Never silently start from empty.
- List must show "Total Candidates", the results table and expected headers,
  and parsed rows must equal the count. Otherwise exit 1, nothing written.
- **Small-roster rule** (the doc's 5-person/10% guard can never trip with 4
  people): a disappearance is only recorded as a release when that booking's
  detail page also says RELEASED. An empty roster after a non-empty one waits
  for a second empty run (override `CONFIRM_ZERO=1`). The release time is the
  first run they were missing either way.
- Detail fetch fails or disagrees with the list → keep the previous snapshot,
  retry next run, exit 2 (data still written, run shows red).
- Reappearance reverses the release and keeps the old one in `releaseReversals`.
- One retry on network errors and 5xx; unrecognized pages are never retried.
- Requests are sequential with a 1s gap (about 1 + 2×roster requests per run).

## Data (`data/`)
- `change_log.json` — every booking ever seen, newest booking date first.
  Fields: bookingNumber, inmateId, name parts, bookingDate (YYYY-MM-DD),
  firstSeen / lastSeenInCustodyAt / releasedAt / missingSince (ISO with offset),
  seenOnFirstRun (launch cohort), status, releaseSource, releaseReversals,
  detailStatus (ok / failed / disagrees / pending), charges[].
- `state.json` — run counter, pending empty-roster state. Not published.
- `status.json` — rewritten every run; its git history is the run log.
- `stats.json` — counts only, no names / booking numbers / inmate IDs (tested).

## Commands
- `npm test` — parser unit tests + full-scraper tests against `test/mock-server.js`
  in a temp folder. Never touches `data/`.
- `npm run dry-run` — real scraper against the live site, writing to a scratch
  copy; fails if the real `data/` changed. In a cloud session prefix with
  `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`.
- First real run: `ALLOW_FRESH_START=1 node scrape.js`.

## Hosting decision
Public repo + GitHub Pages, chosen 2026-10-09 ("public for now"). This means
`change_log.json` and its full git history are public, including names, and
JSON can't be noindexed on Pages. Going private later can't recall clones.

## Workflow (`.github/workflows/scrape.yml`)
- workflow_dispatch only, triggered by cron-job.org every 30 min (:07 and :37).
  No GitHub `schedule:` — it ran 11–13% of scheduled runs at Whatcom.
- Concurrency group `scrape-data`, checkout `ref: main`, `TZ: America/Los_Angeles`.
- Scraper, then `scripts/commit-data.sh` with `if: !cancelled()`, so a red run
  (exit 2) still commits its data. Nothing runs between the two.
- Push retry: rebase onto latest main, up to 3 times. Never `-X ours`; a data
  conflict fails loudly (tested). So never push data edits by hand while the
  cron is live — do backfills as an idempotent migration inside the scraper.
- Inputs: `allow_fresh_start` (first run only), `confirm_zero`.

### cron-job.org job
| Field | Value |
|---|---|
| URL | `https://api.github.com/repos/recordwatch/wahkiakum-county-monitor/actions/workflows/scrape.yml/dispatches` |
| Method | POST |
| Headers | `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, `Content-Type: application/json` |
| Body | `{"ref":"main"}` |
| Schedule | `7,37 * * * *`, timezone America/Los_Angeles |
| Notifications | On failure |

Token: fine-grained, Actions read/write, add this repo to the existing county
token. Token expiry: **2027-08-11** (also put it on a calendar; every county trigger on this token stops then). Renaming the
workflow file breaks the URL.

## Site (`frontend/`, GitHub Pages)
- React + Vite, HashRouter, `base: './'`. Pages: In Custody, Released, History,
  Stats, About. Built from Kitsap's layout and styles.
- `<meta name="robots" content="noindex, noarchive">` is the first tag in `<head>`.
  The GA tag (not added yet) goes inside `<head>`, *below* it.
- Deployed by the `deploy` job in `scrape.yml`: runs after the data commit
  (`needs: scrape`, `if: !cancelled()`), concurrency group `pages-deploy`,
  official `upload-pages-artifact` + `deploy-pages`. A broken build fails only
  this job. Requires **Settings → Pages → Source: GitHub Actions**.
- The site does NOT serve `change_log.json`. `scripts/build-site-data.js` writes
  `roster.json` = everyone in custody + releases from the last 90 days, with only
  displayed fields. Inmate ID, court case #, warrant #, case #, OBTS and DOB are
  not served (court fields held back until the GR 31 decision). The full history
  is still in the public repo.
- Display rules: county dates are shown without a Date object (a date-only
  string through `new Date()` shows the previous day in Pacific — Kitsap bug).
  Durations count from the county booking date and always say "about".
  Releases show "between <last seen> and <first missing> (detected)". Stale
  in-custody records get a note on the card (`missingSince`, detail failed or
  disagrees). No invented release reasons or clearance-code labels.
- Stats page: counts only from `stats.json`, n on every card, as-of and date
  range in the header, small-jail caveat, stay caveats from the data.
- Tested: `test/site.test.js` (date helpers, DST, windowing/trimming) and a
  Playwright pass in Chromium at 1200px and 390px (no console errors, no
  horizontal overflow). **Not tested in Safari** (no WebKit in the cloud box).

## Not built yet
GA tag (after the site is up; inside `<head>`, below the robots meta).
