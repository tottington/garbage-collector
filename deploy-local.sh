#!/bin/bash
# Build the local garbo tree and install it over the copy mafia actually runs.
#
# Mafia has gitUpdateOnLogin=true, so it re-copies garbo from its own git
# checkout on every login and reverts this. Re-run this after logging in.
#
#   ./deploy-local.sh            build and install
#   ./deploy-local.sh --restore  put the stock build back
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DST="/Users/work/Library/Application Support/KoLmafia/scripts/garbage-collector"
BAK="$DST/garbo.js.upstream-5b635a5a.bak"

if [[ "${1:-}" == "--restore" ]]; then
  [[ -f "$BAK" ]] || { echo "No backup at $BAK" >&2; exit 1; }
  cp "$BAK" "$DST/garbo.js"
  echo "Restored the stock build."
  exit 0
fi

cd "$REPO"
yarn workspace garbo run build >/dev/null
cp "$REPO/packages/garbo/dist/scripts/garbage-collector/garbo.js" "$DST/garbo.js"
echo "Installed $(git rev-parse --short HEAD) ($(git branch --show-current)) to $DST"
