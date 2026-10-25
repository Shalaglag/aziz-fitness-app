/* Progress photos for the Aziz Cut Tracker: weekly front / side / back photos, a before/after slider,
 * and an aligned timelapse with a weight / waist overlay.
 * Plain JS, no imports, no network. Mount with:
 *   ProgressPhotos.mount(element, { storage, assets, weights, today })
 * storage: { list(coll) -> Promise<doc[]>, put(coll, id, doc) -> Promise, remove(coll, id) -> Promise }
 *   Collection used: photos/{date} = {date, front, side, back, waist?, align?, at}. Each pose holds an image ref;
 *   waist is cm (optional, typed next to the photos); align = {front:{x,y,s}, ...} lines a photo up with the
 *   first photo of that pose (x, y in % of the frame, s = scale) and is applied in the slider and timelapse.
 *   Omit storage to use localStorage.
 * assets: the Artifact `assets` namespace (await claude.use("assets")). Photos upload there and the ref
 *   is the asset id, shown via "/_blob/" + id. Omit or pass null to keep photos in this browser's
 *   IndexedDB instead (ref "idb:<key>"). Refs that are already URLs (data:, blob:, http, /) show as is.
 * weights: optional { list() -> Promise<[{date:'YYYY-MM-DD', kg}]> } to label each photo set with body weight.
 * measures: optional { list() -> Promise<[{date, waist}]> } for waist (cm) logged elsewhere; a waist typed on the
 *   photo day wins.
 * today: optional 'YYYY-MM-DD' (defaults to the device's local date).
 * Returns { refresh(), destroy() }. Call refresh() when the photos collection may have changed on another device.
 * Every photo is downscaled to 1600 px on the long edge and re-encoded as JPEG before it is saved,
 * which also drops EXIF data (GPS location, camera details).
 * Pure helpers (used by the tests): sets(docs), datesWith(docs, pose), defaultPair(docs, pose),
 *   nextDue(docs, today), weightNear(weights, date), srcOf(ref), frames(docs, pose, weights, waists), xform(align).
 * Styling uses the shell tokens (--bg --surface --sunk --line --ink --muted --accent --accent-ink
 *   --good --warn --bad --display --body --mono --r) with fallbacks.
 */
