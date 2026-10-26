# PR celebrate

Hevy-style "Live PR": the moment a checked-off set beats a previous best, the workout logger shows a toast with the old best, buzzes the phone with a distinct pattern, and the Gym-mode banner lists every record with what it replaced.

## Files
- `pr-celebrate.js`: `window.PRCelebrate` (also CommonJS). No DOM, no storage, no network.
- `pr-celebrate.test.js`: `node --test modules/pr-celebrate/pr-celebrate.test.js`.

## API
```js
const d = PRCelebrate.describe(kinds, R, set, { name, unit, e1rm, fmtDate });
// kinds: setPRs() output, e.g. ['Est. 1RM', 'Weight']   R: records(exId, excludeWorkoutId) from the logger
// d = { kinds, lines: [{ kind, now, was, at }], headline, detail, text }
//   headline 'Bench: Weight record' | 'Squat: 3 records'
//   detail   '92.5 kg · was 90 kg × 8 on 12 Oct'
//   text     headline · detail · also <other kinds (was …)>
PRCelebrate.vibration(kinds);          // [] | [60,60,60] | [60,60,60,60,120] | [60,50,60,50,60,50,200]
PRCelebrate.fire(d, { toast, vibrate, nav }); // toast('🏆 ' + d.text) + navigator.vibrate(pattern); vibrate:false skips the buzz
PRCelebrate.bannerHtml(d, esc);        // <div class="lb-gym-pr pr-celebrate"> headline + one line per record with "was …"
PRCelebrate.css                        // the banner's extra rules (already in the logger's CSS block)
```
Units: `R` values are kg (the logger's convention); `describe` converts back to the set's unit, so an lb lift shows lb.

## In the logger
`modules/workout-logger/workout-logger.js` calls `celebration(e, s)` after `setPRs` in `completeSet` and on Gym-mode Done. With `PRCelebrate` present (it is inlined just before the logger in `build/modules.json`) the plain "New record" toast and the 15 ms tap are replaced by the celebration; without it the old behaviour stays. The user's "Vibrate when rest ends" setting also gates the PR buzz.
