/* Nutrition label scanner for the Aziz Cut Tracker (Food tab card "Scan a nutrition label").
 * Photograph the nutrition facts panel of a product; Claude (page `sample` capability, images) copies the
 * numbers; every field stays editable; "Save" stores it as a custom food in the shared `barcodes` library
 * (the same one the barcode scanner reads, so a later barcode scan of the product is instant) and, when the
 * product is one of the labels the plan still owes (Gatorade, ISO100, milk, eggs), fills that in too.
 * Plain JS, no imports, no network of its own.
 * API:
 *   LabelScan.prompt()                                  -> instruction sent to Claude
 *   LabelScan.parse(value)                              -> draft {name,brand,barcode,basis,per100,serving,derived,missing,check,owed,note}
 *   LabelScan.matchOwed(text)                           -> owed key ("gatorade"|"iso"|"milk"|"eggs") or ""
 *   LabelScan.toProduct(draft, {now})                   -> library record {code,name,brand,quantity,basis,per100,serving,missing,derived,source:"label",labelAt}
 *   LabelScan.toFoodItem(product, {amount,slot,eaten})  -> days/{date}.food row (same shape as BarcodeFood's)
 *   LabelScan.owedUpdate(prefs, key, product, {drinkLabel,now}) -> new prefs/main (labels[key], open[key], drinks via hook)
 *   LabelScan.fixedOverride(fixed, labels)              -> the FIXED quick-add item with the saved label applied
 *   LabelScan.foods(library)                            -> custom foods (source label/manual), newest first
 *   LabelScan.mount(el, opts) / destroy()               -> the card. opts = { getSample, library:{get,put,all}, prefs, savePrefs,
 *                                                          drinkLabel, onAdd, toast, slot }
 *   LabelScan.CSS                                       -> styles, inject once
 * Nothing is written until Aziz presses Save or Add.
 */
