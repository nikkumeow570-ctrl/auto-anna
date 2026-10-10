# Auto Anna (ஆட்டோ அண்ணா)

A Tamil-first bill calculator for auto drivers. It measures trip distance with the phone's GPS, adds waiting time, calculates the fare from the driver's own rates, and shows a UPI QR for the exact amount.

Works offline after the first load. English and Tamil. No sign-up. Data stays on the phone. An Android app adds background GPS and a UPI payment voice.

> **Not a legal fare meter.** The app calculates a bill from GPS distance and rates the driver enters. Check local transport and fare-meter rules before relying on it for fares.

## Built for drivers who read little

- **Tamil by default.** English is one tap away.
- **Big buttons with icons and colours:** green to start, red to end, so the screen can be understood without reading.
- **Speaks the total** in Tamil when the trip ends, and again with the "Say total" button.
- **Few words, few fields.** Night charge is folded away. Setup is done once, with a helper.
- **Voice alerts for UPI payments** in Tamil.
- Large text and touch targets for older phones and thick fingers.

Tamil speech needs a Tamil voice on the phone (Settings, Language, Text-to-speech). If it is missing, the app speaks English.

## Features

- **Trips:** Start / End with GPS, live route line on a map, live distance, waiting time and fare. Or make a **manual bill** with no GPS.
- **Fare:** base fare, per-km, waiting, night extra and luggage, all from your own rates. Distance, waiting and extras can be corrected before billing. A waiting stopwatch is on the bill screen.
- **Fare estimate:** type a destination, pick it from the list, and the app finds your location, gets the road distance and shows the fare from your own rates, with the route on a map. Then **Start trip** begins the real GPS trip. Uses OpenStreetMap Nominatim (search), OSRM (route) and Leaflet (map). Needs internet.
- **Bill:** UPI QR with the exact amount, "Pay with UPI app" button, spoken total, and a WhatsApp receipt with date.
- **Cash or UPI** is saved for each trip.
- **Edit and delete** any trip.
- **Expenses:** fuel, rent, repair, food, other, with a date and note.
- **History:** day, month (calendar with daily income) and year views, with income, expenses and profit.
- **Sign up and profile:** name, mobile number and a 4-digit PIN are required. **Auto number, RC number and insurance (company, policy number, valid-till date) are optional.** The auto number is added to the WhatsApp bill. A red warning shows on the home screen when the insurance ends in 30 days or less.
- **PIN lock:** the app locks after 10 minutes in the background or with "Lock now". Five wrong PINs give a 5-minute wait. "Forgot PIN" erases this phone's data, which can then be restored with the cloud backup key. The PIN only stops other people from opening the app on this phone. It is not strong encryption.
- **Restore on a new phone:** "I already have a backup key" on the sign-up screen brings back the profile, trips, expenses and rates. The PIN is never copied, so a new PIN is set on the new phone.
- **Checks on typing:** numbers only, no negatives, and limits on very large values.
- **Cloud backup (Turso):** optional. A random backup key restores trips, expenses and settings on a new phone. See `server/README.md`.
- Tamil first, English with one tap. Installable PWA. Works offline.

## Run it

It is plain static files. Open `index.html` over HTTPS or on `localhost` (GPS needs a secure origin).

## Deploy on GitHub Pages

1. Create a new repo and upload all files in this folder.
2. Settings, Pages, Deploy from branch, `main` / root.
3. Open `https://<your-username>.github.io/<repo-name>/` in Chrome on Android and tap **Install app**.

## Rename the app

Change `APP_NAME` near the top of the script in `index.html`, and `name` / `short_name` in `manifest.json`.

## Android app (APK)

The `android/` folder wraps the same web app in a native Android app with two extra features:

