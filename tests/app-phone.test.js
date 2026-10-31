// Whole-app checks on phone-sized screens: calorie math, the 7-day weight average, and every tab
// rendering without errors or sideways scrolling. Uses the built app/index.html in Chromium.
// Run: node --test tests/app-phone.test.js
const test = require("node:test");
const assert = require("assert");
const path = require("path");

let chromium;
try { ({ chromium } = require("playwright")); } catch (e) { /* skipped below when not installed */ }
const APP = "file://" + path.join(__dirname, "../app/index.html");
const PHONES = [{ name: "Android 360×800", width: 360, height: 800 }, { name: "iPhone 390×844", width: 390, height: 844 }];
const TABS = ["today", "train", "food", "progress", "guide"];

const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);

// Seven daily weigh-ins ending today (avg 91.0) and three food items, two of them eaten.
function seed(today) {
  const kgs = [91.9, 91.5, 91.2, 90.8, 90.9, 90.6, 90.1];
  const weights = {};
  kgs.forEach((kg, i) => { const date = addDays(today, i - 6); weights[date] = { date, kg }; });
  const food = [
    { id: "a", name: "Meal 1", slot: "Meal 1", kcal: 650, p: 55, c: 60, f: 18, eaten: true },
    { id: "b", name: "Snack", slot: "Snack", kcal: 220, p: 20, c: 25, f: 4, eaten: true },
    { id: "c", name: "Meal 2", slot: "Meal 2", kcal: 700, p: 50, c: 70, f: 20, eaten: false }
  ];
  return { days: { [today]: { date: today, food, water: 1000, supps: {}, treadmill: false } }, weights, workouts: {}, prefs: {} };
}

async function openApp(browser, phone, data) {
  const page = await browser.newPage({ viewport: { width: phone.width, height: phone.height }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.route(/^https:\/\/(fonts\.|www\.gstatic\.com)/, r => r.fulfill({ body: "" }));
  // The app ships Firebase in app/vendor; blank it too so these checks run in device-only mode with no sign-in sheet.
  await page.route(/\/vendor\/firebase-/, r => r.fulfill({ body: "" }));
  await page.goto(APP);
  if (data) {
    const today = await page.evaluate(() => TODAY);
    await page.evaluate(d => localStorage.setItem("aziz-cut", JSON.stringify(d)), data(today));
    await page.reload();
  }
  await page.waitForFunction(() => document.querySelector("#main").children.length > 0);
  return { page, errors };
}

test("phone checks", { skip: !chromium && "playwright not installed" }, async t => {
  const browser = await chromium.launch();
  try {
    await t.test("calorie target and eaten totals", async () => {
      const { page, errors } = await openApp(browser, PHONES[0], seed);
      const r = await page.evaluate(() => {
        const items = S.docs.days[TODAY].food;
        // Auto foods (Adonis, Gatorade) add planned rows on first open; they must stay un-eaten and out of the seeded totals.
        return { target: kcalTarget(TODAY), eaten: sum(items.filter(i => i.eaten)), all: sum(items.filter(i => !i.auto)), autoEaten: items.filter(i => i.auto && i.eaten).length };
      });
      assert.strictEqual(r.target, 2000, "default cut target is 2,000 kcal");
      assert.deepStrictEqual([r.eaten.kcal, r.eaten.p, r.eaten.c, r.eaten.f], [870, 75, 85, 22]);
      assert.strictEqual(r.all.kcal, 1570);
      assert.strictEqual(r.autoEaten, 0, "auto-food rows are planned, never counted as eaten");
      assert.deepStrictEqual(errors, []);
      await page.close();
    });

    await t.test("entries saved on the phone without an account are added to the account once, never overwriting", async () => {
      const { page, errors } = await openApp(browser, PHONES[0], null);
      const r = await page.evaluate(() => {
        S.docs.weights = { "2026-01-02": { date: "2026-01-02", kg: 90 } };            // already in the account
        const local = { weights: { "2026-01-01": { date: "2026-01-01", kg: 91 }, "2026-01-02": { date: "2026-01-02", kg: 99 } } };
        localStorage.setItem("aziz-cut-localAt", String(Date.now())); localStorage.removeItem("aziz-cut-uploadedAt");
        uploadLocalOnly(local);
        const first = JSON.parse(JSON.stringify(S.docs.weights));
        S.docs.weights = { "2026-01-02": { date: "2026-01-02", kg: 90 } };
        uploadLocalOnly(local);                                                        // second time: already uploaded
        return { first, second: S.docs.weights };
      });
      assert.strictEqual(r.first["2026-01-01"].kg, 91, "missing entry added");
      assert.strictEqual(r.first["2026-01-02"].kg, 90, "account copy kept");
      assert.strictEqual(r.second["2026-01-01"], undefined, "not uploaded twice");
      assert.deepStrictEqual(errors, []);
      await page.close();
    });

    await t.test("7-day average needs 7 weigh-ins and averages them", async () => {
      const { page, errors } = await openApp(browser, PHONES[0], seed);
      const r = await page.evaluate(() => ({ a7: avg7(TODAY), yesterday: avg7(addDays(TODAY, -1)) }));
      assert.ok(Math.abs(r.a7 - 91.0) < 1e-9, "average of the seven readings is 91.0, got " + r.a7);
      assert.strictEqual(r.yesterday, null, "only 6 readings up to yesterday, so no average yet");
      const shown = await page.evaluate(() => [...document.querySelectorAll(".stat")].find(s => /7-day avg/.test(s.textContent))?.querySelector(".v").textContent);
      assert.strictEqual(shown, "91.0");
      assert.deepStrictEqual(errors, []);
      await page.close();
    });

    for (const phone of PHONES) {
      await t.test(phone.name + ": every tab renders with no errors and no sideways scroll", async () => {
        for (const data of [null, seed]) {
          const { page, errors } = await openApp(browser, phone, data);
          for (const tab of TABS) {
            await page.click(`#tabs button[data-tab="${tab}"]`);
            await page.waitForTimeout(150);
            const r = await page.evaluate(() => ({ tab: view.tab, wide: document.documentElement.scrollWidth - window.innerWidth, text: document.querySelector("#main").textContent.trim().length }));
            assert.strictEqual(r.tab, tab);
            assert.ok(r.text > 0, tab + " tab is empty");
            assert.ok(r.wide <= 1, `${tab} tab scrolls sideways by ${r.wide}px (${data ? "with data" : "empty"})`);
          }
          assert.deepStrictEqual(errors, [], (data ? "with data" : "empty") + " page errors");
          await page.close();
        }
      });
    }
  } finally {
    await browser.close();
  }
});
