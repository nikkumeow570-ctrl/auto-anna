#!/usr/bin/env bash
# One-command setup of the Auto Anna sync server on Cloudflare (Worker + D1 database).
# Uses only curl + node (no wrangler, which does not run on Android).
set -euo pipefail
cd "$(dirname "$0")"
: "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN first}"
: "${CLOUDFLARE_ACCOUNT_ID:?Set CLOUDFLARE_ACCOUNT_ID first}"
NAME="auto-anna-sync"
API="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID"
command -v node >/dev/null || { echo "Install node first:  pkg install nodejs -y"; exit 1; }

cf() { curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "$@"; }
jget() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let v;try{v=JSON.parse(s);for(const k of process.argv[1].split("."))v=v==null?v:v[k]}catch(e){v=""}console.log(v==null?"":(typeof v=="object"?JSON.stringify(v):v))})' "$1"; }
fail() { echo "ERROR: $1"; [ -n "${2:-}" ] && echo "Cloudflare said: $2" | cut -c1-600; exit 1; }

echo "== 1/6 D1 database 'auto-anna'"
R="$(cf "$API/d1/database?name=auto-anna")"
[ "$(printf '%s' "$R" | jget success)" = "true" ] || fail "Cloudflare refused the token or account id. Check both, and that the token has D1 Edit." "$R"
DB="$(printf '%s' "$R" | jget result.0.uuid)"
if [ -z "$DB" ]; then
  R="$(cf -X POST "$API/d1/database" -H 'Content-Type: application/json' -d '{"name":"auto-anna"}')"
  DB="$(printf '%s' "$R" | jget result.uuid)"
  [ -n "$DB" ] || fail "Could not create the database." "$R"
  echo "created: $DB"
else echo "found: $DB"; fi

echo "== 2/6 Secret KEY_PEPPER"
PF="$HOME/.auto-anna-pepper"
if [ ! -s "$PF" ]; then ( umask 077; node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))' > "$PF" ); echo "New pepper saved in $PF. Keep a copy somewhere safe. NEVER change it."; else echo "Using the pepper already saved in $PF"; fi
PEPPER="$(cat "$PF")"

echo "== 3/6 Upload the Worker"
META="{\"main_module\":\"worker.js\",\"compatibility_date\":\"2025-01-01\",\"bindings\":[{\"type\":\"d1\",\"name\":\"DB\",\"id\":\"$DB\"},{\"type\":\"secret_text\",\"name\":\"KEY_PEPPER\",\"text\":\"$PEPPER\"}]}"
R="$(cf -X PUT "$API/workers/scripts/$NAME" -F "metadata=$META;type=application/json" -F "worker.js=@worker.js;type=application/javascript+module;filename=worker.js")"
[ "$(printf '%s' "$R" | jget success)" = "true" ] || fail "Upload failed." "$R"

echo "== 4/6 Public address (workers.dev)"
SUB="$(cf "$API/workers/subdomain" | jget result.subdomain)"
if [ -z "$SUB" ]; then
  if [ -n "${SUBDOMAIN:-}" ]; then
    R="$(cf -X PUT "$API/workers/subdomain" -H 'Content-Type: application/json' -d "{\"subdomain\":\"$SUBDOMAIN\"}")"
    SUB="$(printf '%s' "$R" | jget result.subdomain)"; [ -n "$SUB" ] || fail "Could not set that subdomain (maybe taken). Try another." "$R"
  else
    fail "Your Cloudflare account has no workers.dev name yet. Run again like this:  SUBDOMAIN=yourname bash deploy.sh"
  fi
fi
cf -X POST "$API/workers/scripts/$NAME/subdomain" -H 'Content-Type: application/json' -d '{"enabled":true}' >/dev/null
URL="https://$NAME.$SUB.workers.dev"
echo "address: $URL"

echo "== 5/6 Test (can take up to a minute the first time)"
OK=""
for i in 1 2 3 4 5 6 7 8; do
  R="$(curl -sS -m 20 -X POST "$URL" -H 'Content-Type: application/json' -d '{"key":"K7M2-QX4P-9TRW-3ZHD","since":0,"changes":[]}' 2>/dev/null || true)"
  case "$R" in *'"changes"'*) OK=1; break;; esac
  echo "  not ready yet ($i/8): $(printf '%s' "$R" | cut -c1-120)"; sleep 8
done
[ -n "$OK" ] || fail "The server did not answer correctly. index.html was NOT changed." "$R"
echo "server answered: $R"

echo "== 6/6 Put the address in the app"
sed -i "s|var SYNC_URL = \"[^\"]*\";|var SYNC_URL = \"$URL\";|" ../index.html
grep -n '^var SYNC_URL' ../index.html
echo "Done. Now:  cd .. && git add -A && git commit -m 'Cloudflare sync' && git push"
