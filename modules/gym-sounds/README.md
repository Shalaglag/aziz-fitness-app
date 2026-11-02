# Gym sounds

Strong-style workout cues, synthesised in code (original sounds, not Strong's files), plus Aziz's own recorded Check sound.

- `restDone`: ding-ding-DING (two quick G6 bell strikes, then a longer C7), when a rest timer reaches 0.
- `finish`: a rising C6-E6-G6-C7 chime over a soft C5, when a workout is finished and saved.
- `doubleDing` Double ding (yours): rebuilt from Aziz's own recording (Nov 1, 2026): two strikes 0.19 s apart, inharmonic partials over 743 Hz. It is a synthesised copy, not the recording, so it also rings on a locked phone.
- Rest sounds (`GymSounds.REST_SOUNDS`, picked in Settings → Workout → Sound when rest ends): `restDone` Bell (Strong-style, default), `boxing` Boxing bell, `dingdong` Ding-dong, `beeps` Watch beeps, `whistle` Coach whistle, `gong` Gong, `knock` Wood knock.
- Anime-style pack (`pack: 'anime'`, its own row in Settings): `powerup` Power-up, `blast` Energy blast, `aura` Aura charge, `scouter` Scouter, `teleport` Teleport, `impact` Big hit. Original effects; no voices or clips from any show (that audio is copyrighted).
- Your own sound: `setCustom(file)` keeps one audio file (≤ 3 MB, plays up to 20 s) in IndexedDB `gym-sounds` on this device only, never in backups or sync. Settings → "Add your own sound" saves it and picks `restSound: 'custom'`. Android can't ring an imported file from a notification, so a locked phone rings the bell for it.

- Set done (`GymSounds.SET_SOUNDS`, picked in Settings → Workout → Sound when you tick a set; logger setting `setSound`, default `check`, or `off`): `check` Check (yours) is Aziz's own recording (Nov 2, 2026), trimmed to the chime, denoised and normalised into `check.mp3` (12 KB) and embedded as base64 in `clips.js` (run `node modules/gym-sounds/make-clips.js` after changing the mp3; the test fails if it is stale). Others: `tap` Soft tap, `blip` Blip, `ping` Ping, `knock` Wood knock, `doubleDing` Double ding. The clip is decoded on the first `prime()`; a play before that decodes and plays as soon as it is ready.

## API
```js
GymSounds.prime();            // call inside a tap so Android/Chrome let audio play later (the logger does this on set ticks and timer starts)
GymSounds.play('restDone');   // true if it played; false without Web Audio
GymSounds.render(name, sr);   // Float32Array, the exact samples play() uses
GymSounds.wav(name, sr);      // 16-bit mono WAV bytes
GymSounds.rawName(id);        // Android res/raw file for a rest sound: rest_done.wav, rest_boxing.wav, …
```

## Where it plays
- Workout logger: `beep()` (rest over) and `finishSave()` (Finish). Both follow the logger's "Beep when rest ends" setting (Settings, Train). Without this module the logger falls back to its old three tones.
- Quick log rest bar (`build/shell.html`, `tickTimer`): rest over, with the same setting. It also fires `lb:rest` / `lb:rest-stop`, so Android schedules the background notification for Quick log too.
- Android, phone locked or app in the background: the rest notification plays the picked sound. The bell uses channel `rest_v1` (`res/raw/rest_done.wav`); every other rest sound has channel `rest_<id>_v1` and `res/raw/rest_<id>.wav` (`AndroidShell.channelFor`). Regenerate the wavs after changing a sound: `node modules/gym-sounds/make-wav.js` (the test fails if one is stale). Android fixes a channel's sound when it is created, so a changed sound also needs a new channel id (`_v2`) in `modules/android-shell`.

## Tests
`node --test modules/gym-sounds/gym-sounds.test.js`; the phone test "sounds: …" in `tests/app-phone.test.js` checks both cues fire and that the setting silences them.
