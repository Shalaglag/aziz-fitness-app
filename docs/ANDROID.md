# The Android app

Since Oct 26, 2026 the app ships as an Android app: the same `app/index.html` (built by `build/build.js`) wrapped
with [Capacitor](https://capacitorjs.com) in `android/`. Nothing was rewritten; every module runs unchanged inside
the app's WebView. The web/Claude versions still work from the same file.

## Install it on the phone (first time)

1. On the phone, open https://github.com/Shalaglag/aziz-fitness-app/releases/tag/android-latest (sign in to GitHub
   if asked; the repo is private).
2. Tap **aziz-fitness.apk**. Chrome downloads it; tap **Open** in the download bar (or open it from Files → Downloads).
3. Android asks to allow installs from Chrome once: **Settings → Allow from this source**, then back, then **Install**.
4. Open **Mizan** from the home screen. Allow notifications when asked (the rest timer uses them).

## Update it

**From inside the app (build 72 and later):** open Settings, then App updates. The first time, paste a read-only GitHub key; the card has the steps and a link to GitHub's key page. Choose only this repository and Contents: Read-only. From then on, the app checks for a newer build at start-up. When there is one, a banner on Today and **Update now** in Settings download it. Android then asks you to confirm. The app only installs a newer build signed with your key (see `modules/app-update/README.md`).

**By hand:**

Open the same release page, download the newest `aziz-fitness.apk`, tap it, **Update**. Your data stays: every build
is signed with the same key (see Signing below) and gets a higher version number, so Android
installs it over the old one without uninstalling. Never uninstall to update; that deletes on-device data that is not
in Firebase yet.

## Where the data lives

- Inside the app the shell saves through `modules/cloud-store` when `app/cloud-config.js` has a Firebase config:
  sign in once, then everything is in Firestore under your account, with Firestore's offline cache plus the
  pending-writes outbox so gym logging works with no signal and syncs later. Reinstalling or changing phones:
  sign in again and the data comes back.
- With an empty `cloud-config.js` the app saves in the WebView's localStorage only (header says
  "Saved in this browser only"). Guide → export makes a backup file.
- Firebase Auth inside the app runs on the `https://localhost` origin; `localhost` is in Firebase's authorized
  domains by default, so no console change is needed.

## How a build happens

`.github/workflows/android.yml` runs on every PR and push to `main`:
`npm ci` → `node build/build.js --check` → `npx cap sync android` (copies `app/` into the project) →
`./gradlew assembleRelease bundleRelease` with `versionCode` = the run number. PRs keep the APK as a workflow
artifact; pushes to `main` attach `aziz-fitness.apk` and `aziz-fitness.aab` to the `android-latest` release.
The Android SDK lives on the CI runner; nothing needs installing on the PC.

Building locally instead (needs Android Studio or the SDK + JDK 21): `npm install`, then `npm run android:apk`
(APK in `android/app/build/outputs/apk/release/`) or `npm run android:open` for Android Studio.

## Signing (one-time setup, needed before the first "update over the old app" works)

Android only installs a new APK over the old one when both are signed with the same key. The key file is not in
the repo; it is in the project files (`fitness-app/android/aziz-signing-key.jks`, base64 copy next to it) and CI
reads it from a repository secret:

1. Open https://github.com/Shalaglag/aziz-fitness-app/settings/secrets/actions → **New repository secret**.
2. Name: `ANDROID_KEYSTORE_BASE64`. Value: the whole text of `aziz-signing-key.base64.txt` (one long line).
3. Save. The next push to `main` (or Actions → Android → Run workflow) builds with that key.

Until the secret exists CI signs with a throwaway key and prints a warning; such an APK installs fine but the next
one will say "App not installed" unless the old one is uninstalled first (export data from Guide before that).
Key alias `aziz`, store/key password `azizfitness` (defaults in `android/app/build.gradle`; override with the
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` secrets for a different key, for example a
Play Store upload key later; Play is not enabled and needs Aziz's go-ahead and a $25 developer account).
Changing the key means the next APK cannot install over the old one (export data first, uninstall, install, import).

## What is native-aware (modules/android-shell)

- Hardware back button: closes an open sheet, else returns to Today, else minimises the app (a running workout
  is kept).
- Status bar colour follows the app theme (light/dark/system).
- Rest timer: a local notification fires when the rest ends while the app is in the background. It rings the same ding as the app (channel "Rest timer", `res/raw/rest_done.wav`); its sound and volume can be changed in Android Settings, Apps, Mizan, Notifications.
- Permissions declared: internet, vibrate, wake lock (keep screen on during a workout), notifications, exact
  alarms, camera (food and progress photos through the normal file picker), location (GPS run tracker; asked
  the first time a run starts).
- Offline from the first launch: Firebase ships inside the app (`app/vendor/firebase-10.14.1`, loaded before the
  CDN), so sign-in is remembered and logging syncs later with no signal. Entries saved on the phone without an
  account are added to the account once after signing in; anything already in the account is left as it is.
- The service worker is not registered inside the app (the APK already contains the app; a cache would show the
  previous version after an update).

## Known gaps (next steps)

- Voice logging: Android's WebView has no SpeechRecognition; the boxes still accept the keyboard's mic. A
  speech plugin can add true in-app recognition later.
- Health Connect (WaterH hydration) is being built as a Kotlin plugin in `modules/health-connect/android/`;
  register it in `MainActivity` when it lands.
- Home-screen widgets, biometric lock and background sync are not started.
- Claude AI coach needs its backend (see `netlify/functions/coach.mjs`); the app shows the offline/unavailable state
  until that is live.
