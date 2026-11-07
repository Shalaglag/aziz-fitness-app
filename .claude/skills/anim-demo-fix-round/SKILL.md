---
name: anim-demo-fix-round
description: Use when fixing how one or more exercise 3D demos move or grip (Aziz's notes, reviewer findings) in the Mizan exercise animation project, before anything ships to the app.
---

# Fix a round of exercise 3D demos

Owner: the "Mizan exercise animation" project (not the Fitness personal trainer project).
Source of truth: `/mnt/project-files/recipes/all/src/` (data + generator). Never hand-edit the
generated `recipes/all/*.json` or `viewer/recipes.json`; they are rebuilt by `gen.py`.

## Inputs
- A list of exercise ids (`mk-…` MoveKit-list names or `mz-…`/app ids) and what is wrong.
- Evidence of the problem: Aziz's note (quote it), a reviewer row in
  `/mnt/project-files/review/review-log.md`, or a checker failure.

## Who owns what (ask the owner thread, do not edit their file)
| File | Owner |
|---|---|
| `recipes/all/src/*` (`fixes.json`, `handfix.json`, `camfix.json`, `kit-motion.json`, `upper.py`, `lower.py`…) | the fix/audit thread |
| `recipes/all/viewer/gear_all.js` | recipes-all thread |
| `recipes/all/viewer/engine.js` | movement-recipes thread |
| `gym-kit/src/*`, `gymkit.js` | gym-kit thread (skill `anim-gym-kit-change`) |

## Steps
1. Write the change as data in `src/` (per-exercise overrides in `fixes.json` / `handfix.json` /
   `camfix.json`; template change in `upper.py`/`lower.py` only if every exercise on that
   template is wrong). Set `_audit` on the entries you touched so the next review sees them.
2. Regenerate: `cd /mnt/project-files/recipes/all/src && python3 gen.py --out <scratch>`
   (`--only T01,T04` to limit to templates). Outputs `<scratch>/recipes/<id>.json`,
   `index.json`, `viewer-recipes.json`.
3. Render the touched ids and look at every frame:
   `node /mnt/project-files/review/tools/render.cjs <scratch>/frames <id,id>` (4 phases + hand
   close-up; serves the viewer on port 8770). Contact sheet:
   `python3 -I /mnt/project-files/review/tools/sheet.py <frames> <out.png> <id,id>`.
4. Check by eye: hands truly grip (no floating or clipped fingers), feet planted, body on the
   seat/pad, equipment moves with the body, camera shows the movement. Fix and repeat 1–3.
5. Run the checker on the touched ids (skill `anim-demo-qa-run`, "few ids").
6. Land: copy `viewer-recipes.json` to `recipes/all/viewer/recipes.json`, then record
   `md5sum` of `recipes.json` (and any viewer file you were allowed to change).
7. Republish the review pages that show these ids (batch 1 `QSNC2E3G1b1efw9Q956wXR`,
   batch 2 `KZ85maBAWWoDofLFrrKGLc`, batch 3 `SVr7AT5Bbjde1wq1vrL3Kp`) with the Artifact tool.
8. Tell the reviewer thread, and the gym-kit / recipes-all threads if their files are involved,
   with the ids and new md5s (`message_thread`; only threads whose work depends on yours).

## Rules
- No new fixes unless the current task asks for them; only Aziz marks a demo approved.
- A demo is not "verified" until the reviewer (skill `anim-demo-review`) has rechecked it.
- Do not copy MoveKit clips, frames or text; its list is used only for names.
- Big batch over many templates: run the full cycle in `anim-demo-qa-run` instead.

## Done when
- Every touched id rendered and looked at; checker passes for them.
- `viewer/recipes.json` md5 recorded in the reply; review pages republished.
- Owner threads notified; nothing shipped to the app (that is `anim-app-rollout`).
