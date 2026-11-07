// node --test modules/food-library/food-library.test.js
const test = require("node:test");
const assert = require("assert");
const FL = require("./food-library.js");
const CATALOG = require("./catalog.json");
const REST = require("./restaurants.json");

const usdaRice = { fdcId: 169756, description: "Rice, white, long-grain, regular, enriched, cooked", dataType: "SR Legacy", publishedDate: "2019-04-01",
  foodNutrients: [{ nutrientNumber: "208", nutrientName: "Energy", unitName: "KCAL", value: 130 }, { nutrientNumber: "268", unitName: "kJ", value: 544 }, { nutrientNumber: "203", value: 2.69 }, { nutrientNumber: "205", value: 28.17 }, { nutrientNumber: "204", value: 0.28 }, { nutrientNumber: "291", value: 0.4 }],
  foodPortions: [{ portionDescription: "1 cup", gramWeight: 158 }] };

test("USDA hit becomes a per-100 g source record with its id, date, portions and prep", () => {
  const r = FL.fromUsda(usdaRice, { retrievedAt: "2026-11-07" });
  assert.equal(r.id, "usda:169756"); assert.equal(r.grade, "source"); assert.equal(r.prep, "cooked");
  assert.deepEqual([r.nutrients.kcal, r.nutrients.p, r.nutrients.c, r.nutrients.f, r.nutrients.fiber], [130, 2.7, 28.2, 0.3, 0.4]);
  assert.equal(r.nutrients.sugar, null, "a nutrient the source does not give stays unknown");
  assert.deepEqual(r.portions, [{ label: "1 cup", g: 158 }]);
  assert.equal(r.source.publishedAt, "2019-04-01"); assert.equal(r.source.retrievedAt, "2026-11-07");
  assert.deepEqual(r.derived, []);
});

test("Foundation food without an Energy 208 line uses the Atwater line; a record with no kcal at all gets a flagged derived kcal", () => {
  const r = FL.fromUsda({ fdcId: 1, description: "Egg, whole, raw", dataType: "Foundation", foodNutrients: [{ nutrientNumber: "957", value: 148 }, { nutrientNumber: "203", value: 12.4 }, { nutrientNumber: "205", value: 0.96 }, { nutrientNumber: "204", value: 9.96 }] });
  assert.equal(r.nutrients.kcal, 148); assert.deepEqual(r.derived, []); assert.equal(r.prep, "raw");
  const d = FL.fromUsda({ fdcId: 2, description: "Thing", dataType: "Foundation", foodNutrients: [{ nutrientNumber: "203", value: 10 }, { nutrientNumber: "205", value: 10 }, { nutrientNumber: "204", value: 10 }] });
  assert.equal(d.nutrients.kcal, 170); assert.deepEqual(d.derived, ["kcal"]);
  assert.match(FL.sourceLine(d), /kcal calculated from the macros/);
});

test("portion maths: 200 kcal per 100 g x 150 g = 300 kcal; published kcal is kept, not recomputed from macros", () => {
  const rec = FL.fromCatalog({ id: "x", name: "Test food", kcal: 200, p: 10, c: 10, f: 10 }); // 4*10+4*10+9*10 = 170, published says 200
  const s = FL.scale(rec, { g: 150 });
  assert.equal(s.nutrients.kcal, 300); assert.deepEqual([s.nutrients.p, s.nutrients.c, s.nutrients.f], [15, 15, 15]);
  assert.equal(s.amountText, "150 g"); assert.equal(s.g, 150); assert.deepEqual(s.unknown, []);
});

test("portions by label and count; raw and cooked stay separate records", () => {
  const rice = FL.fromUsda(usdaRice);
  const s = FL.scale(rice, { portion: "1 cup", count: 2 });
  assert.equal(s.g, 316); assert.equal(s.nutrients.kcal, 411); assert.equal(s.amountText, "2 × 1 cup, 316 g");
  const cat = CATALOG.foods.map(FL.fromCatalog);
  const cooked = cat.find(r => r.id === "cat:rice-white-cooked"), raw = cat.find(r => r.id === "cat:rice-white-raw");
  assert.equal(cooked.prep, "cooked"); assert.equal(raw.prep, "raw");
  assert.notEqual(FL.scale(cooked, { g: 100 }).nutrients.kcal, FL.scale(raw, { g: 100 }).nutrients.kcal);
});

