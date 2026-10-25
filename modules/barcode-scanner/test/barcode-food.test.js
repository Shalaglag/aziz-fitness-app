const assert = require("node:assert/strict");
const test = require("node:test");
const B = require("../barcode-food.js");
const F = require("./fixtures.js");

const res = (json, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => json });

test("clean and isValid", () => {
  assert.equal(B.clean(" 5 449000 000996 "), "5449000000996");
  assert.ok(B.isValid("5449000000996"));       // EAN-13
  assert.ok(B.isValid("96385074"));            // EAN-8
  assert.ok(B.isValid("036000291452"));        // UPC-A
  assert.ok(B.isValid("4006381333931"));
  assert.ok(!B.isValid("5449000000997"));      // bad check digit
  assert.ok(!B.isValid("12345"));
  assert.ok(!B.isValid(""));
});

test("parseProduct: full kcal data", () => {
  const p = B.parseProduct(F.full);
  assert.equal(p.name, "Coca-Cola");
  assert.equal(p.brand, "Coca-Cola");
  assert.deepEqual(p.per100, { kcal: 42, p: 0, c: 10.6, f: 0 });
  assert.deepEqual(p.serving, { g: 330, label: "330 ml" });
  assert.deepEqual(p.missing, []);
  assert.equal(p.derived, false);
});

test("parseProduct: kJ only, comma decimals, serving from label", () => {
  const p = B.parseProduct(F.kjOnly);
  assert.equal(p.per100.kcal, 200);           // 836 kJ / 4.184
  assert.equal(p.per100.p, 6.5);
  assert.equal(p.derived, true);
  assert.deepEqual(p.serving, { g: 30, label: "30 g" });
});

test("parseProduct: prefers English name, flags missing macros", () => {
  const p = B.parseProduct(F.missingFat);
  assert.equal(p.name, "Protein bar");
  assert.deepEqual(p.missing, ["f"]);
});

test("toFoodItem scales to grams and matches the app's food row shape", () => {
  const p = B.parseProduct(F.kjOnly);
  const item = B.toFoodItem(p, { slot: "Snack", eaten: true });   // defaults to the 30 g serving
  assert.deepEqual(item, { name: "Almarai Labneh (30 g)", slot: "Snack", kcal: 60, p: 2, c: 1.2, f: 5.1, eaten: true, est: true, barcode: "6281007031233", grams: 30 });
  const big = B.toFoodItem(B.parseProduct(F.full), { grams: 500 });
  assert.equal(big.name, "Coca-Cola (500 g)");                   // brand not repeated
  assert.equal(big.kcal, 210);
  assert.equal(big.est, false);
  assert.equal(big.eaten, false);
  const none = B.toFoodItem({ code: "1", name: "X", brand: "", per100: { kcal: 100, p: 1, c: 1, f: 1 }, serving: null, missing: [] });
  assert.equal(none.grams, 100);
});

test("lookup: found / not found / 404 / offline / invalid", async () => {
  let url;
  const r = await B.lookup("5449000000996", { fetch: u => { url = u; return res(F.full); } });
  assert.equal(r.status, "found");
  assert.ok(url.startsWith("https://world.openfoodfacts.org/api/v2/product/5449000000996.json?fields="));
  assert.equal(r.product.per100.kcal, 42);
  assert.equal((await B.lookup("6281007031233", { fetch: () => res(F.notFound) })).status, "not_found");
  assert.equal((await B.lookup("6281007031233", { fetch: () => res(F.notFound, 404) })).status, "not_found");
  assert.equal((await B.lookup("6281007031233", { fetch: () => res({}, 503) })).status, "offline");
  assert.equal((await B.lookup("6281007031233", { fetch: () => Promise.reject(new TypeError("Failed to fetch")) })).status, "offline");
  assert.equal((await B.lookup("6281007031233", { fetch: null })).status, "offline");
  assert.equal((await B.lookup("123", { fetch: () => { throw new Error("should not call"); } })).status, "invalid");
});

test("lookup times out", async () => {
  const hang = (u, o) => new Promise((_, rej) => o.signal.addEventListener("abort", () => rej(Object.assign(new Error("x"), { name: "AbortError" }))));
  const r = await B.lookup("5449000000996", { fetch: hang, timeoutMs: 20 });
  assert.deepEqual(r, { status: "offline", error: "timed out" });
});
