# Cloud store (own website: sign-in, sync, offline)

Inside Claude the app saves through Claude's synced database. On its own website it uses this module
instead: Firebase email + password sign-in, and Firestore for storage, under `users/{uid}/...`.

- `CloudStore.loadConfig()` loads `app/cloud-config.js` on demand (never inside Claude) and resolves whether a valid config is present.
- `CloudStore.connect({mount})` → a db with the same shape the shell already uses
  (`collection(c).doc(id).set/update/delete/get`, `collection(c).onSnapshot/add/get`), or `null`
  when `app/cloud-config.js` is empty or the person picks "Use without an account".
- Shows a sign-in sheet the first time on each device; after that the session is remembered.
- Firestore's offline cache (`enablePersistence`) keeps logging working at the gym with no signal and
  syncs when back online. `app/sw.js` caches the app itself so it opens offline.
- `update()` on a missing doc is reported as `invalid_argument`, which the outbox (pending-writes)
  already treats as "fall back to set".
- Tests: `node --test modules/cloud-store/cloud-store.test.js`.

Claude-only features don't exist on the website: photo food logging and menu import need Claude to
read the image, and progress photos need Claude's file storage, so those cards won't work there yet.

## Setup (once)

1. Firebase console → Add project (Analytics off) → Build → Authentication → Sign-in method →
   Email/Password → Enable.
2. Build → Firestore Database → Create database (production mode, nearest region) → Rules → paste
   `firestore.rules` from the repo root → Publish.
3. Project settings → Your apps → Web (`</>`) → register → copy `apiKey`, `authDomain`,
   `projectId`, `appId` into `app/cloud-config.js`.
4. Netlify → Add new site → Import from GitHub → this repo. `netlify.toml` sets the publish folder
   to `app`. Every push to `main` redeploys.
5. Move existing data: in the Claude version, Guide → export everything; on the website, Guide →
   import that file.
