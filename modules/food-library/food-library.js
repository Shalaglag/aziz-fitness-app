/* Food library for Mizan: one record shape for every food source, portion maths without AI, and a ranked
 * search across the sources. Plain JS, no imports, no network of its own (the two remote searches take an
 * injected fetch). Browser global `FoodLib`, or CommonJS.
 *
 * Record (what every source is turned into):
 *   { id: "usda:169756" | "off:<barcode>" | "lib:<code>" | "rest:mcd-kw:big-mac" | "cat:<slug>" | "recipe:<id>",
 *     kind: "food" | "meal" | "recipe",
 *     name, brand, restaurant, market ("KW","US",…) | null, prep: "raw" | "cooked" | "as-sold" | null,
 *     basis: { kind: "per100g" | "per100ml" | "serving", amount, unit: "g" | "ml", label },
 *     nutrients: { kcal, p, c, f, fiber, sugar, sodium }      numbers, or null when the source has no value
 *     derived: ["kcal"]                                       kcal was calculated from the macros (never silently)
 *     portions: [{ label, g }] or [{ label, ml }]             only when the source gives a real conversion
 *     includes: ["Medium fries", "Medium drink"]             restaurant meals: what is in the box
 *     source: { kind: "usda"|"off"|"label"|"manual"|"restaurant"|"catalog"|"recipe"|"estimate", id, url, dataType,
 *               retrievedAt, publishedAt, note },
 *     grade: "source" | "user" | "reviewed" | "estimate" }   source-backed, user-entered, reviewed, or an estimate
 *
 * Portion maths: FoodLib.scale(rec, amount) with amount = {g} | {ml} | {servings} | {portion: label|index, count}.
 *   Scales each nutrient linearly from the record's basis; unknown nutrients stay null and are listed in `unknown`.
 *   Published kcal is kept, never replaced by 4P+4C+9F. 200 kcal per 100 g × 150 g = 300 kcal.
 *
 * API: fromUsda, fromOff, fromLibrary, fromRestaurant, fromCatalog, fromRecipe, scale, toRow, search, sourceLine,
 *      gradeLabel, prepOf, parseAmount, cache(storage, ttlMs), usdaSearch, offSearch, defaultAmount, restaurantRecords.
 */
