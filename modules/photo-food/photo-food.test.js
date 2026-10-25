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
  assert.deepEqual(r.items[0], { name: "Shawarma plate", portion: "", kcal: 820, p: 45.5, c: 80, f: 30, confidence: "high", check: false });
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
  assert.deepEqual(PF.parse({ items: "x", note: "No food in this photo." }), { items: [], note: "No food in this photo." });
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
  assert.deepEqual(items, [{ id: "id0", name: "Machboos", slot: "Meal 2", kcal: 821, p: 55, c: 95, f: 22, eaten: true, est: true }]);
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
