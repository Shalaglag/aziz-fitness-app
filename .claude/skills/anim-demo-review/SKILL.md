---
name: anim-demo-review
description: Use when reviewing exercise 3D demos by eye (machine, movement, grip, muscles) or rechecking fixed ones in the Mizan exercise animation project, and logging findings.
---

# Review exercise demos by eye

Log: `/mnt/project-files/review/review-log.md` (append; one dated section per pass).
Evidence folders: `review/run3-by-eye/`, `review/run4-by-eye/`, `review/movekit-compare/`
(`findings.md`), `review/aziz-refs/` (Aziz's own reference shots).

## Inputs
- Ids or a batch (e.g. a fix round's touched ids, or a whole template).

## Steps
1. Render: `node /mnt/project-files/review/tools/render.cjs <outdir> <id,id|all>`
   (4 phases + hand close-up; `renderside.cjs` for a side view). Contact sheet:
   `python3 -I /mnt/project-files/review/tools/sheet.py <outdir> <out.png> <id,id>`.
2. Data check: `python3 -I /mnt/project-files/review/tools/review_batch.py` (muscle ids vs
   `exercise-research/`, kit piece exists, body-contact equipment).
3. For each id check: right machine/equipment, right movement path and range, hands really
   grip, body contacts the pad/seat, highlighted muscles match `exercise-research`.
4. Where the exercise has a MoveKit page, read its written steps with WebFetch only to compare
   the movement. Its clips are blocked and nothing may be copied.
5. Write each finding: id, severity HIGH (wrong exercise/equipment), MED (wrong path, grip,
   contact), LOW (cosmetic), what is wrong, which frame shows it.
6. Send the list to the fix thread (skill `anim-demo-fix-round`). After their round, recheck
   the same ids and mark each fixed / still wrong in the log.

## Rules
- Do not edit `recipes/all/src` or the viewer from a review; the fix thread owns them.
- "Matches" means checked by eye in this pass. Never mark a demo approved; only Aziz does.
- Unclear Strong names stay unclear until Aziz answers; do not guess the exercise.

## Done when
- Every id has a row in `review-log.md` with severity or "ok", plus the sheet image path.
