# App update

An **Update** button inside the Android app, so new builds install without downloading the APK by hand.

## How it works
1. CI puts every main build on the private release `android-latest` of the code repo (body: `Newest build from main (build N, sha)`, assets `aziz-fitness.apk`, `aziz-fitness.aab`, `latest.json`, versionCode = N) **and**, when the `RELEASES_TOKEN` secret exists, copies `aziz-fitness.apk` + `latest.json` to the release `android-latest` of the **public releases-only repo `Shalaglag/mizan-releases`** (no code there, ever).
2. The app reads `https://github.com/Shalaglag/mizan-releases/releases/download/android-latest/latest.json` (`{build, versionName, sha, size, at}`) with **no key and no account**, so anyone given the APK gets updates. Advanced fallback: a read-only fine-grained GitHub key for the private code repo (Contents: Read-only), pasted behind "Advanced: use a GitHub key" in Settings → App updates; it is kept in this phone's localStorage (`aziz-update-token`) only, never in the APK, Firestore, `prefs` or backups (DataIO only exports `aziz-cut`). The public file always wins when it exists; the key is only used when `latest.json` is missing (404), and only sent to `api.github.com`.
3. If build N is higher than the installed versionCode, a full-screen **Update required** popup appears (Update now, plus Close / the back button to skip it), Settings shows **Update now** and Today shows a banner. Checks run every time the app is opened or brought back to the front (at most every 10 minutes); a closed popup comes back on the next open or resume.
4. The native plugin downloads the APK into the app cache (following GitHub's redirects to the file CDN). The plugin refuses the file unless all of these hold:
   - it is `com.azizfitness.app`;
   - its build is newer than the installed one;
   - it is signed with the same certificate as the installed app.

   It then opens Android's installer, where you tap Update. The first time, Android asks you to allow installs from Aziz Fitness, and the card has an **Allow updates** button for that. Data stays because the key is the same.

## Files
- `app-update.js`: `window.AppUpdate` with `bind({render, toast})`, `cardHTML()`, `bannerHTML()`, `promptHTML()`, `onOpen(now)`, `check()`, `update()`, `autoCheck(now)`, `parseLatest(json)`, `parseRelease(json)`, `compare(current, latest)`, `errorText(code, status)`, `LATEST_URL`, `APK_URL`, `TOKEN_URL`, `css`.

## One-time setup of the public releases repo (Aziz)
1. Create a public, empty repository named exactly `mizan-releases` under `Shalaglag` (no code goes there; CI only attaches the APK and `latest.json` to a release).
2. Make a fine-grained token for that one repo with Repository permissions → Contents: Read and write (nothing else), and add it to the code repo as the Actions secret `RELEASES_TOKEN`.
3. The next push to `main` (or Actions → Android → Run workflow) publishes the first public build. Until then the card says "No update has been published yet" and a phone with a key falls back to the private release.
- `android/AppUpdatePlugin.kt`: Capacitor plugin `AppUpdate`, with `info`, `canInstall`, `openInstallSettings`, `latest({token,url})`, `download({url,token,minVersion})` (emits `progress`) and `install({path})`. This is the source of truth. The compiled copy in `android/app/src/main/java/com/azizfitness/app/` must be identical, and the test checks that. It is registered in `MainActivity`. The manifest declares `REQUEST_INSTALL_PACKAGES`, and it uses the existing `${applicationId}.fileprovider` (cache-path).

## Tests
`node --test modules/app-update/app-update.test.js`
