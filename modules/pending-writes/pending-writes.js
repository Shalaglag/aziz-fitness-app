/* PendingWrites: a small outbox for the synced database.
 * Every write is recorded in localStorage before it is attempted, retried until it
 * succeeds, coalesced per document, and laid over incoming snapshots so a doc with
 * an unsent local change is never replaced by the server copy.
 *
 *   const q = PendingWrites.create({ storage: localStorage, key: "aziz-cut-pending",
 *     mergeCols: ["days","prefs"], exec: async w => {...}, onChange: n => {...} });
 *   q.load();                                 // read what a previous visit left behind
 *   q.put(col, id, data, before);             // before = the doc as last seen (or undefined)
 *   q.remove(col, id);
 *   q.overlay(col, docsFromSnapshot);         // returns the map with pending docs applied
 *   q.retryAll();                             // on reconnect / visibility / timer / db ready
 *   q.size(); q.list();
 *
 * A write w is {col,id,op:"set"|"delete",data,fields?,at,err?}. `fields` is set when the
 * col is in mergeCols and `before` exists: only those top-level keys changed, so exec can
 * send a field merge (db update) instead of replacing the whole doc. exec must throw on
 * failure; it may fall back from update to set itself (see PendingWrites.pick).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PendingWrites = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);

  /* Top-level keys of `after` that differ from `before`; null when a key was removed
   * (a field merge can't drop a key, so the caller must replace the whole doc). */
  function changedFields(before, after) {
    if (!before || typeof before !== "object" || !after || typeof after !== "object") return null;
    for (const k of Object.keys(before)) if (!(k in after)) return null;
    return Object.keys(after).filter(k => !same(before[k], after[k]));
  }
  function pick(data, fields) { const o = {}; fields.forEach(k => { if (k in data) o[k] = data[k]; }); return o; }

  function create(opts) {
    const storage = opts.storage, key = opts.key || "pending-writes";
    const mergeCols = opts.mergeCols || [];
    const exec = opts.exec, onChange = opts.onChange || (() => {});
    const now = opts.now || Date.now;
    let pending = {}, chains = {}, enabled = true, bulkDepth = 0;
    const batchSize = opts.batchSize || 200;

    function save() { try { if (storage) storage.setItem(key, JSON.stringify(pending)); } catch (e) {} onChange(size(), pending); }
    function load() { try { const j = storage && JSON.parse(storage.getItem(key) || "null"); pending = j && typeof j === "object" ? j : {}; } catch (e) { pending = {}; } onChange(size(), pending); return size(); }
    function size() { return Object.keys(pending).length; }
    function list() { return Object.values(pending); }
    const keyOf = (col, id) => col + "/" + id;

    function queue(w) {
      const k = keyOf(w.col, w.id), p = pending[k];
      if (p) {
        if (w.op === "set" && p.op === "set" && p.fields && w.fields) w.fields = Array.from(new Set(p.fields.concat(w.fields)));
        else delete w.fields;                        // older full write still unsent: send the whole doc
        w.told = p.told;
      }
      pending[k] = w;
      if (bulkDepth) return Promise.resolve();        // inside bulk(): saved and sent together at the end
      save();
      return flush(k);
    }
    // Many writes at once (an import): queue them all, store once, then send them in batches via
    // opts.execMany (when the db has one) instead of hundreds of single requests.
    async function bulk(fn) {
      bulkDepth++;
      try { await fn(); } finally { bulkDepth--; if (!bulkDepth) save(); }
      if (!bulkDepth) await retryAll();
    }
    function flushMany(ws) {
      const p = (async () => {
        try {
          await opts.execMany(ws);
          ws.forEach(w => { const k = keyOf(w.col, w.id); if (pending[k] === w) delete pending[k]; });
          save();
        } catch (e) {
          const first = ws.some(w => !w.told);
          ws.forEach(w => { w.err = String((e && (e.message || e.code)) || e); w.told = true; });
          save();
          if (first && opts.onFail) opts.onFail(ws[0], e);
        }
      })();
      ws.forEach(w => { chains[keyOf(w.col, w.id)] = p; });
      return p;
    }
    function flush(k) {
      chains[k] = (chains[k] || Promise.resolve()).then(async () => {
        const w = pending[k];
        if (!w || !enabled) return;
        try {
          await exec(w);
          if (pending[k] === w) { delete pending[k]; save(); }
        } catch (e) {
          w.err = String((e && (e.message || e.code)) || e);
          const first = !w.told; w.told = true; save();
          if (first && opts.onFail) opts.onFail(w, e);
        }
      });
      return chains[k];
    }

    function put(col, id, data, before) {
      const w = { col, id, op: "set", data, at: now() };
      if (mergeCols.includes(col) && before !== undefined) {
        const f = changedFields(before, data);
        if (f && !f.length && !pending[keyOf(col, id)]) return Promise.resolve();   // nothing changed, nothing to send
        if (f) w.fields = f;
      }
      return queue(w);
    }
    function remove(col, id) { return queue({ col, id, op: "delete", at: now() }); }
    function overlay(col, docs) {
      for (const k in pending) {
        const w = pending[k]; if (w.col !== col) continue;
        if (w.op === "delete") delete docs[w.id];
        else if (w.fields && docs[w.id]) docs[w.id] = Object.assign({}, docs[w.id], pick(w.data, w.fields));
        else docs[w.id] = w.data;
      }
      return docs;
    }
    function retryAll() {
      if (!enabled) return Promise.resolve();
      const keys = Object.keys(pending);
      if (opts.execMany && keys.length > 1) {
        const many = keys.map(k => pending[k]).filter(w => !w.fields);   // field merges still go one by one
        if (many.length > 1) {
          const chunks = [];
          for (let i = 0; i < many.length; i += batchSize) chunks.push(many.slice(i, i + batchSize));
          return Promise.all(chunks.map(flushMany).concat(keys.filter(k => pending[k].fields).map(flush)));
        }
      }
      return Promise.all(keys.map(flush));
    }
    function firstError() { const w = Object.values(pending).find(x => x.err); return w ? w.err : null; }
    function setEnabled(v) { enabled = !!v; if (v) retryAll(); }

    return { load, put, remove, overlay, retryAll, bulk, firstError, flush: (col, id) => flush(keyOf(col, id)), size, list, setEnabled, has: (col, id) => !!pending[keyOf(col, id)] };
  }

  return { create, changedFields, pick };
});
