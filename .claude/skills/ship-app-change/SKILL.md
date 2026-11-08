---
name: ship-app-change
description: Use for any code change to the Mizan app (module, shell, tests) from branch to merged PR to telling Aziz which Android build to update to.
---

# Ship an app change

Every feature or fix thread in this project runs this loop (seen in 60+ threads, Oct 25–Nov 7 2026).
Read `CLAUDE.md` first; this skill only orders the steps and names the checks.

## Inputs
- The ask (Aziz's words, screenshot or recording) and the screen/module it touches.
- Branch name given by the harness (`claude/...`). Never push to main directly.

## Steps
1. **Find the code.** Module logic: `modules/<name>/<name>.js` (+ `README.md`). Shell markup/CSS/
   store/render/events: `build/shell.html`. Locate with `grep -n`, read with `sed -n 'a,bp'`.
   Never open `app/index.html` whole.
2. **Change the source, not the output.** New module: add one line to `build/modules.json` in block
   order. Then `node build/build.js` to regenerate `app/index.html`.
3. **Tests while working:** `node --test modules/<name>/<name>.test.js`.
   Add or extend a test for the behaviour you changed (module test, or a case in
   `tests/app-phone.test.js` for whole-app behaviour).
4. **Before the PR:** `npm test` (all module tests, build test, phone-sized checks, then
   `node build/build.js --check` must print ok). On failure:
   `node --test <file> 2>&1 | grep -A8 "^not ok"`.
5. **UI changed?** Load `phone-ui-check` (one screenshot at most).
6. **Docs:** add ONE new `- vNNN:` line to `docs/APP-SHELL.md` (next number after the last line).
   Update the module README if its API changed.
7. **Commit** `build/shell.html`, `build/modules.json`, the module and `app/index.html` together.
   Message: what changed, in plain words. Push with `git push -u origin <branch>`.
8. **PR** via the GitHub MCP tools (no `gh`): title = the change in plain words; body starts with
   the required attribution block, then what/why/how tested. Assign and request review from
   `Shalaglag`. Subscribe to PR activity and end the turn; CI (`test` ≈90 s, `Android` ≈4 min) wakes you.
9. **Merge when both checks are green** (Aziz's standing rule, Oct 25). Squash merge. Red or
   conflicting: load `pr-conflicts-and-ci`.
10. **Tell Aziz once:** the Android build number that contains it (load `android-release-check`
    to find it) and that **Update** in the app (Settings → App updates) gets it. One reply with the
    PR link when it is up, one when it is merged with the build number. Nothing in between.

## Completion check
- `npm test` green locally and both CI checks green on the PR.
- PR merged (or the reason it is not, stated in the thread).
- APP-SHELL.md has the new version line; module README current.
- Aziz told the build number, with any phone check he must do as a numbered yes/no list.

## Gotchas
- `fold()` rows: secondary cards collapse one per module; keep that pattern.
- Calorie numbers come from `kcalTarget` / `dayTargets` / `KCAL_FLOOR`, never literals.
- Overlays need `role="dialog"` + a close button so the Android back button closes them.
- Device features go through `window.Capacitor.Plugins.<Name>` behind `AndroidShell.isNative()`.
- Do not touch `app/3d`, the 3D viewer or exercise ids (owned by the animation project).
