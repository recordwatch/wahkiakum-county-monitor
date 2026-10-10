#!/usr/bin/env bash
# Commit and push data/ to main. Called by the workflow after the scraper,
# even when the scraper exited red (exit 2 still writes data).
#
# On a rejected push: rebase onto latest main and retry, up to 3 times.
# Never "-X ours" / "-X theirs": a conflict in data/ means two writers, which
# should never happen, so it fails loudly instead of silently picking a side.
set -euo pipefail
cd "$(dirname "$0")/.."

BRANCH="${DATA_BRANCH:-main}"

git config user.name  "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

if [ ! -d data ]; then
  echo "No data/ folder (first run failed before writing anything)."
  exit 0
fi
git add data/
if git diff --cached --quiet; then
  echo "No data changes to commit."
  exit 0
fi
git commit -q -m "data: scrape $(date -u '+%Y-%m-%dT%H:%MZ')"

for attempt in 1 2 3; do
  if git push -q origin "HEAD:${BRANCH}"; then
    echo "Pushed data commit $(git rev-parse --short HEAD)."
    exit 0
  fi
  echo "Push rejected (attempt ${attempt}/3); rebasing onto latest ${BRANCH}."
  git pull -q --rebase origin "${BRANCH}"
done

echo "Push failed 3 times." >&2
exit 1
