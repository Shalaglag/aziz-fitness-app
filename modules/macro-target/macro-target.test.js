// Run: node --test modules/macro-target/macro-target.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const MT = require("./macro-target.js");

test("parse reads amount, macro and food in the common phrasings", () => {
  assert.deepEqual(MT.parse("40 g protein of grilled chicken"), { amount: 40, macro: "p", query: "grilled chicken", unit: "g" });
  assert.deepEqual(MT.parse("40g protein grilled chicken"), { amount: 40, macro: "p", query: "grilled chicken", unit: "g" });
  assert.equal(MT.parse("300 kcal rice").macro, "kcal");
  assert.equal(MT.parse("300 calories of rice").macro, "kcal");
  assert.equal(MT.parse("50 g carbs from oats").macro, "c");
  assert.equal(MT.parse("20 g of fat avocado").macro, "f");
  assert.equal(MT.parse("protein 40 g chicken").macro, "p");
  assert.equal(MT.parse("protein 40 g chicken").query, "chicken");
  assert.equal(MT.parse("Grilled chicken, 40 g protein").query, "grilled chicken");
  assert.equal(MT.parse("40,5 protein chicken").amount, 40.5);
});

test("parse: grams with no macro word is a weight, a bare number defaults to protein", () => {
  assert.deepEqual(MT.parse("150 g salmon"), { amount: 150, macro: "g", query: "salmon", unit: "g" });
  assert.equal(MT.parse("40 chicken").macro, "p");
  assert.equal(MT.parse("chicken please"), null);
  assert.equal(MT.parse(""), null);
});

test("find matches aliases and partial names, exact alias first", () => {
  assert.equal(MT.find("grilled chicken").food.id, "chicken-breast");
  assert.equal(MT.find("chicken thigh").food.id, "chicken-thigh");
  assert.equal(MT.find("brown rice").food.id, "brown-rice");
  assert.equal(MT.find("rice").food.id, "rice");
  assert.equal(MT.find("greek yoghurt").food.id, "greek-yogurt");
  assert.equal(MT.find("iso100").food.id, "whey");
  assert.equal(MT.find("zzz").food, null);
  assert.equal(MT.find("").food, null);
  const ex = MT.find("adonis", { extra: [{ id: "adonis", name: "Adonis cookie dough", kcal: 384, p: 44, c: 22.8, f: 12.4 }] });
  assert.equal(ex.food.id, "adonis");
});

test("gramsFor and scale do the arithmetic", () => {
  const chicken = MT.FOODS.find(f => f.id === "chicken-breast");
  assert.equal(MT.gramsFor(chicken, "p", 40), 129);
  assert.equal(MT.gramsFor(chicken, "kcal", 330), 200);
  assert.equal(MT.gramsFor(chicken, "g", 150.4), 150);
  assert.equal(MT.gramsFor(chicken, "c", 20), null); // 0 carbs
  assert.equal(MT.gramsFor(chicken, "p", 0), null);
  assert.deepEqual(MT.scale(chicken, 129), { name: "Grilled chicken breast, 129 g", kcal: 213, p: 40, c: 0, f: 4.6, grams: 129, est: true });
});

test("solve: the headline example", () => {
  const r = MT.solve("40 g protein of grilled chicken");
  assert.equal(r.ok, true);
  assert.equal(r.grams, 129);
  assert.equal(r.item.p, 40);
  assert.equal(r.item.kcal, 213);
  assert.equal(MT.summary(r), "129 g Grilled chicken breast = 213 kcal · 40 P · 0 C · 4.6 F");
});

test("solve: kcal, carbs and plain weight", () => {
  assert.equal(MT.solve("300 kcal rice").grams, 231);
  assert.equal(MT.solve("50 g carbs from oats").grams, 75);
  const w = MT.solve("150 g salmon");
  assert.equal(w.grams, 150);
  assert.equal(w.item.kcal, 312);
});

test("solve: failures explain themselves and offer candidates", () => {
  const none = MT.solve("40 g protein of dragon fruit");
  assert.equal(none.ok, false);
  assert.match(none.reason, /No per-100 g numbers/);
  const noMacro = MT.solve("30 g carbs chicken");
  assert.equal(noMacro.ok, false);
  assert.match(noMacro.reason, /has no carbs/);
  assert.ok(noMacro.candidates.length >= 1);
  assert.match(MT.solve("chicken").reason, /Start with a number/);
  assert.match(MT.solve("40 g protein").reason, /Name the food/);
  assert.match(MT.solve("200 g protein chicken").note, /645 g/);
});

test("solve: custom per-100 g numbers replace the catalog, kcal filled from macros", () => {
  const r = MT.solve("40 g protein of my shake", { custom: { kcal: "", p: 20, c: 10, f: 2 } });
  assert.equal(r.ok, true);
  assert.equal(r.food.custom, true);
  assert.equal(r.food.name, "shake");
  assert.equal(r.food.kcal, 138);
  assert.equal(r.grams, 200);
  assert.equal(r.item.kcal, 276);
  // empty custom falls back to the catalog
  assert.equal(MT.solve("40 g protein chicken", { custom: { kcal: "", p: "", c: "", f: "" } }).food.id, "chicken-breast");
});

test("html renders the card and escapes text; css is a string", () => {
  const h = MT.html("2026-10-26");
  assert.match(h, /Log by target macro/);
  assert.match(h, /data-form="macro-target"/);
  assert.equal(typeof MT.css, "string");
});
