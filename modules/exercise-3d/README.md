# exercise-3d: the shared real-time 3D body (phase 1)

One skinned body (MakeHuman CC0, Extreme build reshaped to Aziz's Baki mesh, 200k triangles, 68 bones with three per finger; look A "Studio", both locked by Aziz on Nov 1) drives every listed exercise from the motions already in `modules/exercise-anim` (`ExerciseAnim.sample` + `skeleton(p, BODY)`). Equipment comes from each motion's `props`. Muscles are coloured per vertex: primary red `#d9392c`, secondary amber `#f0a030`.

## In the app
- The Rotate view of an exercise card shows this body when the exercise is listed in `exercises.json`, otherwise the line mannequin. The Video view (clips) is unchanged.
- Loaded on first use: `vendor/three-r160/` (three.js r160, MIT) and `3d/body.glb` + `3d/body_meta.json` + `3d/normal_A.png` from `app/`. One WebGL renderer draws all cards, with soft shadows (PCFSoft, 1024 map).
- Look A (Studio): MeshStandardMaterial #c9ccd0, roughness 0.62 (0.48 on highlighted muscles), normal map `normal_A.png` (muscle grooves, scale 1, flipY false), RoomEnvironment light at envMapIntensity 0.35. Settings come from the model thread's `body-model/page` STYLES.A.
- It draws only while the card is on screen and playing (the card loop's IntersectionObserver), capped at 60 fps. There are no lower-detail versions: the app targets the S24 Ultra and newer (Aziz, Nov 1). Measured on the S24 Ultra: 120 fps steady with 200k, ~35%/h battery nonstop at 120 fps.
- While loading, or if WebGL fails, the card keeps drawing the line mannequin.

## Reviewed recipe demos (Nov 3, what the app shows)
The Rotate view plays the recipe demos Aziz reviewed (the project's recipe viewer: `engine.js`, `gear.js`, `gear_all.js`, `gymkit.js`, `recipes.json`, `gripcache.json`, its body). `python3 tools/exercise-3d/import_recipes.py [viewer dir] [--hold=id,id]` copies them into `app/3d/rx/` (three.js import pointed at `app/vendor/three-r160`, body decoded to `body.glb`, only the app's exercises: recipe key `mz-<app id>`, keyed by app id) and writes `recipes` ({app id: loop seconds}) and `recipesSource` (recipes md5, held ids) into `exercises.json`. Held back after review (Nov 3, being redone): elliptical, chest-supported T-bar row machine, chest-supported row machine, reverse hyper machine; they keep the line mannequin until the fix lands, then re-run the import with `--hold=`. MoveKit-list recipes (`mk-…`) are not in the app's library, so they are not copied. `paint()` drives the recipe `Poser` with the card's loop phase and turns the recipe's own camera by the card drag; `dur(id)` gives the loop length the card plays at. The anim-based `core()` engine below is kept for its tests and tools but no longer drawn in the app.

## API (`window.Exercise3D`)
- `has(id)`, `ids()`, `info(id)`, `status()` ('idle' | 'loading' | 'ready' | 'failed'), `load()` (Promise).
- `paint(ctx, w, h, id, st)`: renders exercise `id` at `st.t` (0..1), `st.yaw`, `st.pitch`, `st.zoom` into a 2D canvas context. Returns false while not ready.
- `core(THREE, gltf, meta, opts)`: the engine without the app (used by the preview page and the tests). It returns `setExercise(id)`, `pose(t01)`, `contacts()`, `solveGrip(side, r)`, `setMuscles(primary, secondary)`, `scene`, `skinned`. opts: `data`, `gripAt` (0.7), `gripDiag` (0.3 rad), `primary`, `secondary`, `bodyColor`.

## exercises.json
`exercises.<id>`: `status` (always `preview` until Aziz reviews it; only Aziz marks anything approved), `gripType` (`overhand` | `underhand` | `neutral`, or `grip: {L, R}`), `handleRadius` (m, from the gym kit), `primary` / `secondary` (ids from the 37-muscle vocabulary; `@L` / `@R` limits a muscle to one side), `kit`, optional `cam: {yaw, pitch}` for the starting view, optional `gripDiag` (rad, how diagonally the handle crosses the palm, default 0.3) and `gripAt` (0..1 from wrist to knuckles, default 0.7).

## How it holds things
- Grip solver, once per handle radius: the palm sits 3 mm off the handle, the fingers close all joints together (MCP:PIP:DIP 0.8:1:0.7) until they touch, then PIP/DIP close alone; the thumb is solved by a search on opposition and curl. The handle runs 0.3 rad across the palm.
- The hand picks overhand, underhand or neutral the same way the checker defines them. One-hand handles (D-handle, dumbbell) turn with the hand so the forearm twist stays within 80 deg, and a D-handle's ring follows the cable. The elbow swings out (humeral rotation) when the forearm would need an impossible twist, and the upper arm is kept outside the chest.
- Pads (bench, seat) are found in the props: the pelvis is moved so the back or seat sits about 4 mm into the pad. Feet IK to the floor.

## Body files
`tools/exercise-3d/bake_body.py in.glb body_meta.json regions.png out.glb out_meta.json muscle-vocabulary.csv` turns `body-model/out200/body_extreme.glb` (shared project files) into `app/3d/body.glb`: eyes merged into one primitive, `regions.png` baked into a `_MUSCLE` vertex attribute (r = vocabulary index + 1, g = membership, b = eye, a = left side), int8 normals and tangents, uint16 UVs (6.2 MB). Copy `out200/normal_A.png` to `app/3d/` with it (normal maps belong to their mesh). `paint_muscles.py` is the older rule-based painter for the 72k body.

## Quality checks
Run the project's demo checker (`demo-qa`, see its README) against the preview page. Checker jobs for the listed exercises are in `qa-jobs/` (`node checker.mjs --recipes modules/exercise-3d/qa-jobs --viewer <preview page>`). As of Nov 1 all four pass on the Baki body. The Bayesian curl job allows the cable to rest up to 6 mm on the working forearm and hand (`allowTouch`), because in that exercise the cable runs along the arm; cables carry the qaId `cable.line<i>`.

## Tests
`node --test modules/exercise-3d/exercise-3d.test.mjs`: data (every entry preview, known muscles, motion exists), body meta (200k, skeleton), and the engine posing every exercise in node with three.js, fingers wrapping a 16 mm handle.
