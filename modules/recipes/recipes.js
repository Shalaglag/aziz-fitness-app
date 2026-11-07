/* Personal recipes for Mizan (Recipes): a real recipe is editable ingredients with amounts, servings and an
 * optional finished batch weight; its nutrition is the sum of the ingredients (numbers copied when each one is
 * added, so a later change to a source never rewrites it). A general database entry ("chicken with rice") is
 * not a recipe and never pretends to have an ingredient breakdown.
 *
 * Data: recipes/{id} = { id, name, servings, batchG|null, notes, ingredients:[ing], created, updated }
 *   ing = { id, name, recId, amountText, qty: {g|ml|servings}, base: {qty, nutrients}, nutrients:{kcal,p,c,f}, unknown:[], est }
 *   base = the amount and numbers the ingredient was added with; changing the amount rescales linearly from it.
 *
 * Portions: by servings (totals / servings) or by weight when batchG is known (totals / batchG × g). The finished
 * weight is never guessed from the raw ingredient weights (water added or lost in cooking matters).
 *
 * API: create, fromRows, addIngredient(rec, row|record+scaled), setAmount, removeIngredient, setServings, setBatch,
 *      totals, perServing, perGram, toRecord (a FoodLib record), validate, listHtml, mountEditor(host, opts), CSS
 */
