/* Photo or text food logger for the Aziz Cut Tracker (Food tab card "Log from a photo or description").
 * Plain JS, no imports, no network of its own. Claude is reached through the page's `sample` capability,
 * which the host passes in (declare capabilities: {sample: {images: true}} on the app).
 * API:
 *   PhotoFood.css                               -> string, inject once (uses the app's tokens)
 *   PhotoFood.bind(root, opts)                  -> wire the card's events once (delegated on root, e.g. document)
 *        opts = { getSample: () => Promise<sample|null>, getDay: date => day, onAdd: (date, items) => void,
 *                 render: () => void, date: () => "YYYY-MM-DD" }
 *   PhotoFood.html(date, day)                   -> HTML string for the card (state lives in the module, so re-renders keep it)
 *   PhotoFood.prompt({text, hasImage})          -> the instruction sent to Claude
 *   PhotoFood.parse(value)                      -> {items:[{name,portion,kcal,p,c,f,confidence,check}], note} (cleaned)
 *   PhotoFood.toFoodItems(items, {slot, eaten, combine, uid}) -> days/{date}.food entries with est:true
 *   PhotoFood.guessSlot(day)                    -> "Meal 1" | "Meal 2" | "Extra"
 *   PhotoFood.totals(items)                     -> {kcal,p,c,f}
 *   PhotoFood.errorText(code)                   -> what to tell Aziz for a sample error code
 * Nothing is written until Aziz presses "Add"; every number stays editable first.
 */
