/**
 * MacroTarget: log food by the macro you want from it.
 *
 *   "40 g protein of grilled chicken"  -> 129 g grilled chicken breast (213 kcal, 40 P, 0 C, 4.6 F)
 *   "300 kcal rice"                    -> 231 g cooked white rice
 *   "50 g carbs from oats"             -> 75 g oats
 *   "150 g salmon"                     -> plain weight, scaled from per-100 g
 *
 * Pure logic + a small card. Browser global `window.MacroTarget` or CommonJS.
 *
 *   MacroTarget.parse(text)                     -> {amount, macro: "p"|"c"|"f"|"kcal"|"g", query}
 *   MacroTarget.find(query, {foods, extra})     -> {food, candidates} (best per-100 g match)
 *   MacroTarget.gramsFor(food, macro, amount)   -> grams of food that give `amount` of `macro`, or null
 *   MacroTarget.scale(food, grams)              -> {name, kcal, p, c, f, grams, est}
 *   MacroTarget.solve(text, opts)               -> {ok, parsed, food, grams, item, note} | {ok:false, parsed, reason, candidates}
 *       opts.custom = {name?, kcal, p, c, f} per 100 g, used when the catalog has no match
 *   MacroTarget.html(date, day) / bind(root, {getDay, date, render, onAdd}) / css
 */
