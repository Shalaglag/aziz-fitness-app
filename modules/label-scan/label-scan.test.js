// Run: node --test modules/label-scan/label-scan.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const LS = require("./label-scan.js");

const milk = { name: "Low fat milk", brand: "KDD", barcode: "6281006002009", basis: "ml", per100: { kcal: 47, p: 3.4, c: 4.9, f: 1.5 }, serving: { amount: 250, label: "1 glass (250 ml)", kcal: 118, p: 8.5, c: 12.3, f: 3.8 }, readable: true, note: "" };

test("prompt asks for exact copying and the JSON shape", () => {
  const p = LS.prompt();
  assert.match(p, /copy its numbers exactly/);
  assert.match(p, /"per100"/);
  assert.match(p, /Kuwait/);
});

test("parse keeps label numbers, basis, barcode and spots an owed label", () => {
  const d = LS.parse(milk);
  assert.deepEqual(d.per100, { kcal: 47, p: 3.4, c: 4.9, f: 1.5 });
  assert.equal(d.basis, "ml");
  assert.equal(d.barcode, "6281006002009");
  assert.deepEqual(d.serving, { amount: 250, label: "1 glass (250 ml)" });
  assert.equal(d.owed, "milk");
  assert.equal(d.derived, false);
  assert.equal(d.check, false);
  assert.equal(d.readable, true);
  assert.deepEqual(d.missing, []);
});

test("parse derives per-100 from the serving column, fills kcal from macros, reports missing fields", () => {
  const d = LS.parse({ name: "ISO100", brand: "Dymatize", basis: "g", per100: {}, serving: { amount: 32, label: "1 scoop", kcal: 120, p: 25, c: 2, f: 0.5 }, readable: true });
  assert.equal(d.derived, true);
  assert.equal(d.per100.kcal, 375);
  assert.equal(d.per100.p, 78.1);
  assert.equal(d.owed, "iso");
  const e = LS.parse({ name: "Eggs", per100: { p: 13, c: 1, f: 11 }, readable: true });
  assert.equal(e.per100.kcal, 155);
  assert.equal(e.derived, true);
  assert.equal(e.owed, "eggs");
  const m = LS.parse({ name: "x", per100: { kcal: 100, p: "abc", c: null } });
  assert.deepEqual(m.missing, ["p", "c", "f"]);
});

test("parse flags kcal far from macros, rejects bad barcodes and unreadable photos", () => {
  const d = LS.parse({ name: "y", barcode: "12-34", per100: { kcal: 500, p: 10, c: 10, f: 5 } });
  assert.equal(d.check, true);
  assert.equal(d.barcode, "");
  assert.equal(LS.parse({ readable: false, note: "no label" }).readable, false);
  assert.equal(LS.parse("not json").readable, false);
  assert.equal(LS.parse(JSON.stringify(milk)).name, "Low fat milk");
  assert.equal(LS.parse({ name: "z", per100: { kcal: -5 } }).readable, false);
});

test("matchOwed covers the four owed labels, in English and Arabic", () => {
  assert.equal(LS.matchOwed("Gatorade Blue Bolt"), "gatorade");
  assert.equal(LS.matchOwed("Dymatize ISO 100"), "iso");
  assert.equal(LS.matchOwed("KDD حليب"), "milk");
  assert.equal(LS.matchOwed("Al Wazzan eggs"), "eggs");
  assert.equal(LS.matchOwed("Almarai labneh"), "");
});

test("toProduct makes a library record keyed by barcode or a slug", () => {
  const p = LS.toProduct(LS.parse(milk), { now: "2026-10-26T00:00:00Z" });
  assert.equal(p.code, "6281006002009");
  assert.equal(p.source, "label");
  assert.deepEqual(p.serving, { g: 250, label: "1 glass (250 ml)" });
  assert.equal(p.labelAt, "2026-10-26T00:00:00.000Z");
  const q = LS.toProduct({ name: "Labneh Balls", brand: "Al Marai", per100: { kcal: 300, p: 8 } });
  assert.equal(q.code, "lbl-al-marai-labneh-balls");
  assert.deepEqual(q.per100, { kcal: 300, p: 8, c: 0, f: 0 });
  assert.deepEqual(q.missing, ["c", "f"]);
  assert.equal(q.serving, null);
});

