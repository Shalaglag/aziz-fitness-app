---
name: anim-app-rollout
description: Use when shipping a batch of reviewed exercise 3D demos into Aziz's Mizan app (aziz-fitness-app repo) from the Mizan exercise animation project.
---

# Ship reviewed demos into the app

This project owns getting 3D demos into the app (agreed with the Fitness project, Nov 2). The
Fitness project keeps off `app/3d`, the 3D viewer code and exercise ids; we keep off the rest of
the app. Also follow the build, test, PR and merge steps of `ship-app-change/SKILL.md`; its
"do not touch `app/3d`" line is the Fitness project's side of the same agreement and does not
apply to this project. This skill only adds the demo-specific steps.

## Inputs
- The reviewed viewer at `/mnt/project-files/recipes/all/viewer/` and its `recipes.json` md5.
- The ids to hold back (still being redone), from the reviewer log or Aziz.

## Steps
1. Branch from fresh `origin/main` (`git fetch origin main`). Check open PRs from the other
   project for `app/3d`, `modules/exercise-3d` or exercise-id changes before you start.
2. Import: `python3 tools/exercise-3d/import_recipes.py /mnt/project-files/recipes/all/viewer --hold=<id,id>`
   Write `--hold=` with the `=`; the built-in HOLD default is stale (4 ids from Nov 3, while
   PR #159 shipped with only `chest-supported-row-machine` held). It writes `app/3d/rx/` and
   the `recipes` map + `recipesSource` (md5, held ids) in `modules/exercise-3d/exercises.json`.
3. If the list pictures change: `node tools/clip-thumbs/make-3d-thumbs.js`.
4. `node build/build.js`, then `node --test modules/exercise-3d/exercise-3d.test.mjs`, then
   `npm test`; `node build/build.js --check` must print ok.
5. One new version line in `docs/APP-SHELL.md` (ids added, ids held, recipes md5).
6. PR (assign Shalaglag), then follow the merge rule in `ship-app-change`. Merging to main
   starts the Android build (release `android-latest`).
7. Tell Aziz in plain words: "the new app version is being built; when Mizan shows Update,
   tap it". Say which demos are in it and which are held.

## Rules
- Only demos that passed review go in; only Aziz marks a demo approved.
- No releases from an audit or docs task.
- Explain jargon plainly (APK = the app install file for Android).

## Done when
- PR merged with green checks (or clearly reported as waiting), `exercises.json`
  `recipesSource.recipes_md5` equals the viewer `recipes.json` md5, held ids listed to Aziz.