- **Foreground GPS service:** the trip keeps measuring distance when the screen is off or the driver switches apps. A "Trip running" notification stays visible. If the app is reopened, the running trip resumes.
- **UPI soundbox:** the app reads "money received" notifications from GPay, PhonePe, Paytm and BHIM on the same phone and speaks the amount in Tamil or English. Only the amount, time and app name are saved, on the phone. Nothing is uploaded.

### Build the APK on GitHub (no Android Studio needed)

1. Push this whole folder to your repo's `main` branch.
2. The workflow in `.github/workflows/android.yml` builds the APK and publishes it under **Releases**.
3. Download `auto-anna.apk` from the latest release and install it on an Android phone.

### Sign every build with the same key (important)

Without your own key, each build is signed differently and phones refuse to update the old app.

```bash
keytool -genkeypair -v -keystore release.jks -alias autobill -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 release.jks     # copy the output
```

Add these repository secrets (Settings, Secrets and variables, Actions): `KEYSTORE_BASE64`, `STORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`. Keep `release.jks` and its passwords backed up. If you lose them, drivers must uninstall and reinstall.

### Set up the soundbox on a driver's phone

1. Open the app, Settings, **Turn on payment alerts**, and enable this app in the list.
2. If the switch is greyed out (Android 13 and newer, sideloaded apps): phone Settings, Apps, Auto Anna, three dots, **Allow restricted settings**, then try again.
3. Tap **Allow background running** and allow it, so the phone does not stop the listener.
4. Tap **Test voice**. For Tamil, the phone needs a Tamil text-to-speech voice installed. If it is missing, the app speaks in English.
5. Make sure the UPI apps are allowed to show notifications.

### Soundbox limits

- It reads English notification text. Test with each driver's UPI apps and phone language, and adjust the patterns in `PaymentListener.kt` if an app words its alert differently.
- It depends on the UPI app posting a notification. If the driver mutes or blocks those notifications, nothing is heard.
- Some phone brands (Xiaomi, Oppo, Vivo, Realme) stop background apps aggressively. Turn on auto-start and disable battery optimisation for the app.
- A notification is not proof of payment. A fake or delayed alert is possible, so drivers should still check the bank app for large amounts.
- Google Play restricts apps that read notifications or use background location. Share the APK directly first, and review Play's policies before publishing there.

## Fare estimate: services and limits

- Search uses the public Nominatim server. Its rules allow about one request per second and no search-as-you-type, so the app searches only when the driver presses Search and waits one second between searches. Keep traffic light, and use your own server or a paid provider before a large launch.
- Routes use the public OSRM demo server, which is for light use, has no guarantee, and gives free-flow time without live traffic. Self-host OSRM, or use a hosted provider, for many drivers.
- Map tiles come from OpenStreetMap's own server, which is also for light use. Keep the "© OpenStreetMap contributors" credit on the map.
- Small-town Tamil place names can be missing or wrong in OpenStreetMap. Try the town name in the search, and test your own area.
- The estimate uses road distance. Traffic, waiting and detours change the final bill, and the app says so.

## Known limits

- The browser (PWA) version only tracks GPS while the screen is on. Use the Android app for reliable tracking.
- The QR library loads from cdnjs and is then cached. To make the repo fully self-contained, download `qrcode.min.js` once, put it in the repo, and change the script `src` and `sw.js` to point to it.
- The Android project has not been compiled in this environment. Run the workflow once and fix any build error it reports.

## Roadmap

1. Renewal reminders (FC, insurance, permit, EMI)
2. Monthly report as PDF / Excel
3. Matching UPI alerts to trips
4. Staff phone relay (owner phone alerts a staff phone)
5. Paid plan on top of cloud backup

## Privacy

Trips, expenses, rates and UPI ID are stored on the phone. Nothing is sent anywhere unless the driver turns on **Cloud backup**. Then the same data is stored in your Turso database, under a random backup key. Anyone with that key can read that driver's data, and a lost key cannot be recovered. The backup includes the driver's name, mobile number, auto number, RC number and insurance details. The PIN is not uploaded.
