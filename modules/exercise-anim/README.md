# Exercise animations (3D)

Built-in 3D animated demos that play inside the app, in Gym mode and in the exercise sheet. They don't use video files, images, libraries or the network, so they work offline. The mannequin, the poses and the equipment are original and drawn for this app. They are not copied from MacroFactor or any other app.

## What's covered
All 33 exercises in the Push/Pull/Lower templates, each authored separately with its own key poses, equipment (bench, barbell, dumbbells, cables and pulleys, rope, machine pads and levers, Smith rails, treadmill) and the main muscle highlighted in the accent colour. An exercise without a definition gets no animation. Nothing is matched from a similar name.

Gundam Chest Press is drawn as a generic seated chest press (the card says so).

## In the app
- **Gym mode:** a 210 px card under the exercise name. It auto-plays and loops. You can switch between 3D, Front and Side views or drag to turn it, and there's pause, ½× speed and full screen. The Demo button opens the full-screen view.
- **Exercise sheet → About:** the same card at the top.
- **Full screen:** large animation, the form cues and steps from the form guide, and the video link (checked video, or a search) from ExerciseDemos.
- Only visible cards animate, and the loop stops when nothing is on screen. Reduced-motion users start paused. Card state (view, speed, position in the rep) survives Gym mode re-renders.

## API
`ExerciseAnim.create()` returns `{ has(id), cardHtml(id), attach(document), open(id), close(), ids(), info }`. Set `info = id => ({ title, cues, steps, video: { href, label } })` for the full-screen text; WorkoutLogger does this when mounted with `anim`.

Pure parts for tests: `ExerciseAnim.frame(id, t)` gives `{ sk, shapes }` for t in [0,1); `ExerciseAnim.defs`, `ik`, `skeleton`, `draw(ctx, w, h, id, {t, yaw, pitch}, colors)`.

## Adding an exercise
Add an entry to `DEFS` keyed by the logger id, with `name` and `eq` exactly as in the logger library, `hi` (torso, abs, pelvis, delts, arms, forearms, thighs, calves), `keys: rep(startPose, endPose)` and `props: sk => [...]`. Poses give pelvis, torso `up`/`fwd`, and hand and foot targets: world metres, or `{t:[side, up, forward]}` relative to the torso. Elbows and knees bend toward their pole vectors, and the right side mirrors the left unless you give it. The tests check reach (hands and feet hit their targets), bone lengths, the floor, a seamless loop, and that name and equipment match the logger. Render `modules/exercise-anim` frames in a page with `draw()` to check them by eye.

Tests: `node --test modules/exercise-anim/exercise-anim.test.js`
