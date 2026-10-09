#!/usr/bin/env bash
# Dry run: the real scraper against the live county site, writing to a scratch
# copy of data/. Then proves the real data/ folder is byte-identical.
set -euo pipefail
cd "$(dirname "$0")/.."

SCRATCH="$(mktemp -d)"
if [ -d data ]; then
  cp -R data/. "$SCRATCH"/
  before="$(find data -type f -exec sha256sum {} + | sort)"
  FRESH=""
else
  before=""
  FRESH="1"   # no data yet: dry run starts from empty, in scratch only
fi

echo "Dry run writing to $SCRATCH"
set +e
DATA_DIR="$SCRATCH" ALLOW_FRESH_START="$FRESH" node scrape.js
code=$?
set -e

after=""
[ -d data ] && after="$(find data -type f -exec sha256sum {} + | sort)"
if [ "$before" != "$after" ]; then
  echo "FAIL: real data/ changed during the dry run" >&2
  exit 3
fi
echo "Real data/ unchanged. Scraper exit code: $code. Scratch output: $SCRATCH"
exit "$code"
