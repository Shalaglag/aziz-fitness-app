# Exercise animations (3D)

Built-in 3D animated demos that play inside the app, in Gym mode and in the exercise sheet. They don't use video files, images, libraries or the network, so they work offline. The mannequin, the poses and the equipment are original and drawn for this app. They are not copied from MacroFactor or any other app.

## What's covered
All 318 exercises in the workout logger's library: the 33 in the Push/Pull/Lower templates, 80 more (chest, back, shoulders, arms, legs, glutes, abs and the five cardio machines) and the 65 Tier 1 additions (Oct 31: the most common Strong exercises that were missing, for example dumbbell and cable variants, grip variants, deadlift variants, lunges, step ups, floor core work, side plank, outdoor walk, run and ride) plus the 92 Tier 2 additions (more cable, Smith, plate-loaded and machine variants, single-leg and bodyweight work, floor core moves, swimming, jump rope, air bike and kettlebell) and the 47 Tier 3 additions (landmine, Zercher, box, overhead and hack squats, sissy squat, wall sit, dead hang, toes to bar, dragon flag, ab wheel, farmer's walk, ski erg, stepmill, Turkish get-up, burpee, thruster and power clean) and the Copenhagen plank (from the swap list). Each is authored separately with its own key poses, equipment (bench, barbell, EZ bar, dumbbells, cables and pulleys, rope, machine pads and levers, Smith rails, pull-up and dip bars, mats, cardio machines) and the main muscle highlighted in the accent colour. An exercise without a definition gets no animation. Nothing is matched from a similar name.

Nothing is uncovered: the 11 swap-only suggestions in ExerciseSwap now map to logger exercises (Copenhagen Plank was added). Plank is a still hold, so its view turns slowly instead of repeating a rep. Gundam Chest Press is drawn as a generic seated chest press (the card says so).

## In the app
- **Gym mode:** a 210 px card under the exercise name. It auto-plays and loops. You can switch between 3D, Front and Side views or drag to turn it, and there's pause, ½× speed and full screen. The Demo button opens the full-screen view.
- **Exercise sheet → About:** the same card at the top.
- **Full screen:** large animation, the form cues and steps from the form guide, and nothing external: no video links and no search buttons.
- Only visible cards animate, and the loop stops when nothing is on screen. Reduced-motion users start paused. Card state (view, speed, position in the rep) survives Gym mode re-renders.

## API
`ExerciseAnim.create()` returns `{ has(id), cardHtml(id), attach(document), open(id), close(), ids(), info }`. Set `info = id => ({ title, cues, steps })` for the full-screen text; WorkoutLogger does this when mounted with `anim`.

Pure parts for tests: `ExerciseAnim.frame(id, t)` gives `{ sk, shapes }` for t in [0,1); `ExerciseAnim.defs`, `ik`, `skeleton`, `draw(ctx, w, h, id, {t, yaw, pitch}, colors)`.

## Adding an exercise
Add an entry to `DEFS` keyed by the logger id, with `name` and `eq` exactly as in the logger library, `hi` (torso, abs, pelvis, delts, arms, forearms, thighs, calves), `keys: rep(startPose, endPose)` and `props: sk => [...]`. Poses give pelvis, torso `up`/`fwd`, and hand and foot targets: world metres, or `{t:[side, up, forward]}` relative to the torso. Elbows and knees bend toward their pole vectors, the right side mirrors the left unless you give it, and `handDir` bends the wrist (wrist curls). `like(id, f)` reuses another exercise's key poses; `still: true` is for holds. The tests check reach (hands and feet hit their targets), bone lengths, the floor, a seamless loop, and that name and equipment match the logger. Render `modules/exercise-anim` frames in a page with `draw()` to check them by eye.

Tests: `node --test modules/exercise-anim/exercise-anim.test.js`

Look (Nov 1): neutral grey body, target muscles drawn red with fibre lines (secondary muscles pale red), belly shapes (pecs, glutes, biceps, quads, calves) only on highlighted groups, so the rest stays a clean silhouette. The highlight colour is a fixed red, not the app accent.

## Video clips (Nov 1)
`clips.json` (inlined as `window.EXERCISE_CLIPS`) lists Blender-rendered MP4 demos kept in `app/clips/<exercise-id>.mp4`. Each entry records file, bytes, sha256, revision, source, licence, primary and secondary muscles, and a status. `preview` offers a Video/Rotate switch while 3D stays the default; `approved` makes the video the default view; any other status is ignored. Only Aziz moves a clip to `approved` (set `reviewedBy`, `reviewedAt`). A missing or broken file falls back to the 3D card. One video plays at a time and only while on screen; pause and ½× work as on the 3D card. Red is the main muscle, amber the helpers, in the clips and the 3D demos. The tests check every clip against its recorded size and hash. Clips are 1080×1080, 30 fps, 6.8 s (two reps) and loop.

`clips.json` has `defaultMode: "3d"` (Nov 1, Aziz set aside the generated clips): every card opens on the 3D demo and `preview` clips stay behind the Video switch; only `approved` clips open as Video. `defaultMode: "clip"` makes every listed `preview` or `approved` clip open as Video again.

## List pictures (Nov 1)
`anim.thumb(id)` returns a small WebP for exercise lists: the clip still `clips/thumbs/<id>.webp` when the exercise has a usable clip, else the 3D still `clips/thumbs3d/<id>.webp`, else `null` (the logger shows a letter circle). Remake them after adding clips with `node tools/clip-thumbs/make-thumbs.js` (ffmpeg, a frame a quarter into the clip, 144×144) and after adding or changing 3D demos with `node tools/clip-thumbs/make-3d-thumbs.js` (Playwright). The tests fail when a clip or a 3D demo has no picture.

## Shared 3D body (Nov 1)
When `window.Exercise3D.has(id)` (modules/exercise-3d), the Rotate view paints the real-time 3D body instead of the line mannequin, tagged "3D body · preview". The line mannequin shows while the body loads or if WebGL fails. With the body ready the card loop is capped at 60 fps. Motion keys may set `ease: 'in' | 'out' | 'linear'` per key so a movement can pass through middle keys without stopping (the Bayesian curl's hand arc uses this).
