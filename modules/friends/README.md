# Friends, step leaderboard, comparisons and challenges

Lets people who each have their own Mizan account (Firebase email + password, `modules/cloud-store`) connect,
compare what they choose to share, and run private challenges. Plain script, `window.Friends`.

- Tests: `node --test modules/friends/friends.test.js` (pure functions and HTML, 14 tests).
- Backend rules: `firestore.rules` at the repo root. `cd tools/firestore-rules && npm install && npm test`
  runs them on the Firestore emulator (needs Java); `npm run e2e` there runs `tests/friends-e2e.test.js`,
  two phones with two accounts on the Auth + Firestore emulators (invite, accept, share, leaderboard,
  compare, challenge, stop sharing, remove, and that an outsider or ex-friend is refused).

## Data (Firestore, outside `users/{uid}`)
| Collection | Written by | Readable by |
|---|---|---|
| `profiles/{uid}` `{name, avatar, code, updatedAt}` | owner | any signed-in person, one at a time (no listing) |
| `invites/{code}` `{uid, name, avatar}` | owner | any signed-in person, by exact code only |
| `requests/{from_to}` `{from, to, fromName, fromAvatar, toName, toAvatar, at}` | sender creates; either side deletes | both sides |
| `friends/{a_b}` `{users:[a,b], names, since}` | the request's *recipient* creates (rules check the request exists); either side deletes | both |
| `shares/{uid}` | owner, from `buildShare` | accepted friends only |
| `challenges/{id}` | creator; invited people may only add/remove themselves | invited + members |
| `challenges/{id}/entries/{uid}` | that member | invited + members |

`shares/{uid}` holds only the categories switched on (`cats`), each as a summary of the last 35 days:
`steps {goal, days{date:n}, at, source, connected}`, `workouts {weekGoal, dates[]}`, `water {goal, days, goals}`,
`cardio {days{date:{min,km}}}`, `strength {ex{name:{kg,reps,e1rm,at}}}` (best set per exercise, kg, 90 days),
`nutrition {days{date:{kcalOk,proteinOk}}}` (never meals), `weight {mode, change|pct, since, days}` (never the
weight). Challenge entries carry only `{s, g}` (steps, goal) and/or `{w}` per day inside the challenge window.

Sharing choices are the person's own `prefs/friends` doc (`{steps:bool, …, weightMode, weekGoal, name, avatar}`).

## API
`buildShare(profile, sharing, ctx)`, `buildEntry(challenge, profile, ctx)`, `periodRange(period, today)`,
`leaderboard(shares, period, today, {me, now})` → `{rows[{uid,name,status,total,goal,pct,remaining,goalDays,diff,ago}], nDays}`
(status `ok | stale | notShared | notConnected | noData`; stale after 36 h), `compare(a, b, today)`,
`challengeStatus`, `challengeProgress(ch, entries, today)`, `validateChallenge(form, today)`, `screenHTML(state, ctx)`,
`signedOutHTML(cloudReady)`, `mount({fs, uid, email, today, ctx, getSharing, setSharing, render, toast, confirm, share, goSteps, apkUrl})`
→ `{state, handle(el, target), change(el), schedulePublish(ms), publish(), destroy, html(ctx)}`, `css`.

Taps use `data-fr="…"` (+ `data-k`); the shell delegates `[data-fr]` clicks to `handle` and `[data-fr-change]` to `change`.
`schedulePublish` is debounced (4 s) and writes only when the summary or an entry actually changed.
A listener refused right after a friendship or challenge was created (write still in flight) is retried a few times.

## Steps
The leaderboard reads each person's `days/{date}.steps`, which `modules/steps/health-connect-steps.js` fills from
Health Connect while Mizan is on screen (open / resume, once a minute at most); Health Connect already
de-duplicates phone + watch + several apps. There is no background sync, so a friend's count is as fresh as their
last app open; the row shows "updated 2 h ago" and turns to "Updated 3 days ago" (stale) after 36 hours.
Typed steps count too (`source: "manual"`). No steps shared → "Not sharing steps"; shared but never connected → "Steps not connected".

## Removing and stopping
Removing a friend deletes `friends/{a_b}`; from then on the rules refuse both share documents, both apps drop the
other person's row at once, and nothing new flows either way. Switching a category off rewrites `shares/{uid}`
without it. Leaving a challenge deletes your entry and takes you off its lists; the creator can delete the whole
challenge (and all entries).
