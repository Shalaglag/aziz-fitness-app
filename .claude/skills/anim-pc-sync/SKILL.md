---
name: anim-pc-sync
description: Use when copying the Mizan exercise animation project's shared files to Aziz's PC folder "mizan exercise animation project".
---

# Sync project files to Aziz's PC

Target: `C:\Users\Diwaniya\Desktop\mizan exercise animation project` on DESKTOP-24AHGN6 (the
"Diwaniya" PC, default device folder). History and the "next sync from" time live in project
memory `pc-sync`; the PC folder index source is `/mnt/project-files/pc-sync/README.md`.

## Steps
1. Read memory `pc-sync` for the last sync time T.
2. List files in `/mnt/project-files/` with mtime after T (`find <subfolder>/ -newermt "<T>"`
   per subfolder, never one search over the whole mount). Skip `uploads/`, `pc-sync/` and
   `__pycache__/`.
3. `list_devices`, then `device_commit_files` with `stagedPath` = the `/mnt/project-files/...`
   path and `devicePath` = the same relative path under the PC folder. Batches of at most 50
   files and 90 MB.
4. Add any new top-level folder to `pc-sync/README.md` and commit that too.
5. Update memory `pc-sync` with this sync's time and counts (new "next sync from" time).

## Rules
- Never delete or rename anything on the PC; add and replace only.
- Touch no other PC folders (the older render kit in `Fitness personal trainer` is not ours).
- If the device is not reachable, say so; do not retry in a loop.

## Done when
- Every batch reports `written` with no `rejected`; memory `pc-sync` updated.
