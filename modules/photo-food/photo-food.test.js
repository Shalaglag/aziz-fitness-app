// Run: node --test modules/photo-food/photo-food.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const PF = require("./photo-food.js");

test("prompt mentions photo only when there is one, and carries the description", () => {
  assert.match(PF.prompt({ text: "2 eggs", hasImage: false }), /described below/);
  assert.doesNotMatch(PF.prompt({ text: "2 eggs" }), /attached photo/);
  assert.match(PF.prompt({ hasImage: true }), /attached photo/);
  assert.match(PF.prompt({ text: 'say "hi"' }), /"say \\"hi\\""/);
});

test("parse cleans numbers, names and confidence", () => {
  const r = PF.parse({ items: [{ name: "  Shawarma  plate ", kcal: "820.4", p: "45,5", c: 80, f: 30, confidence: "HIGH" }, { name: "", protein: 25, carbs: 2, fat: 1 }], note: "ok" });
  assert.equal(r.items.length, 2);
  assert.deepEqual(r.items[0], { name: "Shawarma plate", portion: "", grams: 0, prep: "", kcal: 820, p: 45.5, c: 80, f: 30, ai: { kcal: 820, p: 45.5, c: 80, f: 30, grams: 0 }, confidence: "high", fromLabel: false, check: false });
  assert.equal(r.items[1].name, "Food");
  assert.equal(r.items[1].kcal, 117); // filled from macros
  assert.equal(r.items[1].confidence, "medium");
  assert.equal(r.note, "ok");
});

test("parse flags kcal far from macros, drops empty and negative values", () => {
  const r = PF.parse({ items: [{ name: "x", kcal: 1000, p: 10, c: 10, f: 5 }, { name: "air", kcal: 0 }, { name: "neg", kcal: -50, p: -3 }] });
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].check, true);
});

test("parse accepts a bare array, a JSON string, and survives junk", () => {
  assert.equal(PF.parse([{ name: "a", kcal: 100 }]).items.length, 1);
  assert.equal(PF.parse('{"items":[{"name":"a","kcal":100}]}').items.length, 1);
  assert.deepEqual(PF.parse("nope").items, []);
  assert.deepEqual(PF.parse(null).items, []);
  assert.deepEqual(PF.parse({ items: "x", note: "No food in this photo." }), { items: [], note: "No food in this photo.", question: "" });
  // New shape: components with grams, prep and a follow-up question.
  const r = PF.parse({ components: [{ name: "Chicken", prep: "Grilled", grams: 150.4, kcal: 270, p: 32, c: 0, f: 15, confidence: "medium", fromLabel: false }], question: "Skin on?" });
  assert.equal(r.items[0].grams, 150);
  assert.equal(r.items[0].prep, "grilled");
  assert.equal(r.items[0].portion, "150 g");
  assert.equal(r.question, "Skin on?");
});

test("parse caps item count and silly values", () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ name: "i" + i, kcal: 99999, p: 9999 }));
  const r = PF.parse({ items: many });
  assert.equal(r.items.length, 12);
  assert.equal(r.items[0].kcal, 5000);
  assert.equal(r.items[0].p, 400);
});

test("toFoodItems builds app food entries marked est:true", () => {
  let n = 0; const uid = () => "id" + n++;
  const items = PF.toFoodItems([{ name: "Machboos", kcal: 820.6, p: 55.04, c: 95, f: 22 }, { name: "Laban", kcal: 120, p: 6, c: 9, f: 6, on: false }], { slot: "Meal 2", eaten: true, uid });
  assert.deepEqual(items, [{ id: "id0", name: "Machboos", slot: "Meal 2", kcal: 821, p: 55, c: 95, f: 22, eaten: true, est: true, src: { kind: "photo", portionEst: true, matched: null, grade: "estimate" } }]);
  const lab = PF.toFoodItems([{ name: "Bar", kcal: 200, p: 20, c: 20, f: 5, grams: 60, fromLabel: true }], { uid, source: "describe" });
  assert.equal(lab[0].grams, 60);
  assert.deepEqual(lab[0].src, { kind: "describe", portionEst: false, matched: null, grade: "label" });
});

test("toFoodItems combine merges into one entry with summed macros", () => {
  const items = PF.toFoodItems([{ name: "Rice", kcal: 300, p: 6, c: 65, f: 1 }, { name: "Chicken", kcal: 250, p: 45, c: 0, f: 7 }], { combine: true, eaten: false });
  assert.equal(items.length, 1);
  assert.equal(items[0].name, "Rice + Chicken");
  assert.deepEqual([items[0].kcal, items[0].p, items[0].c, items[0].f, items[0].eaten, items[0].est, items[0].slot], [550, 51, 65, 8, false, true, "Extra"]);
});

test("toFoodItems returns nothing when every item is off or empty", () => {
  assert.deepEqual(PF.toFoodItems([{ name: "a", kcal: 0 }, { name: "b", kcal: 100, on: false }]), []);
});

test("guessSlot fills Meal 1, then Meal 2, then Extra", () => {
  assert.equal(PF.guessSlot({ food: [] }), "Meal 1");
  assert.equal(PF.guessSlot({ food: [{ slot: "Meal 1" }, { slot: "Snack" }] }), "Meal 2");
  assert.equal(PF.guessSlot({ food: [{ slot: "Meal 1" }, { slot: "Meal 2" }] }), "Extra");
  assert.equal(PF.guessSlot(undefined), "Meal 1");
});

test("totals and errorText", () => {
  assert.deepEqual(PF.totals([{ kcal: 100, p: 1.25, c: 2, f: 3 }, { kcal: "50", p: 1, c: 0, f: 0 }]), { kcal: 150, p: 2.3, c: 2, f: 3 });
  assert.match(PF.errorText("rate_limited"), /minute/);
  assert.match(PF.errorText("whatever"), /Try again/);
});

test("html escapes and shows the result card", () => {
  // No bind() call: html is pure over the module's state, which starts empty.
  const h = PF.html("2026-10-25", { food: [] });
  assert.match(h, /Log from a photo or description/);
  assert.match(h, /data-pf="go"/);
});

test("prompt names the day's calorie target", () => {
  assert.match(PF.prompt({ text: "rice" }), /2,000 kcal plan/);
  assert.match(PF.prompt({ text: "rice", kcal: 2150 }), /2,150 kcal plan/);
});

test("match prices components from the food library by grams; rescale follows the chosen source", () => {
  const FL = require("../food-library/food-library.js");
  const recs = [FL.fromCatalog({ id: "cat-rice", name: "Rice, white, cooked", kcal: 130, p: 2.7, c: 28, f: 0.3 })];
  const items = PF.parse({ components: [{ name: "white rice", prep: "cooked", grams: 200, kcal: 300, p: 5, c: 60, f: 2 }, { name: "mystery sauce", grams: 30, kcal: 90, p: 0, c: 5, f: 8 }] }).items;
  const m = PF.match(items, recs, FL);
  assert.equal(m[0].match.id, "cat:cat-rice");
  assert.equal(m[0].kcal, 260); // 130 × 2, not Claude's 300
  assert.equal(m[0].ai.kcal, 300); // Claude's number kept for "use AI numbers"
  assert.equal(m[1].match, undefined);
  const r = PF.rescale(m[0], 100);
  assert.equal(r.kcal, 130);
  const r2 = PF.rescale(m[1], 60);
  assert.equal(r2.kcal, 180); // AI guess scaled linearly
  const rows = PF.toFoodItems(m, { uid: () => "x" });
  assert.equal(rows[0].src.matched, "cat:cat-rice");
  assert.equal(rows[1].src.grade, "estimate");
});
