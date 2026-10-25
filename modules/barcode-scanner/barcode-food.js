/* BarcodeFood: scan a packaged food's barcode, look it up on Open Food Facts and turn it
 * into a food row for days/{date}.food[]. Plain JS, no imports. The only network call is
 * lookup(), and it goes through an injectable fetch so the app decides whether it may run.
 *
 *   BarcodeFood.clean(text)                    -> digits only ("6 281007 03" -> "628100703")
 *   BarcodeFood.isValid(code)                  -> true for an EAN-8 / UPC-A / EAN-13 / GTIN-14 with a good check digit
 *   BarcodeFood.lookup(code, {fetch, timeoutMs}) -> Promise<{status:"found"|"not_found"|"offline"|"invalid", product?, error?}>
 *   BarcodeFood.parseProduct(json, code)       -> {code, name, brand, per100:{kcal,p,c,f}, serving:{g,label}|null, missing:[...], source:"off"}
 *   BarcodeFood.toFoodItem(product, {grams, slot, eaten}) -> {name, slot, kcal, p, c, f, eaten, est, barcode, grams}
 *   BarcodeFood.canDetect()                    -> true when the browser has BarcodeDetector (Android Chrome does)
 *   BarcodeFood.detect(source)                 -> Promise<code|null>; source is an image Blob/File, <img>, <video> or ImageBitmap
 *   BarcodeFood.mount(el, opts)                -> renders the scan card; returns {destroy()}
 *     opts.onAdd(item)       required. item is a food row without id (the app adds id).
 *     opts.slots             slot names for the picker. Default ["Breakfast","Meal 1","Meal 2","Snack","Extra"].
 *     opts.slot              preselected slot. Default "Snack".
 *     opts.library           {get(code)->product|null, put(code, product)} for remembered and hand-entered products.
 *                            Default: localStorage key "barcodeFood.library". Pass a db-backed one to sync.
 *     opts.fetch             fetch to use for lookups. Default window.fetch. Pass null to skip the network.
 *
 * Numbers are rounded the way the app shows them: kcal whole, macros to 0.1 g.
 * est is true when any macro was missing from Open Food Facts or kcal had to be derived.
 */
