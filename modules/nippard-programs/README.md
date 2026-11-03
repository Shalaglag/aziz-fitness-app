# nippard-programs: ready-made programs and "Jeff Nippard says" tips

Train > Templates > **New template** now opens a chooser: *Blank template* or one of 18 ready-made programs built from Jeff Nippard's published plans, for people who have no split yet. Picking a program shows its days and exercises; *Add to my templates* writes one template per workout day into a folder named after the program (ids `np-<program>-<n>`, so adding again replaces rather than duplicates). The matching exercises also show a collapsed **Jeff Nippard says** panel in the live workout (under Form cues) and a section in the exercise sheet's About tab, quoting his tips, machine notes and research facts with the source.

## Files
- `programs.json` (`window.NIPPARD_PROGRAMS`): 18 programs, one representative week each. Each exercise has the logger library id (`ex`), sets (`t:'w'` warm-ups, `t:'n'` working with the low end of the rep range as `r`, `sec` for timed holds), `rest` in seconds (midpoint of the PDF's range), optional superset key `ss`, and `notes` = "reps · RPE · rest · last-set technique — Jeff's note for that exercise".
- `tips.json` (`window.NIPPARD_TIPS`): `{tips: {exId: [{kind: tip|machine|fact, src, q}]}, _sources: {src: full title}}`. 81 exercises, 132 quotes.
- `nippard-programs.js` (`window.NippardPrograms`): `create(programs)` → `{list, get, templates(id, {unit, folder, order}), size}`; `tips(data)` → `{find, inlineHtml, detailHtml, css, size}`.
- `nippard-programs.test.js`: ids exist in the logger library, shapes, template building, tip html.

## Sources (the Markdown copies live in the project folder `fitness-app/nippard-programs/raw/`)
| Program in the app | Source | What was taken |
|---|---|---|
| Muscle Ladder · Full Body 2x, 3x (beginner), 3x, 4x; Upper/Lower 4x, 6x; UL/PPL 5x; PPL 6x | *The Muscle Ladder* (2024), programs 2, 3, 4, 7, 10, 14, 16, 19 | Week 1 tables (the book has 20 programs; the other 12 are variants of these) |
| The Essentials Program · 3x/week | The Essentials Program PDF | Block 1 (weeks 1–4) |
| Fundamentals · Full Body 3x, Upper/Lower 4x, Body-part split 5x | Fundamentals Hypertrophy Program PDF | Week 1 |
| Comeback Program · PPL, Upper/Lower | The Comeback Program PDF | Week 1 (50% loads on the big lifts) |
| Powerbuilding 3.0 · 5x/week | Powerbuilding 3.0 text | Week 1 |
| Pure Bodybuilding Phase 2 · Full Body 5x | PBB Phase 2 PDF | Week 1 of block 1 (weak-point slots left out) |
| Bodybuilding Transformation System · Beginner, Intermediate/Advanced | BTS spreadsheets | Week 1 exercises with week 3 sets and RPEs (weeks 1–2 are intro weeks) |

Tips come from the exercise chapter of *The Muscle Ladder*, its pre-order bonus ("best exercise for each muscle"), and the NOTES columns of the programs above. Everything is quoted, not paraphrased, and credited to Jeff Nippard with the title. The C.A.R.D. at-home card workout, the Get Ready manual and the nutrition booklet have no fixed workouts, so nothing was built from them.

## Rebuilding the data
The builder script and the pdfplumber/openpyxl extractions were scratch work; `programs.json` is the source of truth now. To add a program, append to `programs` with the same shape and run the test (it checks every `ex` against the logger library).

## Wiring (done in build/shell.html)
```js
WorkoutLogger.mount(host, { programs: NippardPrograms.create(window.NIPPARD_PROGRAMS), tips: NippardPrograms.tips(window.NIPPARD_TIPS) });
```
Logger changes: `newTpl` opens the picker when `opts.programs` exists (`blankTpl`, `progPreview`, `progAdd` actions), `opts.tips.inlineHtml(exId)` after the form cues in a live card, `opts.tips.detailHtml(id)` in About, and the `#nt-style` css injection. Classes are prefixed `nt-` and use shell tokens only.
