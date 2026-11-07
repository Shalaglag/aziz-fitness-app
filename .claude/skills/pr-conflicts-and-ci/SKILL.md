---
name: pr-conflicts-and-ci
description: Use when a PR on aziz-fitness-app is red, conflicts with main, or CI fails for reasons unrelated to the change (weekday tests, quotas, shell merge duplicates).
---

# PR conflicts and CI

Seen on PRs #27, #90, #105, #121, #147, #152, #164 and others: many threads merge to main in
parallel, so a PR goes stale within minutes.

## Steps
1. **Reproduce first.** `git fetch origin main && git merge origin/main` on the branch; run
   `npm test`. Fix only what the failure or conflict needs.
2. **Shell conflicts** (`build/shell.html`, `app/index.html`): resolve in `build/shell.html` only,
   then `node build/build.js`; never hand-merge `app/index.html`. After an auto-union merge check for
   duplicated functions/handlers: `grep -n "function vTrain\|delfood" build/shell.html | sort | uniq -d`
   style checks on the names the conflict touched. Duplicates compile and silently break rendering.
3. **`build/modules.json` conflicts:** keep both module lines in block order.
4. **`docs/APP-SHELL.md` conflicts:** keep both version lines; renumber yours to the next free number.
5. **Known flaky causes:**
   - Weekday-dependent tests (menu picker on Saturday adds the eggs breakfast): pin the clock with
     the `fixedTime` option in `tests/app-phone.test.js`, or pin the date in the module test.
   - Timezone: tests must pin `TZ` themselves (steps test pins `Asia/Kuwait`).
   - Playwright missing locally: the browser tests print a skip; CI installs Playwright 1.63.
   - Actions artifact quota full: upload step is `continue-on-error`; not a reason to retry.
6. **Never** skip, delete or quarantine a test to get green; never push an empty commit or
   close/reopen to kick CI; never force-push someone else's branch.
7. After the fix: `node build/build.js --check` prints ok, `npm test` green, push, wait for both
   checks (`test`, `Android`), then merge (standing rule).

## Completion check
- Both checks green on the PR head; merged; the same failure not reintroduced on main.
- If the failure was on main too, say so in the thread and fix it in the same PR.