const Recipes = (() => {
  const FL = typeof FoodLib !== "undefined" ? FoodLib : (typeof require === "function" ? require("../food-library/food-library.js") : null);
  const FS = () => typeof FoodSearch !== "undefined" ? FoodSearch : null;
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const r1 = n => Math.round(n * 10) / 10;
  const num = v => { if (v == null || v === "") return null; const n = typeof v === "string" ? parseFloat(v.replace(",", ".")) : +v; return isFinite(n) && n >= 0 ? n : null; };
  const uid = () => Math.random().toString(36).slice(2, 9);
  const MACROS = ["kcal", "p", "c", "f"];
  const slug = s => String(s || "").toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "recipe";

  function create({ name = "", servings = 1, batchG = null, notes = "", id, existing } = {}) {
    let base = id || slug(name), rid = base, n = 2; while (existing && existing[rid]) rid = base + "-" + n++;
    const now = new Date().toISOString();
    return { id: rid, name: String(name).trim().slice(0, 80), servings: num(servings) > 0 ? num(servings) : 1, batchG: num(batchG) > 0 ? num(batchG) : null, notes: String(notes || "").slice(0, 500), ingredients: [], created: now, updated: now };
  }
  // A logged meal (rows of days/{date}.food) becomes a recipe: each row is one ingredient with the numbers it was logged with.
  function fromRows(rows, { name, existing, servings = 1 } = {}) {
    const keep = (rows || []).filter(r => r && (num(r.kcal) || num(r.p) || num(r.c) || num(r.f)));
    if (!keep.length) return null;
    const rc = create({ name: name || keep.slice(0, 2).map(r => String(r.name).split(" · ")[0]).join(" + "), servings, existing });
    for (const r of keep) rc.ingredients.push(ingFromRow(r));
    return rc;
  }
  function ingFromRow(r) {
    const qty = r.grams > 0 ? { g: r.grams } : r.ml > 0 ? { ml: r.ml } : { servings: 1 };
    const nutrients = { kcal: num(r.kcal) || 0, p: num(r.p) || 0, c: num(r.c) || 0, f: num(r.f) || 0 };
    const unknown = (r.src && r.src.unknown) || [];
    return { id: uid(), name: String(r.name || "Ingredient").split(" · ")[0].slice(0, 60), recId: (r.src && r.src.id) || null, amountText: qtyText(qty), qty, base: { qty, nutrients: Object.assign({}, nutrients) }, nutrients, unknown, est: !!r.est };
  }
  // From the food search review step: a FoodLib record + its scaled amount.
  function ingFromRecord(rec, sc) {
    const qty = sc.g != null ? { g: sc.g } : sc.ml != null ? { ml: sc.ml } : { servings: sc.servings || 1 };
    const nutrients = { kcal: sc.nutrients.kcal || 0, p: sc.nutrients.p || 0, c: sc.nutrients.c || 0, f: sc.nutrients.f || 0 };
    return { id: uid(), name: rec.name.slice(0, 60), recId: rec.id, amountText: sc.amountText, qty, base: { qty, nutrients: Object.assign({}, nutrients) }, nutrients, unknown: sc.unknown || [], est: rec.grade === "estimate" || (sc.unknown || []).length > 0 };
  }
  const qtyText = q => q.g != null ? q.g + " g" : q.ml != null ? q.ml + " ml" : q.servings + (q.servings === 1 ? " serving" : " servings");
  const qtyKey = q => q.g != null ? "g" : q.ml != null ? "ml" : "servings";
  function addIngredient(rc, ing) { const out = clone(rc); out.ingredients = out.ingredients.concat([ing]); return touch(out); }
  function removeIngredient(rc, ingId) { const out = clone(rc); out.ingredients = out.ingredients.filter(i => i.id !== ingId); return touch(out); }
  // New amount in the same unit the ingredient was added with (grams stay grams); numbers scale linearly from the base.
  function setAmount(rc, ingId, text) {
    const out = clone(rc), ing = out.ingredients.find(i => i.id === ingId); if (!ing) return rc;
    const m = /^([\d.,]+)\s*(g|gram|grams|ml|serving|servings|x)?\s*$/i.exec(String(text || "").trim()); if (!m) return rc;
    const v = num(m[1]); if (v == null) return rc;
    const k = qtyKey(ing.base.qty), unit = (m[2] || "").toLowerCase();
    if (unit && !((k === "g" && /^g/.test(unit)) || (k === "ml" && unit === "ml") || (k === "servings" && /serving|x/.test(unit)))) return rc; // no unit swaps
    const factor = v / (ing.base.qty[k] || 1);
    ing.qty = { [k]: v }; ing.amountText = qtyText(ing.qty);
    ing.nutrients = { kcal: Math.round(ing.base.nutrients.kcal * factor), p: r1(ing.base.nutrients.p * factor), c: r1(ing.base.nutrients.c * factor), f: r1(ing.base.nutrients.f * factor) };
    return touch(out);
  }
  function setServings(rc, n) { const out = clone(rc); const v = num(n); if (!(v > 0)) return rc; out.servings = v; return touch(out); }
  function setBatch(rc, g) { const out = clone(rc); const v = num(g); out.batchG = v > 0 ? v : null; return touch(out); }
  function rename(rc, name) { const out = clone(rc); out.name = String(name || "").trim().slice(0, 80); return touch(out); }
  function setNotes(rc, t) { const out = clone(rc); out.notes = String(t || "").slice(0, 500); return touch(out); }
  const touch = rc => { rc.updated = new Date().toISOString(); return rc; };
  const clone = o => JSON.parse(JSON.stringify(o));

  function totals(rc) {
    const t = { kcal: 0, p: 0, c: 0, f: 0 }, unknown = new Set(); let est = false;
    for (const i of rc.ingredients || []) { for (const k of MACROS) t[k] += +i.nutrients[k] || 0; for (const u of i.unknown || []) unknown.add(u); if (i.est) est = true; }
    return { kcal: Math.round(t.kcal), p: r1(t.p), c: r1(t.c), f: r1(t.f), unknown: [...unknown], est: est || unknown.size > 0, count: (rc.ingredients || []).length };
  }
  function perServing(rc) { const t = totals(rc), n = rc.servings > 0 ? rc.servings : 1; return { kcal: Math.round(t.kcal / n), p: r1(t.p / n), c: r1(t.c / n), f: r1(t.f / n), g: rc.batchG ? Math.round(rc.batchG / n) : null }; }
  // Per gram of the finished dish, only when the finished weight was weighed. 2,400 kcal / 1,000 g × 250 g = 600 kcal.
  function perGram(rc) { if (!(rc.batchG > 0)) return null; const t = totals(rc); return { kcal: t.kcal / rc.batchG, p: t.p / rc.batchG, c: t.c / rc.batchG, f: t.f / rc.batchG }; }
  function toRecord(rc) {
    if (!FL || !rc) return null;
    const t = totals(rc);
    return FL.fromRecipe({ id: rc.id, name: rc.name || "Recipe", servings: rc.servings, batchG: rc.batchG, totals: t, ingredients: rc.ingredients, estimated: t.est });
  }
  function validate(rc) {
    const problems = [];
    if (!rc.name || !rc.name.trim()) problems.push("Give the recipe a name.");
    if (!rc.ingredients.length) problems.push("Add at least one ingredient.");
    if (!(rc.servings > 0)) problems.push("Servings must be at least 1.");
    if (rc.batchG != null && !(rc.batchG > 0)) problems.push("Batch weight must be a weight in grams, or empty.");
    return problems;
  }

  // ---------- list card (Saved tab) ----------
  function listHtml(recipes, { onlyCount } = {}) {
    const list = Object.values(recipes || {}).sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
    if (onlyCount) return String(list.length);
    return `<div class="card rc-card"><div class="spread"><h3>Your recipes</h3><button class="btn small" data-act="rc-new">New recipe</button></div>
      <p class="muted" style="font-size:.82rem;margin:4px 0 8px">Real ingredients you can edit. Log by servings, or by weight once you weigh the finished dish. "Save day as recipe" turns today's logged food into one.</p>
      ${list.length ? `<ul class="rc-list">${list.map(rc => { const ps = perServing(rc), t = totals(rc); return `<li><button type="button" class="rc-item" data-act="rc-log" data-id="${esc(rc.id)}"><span class="rc-nm">${esc(rc.name)}<small>${t.count} ingredient${t.count === 1 ? "" : "s"} · ${rc.servings} serving${rc.servings === 1 ? "" : "s"}${rc.batchG ? " · " + rc.batchG + " g batch" : ""}${t.est ? " · estimate" : ""}</small></span><span class="rc-kc"><b>${ps.kcal}</b><small>per serving · P ${ps.p} · C ${ps.c} · F ${ps.f}</small></span></button><button type="button" class="iconbtn rc-edit" data-act="rc-edit" data-id="${esc(rc.id)}" aria-label="Edit ${esc(rc.name)}">✎</button></li>`; }).join("")}</ul>` : `<p class="muted" style="font-size:.85rem">No recipes yet.</p>`}
      <div class="row" style="margin-top:8px"><button class="btn ghost small" data-act="rc-fromday">Save day as recipe</button></div></div>`;
  }

  // ---------- editor (owns its DOM inside a host) ----------
  let E = null; // { rc, host, opts, tab: "ings"|"add" }
  function mountEditor(host, opts) {
    if (!host) return;
    E = { rc: clone(opts.recipe), host, opts, tab: opts.recipe.ingredients.length ? "ings" : "add", problems: [] };
    if (!host.dataset.rcBound) { host.dataset.rcBound = "1"; host.addEventListener("click", onClick); host.addEventListener("input", onInput); host.addEventListener("change", onInput); host.addEventListener("submit", e => { e.preventDefault(); save(); }); }
    draw();
  }
  function onInput(e) {
    if (!E) return; const t = e.target;
    if (t.id === "rcName") E.rc = rename(E.rc, t.value);
    else if (t.id === "rcServ") { E.rc = setServings(E.rc, t.value); drawTotals(); }
    else if (t.id === "rcBatch") { E.rc = setBatch(E.rc, t.value); drawTotals(); }
    else if (t.id === "rcNotes") E.rc = setNotes(E.rc, t.value);
    else if (t.dataset.rcAmt && e.type === "change") { E.rc = setAmount(E.rc, t.dataset.rcAmt, t.value); draw(); }
  }
  function onClick(e) {
    const b = e.target.closest("[data-rc]"); if (!b || !E) return;
    const a = b.dataset.rc;
    if (a === "tab") { E.tab = b.dataset.k; draw(); }
    else if (a === "del") { E.rc = removeIngredient(E.rc, b.dataset.id); draw(); }
    else if (a === "save") save();
    else if (a === "cancel") E.opts.onCancel && E.opts.onCancel();
    else if (a === "delete") { if (b.dataset.confirm) E.opts.onDelete && E.opts.onDelete(E.rc.id); else { b.dataset.confirm = "1"; b.textContent = "Delete recipe?"; } }
  }
  function save() { E.problems = validate(E.rc); if (E.problems.length) { draw(); return; } E.opts.onSave && E.opts.onSave(E.rc); }
  function draw() {
    if (!E) return;
    const rc = E.rc, t = totals(rc), ps = perServing(rc), pg = perGram(rc);
    E.host.innerHTML = `<form class="rc-ed" autocomplete="off">
      <label class="field"><span class="label">Recipe name</span><input type="text" id="rcName" value="${esc(rc.name)}" placeholder="Aziz's machboos" required></label>
      <div class="rc-two"><label class="field"><span class="label">Servings</span><input type="number" id="rcServ" inputmode="decimal" min="0.5" step="0.5" value="${esc(rc.servings)}"></label>
        <label class="field"><span class="label">Finished batch weight (g, optional)</span><input type="number" id="rcBatch" inputmode="numeric" min="1" value="${rc.batchG != null ? esc(rc.batchG) : ""}" placeholder="weigh the cooked dish"></label></div>
      <div class="subnav rc-tabs"><button type="button" data-rc="tab" data-k="ings" aria-pressed="${E.tab === "ings"}">Ingredients (${t.count})</button><button type="button" data-rc="tab" data-k="add" aria-pressed="${E.tab === "add"}">Add ingredient</button></div>
      ${E.tab === "ings" ? ingsHtml(rc) : `<div id="rcSearchHost"></div>`}
      <div id="rcTotals">${totalsHtml(t, ps, pg, rc)}</div>
      <label class="field"><span class="label">Preparation notes (optional)</span><textarea id="rcNotes" rows="2" placeholder="Oil used, cooking method, what changes">${esc(rc.notes || "")}</textarea></label>
      ${E.problems.length ? `<p class="rc-bad">${E.problems.map(esc).join(" ")}</p>` : ""}
      <div class="rc-acts"><button type="button" class="btn ghost small" data-rc="cancel">Cancel</button>${E.opts.canDelete ? `<button type="button" class="btn ghost small rc-delbtn" data-rc="delete">Delete</button>` : ""}<button type="submit" class="btn" data-rc="save">Save recipe</button></div></form>`;
    if (E.tab === "add") mountSearch();
  }
  function drawTotals() { const el = E.host.querySelector("#rcTotals"); if (el) el.innerHTML = totalsHtml(totals(E.rc), perServing(E.rc), perGram(E.rc), E.rc); }
  function ingsHtml(rc) {
    if (!rc.ingredients.length) return `<p class="muted" style="font-size:.85rem;margin:0">No ingredients yet. Use "Add ingredient" to search foods, your products or typical values.</p>`;
    return `<ul class="rc-ings">${rc.ingredients.map(i => { const k = qtyKey(i.base.qty); return `<li><span class="rc-nm">${esc(i.name)}<small>${i.nutrients.kcal} kcal · P ${i.nutrients.p} · C ${i.nutrients.c} · F ${i.nutrients.f}${i.unknown && i.unknown.length ? " · " + i.unknown.join(", ") + " unknown" : ""}${i.est ? " · estimate" : ""}</small></span>
      <label class="rc-amt"><input type="text" inputmode="decimal" data-rc-amt="${esc(i.id)}" value="${esc(i.qty[k])}" aria-label="Amount of ${esc(i.name)}"><span>${k}</span></label><button type="button" class="iconbtn" data-rc="del" data-id="${esc(i.id)}" aria-label="Remove ${esc(i.name)}">✕</button></li>`; }).join("")}</ul>`;
  }
  function totalsHtml(t, ps, pg, rc) {
    return `<div class="rc-tot"><div><span class="label">Whole recipe</span><b>${t.kcal} kcal</b><small>P ${t.p} · C ${t.c} · F ${t.f}</small></div>
      <div><span class="label">Per serving (÷${rc.servings})</span><b>${ps.kcal} kcal</b><small>P ${ps.p} · C ${ps.c} · F ${ps.f}${ps.g ? " · " + ps.g + " g" : ""}</small></div>
      <div><span class="label">Per 100 g cooked</span>${pg ? `<b>${Math.round(pg.kcal * 100)} kcal</b><small>P ${r1(pg.p * 100)} · C ${r1(pg.c * 100)} · F ${r1(pg.f * 100)}</small>` : `<small>Weigh the finished dish and enter the batch weight to log by grams.</small>`}</div></div>
      ${t.unknown.length ? `<p class="muted" style="font-size:.8rem;margin:4px 0 0">${t.unknown.join(", ")} missing for some ingredients: the total is a lower bound and logs as an estimate.</p>` : ""}`;
  }
  function mountSearch() {
    const fs = FS(), host = E.host.querySelector("#rcSearchHost"); if (!fs || !host) { if (host) host.innerHTML = `<p class="muted">Food search isn't available here.</p>`; return; }
    fs.reset();
    fs.mount(host, Object.assign({}, E.opts.search || {}, { slot: "Ingredient", slots: ["Ingredient"], eatenDefault: false, addLabel: "Add to recipe", hideSlot: true,
      onAdd: null, onPick: (rec, sc) => { E.rc = addIngredient(E.rc, ingFromRecord(rec, sc)); E.tab = "ings"; draw(); if (E.opts.toast) E.opts.toast("Added " + rec.name + " to the recipe"); } }));
  }
  const CSS = `
.rc-card .rc-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}.rc-list li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px;align-items:center}
.rc-item{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;width:100%;text-align:left;padding:10px 12px;border-radius:12px;border:1px solid var(--card-line,var(--line));background:var(--surface);box-shadow:var(--shadow-card);color:var(--fg);font:inherit;cursor:pointer}
.rc-nm{display:flex;flex-direction:column;min-width:0}.rc-nm small{color:var(--fg-muted);font-size:.74rem;margin-top:2px}
.rc-kc{text-align:right;line-height:1.1}.rc-kc b{font-size:1.05rem}.rc-kc small{display:block;color:var(--fg-muted);font-size:.7rem;margin-top:3px;white-space:nowrap}
.rc-ed{display:flex;flex-direction:column;gap:10px}.rc-two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px}.rc-ed .field input,.rc-ed textarea{width:100%;box-sizing:border-box;padding:10px;border-radius:10px;border:1px solid var(--line);background:var(--surface);color:var(--fg);font:inherit}
.rc-tabs{margin:0}
.rc-ings{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}.rc-ings li{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:8px;align-items:center;padding:8px 10px;border-radius:10px;background:var(--surface-2,var(--sunk))}
.rc-amt{display:flex;align-items:center;gap:4px;font-size:.8rem;color:var(--fg-muted)}.rc-amt input{width:64px;padding:6px;border-radius:8px;border:1px solid var(--line);background:var(--surface);color:var(--fg);text-align:right;font:inherit}
.rc-tot{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.rc-tot div{background:var(--surface-2,var(--sunk));border-radius:10px;padding:8px;display:flex;flex-direction:column;gap:2px;min-width:0}.rc-tot .label{font-size:.7rem;color:var(--fg-muted)}.rc-tot b{font-size:.95rem}.rc-tot small{color:var(--fg-muted);font-size:.7rem;overflow-wrap:anywhere}
.rc-bad{color:var(--bad);font-size:.85rem;margin:0}.rc-acts{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}.rc-delbtn{margin-right:auto;color:var(--bad)}
`;
  return { create, fromRows, ingFromRow, ingFromRecord, addIngredient, removeIngredient, setAmount, setServings, setBatch, rename, setNotes, totals, perServing, perGram, toRecord, validate, listHtml, mountEditor, CSS, _editor: () => E };
})();
if (typeof module !== "undefined" && module.exports) module.exports = Recipes;
