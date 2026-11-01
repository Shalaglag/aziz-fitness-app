# App update

An **Update** button inside the Android app, so new builds install without downloading the APK by hand.

## How it works
1. CI puts every main build on the private release `android-latest` (body: `Newest build from main (build N, sha)`, asset `aziz-fitness.apk`, versionCode = N).
2. The app reads that release with a **read-only GitHub key**: a fine-grained token for this one repo with Contents: Read-only. You paste it once in Settings → App updates. It is kept in this phone's localStorage (`aziz-update-token`) only. It is never in the APK, never in Firestore or `prefs`, and never in backups (DataIO only exports `aziz-cut`).
3. If build N is higher than the installed versionCode, Settings shows **Update now** and Today shows a banner. Checks run at start-up and on resume, at most every 6 hours, and only with a key.
4. The native plugin downloads the APK into the app cache. The key is sent only to `api.github.com`, never to the signed redirect URL. The plugin refuses the file unless all of these hold:
   - it is `com.azizfitness.app`;
   - its build is newer than the installed one;
   - it is signed with the same certificate as the installed app.

   It then opens Android's installer, where you tap Update. The first time, Android asks you to allow installs from Aziz Fitness, and the card has an **Allow updates** button for that. Data stays because the key is the same.

## Files
- `app-update.js`: `window.AppUpdate` with `bind({render, toast})`, `cardHTML()`, `bannerHTML()`, `check()`, `update()`, `autoCheck(now)`, `parseRelease(json)`, `compare(current, latest)`, `errorText(code, status)`, `TOKEN_URL`, `css`.
- `android/AppUpdatePlugin.kt`: Capacitor plugin `AppUpdate`, with `info`, `canInstall`, `openInstallSettings`, `latest({token,url})`, `download({url,token,minVersion})` (emits `progress`) and `install({path})`. This is the source of truth. The compiled copy in `android/app/src/main/java/com/azizfitness/app/` must be identical, and the test checks that. It is registered in `MainActivity`. The manifest declares `REQUEST_INSTALL_PACKAGES`, and it uses the existing `${applicationId}.fileprovider` (cache-path).

## Tests
`node --test modules/app-update/app-update.test.js`
