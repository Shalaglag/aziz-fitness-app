/* Food search card for the Add food sheet (FoodSearch). Owns its DOM inside a host element so typing never
 * fights the app's re-renders. Local sources answer as you type (bundled catalog, your products, restaurants,
 * recipes); USDA (through the Mizan service, no AI cost) and Open Food Facts run only when Search is pressed.
 * Picking a result opens a review step: amount (grams / ml / servings / the record's portions), live numbers,
 * the source line, a Details fold, slot and "Eaten now"; only Add writes a row.
 *
 *   FoodSearch.mount(host, {
 *     records: () => FoodLib records (local),            // catalog + library + restaurants + recipes
 *     usda: q => Promise<{records, error, cached}>,       // optional; FoodLib.usdaSearch wrapper
 *     off:  q => Promise<{records, error, cached}>,       // optional; FoodLib.offSearch wrapper
 *     details: rec => Promise<rec|null>,                  // optional; fetch portions for a USDA record on pick
 *     onAdd: row => void, slot: "Meal 1", slots: [...], eatenDefault: false,
 *     favourites: () => Set, toggleFavourite: id => void, recents: () => Map(id -> uses), bumpRecent: id => void,
 *     market: "KW", toast: msg => void })
 *   FoodSearch.CSS, FoodSearch.state() (tests), FoodSearch.reset()
 */
