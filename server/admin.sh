#!/usr/bin/env bash
# Your private driver list.   bash admin.sh stats     bash admin.sh csv > drivers.csv
set -euo pipefail
ENVF="$HOME/.auto-anna-env"
KEY="$(grep '^ADMIN_KEY=' "$ENVF" | head -1 | cut -d= -f2-)"
URL="$(grep -o 'https://[^"]*workers.dev' "$(dirname "$0")/../index.html" | head -1)"
[ -n "$KEY" ] && [ -n "$URL" ] || { echo "Run deploy.sh first."; exit 1; }
case "${1:-stats}" in
  stats) curl -sS -X POST "$URL/admin/stats" -H "x-admin-key: $KEY" -H 'Content-Type: application/json' -d '{}'; echo;;
  csv)   curl -sS -X POST "$URL/admin/export" -H "x-admin-key: $KEY" -H 'Content-Type: application/json' -d '{"format":"csv"}';;
  *) echo "usage: bash admin.sh stats | csv";;
esac
