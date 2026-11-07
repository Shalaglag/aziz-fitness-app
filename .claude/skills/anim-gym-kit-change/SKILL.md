---
name: anim-gym-kit-change
description: Use when changing or adding a gym equipment piece (bench, cable station, machine, plates) for the exercise 3D demos in the Mizan exercise animation project.
---

# Change the gym kit

Folder: `/mnt/project-files/gym-kit/` (README there: +Z is forward, `motion` 0..1, anchor
names, plate sizes). Gallery page: Artifact `2m1adV1o8FdK1cPKZ8swyE`.
Source of truth is `gym-kit/src/*.js`; `gymkit.js` is assembled from it.

## Inputs
- The piece id(s) and the change (from Aziz, the reviewer, or a fix round).

## Steps
1. Check for edits made straight into the viewer copy first: the fix thread sometimes edits
   `recipes/all/viewer/gymkit.js`. Run
   `diff /mnt/project-files/gym-kit/gymkit.js /mnt/project-files/recipes/all/viewer/gymkit.js`
   and port every difference into the matching `src/*2.js` file before you build, or it is lost.
2. Edit the piece in `src/` (`free2.js`, `benches2.js`, `cable2.js`, `machines2.js`, `legs2.js`,
   `cardio2.js`, `new2.js`, helpers in `helpers2.js`/`assemblies2.js`, API in `api2.js`).
   Bump `KIT_VERSION` in `tools/assemble.sh`.
3. Build: `sh /mnt/project-files/gym-kit/tools/assemble.sh` (writes `src/gymkit.js` and
   `site/gymkit.js`).
4. Detail rule: `node tools/check-min-tris.cjs gallery` from `gym-kit/`; every piece must be
   10,000+ triangles with realistic detail (Aziz, Nov 1).
5. Export GLBs + manifest: `node tools/exp.js <dst>` from `gym-kit/` (serves `site/` on port
   8766; writes `<dst>/glb/*.glb` and `<dst>/kit-manifest.json`).
6. Copy `src/gymkit.js` to `gym-kit/gymkit.js` and `recipes/all/viewer/gymkit.js`; confirm the
   two have the same `md5sum`. Update the README piece list if a piece was added.
7. Republish the gallery; render the demos that use the piece (skill `anim-demo-fix-round`,
   step 3) and look at hands/contact on it.
8. Tell the fix thread and reviewer the new KIT_VERSION and md5.

## Rules
- Only real-looking equipment (leather pads, real cables, plates), no basic shapes.
- Hands must truly grip handles: move the anchor, not the hand, when a grip is off.
- Do not rename piece ids or aliases that recipes use without updating every recipe.

## Done when
- check-min-tris passes; both gymkit.js copies have the same md5; gallery republished; the
  affected demos rendered and looked at.