const FoodSearch = (() => {
  const FL = typeof FoodLib !== "undefined" ? FoodLib : (typeof require === "function" ? require("./food-library.js") : null);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const S = { q: "", local: [], remote: { usda: null, off: null }, busy: { usda: false, off: false }, pick: null, amountText: "", slot: null, eaten: null, details: false, err: {} };
  let host = null, O = null, timer = null;
  const fmt = (v, d = 0) => v == null ? "–" : (Math.round(v * Math.pow(10, d)) / Math.pow(10, d)).toString();

  function reset() { Object.assign(S, { q: "", local: [], remote: { usda: null, off: null }, busy: { usda: false, off: false }, pick: null, amountText: "", details: false, err: {} }); }
  function mount(el, opts) {
    if (!el || !FL) return;
    host = el; O = opts || {};
    if (S.slot == null) S.slot = O.slot || "Meal 1";
    if (S.eaten == null) S.eaten = !!O.eatenDefault;
    if (!host.dataset.flBound) { host.dataset.flBound = "1"; host.addEventListener("click", onClick); host.addEventListener("input", onInput); host.addEventListener("submit", onSubmit); host.addEventListener("change", onChange); }
    draw();
  }
  const ctx = () => ({ favourites: O.favourites ? O.favourites() : null, recents: O.recents ? O.recents() : null, market: O.market || null, limit: 25 });
  function runLocal() { S.local = S.q.trim().length >= 2 ? FL.search(S.q, O.records ? O.records() : [], ctx()) : []; }
  function onInput(e) {
    if (e.target.id === "flq") { S.q = e.target.value; clearTimeout(timer); timer = setTimeout(() => { runLocal(); S.remote = { usda: null, off: null }; S.err = {}; drawResults(); }, 120); }
    if (e.target.id === "flamt") { S.amountText = e.target.value; drawNumbers(); }
  }
  function onChange(e) { if (e.target.id === "flslot") S.slot = e.target.value; if (e.target.id === "fleaten") S.eaten = e.target.checked; }
  function onSubmit(e) { e.preventDefault(); if (e.target.id === "flform") remote("usda"); if (e.target.id === "flreview") add(); }
  async function remote(which) {
    const fn = O[which]; if (!fn || !S.q.trim()) return;
    S.busy[which] = true; S.err[which] = null; drawResults();
    const q = S.q;
    try { const r = await fn(q); if (S.q !== q) return; S.remote[which] = r.records || []; S.err[which] = r.error || null; }
    catch (err) { S.remote[which] = []; S.err[which] = "server_error"; }
    S.busy[which] = false; drawResults();
  }
  function allResults() {
    const seen = new Set(), out = [];
    for (const r of S.local.concat(S.remote.usda || [], S.remote.off || [])) { if (!r || seen.has(r.id)) continue; seen.add(r.id); out.push(r); }
    return out;
  }
  function onClick(e) {
    const b = e.target.closest("[data-fl]"); if (!b) return;
    const a = b.dataset.fl;
    if (a === "search") { remote("usda"); }
    else if (a === "off") { remote("off"); }
    else if (a === "pick") { pick(allResults().find(r => r.id === b.dataset.id)); }
    else if (a === "back") { S.pick = null; S.details = false; draw(); }
    else if (a === "portion") { S.amountText = b.dataset.amt; draw(); }
    else if (a === "details") { S.details = !S.details; draw(); }
    else if (a === "fav") { if (O.toggleFavourite) O.toggleFavourite(b.dataset.id); draw(); }
    else if (a === "add") { add(); }
    else if (a === "clear") { S.q = ""; runLocal(); S.remote = { usda: null, off: null }; draw(); const i = host.querySelector("#flq"); if (i) i.focus(); }
  }
  async function pick(rec) {
    if (!rec) return;
    S.pick = rec; S.details = false; S.amountText = amountLabel(FL.defaultAmount(rec), rec); draw();
    if (O.details && rec.source.kind === "usda" && !rec.portions.length) {
      try { const full = await O.details(rec); if (full && S.pick && S.pick.id === rec.id) { S.pick = full; if (!S.amountText || S.amountText === "100 g") S.amountText = amountLabel(FL.defaultAmount(full), full); draw(); } } catch (err) {}
    }
  }
  function amountLabel(a, rec) {
    if (!a) return ""; if (a.g != null) return a.g + " g"; if (a.ml != null) return a.ml + " ml"; if (a.servings != null) return a.servings + (a.servings === 1 ? " serving" : " servings");
    const p = rec.portions[typeof a.portion === "number" ? a.portion : 0]; return p ? (a.count || 1) + " " + p.label.replace(/^1\s+/, "") : "";
  }
  function scaled() { if (!S.pick) return null; const a = FL.parseAmount(S.amountText, S.pick); return a ? FL.scale(S.pick, a) : null; }
  function add() {
    const sc = scaled(); if (!S.pick || !sc) { if (O.toast) O.toast("Enter an amount the food can be measured in (" + unitsFor(S.pick) + ")."); return; }
    const row = FL.toRow(S.pick, sc, { slot: S.slot, eaten: S.eaten });
    if (O.onAdd) O.onAdd(row);
    if (O.bumpRecent) O.bumpRecent(S.pick.id);
    if (O.toast) O.toast("Added " + row.name + (row.eaten ? "" : ". Tick it when you eat it."));
    S.pick = null; S.details = false; draw();
  }
  function unitsFor(rec) { if (!rec) return "grams"; const u = []; if (rec.basis.kind === "serving") u.push("servings"); if (rec.basis.kind === "per100g" || (rec.basis.kind === "serving" && rec.basis.unit === "g")) u.push("grams"); if (rec.basis.kind === "per100ml" || (rec.basis.kind === "serving" && rec.basis.unit === "ml")) u.push("ml"); if (rec.portions.length) u.push(rec.portions.map(p => p.label).join(", ")); return u.join(", "); }

  // ---------- drawing ----------
  function draw() { if (!host) return; host.innerHTML = S.pick ? reviewHtml() : searchHtml(); }
  function drawResults() { const el = host && host.querySelector("#flres"); if (el) el.innerHTML = resultsHtml(); else draw(); }
  function drawNumbers() { const el = host && host.querySelector("#flnums"); if (el) el.innerHTML = numbersHtml(); }
  function searchHtml() {
    return `<form id="flform" class="fl-form" autocomplete="off"><div class="fl-row"><input type="search" id="flq" placeholder="Search foods: cooked rice, labneh, Big Mac…" value="${esc(S.q)}" aria-label="Search foods" enterkeyhint="search">
      ${S.q ? `<button type="button" class="fl-x" data-fl="clear" aria-label="Clear">✕</button>` : ""}</div>
      <div class="fl-src">${O.usda ? `<button type="submit" class="btn small" data-fl="search">Search USDA</button>` : ""}${O.off ? `<button type="button" class="btn ghost small" data-fl="off">Packaged (Open Food Facts)</button>` : ""}</div></form>
      <div id="flres">${resultsHtml()}</div>`;
  }
  function resultsHtml() {
    const q = S.q.trim();
    if (q.length < 2) return `<p class="muted fl-hint">Type a food. Your products, recipes and typical values answer at once; press Search USDA for the full USDA database or Packaged for Open Food Facts.</p>`;
    const list = allResults();
    let html = list.length ? `<ul class="fl-list">${list.map(rowHtml).join("")}</ul>` : "";
    const notes = [];
    if (S.busy.usda) notes.push("Searching USDA…"); if (S.busy.off) notes.push("Searching Open Food Facts…");
    if (S.remote.usda && !S.remote.usda.length && !S.err.usda) notes.push("USDA: nothing for “" + esc(q) + "”.");
    if (S.remote.off && !S.remote.off.length && !S.err.off) notes.push("Open Food Facts: nothing for “" + esc(q) + "”.");
    if (S.err.usda) notes.push("USDA: " + errText(S.err.usda)); if (S.err.off) notes.push("Open Food Facts: " + errText(S.err.off));
    if (!list.length && !notes.length) notes.push("Nothing here yet. " + (O.usda ? "Press Search USDA, or " : "") + "add it by hand on the Add tab.");
    if (S.remote.usda && S.remote.usda.length) notes.push("USDA FoodData Central is the source of the USDA rows.");
    return html + (notes.length ? `<p class="muted fl-hint">${notes.join(" ")}</p>` : "");
  }
  function errText(c) { return { offline: "no connection, showing what was saved before (if anything).", no_endpoint: "the Mizan service address is not set (Ask Claude → AI settings).", not_signed_in: "sign in to Mizan to search.", not_allowed: "this account is not allowed to use the service.", rate_limited: "too many searches right now, try again in a minute.", server_error: "the search service had a problem.", upstream_unavailable: "USDA did not answer.", upstream_error: "USDA did not answer.", timeout: "USDA took too long." }[c] || "could not search (" + esc(c) + ")."; }
  function rowHtml(rec) {
    const sc = FL.scale(rec, FL.defaultAmount(rec)) || { nutrients: rec.nutrients, amountText: rec.basis.label };
    const n = sc.nutrients, fav = O.favourites && O.favourites().has(rec.id);
    return `<li><button type="button" class="fl-item" data-fl="pick" data-id="${esc(rec.id)}">
      <span class="fl-nm">${esc(rec.name)}${rec.brand && !rec.name.toLowerCase().includes(rec.brand.toLowerCase()) ? ` <small>${esc(rec.brand)}</small>` : ""}${fav ? ` <i class="fl-star" aria-label="Favourite">★</i>` : ""}
        <small class="fl-sl">${esc(FL.gradeLabel(rec))} · ${esc(sc.amountText)}${rec.prep && !/as-/.test(rec.prep) ? " · " + esc(rec.prep) : ""}</small></span>
      <span class="fl-kc"><b>${fmt(n.kcal)}</b><small>P ${fmt(n.p)} · C ${fmt(n.c)} · F ${fmt(n.f)}</small></span></button></li>`;
  }
  function reviewHtml() {
    const r = S.pick, fav = O.favourites && O.favourites().has(r.id);
    const chips = [];
    for (const p of r.portions) chips.push({ label: p.label, amt: "1 " + p.label.replace(/^1\s+/, "") });
    if (r.basis.kind === "serving") { chips.push({ label: "1 serving", amt: "1 serving" }); chips.push({ label: "½ serving", amt: "0.5 serving" }); if (r.basis.unit === "g") chips.push({ label: "100 g", amt: "100 g" }); }
    else if (r.basis.kind === "per100ml") { chips.push({ label: "100 ml", amt: "100 ml" }); chips.push({ label: "250 ml", amt: "250 ml" }); }
    else { chips.push({ label: "100 g", amt: "100 g" }); chips.push({ label: "150 g", amt: "150 g" }); chips.push({ label: "200 g", amt: "200 g" }); }
    const seen = new Set(); const uniq = chips.filter(c => !seen.has(c.amt) && seen.add(c.amt)).slice(0, 7);
    const slots = O.slots || ["Meal 1", "Meal 2", "Snack", "Breakfast", "Extra"];
    return `<form id="flreview" class="fl-review" autocomplete="off">
      <div class="fl-head"><button type="button" class="btn ghost small" data-fl="back">‹ Results</button><button type="button" class="fl-favbtn ${fav ? "on" : ""}" data-fl="fav" data-id="${esc(r.id)}" aria-pressed="${!!fav}" aria-label="Favourite">${fav ? "★" : "☆"}</button></div>
      <h3 class="fl-title">${esc(r.name)}${r.brand ? ` <small>${esc(r.brand)}</small>` : ""}</h3>
      <p class="fl-source">${esc(FL.sourceLine(r))}${r.portionEst ? " · portion estimated" : ""}</p>
      <label class="field"><span class="label">Amount</span><input type="text" id="flamt" inputmode="decimal" value="${esc(S.amountText)}" placeholder="${esc(unitsFor(r))}" aria-label="Amount"></label>
      <div class="fl-chips">${uniq.map(c => `<button type="button" class="chip ${c.amt === S.amountText ? "on" : ""}" data-fl="portion" data-amt="${esc(c.amt)}">${esc(c.label)}</button>`).join("")}</div>
      <div id="flnums">${numbersHtml()}</div>
      ${r.includes && r.includes.length ? `<p class="muted fl-hint">Includes: ${esc(r.includes.join(", "))}</p>` : ""}
      <button type="button" class="fl-detbtn" data-fl="details" aria-expanded="${S.details}">${S.details ? "Hide details" : "Details"}</button>
      ${S.details ? `<ul class="fl-details">${FL.sourceDetails(r).map(l => `<li>${/^https?:/.test(l) ? `<a href="${esc(l)}" target="_blank" rel="noopener">${esc(l.replace(/^https?:\/\//, ""))}</a>` : esc(l)}</li>`).join("")}<li>Per ${esc(r.basis.label)}: ${fmt(r.nutrients.kcal)} kcal · P ${fmt(r.nutrients.p, 1)} · C ${fmt(r.nutrients.c, 1)} · F ${fmt(r.nutrients.f, 1)}${r.nutrients.fiber != null ? " · fibre " + fmt(r.nutrients.fiber, 1) : ""}</li></ul>` : ""}
      <div class="fl-acts"><select id="flslot" aria-label="Meal">${slots.map(s => `<option ${s === S.slot ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>
        <label class="fl-eaten"><input type="checkbox" id="fleaten" ${S.eaten ? "checked" : ""}> Eaten now</label>
        <button type="submit" class="btn" data-fl="add">Add</button></div></form>`;
  }
  function numbersHtml() {
    const sc = scaled();
    if (!sc) return `<p class="fl-nums fl-bad">Use ${esc(unitsFor(S.pick))}.</p>`;
    const n = sc.nutrients, u = k => sc.unknown.includes(k) ? ' class="unk" title="not given by the source"' : "";
    return `<div class="fl-nums"><div><b>${fmt(n.kcal)}</b><small>kcal</small></div><div${u("p")}><b>${fmt(n.p, 1)}</b><small>protein</small></div><div${u("c")}><b>${fmt(n.c, 1)}</b><small>carbs</small></div><div${u("f")}><b>${fmt(n.f, 1)}</b><small>fat</small></div></div>
      <p class="muted fl-hint">${esc(sc.amountText)}${sc.unknown.length ? " · " + sc.unknown.map(k => ({ p: "protein", c: "carbs", f: "fat", kcal: "calories" }[k])).join(", ") + " unknown, logged as 0 and marked estimate" : ""}${S.pick.grade === "estimate" ? " · typical values, logged as an estimate" : ""}</p>`;
  }
  const CSS = `
.fl-form{display:flex;flex-direction:column;gap:8px}.fl-row{position:relative}.fl-row input{width:100%;box-sizing:border-box;padding:12px 40px 12px 14px;border-radius:12px;border:1px solid var(--line);background:var(--surface);font-size:1rem;color:var(--fg)}
.fl-x{position:absolute;right:6px;top:50%;transform:translateY(-50%);border:0;background:transparent;color:var(--fg-muted);font-size:1rem;padding:8px}
.fl-src{display:flex;gap:8px;flex-wrap:wrap}.fl-hint{font-size:.82rem;margin:6px 0 0}
.fl-list{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:6px}
.fl-item{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;width:100%;text-align:left;padding:10px 12px;border-radius:12px;border:1px solid var(--card-line,var(--line));background:var(--surface);box-shadow:var(--shadow-card);color:var(--fg);font:inherit;cursor:pointer}
.fl-nm{display:flex;flex-direction:column;min-width:0}.fl-nm>small{color:var(--fg-muted);font-size:.78rem}.fl-nm .fl-sl{color:var(--fg-muted);font-size:.74rem;margin-top:2px}
.fl-star{color:var(--warn);font-style:normal;font-size:.8rem}
.fl-kc{text-align:right;line-height:1.1}.fl-kc b{font-size:1.05rem}.fl-kc small{display:block;color:var(--fg-muted);font-size:.7rem;margin-top:3px;white-space:nowrap}
.fl-review{display:flex;flex-direction:column;gap:10px}.fl-head{display:flex;justify-content:space-between;align-items:center}
.fl-favbtn{border:1px solid var(--line);background:var(--surface);border-radius:50%;width:38px;height:38px;font-size:1.2rem;color:var(--fg-muted)}.fl-favbtn.on{color:var(--warn);border-color:var(--warn)}
.fl-title{margin:0;font-size:1.15rem}.fl-title small{color:var(--fg-muted);font-weight:500;font-size:.85rem}
.fl-source{margin:0;color:var(--fg-muted);font-size:.82rem}
.fl-chips{display:flex;gap:6px;flex-wrap:wrap}.fl-chips .chip.on{background:var(--accent);color:var(--on-accent);border-color:var(--accent)}
.fl-nums{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;text-align:center}.fl-nums div{background:var(--surface-2,var(--sunk));border-radius:10px;padding:8px 4px}.fl-nums b{display:block;font-size:1.1rem}.fl-nums small{color:var(--fg-muted);font-size:.7rem}.fl-nums .unk b{color:var(--fg-faint)}.fl-nums.fl-bad{color:var(--bad);font-size:.85rem}
.fl-detbtn{align-self:flex-start;border:0;background:transparent;color:var(--accent);font:inherit;font-size:.85rem;padding:0;text-decoration:underline}
.fl-details{margin:0;padding-left:18px;font-size:.8rem;color:var(--fg-muted);word-break:break-word}.fl-details a{color:var(--accent)}
.fl-acts{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:8px;align-items:center}.fl-acts select{min-width:0;padding:10px;border-radius:10px;border:1px solid var(--line);background:var(--surface);color:var(--fg)}
.fl-eaten{display:flex;align-items:center;gap:6px;font-size:.85rem;white-space:nowrap}
`;
  return { mount, reset, CSS, state: () => S, _allResults: allResults };
})();
if (typeof module !== "undefined" && module.exports) module.exports = FoodSearch;
