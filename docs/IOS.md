# The iPhone app

Since Nov 15, 2026 Mizan also has an iPhone target: the same `app/index.html` wrapped with Capacitor in `ios/`, next
to `android/`. Nothing in the app was rewritten and the Android app is unchanged. Bundle ID `com.azizfitness.app`
(same as the Android package), name **Mizan**, the Mizan icon, iPhone only, portrait, iOS 15 or newer.

## How it gets to an iPhone

Apple only lets an app onto an iPhone through its own channels, and every channel needs a paid **Apple Developer
Program** membership ($99 a year). There is no iPhone equivalent of the APK link. The plan here is **TestFlight**:
Apple's free beta-testing app. A build uploaded by CI shows up in TestFlight on the iPhone, installs with one tap,
updates itself, and can be shared with up to 100 people by email (internal) or 10,000 by link (external, after a short
Apple review). Each build works for 90 days; a new build from CI resets that. No App Store listing is needed.

Building needs a Mac. CI uses GitHub's macOS runner (`.github/workflows/ios.yml`), so nobody needs a Mac.

## Aziz's one-time setup

Only Aziz can do these; each needs his Apple ID. Nothing is paid until step 1.

1. **Join the Apple Developer Program** ($99/year): https://developer.apple.com/programs/enroll/ with your Apple ID
   (individual). Approval usually takes up to 48 hours.
2. **Note your Team ID**: https://developer.apple.com/account → Membership details → *Team ID* (10 characters).
3. **Create the app record**: https://appstoreconnect.apple.com → Apps → **+** → New App → iOS, name *Mizan* (if the
   name is taken, *Mizan Fitness*), language English, Bundle ID: choose *com.azizfitness.app* (if it isn't listed,
   first register it at developer.apple.com → Certificates, IDs & Profiles → Identifiers → **+** → App IDs →
   Explicit `com.azizfitness.app`), SKU `mizan`. Save.
4. **Make an API key for CI**: App Store Connect → Users and Access → Integrations → App Store Connect API →
   Team Keys → **+** → name *GitHub CI*, access **Admin** (needed so CI can create the signing certificate itself)
   → Generate. Download the `.p8` file (only possible once) and note the **Key ID** and the **Issuer ID** above
   the list.
5. **Add four GitHub secrets**: https://github.com/Shalaglag/aziz-fitness-app/settings/secrets/actions →
   New repository secret, one each:
   - `APPLE_TEAM_ID`: the Team ID from step 2
   - `ASC_KEY_ID`: the Key ID
   - `ASC_ISSUER_ID`: the Issuer ID
   - `ASC_KEY_P8_BASE64`: the `.p8` file as base64. On Windows PowerShell:
     `[Convert]::ToBase64String([IO.File]::ReadAllBytes("$HOME\Downloads\AuthKey_XXXX.p8")) | Set-Clipboard`
     then paste.
   Never paste these into a chat.
6. **First build**: https://github.com/Shalaglag/aziz-fitness-app/actions/workflows/ios.yml → **Run workflow** →
   main. About 15 minutes, then 5–30 minutes of Apple processing. App Store Connect may e-mail about export
   compliance; the app already declares it uses no non-exempt encryption.
7. **Install**: on the iPhone install **TestFlight** from the App Store. In App Store Connect → Mizan → TestFlight →
   Internal Testing → **+** group → add yourself (your Apple ID email). Open the invite on the iPhone → Accept →
   Install. Sign in with the same Mizan account as on Android; your data is the same Firebase data.
8. **Optional, automatic updates**: GitHub → Settings → Secrets and variables → Actions → *Variables* → New
   variable `IOS_TESTFLIGHT` = `true`. Then every merge to main also uploads an iPhone build (uses macOS runner
   minutes, see below). Without it, run step 6 whenever you want a new iPhone build.
9. **Optional, Google sign-in on iPhone**: Firebase console → aziz-fitness → Project settings → Your apps → Add app →
   iOS, bundle ID `com.azizfitness.app` → Register → download `GoogleService-Info.plist`, open it and copy
   `CLIENT_ID` (ends in `.apps.googleusercontent.com`; not a secret). Paste it in the chat, or into
   `app/cloud-config.js` as `googleIosClientId`. Until then the iPhone app signs in with email and password.
   If your account was made with Google only, either do this step or, on Android, add a password first.

## What works on iPhone, and what doesn't yet

Works the same as Android: every screen and module, offline logging, Firebase sign-in (email) and sync, Friends,
local notifications (rest over, reminders), progress photos, GPS run tracker, status bar
colours, haptics, keyboard handling, the coach chat (same server).

Different or missing on iPhone (plugin absent → the feature hides or falls back; nothing crashes):

| Android feature | iPhone today | Later option |
|---|---|---|
| Health Connect water (WaterH) and steps | Not available; log water by hand | Apple HealthKit plugin (WaterH writes to Apple Health) |
| Fitbit/Google Health water | Not available | Same plugin as Android would need an iOS port |
| In-app Update button (APK) | Updates come from TestFlight (card in Settings says so) | — |
| Live workout notification with buttons, rest bell that dims music | A plain "Rest is over" notification with the default sound | Live Activity (lock-screen timer) |
| Music controls (now playing, play/pause) | Hidden | Apple's MPNowPlaying API |
| Voice logging (native speech) | Hidden unless the web speech engine is available | Apple Speech plugin |
| Google sign-in | After step 9 (Swift plugin `GoogleSignIn`, no Google SDK) | — |
| Barcode scanning with the camera (Chrome's BarcodeDetector) | Type the barcode number; lookup works the same | A native scanner plugin |
| Android back button | iPhone has none; every sheet has its close button | — |

## Developer notes

- `ios/App/App/public` and `capacitor.config.json` copies are generated by `npx cap sync ios` (gitignored); CI runs it.
- Native code of our own: `ios/App/App/GoogleSignInPlugin.swift` (source of truth
  `modules/cloud-store/ios/GoogleSignInPlugin.swift`, a test checks the copies match), registered in
  `MainViewController.swift` (the storyboard's bridge controller).
- Swift Package Manager, no CocoaPods: `ios/App/CapApp-SPM/Package.swift` is written by `npx cap sync ios`.
- JS can tell the platforms apart with `AndroidShell.platform()` (`"android" | "ios" | "web"`); `<html>` gets
  `ios-app` or `android-app`.
- Build number = the iOS workflow run number (must only go up for TestFlight).
- **Costs**: the private repo's free GitHub Actions minutes count macOS at 10x. A simulator build on a PR is about
  10 real minutes (≈100 counted). Pull requests only build iOS when they touch `ios/` or its workflow. GitHub never
  charges beyond the free minutes unless a spending limit is set.
