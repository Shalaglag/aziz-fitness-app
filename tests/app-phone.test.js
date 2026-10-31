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

    await t.test("one calorie target everywhere: change it in Your numbers and no card still says 2,000", async () => {
      const seed2200 = today => { const d = seed(today); d.prefs = { main: { profile: { cutKcal: 2200 } } }; return d; };
      const { page, errors } = await openApp(browser, PHONES[0], seed2200);
      const r = await page.evaluate(() => ({ target: kcalTarget(TODAY), base: TARGET.kcal, tdee: tdeeOpts().kcal, coachFloor: coachOpts().rules.floor, ramadan: dayTargets(TODAY).kcal }));
      assert.deepStrictEqual(r, { target: 2200, base: 2200, tdee: 2200, coachFloor: 1800, ramadan: 2200 });
      const stale = [];
      for (const tab of TABS) {
        await page.click(`#tabs button[data-tab="${tab}"]`);
        await page.waitForTimeout(150);
        const hits = await page.evaluate(() => (document.querySelector("#main").innerText.match(/[^\n]{0,40}\b2,?000\b(?! IU)[^\n]{0,30}/g) || []));
        // The "Your numbers" help names the plan default on purpose ("leave a box empty to keep your plan's value").
        hits.filter(h => !/plan's value/.test(h)).forEach(h => stale.push(tab + ": " + h));
      }
      assert.deepStrictEqual(stale, [], "cards still showing the old 2,000 target");
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

    await t.test("food diary: budget − eaten = remaining, no exercise calories, add sheet adds under the chosen meal and closes", async () => {
      const { page, errors } = await openApp(browser, PHONES[0], seed);
      await page.click('#tabs button[data-tab="food"]');
      const r = await page.evaluate(() => { const v = [...document.querySelectorAll(".fsum .v")].map(e => e.textContent.trim()); return { v, target: kcalTarget(TODAY), labels: [...document.querySelectorAll(".fsum .label")].map(e => e.textContent.trim()) }; });
      assert.deepStrictEqual(r.v, ["2,000", "870", "1,130"], "budget, food, remaining");
      assert.deepStrictEqual(r.labels, ["Budget", "Food", "Remaining"]);
      assert.strictEqual(r.target, 2000, "the budget is the chosen target, never lowered on its own");
      // Open the sheet for Meal 2, add a food, and it lands under Meal 2 with the sheet closed
      await page.click('.mealgrp:has(.mh span:text-is("Meal 2")) [data-act="foodadd"]');
      await page.waitForSelector('#foodSheet[role="dialog"]');
      assert.strictEqual(await page.$eval("#foodSheet h2", e => e.textContent), "Add to Meal 2");
      await page.fill("#fname", "Greek yoghurt"); await page.fill("#fk", "150"); await page.fill("#fp", "15"); await page.check("#featen");
      await page.click('#foodSheet button[type="submit"]');
      await page.waitForTimeout(200);
      const after = await page.evaluate(() => ({ sheet: !!document.getElementById("foodSheet"), meal2: [...document.querySelectorAll('.mealgrp')].find(g => /^Meal 2/.test(g.textContent)).textContent, remaining: document.querySelector(".fsum .v.big").textContent.trim() }));
      assert.strictEqual(after.sheet, false, "sheet closes after adding");
      assert.ok(/Greek yoghurt/.test(after.meal2), "new food is under Meal 2");
      assert.strictEqual(after.remaining, "980", "remaining drops by the eaten 150 kcal");
      // Edit: tap the item, scale the portion ×2, save
      await page.click('.mealgrp [data-act="foodedit"]:has-text("Greek yoghurt")');
      await page.waitForSelector("#fedit", { state: "attached" }); await page.click('[data-act="portion"][data-m="2"]'); await page.click('#foodSheet button[type="submit"]');
      await page.waitForTimeout(200);
      const it = await page.evaluate(() => getDay(TODAY).food.find(i => i.name === "Greek yoghurt"));
      assert.deepStrictEqual([it.kcal, it.p, it.slot, it.eaten], [300, 30, "Meal 2", true]);
      assert.deepStrictEqual(errors, []);
      await page.close();
    });

    await t.test("quick log: Strong-style rows, ticking a set fills it from the plan and starts the rest timer, kg/lb per exercise converts what is shown and keeps what was logged", async () => {
      const { page, errors } = await openApp(browser, PHONES[0], today => { const d = seed(today); d.workouts = { [today]: { date: today, session: "Push A", idx: 0, sets: {} } }; return d; });
      await page.evaluate(() => { view.tab = "train"; view.trainMode = "quick"; render(); });
      const head = await page.evaluate(() => [...document.querySelector(".xcard .srow.head").children].map(e => e.textContent.trim()));
      assert.deepStrictEqual(head, ["Set", "Previous", "kg", "Reps", "✓"]);
      await page.click('[data-act="setdone"][data-n="Bench Press (Barbell)"][data-i="0"]');
      await page.waitForTimeout(150);
      let r = await page.evaluate(() => ({ set: S.docs.workouts[TODAY].sets["Bench Press (Barbell)"][0], timer: !document.getElementById("timer").hidden, text: document.getElementById("timer").textContent }));
      assert.deepStrictEqual([r.set.w, r.set.r, r.set.unit, r.set.done], ["90", "8", "kg", true], "ticked set takes the plan's 90 kg × 8");
      assert.ok(r.timer && /Rest/.test(r.text), "rest timer bar shows");
      // Switch this exercise to lb: the column, placeholders and previous values convert; the logged set keeps its kg value and unit
      await page.click('.srow.head .unitbtn[data-n="Bench Press (Barbell)"]');
      await page.waitForTimeout(150);
      r = await page.evaluate(() => ({ unit: exUnit("Bench Press (Barbell)"), head: document.querySelector('.srow.head .unitbtn[data-n="Bench Press (Barbell)"]').textContent, ph: document.querySelector('input[data-set="Bench Press (Barbell)"][data-i="1"][data-k="w"]').placeholder, set: S.docs.workouts[TODAY].sets["Bench Press (Barbell)"][0], eff: programEff()["Push A"][0] }));
      assert.strictEqual(r.unit, "lb"); assert.strictEqual(r.head, "lb");
      assert.strictEqual(r.ph, "198.5", "90 kg baseline shows as 198.5 lb");
      assert.deepStrictEqual([r.set.w, r.set.unit], ["90", "kg"], "logged set untouched");
      assert.deepStrictEqual([r.eff[1], r.eff[4]], [198.5, "lb"], "analytics and imports see the lb baseline");
      assert.deepStrictEqual(errors, []);
      await page.close();
    });

    await t.test("full logger is the default Train screen, opens in List view, and Settings can switch it", async () => {
      const { page, errors } = await openApp(browser, PHONES[0], seed);
      await page.click('#tabs button[data-tab="train"]');
      await page.waitForFunction(() => !document.getElementById("lbHost").hidden && /Templates/.test(document.getElementById("lbHost").textContent));
      const order = await page.evaluate(() => ({ mode: view.trainMode, above: document.getElementById("lbHost").compareDocumentPosition(document.getElementById("main")) & Node.DOCUMENT_POSITION_FOLLOWING ? "logger-first" : "main-first", gym: WorkoutLogger.settings().gym }));
      assert.deepStrictEqual(order, { mode: "full", above: "logger-first", gym: false });
      await page.click("#openSettings");
      await page.waitForSelector('[data-act="lbset"][data-s="gym"][data-k="gym"]');
      await page.click('[data-act="lbset"][data-s="gym"][data-k="gym"]');
      await page.waitForTimeout(100);
      assert.strictEqual(await page.evaluate(() => WorkoutLogger.settings().gym), true);
      await page.click('[data-act="tmode"][data-m="quick"]');
      await page.waitForTimeout(100);
      assert.strictEqual(await page.evaluate(() => view.trainMode + ":" + localStorage.getItem("aziz-cut-tmode")), "quick:quick");
      assert.deepStrictEqual(errors, []);
      await page.close();
    });

    await t.test("guide: search filters sections and jump chips exist; progress has four sections", async () => {
      const { page, errors } = await openApp(browser, PHONES[0], seed);
      await page.click('#tabs button[data-tab="guide"]');
      assert.ok((await page.$$('.jump .chip')).length >= 7, "jump chips");
      await page.fill("#libq", "creatine"); await page.waitForTimeout(150);
      const cards = await page.$$eval('#main .card.guide h3', els => els.map(e => e.textContent));
      assert.deepStrictEqual(cards, ["Supplements"]);
      await page.click('#tabs button[data-tab="progress"]');
      const tabs = await page.$$eval('.subnav [data-act="ptab"]', els => els.map(e => e.textContent));
      assert.deepStrictEqual(tabs, ["Weight", "Lifts", "Food", "Reviews"]);
      await page.click('[data-act="ptab"][data-k="reviews"]'); await page.waitForTimeout(100);
      assert.ok(await page.$('details.fold[data-keep="f:wr"]'), "weekly report folded under Reviews");
      assert.deepStrictEqual(errors, []);
      await page.close();
    });

    for (const phone of PHONES) {
      await t.test(phone.name + ": every tab renders with no errors and no sideways scroll", async () => {
        for (const data of [null, seed]) {
          const { page, errors } = await openApp(browser, phone, data);
          for (const tab of TABS.concat("settings")) {
            if (tab === "settings") await page.click("#openSettings"); else await page.click(`#tabs button[data-tab="${tab}"]`);
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