test("no invented conversions: grams on a per-100 ml record, ml on a per-100 g record, servings on a per-100 g record all refuse", () => {
  const milk = FL.fromCatalog({ id: "m", name: "Milk", basis: "ml", kcal: 63, p: 3.3, c: 4.9, f: 3.4 });
  assert.equal(FL.scale(milk, { g: 100 }), null);
  assert.equal(FL.scale(milk, { ml: 250 }).nutrients.kcal, 158);
  const rice = FL.fromUsda(usdaRice);
  assert.equal(FL.scale(rice, { ml: 100 }), null);
  assert.equal(FL.scale(rice, { servings: 1 }), null);
});

test("unknown nutrients stay unknown through scaling and mark the row as an estimate", () => {
  const r = FL.fromOff({ code: "123", product_name: "Mystery bar", brands: "Brand", nutriments: { "energy-kcal_100g": 400, proteins_100g: 10, fat_100g: 20 }, countries_tags: ["en:kuwait"] }, "123");
  assert.equal(r.nutrients.c, null); assert.equal(r.market, "KW");
  const s = FL.scale(r, { g: 50 });
  assert.equal(s.nutrients.c, null); assert.deepEqual(s.unknown, ["c"]); assert.equal(s.nutrients.kcal, 200);
  const row = FL.toRow(r, s, { slot: "Snack", uid: () => "id1" });
  assert.equal(row.est, true); assert.equal(row.c, 0); assert.equal(row.kcal, 200); assert.equal(row.name, "Mystery bar (Brand) · 50 g");
  assert.deepEqual(row.src, { id: "off:123", kind: "off", grade: "source", basis: "100 g", unknown: ["c"], portionEst: undefined });
  assert.match(FL.sourceLine(r), /no carbs given/);
});

test("Open Food Facts: kJ-only energy becomes a flagged kcal; serving size becomes a portion; ml products are per 100 ml", () => {
  const r = FL.fromOff({ code: "5", product_name: "Juice", quantity: "1 L", serving_size: "250 ml", nutriments: { "energy-kj_100g": 188, proteins_100g: 0.7, carbohydrates_100g: 10.4, fat_100g: 0.2 }, last_modified_t: 1700000000 }, "5");
  assert.equal(r.basis.kind, "per100ml"); assert.equal(r.nutrients.kcal, 45); assert.deepEqual(r.derived, ["kcal"]);
  assert.deepEqual(r.portions, [{ label: "250 ml", ml: 250 }]); assert.equal(r.source.publishedAt, "2023-11-14");
  assert.equal(FL.scale(r, { portion: 0, count: 1 }).nutrients.kcal, 113);
});

test("the app's own barcodes library (label scans) becomes a user-grade record and keeps its missing list", () => {
  const r = FL.fromLibrary("lbl-kdd-milk", { code: "lbl-kdd-milk", name: "KDD Low fat milk", brand: "KDD", basis: "ml", per100: { kcal: 46, p: 3.4, c: 5, f: 1.5 }, serving: { g: 250, label: "1 pack" }, missing: [], source: "label", labelAt: "2026-10-26" });
  assert.equal(r.grade, "user"); assert.equal(r.source.kind, "label"); assert.equal(r.basis.kind, "per100ml"); assert.deepEqual(r.portions, [{ label: "1 pack", ml: 250 }]);
  assert.equal(FL.gradeLabel(r), "From your label scan");
  const off = FL.fromLibrary("6281007031233", { name: "Labneh", per100: { kcal: 180, p: 8, c: 4 }, missing: ["f"], source: "off", derived: true });
  assert.equal(off.nutrients.f, null); assert.equal(off.grade, "source"); assert.deepEqual(off.derived, ["kcal"]);
});