test("toFoodItem scales to the serving and marks estimates", () => {
  const p = LS.toProduct(LS.parse(milk));
  const it = LS.toFoodItem(p, { slot: "Drink" });
  assert.equal(it.name, "KDD Low fat milk (250 ml)");
  assert.deepEqual([it.kcal, it.p, it.c, it.f], [118, 8.5, 12.3, 3.8]);
  assert.equal(it.est, false);
  assert.equal(it.slot, "Drink");
  assert.equal(it.barcode, "6281006002009");
  const q = LS.toProduct({ name: "Mystery", per100: { kcal: 200 } });
  assert.equal(LS.toFoodItem(q, { amount: 50 }).kcal, 100);
  assert.equal(LS.toFoodItem(q, { amount: 50 }).est, true);
});

test("owedUpdate fills the plan's open item, the label store and the Gatorade drink label", () => {
  const gat = LS.toProduct({ name: "Gatorade", basis: "ml", per100: { kcal: 25, p: 0, c: 6, f: 0 } });
  const calls = [];
  const prefs = LS.owedUpdate({ open: { salads: true } }, "gatorade", gat, { now: "2026-10-26T00:00:00Z", drinkLabel: (p, k, v) => { calls.push([k, v]); return Object.assign({}, p, { drinks: { gatorade: Object.assign({ est: false }, v) } }); } });
  assert.deepEqual(prefs.open, { salads: true, gatorade: true });
  assert.equal(prefs.labels.gatorade.kcal, 250);
  assert.equal(prefs.labels.gatorade.per, 1000);
  assert.deepEqual(calls, [["gatorade", { ml: 1000, kcal: 250, p: 0, c: 60, f: 0 }]]);
  assert.equal(prefs.drinks.gatorade.kcal, 250);
  const iso = LS.toProduct({ name: "ISO100", per100: { kcal: 375, p: 78.1, c: 6.3, f: 1.6 }, serving: { amount: 32, label: "1 scoop" } });
  const p2 = LS.owedUpdate({}, "iso", iso, {});
  assert.equal(p2.labels.iso.kcal, 120);
  assert.equal(p2.labels.iso.p, 25);
  assert.equal(p2.open, undefined);
  assert.deepEqual(LS.owedUpdate({ a: 1 }, "nope", iso), { a: 1 });
});

test("fixedOverride applies saved labels to Gatorade and ISO100 quick adds only", () => {
  const gat = { key: "gatorade", name: "Gatorade 1 L", kcal: 240, p: 0, c: 60, f: 0, slot: "Fixed", est: true };
  const labels = { gatorade: { kcal: 250, p: 0, c: 62, f: 0, est: false }, eggs: { kcal: 70, p: 6, c: 0, f: 5, est: false } };
  assert.deepEqual(LS.fixedOverride(gat, labels), Object.assign({}, gat, { kcal: 250, c: 62, est: false }));
  const eggs = { key: "eggs", name: "Saturday eggs", kcal: 490, p: 31, c: 45, f: 20, est: true };
  assert.equal(LS.fixedOverride(eggs, labels), eggs);
  assert.equal(LS.fixedOverride(gat, {}), gat);
  assert.equal(LS.fixedOverride(gat, undefined), gat);
});

test("foods lists label and manual products newest first and skips Open Food Facts rows", () => {
  const lib = {
    a: { code: "a", name: "A", per100: {}, source: "off" },
    b: { code: "b", name: "B", per100: {}, source: "label", labelAt: "2026-10-01" },
    c: { code: "c", name: "C", per100: {}, source: "manual", labelAt: "2026-10-20" },
    d: { code: "d", name: "D", per100: {}, source: "label" },
  };
  assert.deepEqual(LS.foods(lib).map(x => x.code), ["c", "b", "d"]);
  assert.deepEqual(LS.foods(null), []);
});
