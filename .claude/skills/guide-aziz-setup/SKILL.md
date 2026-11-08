---
name: guide-aziz-setup
description: Use when a change needs Aziz to do steps in an external console (GitHub, Firebase, Google Cloud, Cloudflare, phone settings) that only he can do; write the step list, read his screenshots, confirm each step, never handle secrets.
---

# Guide Aziz through an external setup

Seen 7 times (Oct 26–Nov 2 2026): Firebase project + database + rules (Turn the fitness app into a
real app), GitHub read-only key for the Update button (PR #87), public `mizan-releases` repo +
`RELEASES_TOKEN` secret (PR #104/#107), Firestore rules publish for Friends (PR #115), Firebase
Google provider + SHA-1 + Web client ID (PR #118/#119), Google Cloud test user / publish for the
Fitbit scope (WaterH thread), Cloudflare Worker + `ANTHROPIC_API_KEY` secret for the coach (PR #144).
Each time the thread wrote the steps from scratch and Aziz answered with screenshots. Existing
write-ups to reuse: `docs/GOOGLE-SIGN-IN.md`, `docs/FRIENDS.md`, `docs/ANDROID.md`,
`modules/app-update/README.md`, `worker/README.md`.

## Steps
1. **Check it is really needed.** Can CI, the GitHub MCP tools or a repo file do it instead? Only
   console clicks, account creation, secrets and phone settings need Aziz. Check the existing docs
   above first; link them rather than rewriting.
2. **Build and merge the code first**, so the setup is the last step and the app shows a clear
   "not switched on yet" state until he finishes (Friends and the coach did this).
3. **Write one numbered list in a single reply**, phone-readable:
   - exact URL per step (deep links such as `https://console.firebase.google.com/project/<id>/...`);
   - the exact button or field names as they appear;
   - what to paste back, and say which values are NOT secret (project id, client id, worker URL)
     and which must never be pasted in chat (API keys, tokens, the keystore password). Secrets go
     straight into the console/secret field; the app or CI reads them from there.
   - say "a screenshot of each screen is fine" so he can answer without typing.
   Put the same list in `docs/<TOPIC>.md` when it will be needed again (a second phone, a friend).
4. **Read each screenshot and confirm or correct in one line.** Common misses seen: Google OAuth
   app left in Testing without the Gmail as test user (403); Android OAuth client missing the
   release SHA-1; worker URL pasted with `/v1/health` on the end; old build installed so the new
   button is not there yet (check the build number before debugging).
5. **Verify from your side** where possible (health endpoint, `latest.json`, Firestore rules in the
   repo match what he pasted, a sign-in test on a phone-sized run) before telling him it works.
6. **Record** what was set up and where (project memory file for that system, no secret values),
   and mark the checklist step done only after his confirmation.

## Completion check
- Aziz confirmed each step (screenshot or "done") and the feature shows "connected" on his phone.
- No secret value appears in any chat message, doc, memory file or commit.
- The step list exists in `docs/` if anyone else will ever repeat it.
