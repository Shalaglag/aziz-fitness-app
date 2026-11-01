# Friends and family in Mizan: setup

## One-time, by Aziz: publish the Firestore rules
Friends uses a few shared Firestore collections next to the per-person `users/{uid}` data. Firestore refuses
them until the rules are published:

1. Firebase console → project **aziz-fitness** → Build → **Firestore Database** → **Rules**.
2. Replace everything with the contents of `firestore.rules` from this repo (main) → **Publish**.

Until then the Friends screen shows "Friends isn't switched on in the server yet" and the rest of Mizan works as before.
No new service, plan or key is needed: Spark's free quota (50k reads, 20k writes a day) covers a family easily.

## For a brother or friend
1. Install Mizan from https://github.com/Shalaglag/mizan-releases/releases/tag/android-latest (tap `aziz-fitness.apk`,
   allow installs from the browser if asked). Updates arrive through Settings › Updates.
2. Open it and tap **Create account** (any email + a password of 6+ characters). Everything they log is their own
   account; nobody else can read it.
3. Menu (More) → **Friends** → **Friends** tab → type the code you sent them → **Send request**. Or they send you theirs.
4. You accept under Friends → Requests.
5. Each of you: Friends → **Sharing** → switch on **Steps** (and anything else you want to compare).
6. Steps: Today → Steps → **Allow access** to Health Connect, and in Samsung Health or Google Fit allow Health
   Connect to share Steps (Settings › Health Connect in Mizan has the walkthrough). Steps update whenever Mizan
   is opened; there is no background sync, so the board shows when each person was last updated.

## What is shared
Only what each person switches on, only with accepted friends, only as summaries: step counts and goal, training
days, water progress, cardio minutes/km, best set per exercise (kg), whether calorie/protein targets were hit, and
weight *change* (kg or %) over 30 days. Never meals, weigh-ins, sets, health markers or location. Challenges share
only the number the challenge counts with its participants. Removing a friend or switching a category off stops it
immediately on both phones.
