/* Drinks + supplements for the Aziz Cut Tracker (feature 8: hydration & supplement tracker).
 * Plain JS, no imports, no network. Works on the app's own docs:
 *   days/{date}: { food:[{id,name,slot,kcal,p,c,f,eaten,est}], water, waterh:{ml}, supps:{key:bool} }
 *   prefs/main:  { drinks:{key:{...}}, suppPlan:{key:{...}} }   (both optional; defaults below)
 *
 * Rules this module keeps:
 *  - Nothing counts until Aziz taps it. A planned drink is a food row with eaten:false, so every
 *    calorie consumer in the app (macro bars, TrendTDEE, BudgetRecovery, DailyScore) skips it until
 *    it is confirmed. A supplement is only "taken" after a tap; past days with no tap say "not logged".
 *  - Drinks with calories live in day.food (slot "Drink", plus drink:{key,ml}), so they are counted
 *    once, by the code that already counts food. Hydration = water + waterh.ml + confirmed drink ml.
 *  - No invented nutrition: Gatorade and Pocari ship as label estimates (est:true, flagged until Aziz
 *    saves the numbers from his bottle). Whey has no default values; it can't be logged until the
 *    label kcal and protein are saved.
 *  - day.supps stays {key: bool}, so older code that reads it keeps working. Extra detail goes in
 *    day.suppLog {key: {at, skipped?}}.
 *
 * API (all pure; each returns a new day/prefs object, never mutates):
 *   SuppDrinks.css                                   string, inject once (uses the app's tokens)
 *   SuppDrinks.drinks(prefs) / .plan(prefs)          merged drink library / supplement schedule
 *   SuppDrinks.migrateDay(day, prefs)                tags old "Gatorade 1 L" food rows as drinks (idempotent)
 *   SuppDrinks.planDrink(day, key, prefs, {uid})     -> {day} | {error}
 *   SuppDrinks.logDrink(day, key, prefs, {uid,now})  -> {day} | {error}   (confirms a planned one first)
 *   SuppDrinks.confirmDrink(day, id, now) / unconfirmDrink(day, id) / removeDrink(day, id)
 *   SuppDrinks.takeSupp(day, key, now) / skipSupp(day, key, now) / clearSupp(day, key)
 *   SuppDrinks.drinkTotals(day)                      {kcal, p, c, f, ml, plannedKcal, plannedCount, items}
 *   SuppDrinks.totalFluid(day)                       ml: water + WaterH + confirmed drinks
 *   SuppDrinks.suppStatus(day, prefs, {date, today, now})  [{key,name,dose,time,with,state}]
 *   SuppDrinks.adherence(getDay, date, prefs, n=7)   [{key,name,taken,skipped,due}]
 *   SuppDrinks.saveDrinkLabel(prefs, key, values) / savePlan(prefs, key, values)  -> prefs | {error}
 *   SuppDrinks.html(day, prefs, {date, today, now, training})   the Today card
 *   SuppDrinks.apply(action, data, day, prefs, {uid, now})      click router -> {day?, prefs?, toast?}
 *   SuppDrinks.readForm(root, key)                   DOM helper: values of the edit form for one key
 *   SuppDrinks.summary(getDay, date, prefs)          plain text for the coach / a chat
 */
