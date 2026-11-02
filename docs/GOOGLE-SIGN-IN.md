# Sign in with Google (Mizan, Android)

The sign-in sheet has **Continue with Google** above the email fields (`modules/cloud-store`). In the
Android app it opens Android's own Google account chooser (Credential Manager, `GoogleSignInPlugin.kt`)
and hands the Google ID token to Firebase Auth (`signInWithCredential`), so a person who uses Google
gets a normal Firebase account: same `users/{uid}` data, same Firestore rules, same Friends features.
On the website copy it uses Firebase's Google pop-up. Nothing paid; no client secret in the APK.

Until the two Firebase steps below are done, the button says *"Google sign-in isn't switched on in
this build yet. Use your email for now."* and email sign-in keeps working as before.

## Aziz's one-time setup (Firebase console, project `aziz-fitness`, about 5 minutes)

1. **Enable Google.** https://console.firebase.google.com → aziz-fitness → Build → Authentication →
   Sign-in method → *Add new provider* → **Google** → Enable → pick your Gmail as the support email →
   Save.
2. **Register the Android app with its signing key.** Gear icon → Project settings → General → *Your
   apps* → *Add app* → Android:
   - Package name: `com.azizfitness.app`
   - Nickname: Mizan
   - SHA-1: `B4:AD:41:67:BA:DD:77:D4:CB:3F:05:A3:C5:D9:E4:2F:E2:AB:DB:89` (the release signing key,
     `aziz-signing-key.jks`; this is what every APK from CI is signed with)
   - Register app, then **Next / Next / Continue to console**. You do not need the
     `google-services.json` download; the app does not use it.
   If the app already exists there, open it and *Add fingerprint* with the SHA-1 above instead.
3. **Copy the Web client ID.** Authentication → Sign-in method → Google → expand *Web SDK
   configuration* → copy **Web client ID** (looks like `323272267870-xxxx.apps.googleusercontent.com`).
   Paste it into `app/cloud-config.js` as `googleClientId` (or paste it in the chat and the thread will
   commit it). A new APK builds from main; phones get it with Settings → Update.

That is all. Existing accounts are untouched: a friend who already created an email account and later
taps Google with the same Gmail signs into the **same** account (Firebase links the Google provider to
it), so nothing is lost or duplicated.

## If something is off

- *"Google sign-in didn't work"* on the phone right after setup: the Android OAuth client is missing.
  Google Cloud console → project aziz-fitness → APIs & Services → Credentials: there should be an
  **Android** OAuth client with package `com.azizfitness.app` and the SHA-1 above. Create one if not
  (Firebase makes it automatically when step 2 is done after step 1).
- A friend sees *"Access blocked: this app has not completed verification"*: Google Cloud console →
  Google Auth Platform → Audience → **Publish app** (basic profile/email scopes need no review).
- *"No Google account on this phone"*: add one in Android Settings → Accounts, or use email.
- Debug builds from Android Studio use a different key; add that machine's debug SHA-1 as a second
  fingerprint if you ever sign in from one.
