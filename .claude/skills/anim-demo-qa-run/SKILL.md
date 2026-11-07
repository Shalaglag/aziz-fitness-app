---
name: anim-demo-qa-run
description: Use when running the automatic demo checker on exercise 3D demos (a few ids or all 898) in the Mizan exercise animation project and summarising the result.
---

# Run the demo checker

Checker: `/mnt/project-files/demo-qa/` (README there). It loads the viewer page through
Playwright with software WebGL and checks each demo through `window.__demo` (grip contact,
floor, joint limits, clipping, loop, frame budget). About 6 s per exercise.

## Inputs
- Ids to check (few) or "all".
- The viewer to test: normally `/mnt/project-files/recipes/all/viewer/index.html`.

## Steps — few ids
1. Self-test once per container: `cd /mnt/project-files/demo-qa && bash run_qa.sh`.
2. `node checker.mjs --only <id> --no-shots` (repeat per id), or
   `node checker.mjs --recipes <dir with id.json files> --viewer <viewer>/index.html --out <outdir>`.
3. Read the report in `<outdir>`; quote failures with the check name.

## Steps — all 898
1. Scratch lives in `~/w` (NOT durable: a new container starts empty). Recreate it:
   `python3 /mnt/project-files/recipes/all/src/gen.py --out ~/w/out` and a copy of the viewer at
   `~/w/v2/` with `~/w/out/viewer-recipes.json` as `recipes.json`.
2. Run `bash /mnt/project-files/recipes/all/tools/qa_all.sh 3` (3 parallel shards, writes
   `~/w/qa/`, prints ALLDONE), or the faster single-page runner
   `node /mnt/project-files/recipes/all/tools/fastqa.js <out.json> <shard> <nshards>` with the
   viewer served on `localhost:8765` (resumable).
3. Summarise with `python3 -I /mnt/project-files/recipes/all/tools/sumqa.py '<glob of fastqa out.json files>'`
   (default glob `/root/w/fq/r*.json`; it also reads `/root/w/out/index.json`) and save a
   `runN-summary.txt` next to the earlier ones in `/mnt/project-files/recipes/all/qa/`.
4. Compare with the last run (run1 41, run2 51, run3 65/66 pass of the batch checked).

## Gotchas
- A container restart kills background jobs; run long jobs in shards that can resume.
- The frame-budget check fails on the cloud CPU (~17 ms vs 8 ms target); report it as
  "not measurable here", never as a phone result. Phone speed is checked on the S24 Ultra.
- Always pass the swiftshader flags the tools already use; plain headless has no WebGL.
- A checker pass is not a by-eye pass. Only Aziz marks a demo approved.

## Done when
- The run's command, viewer md5 (`md5sum recipes.json`), pass/fail count and failing ids are in
  the reply and in the summary file.