const SuppDrinks = (() => {
  // Drinks. kcal/p/c/f are per serving of `ml`. est:true = label estimate, shown as "check label".
  const DRINKS = {
    gatorade: { name: "Gatorade", ml: 1000, kcal: 240, p: 0, c: 60, f: 0, est: true, fluid: true, training: true,
      note: "Matches the app's existing Gatorade estimate. Save your bottle's label to replace it." },
    pocari: { name: "Pocari Sweat", ml: 500, kcal: 125, p: 0, c: 31, f: 0, est: true, fluid: true,
      note: "Common label value (about 25 kcal per 100 ml). Labels differ by country, so save yours." },
    whey: { name: "Whey shake", ml: 300, kcal: null, p: null, c: null, f: null, est: false, fluid: true,
      note: "Brands differ a lot. Add your scoop's kcal and protein from the tub once, then it logs in one tap." },
  };
  // Supplements, from the plan (handoff section 9) and the supplement box timing.
  const SUPPS = {
    creatine: { name: "Creatine", dose: "5 g", time: "14:00", with: "with Meal 1", on: true },
    d3: { name: "Vitamin D3", dose: "4,000 IU (2 caps)", time: "20:30", with: "with Meal 2 (needs fat)", on: true },
    omega: { name: "Omega-3", dose: "1 capsule", time: "20:30", with: "with Meal 2", on: true },
    mag: { name: "Magnesium", dose: "1 capsule", time: "22:30", with: "before bed", on: true },
  };
  const LEGACY = [{ re: /^gatorade\b/i, key: "gatorade" }, { re: /^pocari\b/i, key: "pocari" }];
  const DRINK_FIELDS = ["name", "ml", "kcal", "p", "c", "f"];

  const clone = o => JSON.parse(JSON.stringify(o == null ? {} : o));
  const num = v => { const n = typeof v === "string" ? (v.trim() === "" ? NaN : Number(v.replace(",", "."))) : v; return typeof n === "number" && isFinite(n) ? n : null; };
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const rid = () => Math.random().toString(36).slice(2, 10);
  const pad = n => String(n).padStart(2, "0");
  const localISO = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const hm = d => pad(d.getHours()) + ":" + pad(d.getMinutes());
  const isTime = s => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
  const time12 = s => { if (!isTime(s)) return ""; let [h, m] = s.split(":").map(Number); const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return h + (m ? ":" + pad(m) : "") + " " + ap; };
  const litres = ml => (Math.round(ml / 10) / 100).toFixed(2);
  const fint = n => Math.round(n).toLocaleString("en-US");
  const MS_DAY = 864e5;
  const addDays = (s, n) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d) + n * MS_DAY).toISOString().slice(0, 10); };

  function drinks(prefs) {
    const own = (prefs && prefs.drinks) || {}, out = {};
    for (const k of Object.keys(DRINKS)) out[k] = Object.assign({ key: k }, DRINKS[k], own[k] || {});
    for (const k of Object.keys(own)) if (!out[k] && own[k] && own[k].name) out[k] = Object.assign({ key: k, fluid: true, est: false }, own[k]);
    return out;
  }
  function plan(prefs) {
    const own = (prefs && prefs.suppPlan) || {}, out = {};
    for (const k of Object.keys(SUPPS)) out[k] = Object.assign({ key: k }, SUPPS[k], own[k] || {});
    for (const k of Object.keys(own)) if (!out[k] && own[k] && own[k].name) out[k] = Object.assign({ key: k, on: true, with: "" }, own[k]);
    return Object.values(out).sort((a, b) => (a.time || "99").localeCompare(b.time || "99") || a.name.localeCompare(b.name));
  }
  const ready = d => d && num(d.kcal) != null && num(d.p) != null;

  function migrateDay(day, prefs) {
    const out = clone(day);
    if (!Array.isArray(out.food)) return out;
    const lib = drinks(prefs);
    out.food = out.food.map(it => {
      if (!it || it.drink) return it;
      const hit = LEGACY.find(l => l.re.test(String(it.name || "")));
      if (!hit) return it;
      const ml = (String(it.name).match(/(\d+(?:\.\d+)?)\s*(ml|l)\b/i) || []);
      const vol = ml[1] ? Math.round(Number(ml[1]) * (/^l$/i.test(ml[2]) ? 1000 : 1)) : lib[hit.key].ml;
      return Object.assign({}, it, { slot: it.slot || "Drink", drink: { key: hit.key, ml: vol } });
    });
    return out;
  }

  function drinkRow(d, eaten, uid, now) {
    const row = { id: (uid || rid)(), name: d.name + (d.ml ? " " + (d.ml >= 1000 && d.ml % 100 === 0 ? d.ml / 1000 + " L" : d.ml + " ml") : ""),
      slot: "Drink", kcal: num(d.kcal) || 0, p: num(d.p) || 0, c: num(d.c) || 0, f: num(d.f) || 0, eaten: !!eaten, est: !!d.est,
      drink: { key: d.key, ml: d.fluid === false ? 0 : (num(d.ml) || 0) } };
    if (eaten) row.at = (now || new Date()).toISOString();
    return row;
  }
  function needLabel(d) { return { error: "needs-label", key: d.key, message: "Add the " + d.name + " label values first (kcal and protein), so nothing is guessed." }; }

  function planDrink(day, key, prefs, { uid } = {}) {
    const d = drinks(prefs)[key];
    if (!d) return { error: "unknown", message: "Unknown drink: " + key };
    if (!ready(d)) return needLabel(d);
    const out = clone(day); out.food = (out.food || []).concat(drinkRow(d, false, uid));
    return { day: out };
  }
  function logDrink(day, key, prefs, { uid, now } = {}) {
    const d = drinks(prefs)[key];
    if (!d) return { error: "unknown", message: "Unknown drink: " + key };
    const out = clone(day); out.food = out.food || [];
    const planned = out.food.find(it => it && it.drink && it.drink.key === key && !it.eaten);
    if (planned) return { day: confirmDrink(out, planned.id, now), confirmed: planned.id };
    if (!ready(d)) return needLabel(d);
    out.food.push(drinkRow(d, true, uid, now));
    return { day: out };
  }
  function edit(day, id, fn) {
    const out = clone(day);
    out.food = (out.food || []).map(it => (it && it.id === id ? fn(Object.assign({}, it)) : it)).filter(Boolean);
    return out;
  }
  const confirmDrink = (day, id, now) => edit(day, id, it => Object.assign(it, { eaten: true, at: (now || new Date()).toISOString() }));
  const unconfirmDrink = (day, id) => edit(day, id, it => { it.eaten = false; delete it.at; return it; });
  const removeDrink = (day, id) => edit(day, id, () => null);

  function drinkTotals(day) {
    const t = { kcal: 0, p: 0, c: 0, f: 0, ml: 0, plannedKcal: 0, plannedCount: 0, items: [] };
    for (const it of (day && day.food) || []) {
      if (!it || !it.drink) continue;
      t.items.push(it);
      if (it.eaten) { t.kcal += num(it.kcal) || 0; t.p += num(it.p) || 0; t.c += num(it.c) || 0; t.f += num(it.f) || 0; t.ml += num(it.drink.ml) || 0; }
      else { t.plannedKcal += num(it.kcal) || 0; t.plannedCount++; }
    }
    return t;
  }
  function totalFluid(day) {
    if (!day) return 0;
    return (num(day.water) || 0) + ((day.waterh && num(day.waterh.ml)) || 0) + drinkTotals(day).ml;
  }

  function takeSupp(day, key, now) {
    const out = clone(day); out.supps = Object.assign({}, out.supps, { [key]: true });
    out.suppLog = Object.assign({}, out.suppLog, { [key]: { at: (now || new Date()).toISOString() } });
    return out;
  }
  function skipSupp(day, key, now) {
    const out = clone(day); out.supps = Object.assign({}, out.supps, { [key]: false });
    out.suppLog = Object.assign({}, out.suppLog, { [key]: { at: (now || new Date()).toISOString(), skipped: true } });
    return out;
  }
  function clearSupp(day, key) {
    const out = clone(day); out.supps = Object.assign({}, out.supps); delete out.supps[key];
    if (out.suppLog) { out.suppLog = Object.assign({}, out.suppLog); delete out.suppLog[key]; }
    return out;
  }

  // state: taken | skipped | due (today, time passed) | later (today, not yet) | unlogged (past day, no tap) | upcoming (future day)
  function suppStatus(day, prefs, { date, today, now } = {}) {
    now = now || new Date(); today = today || localISO(now); date = date || (day && day.date) || today;
    const supps = (day && day.supps) || {}, log = (day && day.suppLog) || {};
    return plan(prefs).filter(s => s.on !== false).map(s => {
      let state;
      if (supps[s.key] === true) state = "taken";
      else if (log[s.key] && log[s.key].skipped) state = "skipped";
      else if (date < today) state = "unlogged";
      else if (date > today) state = "upcoming";
      else state = isTime(s.time) && s.time <= hm(now) ? "due" : "later";
      return { key: s.key, name: s.name, dose: s.dose, time: s.time, with: s.with, state, at: (log[s.key] && log[s.key].at) || null };
    });
  }

  function adherence(getDay, date, prefs, n = 7) {
    const rows = plan(prefs).filter(s => s.on !== false).map(s => ({ key: s.key, name: s.name, taken: 0, skipped: 0, due: n }));
    for (let i = 0; i < n; i++) {
      const day = getDay(addDays(date, -i)) || {};
      for (const r of rows) {
        if (day.supps && day.supps[r.key] === true) r.taken++;
        else if (day.suppLog && day.suppLog[r.key] && day.suppLog[r.key].skipped) r.skipped++;
      }
    }
    return rows;
  }

  function saveDrinkLabel(prefs, key, values) {
    const base = drinks(prefs)[key] || { key, fluid: true };
    const v = {};
    for (const f of DRINK_FIELDS) {
      if (values[f] === undefined) continue;
      if (f === "name") { const s = String(values.name || "").trim(); if (s) v.name = s.slice(0, 40); continue; }
      if (String(values[f]).trim() === "") { if (f === "c" || f === "f") v[f] = null; continue; } // carbs/fat optional
      const n = num(values[f]);
      if (n == null || n < 0) return { error: "invalid", message: "Enter a number for " + (f === "p" ? "protein" : f === "c" ? "carbs" : f === "f" ? "fat" : f) + "." };
      v[f] = Math.round(n * 10) / 10;
    }
    const merged = Object.assign({}, base, v);
    if (!merged.name) return { error: "invalid", message: "Give the drink a name." };
    if (num(merged.kcal) == null || num(merged.p) == null) return { error: "invalid", message: "kcal and protein are needed." };
    if (merged.kcal > 2000 || merged.ml > 3000) return { error: "invalid", message: "That serving looks too big. Check the numbers." };
    const out = clone(prefs); out.drinks = Object.assign({}, out.drinks, { [key]: Object.assign({}, (out.drinks || {})[key], v, { est: false, labelAt: new Date().toISOString() }) });
    if (!DRINKS[key]) Object.assign(out.drinks[key], { fluid: values.fluid !== false && values.fluid !== "false" });
    return out;
  }
  function savePlan(prefs, key, values) {
    const v = {};
    if (values.time !== undefined) { if (values.time !== "" && !isTime(values.time)) return { error: "invalid", message: "Time looks wrong. Use 24-hour hh:mm." }; v.time = values.time; }
    if (values.dose !== undefined) v.dose = String(values.dose).trim().slice(0, 40);
    if (values.with !== undefined) v.with = String(values.with).trim().slice(0, 40);
    if (values.name !== undefined) { const s = String(values.name).trim(); if (s) v.name = s.slice(0, 40); }
    if (values.on !== undefined) v.on = values.on === true || values.on === "true" || values.on === "on";
    if (!SUPPS[key] && !v.name && !((prefs && prefs.suppPlan) || {})[key]) return { error: "invalid", message: "Give the supplement a name." };
    const out = clone(prefs); out.suppPlan = Object.assign({}, out.suppPlan, { [key]: Object.assign({}, (out.suppPlan || {})[key], v) });
    return out;
  }

  // ---------- UI ----------
  const STATE = { taken: ["good", "Taken"], skipped: ["muted", "Skipped"], due: ["warn", "Due"], later: ["muted", "Later"], unlogged: ["muted", "Not logged"], upcoming: ["muted", "Planned"] };

  function html(day, prefs, { date, today, now, training } = {}) {
    now = now || new Date(); today = today || localISO(now); date = date || (day && day.date) || today;
    const lib = drinks(prefs), st = suppStatus(day, prefs, { date, today, now }), t = drinkTotals(day);
    const doneN = st.filter(s => s.state === "taken").length;
    const suppRows = st.map(s => {
      const [cls, label] = STATE[s.state];
      const btns = s.state === "taken" || s.state === "skipped"
        ? `<button class="chip" data-sd="clear" data-key="${esc(s.key)}">Undo</button>`
        : `<button class="chip sd-go" data-sd="take" data-key="${esc(s.key)}">Took it</button><button class="chip" data-sd="skip" data-key="${esc(s.key)}">Skip</button>`;
      return `<li class="sd-row"><span class="sd-t num">${esc(time12(s.time))}</span><span class="sd-n"><b>${esc(s.name)}</b> ${esc(s.dose)}<small>${esc(s.with || "")}</small></span><span class="sd-pill ${cls}">${label}</span><span class="sd-b">${btns}</span></li>`;
    }).join("");
    const drinkBtns = Object.values(lib).map(d => ready(d)
      ? `<button class="chip" data-sd="log" data-key="${esc(d.key)}">+ ${esc(d.name)} ${d.ml ? esc(d.ml >= 1000 ? d.ml / 1000 + " L" : d.ml + " ml") : ""}<small>${fint(d.kcal)} kcal${d.est ? " est." : ""}</small></button>`
      : `<button class="chip" data-sd="needlabel" data-key="${esc(d.key)}">+ ${esc(d.name)}<small>add label</small></button>`).join("");
    const itemRows = t.items.map(it => `<li class="sd-row sd-dr"><span class="sd-n"><b>${esc(it.name)}</b><small>${fint(it.kcal)} kcal${it.p ? " · " + fint(it.p) + " g protein" : ""}${it.est ? " · estimate, check label" : ""}</small></span><span class="sd-pill ${it.eaten ? "good" : "muted"}">${it.eaten ? "Counted" : "Planned"}</span><span class="sd-b">${it.eaten
      ? `<button class="chip" data-sd="unconfirm" data-id="${esc(it.id)}">Undo</button>`
      : `<button class="chip sd-go" data-sd="confirm" data-id="${esc(it.id)}">Drank it</button><button class="chip" data-sd="remove" data-id="${esc(it.id)}">Remove</button>`}</span></li>`).join("");
    const plannedNote = training && lib.gatorade && !t.items.some(i => i.drink.key === "gatorade")
      ? `<button class="btn ghost small" data-sd="plan" data-key="gatorade">Plan today's Gatorade</button>` : "";
    const editDrinks = Object.values(lib).map(d => `<fieldset class="sd-edit" data-sd-form="${esc(d.key)}"><legend>${esc(d.name)}${d.est ? " <small>(estimate)</small>" : ""}</legend>
      <label>ml<input name="ml" inputmode="decimal" value="${esc(d.ml ?? "")}"></label><label>kcal<input name="kcal" inputmode="decimal" value="${esc(d.kcal ?? "")}"></label>
      <label>protein g<input name="p" inputmode="decimal" value="${esc(d.p ?? "")}"></label><label>carbs g<input name="c" inputmode="decimal" value="${esc(d.c ?? "")}"></label>
      <label>fat g<input name="f" inputmode="decimal" value="${esc(d.f ?? "")}"></label><button class="btn small" data-sd="label-save" data-key="${esc(d.key)}">Save label</button>
      <small class="muted">${esc(d.note || "")}</small></fieldset>`).join("");
    const editPlan = plan(prefs).map(s => `<fieldset class="sd-edit" data-sd-form="${esc(s.key)}"><legend>${esc(s.name)}</legend>
      <label>time<input name="time" type="time" value="${esc(s.time || "")}"></label><label>dose<input name="dose" value="${esc(s.dose || "")}"></label>
      <label>with<input name="with" value="${esc(s.with || "")}"></label><label class="sd-on"><input name="on" type="checkbox" ${s.on !== false ? "checked" : ""}> on</label>
      <button class="btn small" data-sd="plan-save" data-key="${esc(s.key)}">Save</button></fieldset>`).join("");
    return `<div class="card sd-card">
  <div class="spread"><h3>Drinks &amp; supplements</h3><span class="muted">${doneN} of ${st.length} taken</span></div>
  <ul class="sd-list">${suppRows || `<li class="muted">No supplements switched on.</li>`}</ul>
  <div class="sd-sub">Drinks with calories</div>
  <div class="sd-chips">${drinkBtns}</div>
  ${itemRows ? `<ul class="sd-list">${itemRows}</ul>` : ""}${plannedNote}
  <p class="sd-tot">Counted: <b class="num">${fint(t.kcal)} kcal</b>${t.p ? ` · ${fint(t.p)} g protein` : ""} · ${litres(t.ml)} L fluid${t.plannedCount ? ` · <span class="muted">${fint(t.plannedKcal)} kcal planned, not counted until you tap Drank it</span>` : ""}</p>
  <p class="muted sd-small">Total fluids today ${litres(totalFluid(day))} L (water + WaterH + drinks). Nothing is ticked or counted for you.</p>
  <details><summary>Edit drinks and schedule</summary><div class="sd-edits">${editDrinks}${editPlan}</div></details>
</div>`;
  }

  function readForm(root, key) {
    const fs = (root || document).querySelector(`[data-sd-form="${String(key).replace(/"/g, "")}"]`);
    if (!fs) return {};
    const v = {};
    fs.querySelectorAll("input[name]").forEach(i => { v[i.name] = i.type === "checkbox" ? i.checked : i.value; });
    return v;
  }

  // data: {key?, id?, ...form values}. Returns what changed; the app saves day/prefs and shows toast.
  function apply(action, data, day, prefs, { uid, now } = {}) {
    data = data || {}; now = now || new Date();
    const k = data.key, wrap = r => (r.error ? { toast: r.message } : { day: r.day, toast: r.confirmed ? "Confirmed the planned drink. It counts now." : undefined });
    switch (action) {
      case "log": return wrap(logDrink(day, k, prefs, { uid, now }));
      case "plan": return wrap(planDrink(day, k, prefs, { uid }));
      case "needlabel": return { toast: needLabel(drinks(prefs)[k] || { name: k }).message, open: k };
      case "confirm": return { day: confirmDrink(day, data.id, now) };
      case "unconfirm": return { day: unconfirmDrink(day, data.id) };
      case "remove": return { day: removeDrink(day, data.id) };
      case "take": return { day: takeSupp(day, k, now) };
      case "skip": return { day: skipSupp(day, k, now) };
      case "clear": return { day: clearSupp(day, k) };
      case "label-save": { const p = saveDrinkLabel(prefs, k, data); return p.error ? { toast: p.message } : { prefs: p, toast: "Saved. Logging uses your label from now on." }; }
      case "plan-save": { const p = savePlan(prefs, k, data); return p.error ? { toast: p.message } : { prefs: p, toast: "Schedule saved." }; }
      default: return {};
    }
  }

  function summary(getDay, date, prefs) {
    const day = getDay(date) || {}, t = drinkTotals(day), adh = adherence(getDay, date, prefs, 7);
    const lines = [`Drinks ${date}: ${fint(t.kcal)} kcal counted, ${litres(totalFluid(day))} L total fluids` + (t.plannedCount ? `, ${t.plannedCount} planned drink(s) not confirmed` : "")];
    lines.push("Supplements, last 7 days (taps only, untapped days are unknown, not missed): " + adh.map(a => `${a.name} ${a.taken}/7`).join(", "));
    return lines.join("\n");
  }

  const css = [
    ".sd-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}",
    ".sd-row{display:grid;grid-template-columns:auto 1fr auto;grid-template-areas:'t n p' 'b b b';gap:4px 10px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line)}",
    ".sd-row:last-child{border-bottom:0}.sd-t{grid-area:t;font-family:var(--mono);font-size:.85rem;color:var(--muted);min-width:4.2em}",
    ".sd-n{grid-area:n;min-width:0}.sd-n small{display:block;color:var(--muted);font-size:.8rem}.sd-dr{grid-template-areas:'n n p' 'b b b'}",
    ".sd-b{grid-area:b;display:flex;gap:6px;flex-wrap:wrap}.sd-pill{grid-area:p;border-radius:999px;padding:2px 10px;font-size:.75rem;font-weight:600;border:1px solid currentColor;white-space:nowrap}",
    ".sd-pill.good{color:var(--good)}.sd-pill.warn{color:var(--warn)}.sd-pill.muted{color:var(--muted)}",
    ".sd-chips{display:flex;flex-wrap:wrap;gap:6px}.sd-chips .chip small{margin-left:6px;color:var(--muted);font-size:.75rem}",
    ".sd-go{border-color:var(--accent)}.sd-sub{font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}",
    ".sd-tot{margin:0}.sd-small{font-size:.82rem;margin:0}",
    ".sd-edits{display:flex;flex-direction:column;gap:10px;margin-top:8px}",
    ".sd-edit{border:1px solid var(--line);border-radius:8px;padding:8px 10px;display:flex;flex-wrap:wrap;gap:8px;align-items:end;margin:0}",
    ".sd-edit legend{font-weight:600;padding:0 4px}.sd-edit label{display:flex;flex-direction:column;font-size:.75rem;color:var(--muted);gap:2px}",
    ".sd-edit input:not([type=checkbox]){width:5.5em;border:1px solid var(--line);background:var(--sunk);color:var(--ink);border-radius:6px;padding:4px 6px;font:inherit;font-size:.9rem}",
    ".sd-edit input[name=dose],.sd-edit input[name=with]{width:9em}.sd-edit .sd-on{flex-direction:row;align-items:center;gap:4px}.sd-edit small{flex-basis:100%}",
  ].join("\n");

  return { css, DRINKS, SUPPS, drinks, plan, migrateDay, planDrink, logDrink, confirmDrink, unconfirmDrink, removeDrink,
    takeSupp, skipSupp, clearSupp, drinkTotals, totalFluid, suppStatus, adherence, saveDrinkLabel, savePlan, html, readForm, apply, summary };
})();
if (typeof module !== "undefined" && module.exports) module.exports = SuppDrinks;
