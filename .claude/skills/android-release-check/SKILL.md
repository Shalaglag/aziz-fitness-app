---
name: android-release-check
description: Use to confirm which Android build contains a change, that it is signed with Aziz's key and updatable, and to write the short phone-check list for Aziz.
---

# Android release check

Repeated after nearly every merge since Oct 26 2026 (Android thread, coach, WaterH, Strong import,
layout, Nippard threads). Facts: `docs/ANDROID.md`, `modules/app-update/README.md`.

## How a build happens
`.github/workflows/android.yml` on every PR and push to main: `npm ci` → `node build/build.js --check`
→ `npx cap sync android` → `gradlew assembleRelease bundleRelease -PversionCode=<run number>`.
Main pushes attach `aziz-fitness.apk`, `aziz-fitness.aab` and `latest.json` to the private release
`android-latest` and copy APK + `latest.json` to the public repo `Shalaglag/mizan-releases`
(release `android-latest`), which the in-app updater reads. Build number = the workflow run number.

## Steps
0. **Bug reports: reproduce on the build Aziz has.** Ask or read which build he is on (Settings →
   App updates shows it; he writes things like "build 233"). Reproduce in the built app at phone
   size before changing code. The back-button fix (PR #120) was wrong on the device and had to be
   redone (PR #146); the food-form fix was "not working" because build 233 predated it (fix was 236).
1. **Find the build number** after a merge: GitHub MCP `actions_list` / `actions_get` for the
   `Android` workflow run on main, or read
   `https://github.com/Shalaglag/mizan-releases/releases/download/android-latest/latest.json`
   (`build`, `sha`). The `sha` must be the merge commit. Allow about 4 minutes after the merge.
2. **Signing (only if the key or workflow changed):** the release APK uses v2 signing only, so
   `keytool -printcert -jarfile` finds nothing; parse the APK Signing Block and SHA-256 the cert, then
   compare with the cert in `/mnt/project-files/fitness-app/android/aziz-signing-key.jks` (alias
   `aziz`). Download the asset through the API with `Accept: application/octet-stream` (the browser
   URL 404s through the proxy). The repo secret `ANDROID_KEYSTORE_BASE64` must exist; a CI warning
   "signed with a one-off key" means the APK will NOT install over the old one.
3. **Never ask Aziz to uninstall.** Updates must install over the old app and keep data.
4. **Tell Aziz** one message: build number (always a number, he asks "which build" otherwise),
   how to get it (Update in Settings → App updates, or the public release page
   `https://github.com/Shalaglag/mizan-releases/releases/tag/android-latest`), and a numbered yes/no
   list of only the checks that need a real phone (sounds, notifications, sensors, sign-in, sync,
   mic). Keep it to what the change touched; 3–6 items. Friends install from the same public page.
5. **Record the result.** When Aziz answers, mark the check done in the checklist; do not call a
   device feature verified until he has said so.

## Completion check
- Build number named and tied to the merge commit.
- No signing warning in the Android run log (when relevant).
- Phone checks listed; results recorded when they arrive.

## Known blockers
- GitHub Actions artifact storage quota can be full; the workflow continues (`continue-on-error`),
  the release attachment is what ships.
- Play Store, paid services or public exposure need Aziz's explicit yes.
