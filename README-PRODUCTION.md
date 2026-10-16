# Auto Anna: production release checklist

## 1. Make the signing key (once)
```bash
pkg install openjdk-17 gh -y
cd ~/auto-anna && bash android/make-keystore.sh
```
Then **copy `~/auto-anna-release.jks` and `~/.auto-anna-keystore` to a safe place** (Drive, email to yourself).
If they are lost you can never update the app under the same name.

The workflow now refuses to build without this key, so a debug-signed app cannot be published by mistake.

**First install after this:** earlier test APKs were signed with a different (debug) key. Android will not update
over them. Turn on cloud backup, uninstall the old app, install the new one and restore with your key.

## 2. What changed for Play Store rules
- Target Android 16 (API 36). Google requires it for new apps and updates from 31 August 2026.
- Edge-to-edge screen handling and the new back gesture are handled in `MainActivity.kt`.
- AGP 8.9.1 / Gradle 8.11.1, R8 shrinking on, an AAB (`auto-anna.aab`) is built next to the APK.
- **None of this could be compiled in my sandbox (no Android SDK).** Push, watch the build, and send me the log if it fails.

## 3. Play Console (when you are ready)
- Developer account, one-time fee. New personal accounts may need a closed test with testers for 14 days before production. Check the current rule in Play Console.
- Upload `auto-anna.aab` from the workflow's artifacts.
- Privacy policy URL: `https://auto-anna.pages.dev/privacy.html` (fill in the contact line first, see below).
- Account deletion: tell Play it is in the app (Settings > Friends and wallet > Delete my account) and give the privacy URL.
- Data safety form: collects name, phone number, (optional) app activity and financial info for the backup; used for account, app functionality, fraud prevention; not sold; encrypted in transit; deletion available.
- Declarations: foreground service (location, for the trip meter) and notification access (reads UPI "money received" alerts on the phone only). Google reviews these. Explain both in plain words and attach a short screen recording.
- Content rating questionnaire, app category (Maps & Navigation or Finance/Business), screenshots from `site/img`.

## 4. Before you publish the privacy page
Open `privacy.html` (in the website folder), set `var CONTACT=""` to your public email or WhatsApp number, and redeploy the website. Have a lawyer or CA read it once. I am not a lawyer.

## 5. Server
See `server/README.md`: `bash deploy.sh` then edit `~/.auto-anna-env` with your MSG91 details and run it again.
