# Project skills (Shalaglag/aziz-fitness-app · "Fitness personal trainer")

Every current or new chat must first read this README and load only the skill needed for its
current task. Whenever an applicable rule or workflow changes, update its matching SKILL.md and
this routing table in the SAME change; keep one source of truth.

Cloud chats in the Claude project do not auto-discover this folder. A copy lives in the project's
shared files at `/mnt/project-files/Skills/` (same layout). The repo copy is canonical: edit here,
then copy the changed files there in the same PR/turn.

| Task you are about to do | Load | Not needed when |
|---|---|---|
| Any change to the app: module, shell, test, PR, merge, telling Aziz the build | `ship-app-change/SKILL.md` | docs-only edits |
| Check an APK/release: build number, signing, update path, phone checks list | `android-release-check/SKILL.md` | the change is not user-visible |
| UI change: screens at 360–412 px, light/dark, overlays, screenshots | `phone-ui-check/SKILL.md` | logic, data or docs change |
| PR red or conflicting with main; flaky/weekday test; CI quota errors | `pr-conflicts-and-ci/SKILL.md` | CI is green and mergeable |
| Water/steps not updating: WaterH → Fitbit → Google Health, Health Connect | `health-sync-debug/SKILL.md` | not a sync problem |
| Chat is long, slow or near its limits; a continuation chat is needed | `thread-handoff/SKILL.md` | a usage block, CI wait or pause (not a context problem) |

Exercise animation project ("Mizan exercise animation"; it owns `app/3d`, the 3D viewer and
exercise ids). These skills are only for chats in that project; its shared files keep the same
mirror at `/mnt/project-files/Skills/`. It uses `thread-handoff` above for rollovers.

| Task you are about to do | Load | Not needed when |
|---|---|---|
| Fix how demos move, grip or frame (Aziz's notes, reviewer findings) | `anim-demo-fix-round/SKILL.md` | only reviewing, nothing to change |
| Run the automatic demo checker on a few ids or all 898 | `anim-demo-qa-run/SKILL.md` | a by-eye review is asked for |
| Review demos by eye, compare with MoveKit steps, recheck fixes, log findings | `anim-demo-review/SKILL.md` | writing the fix itself |
| Change or add a gym equipment piece | `anim-gym-kit-change/SKILL.md` | the piece is fine and only the body motion is wrong |
| Ship reviewed demos into the app (import, build, PR, Update) | `anim-app-rollout/SKILL.md` + `ship-app-change/SKILL.md` | demos still under review |
| Copy shared files to Aziz's PC folder | `anim-pc-sync/SKILL.md` | the files only need to be in the shared folder |

Rules that are not skills (state them, do not load anything):
- Repo rules: `CLAUDE.md` (build, reading, tests, Android, habits). Read it first in every chat.
- Standing user rules: merge finished PRs when tests pass; "accept anything on my behalf" for
  design choices; 2,000 kcal target, no exercise calories added back, never auto-lowered; no paid
  services, Play Store or public exposure without Aziz's explicit yes; Arabic translation cancelled.
- Big attachments (PDFs, exports, screenshots): convert to Markdown/CSV under
  `/mnt/project-files/fitness-app/<topic>/raw/` once, then read the text copy (Aziz, Nov 3 2026).
- Exercise demos/3D viewer are owned by Aziz's separate "Mizan exercise animation" project; do
  not touch `app/3d`, the viewer code or exercise ids from this project.
- Food-source constraints (USDA key, Open Food Facts limits, McDonald's Kuwait PDF, blocked hosts)
  live in project memory `food-logging-program` and the lead food thread; one food thread at a time.
