---
name: thread-handoff
description: Use when a chat is long, slow from context problems or near its context/attachment limits and must hand its work to a continuation chat without losing decisions.
---

# Thread handoff (standing rule, Aziz, Nov 7 2026)

Watch for it proactively; do not wait for Aziz. A usage block, CI wait, approval wait or intentional
pause is NOT a context problem; do not roll over for age or message count alone.

## Steps
1. **Stop new implementation at a safe checkpoint.** Commit or stash nothing half-written that
   would break `npm test`; note uncommitted work explicitly.
2. **Write the handoff** at `handoffs/<topic>.md` in the repo (copy `handoffs/TEMPLATE.md`), or the
   same relative path in `/mnt/project-files/` when there is no repo. It must contain, in order:
   (1) goal in 2–3 lines; (2) done, half-done and next, including uncommitted work; (3) open PRs and
   branches with links, everything unmerged or untested; (4) EVERY applicable user decision and
   standing rule with reasons, marking superseded ones; (5) steps waiting on Aziz, reminders and
   deadlines with timezone and whether any reminder is actually scheduled; (6) key files, folders,
   attachment locations and links; (7) gotchas and dead ends; (8) the exact first action for the
   replacement. Never invent facts; never include secrets.
3. **Read the file back** (`cat handoffs/<topic>.md`) and check every section is filled. Commit and
   push it on the thread's branch (a PR is fine; the file is documentation).
4. **Ask the coordinator** (`message_coordinator`) to create the continuation chat titled
   `<old title> (cont.)` whose first message says: read the FULL handoff at the path above and
   `.claude/skills/README.md`, follow all applicable user rules, then confirm the actual state in
   THREE lines before working. The new chat inherits any pause; a paused chat stays paused.
5. **Verify** the replacement exists, can open the handoff and has posted its three-line state.
   Ownership of files, branch and coordinator routing moves to it; never two owners on one piece.
6. **Then** resolve the old chat with one line linking the replacement. Tell Aziz ONE line with the
   new-chat link. Never resolve first; never claim attachments were transferred if they are not
   accessible from the new chat (say which are missing).

## Completion check
- `handoffs/<topic>.md` exists, is pushed, and reads back complete.
- Continuation chat confirmed state in three lines.
- Old chat resolved last, with the link.
