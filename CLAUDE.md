# Working in this repo (read by every thread)

Goal: same quality and pace, fewer tokens. These rules remove reading that never changes a result.

## Layout
- `app/index.html` (900 KB): 31 `<script>` blocks. Blocks 1–30 are inlined copies of `modules/*`. Only the last block (search `===================== Plan data`) is the shell: plan data, store, render, events.
- `modules/<name>/`: source of each feature. `README.md` has the API; `*.test.js` the tests. `preview*.html` and `*.png` are demo pages, never documentation.
- `docs/APP-SHELL.md`: data model and the per-version list of what is inlined. `docs/nutrition-training-handoff.md`: the plan.
- Screens → modules: Today = daily-dashboard, daily-score, supps-drinks, recovery-fatigue, budget-recovery, ramadan, steps. Train = workout-logger, exercise-swap, form-cues, effort-deload, cardio, strong-sync. Food = menu-import (picker-engine), saved-meals, protein-gap, barcode-scanner, photo-food. Progress = weekly-report, trend-tdee, goal-date, diet-break, coach, strength-analytics, progress-photos. Guide = app-targets, data-io, theme.

## Reading rules
- Never read `app/index.html` whole. Find with `grep -n`, read with `sed -n 'a,bp'`. For module logic read `modules/<name>/<name>.js`, not its inlined copy.
- Never read `preview*.html` or PNG files to learn a module. Read its README.
- Read large module files by section (grep for the function name first).

## Tests
- While working: `node --test modules/<name>/<name>.test.js`
- Before a PR: `npm test` (every test file under modules/; the same command runs in GitHub Actions on every PR)
- On failure: `node --test <file> 2>&1 | grep -A8 "^not ok"`
- CI (`.github/workflows/tests.yml`) runs `npm test` on every PR and on main; a red check means the PR is not mergeable yet.

## Changing the app
- Module threads change only their module folder. The app thread inlines modules into `app/index.html`.
- Re-inline with the module's `apply-patch.js` / `apply-to-app.*` script when it has one; otherwise replace the block between its start comment and the next `<script>` with a script, not by retyping it.
- Keep `docs/APP-SHELL.md` current with one new version line, not a rewrite.

## Habits
- Batch independent tool calls in one turn. Run tests and push in the same turn when nothing depends on the result.
- One screenshot at most after a visual change; none for logic, docs or test changes.
- No subagents unless asked. Replies short; long content goes in a document.
- Merge finished PRs when tests pass (Aziz's standing rule).