const LabelScan = (() => {
  const OWED = [
    { key: "gatorade", name: "Gatorade", re: /gatorade/i, fixed: true, basis: "ml", per: 1000, open: true },
    { key: "iso", name: "ISO100", re: /iso\s*-?\s*100|isopure/i, fixed: true, basis: "g", per: null },
    { key: "milk", name: "Milk", re: /\bmilk\b|\bhaleeb\b|\blaban\b|حليب/i, fixed: false, basis: "ml", per: 250 },
    { key: "eggs", name: "Eggs", re: /\beggs?\b|بيض/i, fixed: false, basis: "g", per: null },
  ];
  const SLOTS = ["Extra", "Snack", "Meal 1", "Meal 2", "Breakfast", "Drink"];
  const MACROS = ["kcal", "p", "c", "f"];
  const r1 = n => Math.round(n * 10) / 10;
  const num = v => { if (v == null || v === "") return null; const n = typeof v === "string" ? parseFloat(v.replace(",", ".")) : +v; return isFinite(n) && n >= 0 ? n : null; };
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clean = s => String(s ?? "").replace(/\s+/g, " ").trim();
  const slug = s => clean(s).toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "food";
  const clone = o => JSON.parse(JSON.stringify(o == null ? {} : o));
  const unit = b => (b === "ml" ? "ml" : "g");

  function prompt() {
    return [
      "Read the nutrition facts label in the attached photo and copy its numbers exactly. Do not estimate: a value you cannot read is null.",
      "Context: the product is sold in Kuwait, so the label may be in English and Arabic and may give values per 100 g, per 100 ml, per serving, or both. Energy may be in kJ and kcal; use kcal (if only kJ is shown, divide by 4.184).",
      "Rules:",
      "- per100 = the values per 100 g or 100 ml (basis \"g\" or \"ml\"; drinks are \"ml\"). serving = the values per one serving when the label shows a serving size (amount in g or ml, label like \"1 scoop (32 g)\" or \"1 bottle (500 ml)\"). Fill both only when the label shows both.",
      "- protein, carbs (total carbohydrate) and fat (total fat) in grams, no units, no ranges.",
      "- name: the product name from the front of the pack if visible, else from the label. brand: the maker. barcode: the digits under the barcode only if clearly readable, else \"\".",
      "- If the photo shows no nutrition label, set readable to false and say why in note.",
      "Reply with only JSON in this shape:",
      '{"name":"Low fat milk","brand":"KDD","barcode":"","basis":"ml","per100":{"kcal":47,"p":3.4,"c":4.9,"f":1.5},"serving":{"amount":250,"label":"1 glass (250 ml)","kcal":118,"p":8.5,"c":12.3,"f":3.8},"readable":true,"note":""}',
    ].join("\n");
  }

  function matchOwed(text) { const t = String(text || ""); const o = OWED.find(x => x.re.test(t)); return o ? o.key : ""; }
  const owedInfo = key => OWED.find(x => x.key === key) || null;

  function parse(value) {
    let v = value;
    if (typeof v === "string") { try { v = JSON.parse(v); } catch (e) { v = null; } }
    if (!v || typeof v !== "object") return { name: "", readable: false, missing: MACROS.slice(), per100: null, serving: null, note: "Claude's answer couldn't be read. Try again." };
    const name = clean(v.name).slice(0, 60), brand = clean(v.brand).slice(0, 40);
    const basis = String(v.basis || "").toLowerCase() === "ml" ? "ml" : "g";
    const bc = String(v.barcode || "").replace(/\D/g, "");
    const barcode = bc.length >= 8 && bc.length <= 14 ? bc : "";
    const pick = o => { o = o && typeof o === "object" ? o : {}; return { kcal: num(o.kcal ?? o.calories), p: num(o.p ?? o.protein), c: num(o.c ?? o.carbs), f: num(o.f ?? o.fat) }; };
    const kj = num(v.per100 && v.per100.kj);
    let per100 = pick(v.per100);
    if (per100.kcal == null && kj) per100.kcal = kj / 4.184;
    const sv = pick(v.serving);
    const amount = num(v.serving && (v.serving.amount ?? v.serving.g ?? v.serving.ml));
    const has = o => MACROS.some(k => o[k] != null);
    let derived = false;
    if (!has(per100) && amount > 0 && has(sv)) { per100 = {}; MACROS.forEach(k => per100[k] = sv[k] == null ? null : sv[k] / amount * 100); derived = true; }
    if (per100.kcal == null && (per100.p != null || per100.c != null || per100.f != null)) { per100.kcal = 4 * (per100.p || 0) + 4 * (per100.c || 0) + 9 * (per100.f || 0); derived = true; }
    MACROS.forEach(k => { if (per100[k] != null) per100[k] = k === "kcal" ? Math.round(Math.min(per100[k], 1000)) : r1(Math.min(per100[k], 100)); });
    const missing = MACROS.filter(k => per100[k] == null);
    const serving = amount > 0 ? { amount: r1(amount), label: clean(v.serving && v.serving.label).slice(0, 40) } : null;
    const fromMacros = 4 * (per100.p || 0) + 4 * (per100.c || 0) + 9 * (per100.f || 0);
    const check = per100.kcal > 0 && fromMacros > 0 && Math.abs(fromMacros - per100.kcal) / per100.kcal > 0.15;
    const readable = v.readable !== false && missing.length < MACROS.length;
    return { name, brand, barcode, basis, per100, serving, derived, missing, check, readable, owed: matchOwed(name + " " + brand), note: clean(v.note).slice(0, 200) };
  }

  function toProduct(draft, { now } = {}) {
    const name = clean(draft.name).slice(0, 60) || "Food";
    const per100 = {}; MACROS.forEach(k => { const n = num(draft.per100 && draft.per100[k]); per100[k] = n == null ? 0 : (k === "kcal" ? Math.round(n) : r1(n)); });
    const missing = MACROS.filter(k => num(draft.per100 && draft.per100[k]) == null);
    const amt = num(draft.serving && draft.serving.amount);
    const basis = unit(draft.basis);
    const serving = amt > 0 ? { g: r1(amt), label: clean(draft.serving.label) || ("1 serving (" + r1(amt) + " " + basis + ")") } : null;
    const bc = String(draft.barcode || "").replace(/\D/g, "");
    const code = bc.length >= 8 && bc.length <= 14 ? bc : "lbl-" + slug((draft.brand ? draft.brand + " " : "") + name);
    return { code, name, brand: clean(draft.brand).slice(0, 40), quantity: "", basis, per100, serving, missing, derived: !!draft.derived, source: "label",
      labelAt: (now ? new Date(now) : new Date()).toISOString() };
  }

  function toFoodItem(product, opts = {}) {
    const basis = unit(product.basis);
    const amount = num(opts.amount) || (product.serving && product.serving.g) || 100;
    const k = amount / 100, m = product.per100 || {};
    const label = [product.brand && !String(product.name).toLowerCase().includes(String(product.brand).toLowerCase()) ? product.brand : "", product.name].filter(Boolean).join(" ");
    return {
      name: `${label} (${r1(amount)} ${basis})`, slot: opts.slot || "Extra",
      kcal: Math.round((m.kcal || 0) * k), p: r1((m.p || 0) * k), c: r1((m.c || 0) * k), f: r1((m.f || 0) * k),
      eaten: !!opts.eaten, est: !!(product.missing && product.missing.length) || !!product.derived,
      barcode: product.code, grams: r1(amount),
    };
  }

  // Per-serving numbers for a FIXED quick-add item: Gatorade per bottle (label quantity or 1 L), ISO100 per scoop.
  function labelFor(key, product) {
    const o = owedInfo(key); if (!o) return null;
    const per = (product.serving && product.serving.g) || o.per || 100;
    const it = toFoodItem(product, { amount: per });
    return { name: product.name, brand: product.brand, code: product.code, per, basis: unit(product.basis), kcal: it.kcal, p: it.p, c: it.c, f: it.f, est: it.est };
  }

  function owedUpdate(prefs, key, product, { drinkLabel, now } = {}) {
    const o = owedInfo(key); if (!o) return prefs;
    let out = clone(prefs);
    const lab = labelFor(key, product);
    out.labels = Object.assign({}, out.labels, { [key]: Object.assign(lab, { at: (now ? new Date(now) : new Date()).toISOString() }) });
    if (o.open) out.open = Object.assign({}, out.open, { [key]: true });
    if (key === "gatorade" && typeof drinkLabel === "function") {
      const r = drinkLabel(out, "gatorade", { ml: lab.per, kcal: lab.kcal, p: lab.p, c: lab.c, f: lab.f });
      if (r && !r.error) out = r;
    }
    return out;
  }

  function fixedOverride(fixed, labels) {
    const l = fixed && labels && labels[fixed.key];
    if (!l || !(owedInfo(fixed.key) || {}).fixed || l.kcal == null) return fixed;
    return Object.assign({}, fixed, { kcal: l.kcal, p: l.p, c: l.c, f: l.f, est: !!l.est });
  }

  function foods(library) {
    return Object.values(library || {}).filter(p => p && p.per100 && (p.source === "label" || p.source === "manual"))
      .sort((a, b) => String(b.labelAt || "").localeCompare(String(a.labelAt || "")) || String(a.name).localeCompare(String(b.name)));
  }

  /* ---------- card ---------- */
  const S = { phase: "idle", image: null, imageUrl: "", busy: false, ctl: null, draft: null, error: "", canImage: null, hidden: false, slot: "", amount: "", showAll: false };
  let O = null, EL = null, bound = null;

  async function shrink(file, max = 1600) {
    try {
      if (typeof createImageBitmap !== "function") return file;
      const bmp = await createImageBitmap(file);
      const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
      if (k === 1 && file.size < 1.5e6) return file;
      const cv = document.createElement("canvas");
      cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
      cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
      return await new Promise(res => cv.toBlob(b => res(b || file), "image/jpeg", 0.85));
    } catch (e) { return file; }
  }
  function clearImage() { if (S.imageUrl) try { URL.revokeObjectURL(S.imageUrl); } catch (e) {} S.image = null; S.imageUrl = ""; }
  function errorText(code) {
    switch (code) {
      case "not_granted": return "Claude access wasn't granted, so labels can't be read here. The manual form still works.";
      case "images_unavailable": return "Photos aren't available in this app right now.";
      case "rate_limited": return "Too many requests. Wait a minute and try again.";
      case "image_too_large": return "That photo is too big. Take a closer one of just the label.";
      case "unavailable": case "timeout": return "Claude isn't reachable right now. Try again in a moment.";
      default: return "Something went wrong reading the label. Try again.";
    }
  }

  function emptyDraft() { return { name: "", brand: "", barcode: "", basis: "g", per100: { kcal: null, p: null, c: null, f: null }, serving: null, derived: false, missing: [], check: false, readable: true, owed: "", note: "" }; }

  async function read() {
    if (S.busy || !S.image) return;
    const sample = O.getSample ? await O.getSample() : null;
    if (!sample) { S.hidden = true; view(); return; }
    S.busy = true; S.error = ""; S.ctl = new AbortController(); view();
    try {
      const v = await sample.json(prompt(), { signal: S.ctl.signal, modelTier: "default", images: [S.image] });
      const d = parse(v);
      if (!d.readable) { S.error = d.note || "No nutrition label found. Take a closer, straight-on photo of the nutrition facts panel."; S.draft = Object.assign(emptyDraft(), d, { readable: true }); }
      else S.draft = d;
      S.phase = "review";
    } catch (e) {
      const code = e && e.code;
      if (code !== "cancelled") {
        S.error = errorText(code);
        if (["not_granted", "sampling_disabled", "not_declared", "capability_disabled", "capability_removed"].includes(code)) S.hidden = true;
      }
    }
    S.busy = false; S.ctl = null; view();
  }

  function readForm() {
    const q = k => EL.querySelector(`[data-ls="f-${k}"]`), val = k => { const e = q(k); return e ? e.value : ""; };
    const d = S.draft || emptyDraft();
    d.name = val("name"); d.brand = val("brand"); d.barcode = val("barcode"); d.basis = val("basis") === "ml" ? "ml" : "g";
    d.per100 = { kcal: num(val("kcal")), p: num(val("p")), c: num(val("c")), f: num(val("f")) };
    const amt = num(val("samount")); d.serving = amt > 0 ? { amount: amt, label: val("slabel") } : null;
    d.owed = val("owed");
    d.missing = MACROS.filter(k => d.per100[k] == null);
    return d;
  }

  function save(addToo) {
    const d = readForm();
    if (!clean(d.name)) { S.error = "Give the food a name."; view(); return; }
    if (d.per100.kcal == null && d.per100.p == null) { S.error = "Enter at least kcal or protein per 100 " + unit(d.basis) + "."; view(); return; }
    const product = toProduct(d);
    try { O.library.put(product.code, product); } catch (e) { S.error = "Couldn't save: " + (e.message || e); view(); return; }
    if (d.owed && O.prefs && O.savePrefs) {
      try { O.savePrefs(owedUpdate(O.prefs() || {}, d.owed, product, { drinkLabel: O.drinkLabel })); } catch (e) {}
    }
    const o = owedInfo(d.owed);
    if (addToo && O.onAdd) O.onAdd(toFoodItem(product, { slot: S.slot || O.slot || "Extra" }));
    if (O.toast) O.toast((addToo ? "Added and saved " : "Saved ") + product.name + (o ? ". " + o.name + " label filled in." : "."));
    S.draft = null; S.error = ""; S.phase = "idle"; clearImage(); view();
  }

  function view() {
    if (!EL) return;
    if (S.hidden && !foods(O.library.all ? O.library.all() : {}).length) { EL.innerHTML = ""; return; }
    const list = foods(O.library.all ? O.library.all() : {});
    const shown = S.showAll ? list : list.slice(0, 6);
    const lib = list.length ? `<div class="ls-list"><span class="label">Your foods from labels</span>${shown.map(p => {
      const per = (p.serving && p.serving.g) || 100, it = toFoodItem(p, { amount: per });
      return `<div class="ls-item"><div class="nm"><b>${esc(p.name)}</b><small>${esc(p.serving ? p.serving.label : "100 " + unit(p.basis))} · ${it.kcal} kcal · P ${it.p}${it.est ? " · estimate" : ""}</small></div><button class="chip" data-ls="add" data-code="${esc(p.code)}">+ Add</button></div>`;
    }).join("")}${list.length > 6 ? `<button class="chip" data-ls="more">${S.showAll ? "Show fewer" : "Show all " + list.length}</button>` : ""}</div>` : "";
    let body = "";
    if (S.hidden) body = `<p class="muted ls-small">Claude isn't available here, so new labels can be typed in below.</p><button class="btn small" data-ls="manual">Type a label by hand</button>`;
    else if (S.phase === "idle") body = `<div class="row ls-row">
        <label class="btn small ls-file">${S.canImage === false ? "Photo unavailable" : "Photograph the label"}<input type="file" accept="image/*" capture="environment" data-ls="file" hidden ${S.canImage === false ? "disabled" : ""}></label>
        <button class="chip" data-ls="manual">Type it in</button>
        <span class="muted ls-small">Nutrition facts panel, straight on, in good light.</span></div>`;
    else if (S.phase === "photo") body = `<div class="ls-prev"><img src="${esc(S.imageUrl)}" alt="label photo"><div class="row ls-row">
        ${S.busy ? `<span class="muted ls-small">Reading the label…</span><button class="chip" data-ls="stop">Stop</button>` : `<button class="btn small" data-ls="go">Read with Claude</button><button class="chip" data-ls="retake">Retake</button>`}</div></div>`;
    else if (S.phase === "review") {
      const d = S.draft || emptyDraft();
      const f = (k, label, v, extra = "") => `<label class="ls-small">${label}<input ${extra} data-ls="f-${k}" value="${esc(v ?? "")}"></label>`;
      const n = (k, label) => f(k, label, d.per100[k], 'type="number" inputmode="decimal" min="0" step="any" style="width:5.5em"');
      const owedOpts = `<option value="">No</option>` + OWED.map(o => `<option value="${o.key}" ${d.owed === o.key ? "selected" : ""}>${o.name}</option>`).join("");
      body = `<div class="ls-form">
        ${S.imageUrl ? `<img class="ls-thumb" src="${esc(S.imageUrl)}" alt="">` : ""}
        <div class="row ls-row">${f("name", "Product", d.name, 'style="width:12em"')}${f("brand", "Brand", d.brand, 'style="width:8em"')}</div>
        <div class="row ls-row"><label class="ls-small">Per 100<select data-ls="f-basis"><option value="g" ${d.basis !== "ml" ? "selected" : ""}>g</option><option value="ml" ${d.basis === "ml" ? "selected" : ""}>ml</option></select></label>
          ${n("kcal", "kcal")}${n("p", "protein g")}${n("c", "carbs g")}${n("f", "fat g")}</div>
        <div class="row ls-row">${f("samount", "Serving (" + unit(d.basis) + ")", d.serving ? d.serving.amount : "", 'type="number" inputmode="decimal" min="0" step="any" style="width:5.5em"')}${f("slabel", "Serving name", d.serving ? d.serving.label : "", 'style="width:10em" placeholder="1 scoop (32 g)"')}${f("barcode", "Barcode", d.barcode, 'inputmode="numeric" style="width:9em" placeholder="optional"')}</div>
        <div class="row ls-row"><label class="ls-small">Is this a label the plan still needs?<select data-ls="f-owed">${owedOpts}</select></label>
          <label class="ls-small">Add as<select data-ls="slot">${SLOTS.map(s => `<option ${S.slot === s ? "selected" : ""}>${s}</option>`).join("")}</select></label></div>
        ${d.missing.length && d.missing.length < 4 ? `<p class="muted ls-small">Couldn't read: ${d.missing.map(k => k === "p" ? "protein" : k === "c" ? "carbs" : k === "f" ? "fat" : k).join(", ")}. Fill them from the pack or leave blank (the food is then flagged as an estimate).</p>` : ""}
        ${d.check ? `<p class="ls-small" style="color:var(--bad)">kcal doesn't match 4P + 4C + 9F. Check the numbers against the label.</p>` : ""}
        ${d.derived ? `<p class="muted ls-small">Per-100 values were worked out from the serving column.</p>` : ""}
        ${d.note ? `<p class="muted ls-small">${esc(d.note)}</p>` : ""}
        <div class="row ls-row"><button class="btn small" data-ls="save">Save food</button><button class="btn small" data-ls="saveadd">Save + add one serving</button><button class="chip" data-ls="cancel">Cancel</button></div>
      </div>`;
    }
    EL.innerHTML = `<div class="card ls"><div class="spread"><h3>Scan a nutrition label</h3><span class="muted ls-small">Local products the barcode lookup misses</span></div>
      <p class="muted ls-small">Claude copies the numbers from the photo, you check them, and the food is saved for next time. Gatorade, ISO100, milk and egg labels fill in the plan's open items.</p>
      ${S.error ? `<p class="ls-small" style="color:var(--bad)">${esc(S.error)}</p>` : ""}${body}${lib}</div>`;
  }

  function onClick(e) {
    const b = e.target.closest("[data-ls]"); if (!b || !EL.contains(b)) return;
    const a = b.dataset.ls;
    if (a === "go") read();
    else if (a === "stop" && S.ctl) S.ctl.abort();
    else if (a === "retake" || a === "cancel") { S.phase = "idle"; S.draft = null; S.error = ""; clearImage(); view(); }
    else if (a === "manual") { S.draft = emptyDraft(); S.phase = "review"; S.error = ""; view(); }
    else if (a === "save") save(false);
    else if (a === "saveadd") save(true);
    else if (a === "more") { S.showAll = !S.showAll; view(); }
    else if (a === "add") { const p = O.library.get(b.dataset.code); if (p && O.onAdd) { O.onAdd(toFoodItem(p, { slot: O.slot || "Extra" })); if (O.toast) O.toast("Added " + p.name); } }
  }
  async function onChange(e) {
    const t = e.target; if (!EL.contains(t)) return;
    if (t.dataset.ls === "file" && t.files && t.files[0]) {
      clearImage(); S.image = await shrink(t.files[0]); S.imageUrl = URL.createObjectURL(S.image); S.phase = "photo"; S.error = ""; view();
    } else if (t.dataset.ls === "slot") S.slot = t.value;
    else if (t.dataset.ls === "f-name" || t.dataset.ls === "f-brand") { const d = S.draft; if (d) { const sel = EL.querySelector('[data-ls="f-owed"]'); const k = matchOwed(EL.querySelector('[data-ls="f-name"]').value + " " + EL.querySelector('[data-ls="f-brand"]').value); if (sel && k && !sel.value) sel.value = k; } }
  }

  function mount(el, opts = {}) {
    destroy();
    EL = el; O = Object.assign({ library: lsLibrary() }, opts);
    bound = { click: onClick, change: onChange };
    el.addEventListener("click", bound.click); el.addEventListener("change", bound.change);
    if (S.canImage == null && O.getSample) {
      O.getSample().then(async s => {
        if (!s) { S.hidden = true; view(); return; }
        const lim = await s.limits().catch(() => null);
        S.canImage = !!(lim && lim.images); view();
      }).catch(() => { S.hidden = true; view(); });
    }
    view();
    return { refresh: view, destroy };
  }
  function destroy() { if (EL && bound) { EL.removeEventListener("click", bound.click); EL.removeEventListener("change", bound.change); } EL = null; bound = null; }
  function lsLibrary() {
    const KEY = "labelScan.library";
    const all = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { return {}; } };
    return { all, get: c => all()[c] || null, put: (c, p) => { const o = all(); o[c] = p; localStorage.setItem(KEY, JSON.stringify(o)); } };
  }

  const CSS = `.ls .ls-small{font-size:.85rem}.ls .ls-row{flex-wrap:wrap;gap:8px;align-items:flex-end}.ls .ls-file{cursor:pointer}
.ls .ls-form{display:flex;flex-direction:column;gap:8px}.ls .ls-form label{display:flex;flex-direction:column;gap:2px;color:var(--muted)}
.ls .ls-form input,.ls .ls-form select{font:inherit;padding:6px 8px;border:1px solid var(--line,#ccc);border-radius:8px;background:var(--card,transparent);color:inherit}
.ls .ls-prev img{max-width:100%;max-height:220px;border-radius:10px;display:block;margin-bottom:8px}.ls .ls-thumb{max-height:90px;border-radius:8px}
.ls .ls-list{display:flex;flex-direction:column;gap:6px;margin-top:10px}.ls .ls-item{display:flex;justify-content:space-between;align-items:center;gap:8px}
.ls .ls-item .nm{display:flex;flex-direction:column}.ls .ls-item small{color:var(--muted);font-size:.8rem}`;

  return { OWED, prompt, parse, matchOwed, toProduct, toFoodItem, owedUpdate, fixedOverride, labelFor, foods, errorText, mount, destroy, CSS };
})();
if (typeof module !== "undefined") module.exports = LabelScan;
