# Voice logging ("Log by voice" / "Say what you ate")

Speak a set or a meal instead of typing it. Plain JS, no imports, no network of its own.

- `voice-log.js`: the module (`VoiceLog`). API in the header comment.
- `voice-log.test.js`: `node --test modules/voice-log/voice-log.test.js` (number words, set grammar, exercise matching against the logger library, cardio/duration, multi-exercise sentences, fallbacks).

## Where it shows
- **Train**: a mic button in the live-workout header (Gym mode and list view). It opens a sheet: tap the mic, say
  `bench 60 for 10, 10, 8`, check the parsed exercise / weight / reps (all editable), press **Add sets**. The logger
  (`WorkoutLogger.applyVoice`) fills that exercise's pending sets first, then appends, marks them done and flags records.
  Exercises already in the workout win ties ("bench" picks the bench you are doing today). With no exercise named,
  the set goes to the exercise currently open in Gym mode.
- **Food**: a "Say what you ate" card above "Log from a photo or description". The transcript is dropped into that card's
  box and Estimate is pressed, so Claude's estimate flow (editable numbers, Add) is unchanged.

## Grammar understood
`<exercise> <weight> [kg|lb] for|x|by <reps> <reps> ...`, `<weight> kilos <reps> reps <n> sets`, `<n> sets of <reps>`,
`at <weight>`, spoken numbers ("sixty for ten ten eight"), bodyweight = reps only (`pull ups 8 7 6`), cardio
(`treadmill 30 minutes 2 km`), duration (`plank 45 seconds`), and `then` / `and` between exercises.

## Speech
**In the Android app** the WebView cannot reach the microphone, so `android/SpeechPlugin.kt` (native `Speech` plugin,
Android's `SpeechRecognizer`) listens instead: the first tap asks for the microphone permission (`RECORD_AUDIO` in the
manifest), partial text streams into the box, and the final text goes through the same parser. The compiled copy lives in
`android/app/src/main/java/com/azizfitness/app/` and the test checks it is identical; it is registered in `MainActivity`.

**In a browser**, `SpeechRecognition` (Chrome on Android, Chrome/Edge desktop) when the page may use the microphone. Inside an embed that
blocks the mic, or in a browser without the API, the mic button explains and the same box takes **keyboard voice typing**
(Gboard's mic), which is parsed identically. The Artifact runtime has no microphone capability to declare, so nothing
changes in the app's publish; if the embed blocks the mic, keyboard dictation is the path.
