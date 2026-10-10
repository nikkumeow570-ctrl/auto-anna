# Auto Anna sync server (Turso + Vercel)

Stores each driver's trips, expenses and settings so they can be restored on a new phone.
The Turso token stays on this server. The app only holds a random backup key.

## Set it up from a phone browser (no computer needed)

1. **Turso:** sign in at turso.tech, create a database named `auto-anna`.
   Copy its **URL** (starts with `libsql://`) and create a **token** with read and write access.
2. **Vercel:** sign in at vercel.com with GitHub, choose **Add New, Project**, and import your `auto-anna` repo.
   - Set **Root Directory** to `server`.
   - Add these **Environment Variables**:
     - `TURSO_DATABASE_URL` = the libsql URL
     - `TURSO_AUTH_TOKEN` = the token
     - `KEY_PEPPER` = any long random text (optional, adds protection)
   - Press **Deploy**. The tables are created automatically on the first request.
3. Your endpoint is `https://YOUR-PROJECT.vercel.app/api/sync`.
4. In `index.html` near the top, set:
   `var SYNC_URL = "https://YOUR-PROJECT.vercel.app/api/sync";`
   then commit and push. The new APK is built automatically.

## How it works

- The phone makes a random backup key like `K7M2-QX4P-9TRW-3ZHD`. The server stores only a SHA-256 hash of it.
- Each trip, expense and the settings are separate records with an updated-time. The newest edit wins.
- Deletes are kept as markers, so a deletion on one phone reaches the others.
- `POST /api/sync` with `{ key, since, changes[] }` returns `{ now, changes[], more, last }`.

## Limits and honest notes

- Anyone who has a driver's key can read that driver's data, so the key must be kept private.
  If a key is lost, the data cannot be recovered. There is no phone number or password reset.
- The backup includes the driver's UPI ID and name, because they are part of the settings.
- There is no rate limiting beyond Vercel's own platform limits. Add one (for example Upstash) before a large launch.
- Turso and Vercel free plans have limits that can change. Check their current pricing pages.
