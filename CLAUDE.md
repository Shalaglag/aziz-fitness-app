# Working in this repo (read by every thread)

Goal: same quality and pace, fewer tokens. These rules remove reading that never changes a result.

## Layout
- `app/index.html` (925 KB) is a BUILD OUTPUT: `node build/build.js` writes it from `build/shell.html` + the modules listed in `build/modules.json`. Blocks 1–32 are the modules in manifest order; only the last block (search `===================== Plan data`) is the shell: plan data, store, render, events.
- `build/shell.html` (114 KB): the app minus the module blocks. `<!-- @modules -->` marks where they go. Edit the shell here, never in `app/index.html`.
- `modules/<name>/`: source of each feature. `README.md` has the API; `*.test.js` the tests. `preview*.html` and `*.png` are demo pages, never documentation.
- `docs/APP-SHELL.md`: data model and the per-version list of what is inlined. `docs/nutrition-training-handoff.md`: the plan.
- Screens → modules: Today = daily-dashboard, daily-score, supps-drinks, recovery-fatigue, budget-recovery, ramadan, steps. Train = workout-logger, exercise-swap, form-cues, effort-deload, cardio, strong-sync. Food = menu-import (picker-engine), saved-meals, protein-gap, barcode-scanner, photo-food. Progress = weekly-report, trend-tdee, goal-date, diet-break, coach, strength-analytics, progress-photos. Guide = app-targets, data-io, theme.

## Reading rules
- Never read `app/index.html` whole. Find with `grep -n`, read with `sed -n 'a,bp'`. For module logic read `modules/<name>/<name>.js`, not its inlined copy.
- Never read `preview*.html` or PNG files to learn a module. Read its README.
- Read large module files by section (grep for the function name first).

## Tests
- While working: `node --test modules/<name>/<name>.test.js`
- Before a PR: `node --test --test-reporter=dot modules/*/*.test.js modules/*/*.test.mjs build/build.test.js` (the last one fails until `app/index.html` is rebuilt)
- On failure: `node --test <file> 2>&1 | grep -A8 "^not ok"`
- CI (`.github/workflows/tests.yml`) runs `npm test` on every PR and on main (module tests, `build/build.test.js`, then `node build/build.js --check`); a red check means the PR is not mergeable yet.

## Changing the app (the build)
- Module threads change only their module folder. The app thread runs `node build/build.js` to re-inline everything; no hand-pasting, no `apply-patch` scripts for the JS block.
- Shell changes (markup, CSS, the store/render/events block) go in `build/shell.html`, then `node build/build.js`.
- New module: add one line to `build/modules.json` in block order (`file`, plus `expose: ["Global"]` for a `const Global = …` module, `esm: "Global"` for an ES module, `json: "GLOBAL"` for a JSON file), then build. Remove a module by deleting its line.
- Before committing: `node build/build.js --check` must print ok. Commit `build/shell.html`, `build/modules.json`, the module and `app/index.html` together.
- If a PR edited `app/index.html` by hand (older threads did), run `node build/extract-shell.js` to pull its shell changes into `build/shell.html`; it lists modules whose app copy drifted so the change can be ported to `modules/<name>/`, then rebuild.
- Keep `docs/APP-SHELL.md` current with one new version line, not a rewrite.

## Habits
- Batch independent tool calls in one turn. Run tests and push in the same turn when nothing depends on the result.
- One screenshot at most after a visual change; none for logic, docs or test changes.
- No subagents unless asked. Replies short; long content goes in a document.
- Merge finished PRs when tests pass (Aziz's standing rule).