test("restaurant item: a meal lists what it includes, the market stays on the record, servings scale", () => {
  const data = { restaurants: [{ id: "mcd-kw", name: "McDonald's", market: "KW", source: { url: "https://x/y.pdf", publishedAt: "2017" }, items: [
    { id: "big-mac", name: "Big Mac", unit: "sandwich", serving_g: 215, kcal: 510, p: 26, c: 44, f: 26, kind: "item" },
    { id: "big-mac-meal-m", name: "Big Mac Meal (medium)", unit: "meal", kcal: 1010, p: 30, c: 130, f: 42, kind: "meal", includes: ["Big Mac", "Medium fries", "Medium Coca-Cola"] } ] }] };
  const recs = FL.restaurantRecords(data);
  assert.equal(recs.length, 2);
  const bm = recs[0], meal = recs[1];
  assert.equal(bm.id, "rest:mcd-kw:big-mac"); assert.equal(bm.market, "KW"); assert.equal(bm.basis.kind, "serving"); assert.equal(bm.basis.label, "1 sandwich (215 g)");
  assert.equal(FL.gradeLabel(bm), "McDonald's Kuwait");
  assert.equal(FL.scale(bm, { servings: 2 }).nutrients.kcal, 1020); assert.equal(FL.scale(bm, { g: 107.5 }).nutrients.kcal, 255);
  assert.equal(meal.kind, "meal"); assert.match(FL.sourceLine(meal), /includes Big Mac, Medium fries, Medium Coca-Cola/);
  assert.equal(FL.scale(meal, { g: 100 }), null, "a meal with no weight cannot be logged by grams");
  assert.equal(FL.scale(meal, { servings: 1 }).nutrients.kcal, 1010);
  assert.ok(FL.sourceDetails(bm).some(l => /2017/.test(l)));
  assert.ok(Array.isArray(FL.restaurantRecords(REST)), "the bundled restaurants file parses");
});

test("recipe record: per serving from batch totals, portion by weight when the batch weight is known", () => {
  const r = FL.fromRecipe({ id: "mach", name: "Aziz's machboos", servings: 4, batchG: 1000, totals: { kcal: 2400, p: 160, c: 280, f: 60 }, ingredients: [1, 2, 3] });
  assert.equal(r.nutrients.kcal, 600); assert.equal(r.basis.amount, 250);
  assert.equal(FL.scale(r, { g: 250 }).nutrients.kcal, 600); assert.equal(FL.scale(r, { servings: 2 }).nutrients.kcal, 1200);
  assert.equal(FL.gradeLabel(r), "Personal recipe");
  const noBatch = FL.fromRecipe({ id: "x", name: "Soup", servings: 2, totals: { kcal: 300, p: 10, c: 20, f: 10 } });
  assert.equal(FL.scale(noBatch, { g: 100 }), null, "no batch weight -> no logging by grams"); assert.equal(FL.scale(noBatch, { servings: 1 }).nutrients.kcal, 150);
});

test("search: everyday words, aliases, cooked preferred, favourites and recents first, no merging of same-name records", () => {
  const cat = CATALOG.foods.map(FL.fromCatalog);
  const usda = FL.fromUsda(usdaRice);
  const all = cat.concat([usda]);
  const r1 = FL.search("cooked rice", all);
  assert.ok(r1.length >= 2); assert.ok(r1.slice(0, 2).every(r => /rice/i.test(r.name) && r.prep === "cooked"));
  assert.ok(r1.some(r => r.id === "usda:169756") && r1.some(r => r.id === "cat:rice-white-cooked"), "USDA and catalog rice both listed, never merged");
  assert.equal(FL.search("khubz", all)[0].id, "cat:khubz-pita");
  assert.equal(FL.search("laban", all)[0].id, "cat:laban");
  assert.match(FL.search("eggs", all)[0].id, /^cat:egg-/);
  const fav = FL.search("rice", all, { favourites: new Set(["cat:rice-brown-cooked"]) });
  assert.equal(fav[0].id, "cat:rice-brown-cooked");
  const rec = FL.search("rice", all, { recents: new Map([["usda:169756", 3]]) });
  assert.equal(rec[0].id, "usda:169756");
  assert.deepEqual(FL.search("zzzz", all), []); assert.deepEqual(FL.search("", all), []);
  assert.ok(FL.search("chicken", all).length <= 30);
});