const MacroTarget = (() => {
  // Per 100 g (ml for drinks). Cooked unless the name says otherwise. All values are typical label / USDA figures.
  const FOODS = [
    { id: "chicken-breast", name: "Grilled chicken breast", kcal: 165, p: 31, c: 0, f: 3.6, alias: ["chicken", "grilled chicken", "chicken breast", "breast"] },
    { id: "chicken-thigh", name: "Chicken thigh, skinless", kcal: 209, p: 26, c: 0, f: 11, alias: ["thigh", "chicken thigh"] },
    { id: "beef-mince", name: "Lean beef mince (5%)", kcal: 137, p: 21, c: 0, f: 5, alias: ["beef", "mince", "ground beef", "minced beef", "lean beef"] },
    { id: "steak", name: "Beef steak, lean", kcal: 190, p: 29, c: 0, f: 8, alias: ["steak", "sirloin", "fillet"] },
    { id: "lamb", name: "Lamb, lean", kcal: 230, p: 25, c: 0, f: 14, alias: ["lamb", "mutton"] },
    { id: "salmon", name: "Salmon", kcal: 208, p: 20, c: 0, f: 13, alias: ["salmon"] },
    { id: "tuna", name: "Tuna, canned in water", kcal: 116, p: 26, c: 0, f: 1, alias: ["tuna", "canned tuna"] },
    { id: "white-fish", name: "White fish (hamour, cod)", kcal: 96, p: 21, c: 0, f: 1, alias: ["fish", "hamour", "cod", "tilapia", "white fish"] },
    { id: "shrimp", name: "Shrimp", kcal: 99, p: 24, c: 0.2, f: 0.3, alias: ["shrimp", "prawns", "prawn"] },
    { id: "egg", name: "Whole egg", kcal: 155, p: 13, c: 1.1, f: 11, alias: ["egg", "eggs", "boiled egg", "boiled eggs", "whole egg"] },
    { id: "egg-white", name: "Egg white", kcal: 52, p: 11, c: 0.7, f: 0.2, alias: ["egg white", "egg whites", "whites"] },
    { id: "greek-yogurt", name: "Greek yogurt 0%", kcal: 59, p: 10, c: 3.6, f: 0.4, alias: ["greek yogurt", "greek yoghurt", "yogurt", "yoghurt", "skyr"] },
    { id: "labneh", name: "Labneh", kcal: 180, p: 8, c: 4, f: 15, alias: ["labneh"] },
    { id: "cottage", name: "Cottage cheese", kcal: 98, p: 11, c: 3.4, f: 4.3, alias: ["cottage cheese", "cottage"] },
    { id: "milk", name: "Low-fat milk", kcal: 46, p: 3.4, c: 5, f: 1.5, alias: ["milk", "low fat milk", "low-fat milk", "skimmed milk"] },
    { id: "laban", name: "Laban", kcal: 45, p: 3.3, c: 4.5, f: 1.5, alias: ["laban", "buttermilk"] },
    { id: "whey", name: "Whey isolate powder", kcal: 375, p: 78, c: 6, f: 1.5, alias: ["whey", "protein powder", "iso100", "iso 100", "isolate", "scoop"] },
    { id: "rice", name: "White rice, cooked", kcal: 130, p: 2.7, c: 28, f: 0.3, alias: ["rice", "white rice", "basmati", "steamed rice"] },
    { id: "brown-rice", name: "Brown rice, cooked", kcal: 123, p: 2.7, c: 26, f: 1, alias: ["brown rice"] },
    { id: "oats", name: "Oats, dry", kcal: 379, p: 13, c: 67, f: 6.5, alias: ["oats", "oatmeal", "porridge", "rolled oats"] },
    { id: "potato", name: "Potato, boiled", kcal: 87, p: 1.9, c: 20, f: 0.1, alias: ["potato", "potatoes", "boiled potato"] },
    { id: "sweet-potato", name: "Sweet potato, baked", kcal: 90, p: 2, c: 21, f: 0.1, alias: ["sweet potato", "sweet potatoes"] },
    { id: "pasta", name: "Pasta, cooked", kcal: 158, p: 5.8, c: 31, f: 0.9, alias: ["pasta", "spaghetti", "penne", "macaroni"] },
    { id: "khubz", name: "Khubz (Arabic bread)", kcal: 255, p: 12.6, c: 49, f: 0.9, alias: ["khubz", "bread", "pita", "arabic bread", "toast"] },
    { id: "lentils", name: "Lentils, cooked", kcal: 116, p: 9, c: 20, f: 0.4, alias: ["lentils", "lentil", "dal", "daal"] },
    { id: "chickpeas", name: "Chickpeas, cooked", kcal: 164, p: 8.9, c: 27, f: 2.6, alias: ["chickpeas", "chickpea", "hummus beans"] },
    { id: "hummus", name: "Hummus", kcal: 166, p: 7.9, c: 14, f: 9.6, alias: ["hummus", "houmous"] },
    { id: "banana", name: "Banana", kcal: 89, p: 1.1, c: 23, f: 0.3, alias: ["banana", "bananas"] },
    { id: "apple", name: "Apple", kcal: 52, p: 0.3, c: 14, f: 0.2, alias: ["apple", "apples"] },
    { id: "dates", name: "Dates", kcal: 282, p: 2.5, c: 75, f: 0.4, alias: ["dates", "date", "tamr"] },
    { id: "berries", name: "Mixed berries", kcal: 50, p: 0.7, c: 12, f: 0.3, alias: ["berries", "blueberries", "strawberries", "raspberries"] },
    { id: "avocado", name: "Avocado", kcal: 160, p: 2, c: 8.5, f: 15, alias: ["avocado"] },
    { id: "almonds", name: "Almonds", kcal: 579, p: 21, c: 22, f: 50, alias: ["almonds", "almond", "nuts"] },
    { id: "peanut-butter", name: "Peanut butter", kcal: 588, p: 25, c: 20, f: 50, alias: ["peanut butter", "pb"] },
    { id: "olive-oil", name: "Olive oil", kcal: 884, p: 0, c: 0, f: 100, alias: ["olive oil", "oil"] },
    { id: "butter", name: "Butter", kcal: 717, p: 0.9, c: 0.1, f: 81, alias: ["butter"] },
    { id: "cheese", name: "Cheddar cheese", kcal: 403, p: 25, c: 1.3, f: 33, alias: ["cheese", "cheddar"] },
    { id: "broccoli", name: "Broccoli", kcal: 34, p: 2.8, c: 7, f: 0.4, alias: ["broccoli", "veg", "vegetables", "greens"] },
    { id: "salad", name: "Mixed salad", kcal: 20, p: 1.5, c: 3.5, f: 0.2, alias: ["salad", "lettuce", "leaves"] }
  ];

  const MACROS = { p: "protein", c: "carbs", f: "fat", kcal: "kcal", g: "weight" };
  const MACRO_WORDS = {
    protein: "p", prot: "p", pro: "p", p: "p",
    carb: "c", carbs: "c", carbohydrate: "c", carbohydrates: "c", c: "c",
    fat: "f", fats: "f", f: "f",
    kcal: "kcal", cal: "kcal", cals: "kcal", calorie: "kcal", calories: "kcal", kcals: "kcal"
  };
  const FILLER = new Set(["of", "from", "in", "worth", "with", "the", "a", "an", "some", "my", "for", "and", "to", "please", "add", "log"]);
  const r1 = n => Math.round(n * 10) / 10;
  const num = v => { const n = typeof v === "string" ? parseFloat(v.replace(",", ".")) : +v; return isFinite(n) && n >= 0 ? n : 0; };
  const norm = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9%.\s-]/g, " ").replace(/\s+/g, " ").trim();
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /**
   * "40 g protein of grilled chicken" -> {amount:40, macro:"p", query:"grilled chicken"}.
   * The macro word may sit before or after the number ("protein 40 g chicken" works too).
   * A number with a gram unit and no macro word is a plain weight (macro "g");
   * a bare number with no unit defaults to protein. Returns null without a number.
   */
  function parse(text) {
    const t = norm(String(text ?? "").replace(/(\d),(\d)/g, "$1.$2")).replace(/(\d)(g|gr|grams?|kcal|cals?|calories)\b/g, "$1 $2");
    const toks = t.split(" ").filter(Boolean);
    const ni = toks.findIndex(x => /^\d+(\.\d+)?$/.test(x));
    if (ni < 0) return null;
    const amount = parseFloat(toks[ni]);
    const used = new Set([ni]);
    let unit = null, macro = null;
    let i = ni + 1;
    if (i < toks.length && /^(g|gr|grams?|kcal|cals?|calories)$/.test(toks[i])) { unit = toks[i]; used.add(i); i++; }
    if (unit && MACRO_WORDS[unit] === "kcal") macro = "kcal";
    // macro word right after the number/unit, skipping one filler ("40 g of protein")
    for (let k = i, hops = 0; k < toks.length && hops < 2; k++, hops++) {
      if (FILLER.has(toks[k])) { continue; }
      if (MACRO_WORDS[toks[k]] && !macro) { macro = MACRO_WORDS[toks[k]]; used.add(k); }
      break;
    }
    // or just before the number ("protein 40 g chicken")
    if (!macro && ni > 0 && MACRO_WORDS[toks[ni - 1]]) { macro = MACRO_WORDS[toks[ni - 1]]; used.add(ni - 1); }
    if (!macro) macro = unit ? "g" : "p";
    const query = toks.filter((x, k) => !used.has(k) && !FILLER.has(x) && !MACRO_WORDS[x]).join(" ").trim();
    return { amount, macro, query, unit: unit || null };
  }

  /** Best per-100 g match for a free-text name. Scores alias and name token overlap; exact alias wins. */
  function find(query, opts = {}) {
    const q = norm(query);
    const foods = (opts.foods || FOODS).concat(opts.extra || []);
    if (!q) return { food: null, candidates: [] };
    const qt = q.split(" ");
    const scored = foods.map(fd => {
      const names = [fd.name].concat(fd.alias || []).map(norm);
      let s = 0;
      for (const n of names) {
        if (n === q) s = Math.max(s, 100);
        else if (q.includes(n)) s = Math.max(s, 60 + n.length);
        else if (n.includes(q)) s = Math.max(s, 40 + q.length);
        else {
          const nt = n.split(" "), hit = qt.filter(x => nt.includes(x)).length;
          if (hit) s = Math.max(s, 10 * hit + (hit === nt.length ? 15 : 0));
        }
      }
      return { food: fd, s };
    }).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
    return { food: scored[0] ? scored[0].food : null, candidates: scored.slice(0, 4).map(x => x.food) };
  }

  /** Grams of `food` that give `amount` of `macro`. Null when the food has none of that macro. */
  function gramsFor(food, macro, amount) {
    if (!food || !(amount > 0)) return null;
    if (macro === "g") return Math.round(amount);
    const per100 = num(food[macro]);
    if (!(per100 > 0)) return null;
    return Math.round(amount / per100 * 100);
  }

  /** A food row for `grams` of `food`. */
  function scale(food, grams) {
    const k = grams / 100;
    return {
      name: `${food.name}, ${Math.round(grams)} g`,
      kcal: Math.round(num(food.kcal) * k), p: r1(num(food.p) * k), c: r1(num(food.c) * k), f: r1(num(food.f) * k),
      grams: Math.round(grams), est: true
    };
  }

  /**
   * One call: parse, match, work out grams, build the food row.
   * opts.custom = {name?, kcal, p, c, f} per 100 g replaces the catalog match (for food not in the list).
   */
  function solve(text, opts = {}) {
    const parsed = parse(text);
    if (!parsed) return { ok: false, parsed: null, reason: "Start with a number, e.g. \"40 g protein of grilled chicken\".", candidates: [] };
    let food = null, candidates = [];
    const cu = opts.custom;
    if (cu && (num(cu.kcal) > 0 || num(cu.p) > 0 || num(cu.c) > 0 || num(cu.f) > 0)) {
      const kcal = num(cu.kcal) || Math.round(num(cu.p) * 4 + num(cu.c) * 4 + num(cu.f) * 9);
      food = { id: "custom", name: String(cu.name || parsed.query || "Food").trim() || "Food", kcal, p: num(cu.p), c: num(cu.c), f: num(cu.f), custom: true };
    } else {
      const r = find(parsed.query, opts); food = r.food; candidates = r.candidates;
    }
    if (!food) return { ok: false, parsed, reason: parsed.query ? `No per-100 g numbers for "${parsed.query}". Enter them below.` : "Name the food, e.g. \"40 g protein of grilled chicken\".", candidates };
    const grams = gramsFor(food, parsed.macro, parsed.amount);
    if (grams === null) return { ok: false, parsed, food, reason: `${food.name} has no ${MACROS[parsed.macro]}. Pick another food or another macro.`, candidates };
    const item = scale(food, grams);
    let note = "";
    if (parsed.macro !== "g" && grams > 600) note = `That is ${grams} g. Check the number or split it over two meals.`;
    return { ok: true, parsed, food, grams, item, note, candidates };
  }

  /** One line for a result, e.g. "129 g Grilled chicken breast = 213 kcal · 40 P · 0 C · 4.6 F". */
  function summary(res) {
    if (!res || !res.ok) return res && res.reason || "";
    const it = res.item;
    return `${it.grams} g ${res.food.name} = ${it.kcal} kcal · ${it.p} P · ${it.c} C · ${it.f} F`;
  }

  // ---- card (state lives here so the app's re-renders keep it) ----
  const SLOTS = ["Meal 1", "Meal 2", "Snack", "Breakfast", "Extra"];
  const S = { text: "", res: null, slot: "", eaten: false, custom: null, forDate: null };
  let O = null;

  function recompute() {
    S.res = S.text.trim() ? solve(S.text, { custom: S.custom }) : null;
    if (S.res && !S.res.ok && !S.custom && S.res.parsed && S.res.parsed.query && !S.res.candidates.length) S.custom = { name: S.res.parsed.query, kcal: "", p: "", c: "", f: "" };
    if (S.res && S.res.ok && !S.res.food.custom) S.custom = null;
  }

  function bind(root, opts) {
    O = opts;
    root.addEventListener("click", e => {
      const b = e.target.closest("[data-mt]"); if (!b) return;
      const a = b.dataset.mt;
      if (a === "go") { recompute(); O.render(); }
      else if (a === "pick") { const fd = FOODS.find(x => x.id === b.dataset.id); if (fd && S.res && S.res.parsed) { S.custom = null; S.res = solve(S.text, { foods: [fd] }); O.render(); } }
      else if (a === "add") {
        if (!S.res || !S.res.ok) return;
        const date = O.date();
        O.onAdd(date, [{ ...S.res.item, slot: S.slot || SLOTS[0], eaten: S.eaten }]);
        S.text = ""; S.res = null; S.custom = null; S.eaten = false;
        O.render();
      }
      else if (a === "clear") { S.text = ""; S.res = null; S.custom = null; O.render(); }
    });
    root.addEventListener("input", e => {
      const t = e.target;
      if (t.id === "mtText") { S.text = t.value; return; }
      const k = t.dataset && t.dataset.mtc;
      if (k) { S.custom = S.custom || { name: "", kcal: "", p: "", c: "", f: "" }; S.custom[k] = t.value; }
    });
    root.addEventListener("change", e => {
      const t = e.target;
      if (t.id === "mtSlot") S.slot = t.value;
      else if (t.id === "mtEaten") S.eaten = t.checked;
    });
    root.addEventListener("submit", e => {
      if (e.target.dataset && e.target.dataset.form === "macro-target") { e.preventDefault(); recompute(); O.render(); }
    });
  }

  function html(date) {
    if (S.forDate !== date) { S.forDate = date; S.slot = ""; }
    const res = S.res;
    return `<div class="card mt">
    <div class="spread"><h3>Log by target macro</h3><span class="muted" style="font-size:.85rem">Grams worked out for you</span></div>
    <form data-form="macro-target" class="row" style="flex-wrap:nowrap">
      <input type="text" id="mtText" value="${esc(S.text)}" placeholder='e.g. "40 g protein of grilled chicken" or "300 kcal rice"' aria-label="Target macro and food" style="flex:1;min-width:10em" enterkeyhint="go">
      <button class="btn" type="submit" data-mt="go">Work out</button>
    </form>
    ${res && res.ok ? `<p class="num" style="margin:0"><b>${esc(summary(res))}</b></p>
      ${res.note ? `<p class="note">${esc(res.note)}</p>` : ""}
      ${res.candidates.length > 1 ? `<div class="row mt-alt"><span class="muted" style="font-size:.85rem">Not it?</span>${res.candidates.filter(c => c.id !== res.food.id).slice(0, 3).map(c => `<button class="chip" data-mt="pick" data-id="${esc(c.id)}">${esc(c.name)}</button>`).join("")}</div>` : ""}
      <div class="row">
        <select id="mtSlot" aria-label="Slot">${SLOTS.map(s => `<option ${s === (S.slot || SLOTS[0]) ? "selected" : ""}>${s}</option>`).join("")}</select>
        <label class="row" style="font-size:.9rem;gap:6px"><input type="checkbox" id="mtEaten" ${S.eaten ? "checked" : ""}> Eaten</label>
        <button class="btn" data-mt="add">Add</button><button class="btn ghost small" data-mt="clear">Clear</button>
      </div>
      <p class="muted" style="font-size:.82rem;margin:0">${res.food.custom ? "Uses the per-100 g numbers you entered." : "Typical per-100 g values, saved as an estimate. Label numbers beat these when you have them."}</p>`
    : res ? `<p class="note">${esc(res.reason)}</p>
      ${res.candidates.length ? `<div class="row mt-alt">${res.candidates.map(c => `<button class="chip" data-mt="pick" data-id="${esc(c.id)}">${esc(c.name)}</button>`).join("")}</div>` : ""}
      ${S.custom ? `<div class="mt-custom"><span class="label">Per 100 g of ${esc(S.custom.name || "this food")}</span>
        <div class="mt-mac">
          <label class="field"><span class="label">kcal</span><input type="number" inputmode="decimal" step="1" data-mtc="kcal" value="${esc(S.custom.kcal)}"></label>
          <label class="field"><span class="label">Protein</span><input type="number" inputmode="decimal" step="0.1" data-mtc="p" value="${esc(S.custom.p)}"></label>
          <label class="field"><span class="label">Carbs</span><input type="number" inputmode="decimal" step="0.1" data-mtc="c" value="${esc(S.custom.c)}"></label>
          <label class="field"><span class="label">Fat</span><input type="number" inputmode="decimal" step="0.1" data-mtc="f" value="${esc(S.custom.f)}"></label>
        </div>
        <div class="row"><button class="btn small" data-mt="go">Work out</button></div></div>` : ""}`
    : `<p class="muted" style="font-size:.85rem;margin:0">Type what you want from a food and it works out the grams: protein, carbs, fat, kcal, or a plain weight like "150 g salmon".</p>`}
  </div>`;
  }

  const css = `
.mt .mt-alt{gap:6px}
.mt .mt-custom{display:flex;flex-direction:column;gap:6px;border:1px solid var(--line);border-radius:10px;padding:10px;background:var(--surface)}
.mt .mt-mac{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}
.mt .mt-mac .field{min-width:0}
.mt .mt-mac input{width:100%;min-width:0}
`;

  return { FOODS, MACROS, parse, find, gramsFor, scale, solve, summary, html, bind, css, SLOTS };
})();
if (typeof module !== "undefined" && module.exports) module.exports = MacroTarget;
