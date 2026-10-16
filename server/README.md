# Auto Anna server (Cloudflare Workers + D1)

Cloud backup, driver accounts with a mobile number checked by a WhatsApp code, referrals and the wallet. All in one Worker.
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

## Or set it up from a phone browser (only the backup part; use deploy.sh for accounts and OTP)

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

## Driver accounts, WhatsApp code, referrals (new)

`deploy.sh` also reads **`~/.auto-anna-env`** (it creates it the first time) and sends those settings to the Worker. Edit the file, run `bash deploy.sh` again. Secrets (`MSG91_AUTHKEY`, `ADMIN_KEY`) are stored as Worker secrets, never in the app or in GitHub.

```
OTP_PROVIDER=whatsapp        # whatsapp | sms | dev.  "dev" sends nothing: new drivers cannot sign up
MSG91_AUTHKEY=...            # MSG91 > API > Auth key
MSG91_NUMBER=91XXXXXXXXXX    # your WhatsApp "integrated number" in MSG91
MSG91_TEMPLATE=...           # the approved Authentication template name
MSG91_NAMESPACE=...          # the template namespace shown in MSG91
MSG91_LANG=en                # the template language code
```
For SMS instead: `OTP_PROVIDER=sms`, `MSG91_SMS_TEMPLATE` (DLT-approved flow id), `MSG91_SMS_VAR` (the variable name in the template, default `OTP`).

**Safe default:** until `OTP_PROVIDER` is `whatsapp` or `sms`, the Worker refuses to send codes (503) and the app shows "Sign up is not open yet". Nobody can run up your bill.

**Not yet tested against the real MSG91.** The request follows MSG91's published WhatsApp OTP format. Send yourself a code first. MSG91's page also says authentication templates can be restricted by Meta. If your account is restricted, use SMS.

### Your driver list
```bash
bash server/admin.sh stats            # drivers, new this week, active, with backup, referrals
bash server/admin.sh csv > drivers.csv  # mobile, name, auto number, city, referral code, dates
```
Keep that file private. Do not share it or sell it. Use it only for what the privacy policy says.

### Limits built in
- A code lasts 5 minutes, 5 wrong tries, 1 code per 30 seconds, 5 per hour per number, 20 per hour per IP, and a daily cap (`OTP_DAILY_CAP`, 3000) so a bot cannot run up your MSG91 bill.
- Codes, sessions and backup keys are stored only as hashes. IP counters are deleted after 2 days.
- Referral reward (`REF_REWARD`, default 10 rupees): paid once, when the invited driver has been registered for `REF_MIN_DAYS` (3) days and has `REF_MIN_TRIPS` (3) trips in the cloud backup. At most 50 rewards a month per driver. The wallet is credit for the Pro plan, not cash.
- `POST /me/delete` erases the account, wallet, referral and the cloud backup.

Tested locally: 53 checks against a SQLite stand-in (OTP, limits, referral, wallet, delete, admin, MSG91 request shape with a mocked network).