test("parseAmount reads grams, ml, servings and portion labels", () => {
  const rice = FL.fromUsda(usdaRice), bm = FL.restaurantRecords({ restaurants: [{ id: "r", name: "R", items: [{ id: "a", name: "A", serving_g: 100, kcal: 100 }] }] })[0];
  assert.deepEqual(FL.parseAmount("150 g", rice), { g: 150 }); assert.deepEqual(FL.parseAmount("250ml", rice), { ml: 250 });
  assert.deepEqual(FL.parseAmount("2", bm), { servings: 2 }); assert.deepEqual(FL.parseAmount("2", rice), { portion: 0, count: 2 });
  assert.deepEqual(FL.parseAmount("1.5 cup", rice), { portion: 0, count: 1.5 }); assert.equal(FL.parseAmount("", rice), null);
  assert.deepEqual(FL.defaultAmount(rice), { portion: 0, count: 1 }); assert.deepEqual(FL.defaultAmount(bm), { servings: 1 });
});

test("remote searches: USDA goes through the service with the token and is cached; failures fall back to a stale copy; OFF rate limit is reported", async () => {
  const store = {}; const storage = { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = v; } };
  const c = FL.cache(storage, 1000);
  let calls = 0;
  const f = async (url, init) => { calls++; assert.match(url, /^https:\/\/svc\/v1\/foods\?q=cooked%20rice&pageSize=25$/); assert.equal(init.headers.authorization, "Bearer tok"); return { ok: true, json: async () => ({ foods: [usdaRice], totalHits: 1 }) }; };
  const a = await FL.usdaSearch("cooked rice", { fetch: f, base: "https://svc/", token: "tok", cache: c });
  assert.equal(a.records[0].id, "usda:169756"); assert.equal(a.records[0].source.retrievedAt, new Date().toISOString().slice(0, 10));
  const b = await FL.usdaSearch("cooked rice", { fetch: f, base: "https://svc/", token: "tok", cache: c });
  assert.equal(b.cached, true); assert.equal(calls, 1);
  const c2 = FL.cache(storage, -1); // everything stale
  const dead = async () => { throw new Error("offline"); };
  const d = await FL.usdaSearch("cooked rice", { fetch: dead, base: "https://svc", token: "tok", cache: c2 });
  assert.equal(d.error, "offline"); assert.equal(d.records.length, 1); assert.equal(d.cached, true);
  const e = await FL.usdaSearch("rice", { fetch: f, base: null });
  assert.equal(e.error, "no_endpoint");
  const off = await FL.offSearch("labneh", { fetch: async () => ({ status: 429, ok: false, json: async () => ({}) }) });
  assert.equal(off.error, "rate_limited");
  const ok = await FL.offSearch("labneh", { fetch: async url => { assert.match(url, /search_terms=labneh/); return { status: 200, ok: true, json: async () => ({ count: 1, products: [{ code: "9", product_name: "Labneh", brands: "Almarai", nutriments: { "energy-kcal_100g": 180, proteins_100g: 8, carbohydrates_100g: 4, fat_100g: 14 }, countries_tags: ["en:kuwait"] }] }) }; } });
  assert.equal(ok.records[0].id, "off:9"); assert.equal(ok.records[0].market, "KW");
});

test("bundled catalog: unique ids, every entry has the four macros, portions carry a weight, and all are estimates", () => {
  const ids = new Set();
  for (const e of CATALOG.foods) {
    assert.ok(!ids.has(e.id), "duplicate id " + e.id); ids.add(e.id);
    for (const k of ["kcal", "p", "c", "f"]) assert.equal(typeof e[k], "number", e.id + " " + k);
    const r = FL.fromCatalog(e); assert.equal(r.grade, "estimate"); assert.match(FL.gradeLabel(r), /Typical values/);
    for (const p of r.portions) assert.ok((p.g > 0) || (p.ml > 0), e.id + " portion " + p.label);
    const diff = Math.abs((4 * e.p + 4 * e.c + 9 * e.f) - e.kcal) / Math.max(e.kcal, 1);
    assert.ok(diff < 0.3 || e.kcal < 20, e.id + " kcal far from its macros (" + Math.round(diff * 100) + "%)");
  }
});
