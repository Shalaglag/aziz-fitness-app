# Gym sounds

Strong-style workout cues, synthesised in code (original sounds, not Strong's files; no audio assets in the web app).

- `restDone`: ding-ding-DING (two quick G6 bell strikes, then a longer C7), when a rest timer reaches 0.
- `finish`: a rising C6-E6-G6-C7 chime over a soft C5, when a workout is finished and saved.

## API
```js
GymSounds.prime();            // call inside a tap so Android/Chrome let audio play later (the logger does this on set ticks and timer starts)
GymSounds.play('restDone');   // true if it played; false without Web Audio
GymSounds.render(name, sr);   // Float32Array, the exact samples play() uses
GymSounds.wav(name, sr);      // 16-bit mono WAV bytes
```

## Where it plays
- Workout logger: `beep()` (rest over) and `finishSave()` (Finish). Both follow the logger's "Beep when rest ends" setting (Settings, Train). Without this module the logger falls back to its old three tones.
- Quick log rest bar (`build/shell.html`, `tickTimer`): rest over, with the same setting. It also fires `lb:rest` / `lb:rest-stop`, so Android schedules the background notification for Quick log too.
- Android, phone locked or app in the background: the rest notification uses channel `rest_v1` whose sound is `android/app/src/main/res/raw/rest_done.wav`, the same ding. Regenerate it after changing the sound: `node modules/gym-sounds/make-wav.js` (the test fails if it is stale). Android fixes a channel's sound when it is created, so a changed sound also needs a new channel id in `modules/android-shell`.

## Tests
`node --test modules/gym-sounds/gym-sounds.test.js`; the phone test "sounds: …" in `tests/app-phone.test.js` checks both cues fire and that the setting silences them.
