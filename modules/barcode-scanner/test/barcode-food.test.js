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

// ---- Google's scanner in the Android app (BarcodeScan plugin) ----
const fs = require("node:fs");
const path = require("node:path");

function fakeEl() {
  const on = {}, seen = [];
  let html = "";
  return { get innerHTML() { return html; }, set innerHTML(v) { html = v; seen.push(v); }, seen, on,
    addEventListener: (t, f) => { on[t] = f; }, removeEventListener() {}, querySelector: () => null };
}
const click = (el, bf) => el.on.click({ target: { closest: () => ({ dataset: { bf } }) } });
const tick = () => new Promise(r => setTimeout(r, 0));
function withWindow(win, fn) {
  const had = "window" in globalThis, old = globalThis.window;
  globalThis.window = win;
  return Promise.resolve().then(fn).finally(() => { if (had) globalThis.window = old; else delete globalThis.window; });
}
const nativeWin = scan => ({ Capacitor: { isNativePlatform: () => true, Plugins: { BarcodeScan: { scan } } } });

test("upcEtoA and fromScan expand UPC-E to the UPC-A Open Food Facts knows", () => {
  assert.equal(B.upcEtoA("04252614"), "042100005264");
  assert.equal(B.upcEtoA("01234565"), "012345000065");
  assert.equal(B.upcEtoA("12345"), null);
  assert.equal(B.fromScan("04252614", "upc_e"), "042100005264");
  assert.equal(B.fromScan("5449000000996", "ean_13"), "5449000000996");
  assert.equal(B.fromScan("96385074", "ean_8"), "96385074");    // a real EAN-8 stays as it is
});

test("nativeScan: only inside the Android app with the plugin; null-safe elsewhere", async () => {
  assert.equal(B.nativeScan(), false);
  await withWindow({ Capacitor: { isNativePlatform: () => true, Plugins: {} } }, () => assert.equal(B.nativeScan(), false));
  await withWindow({ Capacitor: { isNativePlatform: () => false, Plugins: { BarcodeScan: {} } } }, () => assert.equal(B.nativeScan(), false));
  await withWindow(nativeWin(async () => ({})), () => { assert.equal(B.nativeScan(), true); assert.equal(B.canDetect(), true); });
});

test("Scan with camera uses Google's scanner, then the same lookup and Add flow", async () => {
  await withWindow(nativeWin(async () => ({ code: "5449000000996", format: "ean_13" })), async () => {
    const el = fakeEl(), added = [], saved = {};
    let url = "";
    B.mount(el, { onAdd: i => added.push(i), library: { get: () => null, put: (c, p) => { saved[c] = p; } },
      fetch: u => { url = u; return res(F.full); } });
    assert.match(el.innerHTML, /Scan with camera/);
    assert.doesNotMatch(el.innerHTML, /Photo of barcode/);   // needs BarcodeDetector, which the plugin doesn't give
    click(el, "cam");
    for (let i = 0; i < 5; i++) await tick();
    assert.match(url, /5449000000996/);
    assert.ok(saved["5449000000996"], "found product saved to the library as before");
    assert.match(el.innerHTML, /Coca-Cola/);
    click(el, "add");
    assert.equal(added.length, 1);
    assert.equal(added[0].barcode, "5449000000996");
  });
});

test("Backing out of Google's scanner returns to the card; a failure falls back to the old camera", async () => {
  await withWindow(nativeWin(async () => ({ cancelled: true })), async () => {
    const el = fakeEl(); let fetched = false;
    B.mount(el, { onAdd() {}, library: { get: () => null, put() {} }, fetch: () => { fetched = true; return res(F.full); } });
    click(el, "cam"); await tick(); await tick();
    assert.equal(fetched, false);
    assert.match(el.innerHTML, /Scan with camera/);
  });
  const win = nativeWin(async () => { throw Object.assign(new Error("x"), { code: "downloading" }); });
  win.BarcodeDetector = function () {};
  await withWindow(win, async () => {
    const el = fakeEl();
    B.mount(el, { onAdd() {}, library: { get: () => null, put() {} }, fetch: null });
    click(el, "cam"); await tick(); await tick();
    // the old live-camera view opens (node has no camera, so it then reports that, as a phone without one would)
    assert.ok(el.seen.some(h => /still downloading, so this scan uses the built-in camera/.test(h) && /data-bf="video"/.test(h)));
  });
  await withWindow(nativeWin(async () => { throw Object.assign(new Error("x"), { code: "unavailable" }); }), async () => {
    const el = fakeEl();
    B.mount(el, { onAdd() {}, library: { get: () => null, put() {} }, fetch: null });
    click(el, "cam"); await tick(); await tick();
    assert.match(el.innerHTML, /Type the number/);
    assert.match(el.innerHTML, /Barcode number/);              // typing the number still works
  });
});

test("Android: BarcodeScanPlugin copy, registration, dependency and module download", () => {
  const root = path.join(__dirname, "../../..");
  const app = p => fs.readFileSync(path.join(root, "android/app", p), "utf8");
  assert.equal(app("src/main/java/com/azizfitness/app/BarcodeScanPlugin.kt"),
    fs.readFileSync(path.join(__dirname, "../android/BarcodeScanPlugin.kt"), "utf8"),
    "copy modules/barcode-scanner/android/BarcodeScanPlugin.kt into android/app/src/main/java/com/azizfitness/app/");
  assert.match(app("src/main/java/com/azizfitness/app/MainActivity.java"), /registerPlugin\(BarcodeScanPlugin\.class\)/);
  assert.match(app("build.gradle"), /play-services-code-scanner:/);
  assert.match(app("src/main/AndroidManifest.xml"), /com\.google\.mlkit\.vision\.DEPENDENCIES"\s+android:value="barcode_ui"/);
});
