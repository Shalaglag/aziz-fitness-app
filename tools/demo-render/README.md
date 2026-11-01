# Demo render pilot (Blender)

Goal: render looping MP4 demos with a realistic anatomical body, using the exact motions and equipment of the built-in demos (`modules/exercise-anim`). Aziz approved (Nov 1, 2026) installing Blender, FFmpeg and the MPFB add-on on his PC and wants "the best models". Reference look: MoveKit style (grey anatomical body, individually sculpted muscles with fibre detail, target muscles red, soft studio light, light grey background, equipment in the same grey). Not a copy of MoveKit assets: only the look.

## Data
`pilot-data/<id>.json`, made by `node tools/demo-render/export-frames.js <ids> --dir tools/demo-render/pilot-data`. Four exercises: bench-press-barbell, squat-barbell, bicep-curl-dumbbell, push-up. Per frame (30 fps, one loop = dur seconds, last frame flows into the first):
- `sk`: world joint positions (y up, +z = body forward, +x = the body's left side). `P` pelvis, `up`/`f`/`side` torso frame, `neckB`, `head`, and per side L/R: `sh` shoulder, `el` elbow, `wr` wrist, `hand` fingertip end, `grip`, `hip`, `kn` knee, `an` ankle, `toe`.
- `props`: equipment shapes in the same world space: `cap` {a,b,ra,rb} tapered cylinder with round ends, `sph` {c,r}, `disc` {c,n,r} plate (thickness 0.03), `line` {a,b} cable, `box` {c, ax:[3 half-axis vectors]}. `col` is one of metal/plate/pad/frame/cable (grey tones).
- `hi` / `sec`: target / helping muscle groups (thighs, calves, arms, forearms, delts, torso (chest, or back for rows), abs, pelvis (glutes)). `cam` {yaw, pitch}: camera on a sphere around the figure centre, yaw 0 = looking at the figure from +z.
- Blender is Z-up: convert (x, y, z) to (x, -z, y).

## Reference renderer
`threejs-reference/` is a working three.js version (model.js, run2.js): it retargets the data onto a rigged mannequin by aiming each bone at the next joint (pelvis by the torso frame; clavicle to `sh`, upper arm to `el`, forearm to `wr`, hand to `hand`, thigh to `kn`, calf to `an`, foot to `toe`), closes fists around the bars, adds ellipsoid muscles with fibre texture, draws props, auto-fits the camera to the whole loop, and writes PNG frames that ffmpeg turns into an MP4. Use it as the spec. The Blender version should look clearly better: real anatomy.

## Task for the Blender build
1. Install Blender (LTS) and FFmpeg with winget if missing; install the MPFB extension (CC0 human generator) from Blender's Get Extensions. Nothing else on the PC changes. No paid assets, no accounts.
2. Make an athletic male MPFB human (muscular preset, about 1.8 m, default rig) with a grey clay skin. Check each asset used is CC0 or similarly free for commercial use and note it in `ASSETS.md`.
3. Retarget the JSON onto the rig for each frame (keyframes at 30 fps), fists on bars, feet planted as the data says.
4. Muscles: use the best real anatomy available (MPFB muscle-weighted body with separate target-muscle regions painted from weight maps, or any free CC0 muscle layer). Target muscles from `hi` go red and glossy, `sec` lighter red, the rest grey; add fibre bump texture along the muscle direction.
5. Props from the shapes, grey. Soft three-point light, floor shadow catcher, background #eceef1.
6. Render 1080x1080 (Eevee is fine if it looks good; Cycles with few samples + denoise if needed), PNG sequence, then `ffmpeg -framerate 30 -i %04d.png -vf format=yuv420p -c:v libx264 -crf 23 -preset slow -movflags +faststart out.mp4`; loop the clip twice for about 6.8 s. Report file sizes and render time per clip; if a clip is over 1 MB try 720 px or crf 26.
7. Output folder: `C:\Users\Diwaniya\Desktop\Fitness personal trainer\demo-render\out\` with the four MP4s and one contact sheet PNG.
