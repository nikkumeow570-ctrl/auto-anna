# Auto Anna sync server (Cloudflare Workers + D1)

Stores each driver's trips, expenses and settings so they can be restored on a new phone.
Everything is on Cloudflare. No GitHub link, no Vercel, no Turso, no database password.

## Fastest: one command from Termux (no wrangler, it does not run on Android)

1. Cloudflare website > My Profile > API Tokens > Create Token > template **Edit Cloudflare Workers**. Add one more permission: **Account > D1 > Edit**. Create it and copy the token.
2. Copy your **Account ID** (Workers & Pages overview, right side).
3. In Termux:

```bash
export CLOUDFLARE_API_TOKEN="paste-token"
export CLOUDFLARE_ACCOUNT_ID="paste-account-id"
cd ~/auto-anna/server && bash deploy.sh
```

If it says your account has no workers.dev name yet, run `SUBDOMAIN=yourname bash deploy.sh`.
It creates the D1 database, uploads the Worker with its binding and secret, saves a random KEY_PEPPER in `~/.auto-anna-pepper`, tests the server, and writes the address into `index.html`. Safe to run again.

## Or set it up from a phone browser

1. **Database:** dash.cloudflare.com > Storage & Databases > D1 SQL Database > Create. Name it `auto-anna`.
2. **Worker:** Workers & Pages > Create > Create Worker. Name it `auto-anna-sync`, press Deploy.
3. Press **Edit code**, delete everything, paste all of `worker.js`, press **Deploy**.
4. Worker > **Settings > Bindings > Add > D1 database**. Variable name must be exactly `DB`. Pick `auto-anna`. Save.
5. Worker > **Settings > Variables and Secrets > Add**: `KEY_PEPPER` (type Secret) = long random text.
   Write it down and never change it, or every backup key stops matching.
6. Your address is `https://auto-anna-sync.YOURNAME.workers.dev` (shown on the Worker page).
7. In `index.html` set `var SYNC_URL = "https://auto-anna-sync.YOURNAME.workers.dev";`, commit, push.

The two tables are created automatically on the first request.

Test: `curl -s -X POST URL -H 'Content-Type: application/json' -d '{"key":"K7M2-QX4P-9TRW-3ZHD","since":0,"changes":[]}'`

## How it works
- The phone makes a random backup key like `K7M2-QX4P-9TRW-3ZHD`. The server stores only a SHA-256 hash of it (with the pepper).
- Each trip, expense and the settings are separate records with an updated-time. The newest edit wins.
- Deletes are kept as markers, so a deletion on one phone reaches the others.
- `POST` with `{ key, since, changes[] }` returns `{ now, changes[], more, last }`.

## Notes
- Tested here against a local SQLite stand-in for D1 (two devices, deletes, stale edits, wrong key, paging). Not yet tested on real Cloudflare.
- Anyone with a driver's key can read that driver's data. A lost key cannot be recovered.
- The backup includes the driver's UPI ID and name, because they are part of the settings.
- There is no rate limiting beyond Cloudflare's platform limits. Add one before a large launch.
- Cloudflare free-plan limits change. Check their pricing page.
