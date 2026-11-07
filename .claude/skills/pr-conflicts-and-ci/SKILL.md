---
name: pr-conflicts-and-ci
description: Use when a PR on aziz-fitness-app is red, conflicts with main, or CI fails for reasons unrelated to the change (weekday tests, quotas, shell merge duplicates).
---

# PR conflicts and CI

Seen on PRs #27, #90, #105, #121, #147, #152, #164 and others: many threads merge to main in
parallel, so a PR goes stale within minutes.

## Waiting on CI
Do not merge main into the branch "to be safe" while CI runs; threads on Oct 25–26 rebuilt the same
branch 3–5 times as sibling PRs landed, each time restarting CI. Merge main only when GitHub says
the PR conflicts or is behind and the check is required. End the turn after pushing; the PR
subscription wakes you. Three threads (PRs #43, #58, #59) sat from Oct 26 to Oct 31 waiting for a
check they never read: when a wake does not come within about 10 minutes, read the run with the
GitHub MCP `actions_list` / `actions_get` or `pull_request_read` (status) yourself, then act. If the
merge is refused by a session safety check (PR #27), ask Aziz with one decision card; "Go" is enough.

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
   - Weekday-dependent tests (menu picker on Saturday adds the eggs breakfast; failed on main for
     4 threads on Sat Nov 7, each re-diagnosed it): fixed in PR #164/#168 by making the phone test
     Saturday-aware. If a test depends on the day, pin the clock (`fixedTime` in
     `tests/app-phone.test.js`) or the date in the module test; never skip it.
   - Timezone: tests must pin `TZ` themselves (steps test pins `Asia/Kuwait`).
   - Playwright missing locally: the browser tests print a skip; CI installs Playwright 1.63.
   - Actions artifact quota full ("artifact storage quota"): upload step is `continue-on-error`
     since PR #164; the release attachment is what ships. Not a reason to retry or re-run.
6. **Never** skip, delete or quarantine a test to get green; never push an empty commit or
   close/reopen to kick CI; never force-push someone else's branch.
7. After the fix: `node build/build.js --check` prints ok, `npm test` green, push, wait for both
   checks (`test`, `Android`), then merge (standing rule).

## Completion check
- Both checks green on the PR head; merged; the same failure not reintroduced on main.
- If the failure was on main too, say so in the thread and fix it in the same PR.
