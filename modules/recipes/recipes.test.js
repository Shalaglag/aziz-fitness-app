// node --test modules/recipes/recipes.test.js
const test = require("node:test");
const assert = require("assert");
const R = require("./recipes.js");
const FL = require("../food-library/food-library.js");

const chicken = FL.fromCatalog({ id: "chk", name: "Chicken breast, roasted", kcal: 165, p: 31, c: 0, f: 3.6 });
const rice = FL.fromCatalog({ id: "rice", name: "Rice, white, cooked", kcal: 130, p: 2.7, c: 28.2, f: 0.3 });
const oil = FL.fromCatalog({ id: "oil", name: "Olive oil", kcal: 884, p: 0, c: 0, f: 100, portions: [{ label: "1 tbsp", g: 13.5 }] });

function machboos() {
  let rc = R.create({ name: "Aziz's machboos", servings: 4 });
  rc = R.addIngredient(rc, R.ingFromRecord(chicken, FL.scale(chicken, { g: 600 })));
  rc = R.addIngredient(rc, R.ingFromRecord(rice, FL.scale(rice, { g: 800 })));
  rc = R.addIngredient(rc, R.ingFromRecord(oil, FL.scale(oil, { portion: 0, count: 2 })));
  return rc;
}

test("a recipe sums its ingredients; per serving divides; amounts rescale linearly in the unit they were added with", () => {
  const rc = machboos();
  const t = R.totals(rc);
  assert.equal(t.kcal, 990 + 1040 + 239); assert.equal(t.p, 207.6); assert.equal(t.count, 3);
  const ps = R.perServing(rc); assert.equal(ps.kcal, Math.round(2269 / 4)); assert.equal(ps.g, null);
  const oilId = rc.ingredients[2].id;
  const more = R.setAmount(rc, oilId, "54"); // grams stay grams: 4 tbsp
  assert.equal(more.ingredients[2].nutrients.kcal, 478); // 239 kcal for 27 g, doubled from the base assert.equal(more.ingredients[2].amountText, "54 g");
  assert.equal(R.setAmount(rc, oilId, "2 servings"), rc, "no unit swap from grams to servings");
  assert.equal(R.setAmount(rc, oilId, "abc"), rc);
  assert.notEqual(more, rc, "never mutates");
});

test("batch weight: 2,400 kcal in 1,000 g -> a 250 g portion is 600 kcal; without a weighed batch grams are refused", () => {
  let rc = R.create({ name: "Stew", servings: 4 });
  rc = R.addIngredient(rc, { id: "a", name: "Everything", recId: null, amountText: "1 serving", qty: { servings: 1 }, base: { qty: { servings: 1 }, nutrients: { kcal: 2400, p: 160, c: 280, f: 60 } }, nutrients: { kcal: 2400, p: 160, c: 280, f: 60 }, unknown: [], est: false });
  assert.equal(R.perGram(rc), null);
  const rec0 = R.toRecord(rc);
  assert.equal(FL.scale(rec0, { g: 250 }), null); assert.equal(FL.scale(rec0, { servings: 1 }).nutrients.kcal, 600);
  rc = R.setBatch(rc, 1000);
  assert.equal(Math.round(R.perGram(rc).kcal * 250), 600);
  const rec = R.toRecord(rc);
  assert.equal(rec.grade, "user"); assert.equal(FL.gradeLabel(rec), "Personal recipe");
  assert.equal(FL.scale(rec, { g: 250 }).nutrients.kcal, 600); assert.equal(FL.scale(rec, { servings: 2 }).nutrients.kcal, 1200);
  assert.equal(R.perServing(rc).g, 250);
  // raw ingredient weights are never summed into a batch weight
  const m = machboos(); assert.equal(R.perGram(m), null); assert.equal(R.toRecord(m).basis.unit, "serving");
});

test("a logged meal becomes a recipe with the numbers it was logged with; unknown macros and estimates carry through", () => {
  const rows = [
    { id: "1", name: "Rice, white, cooked · 150 g", kcal: 195, p: 4, c: 42.3, f: 0.5, grams: 150, est: true, src: { id: "cat:rice-white-cooked" } },
    { id: "2", name: "Mystery bar (Brand) · 50 g", kcal: 200, p: 5, c: 0, f: 10, grams: 50, est: true, src: { id: "off:123", unknown: ["c"] } },
    { id: "3", name: "Water", kcal: 0, p: 0, c: 0, f: 0 },
  ];
  const rc = R.fromRows(rows, { existing: { "rice-white-cooked-mystery-bar": {} } });
  assert.equal(rc.ingredients.length, 2, "a zero row is left out"); assert.equal(rc.name, "Rice, white, cooked + Mystery bar (Brand)");
  assert.equal(rc.id, "rice-white-cooked-mystery-bar-brand");
  assert.equal(rc.ingredients[0].recId, "cat:rice-white-cooked"); assert.deepEqual(rc.ingredients[0].qty, { g: 150 });
  const t = R.totals(rc); assert.equal(t.kcal, 395); assert.deepEqual(t.unknown, ["c"]); assert.equal(t.est, true);
  assert.equal(R.toRecord(rc).grade, "estimate");
  assert.equal(R.fromRows([]), null);
});

test("validate and list", () => {
  assert.deepEqual(R.validate(R.create({ name: "" })), ["Give the recipe a name.", "Add at least one ingredient."]);
  assert.deepEqual(R.validate(machboos()), []);
  const html = R.listHtml({ m: machboos() });
  assert.match(html, /Aziz&#39;s machboos/); assert.match(html, /3 ingredients · 4 servings · estimate/); assert.match(html, /data-act="rc-fromday"/);
  assert.match(R.listHtml({}), /No recipes yet/);
});