const FoodLib = (() => {
  const r1 = n => Math.round(n * 10) / 10;
  const num = v => { if (v == null || v === "") return null; const n = typeof v === "string" ? parseFloat(v.replace(",", ".")) : +v; return isFinite(n) ? n : null; };
  const pos = v => { const n = num(v); return n != null && n >= 0 ? n : null; };
  const clean = (s, n = 120) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);
  const slug = s => clean(s, 80).toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, "-").replace(/^-|-$/g, "");
  const NUTR = ["kcal", "p", "c", "f", "fiber", "sugar", "sodium"];
  const MACROS = ["kcal", "p", "c", "f"];

  // ---------- helpers shared by the normalisers ----------
  function prepOf(name) {
    const s = String(name || "").toLowerCase();
    if (/\braw\b|uncooked|\bdry\b|\bdried\b/.test(s) && !/cooked/.test(s)) return "raw";
    if (/cooked|roasted|boiled|grilled|fried|baked|braised|steamed|stewed|broiled|poached|microwaved|simmered/.test(s)) return "cooked";
    return null;
  }
  function withDerivedKcal(n) {
    const out = Object.assign({}, n), derived = [];
    if (out.kcal == null && out.p != null && out.c != null && out.f != null) { out.kcal = Math.round(4 * out.p + 4 * out.c + 9 * out.f); derived.push("kcal"); }
    return { nutrients: out, derived };
  }
  const emptyNutr = () => ({ kcal: null, p: null, c: null, f: null, fiber: null, sugar: null, sodium: null });
  function record(o) {
    const { nutrients, derived } = withDerivedKcal(Object.assign(emptyNutr(), o.nutrients || {}));
    return {
      id: o.id, kind: o.kind || "food", name: clean(o.name) || "Food", brand: clean(o.brand) || null, restaurant: clean(o.restaurant) || null,
      market: o.market || null, prep: o.prep === undefined ? prepOf(o.name) : o.prep,
      basis: o.basis || { kind: "per100g", amount: 100, unit: "g", label: "100 g" },
      nutrients, derived: (o.derived || []).concat(derived), portions: (o.portions || []).filter(p => p && p.label && ((p.g > 0) || (p.ml > 0))).slice(0, 12),
      includes: o.includes || [], source: o.source || { kind: "estimate" }, grade: o.grade || "estimate",
    };
  }

  // ---------- USDA FoodData Central (search hit, per 100 g; nutrientNumber codes) ----------
  const FDC_NUM = { "208": "kcal", "203": "p", "205": "c", "204": "f", "291": "fiber", "269": "sugar", "307": "sodium" };
  function fromUsda(hit, { retrievedAt } = {}) {
    if (!hit || !hit.fdcId) return null;
    const n = emptyNutr(); let kcalAlt = null;
    for (const fn of hit.foodNutrients || []) {
      const code = String(fn.nutrientNumber || fn.number || (fn.nutrient && fn.nutrient.number) || "");
      const v = pos(fn.value != null ? fn.value : fn.amount);
      if (v == null) continue;
      const key = FDC_NUM[code];
      if (key) { if (key === "kcal" && String(fn.unitName || "").toUpperCase() === "KJ") continue; if (n[key] == null) n[key] = key === "kcal" ? Math.round(v) : r1(v); }
      else if ((code === "957" || code === "958") && kcalAlt == null) kcalAlt = Math.round(v); // Atwater energy on Foundation foods
    }
    if (n.kcal == null && kcalAlt != null) n.kcal = kcalAlt;
    const portions = [];
    if (hit.dataType === "Branded" && hit.servingSize > 0 && /^g$|^gm$|^grm$/i.test(hit.servingSizeUnit || "")) portions.push({ label: clean(hit.householdServingFullText) || "1 serving", g: r1(hit.servingSize) });
    if (hit.dataType === "Branded" && hit.servingSize > 0 && /^ml$/i.test(hit.servingSizeUnit || "")) portions.push({ label: clean(hit.householdServingFullText) || "1 serving", ml: r1(hit.servingSize) });
    for (const fp of hit.foodPortions || []) { if (fp && fp.gramWeight > 0) portions.push({ label: clean(fp.portionDescription || fp.modifier || ((fp.amount || 1) + " " + ((fp.measureUnit && fp.measureUnit.name) || "portion"))), g: r1(fp.gramWeight) }); }
    const liquid = /^(beverages|dairy)/i.test(hit.foodCategory || "") && /milk|juice|drink|beverage|soda|cola|water|tea|coffee/i.test(hit.description || "") && portions.some(p => p.ml);
    return record({
      id: "usda:" + hit.fdcId, name: hit.description, brand: hit.brandOwner || hit.brandName || null, market: hit.dataType === "Branded" ? "US" : null,
      basis: liquid ? { kind: "per100ml", amount: 100, unit: "ml", label: "100 ml" } : { kind: "per100g", amount: 100, unit: "g", label: "100 g" },
      nutrients: n, portions,
      source: { kind: "usda", id: String(hit.fdcId), dataType: hit.dataType || null, url: "https://fdc.nal.usda.gov/food-details/" + hit.fdcId + "/nutrients", publishedAt: hit.publishedDate || hit.publicationDate || null, retrievedAt: retrievedAt || null },
      grade: "source",
    });
  }

  // ---------- Open Food Facts product (per 100 g/ml) ----------
  function fromOff(prod, code, { retrievedAt } = {}) {
    if (!prod) return null;
    const nt = prod.nutriments || {}, n = emptyNutr();
    let kcal = pos(nt["energy-kcal_100g"]); const derived = [];
    if (kcal == null && pos(nt["energy-kj_100g"]) != null) { kcal = Math.round(pos(nt["energy-kj_100g"]) / 4.184); derived.push("kcal"); }
    if (kcal == null && pos(nt.energy_100g) != null && String(nt.energy_unit || "").toLowerCase() === "kcal") kcal = pos(nt.energy_100g);
    n.kcal = kcal != null ? Math.round(kcal) : null;
    n.p = pos(nt.proteins_100g) != null ? r1(pos(nt.proteins_100g)) : null; n.c = pos(nt.carbohydrates_100g) != null ? r1(pos(nt.carbohydrates_100g)) : null; n.f = pos(nt.fat_100g) != null ? r1(pos(nt.fat_100g)) : null;
    n.fiber = pos(nt.fiber_100g) != null ? r1(pos(nt.fiber_100g)) : null; n.sugar = pos(nt.sugars_100g) != null ? r1(pos(nt.sugars_100g)) : null;
    n.sodium = pos(nt.sodium_100g) != null ? Math.round(pos(nt.sodium_100g) * 1000) : null; // g -> mg
    const ml = /\bml\b|litre|liter|\bl\b|cl\b/i.test(String(prod.quantity || "") + " " + String(prod.serving_size || "")) && !/\bg\b/i.test(String(prod.serving_size || ""));
    const portions = []; const sv = /([\d.,]+)\s*(g|ml)/i.exec(prod.serving_size || "");
    if (sv) portions.push(Object.assign({ label: clean(prod.serving_size, 40) }, sv[2].toLowerCase() === "ml" ? { ml: num(sv[1]) } : { g: num(sv[1]) }));
    const countries = (prod.countries_tags || []).map(t => String(t).replace(/^en:/, "")); const kw = countries.find(c => /kuwait/.test(c));
    return record({
      id: "off:" + (code || prod.code), name: prod.product_name || prod.product_name_en || prod.generic_name || "Product " + (code || prod.code), brand: (String(prod.brands || "").split(",")[0] || null),
      market: kw ? "KW" : (countries.length === 1 ? countries[0].toUpperCase().slice(0, 2) : null), prep: "as-sold",
      basis: ml ? { kind: "per100ml", amount: 100, unit: "ml", label: "100 ml" } : { kind: "per100g", amount: 100, unit: "g", label: "100 g" },
      nutrients: n, derived, portions,
      source: { kind: "off", id: String(code || prod.code), url: "https://world.openfoodfacts.org/product/" + (code || prod.code), publishedAt: prod.last_modified_t ? new Date(prod.last_modified_t * 1000).toISOString().slice(0, 10) : null, retrievedAt: retrievedAt || null, note: prod.quantity ? clean(prod.quantity, 40) : null },
      grade: "source",
    });
  }

  // ---------- the app's own barcodes/{code} library (barcode scanner, label scanner, hand-entered) ----------
  function fromLibrary(code, prod) {
    if (!prod || !prod.per100) return null;
    const p = prod.per100, ml = prod.basis === "ml";
    const portions = prod.serving && prod.serving.g > 0 ? [Object.assign({ label: clean(prod.serving.label, 40) || "1 serving" }, ml ? { ml: prod.serving.g } : { g: prod.serving.g })] : [];
    const n = { kcal: pos(p.kcal), p: pos(p.p), c: pos(p.c), f: pos(p.f) };
    for (const m of prod.missing || []) if (m in n) n[m] = null;
    const kind = prod.source === "off" ? "off" : prod.source === "label" ? "label" : "manual";
    return record({
      id: "lib:" + code, name: prod.name, brand: prod.brand || null, market: prod.market || null, prep: "as-sold",
      basis: ml ? { kind: "per100ml", amount: 100, unit: "ml", label: "100 ml" } : { kind: "per100g", amount: 100, unit: "g", label: "100 g" },
      nutrients: n, derived: prod.derived ? ["kcal"] : [], portions,
      source: { kind, id: String(code), url: kind === "off" ? "https://world.openfoodfacts.org/product/" + code : null, retrievedAt: prod.labelAt || prod.at || null, note: prod.quantity || null },
      grade: kind === "off" ? "source" : "user",
    });
  }

  // ---------- restaurant catalog (modules/food-library/restaurants.json) ----------
  function fromRestaurant(item, rest) {
    if (!item || !rest) return null;
    const g = pos(item.serving_g);
    return record({
      id: "rest:" + rest.id + ":" + (item.id || slug(item.name)), kind: item.kind === "meal" ? "meal" : "food",
      name: item.name, restaurant: rest.name, market: rest.market || null, prep: "as-served",
      basis: { kind: "serving", amount: g || 1, unit: g ? "g" : "serving", label: g ? "1 " + (item.unit || "serving") + " (" + g + " g)" : "1 " + (item.unit || "serving") },
      nutrients: { kcal: pos(item.kcal), p: pos(item.p), c: pos(item.c), f: pos(item.f), fiber: pos(item.fiber), sugar: pos(item.sugar), sodium: pos(item.sodium) },
      portions: g ? [{ label: "1 " + (item.unit || "serving"), g }] : [{ label: "1 " + (item.unit || "serving"), g: 1 }],
      includes: item.includes || [],
      source: { kind: "restaurant", id: item.sourceId || item.id || null, url: item.url || (rest.source && rest.source.url) || null, publishedAt: item.publishedAt || (rest.source && rest.source.publishedAt) || null, retrievedAt: item.retrievedAt || (rest.source && rest.source.retrievedAt) || null, note: rest.source && rest.source.note || null },
      grade: item.grade || "source",
    });
  }
  const restaurantRecords = data => (data && data.restaurants || []).flatMap(r => (r.items || []).map(it => fromRestaurant(it, r)).filter(Boolean));

  // ---------- bundled catalog (typical values; always an estimate, never shown as a looked-up record) ----------
  function fromCatalog(e) {
    if (!e) return null;
    const ml = e.basis === "ml";
    return record({
      id: "cat:" + (e.id || slug(e.name)), name: e.name, prep: e.prep === undefined ? prepOf(e.name) : e.prep, market: null,
      basis: ml ? { kind: "per100ml", amount: 100, unit: "ml", label: "100 ml" } : { kind: "per100g", amount: 100, unit: "g", label: "100 g" },
      nutrients: { kcal: pos(e.kcal), p: pos(e.p), c: pos(e.c), f: pos(e.f), fiber: pos(e.fiber) },
      portions: (e.portions || []).map(p => ml ? { label: p.label, ml: p.ml || p.g } : { label: p.label, g: p.g }),
      source: { kind: "catalog", id: e.id || slug(e.name), note: e.note || "Typical value (USDA-based), not a looked-up record" },
      grade: "estimate",
    });
  }

  // ---------- recipe (the recipes module hands finished numbers for the whole batch) ----------
  function fromRecipe(rc) {
    if (!rc) return null;
    const batch = pos(rc.batchG), servings = pos(rc.servings) || 1, t = rc.totals || {};
    const perServing = { kcal: t.kcal != null ? t.kcal / servings : null, p: t.p != null ? t.p / servings : null, c: t.c != null ? t.c / servings : null, f: t.f != null ? t.f / servings : null };
    return record({
      id: "recipe:" + rc.id, kind: "recipe", name: rc.name, prep: "cooked", market: null,
      basis: { kind: "serving", amount: batch ? batch / servings : 1, unit: batch ? "g" : "serving", label: "1 serving" + (batch ? " (" + Math.round(batch / servings) + " g)" : "") },
      nutrients: { kcal: perServing.kcal != null ? Math.round(perServing.kcal) : null, p: perServing.p != null ? r1(perServing.p) : null, c: perServing.c != null ? r1(perServing.c) : null, f: perServing.f != null ? r1(perServing.f) : null },
      portions: batch ? [{ label: "1 serving", g: r1(batch / servings) }] : [{ label: "1 serving", g: 1 }],
      source: { kind: "recipe", id: String(rc.id), note: (rc.ingredients || []).length + " ingredients" + (batch ? ", batch " + batch + " g" : ", no batch weight") },
      grade: rc.estimated ? "estimate" : "user",
    });
  }

  // ---------- portion maths ----------
  // amount: {g} | {ml} | {servings} | {portion: label|index, count}. Returns {amountText, g|ml|servings, nutrients, unknown, factor}
  function scale(rec, amount) {
    if (!rec) return null;
    const b = rec.basis || { kind: "per100g", amount: 100, unit: "g" };
    let factor = null, text = "", g = null, ml = null, servings = null, portionLabel = null;
    const a = amount || defaultAmount(rec);
    if (a.portion !== undefined) {
      const p = typeof a.portion === "number" ? rec.portions[a.portion] : rec.portions.find(x => x.label === a.portion);
      if (!p) return null;
      const count = a.count > 0 ? a.count : 1;
      portionLabel = (count === 1 ? "" : count + " × ") + p.label;
      if (p.g) g = r1(p.g * count); else ml = r1(p.ml * count);
    } else if (a.servings !== undefined) {
      servings = a.servings;
    } else if (a.g !== undefined) g = pos(a.g); else if (a.ml !== undefined) ml = pos(a.ml);
    if (servings != null) {
      if (b.kind !== "serving") return null; // only a serving-based record can be logged by servings
      factor = servings; text = (servings === 1 ? "1 serving" : servings + " servings") + (b.unit === "g" ? " (" + Math.round(b.amount * servings) + " g)" : "");
      if (b.unit === "g") g = r1(b.amount * servings);
    } else if (g != null) {
      if (b.kind === "per100ml") return null; // never invent ml <-> g
      factor = b.kind === "per100g" ? g / 100 : (b.unit === "g" ? g / b.amount : null);
      if (factor == null) return null;
      text = (portionLabel ? portionLabel + ", " : "") + fmtAmt(g) + " g";
    } else if (ml != null) {
      if (b.kind === "per100g" || (b.kind === "serving" && b.unit !== "ml")) return null;
      factor = b.kind === "per100ml" ? ml / 100 : ml / b.amount;
      text = (portionLabel ? portionLabel + ", " : "") + fmtAmt(ml) + " ml";
    } else return null;
    const n = {}, unknown = [];
    for (const k of NUTR) { const v = rec.nutrients[k]; if (v == null) { n[k] = null; if (MACROS.includes(k)) unknown.push(k); } else n[k] = k === "kcal" || k === "sodium" ? Math.round(v * factor) : r1(v * factor); }
    return { amountText: text, g, ml, servings, factor: Math.round(factor * 10000) / 10000, nutrients: n, unknown, derived: rec.derived || [] };
  }
  const fmtAmt = n => (Math.round(n * 10) / 10).toString();
  function defaultAmount(rec) {
    if (!rec) return { g: 100 };
    if (rec.basis.kind === "serving") return { servings: 1 };
    if (rec.portions && rec.portions.length) return { portion: 0, count: 1 };
    return rec.basis.kind === "per100ml" ? { ml: 100 } : { g: 100 };
  }
  // "150 g", "250ml", "2 servings", "1.5 cup" (a portion label the record has), "2" (= 2 servings or 2 × first portion)
  function parseAmount(text, rec) {
    const s = String(text || "").trim().toLowerCase(); if (!s) return null;
    let m = /^([\d.,]+)\s*(g|gram|grams|gm)$/.exec(s); if (m) return { g: num(m[1]) };
    m = /^([\d.,]+)\s*(ml|millilitre|milliliter)$/.exec(s); if (m) return { ml: num(m[1]) };
    m = /^([\d.,]+)\s*(serving|servings|portion|portions|piece|pieces|x)?$/.exec(s);
    if (m) { const n = num(m[1]); if (!rec) return { servings: n }; if (rec.basis.kind === "serving") return { servings: n }; if (rec.portions.length) return { portion: 0, count: n }; return rec.basis.kind === "per100ml" ? { ml: n } : { g: n }; }
    m = /^([\d.,]+)\s*(.+)$/.exec(s);
    if (m && rec) { const want = m[2].replace(/s$/, ""); const idx = rec.portions.findIndex(p => p.label.toLowerCase().replace(/^1\s+/, "").startsWith(want)); if (idx >= 0) return { portion: idx, count: num(m[1]) }; }
    return null;
  }

  // ---------- food row for days/{date}.food ----------
  // Copies the numbers at logging time (a later change to the source never rewrites old logs). est = estimate grade or a missing macro.
  function toRow(rec, sc, { slot = "Extra", eaten = false, uid } = {}) {
    if (!rec || !sc) return null;
    const n = sc.nutrients;
    return {
      id: uid ? uid() : Math.random().toString(36).slice(2, 9),
      name: clean(rec.name, 60) + (rec.brand && !new RegExp(rec.brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(rec.name) ? " (" + clean(rec.brand, 24) + ")" : "") + " · " + sc.amountText,
      slot, kcal: n.kcal != null ? n.kcal : 0, p: n.p != null ? n.p : 0, c: n.c != null ? n.c : 0, f: n.f != null ? n.f : 0,
      eaten: !!eaten, est: rec.grade === "estimate" || sc.unknown.length > 0 || sc.derived.includes("kcal"),
      grams: sc.g != null ? sc.g : undefined, ml: sc.ml != null ? sc.ml : undefined,
      src: { id: rec.id, kind: rec.source.kind, grade: rec.grade, basis: rec.basis.label, unknown: sc.unknown.length ? sc.unknown : undefined, portionEst: rec.portionEst || undefined },
    };
  }

  // ---------- labels ----------
  const SOURCE_NAMES = { usda: "USDA", off: "Open Food Facts", label: "Your label scan", manual: "Your entry", restaurant: "Restaurant", catalog: "Typical values", recipe: "Your recipe", estimate: "Estimate" };
  function gradeLabel(rec) {
    if (!rec) return "";
    if (rec.grade === "source") return rec.source.kind === "restaurant" ? (rec.restaurant || "Restaurant") + (rec.market ? " " + marketName(rec.market) : "") : "Source: " + (SOURCE_NAMES[rec.source.kind] || rec.source.kind);
    if (rec.grade === "user") return rec.source.kind === "recipe" ? "Personal recipe" : rec.source.kind === "label" ? "From your label scan" : "Your entry";
    if (rec.grade === "reviewed") return "Reviewed";
    return rec.source.kind === "catalog" ? "Typical values (estimate)" : "Estimate";
  }
  const MARKETS = { KW: "Kuwait", US: "US", SA: "Saudi Arabia", AE: "UAE", QA: "Qatar", BH: "Bahrain", OM: "Oman", GB: "UK" };
  const marketName = m => MARKETS[m] || m;
  function sourceLine(rec) {
    if (!rec) return "";
    const parts = [gradeLabel(rec)];
    parts.push("per " + rec.basis.label);
    if (rec.prep && rec.prep !== "as-sold" && rec.prep !== "as-served") parts.push(rec.prep);
    if (rec.includes && rec.includes.length) parts.push("includes " + rec.includes.join(", "));
    if (rec.derived && rec.derived.includes("kcal")) parts.push("kcal calculated from the macros");
    const miss = MACROS.filter(k => rec.nutrients[k] == null); if (miss.length) parts.push("no " + miss.map(k => ({ kcal: "calories", p: "protein", c: "carbs", f: "fat" }[k])).join(", ") + " given");
    return parts.join(" · ");
  }
  function sourceDetails(rec) {
    if (!rec) return [];
    const s = rec.source, out = [];
    out.push(["Source", SOURCE_NAMES[s.kind] || s.kind, s.dataType ? "(" + s.dataType + ")" : ""].filter(Boolean).join(" "));
    if (s.id) out.push("Source id: " + s.id);
    if (s.publishedAt) out.push("Published / last changed at the source: " + s.publishedAt);
    if (s.retrievedAt) out.push("Fetched: " + String(s.retrievedAt).slice(0, 10) + (s.publishedAt ? " (fetching does not make it newer)" : ""));
    if (s.note) out.push(s.note);
    if (rec.market) out.push("Market: " + marketName(rec.market));
    if (s.url) out.push(s.url);
    return out;
  }

  // ---------- search ----------
  const STOP = new Set(["a", "an", "the", "of", "with", "and", "or", "in", "on", "from", "my", "some"]);
  const tokens = s => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}%]+/gu, " ").split(" ").filter(t => t && !STOP.has(t));
  const stem = t => t.length > 4 ? t.replace(/(ies)$/, "y").replace(/(es|s)$/, "") : t;
  const ALIASES = { chicken: ["dajaj"], rice: ["ruz", "basmati", "timman"], bread: ["khubz", "khobz", "pita", "toast"], yogurt: ["yoghurt", "laban", "zabadi"], labneh: ["labne", "labnah"], egg: ["eggs", "baid"], dates: ["tamr", "date"], fries: ["chips"], soda: ["cola", "pepsi", "coke"] };
  const ALIAS_INDEX = (() => { const m = {}; for (const [k, vs] of Object.entries(ALIASES)) { for (const v of vs) m[stem(v)] = stem(k); } return m; })();
  const normTokens = s => tokens(s).filter(t => !/^[\d.,]+$/.test(t)).map(stem).map(t => ALIAS_INDEX[t] || t); // "2 eggs" searches for eggs
  const QUALIFIERS = new Set(["cooked", "raw", "boiled", "grilled", "fried", "roasted", "baked", "fresh", "plain", "large", "small", "medium", "whole", "low", "fat", "free"]);
  function score(q, rec, ctx) {
    const qt = normTokens(q); if (!qt.length) return 0;
    const hay = normTokens([rec.name, rec.brand, rec.restaurant].filter(Boolean).join(" "));
    const nameL = String(rec.name).toLowerCase(), qL = String(q).toLowerCase().trim();
    let s = 0, hits = 0, realHit = false;
    for (const t of qt) { const full = hay.includes(t), part = !full && t.length >= 3 && hay.some(h => h.startsWith(t)); if (full || part) { hits++; s += full ? 10 : 6; if (!QUALIFIERS.has(t)) realHit = true; } }
    if (!hits || !realHit) return 0; // "cooked" alone must not pull in every cooked food
    if (qt.length >= 2 && hits * 2 < qt.length) return 0;
    if (hits < qt.length) s -= 8 * (qt.length - hits);
    if (nameL === qL) s += 40; else if (nameL.startsWith(qL)) s += 20;
    s -= Math.min(10, Math.max(0, hay.length - qt.length - 2)); // much longer names last (a 12-word variant below "Rice, white, cooked")
    if (/\b(raw|dry|uncooked)\b/.test(qL) && rec.prep === "raw") s += 6;
    if (/\bcooked\b/.test(qL) && rec.prep === "cooked") s += 6;
    if (!/\b(raw|dry|uncooked)\b/.test(qL) && rec.prep === "raw") s -= 3; // people usually log cooked food
    if (ctx.favourites && ctx.favourites.has(rec.id)) s += 25;
    const rec1 = ctx.recents ? ctx.recents.get(rec.id) : null; if (rec1) s += 15 + Math.min(10, rec1);
    if (rec.grade === "user" || rec.source.kind === "recipe") s += 12;
    if (ctx.market && rec.market === ctx.market) s += 8;
    if (rec.grade === "estimate") s -= 6;
    if (rec.source.kind === "usda" && rec.source.dataType === "Branded") s -= 6;
    return s;
  }
  // records: array; opts: {favourites: Set(ids), recents: Map(id -> uses), market, limit}. Never merges records; the same food
  // from two sources stays two results with their own source lines.
  function search(q, records, opts = {}) {
    const ctx = { favourites: opts.favourites || null, recents: opts.recents || null, market: opts.market || null };
    const out = [];
    (records || []).forEach((rec, i) => { if (!rec) return; const s = score(q, rec, ctx); if (s > 0) out.push({ rec, score: s, i }); });
    out.sort((a, b) => b.score - a.score || a.i - b.i); // ties keep the source order (the catalog lists the common form first)
    const seen = new Set(), res = [];
    for (const r of out) { if (seen.has(r.rec.id)) continue; seen.add(r.rec.id); res.push(r.rec); if (res.length >= (opts.limit || 30)) break; }
    return res;
  }

  // ---------- small cache for remote searches (24 h default; a stale entry is used when the network fails) ----------
  function cache(storage, ttlMs = 24 * 3600e3, prefix = "foodlib.") {
    const mem = new Map();
    const read = k => { if (mem.has(k)) return mem.get(k); try { const raw = storage && storage.getItem(prefix + k); const v = raw ? JSON.parse(raw) : null; if (v) mem.set(k, v); return v; } catch (e) { return null; } };
    return {
      get(k, { allowStale = false } = {}) { const v = read(k); if (!v) return null; if (!allowStale && Date.now() - v.at > ttlMs) return null; return v.value; },
      put(k, value) { const v = { at: Date.now(), value }; mem.set(k, v); try { storage && storage.setItem(prefix + k, JSON.stringify(v)); } catch (e) {} },
    };
  }

  // ---------- remote searches ----------
  // USDA through the Mizan service (the key stays on the server; no AI, no spending): GET {base}/v1/foods?q=…
  async function usdaSearch(q, { fetch: f, base, token, cache: c, signal, pageSize = 25 } = {}) {
    const qq = clean(q, 80); if (!qq || !base) return { records: [], error: !base ? "no_endpoint" : null };
    const key = "usda:" + qq.toLowerCase() + ":" + pageSize;
    const hit = c && c.get(key); if (hit) return { records: hit.map(h => fromUsda(h, { retrievedAt: hit.retrievedAt })).filter(Boolean), cached: true };
    let res; try { res = await f(String(base).replace(/\/+$/, "") + "/v1/foods?q=" + encodeURIComponent(qq) + "&pageSize=" + pageSize, { headers: token ? { authorization: "Bearer " + token } : {}, signal }); }
    catch (e) { const stale = c && c.get(key, { allowStale: true }); return { records: stale ? stale.map(h => fromUsda(h)).filter(Boolean) : [], error: "offline", cached: !!stale }; }
    const j = await res.json().catch(() => null);
    if (!res.ok || !j) return { records: [], error: (j && j.error) || "server_error" };
    const foods = Array.isArray(j.foods) ? j.foods : [];
    if (c) c.put(key, foods);
    const at = new Date().toISOString().slice(0, 10);
    return { records: foods.map(h => fromUsda(h, { retrievedAt: at })).filter(Boolean), total: j.totalHits || foods.length };
  }
  // Open Food Facts text search, straight from the phone (10 searches a minute per IP; never as-you-type).
  const OFF_SEARCH = "https://world.openfoodfacts.org/cgi/search.pl?json=1&action=process&page_size=20&fields=code,product_name,product_name_en,generic_name,brands,quantity,serving_size,nutriments,countries_tags,last_modified_t&search_terms=";
  async function offSearch(q, { fetch: f, cache: c, signal, url = OFF_SEARCH, country } = {}) {
    const qq = clean(q, 80); if (!qq) return { records: [] };
    const key = "off:" + qq.toLowerCase() + ":" + (country || "");
    const hit = c && c.get(key); if (hit) return { records: hit.map(p => fromOff(p, p.code)).filter(Boolean), cached: true };
    let res; try { res = await f(url + encodeURIComponent(qq) + (country ? "&tagtype_0=countries&tag_contains_0=contains&tag_0=" + encodeURIComponent(country) : ""), { signal }); }
    catch (e) { const stale = c && c.get(key, { allowStale: true }); return { records: stale ? stale.map(p => fromOff(p, p.code)).filter(Boolean) : [], error: "offline", cached: !!stale }; }
    if (res.status === 429 || res.status === 503) return { records: [], error: "rate_limited" };
    const j = await res.json().catch(() => null);
    if (!res.ok || !j) return { records: [], error: "server_error" };
    const prods = (j.products || []).filter(p => p && p.code && (p.product_name || p.product_name_en));
    if (c) c.put(key, prods);
    const at = new Date().toISOString().slice(0, 10);
    return { records: prods.map(p => fromOff(p, p.code, { retrievedAt: at })).filter(Boolean), total: j.count || prods.length };
  }

  return { fromUsda, fromOff, fromLibrary, fromRestaurant, fromCatalog, fromRecipe, restaurantRecords, scale, defaultAmount, parseAmount, toRow,
    gradeLabel, sourceLine, sourceDetails, marketName, prepOf, search, tokens: normTokens, cache, usdaSearch, offSearch, OFF_SEARCH, NUTR, MACROS, SOURCE_NAMES };
})();
if (typeof module !== "undefined" && module.exports) module.exports = FoodLib;