const BarcodeFood = (() => {
  const OFF = "https://world.openfoodfacts.org/api/v2/product/";
  const FIELDS = "code,product_name,product_name_en,generic_name,brands,quantity,serving_size,serving_quantity,nutriments";
  const LS_KEY = "barcodeFood.library";
  const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "itf"];

  const clean = t => String(t == null ? "" : t).replace(/\D+/g, "");

  function isValid(code) {
    const c = clean(code);
    if (![8, 12, 13, 14].includes(c.length)) return false;
    let sum = 0;
    for (let i = c.length - 2, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += +c[i] * w;
    return (10 - (sum % 10)) % 10 === +c[c.length - 1];
  }

  const num = v => {
    if (v == null || v === "") return null;
    const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const r1 = n => Math.round(n * 10) / 10;

  function parseServing(p) {
    let g = num(p.serving_quantity);
    const label = (p.serving_size || "").trim();
    if (g == null && label) {
      const m = label.match(/([\d.,]+)\s*(g|ml)\b/i);
      if (m) g = num(m[1]);
    }
    return g ? { g: r1(g), label: label || `${r1(g)} g` } : null;
  }

  function parseProduct(json, code) {
    const p = (json && json.product) || {};
    const n = p.nutriments || {};
    const missing = [];
    let kcal = num(n["energy-kcal_100g"]);
    const kj = num(n["energy-kj_100g"]) ?? (n.energy_unit === "kcal" ? null : num(n.energy_100g));
    const pr = num(n.proteins_100g), c = num(n.carbohydrates_100g), f = num(n.fat_100g);
    let derived = false;
    if (kcal == null && kj != null) { kcal = kj / 4.184; derived = true; }
    if (kcal == null && pr != null && c != null && f != null) { kcal = pr * 4 + c * 4 + f * 9; derived = true; }
    if (kcal == null) missing.push("kcal");
    if (pr == null) missing.push("p");
    if (c == null) missing.push("c");
    if (f == null) missing.push("f");
    const name = (p.product_name_en || p.product_name || p.generic_name || "").trim();
    return {
      code: clean(code || p.code || json && json.code),
      name: name || "Unnamed product",
      brand: (p.brands || "").split(",")[0].trim(),
      quantity: (p.quantity || "").trim(),
      per100: { kcal: kcal == null ? 0 : Math.round(kcal), p: r1(pr || 0), c: r1(c || 0), f: r1(f || 0) },
      serving: parseServing(p),
      missing, derived,
      source: "off",
    };
  }

  async function lookup(code, opts = {}) {
    const c = clean(code);
    if (!isValid(c)) return { status: "invalid" };
    const f = "fetch" in opts ? opts.fetch : (typeof fetch === "function" ? fetch : null);
    if (!f) return { status: "offline", error: "no network" };
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    const t = ctrl && setTimeout(() => ctrl.abort(), opts.timeoutMs || 8000);
    try {
      const res = await f(`${OFF}${c}.json?fields=${FIELDS}`, { signal: ctrl && ctrl.signal, headers: { Accept: "application/json" } });
      if (res.status === 404) return { status: "not_found" };
      if (!res.ok) return { status: "offline", error: `HTTP ${res.status}` };
      const json = await res.json();
      if (!json || json.status === 0 || !json.product) return { status: "not_found" };
      return { status: "found", product: parseProduct(json, c) };
    } catch (e) {
      return { status: "offline", error: e && e.name === "AbortError" ? "timed out" : String(e && e.message || e) };
    } finally { if (t) clearTimeout(t); }
  }

  function toFoodItem(product, opts = {}) {
    const grams = num(opts.grams) || (product.serving && product.serving.g) || 100;
    const k = grams / 100, m = product.per100;
    const label = [product.brand && !product.name.toLowerCase().includes(product.brand.toLowerCase()) ? product.brand : "", product.name]
      .filter(Boolean).join(" ");
    return {
      name: `${label} (${r1(grams)} g)`,
      slot: opts.slot || "Snack",
      kcal: Math.round(m.kcal * k), p: r1(m.p * k), c: r1(m.c * k), f: r1(m.f * k),
      eaten: !!opts.eaten,
      est: !!(product.missing && product.missing.length) || !!product.derived,
      barcode: product.code, grams: r1(grams),
    };
  }

  const canDetect = () => typeof window !== "undefined" && "BarcodeDetector" in window;

  let detector = null;
  async function detect(source) {
    if (!canDetect()) return null;
    if (!detector) {
      let formats = FORMATS;
      try { const s = await window.BarcodeDetector.getSupportedFormats(); formats = FORMATS.filter(x => s.includes(x)); } catch (_) {}
      detector = new window.BarcodeDetector(formats.length ? { formats } : undefined);
    }
    let src = source;
    if (typeof Blob !== "undefined" && source instanceof Blob) src = await createImageBitmap(source);
    const hits = await detector.detect(src);
    const good = hits.map(h => clean(h.rawValue)).find(isValid);
    return good || (hits[0] ? clean(hits[0].rawValue) : null);
  }

  function lsLibrary() {
    const read = () => { try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (_) { return {}; } };
    return {
      get: code => read()[code] || null,
      put: (code, product) => { try { const all = read(); all[code] = product; localStorage.setItem(LS_KEY, JSON.stringify(all)); } catch (_) {} },
    };
  }

  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

  function mount(el, opts = {}) {
    if (!el || typeof opts.onAdd !== "function") throw new Error("BarcodeFood.mount needs an element and onAdd");
    const slots = opts.slots || ["Breakfast", "Meal 1", "Meal 2", "Snack", "Extra"];
    const lib = opts.library || lsLibrary();
    const fetchFn = "fetch" in opts ? opts.fetch : (typeof fetch === "function" ? fetch.bind(window) : null);
    const st = { phase: "idle", code: "", product: null, msg: "", grams: "", slot: opts.slot || "Snack", eaten: true };
    let stream = null, raf = 0, alive = true;

    function stopCam() {
      if (raf) cancelAnimationFrame(raf), raf = 0;
      if (stream) stream.getTracks().forEach(t => t.stop()), stream = null;
    }

    const slotSel = () => `<select data-bf="slot">${slots.map(s => `<option${s === st.slot ? " selected" : ""}>${esc(s)}</option>`).join("")}</select>`;

    function view() {
      const scan = canDetect()
        ? `<div class="row bf-row">
             <button type="button" class="btn" data-bf="cam">Scan with camera</button>
             <label class="btn ghost">Photo of barcode<input type="file" accept="image/*" capture="environment" data-bf="photo" hidden></label>
           </div>`
        : `<p class="muted bf-small">This browser can't read barcodes from the camera (Chrome on Android can). Type the numbers under the barcode instead.</p>`;
      const manual = `<form class="row bf-row" data-bf="manual">
          <input type="text" inputmode="numeric" autocomplete="off" placeholder="Barcode number" value="${esc(st.code)}" data-bf="code" style="flex:1;min-width:0">
          <button class="btn ghost" type="submit">Look up</button>
        </form>`;
      let body = "";
      if (st.phase === "camera") body = `<div class="bf-cam"><video playsinline muted data-bf="video"></video><div class="bf-aim"></div></div>
          <div class="row bf-row"><span class="muted bf-small">Hold the barcode inside the box.</span><button type="button" class="btn ghost" data-bf="stop">Cancel</button></div>`;
      else if (st.phase === "loading") body = `<p class="muted">Looking up ${esc(st.code)}…</p>`;
      else if (st.phase === "found") body = foundView();
      else if (st.phase === "manualEntry") body = entryView();
      const msg = st.msg ? `<p class="${st.phase === "error" ? "note" : "muted"} bf-small">${esc(st.msg)}</p>` : "";
      el.innerHTML = `<div class="bf">${st.phase === "camera" ? "" : scan + manual}${msg}${body}</div>`;
      if (st.phase === "camera") startVideo();
    }

    function foundView() {
      const p = st.product, item = toFoodItem(p, { grams: st.grams, slot: st.slot, eaten: st.eaten });
      const serving = p.serving ? `<button type="button" class="chip" data-bf="g" data-g="${p.serving.g}">1 serving · ${esc(p.serving.label)}</button>` : "";
      return `<div class="bf-card">
          <div class="spread"><b>${esc(p.brand && !p.name.toLowerCase().includes(p.brand.toLowerCase()) ? p.brand + " · " : "")}${esc(p.name)}</b><span class="label num">${esc(p.code)}</span></div>
          <p class="muted bf-small num">Per 100 g: ${p.per100.kcal} kcal · P ${p.per100.p} · C ${p.per100.c} · F ${p.per100.f}${p.source === "off" ? " · Open Food Facts" : " · your entry"}</p>
          ${p.missing && p.missing.length ? `<p class="note bf-small">Open Food Facts is missing ${p.missing.join(", ")}; this row is marked as an estimate.</p>` : ""}
          <div class="row bf-row">${serving}<button type="button" class="chip" data-bf="g" data-g="100">100 g</button></div>
          <div class="row bf-row">
            <label class="bf-small">Grams <input type="number" inputmode="decimal" min="1" step="any" value="${esc(item.grams)}" data-bf="grams" style="width:6em"></label>
            ${slotSel()}
            <label class="bf-small"><input type="checkbox" data-bf="eaten"${st.eaten ? " checked" : ""}> Eaten</label>
          </div>
          <p class="num" data-bf="total">${totalText(item)}</p>
          <div class="row bf-row">
            <button type="button" class="btn" data-bf="add">Add to food</button>
            ${p.source === "off" ? `<button type="button" class="btn ghost" data-bf="edit">Fix numbers</button>` : `<button type="button" class="btn ghost" data-bf="edit">Edit</button>`}
            <button type="button" class="btn ghost" data-bf="reset">Scan another</button>
          </div>
        </div>`;
    }

    function totalText(item) { return `<b>${item.kcal} kcal</b> · P ${item.p} g · C ${item.c} g · F ${item.f} g`; }

    function entryView() {
      const p = st.product || { name: "", brand: "", per100: { kcal: "", p: "", c: "", f: "" }, serving: null };
      const f = (k, label) => `<label class="bf-small">${label}<input type="number" inputmode="decimal" min="0" step="any" data-bf="m-${k}" value="${esc(p.per100[k])}" style="width:5em"></label>`;
      return `<form class="bf-card" data-bf="entry">
          <p class="bf-small">Enter it once from the label and it will fill in by itself next time you scan <span class="num">${esc(st.code)}</span>.</p>
          <input type="text" placeholder="Name, e.g. Almarai Greek yoghurt" data-bf="m-name" value="${esc(p.name)}" required>
          <p class="muted bf-small">Per 100 g from the nutrition label:</p>
          <div class="row bf-row">${f("kcal", "kcal ")}${f("p", "Protein ")}${f("c", "Carbs ")}${f("f", "Fat ")}</div>
          <label class="bf-small">Serving size (g, optional) <input type="number" inputmode="decimal" min="0" step="any" data-bf="m-serv" value="${esc(p.serving ? p.serving.g : "")}" style="width:5em"></label>
          <div class="row bf-row"><button class="btn" type="submit">Save</button><button type="button" class="btn ghost" data-bf="reset">Cancel</button></div>
        </form>`;
    }

    async function go(code) {
      stopCam();
      const c = clean(code);
      st.code = c; st.grams = ""; st.msg = "";
      if (!isValid(c)) { st.phase = "error"; st.msg = c ? `${c} doesn't look like a full barcode. Check the digits under the bars.` : "Type the barcode number."; return view(); }
      const known = await lib.get(c);
      if (known) { st.product = known; st.phase = "found"; return view(); }
      st.phase = "loading"; view();
      const r = await lookup(c, { fetch: fetchFn });
      if (!alive) return;
      if (r.status === "found") {
        st.product = r.product; st.phase = "found";
        try { await lib.put(c, r.product); } catch (_) {}
      } else {
        st.product = null; st.phase = "manualEntry";
        st.msg = r.status === "not_found" ? "Open Food Facts doesn't know this product yet."
          : "Couldn't reach Open Food Facts from here, so enter the label numbers.";
      }
      view();
    }

    async function startVideo() {
      const v = el.querySelector('[data-bf="video"]');
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (!alive || st.phase !== "camera") return stopCam();
        v.srcObject = stream; await v.play();
        let busy = false;
        const tick = async () => {
          if (!stream) return;
          if (!busy && v.readyState >= 2) {
            busy = true;
            try { const c = await detect(v); if (c && isValid(c)) { if (navigator.vibrate) navigator.vibrate(60); return go(c); } } catch (_) {}
            busy = false;
          }
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch (e) {
        stopCam(); st.phase = "error";
        st.msg = "The camera isn't available here. Use \"Photo of barcode\" or type the number.";
        view();
      }
    }

    function onClick(e) {
      const t = e.target.closest("[data-bf]"); if (!t) return;
      const a = t.dataset.bf;
      if (a === "cam") { st.phase = "camera"; st.msg = ""; view(); }
      else if (a === "stop" || a === "reset") { stopCam(); st.phase = "idle"; st.product = null; st.msg = ""; st.code = ""; view(); }
      else if (a === "g") { st.grams = t.dataset.g; view(); }
      else if (a === "edit") { st.phase = "manualEntry"; st.msg = ""; view(); }
      else if (a === "add") {
        const item = toFoodItem(st.product, { grams: st.grams, slot: st.slot, eaten: st.eaten });
        opts.onAdd(item);
        st.phase = "idle"; st.product = null; st.code = ""; st.msg = `Added ${item.name}.`; view();
      }
    }
    function onChange(e) {
      const t = e.target, a = t.dataset && t.dataset.bf; if (!a) return;
      if (a === "slot") st.slot = t.value;
      else if (a === "eaten") st.eaten = t.checked;
      else if (a === "photo" && t.files && t.files[0]) {
        st.msg = "Reading the photo…"; st.phase = "idle"; view();
        detect(t.files[0]).then(c => c ? go(c) : (st.phase = "error", st.msg = "Couldn't find a barcode in that photo. Get closer, keep it flat and sharp, or type the number.", view()))
          .catch(() => { st.phase = "error"; st.msg = "Couldn't read that photo. Type the number instead."; view(); });
      }
    }
    async function onSubmit(e) {
      const t = e.target, a = t.dataset && t.dataset.bf; if (!a) return;
      e.preventDefault();
      if (a === "manual") go(t.querySelector('[data-bf="code"]').value);
      else if (a === "entry") {
        const v = k => num(t.querySelector(`[data-bf="m-${k}"]`).value);
        const pr = v("p") || 0, c = v("c") || 0, f = v("f") || 0;
        const kcal = v("kcal") ?? (pr * 4 + c * 4 + f * 9);
        const serv = v("serv");
        const product = {
          code: st.code, name: t.querySelector('[data-bf="m-name"]').value.trim() || "Unnamed product",
          brand: "", quantity: "", per100: { kcal: Math.round(kcal), p: r1(pr), c: r1(c), f: r1(f) },
          serving: serv ? { g: r1(serv), label: `${r1(serv)} g` } : null,
          missing: [], derived: v("kcal") == null, source: "manual",
        };
        try { await lib.put(st.code, product); } catch (_) {}
        st.product = product; st.phase = "found"; st.msg = ""; view();
      }
    }

    function onInput(e) {
      const t = e.target;
      if (!t.dataset || t.dataset.bf !== "grams" || st.phase !== "found") return;
      st.grams = t.value;
      const out = el.querySelector('[data-bf="total"]');
      if (out) out.innerHTML = totalText(toFoodItem(st.product, { grams: st.grams }));
    }

    el.addEventListener("click", onClick);
    el.addEventListener("input", onInput);
    el.addEventListener("change", onChange);
    el.addEventListener("submit", onSubmit);
    view();
    return {
      lookupCode: go,
      destroy() { alive = false; stopCam(); el.removeEventListener("click", onClick); el.removeEventListener("input", onInput); el.removeEventListener("change", onChange); el.removeEventListener("submit", onSubmit); el.innerHTML = ""; },
    };
  }

  /* Minimal styles for the parts the app's own classes (.btn .chip .row .spread .muted .note .label .num) don't cover. */
  const CSS = `.bf{display:flex;flex-direction:column;gap:10px}.bf-row{flex-wrap:wrap;gap:8px;align-items:center}.bf-small{font-size:.88rem}
.bf-card{display:flex;flex-direction:column;gap:8px;padding:12px;border:1px solid var(--line);border-radius:var(--r,12px)}
.bf-cam{position:relative;border-radius:var(--r,12px);overflow:hidden;background:#000;aspect-ratio:4/3}.bf-cam video{width:100%;height:100%;object-fit:cover;display:block}
.bf-aim{position:absolute;left:12%;right:12%;top:32%;bottom:32%;border:2px solid var(--accent);border-radius:8px;box-shadow:0 0 0 999px rgba(0,0,0,.35)}`;

  return { clean, isValid, lookup, parseProduct, toFoodItem, canDetect, detect, mount, CSS, OFF_URL: OFF };
})();
if (typeof module !== "undefined") module.exports = BarcodeFood;
