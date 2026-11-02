# PendingWrites

Outbox for the app's synced database so a failed write is never lost.

- `pending-writes.js`: UMD, no dependencies. Inlined into `app/index.html` as the block before the shell (v19).
- `pending-writes.test.js`: `node --test modules/pending-writes/pending-writes.test.js` (8 tests).

## API
```js
const q = PendingWrites.create({ storage, key, mergeCols, exec, onChange, onFail });
q.load()                      // restore the outbox from storage; returns its size
q.put(col, id, data, before)  // queue a set; `before` = doc as last seen → field merge for mergeCols
q.remove(col, id)             // queue a delete
q.overlay(col, docs)          // apply pending writes on top of a snapshot map (mutates, returns it)
q.retryAll(); q.size(); q.list(); q.has(col, id)
q.bulk(async () => { …many puts… })   // store once, then send through execMany in batches of opts.batchSize (200)
q.firstError()                 // error text of a failed pending write, or null
PendingWrites.changedFields(before, after)   // top-level keys that differ, or null when a key was removed
PendingWrites.pick(data, fields)
```
- A write is recorded in storage **before** it is attempted, so a crash or closed tab still retries next load.
- Writes to one doc run one at a time and coalesce: the newest data wins, field lists are unioned, and a full write after a field write sends the whole doc.
- `execMany(ws)` (optional) sends many full writes/deletes in one db batch; field merges still go through `exec`. The shell's uses `db.batch()` from CloudStore.
- `exec(w)` does the real db call and must throw on failure. The shell's exec uses `doc.update(pick(data, fields))` when `w.fields` is set and falls back to `doc.set(data)` on `invalid_argument` (doc not yet created).
- `onChange(n)` drives the header badge; `onFail(w, err)` fires once per queued write.

## Shell wiring (app/index.html)
`put()` / `remove()` call the outbox in synced mode (localStorage mode unchanged). Each collection's `onSnapshot` passes its map through `overlay()` so an unsent local change is not replaced by the server copy. Retries run on db ready, `online`, `visibilitychange` (visible), a 30 s timer while anything is pending, and when the header badge is tapped.