const PhotoFood = (() => {
  const SLOTS = ["Meal 1", "Meal 2", "Snack", "Breakfast", "Extra"];
  const MAX_ITEMS = 12;
  const r1 = n => Math.round(n * 10) / 10;
  const num = v => { const n = typeof v === "string" ? parseFloat(v.replace(",", ".")) : +v; return isFinite(n) && n > 0 ? n : 0; };
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function prompt({ text, hasImage, kcal } = {}) {
    const target = typeof kcal === "number" && kcal > 0 ? Math.round(kcal).toLocaleString("en-US") : "2,000";
    const desc = String(text || "").trim().slice(0, 2000);
    return [
      "Estimate the calories and macros of the food " + (hasImage ? "in the attached photo" + (desc ? " and described below" : "") : "described below") + ".",
      "Context: the eater is a 92 kg man in Kuwait on a " + target + " kcal cut. Most meals come from Nutreeze (a Kuwaiti meal-prep service) and often show a printed label; local food includes khubz, machboos, shawarma, mandi and similar.",
      "Rules:",
      "- If a nutrition label or menu card with numbers is readable, copy those numbers exactly and set confidence to \"high\".",
      "- Otherwise estimate from visible portion sizes (plate size, utensils, hand) and typical recipes. Restaurant and Gulf home cooking use more oil than you might assume; count it.",
      "- Split into separate items only when they are clearly separate foods (a meal and a drink, a main and a side). One mixed dish is one item.",
      "- kcal should roughly equal 4*protein + 4*carbs + 9*fat.",
      "- If there is no food, return an empty items list and say why in note.",
      desc ? "Description from the eater: " + JSON.stringify(desc) : "",
      "Reply with only JSON in this shape:",
      '{"items":[{"name":"Chicken machboos","portion":"1 plate, ~300 g rice + 200 g chicken","kcal":820,"p":55,"c":95,"f":22,"confidence":"medium"}],"note":"One short sentence on the biggest uncertainty."}',
      "name: short, as it would appear in a food log. confidence: low, medium or high. Numbers are grams (kcal for kcal), no units, no ranges."
    ].filter(Boolean).join("\n");
  }

  function parse(value) {
    let v = value;
    if (typeof v === "string") { try { v = JSON.parse(v); } catch (e) { v = null; } }
    if (Array.isArray(v)) v = { items: v };
    if (!v || typeof v !== "object") return { items: [], note: "Claude's answer couldn't be read. Try again." };
    const raw = Array.isArray(v.items) ? v.items : [];
    const items = raw.filter(x => x && typeof x === "object").slice(0, MAX_ITEMS).map(x => {
      const p = r1(Math.min(num(x.p ?? x.protein), 400)), c = r1(Math.min(num(x.c ?? x.carbs), 800)), f = r1(Math.min(num(x.f ?? x.fat), 300));
      const fromMacros = 4 * p + 4 * c + 9 * f;
      let kcal = Math.round(Math.min(num(x.kcal ?? x.calories), 5000));
      if (!kcal && fromMacros) kcal = Math.round(fromMacros);
      const conf = String(x.confidence || "").toLowerCase();
      return {
        name: String(x.name || "Food").replace(/\s+/g, " ").trim().slice(0, 80) || "Food",
        portion: String(x.portion || "").replace(/\s+/g, " ").trim().slice(0, 120),
        kcal, p, c, f,
        confidence: ["low", "medium", "high"].includes(conf) ? conf : "medium",
        check: kcal > 0 && fromMacros > 0 && Math.abs(fromMacros - kcal) / kcal > 0.25
      };
    }).filter(x => x.kcal > 0 || x.p || x.c || x.f);
    return { items, note: String(v.note || "").trim().slice(0, 300) };
  }

  function totals(items) {
    return (items || []).reduce((t, i) => ({ kcal: t.kcal + num(i.kcal), p: r1(t.p + num(i.p)), c: r1(t.c + num(i.c)), f: r1(t.f + num(i.f)) }), { kcal: 0, p: 0, c: 0, f: 0 });
  }

  function toFoodItems(items, { slot = "Extra", eaten = true, combine = false, uid } = {}) {
    const id = uid || (() => Math.random().toString(36).slice(2, 9));
    const keep = (items || []).filter(i => i && i.on !== false && (num(i.kcal) || num(i.p) || num(i.c) || num(i.f)));
    if (!keep.length) return [];
    const clean = i => ({ id: id(), name: String(i.name || "Food").trim().slice(0, 80) || "Food", slot, kcal: Math.round(num(i.kcal)), p: r1(num(i.p)), c: r1(num(i.c)), f: r1(num(i.f)), eaten: !!eaten, est: true });
    if (!combine || keep.length === 1) return keep.map(clean);
    const t = totals(keep);
    let name = keep.map(i => String(i.name || "").trim()).filter(Boolean).join(" + ");
    if (name.length > 80) name = name.slice(0, 77) + "...";
    return [clean({ name, kcal: t.kcal, p: t.p, c: t.c, f: t.f })];
  }

  function guessSlot(day) {
    const food = (day && day.food) || [];
    if (!food.some(i => i.slot === "Meal 1")) return "Meal 1";
    if (!food.some(i => i.slot === "Meal 2")) return "Meal 2";
    return "Extra";
  }

  function errorText(code) {
    switch (code) {
      case "not_granted": case "sampling_disabled": case "not_declared": case "capability_disabled": case "capability_removed":
        return "Claude isn't available on this page right now. Enter the numbers in the form above instead.";
      case "images_unavailable": case "image_rejected":
        return "That photo couldn't be sent. Try a JPG or PNG, or describe the food in words.";
      case "rate_limited": return "Claude is busy for a moment. Wait a minute and try again.";
      case "session_expired": return "You've been signed out. Reload the page and try again.";
      case "refused": return "Claude couldn't help with that one. Try describing the food in words.";
      case "invalid_json": case "empty_completion": return "Claude's answer couldn't be read. Try again, maybe with a shorter description.";
      case "prompt_too_large": return "That description is too long. Shorten it and try again.";
      default: return "Something went wrong reaching Claude. Try again.";
    }
  }

  /* ---------- card ---------- */
  const S = { text: "", image: null, imageUrl: "", busy: false, ctl: null, result: null, error: "", slot: "", eaten: true, combine: false, canImage: null, hidden: false, forDate: "" };
  let O = null;

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

  async function estimate() {
    if (S.busy) return;
    const text = S.text.trim();
    if (!text && !S.image) { S.error = "Add a photo or describe what you ate."; O.render(); return; }
    const sample = await O.getSample();
    if (!sample) { S.hidden = true; O.render(); return; }
    S.busy = true; S.error = ""; S.result = null; S.ctl = new AbortController(); O.render();
    try {
      const opts = { signal: S.ctl.signal, modelTier: "default" };
      if (S.image) opts.images = [S.image];
      const v = await sample.json(prompt({ text, hasImage: !!S.image, kcal: O.kcal ? O.kcal() : undefined }), opts);
      const res = parse(v);
      S.result = res;
      if (!res.items.length) S.error = res.note || "No food found. Try another photo or describe it in words.";
    } catch (e) {
      const code = e && e.code;
      if (code !== "cancelled") {
        S.error = errorText(code);
        if (["not_granted", "sampling_disabled", "not_declared", "capability_disabled", "capability_removed"].includes(code)) S.hidden = true;
        if (code === "images_unavailable") { S.canImage = false; clearImage(); }
      }
    }
    S.busy = false; S.ctl = null; O.render();
  }

  function add() {
    if (!S.result) return;
    const date = O.date();
    const items = toFoodItems(S.result.items, { slot: S.slot || guessSlot(O.getDay(date)), eaten: S.eaten, combine: S.combine });
    if (!items.length) { S.error = "Nothing to add. Tick at least one item with numbers."; O.render(); return; }
    O.onAdd(date, items);
    S.text = ""; S.result = null; S.error = ""; S.slot = ""; clearImage();
    O.render();
  }

  function bind(root, opts) {
    O = opts;
    O.getSample().then(async s => {
      if (!s) { S.hidden = true; O.render(); return; }
      const lim = await s.limits().catch(() => null);
      S.canImage = !!(lim && lim.images);
      if (S.canImage) S.accept = lim.images.mediaTypes.join(",");
      O.render();
    }).catch(() => { S.hidden = true; O.render(); });
    root.addEventListener("click", e => {
      const b = e.target.closest("[data-pf]"); if (!b) return;
      const a = b.dataset.pf;
      if (a === "go") estimate();
      else if (a === "stop" && S.ctl) S.ctl.abort();
      else if (a === "add") add();
      else if (a === "clear") { S.result = null; S.error = ""; O.render(); }
      else if (a === "noimg") { clearImage(); O.render(); }
    });
    root.addEventListener("input", e => {
      const t = e.target;
      if (t.id === "pfText") { S.text = t.value; return; }
      const k = t.dataset && t.dataset.pfk, i = t.dataset && +t.dataset.pfi;
      if (k && S.result && S.result.items[i]) {
        const it = S.result.items[i];
        if (k === "on") it.on = t.checked; else if (k === "name") it.name = t.value; else it[k] = num(t.value);
        const tt = totals(S.result.items.filter(x => x.on !== false));
        const el = document.getElementById("pfTotal");
        if (el) el.textContent = `${Math.round(tt.kcal)} kcal · ${Math.round(tt.p)} P · ${Math.round(tt.c)} C · ${Math.round(tt.f)} F`;
      }
    });
    root.addEventListener("change", async e => {
      const t = e.target;
      if (t.id === "pfSlot") S.slot = t.value;
      else if (t.id === "pfEaten") S.eaten = t.checked;
      else if (t.id === "pfCombine") S.combine = t.checked;
      else if (t.id === "pfFile" && t.files && t.files[0]) {
        clearImage();
        S.image = await shrink(t.files[0]);
        S.imageUrl = URL.createObjectURL(S.image);
        S.result = null; S.error = "";
        O.render();
      }
    });
  }

  function dayLabel(date) {
    const [y, m, d] = String(date).split("-").map(Number);
    return y && m && d ? new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "this day";
  }

  function html(date, day) {
    if (S.hidden) return "";
    if (S.forDate !== date) { S.forDate = date; S.slot = ""; }
    const slot = S.slot || guessSlot(day);
    const res = S.result, t = res ? totals(res.items.filter(x => x.on !== false)) : null;
    const conf = { low: "Rough guess", medium: "Estimate", high: "From label" };
    return `<div class="card pf">
    <div class="spread"><h3>Log from a photo or description</h3><span class="muted" style="font-size:.85rem">Claude estimates, you check</span></div>
    <textarea id="pfText" rows="2" placeholder="e.g. Half a chicken shawarma plate with garlic sauce, no fries" aria-label="Describe what you ate">${esc(S.text)}</textarea>
    <div class="row">
      ${S.canImage ? `<label class="btn ghost small pf-file">${S.image ? "Change photo" : "Add photo"}<input type="file" id="pfFile" accept="${esc(S.accept || "image/*")}" capture="environment" hidden></label>` : ""}
      ${S.imageUrl ? `<span class="pf-thumb"><img src="${S.imageUrl}" alt="Your food photo"><button class="x" data-pf="noimg" aria-label="Remove photo">×</button></span>` : ""}
      ${S.busy ? `<button class="btn" data-pf="stop">Stop</button><span class="muted" style="font-size:.88rem">Estimating…</span>` : `<button class="btn" data-pf="go">${res ? "Estimate again" : "Estimate"}</button>`}
    </div>
    ${S.error ? `<p class="note">${esc(S.error)}</p>` : ""}
    ${res && res.items.length ? `<div class="pf-items">${res.items.map((i, n) => `<div class="pf-item">
        <div class="row" style="flex-wrap:nowrap"><input type="checkbox" data-pfk="on" data-pfi="${n}" ${i.on !== false ? "checked" : ""} aria-label="Include"><input type="text" data-pfk="name" data-pfi="${n}" value="${esc(i.name)}" aria-label="Name" style="flex:1;min-width:0"><span class="pill ${i.confidence === "high" ? "good" : i.confidence === "low" ? "warn" : ""}">${conf[i.confidence]}</span></div>
        ${i.portion ? `<small class="muted">${esc(i.portion)}</small>` : ""}
        <div class="pf-mac">
          <label class="field"><span class="label">kcal</span><input type="number" inputmode="decimal" step="1" data-pfk="kcal" data-pfi="${n}" value="${i.kcal}"></label>
          <label class="field"><span class="label">Protein</span><input type="number" inputmode="decimal" step="0.1" data-pfk="p" data-pfi="${n}" value="${i.p}"></label>
          <label class="field"><span class="label">Carbs</span><input type="number" inputmode="decimal" step="0.1" data-pfk="c" data-pfi="${n}" value="${i.c}"></label>
          <label class="field"><span class="label">Fat</span><input type="number" inputmode="decimal" step="0.1" data-pfk="f" data-pfi="${n}" value="${i.f}"></label>
        </div>
        ${i.check ? `<small class="muted">The calories don't match the macros well. Check the numbers.</small>` : ""}
      </div>`).join("")}</div>
      ${res.note ? `<p class="muted" style="font-size:.88rem">${esc(res.note)}</p>` : ""}
      <p class="num" style="margin:0"><b id="pfTotal">${Math.round(t.kcal)} kcal · ${Math.round(t.p)} P · ${Math.round(t.c)} C · ${Math.round(t.f)} F</b></p>
      <div class="row">
        <select id="pfSlot" aria-label="Slot">${SLOTS.map(s => `<option ${s === slot ? "selected" : ""}>${s}</option>`).join("")}</select>
        <label class="row" style="font-size:.9rem;gap:6px"><input type="checkbox" id="pfEaten" ${S.eaten ? "checked" : ""}> Eaten</label>
        ${res.items.length > 1 ? `<label class="row" style="font-size:.9rem;gap:6px"><input type="checkbox" id="pfCombine" ${S.combine ? "checked" : ""}> As one entry</label>` : ""}
      </div>
      <div class="row"><button class="btn" data-pf="add">Add to ${esc(dayLabel(date))}</button><button class="btn ghost small" data-pf="clear">Discard</button></div>
      <p class="muted" style="font-size:.82rem;margin:0">Saved as an estimate. Nutreeze label numbers are always better when you have them.</p>` : ""}
  </div>`;
  }

  const css = `
.pf textarea{width:100%;border:1px solid var(--line);background:var(--sunk);color:var(--ink);border-radius:8px;padding:8px;font:inherit;resize:vertical}
.pf .pf-file{cursor:pointer}
.pf .pf-thumb{position:relative;display:inline-block}
.pf .pf-thumb img{width:56px;height:56px;object-fit:cover;border-radius:8px;border:1px solid var(--line);display:block}
.pf .pf-thumb .x{position:absolute;top:-8px;right:-8px}
.pf .pf-items{display:flex;flex-direction:column;gap:10px}
.pf .pf-item{border:1px solid var(--line);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:6px;background:var(--surface)}
.pf .pf-mac{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}
.pf .pf-mac .field{min-width:0}
.pf .pf-mac input{width:100%;min-width:0}
`;

  return { css, bind, html, prompt, parse, totals, toFoodItems, guessSlot, errorText, SLOTS };
})();
if (typeof module !== "undefined" && module.exports) module.exports = PhotoFood;