(function (global) {
  'use strict';

  const COLL = 'photos';
  const POSES = [['front', 'Front'], ['side', 'Side'], ['back', 'Back']];
  const MAX_EDGE = 1600, QUALITY = 0.85, DAY = 864e5;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const ms = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const iso = t => new Date(t).toISOString().slice(0, 10);
  const addDays = (s, n) => iso(ms(s) + n * DAY);
  const short = s => { const d = new Date(ms(s)); return MON[d.getUTCMonth()] + ' ' + d.getUTCDate(); };
  const withDay = s => WD[new Date(ms(s)).getUTCDay()] + ' ' + short(s);
  const localToday = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- pure helpers ----------
  // docs: {date: {date, front, side, back}} -> sets with at least one photo, oldest first
  function sets(docs) {
    return Object.values(docs || {})
      .filter(d => d && isDate(d.date) && POSES.some(([p]) => d[p]))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  }
  function datesWith(docs, pose) { return sets(docs).filter(d => d[pose]).map(d => d.date); }
  // first and latest photo of a pose; null until there are two
  function defaultPair(docs, pose) {
    const ds = datesWith(docs, pose);
    return ds.length >= 2 ? { before: ds[0], after: ds[ds.length - 1] } : null;
  }
  // next photo day: 7 days after the latest complete set (or after the latest partial set)
  function nextDue(docs, today) {
    const all = sets(docs);
    if (!all.length) return { date: today, state: 'start' };
    const last = all[all.length - 1];
    const complete = POSES.every(([p]) => last[p]);
    if (!complete && last.date >= addDays(today, -6)) return { date: last.date, state: 'partial', missing: POSES.filter(([p]) => !last[p]).map(([, l]) => l) };
    const due = addDays(last.date, 7);
    return { date: due, state: due <= today ? 'due' : 'done' };
  }
  // the weigh-in on that date, else the closest one within 3 days
  function weightNear(weights, date) {
    let best = null;
    (weights || []).forEach(w => {
      if (!w || !isDate(w.date) || !(+w.kg > 0)) return;
      const gap = Math.abs(ms(w.date) - ms(date)) / DAY;
      if (gap <= 3 && (!best || gap < best.gap || (gap === best.gap && w.date < best.date))) best = { date: w.date, kg: +w.kg, gap };
    });
    return best;
  }
  // timelapse frames for a pose: date, ref, week number from the first frame, weight and waist with change from frame 1
  function frames(docs, pose, weights, waists) {
    const out = sets(docs).filter(d => d[pose]).map(d => {
      const w = weightNear(weights, d.date);
      const typed = +d.waist > 0 ? +d.waist : null;
      const m = typed ? null : weightNear((waists || []).map(x => x && { date: x.date, kg: x.waist }), d.date);
      return { date: d.date, ref: d[pose], align: (d.align && d.align[pose]) || null, kg: w ? w.kg : null, waist: typed || (m ? m.kg : null) };
    });
    const f0 = out[0], k0 = out.find(x => x.kg != null), w0 = out.find(x => x.waist != null);
    out.forEach(f => {
      f.week = Math.floor((ms(f.date) - ms(f0.date)) / (7 * DAY)) + 1;
      f.dKg = f.kg != null && k0 ? Math.round((f.kg - k0.kg) * 10) / 10 : null;
      f.dWaist = f.waist != null && w0 ? Math.round((f.waist - w0.waist) * 10) / 10 : null;
    });
    return out;
  }
  // CSS transform for an alignment {x, y, s}
  function xform(a) {
    if (!a) return '';
    const x = +a.x || 0, y = +a.y || 0, s = +a.s || 1;
    if (!x && !y && s === 1) return '';
    return 'transform:translate(' + x + '%,' + y + '%) scale(' + s + ')';
  }
  const sgn = (n, d) => (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n).toFixed(d);

  // display source for a ref; idb refs resolve asynchronously (null here)
  function srcOf(ref) {
    if (!ref || typeof ref !== 'string') return null;
    if (ref.startsWith('idb:')) return null;
    if (/^(data:|blob:|https?:|\/)/.test(ref)) return ref;
    if (/^[A-Za-z0-9_-]{8,64}$/.test(ref)) return '/_blob/' + ref;
    return null;
  }

  // ---------- image preparation ----------
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => resolve({ img, url });
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a photo this browser can open.')); };
      img.src = url;
    });
  }
  // downscale + re-encode; browsers apply EXIF orientation when drawing, and the new JPEG carries no EXIF
  async function prepare(file) {
    const { img, url } = await loadImage(file);
    try {
      const w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, MAX_EDGE / Math.max(w, h));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', QUALITY));
      if (!blob) throw new Error('Could not process that photo.');
      return blob;
    } finally { URL.revokeObjectURL(url); }
  }

  // ---------- photo stores ----------
  function assetStore(assets) {
    return {
      kind: 'assets',
      async save(blob) {
        try { return (await assets.upload(blob, { type: 'image/jpeg' })).id; }
        catch (e) {
          if (e && e.code === 'store_unavailable') { await new Promise(r => setTimeout(r, 1200)); return (await assets.upload(blob, { type: 'image/jpeg' })).id; }
          throw e;
        }
      },
      async remove(ref) { if (srcOf(ref) === '/_blob/' + ref) await assets.delete(ref); },
      async src(ref) { return srcOf(ref); },
    };
  }
  function idbStore() {
    const mem = new Map(), urls = new Map();
    let dbp = null;
    const open = () => dbp || (dbp = new Promise((resolve) => {
      try {
        const req = indexedDB.open('aziz-progress-photos', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('blobs');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    }));
    const tx = async (mode, fn) => {
      const db = await open();
      if (!db) return null;
      return new Promise((resolve, reject) => {
        const t = db.transaction('blobs', mode), req = fn(t.objectStore('blobs'));
        t.oncomplete = () => resolve(req && req.result);
        t.onerror = () => reject(t.error);
      });
    };
    return {
      kind: 'local',
      async save(blob) {
        const key = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        try { if ((await open())) { await tx('readwrite', s => s.put(blob, key)); return 'idb:' + key; } } catch (e) {}
        mem.set(key, blob); return 'idb:' + key;
      },
      async remove(ref) {
        if (!ref || !ref.startsWith('idb:')) return;
        const key = ref.slice(4);
        mem.delete(key);
        if (urls.has(ref)) { URL.revokeObjectURL(urls.get(ref)); urls.delete(ref); }
        try { await tx('readwrite', s => s.delete(key)); } catch (e) {}
      },
      async src(ref) {
        if (!ref || !ref.startsWith('idb:')) return srcOf(ref);
        if (urls.has(ref)) return urls.get(ref);
        const key = ref.slice(4);
        let blob = mem.get(key);
        if (!blob) { try { blob = await tx('readonly', s => s.get(key)); } catch (e) {} }
        if (!blob) return null;
        const u = URL.createObjectURL(blob); urls.set(ref, u); return u;
      },
    };
  }
  function localDocs() {
    const KEY = 'aziz-progress-photos';
    const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } };
    const write = o => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {} };
    return {
      list: async () => Object.values(read()),
      put: async (c, id, doc) => { const o = read(); o[id] = doc; write(o); },
      remove: async (c, id) => { const o = read(); delete o[id]; write(o); },
    };
  }

  // ---------- styles ----------
  const css = `
.pp{background:var(--surface,#fff);border:1px solid var(--line,#ddd);border-radius:var(--r,14px);padding:16px;display:flex;flex-direction:column;gap:14px;min-width:0;color:var(--ink,#111);font-family:var(--body,system-ui,sans-serif)}
.pp *{box-sizing:border-box}
.pp h2{margin:0;font-family:var(--display,inherit);font-size:1.4rem}
.pp h3{margin:0;font-size:1rem}
.pp p{margin:0}
.pp-head{display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap}
.pp-due{font-size:.85rem;font-weight:600;padding:4px 10px;border-radius:999px;background:var(--sunk,#f2f2f2);color:var(--muted,#666)}
.pp-due.is-due{background:var(--accent,#111);color:var(--accent-ink,#fff)}
.pp-sub,.pp-note,.pp-meta{color:var(--muted,#666);font-size:.88rem}
.pp-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.pp-row label{font-size:.88rem;color:var(--muted,#666);display:flex;align-items:center;gap:6px}
.pp input[type=date],.pp select{font:inherit;color:var(--ink,#111);background:var(--bg,#fff);border:1px solid var(--line,#ddd);border-radius:8px;padding:6px 8px;min-width:0}
.pp-slots{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.pp-slot{display:flex;flex-direction:column;gap:4px;min-width:0}
.pp-tile{position:relative;aspect-ratio:3/4;width:100%;border:1.5px dashed var(--line,#ccc);border-radius:10px;background:var(--sunk,#f4f4f4);color:var(--muted,#666);cursor:pointer;overflow:hidden;padding:0;font:inherit;font-weight:600;display:flex;align-items:center;justify-content:center}
.pp-tile.has{border-style:solid}
.pp-tile img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.pp-tile .pp-busy{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--surface,#fff) 70%,transparent)}
.pp-foot{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:4px;font-size:.82rem;min-height:28px}
.pp-foot .pp-btn{flex:1 1 auto;white-space:nowrap;padding:4px 6px}
.pp-foot span:empty{display:none}
.pp-tile .pp-tag{bottom:6px;left:6px;font-size:.72rem}
.pp-btn{border:1px solid var(--line,#ddd);background:transparent;color:var(--ink,#111);border-radius:8px;padding:4px 9px;cursor:pointer;font:inherit;font-size:.82rem;font-weight:600}
.pp-btn.warn{border-color:var(--bad,#c33);color:var(--bad,#c33)}
.pp-btn[aria-pressed=true]{background:var(--ink,#111);color:var(--bg,#fff);border-color:var(--ink,#111)}
.pp-seg{display:inline-flex;border:1px solid var(--line,#ddd);border-radius:999px;padding:2px;gap:2px}
.pp-seg button{border:0;background:transparent;color:var(--ink,#111);border-radius:999px;padding:5px 12px;font:inherit;font-size:.86rem;font-weight:600;cursor:pointer}
.pp-seg button[aria-pressed=true]{background:var(--ink,#111);color:var(--bg,#fff)}
.pp-cmp{display:flex;flex-direction:column;gap:10px;border-top:1px solid var(--line,#ddd);padding-top:14px}
.pp-stage{position:relative;aspect-ratio:3/4;width:100%;max-width:440px;margin-inline:auto;border-radius:12px;overflow:hidden;background:var(--sunk,#eee);touch-action:pan-y;user-select:none;-webkit-user-select:none;cursor:ew-resize;--x:50%}
.pp-layer{position:absolute;inset:0;overflow:hidden}
.pp-layer img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;pointer-events:none;-webkit-user-drag:none;transform-origin:50% 50%}
.pp-pair .pp-layer img{position:absolute}
.pp-stage .pp-before{clip-path:inset(0 calc(100% - var(--x)) 0 0)}
.pp h4{margin:4px 0 0;font-size:.8rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted,#666)}
.pp-align{display:flex;flex-direction:column;gap:10px;border:1px solid var(--ink,#111);border-radius:12px;padding:12px}
.pp-astage{cursor:move;touch-action:none}
.pp-ghost{opacity:.5}
.pp-sliders{display:grid;grid-template-columns:1fr;gap:6px;max-width:440px;width:100%;margin-inline:auto}
.pp-sliders label{display:grid;grid-template-columns:7.5em 1fr;align-items:center;gap:8px;font-size:.86rem;color:var(--muted,#666)}
.pp-sliders input{accent-color:var(--accent,#111)}
.pp-btn.solid{background:var(--ink,#111);color:var(--bg,#fff);border-color:var(--ink,#111)}
.pp-btn.wide{flex:1}
.pp-tlstage{cursor:default}
.pp-tlstage .pp-layer{opacity:0;transition:opacity .35s ease}
.pp-tlstage .pp-layer.is-on{opacity:1}
.pp-ov{position:absolute;left:8px;top:8px;display:flex;flex-direction:column;gap:2px;padding:6px 9px;border-radius:8px;background:rgba(0,0,0,.62);color:#fff;font-family:var(--mono,ui-monospace,monospace);font-size:.82rem;pointer-events:none}
.pp-ov span:empty{display:none}
.pp-tlbar{max-width:440px;width:100%;margin-inline:auto;flex-wrap:nowrap}
.pp-tlbar .pp-range{flex:1;min-width:60px}
@media (max-width:420px){.pp-tlbar{flex-wrap:wrap}.pp-tlbar .pp-range{order:3;flex-basis:100%}}
@media (prefers-reduced-motion:reduce){.pp-tlstage .pp-layer{transition:none}}
.pp-handle{position:absolute;top:0;bottom:0;left:var(--x);width:2px;margin-left:-1px;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.25);pointer-events:none}
.pp-handle::after{content:"";position:absolute;top:50%;left:50%;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.35);
  background-image:linear-gradient(90deg,transparent 9px,#555 9px,#555 11px,transparent 11px,transparent 23px,#555 23px,#555 25px,transparent 25px)}
.pp-tag{position:absolute;bottom:8px;padding:3px 8px;border-radius:6px;background:rgba(0,0,0,.6);color:#fff;font-size:.78rem;font-weight:600;pointer-events:none}
.pp-tag.l{left:8px}.pp-tag.r{right:8px}
.pp-pair{display:grid;grid-template-columns:1fr 1fr;gap:6px;max-width:560px;width:100%;margin-inline:auto}
.pp-pair figure{margin:0;position:relative;aspect-ratio:3/4;border-radius:10px;overflow:hidden;background:var(--sunk,#eee)}
.pp-pair img{width:100%;height:100%;object-fit:cover;display:block}
.pp-range{width:100%;max-width:440px;margin-inline:auto;accent-color:var(--accent,#111)}
.pp-delta{text-align:center;font-size:.92rem;font-variant-numeric:tabular-nums}
.pp-delta b{font-family:var(--mono,ui-monospace,monospace);font-weight:500}
.pp-hist{display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--line,#ddd);padding-top:14px}
.pp-hrow{display:flex;align-items:center;gap:10px;padding:6px;border:1px solid var(--line,#ddd);border-radius:10px;background:transparent;color:inherit;font:inherit;cursor:pointer;text-align:left;width:100%}
.pp-hrow[aria-current=true]{border-color:var(--ink,#111)}
.pp-thumbs{display:flex;gap:4px;flex:none}
.pp-thumbs span{width:30px;height:40px;border-radius:5px;background:var(--sunk,#eee);overflow:hidden;display:block}
.pp-thumbs img{width:100%;height:100%;object-fit:cover;display:block}
.pp-hrow b{font-size:.92rem}
.pp-err{color:var(--bad,#c33);font-size:.86rem}
.pp-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
`;
  let cssDone = false;
  function injectCss() {
    if (cssDone || typeof document === 'undefined') return;
    cssDone = true;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  }

  // ---------- mount ----------
  function mount(root, opts) {
    opts = opts || {};
    injectCss();
    const storage = opts.storage || localDocs();
    const store = opts.assets ? assetStore(opts.assets) : idbStore();
    const today = isDate(opts.today) ? opts.today : localToday();
    const st = { docs: {}, weights: [], edit: today, pose: 'front', before: null, after: null, mode: 'slider', x: 50, busy: {}, armed: null, err: '', loaded: false,
      waists: [], align: null, draft: null, tl: { i: -1, playing: false, speed: 'normal' } };
    let alive = true, armTimer = null, tlTimer = null;
    const SPEEDS = { slow: 1500, normal: 900, fast: 450 };

    const file = document.createElement('input');
    file.type = 'file'; file.accept = 'image/*'; file.hidden = true;
    let pickPose = null;

    async function load() {
      try {
        const list = await storage.list(COLL);
        const o = {}; (list || []).forEach(d => { if (d && isDate(d.date)) o[d.date] = d; });
        st.docs = o;
      } catch (e) { st.err = 'Could not load photos: ' + (e.message || e.code || e); }
      try { st.weights = opts.weights ? (await opts.weights.list()) || [] : []; } catch (e) { st.weights = []; }
      try { st.waists = opts.measures ? (await opts.measures.list()) || [] : []; } catch (e) { st.waists = []; }
      st.loaded = true;
      if (alive) render();
    }

    function pair() {
      const ds = datesWith(st.docs, st.pose);
      if (ds.length < 2) return null;
      let b = ds.includes(st.before) ? st.before : ds[0];
      let a = ds.includes(st.after) ? st.after : ds[ds.length - 1];
      if (a === b) { a = ds[ds.length - 1]; b = ds[0]; }
      if (a < b) [a, b] = [b, a];
      return { before: b, after: a, dates: ds };
    }

    function label(date) {
      const w = weightNear(st.weights, date);
      return short(date) + (w ? ' · ' + w.kg.toFixed(1) + ' kg' : '');
    }

    function dueLine() {
      const n = nextDue(st.docs, today);
      if (n.state === 'start') return ['Take your first set today', true];
      if (n.state === 'partial') return ['Still to take: ' + n.missing.join(', '), true];
      if (n.state === 'due') return ['Photos due' + (n.date < today ? ' since ' + withDay(n.date) : ' today'), true];
      return ['Next photos ' + withDay(n.date), false];
    }

    function img(ref, cls, alt, style) {
      const s = srcOf(ref);
      return `<img ${cls ? `class="${cls}" ` : ''}${style ? `style="${style}" ` : ''}alt="${esc(alt)}" ${s ? `src="${esc(s)}"` : `data-pp-ref="${esc(ref)}"`}>`;
    }
    // a full-frame layer whose photo carries its alignment; clipping goes on the layer so the divider stays straight
    function layer(date, cls, alt) {
      const d = st.docs[date] || {};
      return `<div class="pp-layer${cls ? ' ' + cls : ''}">${img(d[st.pose], '', alt, xform(d.align && d.align[st.pose]))}</div>`;
    }
    const refDate = pose => datesWith(st.docs, pose)[0] || null;
    const fmtKg = f => f.kg == null ? '' : f.kg.toFixed(1) + ' kg' + (f.dKg ? ' (' + sgn(f.dKg, 1) + ')' : '');
    const fmtWaist = f => f.waist == null ? '' : 'Waist ' + (Math.round(f.waist * 10) / 10) + ' cm' + (f.dWaist ? ' (' + sgn(f.dWaist, 1).replace('.0', '') + ')' : '');

    function render() {
      if (!alive) return;
      const doc = st.docs[st.edit] || {};
      const [due, isDue] = dueLine();
      const p = pair();
      const all = sets(st.docs).slice().reverse();

      const slots = POSES.map(([k, l]) => {
        const ref = doc[k], busy = st.busy[k];
        const armed = st.armed === st.edit + ':' + k;
        return `<div class="pp-slot">
          <button type="button" class="pp-tile${ref ? ' has' : ''}" data-pp-pick="${k}" aria-label="${ref ? 'Replace' : 'Add'} ${l.toLowerCase()} photo for ${esc(withDay(st.edit))}">
            ${ref ? img(ref, '', l + ' photo, ' + withDay(st.edit)) + `<span class="pp-tag l">${l}</span>` : `<span>+ ${l}</span>`}
            ${busy ? `<span class="pp-busy">Saving…</span>` : ''}
          </button>
          <div class="pp-foot">${ref && !busy ? (armed
            ? `<button type="button" class="pp-btn warn wide" data-pp-del="${k}">Tap to delete</button>`
            : (refDate(k) && refDate(k) < st.edit ? `<button type="button" class="pp-btn" data-pp-align="${k}" aria-label="Line up ${l.toLowerCase()} photo with the first one">Line up</button>` : '<span></span>')
              + `<button type="button" class="pp-btn" data-pp-del="${k}" aria-label="Delete ${l.toLowerCase()} photo">Delete</button>`) : ''}</div>
        </div>`;
      }).join('');

      let cmp;
      if (!p) {
        const n = datesWith(st.docs, st.pose).length;
        cmp = `<p class="pp-meta">${n ? 'One ' + st.pose + ' photo so far. Next week\'s photo unlocks the before/after slider.' : 'Take ' + st.pose + ' photos on two different weeks to compare them here.'}</p>`;
      } else {
        const opt = sel => p.dates.map(d => `<option value="${d}"${d === sel ? ' selected' : ''}>${esc(withDay(d))}</option>`).join('');
        const wb = weightNear(st.weights, p.before), wa = weightNear(st.weights, p.after);
        const days = Math.round((ms(p.after) - ms(p.before)) / DAY);
        const span = days >= 14 ? Math.round(days / 7) + ' weeks' : days + ' day' + (days === 1 ? '' : 's');
        const delta = wb && wa ? (wa.kg - wb.kg <= 0 ? '−' : '+') + Math.abs(wa.kg - wb.kg).toFixed(1) + ' kg over ' + span : span + ' apart';
        const view = st.mode === 'slider'
          ? `<div class="pp-stage" data-pp-stage style="--x:${st.x}%">
              ${layer(p.after, '', 'After, ' + withDay(p.after))}
              ${layer(p.before, 'pp-before', 'Before, ' + withDay(p.before))}
              <div class="pp-handle"></div>
              <span class="pp-tag l">Before · ${esc(short(p.before))}</span><span class="pp-tag r">After · ${esc(short(p.after))}</span>
            </div>
            <input class="pp-range" type="range" min="0" max="100" step="1" value="${st.x}" data-pp-range aria-label="Slide between before and after">`
          : `<div class="pp-pair">
              <figure>${layer(p.before, '', 'Before, ' + withDay(p.before))}<span class="pp-tag l">Before · ${esc(short(p.before))}</span></figure>
              <figure>${layer(p.after, '', 'After, ' + withDay(p.after))}<span class="pp-tag l">After · ${esc(short(p.after))}</span></figure>
            </div>`;
        cmp = `<div class="pp-row">
            <label>Before <select data-pp-before>${opt(p.before)}</select></label>
            <label>After <select data-pp-after>${opt(p.after)}</select></label>
            <span class="pp-seg" role="group" aria-label="View">
              <button type="button" data-pp-mode="slider" aria-pressed="${st.mode === 'slider'}">Slider</button>
              <button type="button" data-pp-mode="pair" aria-pressed="${st.mode === 'pair'}">Side by side</button>
            </span>
          </div>
          ${view}
          <p class="pp-delta">${esc(label(p.before))} → ${esc(label(p.after))}<br><b>${esc(delta)}</b></p>`;
      }

      const hasPhoto = POSES.some(([k]) => doc[k]);
      const waistRow = hasPhoto ? `<div class="pp-row"><label>Waist at the navel <input type="number" inputmode="decimal" step="0.5" min="40" max="200" data-pp-waist value="${+doc.waist > 0 ? doc.waist : ''}" placeholder="optional" style="width:6.5em"> cm</label></div>` : '';

      // line-up panel: this day's photo, half see-through, over the first photo of that pose
      let alignPanel = '';
      if (st.align && doc[st.align] && refDate(st.align) && refDate(st.align) < st.edit) {
        const k = st.align, l = POSES.find(x => x[0] === k)[1], r0 = st.docs[refDate(k)], dr = st.draft || { x: 0, y: 0, s: 1 };
        alignPanel = `<div class="pp-align">
          <h3>Line up ${l.toLowerCase()} with ${esc(withDay(refDate(k)))}</h3>
          <p class="pp-meta">Drag the photo, or use the sliders, until your body sits on the first photo's outline. Shoulders, hips and feet are the best guides.</p>
          <div class="pp-stage pp-astage" data-pp-astage>
            <div class="pp-layer">${img(r0[k], '', 'First ' + l.toLowerCase() + ' photo')}</div>
            <div class="pp-layer pp-ghost">${img(doc[k], '', 'This photo', xform(dr) || 'transform:none')}</div>
          </div>
          <div class="pp-sliders">
            <label>Size <input type="range" min="70" max="140" step="1" value="${Math.round(dr.s * 100)}" data-pp-a="s"></label>
            <label>Left / right <input type="range" min="-30" max="30" step="0.5" value="${dr.x}" data-pp-a="x"></label>
            <label>Up / down <input type="range" min="-30" max="30" step="0.5" value="${dr.y}" data-pp-a="y"></label>
          </div>
          <div class="pp-row"><button type="button" class="pp-btn solid" data-pp-asave>Save</button><button type="button" class="pp-btn" data-pp-areset>Reset</button><button type="button" class="pp-btn" data-pp-acancel>Cancel</button></div>
        </div>`;
      }

      // timelapse of every photo of the pose, aligned, with weight and waist on top
      const fr = frames(st.docs, st.pose, st.weights, st.waists);
      let tl;
      if (fr.length < 2) tl = `<p class="pp-meta">The timelapse starts once there are two weeks of ${st.pose} photos.</p>`;
      else {
        if (st.tl.i < 0 || st.tl.i >= fr.length) st.tl.i = fr.length - 1;
        const f = fr[st.tl.i];
        tl = `<div class="pp-stage pp-tlstage" data-pp-tl>
            <div class="pp-layer pp-tl-a is-on">${img(f.ref, '', st.pose + ' photo, ' + withDay(f.date), xform(f.align))}</div>
            <div class="pp-layer pp-tl-b"><img alt=""></div>
            <div class="pp-ov" aria-live="off"><b data-pp-ov="t">Week ${f.week} · ${esc(short(f.date))}</b><span data-pp-ov="k">${esc(fmtKg(f))}</span><span data-pp-ov="w">${esc(fmtWaist(f))}</span></div>
          </div>
          <div class="pp-row pp-tlbar">
            <button type="button" class="pp-btn solid" data-pp-play aria-pressed="${st.tl.playing}">${st.tl.playing ? 'Pause' : 'Play'}</button>
            <input class="pp-range" type="range" min="0" max="${fr.length - 1}" step="1" value="${st.tl.i}" data-pp-scrub aria-label="Timelapse frame">
            <span class="pp-seg" role="group" aria-label="Speed">${['slow', 'normal', 'fast'].map(k => `<button type="button" data-pp-speed="${k}" aria-pressed="${st.tl.speed === k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</span>
          </div>
          <p class="pp-meta">${fr.length} photos, ${esc(short(fr[0].date))} to ${esc(short(fr[fr.length - 1].date))}.${fr.some((x, i) => i && !x.align) ? ' Use “Line up” on a photo day to keep the body in the same place from frame to frame.' : ''}</p>`;
      }

      const hist = all.length ? `<div class="pp-hist"><h3>All photo days</h3>${all.map(d => `
          <button type="button" class="pp-hrow" data-pp-open="${d.date}" aria-current="${d.date === st.edit}">
            <span class="pp-thumbs">${POSES.map(([k, l]) => `<span>${d[k] ? img(d[k], '', l + ' ' + short(d.date)) : ''}</span>`).join('')}</span>
            <span><b>${esc(withDay(d.date))}</b><br><span class="pp-meta">${esc((() => { const w = weightNear(st.weights, d.date); const n = POSES.filter(([k]) => d[k]).length; return (w ? w.kg.toFixed(1) + ' kg · ' : '') + n + ' of 3'; })())}</span></span>
          </button>`).join('')}</div>` : '';

      root.innerHTML = `<section class="pp" aria-label="Progress photos">
        <div class="pp-head"><h2>Progress photos</h2><span class="pp-due${isDue ? ' is-due' : ''}">${esc(due)}</span></div>
        <p class="pp-sub">Once a week: same spot, same light, same time of day (morning, before food). Front, side and back.</p>
        <div class="pp-row"><label>Photos for <input type="date" data-pp-date value="${st.edit}" max="${today}"></label>${st.edit !== today ? `<button type="button" class="pp-btn" data-pp-today>Today</button>` : ''}</div>
        <div class="pp-slots">${slots}</div>
        ${waistRow}
        ${st.err ? `<p class="pp-err" role="alert">${esc(st.err)}</p>` : ''}
        ${alignPanel}
        <div class="pp-cmp">
          <div class="pp-head"><h3>Compare</h3>
            <span class="pp-seg" role="group" aria-label="Pose">${POSES.map(([k, l]) => `<button type="button" data-pp-pose="${k}" aria-pressed="${st.pose === k}">${l}</button>`).join('')}</span>
          </div>
          <h4>Before / after</h4>
          ${cmp}
          <h4>Timelapse</h4>
          ${tl}
        </div>
        ${hist}
        <p class="pp-note">${store.kind === 'assets' ? 'Private to this app: only people you share it with can see these photos.' : 'Saved in this browser only, on this device.'} Photos are shrunk and location data is removed before saving.</p>
      </section>`;
      root.appendChild(file);
      fillAsync();
      tlFront = 'a'; tlSeq++;
      if (st.tl.playing) { if (fr.length < 2) stopTl(); else if (!tlTimer) startTl(); }
    }

    // ---------- timelapse playback (touches only the stage, never re-renders) ----------
    let tlFront = 'a', tlSeq = 0;
    function showFrame(i) {
      const fr = frames(st.docs, st.pose, st.weights, st.waists), stage = root.querySelector('[data-pp-tl]');
      if (!stage || !fr.length) return;
      st.tl.i = ((i % fr.length) + fr.length) % fr.length;
      const f = fr[st.tl.i], seq = ++tlSeq;
      const back = tlFront === 'a' ? 'b' : 'a';
      const la = stage.querySelector('.pp-tl-' + tlFront), lb = stage.querySelector('.pp-tl-' + back), im = lb.querySelector('img');
      const swap = () => {
        if (seq !== tlSeq || !stage.isConnected) return;
        im.setAttribute('style', xform(f.align)); im.alt = st.pose + ' photo, ' + withDay(f.date);
        lb.classList.add('is-on'); la.classList.remove('is-on'); tlFront = back;
        stage.querySelector('[data-pp-ov="t"]').textContent = 'Week ' + f.week + ' · ' + short(f.date);
        stage.querySelector('[data-pp-ov="k"]').textContent = fmtKg(f);
        stage.querySelector('[data-pp-ov="w"]').textContent = fmtWaist(f);
        const sc = root.querySelector('[data-pp-scrub]'); if (sc) sc.value = st.tl.i;
      };
      store.src(f.ref).then(u => {
        if (seq !== tlSeq) return;
        if (!u) { swap(); return; }
        if (im.getAttribute('src') === u && im.complete) { swap(); return; }
        im.onload = swap; im.onerror = swap; im.src = u;
      });
    }
    function startTl() {
      clearInterval(tlTimer);
      let hold = 0;
      tlTimer = setInterval(() => {
        const n = frames(st.docs, st.pose, st.weights, st.waists).length;
        if (st.tl.i === n - 1 && hold < 2) { hold++; return; } // linger on the latest photo before looping
        hold = 0; showFrame(st.tl.i + 1);
      }, SPEEDS[st.tl.speed] || 900);
    }
    function stopTl() { clearInterval(tlTimer); tlTimer = null; st.tl.playing = false; }

    // ---------- line-up ----------
    function setDraft(k, v) {
      const d = st.draft || (st.draft = { x: 0, y: 0, s: 1 });
      d[k] = k === 's' ? Math.max(0.7, Math.min(1.4, v)) : Math.max(-30, Math.min(30, Math.round(v * 2) / 2));
      const g = root.querySelector('.pp-ghost img'); if (g) g.setAttribute('style', xform(d) || 'transform:none');
      root.querySelectorAll('[data-pp-a]').forEach(r => { const kk = r.getAttribute('data-pp-a'); r.value = kk === 's' ? Math.round(d.s * 100) : d[kk]; });
    }
    async function saveAlign() {
      const k = st.align, date = st.edit, d = st.draft || { x: 0, y: 0, s: 1 };
      const cur = Object.assign({}, st.docs[date]);
      const a = Object.assign({}, cur.align);
      if (!d.x && !d.y && d.s === 1) delete a[k]; else a[k] = { x: d.x, y: d.y, s: Math.round(d.s * 100) / 100 };
      cur.align = a;
      try { await storage.put(COLL, date, cur); st.docs[date] = cur; st.align = null; st.draft = null; st.err = ''; }
      catch (e) { st.err = 'Not saved: ' + ((e && (e.message || e.code)) || 'unknown error'); }
      render();
    }
    async function saveWaist(v) {
      const date = st.edit, cur = Object.assign({}, st.docs[date]);
      if (!POSES.some(([k]) => cur[k])) return;
      const n = Math.round(parseFloat(v) * 10) / 10;
      if (v === '' || !(n > 0)) delete cur.waist; else if (n >= 40 && n <= 200) cur.waist = n; else return;
      try { await storage.put(COLL, date, cur); st.docs[date] = cur; } catch (e) { st.err = 'Waist not saved: ' + ((e && (e.message || e.code)) || 'unknown error'); }
      render();
    }

    function fillAsync() {
      root.querySelectorAll('img[data-pp-ref]').forEach(el => {
        const ref = el.getAttribute('data-pp-ref');
        store.src(ref).then(u => { if (u && el.isConnected) { el.src = u; el.removeAttribute('data-pp-ref'); } });
      });
      root.querySelectorAll('img').forEach(el => {
        el.addEventListener('error', () => { el.removeAttribute('src'); el.alt = 'Photo unavailable'; }, { once: true });
      });
    }

    async function savePhoto(pose, f) {
      const date = st.edit;
      st.err = ''; st.busy[pose] = true; render();
      let ref = null;
      try {
        const blob = await prepare(f);
        ref = await store.save(blob);
        const cur = Object.assign({ date }, st.docs[date] || {});
        const old = cur[pose];
        cur[pose] = ref; cur.at = new Date().toISOString();
        await storage.put(COLL, date, cur);
        st.docs[date] = cur;
        if (old && old !== ref) store.remove(old).catch(() => {});
      } catch (e) {
        if (ref) store.remove(ref).catch(() => {});
        const c = e && e.code;
        st.err = c === 'quota_or_state' ? 'Photo storage is full. Delete some old photos and try again.'
          : c === 'rate_limited' ? 'Too many uploads at once. Wait a moment and try again.'
          : c === 'too_large' ? 'That photo is too large.'
          : 'Photo not saved: ' + ((e && (e.message || e.code)) || 'unknown error');
      }
      delete st.busy[pose];
      render();
    }

    async function deletePhoto(pose) {
      const date = st.edit, cur = Object.assign({}, st.docs[date] || {}), old = cur[pose];
      if (!old) return;
      delete cur[pose];
      st.err = '';
      try {
        if (POSES.some(([k]) => cur[k])) { await storage.put(COLL, date, cur); st.docs[date] = cur; }
        else { await storage.remove(COLL, date); delete st.docs[date]; }
        await store.remove(old);
      } catch (e) { st.err = 'Not deleted: ' + ((e && (e.message || e.code)) || 'unknown error'); }
      render();
    }

    // events (delegated, so they survive re-renders)
    function onClick(e) {
      const t = e.target.closest('[data-pp-pick],[data-pp-del],[data-pp-pose],[data-pp-mode],[data-pp-open],[data-pp-today],[data-pp-align],[data-pp-asave],[data-pp-areset],[data-pp-acancel],[data-pp-play],[data-pp-speed]');
      if (!t || !root.contains(t)) return;
      if (t.hasAttribute('data-pp-pick')) {
        const pose = t.getAttribute('data-pp-pick');
        if (st.busy[pose]) return;
        pickPose = pose; file.value = ''; file.click();
      } else if (t.hasAttribute('data-pp-del')) {
        const key = st.edit + ':' + t.getAttribute('data-pp-del');
        clearTimeout(armTimer);
        if (st.armed === key) { st.armed = null; deletePhoto(t.getAttribute('data-pp-del')); return; }
        st.armed = key; render();
        armTimer = setTimeout(() => { if (st.armed === key) { st.armed = null; render(); } }, 4000);
      } else if (t.hasAttribute('data-pp-align')) {
        const k = t.getAttribute('data-pp-align'), a = st.docs[st.edit] && st.docs[st.edit].align && st.docs[st.edit].align[k];
        st.align = k; st.draft = a ? { x: +a.x || 0, y: +a.y || 0, s: +a.s || 1 } : { x: 0, y: 0, s: 1 }; render();
        const el = root.querySelector('.pp-align'); if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
      else if (t.hasAttribute('data-pp-asave')) saveAlign();
      else if (t.hasAttribute('data-pp-areset')) { st.draft = { x: 0, y: 0, s: 1 }; setDraft('s', 1); }
      else if (t.hasAttribute('data-pp-acancel')) { st.align = null; st.draft = null; render(); }
      else if (t.hasAttribute('data-pp-play')) {
        if (st.tl.playing) stopTl(); else { st.tl.playing = true; startTl(); }
        t.textContent = st.tl.playing ? 'Pause' : 'Play'; t.setAttribute('aria-pressed', st.tl.playing);
      }
      else if (t.hasAttribute('data-pp-speed')) { st.tl.speed = t.getAttribute('data-pp-speed'); if (st.tl.playing) startTl(); root.querySelectorAll('[data-pp-speed]').forEach(b => b.setAttribute('aria-pressed', b === t)); }
      else if (t.hasAttribute('data-pp-pose')) { st.pose = t.getAttribute('data-pp-pose'); st.tl.i = -1; render(); }
      else if (t.hasAttribute('data-pp-mode')) { st.mode = t.getAttribute('data-pp-mode'); render(); }
      else if (t.hasAttribute('data-pp-open')) { st.edit = t.getAttribute('data-pp-open'); st.armed = null; st.align = null; render(); root.querySelector('.pp-slots').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
      else if (t.hasAttribute('data-pp-today')) { st.edit = today; st.armed = null; render(); }
    }
    function onChange(e) {
      const t = e.target;
      if (t === file) { const f = file.files && file.files[0]; if (f && pickPose) savePhoto(pickPose, f); return; }
      if (t.hasAttribute('data-pp-date')) { if (isDate(t.value) && t.value <= today) { st.edit = t.value; st.armed = null; st.align = null; render(); } }
      else if (t.hasAttribute('data-pp-waist')) saveWaist(t.value.trim());
      else if (t.hasAttribute('data-pp-before')) { st.before = t.value; const p = pair(); if (p) { st.before = p.before; st.after = p.after; } render(); }
      else if (t.hasAttribute('data-pp-after')) { st.after = t.value; const p = pair(); if (p) { st.before = p.before; st.after = p.after; } render(); }
    }
    function setX(v) {
      st.x = Math.max(0, Math.min(100, v));
      const s = root.querySelector('[data-pp-stage]'), r = root.querySelector('[data-pp-range]');
      if (s) s.style.setProperty('--x', st.x + '%');
      if (r && +r.value !== Math.round(st.x)) r.value = Math.round(st.x);
    }
    function onInput(e) {
      const t = e.target;
      if (t.hasAttribute('data-pp-range')) setX(+t.value);
      else if (t.hasAttribute('data-pp-a')) { const k = t.getAttribute('data-pp-a'); setDraft(k, k === 's' ? +t.value / 100 : +t.value); }
      else if (t.hasAttribute('data-pp-scrub')) { if (st.tl.playing) { stopTl(); const b = root.querySelector('[data-pp-play]'); if (b) { b.textContent = 'Play'; b.setAttribute('aria-pressed', 'false'); } } showFrame(+t.value); }
    }
    let drag = null;
    function xFrom(e, s) { const b = s.getBoundingClientRect(); return ((e.clientX - b.left) / b.width) * 100; }
    function onDown(e) {
      const a = e.target.closest('[data-pp-astage]');
      if (a) {
        const b = a.getBoundingClientRect(), d = st.draft || { x: 0, y: 0, s: 1 };
        drag = { align: true, s: a, id: e.pointerId, x0: e.clientX, y0: e.clientY, ax: d.x, ay: d.y, w: b.width, h: b.height };
        try { a.setPointerCapture(e.pointerId); } catch (_) {}
        e.preventDefault(); return;
      }
      const s = e.target.closest('[data-pp-stage]');
      if (!s) return;
      drag = { s, id: e.pointerId, x0: e.clientX, y0: e.clientY, live: e.pointerType === 'mouse' };
      if (drag.live) { setX(xFrom(e, s)); try { s.setPointerCapture(e.pointerId); } catch (_) {} }
    }
    function onMove(e) {
      if (!drag || e.pointerId !== drag.id) return;
      if (drag.align) {
        const d = st.draft || (st.draft = { x: 0, y: 0, s: 1 });
        // translate % is of the photo's own box, which is the frame; divide by scale so the photo follows the finger
        setDraft('x', drag.ax + ((e.clientX - drag.x0) / drag.w) * 100 / d.s);
        setDraft('y', drag.ay + ((e.clientY - drag.y0) / drag.h) * 100 / d.s);
        return;
      }
      if (!drag.live) {
        // touch: start sliding only once the finger moves sideways, so vertical page scrolling still works
        const dx = Math.abs(e.clientX - drag.x0), dy = Math.abs(e.clientY - drag.y0);
        if (dy > 10 && dy > dx) { drag = null; return; }
        if (dx < 6) return;
        drag.live = true; try { drag.s.setPointerCapture(e.pointerId); } catch (_) {}
      }
      setX(xFrom(e, drag.s));
    }
    function onUp(e) {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.align && !drag.live && e.type === 'pointerup') setX(xFrom(e, drag.s)); // a tap jumps the divider there
      drag = null;
    }

    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('input', onInput);
    root.addEventListener('pointerdown', onDown);
    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerup', onUp);
    root.addEventListener('pointercancel', onUp);

    root.innerHTML = '<section class="pp"><h2>Progress photos</h2><p class="pp-sub">Loading…</p></section>';
    load();

    return {
      refresh: load,
      destroy() {
        alive = false; clearTimeout(armTimer); clearInterval(tlTimer);
        root.removeEventListener('click', onClick); root.removeEventListener('change', onChange); root.removeEventListener('input', onInput);
        root.removeEventListener('pointerdown', onDown); root.removeEventListener('pointermove', onMove);
        root.removeEventListener('pointerup', onUp); root.removeEventListener('pointercancel', onUp);
        root.innerHTML = '';
      },
    };
  }

  const ProgressPhotos = { mount, css, prepare, sets, datesWith, defaultPair, nextDue, weightNear, srcOf, frames, xform, POSES: POSES.map(p => p[0]) };
  if (typeof module !== 'undefined' && module.exports) module.exports = ProgressPhotos;
  global.ProgressPhotos = ProgressPhotos;
})(typeof window !== 'undefined' ? window : globalThis);
