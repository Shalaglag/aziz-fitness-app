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
const TABS = ["today", "train", "food", "progress", "friends", "guide"];

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

// Train with the Push / Pull / Lower templates loaded. Nothing is loaded for a new account any more (Nov 7): the
// person picks a programme; these checks load Aziz's.
async function openTrain(page) {
  await go(page, "train");
  await page.waitForFunction(() => !document.getElementById("lbHost").hidden && /Templates/.test(document.getElementById("lbHost").textContent));
  await page.evaluate(() => { const b = document.querySelector('#lbHost [data-a="loadProgram"]'); if (b) b.click(); });
  await page.waitForSelector('#lbHost [data-a="tplPreview"]');
}

// Sections live in a side drawer (☰) since Oct 31: open it, then tap the section.
// The bottom bar is the default since Nov 1; its More button opens the same drawer when ☰ is hidden.
async function go(page, tab) { await page.evaluate(() => { const m = document.getElementById("menuBtn"); (getComputedStyle(m).display === "none" ? document.querySelector("#bottomNav button[data-more]") : m).click(); }); await page.click(tab === "settings" ? "#openSettings" : `#tabs button[data-tab="${tab}"]`); await page.waitForTimeout(150); }

async function openApp(browser, phone, data, opts = {}) {
  const page = await browser.newPage({ viewport: { width: phone.width, height: phone.height }, isMobile: true, hasTouch: true });
  // opts.fixedTime pins the page clock (Date only; timers keep running) for checks whose result depends on the weekday.
  if (opts.fixedTime) await page.clock.setFixedTime(opts.fixedTime);
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
  // A brand-new install opens the goal questionnaire first; most checks here want the plain app.
  if (!opts.keepSetup) await page.evaluate(() => { const b = document.querySelector('.gs-wrap [data-gs="skip"]'); if (b) b.click(); });
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
        await go(page, tab);
        const hits = await page.evaluate(() => (document.querySelector("#main").innerText.match(/[^\n]{0,40}\b2,?000\b(?! IU)[^\n]{0,30}/g) || []));
        // The "Your numbers" help names the plan default on purpose ("leave a box empty to keep your plan's value").
        hits.filter(h => !/plan's value/.test(h)).forEach(h => stale.push(tab + ": " + h));
      }
      assert.deepStrictEqual(stale, [], "cards still showing the old 2,000 target");
      assert.deepStrictEqual(errors, []);
      await page.close();
    });

    await t.test("calorie rule: cardio, steps and an over-budget day never change the 2,000 target on their own", async () => {
      const busy = today => {
        const d = seed(today);
        d.days[today].steps = 14000;                                                    // a big step day
        d.cardio = { [today]: { date: today, sessions: [{ id: "c1", kind: "treadmill", min: 40, kcal: 450, kcalSrc: "manual", source: "manual" }] } };
        const y = addDays(today, -1);                                                   // yesterday 1,000 over, recovery not accepted
        d.days[y] = { date: y, food: [{ id: "big", name: "Feast", slot: "Meal 2", kcal: 3000, p: 120, c: 300, f: 120, eaten: true }], water: 0, supps: {} };
        return d;
      };
      const { page, errors } = await openApp(browser, PHONES[0], busy);
      const r = await page.evaluate(() => {
        const next = Array.from({ length: 15 }, (_, i) => kcalTarget(addDays(TODAY, i)));
        return { base: TARGET.kcal, next: [...new Set(next)], profile: (S.docs.prefs.main || {}).profile || null, cardio: (S.docs.cardio[TODAY].sessions[0] || {}).kcal };
      });
      assert.strictEqual(r.cardio, 450, "the treadmill session is logged");
      assert.strictEqual(r.base, 2000);
      assert.deepStrictEqual(r.next, [2000], "today and the next 14 days all stay at 2,000");
      assert.strictEqual((r.profile || {}).cutKcal, undefined, "nothing wrote a new calorie target");
      await go(page, "food");
      const v = await page.evaluate(() => [...document.querySelectorAll(".fsum .v")].map(e => e.textContent.trim()));
      assert.deepStrictEqual(v, ["1,130", "870", "2,000"], "remaining, eaten, target: budget ignores the 450 kcal treadmill and 14k steps");
      assert.deepStrictEqual(errors, []);
      await page.close();
    });

    await t.test("7-day average needs 7 weigh-ins and averages them", async () => {
      const { page, errors } = await openApp(browser, PHONES[0], seed);
      const r = await page.evaluate(() => ({ a7: avg7(TODAY), yesterday: avg7(addDays(TODAY, -1)) }));
      assert.ok(Math.abs(r.a7 - 91.0) < 1e-9, "average of the seven readings is 91.0, got " + r.a7);
      assert.strictEqual(r.yesterday, null, "only 6 readings up to yesterday, so no average yet");
      const shown = await page.evaluate(() => (/7-day avg\s*([\d.]+)/.exec(document.querySelector("#main").textContent) || [])[1]);
      assert.strictEqual(shown, "91.0", "Today's weigh-in card shows the 7-day average once");
      await go(page, "progress");
      const hero = await page.evaluate(() => [...document.querySelectorAll(".stat")].find(s => /Avg, last 7 days/.test(s.textContent))?.querySelector(".v").textContent);
      assert.strictEqual(hero, "91.0", "Progress › Weight has the full stats");
      assert.deepStrictEqual(errors, []);
      await page.close();
    });

    await t.test("food diary: budget − eaten = remaining, no exercise calories, add sheet adds under the chosen meal and closes", async () => {
      const { page, errors } = await openApp(browser, PHONES[0], seed);
      await go(page, "food");
      const r = await page.evaluate(() => { const v = [...document.querySelectorAll(".fsum .v")].map(e => e.textContent.trim()); return { v, target: kcalTarget(TODAY), labels: [...document.querySelectorAll(".fsum .label")].map(e => e.textContent.trim()) }; });
      assert.deepStrictEqual(r.v, ["1,130", "870", "2,000"], "remaining, eaten, target");
      assert.deepStrictEqual(r.labels, ["Remaining", "Eaten", "Target"]);
      assert.strictEqual(r.target, 2000, "the budget is the chosen target, never lowered on its own");
      // Open the sheet for Meal 2, add a food, and it lands under Meal 2 with the sheet closed
      await page.click('.mealgrp:has(.mh span:text-is("Meal 2")) [data-act="foodadd"]');
      await page.waitForSelector('#foodSheet[role="dialog"]');
      assert.strictEqual(await page.$eval("#foodSheet h2", e => e.textContent), "Add to Meal 2");
      await page.fill("#fname", "Greek yoghurt"); await page.fill("#fk", "150"); await page.fill("#fp", "15"); await page.check("#featen");
      await page.click('#foodSheet button[type="submit"]');
      await page.waitForTimeout(200);
      const after = await page.evaluate(() => ({ sheet: !!document.getElementById("foodSheet"), meal2: [...document.querySelectorAll('.mealgrp')].find(g => /^Meal 2/.test(g.textContent)).textContent, remaining: document.querySelector(".fsum .rem").textContent.trim() }));
      assert.strictEqual(after.sheet, false, "sheet closes after adding");
      assert.ok(/Greek yoghurt/.test(after.meal2), "new food is under Meal 2");
      assert.strictEqual(after.remaining, "980", "remaining drops by the eaten 150 kcal");
      // Edit: tap the item, scale the portion ×2, save
      await page.click('.mealgrp [data-act="foodedit"]:has-text("Greek yoghurt")');
      await page.waitForSelector("#fedit", { state: "attached" }); await page.click('[data-act="portion"][data-m="2"]'); await page.click('#foodSheet button[type="submit"]');
      await page.waitForTimeout(200);
      const it = await page.evaluate(() => getDay(TODAY).food.find(i => i.name === "Greek yoghurt"));
      assert.deepStrictEqual([it.kcal, it.p, it.slot, it.eaten], [300, 30, "Meal 2", true]);
      // Typing survives a background re-render (sync snapshot, water/steps import, deferred render after a pad tap).
      await page.click('.mealgrp:has(.mh span:text-is("Meal 2")) [data-act="foodadd"]');
      await page.waitForSelector('#foodSheet[role="dialog"]');
      await page.fill("#fname", "Oat bar"); await page.selectOption("#fslot", "Extra");
      await page.click('[data-act="pad"][data-k="2"]'); await page.click('[data-act="pad"][data-k="1"]'); await page.click('[data-act="pad"][data-k="0"]');
      await page.click('[data-act="padnext"]'); await page.click('[data-act="pad"][data-k="9"]');
      await page.click("#fname"); await page.keyboard.press("End"); await page.keyboard.type("s");
      await page.evaluate(() => { render(); render(); });
      const kept = await page.evaluate(() => ({ name: document.getElementById("fname").value, slot: document.getElementById("fslot").value, k: document.getElementById("fk").value, p: document.getElementById("fp").value, active: document.querySelector(".fa-field.is-active input").id, focus: document.activeElement && document.activeElement.id, head: document.getElementById("fhead").textContent }));
      assert.deepStrictEqual([kept.name, kept.slot, kept.k, kept.p, kept.active, kept.focus], ["Oat bars", "Extra", "210", "9", "fp", "fname"], "re-render keeps the typed food, its numbers, the active tile and the keyboard");
      assert.ok(/210/.test(kept.head), "detail header shows the kept calories");
      await page.click('[data-act="pad"][data-k="5"]'); await page.click('#foodSheet button[type="submit"]');
      await page.waitForTimeout(200);
      const bar = await page.evaluate(() => getDay(TODAY).food.find(i => i.name === "Oat bars"));
      assert.deepStrictEqual([bar.kcal, bar.p, bar.slot, bar.eaten], [210, 95, "Extra", false]);
      await page.click('.mealgrp [data-act="foodadd"]');
      await page.waitForSelector('#foodSheet[role="dialog"]');
      assert.strictEqual(await page.$eval("#fname", e => e.value), "", "a fresh sheet starts empty, not with the old draft");
      await page.click('[data-act="foodclose"]');
      assert.deepStrictEqual(errors, []);
      await page.close();
    });

    await t.test("Food look setting: Ring by default, Night / Board / Gauge draw their own hero with the same numbers", async () => {
      const { page, errors } = await openApp(browser, PHONES[0], seed);
      await go(page, "food");
      assert.ok(await page.$(".fhero.fh-ring"), "Ring is the default look");
      for (const [k, cls] of [["night", ".fh-night .fs-ring"], ["score", ".fh-score .sc-bar"], ["gauge", ".fh-gauge .gg"]]) {
        await page.evaluate(k => { S.docs.prefs.main = Object.assign({}, S.docs.prefs.main, { foodLook: k }); render(); }, k);
        assert.ok(await page.$(cls), k + " look renders");
        const rem = await page.$eval(".fhero .rem", e => e.textContent.trim());
        assert.strictEqual(rem, "1,130", k + " shows the same remaining");
      }
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(wide <= 1, "no sideways scroll at 360 px");
      assert.deepStrictEqual(errors, []);
      await page.close();
    });

    await t.test("menu picker sits on the Food page above Food check: most protein by default, leave out fries, reasons shown, plan adds planned items", async () => {
      // Pinned to a Tuesday: on Saturdays the picker adds the eggs breakfast (490 kcal) to every plan, so no meal pair fits 2,000 kcal and this check failed on the real date.
      const { page, errors } = await openApp(browser, PHONES[0], seed, { fixedTime: new Date("2026-11-03T12:00:00") });
      await go(page, "food");
      const order = await page.evaluate(() => { const m = document.getElementById("menuPicker"), f = [...document.querySelectorAll("#main details, #main .fold, #main [data-fold]")].find(e => /Food check/.test(e.textContent)); return { has: !!m, before: !!(m && f && (m.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING)) }; });
      assert.ok(order.has, "menu picker card is on the Food page");
      assert.ok(order.before, "menu picker comes before Food check");
      // The picker now sits below the taller Food hero, so on CI Playwright's pointer tap kept landing under the fixed header or bottom bar; tap it the way the ticks are tapped above.
      await page.$eval('#menuPicker [data-mi="paste"]', e => e.click());
      await page.fill("#miText", ["Main Meals", "Item  Calories  Protein  Carbs  Fat", "French Tacos Chicken  650  55  60  20", "Buffalo Chicken with Sweet Potato  496  65  41  8",
        "Chicken Masala with Rice  607  67  60  11", "Grilled Steak with Potato  560  52  45  18", "Chicken Burger with Fries  600  70  50  14", "Snacks", "Greek Yogurt Berry Cup  150  15  18  2",
        "Protein Brownie  210  14  22  7", "Fresh Fruit Cup  90  1  22  0"].join("\n"));
      const diagLog = [];
      const diag = async (label) => { for (let i = 0; i < 6; i++) { const d = await page.evaluate(() => { const e = document.querySelector('#menuPicker [data-mi="readtext"]') || document.querySelector('#menuPicker [data-mi="paste"]'); const r = e ? e.getBoundingClientRect() : {}; const at = e && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { scrollY: Math.round(scrollY), ih: innerHeight, dh: document.documentElement.scrollHeight, sw: document.documentElement.scrollWidth, top: Math.round(r.y), left: Math.round(r.x), w: Math.round(r.width), at: at && (at.tagName + "." + at.className), vv: visualViewport && [visualViewport.scale, Math.round(visualViewport.offsetTop), Math.round(visualViewport.height)], anims: document.getAnimations().length, wide: [...document.querySelectorAll("body *")].filter(x => x.getBoundingClientRect().right > innerWidth + 1 && !x.closest(".tablewrap")).slice(0, 10).map(x => (x.id || "") + "." + (typeof x.className === "string" ? x.className : "") + "@" + Math.round(x.getBoundingClientRect().left) + "-" + Math.round(x.getBoundingClientRect().right)), mainCls: document.getElementById("main").className, active: document.activeElement && document.activeElement.id }; }); diagLog.push(label + " " + i + " " + JSON.stringify(d)); await page.waitForTimeout(400); } };
      await diag("before-readtext");
      try { await page.click('#menuPicker [data-mi="readtext"]', { timeout: 8000 }); } catch (e) { await diag("after-fail"); throw new Error("readtext tap failed. " + diagLog.join(" || ") + " || " + e.message.split("\n")[0]); }
      await page.waitForSelector("#menuPicker .mi-opt.best");
      const pressed = await page.$eval('#menuPicker [data-mi="pri"][aria-pressed="true"]', e => e.textContent);
      assert.strictEqual(pressed, "Most protein");
      // On a Saturday the picker adds the breakfast eggs first (menu-import `eggs`), so no two meals fit the 2,000 kcal budget and the reason says so.
      const sat = await page.evaluate(() => dayType(TODAY) === "saturday");
      assert.match(await page.$eval("#menuPicker .mi-opt.best .mi-whys", e => e.textContent), sat ? /Most protein this menu allows; no combination reaches your 2,000 kcal budget/ : /Most protein of the \d+ meal pairs that fit your 2,000 kcal budget/);
      assert.ok(/Chicken Burger with Fries/.test(await page.$eval("#menuPicker .mi-opt.best", e => e.textContent)), "the highest-protein meal is picked first");
      await page.click('#menuPicker [data-mi="avoid"][data-w="fries"]');
      const best = await page.$eval("#menuPicker .mi-opt.best", e => e.textContent);
      assert.ok(!/Fries/.test(best), "no fries after leaving them out");
      assert.match(best, /Nothing with fries, as you asked/);
      assert.deepStrictEqual(await page.evaluate(() => S.docs.prefs.main.menuPick), { priority: "protein", avoid: ["fries"] }, "remembered for the next menu");
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(wide <= 1, "no sideways scroll at 360 px");
      if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, fullPage: true });
      await page.click('#menuPicker .mi-opt.best [data-mi="use"]');
      const planned = await page.evaluate(() => getDay(TODAY).food.filter(i => !i.eaten).map(i => i.name));
      assert.ok(planned.length >= 4, "the picked day is added as planned food");
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
      await openTrain(page);
      const order = await page.evaluate(() => ({ mode: view.trainMode, above: document.getElementById("lbHost").compareDocumentPosition(document.getElementById("main")) & Node.DOCUMENT_POSITION_FOLLOWING ? "logger-first" : "main-first", gym: WorkoutLogger.settings().gym }));
      assert.deepStrictEqual(order, { mode: "full", above: "logger-first", gym: false });
      await go(page, "settings");
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

    await t.test("sounds: rest over dings when the timer reaches 0 (quick log and full logger) and Finish plays the finish chime", async () => {
      const { page, errors } = await openApp(browser, PHONES[0], seed);
      await openTrain(page);
      await page.evaluate(() => { window.played = []; GymSounds.play = n => { played.push(n); return true; }; window.cues = []; ["lb:rest", "lb:rest-stop"].forEach(k => addEventListener(k, () => cues.push(k))); });
      // Quick log timer bar
      await page.evaluate(() => startTimer(1));
      await page.waitForFunction(() => played.includes("restDone"), null, { timeout: 4000 });
      assert.deepStrictEqual(await page.evaluate(() => cues), ["lb:rest", "lb:rest-stop"], "quick log tells the Android shell to schedule and cancel the rest notification");
      // Full logger: start a template, tick one set, Finish (through any confirm sheets)
      // Tap the newest visible match (sheets stack on top of the logger)
      const tapA = a => page.evaluate(a => { const b = [...document.querySelectorAll(`[data-a="${a}"]`)].filter(e => e.offsetParent).pop(); if (b) b.click(); return !!b; }, a);
      const finishOne = async () => {
        const tap = tapA;
        await tap("tplPreview"); await page.waitForTimeout(100);
        await tap("startTpl"); await page.waitForSelector('[data-a="check"]');
        await tap("check"); await page.waitForTimeout(100);
        await tap("finish"); await page.waitForTimeout(150);
        for (const a of ["finishConfirm", "finishSave"]) { await tap(a); await page.waitForTimeout(150); }
      };
      await page.evaluate(() => { played.length = 0; WorkoutLogger.setSettings({ sound: true }); });
      await finishOne();
      assert.ok(await page.evaluate(() => played.includes("finish")), "Finish plays the finish chime");
      assert.strictEqual(await page.evaluate(() => played[0]), "check", "ticking a set plays Aziz's Check sound by default");
      await page.evaluate(() => { played.length = 0; WorkoutLogger.setSettings({ sound: false }); });
      await finishOne();
      assert.deepStrictEqual(await page.evaluate(() => played), ["check"], "Beep setting off: no finish sound (the set tick has its own setting)");
      await page.evaluate(() => { played.length = 0; WorkoutLogger.setSettings({ setSound: "off" }); });
      await finishOne();
      assert.deepStrictEqual(await page.evaluate(() => played), [], "set sound Off: ticking is silent");
      // Finish and check remaining: tick one set, leave the rest unchecked, choose the new option -> every fillable set is saved
      await page.evaluate(() => { WorkoutLogger.setSettings({ sound: false }); });
      await tapA("tplPreview"); await page.waitForTimeout(100);
      await tapA("startTpl"); await page.waitForSelector('[data-a="check"]');
      await tapA("check"); await page.waitForTimeout(100);
      const before = await page.evaluate(() => document.querySelectorAll('[data-a="check"]').length);
      await tapA("finish"); await page.waitForTimeout(150);
      assert.ok(await page.evaluate(() => !![...document.querySelectorAll('[data-a="finishCheckAll"]')].find(e => e.offsetParent)), "finish sheet offers Finish and check remaining");
      await tapA("finishCheckAll"); await page.waitForTimeout(150);
      await tapA("finishSave"); await page.waitForTimeout(150);
      const savedSets = await page.evaluate(() => { const w = S.docs.workouts[TODAY]; return w ? Object.values(w.sets).reduce((n, a) => n + a.length, 0) : -1; });
      assert.ok(savedSets > 1 && savedSets <= before, `Finish and check remaining saved ${savedSets} sets (of ${before} rows), not just the one ticked`);
      await page.evaluate(() => WorkoutLogger.setSettings({ setSound: "check", sound: true }));
      // Quick log tick plays it too
      await page.evaluate(() => { played.length = 0; });
      const quick = await page.evaluate(() => { const c = document.querySelector('[data-act="setdone"]'); if (c) c.click(); return !!c; });
      if (quick) assert.ok(await page.evaluate(() => played.includes("check")), "quick log tick plays Check");
      assert.deepStrictEqual(errors, []);
      await page.close();
    });

    await t.test("Gym mode keeps the rest timer look picked in Settings", async () => {
      const { page, errors } = await openApp(browser, PHONES[0], seed);
      await openTrain(page);
      const r = await page.evaluate(async () => {
        const w = ms => new Promise(r => setTimeout(r, ms)), out = {};
        WorkoutLogger.setSettings({ restStyle: "ring", gym: false });
        document.querySelector('#lbHost [data-a="startTplName"],#lbHost [data-a="startTpl"]').click(); await w(400);
        const look = () => { const h = document.querySelector(".lb-rest:not([hidden])"), t = h && h.querySelector(".lb-rest-time"); return { style: h && h.dataset.style, full: !!(h && h.classList.contains("full")), font: t && getComputedStyle(t).fontSize }; };
        document.querySelector('.lb-live [data-a="check"]').click(); await w(200);
        out.list = look(); document.querySelector('[data-a="restSkip"]').click();
        document.querySelector('[data-a="gymToggle"]').click(); await w(200);
        document.querySelector('[data-a="gDone"]').click(); await w(200);
        out.gym = look(); out.setting = WorkoutLogger.settings().restStyle;
        document.querySelector('[data-a="restSkip"]').click();
        return out;
      });
      assert.strictEqual(r.setting, "ring", "Gym mode doesn't change the saved look");
      assert.deepStrictEqual(r.gym, r.list, "the Gym mode rest timer is the same full-screen ring as the List view: " + JSON.stringify(r));
      assert.ok(r.gym.full && r.gym.style === "ring");
      assert.deepStrictEqual(errors, []);
      await page.close();
    });

    await t.test("rest timer: every look renders, full-screen looks minimise, the picked sound plays", async () => {
      const { page, errors } = await openApp(browser, PHONES[0], seed);
      await go(page, "settings");
      assert.strictEqual(await page.$$eval('[data-act="lbpick"][data-s="restStyle"]', b => b.length), 6, "six looks in Settings");
      assert.ok(await page.$$eval('[data-act="lbpick"][data-s="restSound"]', b => b.length) >= 7, "rest sounds in Settings");
      await page.evaluate(() => { window.played = []; GymSounds.play = n => { played.push(n); return true; }; });
      await page.click('[data-act="lbpick"][data-s="restSound"][data-k="boxing"]');
      assert.strictEqual(await page.evaluate(() => WorkoutLogger.settings().restSound), "boxing");
      assert.ok(await page.evaluate(() => played.includes("boxing")), "tapping a sound previews it");
      const vis = sel => page.evaluate(sel => [...document.querySelectorAll(sel)].some(e => e.offsetParent || getComputedStyle(e).position === "fixed"), sel);
      for (const [look, sel] of [["bar", ".lb-rest-bar"], ["half", ".lb-rest-half"], ["ring", ".lb-rest-ring"], ["fill", ".lb-rest-level"], ["plates", ".lb-rest-plates"], ["blocks", ".lb-rest-blocks"]]) {
        await page.evaluate(l => { WorkoutLogger.setSettings({ restStyle: l }); WorkoutLogger.previewRest(30); }, look);
        await page.waitForTimeout(80);
        assert.ok(await vis(".lb-rest:not([hidden]) " + sel), look + " renders");
        assert.strictEqual(await page.evaluate(() => !!document.querySelector(".lb-rest.full[role=dialog]")), look === "ring" || look === "fill", look + " full screen");
        if (look === "ring") {
          await page.click('.lb-rest.full [data-a="restMini"]');
          assert.ok(await vis(".lb-rest:not([hidden]) .lb-rest-bar") && !(await page.$(".lb-rest.full")), "Minimise drops to the bar");
        }
        await page.evaluate(() => [...document.querySelectorAll('[data-a="restSkip"]')].forEach(b => b.offsetParent && b.click()));
      }
      // Your own sound: a WAV from the phone is kept in IndexedDB and becomes the rest sound
      assert.ok(await page.$$eval('[data-act="lbpick"][data-s="restSound"]', b => b.some(x => /Power-up/.test(x.textContent))), "anime-style pack listed");
      await page.setInputFiles("#restSoundFile", { name: "my-clip.wav", mimeType: "audio/wav", buffer: Buffer.from(require("../modules/gym-sounds/gym-sounds.js").wav("knock", 22050)) });
      await page.waitForFunction(() => WorkoutLogger.settings().restSound === "custom", null, { timeout: 5000 });
      assert.ok(await page.$('[data-act="lbpick"][data-k="custom"]'), "Use my sound chip appears");
      assert.strictEqual(await page.evaluate(() => GymSounds.customInfo().name), "my-clip.wav");
      await page.click('[data-act="lbsndclear"]');
      await page.waitForFunction(() => !GymSounds.customInfo() && WorkoutLogger.settings().restSound === "restDone", null, { timeout: 5000 });
      await page.evaluate(() => WorkoutLogger.setSettings({ restSound: "boxing" }));
      await page.evaluate(() => { played.length = 0; window.buzz = []; navigator.vibrate = ms => { if (typeof ms === "number") buzz.push(ms); return true; }; WorkoutLogger.setSettings({ restStyle: "plates", sound: true, vibrate: false }); WorkoutLogger.previewRest(5); });
      await page.waitForFunction(() => played.length > 0, null, { timeout: 8000 });
      assert.deepStrictEqual(await page.evaluate(() => played), ["boxing"], "rest over plays the picked sound");
      assert.deepStrictEqual(await page.evaluate(() => buzz), [120, 120, 220], "buzz at 3, 2 and 1 before the sound");
      assert.deepStrictEqual(errors, []);
      await page.close();
    });

    await t.test("settings and friends: the sign-in button opens the sign-in sheet (build 119-137 shipped it dead)", async () => {
      const { page, errors } = await openApp(browser, PHONES[0], seed);
      // Device-only mode with a cloud config present: Settings and Friends offer "Sign in or create account".
      await page.evaluate(() => { window.connectCalls = 0; CloudStore.connect = () => { connectCalls++; return Promise.resolve(null); }; });
      for (const tab of ["settings", "friends"]) {
        await go(page, tab);
        const btn = await page.$('#main [data-act="cloudsignin"]');
        assert.ok(btn, tab + " shows the sign-in button");
        await btn.click();
        await page.waitForTimeout(100);
      }
      assert.strictEqual(await page.evaluate(() => connectCalls), 2, "each tap opens the sign-in flow");
      assert.strictEqual(await page.$eval('#main [data-act="cloudsignin"]', b => b.disabled), false, "button is usable again after 'Use without an account'");
      assert.deepStrictEqual(errors, []);
      await page.close();
    });

    await t.test("guide: search filters sections and jump chips exist; progress has five sections", async () => {
      const { page, errors } = await openApp(browser, PHONES[0], seed);
      await go(page, "guide");
      assert.ok((await page.$$('.jump .chip')).length >= 7, "jump chips");
      await page.fill("#libq", "creatine"); await page.waitForTimeout(150);
      const cards = await page.$$eval('#main .card.guide h3', els => els.map(e => e.textContent));
      assert.deepStrictEqual(cards, ["Supplements"]);
      await go(page, "progress");
      const tabs = await page.$$eval('.subnav [data-act="ptab"]', els => els.map(e => e.textContent));
      assert.deepStrictEqual(tabs, ["Your day", "Weight", "Lifts", "Food", "Reviews"]);
      await page.click('[data-act="ptab"][data-k="reviews"]'); await page.waitForTimeout(100);
      assert.ok(await page.$('details.fold[data-keep="f:wr"]'), "weekly report folded under Reviews");
      assert.deepStrictEqual(errors, []);
      await page.close();
    });

    await t.test("warm light look: coral accent by default, warm neutrals in light and dark, cards rise in on a tab change", async () => {
      const { page, errors } = await openApp(browser, PHONES[0], seed);
      const read = () => page.evaluate(() => { const cs = getComputedStyle(document.documentElement); return { accent: document.documentElement.dataset.accent, bg: cs.getPropertyValue("--bg").trim(), protein: cs.getPropertyValue("--protein").trim(), rise: document.querySelectorAll("#main > .anim-rise").length }; });
      const light = await read();
      assert.strictEqual(light.accent, "coral");
      assert.strictEqual(light.bg.toUpperCase(), "#F7F5F0");
      assert.strictEqual(light.protein.toUpperCase(), "#0F8B8D");
      await page.emulateMedia({ colorScheme: "dark" }); await page.waitForTimeout(50);
      const dark = await read();
      assert.strictEqual(dark.bg.toUpperCase(), "#15120F");
      await go(page, "food");
      assert.ok((await read()).rise > 0, "cards get the rise animation after a tab change");
      await go(page, "settings");
      const chips = await page.$$eval('[data-act="accent"]', els => els.map(e => e.dataset.k));
      assert.deepStrictEqual(chips, ["coral", "red", "orange", "yellow", "green", "teal", "blue", "purple", "pink", "white"]);
      const labels = await page.$$eval('[data-act="accent"]', els => els.map(e => e.textContent.trim()));
      assert.strictEqual(labels[0], "Default", "the warm brown stays the default choice");
      assert.ok(labels.every(l => !/kg/.test(l)), "colour names, not plate weights: " + labels.join(", "));
      await page.click('[data-act="accent"][data-k="blue"]');
      await page.waitForTimeout(300);
      const blue = await page.evaluate(() => ({ a: document.documentElement.dataset.accent, v: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(), on: document.querySelector('[data-act="accent"][data-k="blue"]').getAttribute("aria-pressed") }));
      assert.strictEqual(blue.a, "blue");
      assert.ok(["#1F5FD1", "#6B9BF5"].includes(blue.v.toUpperCase()), "accent recolours the app: " + blue.v);
      assert.strictEqual(blue.on, "true");
      await page.click('[data-act="accent"][data-k="coral"]');
      await page.waitForTimeout(300);
      assert.deepStrictEqual(errors, []);
      await page.close();
    });

    await t.test("ticking sets never hides a row: every template, every set (Aziz's bench warm-ups vanished after the 4th tick)", async () => {
      const { page, errors } = await openApp(browser, PHONES[0], seed);
      await openTrain(page);
      const tap = (a, id) => page.evaluate(([a, id]) => { const b = [...document.querySelectorAll(`[data-a="${a}"]` + (id ? `[data-id="${id}"]` : ""))].filter(e => e.offsetParent).pop(); if (b) b.click(); return !!b; }, [a, id]);
      const tpls = await page.$$eval('[data-a="tplPreview"]', b => [...new Set(b.map(e => e.dataset.id))]);
      assert.ok(tpls.length >= 6, "all program templates listed (" + tpls.length + ")");
      let checked = 0;
      for (const id of tpls) {
        await tap("tplPreview", id); await page.waitForTimeout(80);
        await tap("startTpl"); await page.waitForSelector('[data-a="check"]');
        const rows = () => page.$$eval('.lb-setrow[data-si]', r => r.filter(e => e.offsetParent).map(e => e.dataset.ei + ":" + e.dataset.si));
        const all = await rows();
        assert.ok(all.length > 0, id + " has sets");
        for (const key of all) {
          const [ei, si] = key.split(":");
          await page.evaluate(([ei, si]) => {
            const row = document.querySelector(`.lb-setrow[data-ei="${ei}"][data-si="${si}"]`);
            row.querySelectorAll("input.lb-cell").forEach(c => { if (!c.value && !c.placeholder) { c.value = "1"; c.dispatchEvent(new Event("input", { bubbles: true })); } });
            row.querySelector('[data-a="check"]').click();
          }, [ei, si]);
          await page.waitForTimeout(20);
          const now = await rows();
          assert.deepStrictEqual(now, all, `${id}: ticking set ${key} changed the visible rows`);
          assert.ok(await page.evaluate(([ei, si]) => document.querySelector(`.lb-setrow[data-ei="${ei}"][data-si="${si}"]`).classList.contains("done"), [ei, si]), `${id}: set ${key} shows as done`);
          checked++;
        }
        await page.evaluate(() => [...document.querySelectorAll('[data-a="restSkip"]')].forEach(b => b.offsetParent && b.click()));
        await page.evaluate(() => WorkoutLogger && document.querySelector('[data-a="askCancel"]').click());
        await tap("cancelLive"); await page.waitForTimeout(100);
        await page.waitForSelector('[data-a="tplPreview"]');
      }
      assert.ok(checked > 50, "ticked " + checked + " sets");
      assert.deepStrictEqual(errors, []);
      await page.close();
    });

    await t.test("Today tiles take you to their section: Water tile scrolls to the Water card, its chips still add water", async () => {
      const { page, errors } = await openApp(browser, PHONES[0], seed);
      const visible = sel => page.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight - 100; }, sel);
      assert.ok(!(await visible("#waterCard")), "Water card starts below the fold");
      await page.click(".dd-water .dd-cap1");
      await page.waitForTimeout(900);
      assert.ok(await visible("#waterCard"), "tapping the Water tile scrolls to the Water card");
      const before = await page.evaluate(() => getDay(TODAY).water);
      await page.click('.dd-water [data-act="water"][data-ml="250"]');
      assert.strictEqual(await page.evaluate(() => getDay(TODAY).water), before + 250, "the cell's + button still adds water");
      for (const [tile, target] of [[".dd-weight", "#wkg"], ['[data-act="dd-focus"][data-target="sleepH"]', "#sleepH"]]) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.click(tile);
        await page.waitForTimeout(900);
        assert.ok(await visible(target), `${tile} scrolls to ${target}`);
      }
      assert.deepStrictEqual(errors, []);
      await page.close();
    });

    await t.test("navigation setting: bottom bar and both, flashes after a change, demos start collapsed, list view once", async () => {
      const { page, errors } = await openApp(browser, PHONES[0], seed);
      await go(page, "settings");
      assert.strictEqual(await page.evaluate(() => document.documentElement.dataset.nav), "bottom", "bottom bar is the default");
      await page.click('[data-act="navset"][data-k="drawer"]'); await page.waitForTimeout(100);
      const dr = await page.evaluate(() => ({ nav: document.documentElement.dataset.nav, menu: getComputedStyle(document.getElementById("menuBtn")).display }));
      assert.strictEqual(dr.nav, undefined); assert.notStrictEqual(dr.menu, "none", "Side menu brings the ☰ button back");
      await page.click('[data-act="navset"][data-k="bottom"]'); await page.waitForTimeout(150);
      const b = await page.evaluate(() => ({ nav: document.documentElement.dataset.nav, bar: getComputedStyle(document.getElementById("bottomNav")).display, menu: getComputedStyle(document.getElementById("menuBtn")).display, pref: S.docs.prefs.main.nav }));
      assert.deepStrictEqual(b, { nav: "bottom", bar: "flex", menu: "none", pref: "bottom" });
      await page.click('#bottomNav button[data-tab="food"]'); await page.waitForTimeout(200);
      assert.strictEqual(await page.evaluate(() => view.tab + ":" + document.querySelector('#bottomNav button[aria-current="page"]').dataset.tab), "food:food");
      await page.evaluate(() => document.querySelector('[data-act="eat"]').click()); await page.waitForTimeout(80);
      assert.ok(await page.evaluate(() => document.querySelectorAll(".mbar .eaten.flash").length) >= 1, "macro bars glow after ticking food");
      await page.click('#bottomNav button[data-more]'); await page.waitForTimeout(100);
      assert.strictEqual(await page.evaluate(() => document.getElementById("drawer").hidden), false, "More opens the menu");
      // The ☰ button is hidden in bottom mode, so Settings is reached through More.
      await page.click("#openSettings"); await page.waitForTimeout(150);
      await page.click('[data-act="navset"][data-k="both"]'); await page.waitForTimeout(100);
      const both = await page.evaluate(() => ({ nav: document.documentElement.dataset.nav, menu: getComputedStyle(document.getElementById("menuBtn")).display, guide: getComputedStyle(document.querySelector('#bottomNav button[data-tab="guide"]')).display, more: getComputedStyle(document.querySelector('#bottomNav button[data-more]')).display }));
      assert.strictEqual(both.nav, "both"); assert.notStrictEqual(both.menu, "none", "menu button stays in Both mode"); assert.notStrictEqual(both.guide, "none"); assert.strictEqual(both.more, "none");
      await page.click('[data-act="navset"][data-k="drawer"]'); await page.waitForTimeout(100);
      assert.strictEqual(await page.evaluate(() => document.documentElement.dataset.nav), undefined);
      // Text size slider scales every rem-sized thing from the 15px base and is saved in prefs.
      const fs = () => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
      assert.strictEqual(await fs(), 15, "default text size is the compact 15px base");
      await page.evaluate(() => { const r = document.getElementById("uiScale"); r.value = "0.85"; r.dispatchEvent(new Event("input", { bubbles: true })); r.dispatchEvent(new Event("change", { bubbles: true })); });
      await page.waitForTimeout(100);
      assert.ok(Math.abs(await fs() - 12.75) < 0.01, "slider shrinks the text");
      assert.strictEqual(await page.evaluate(() => S.docs.prefs.main.uiScale), 0.85, "text size is saved");
      await page.click('[data-act="scalereset"]'); await page.waitForTimeout(100);
      assert.strictEqual(await fs(), 15, "Reset goes back to the default size");
      await openTrain(page);
      const lg = await page.evaluate(async () => { const s = WorkoutLogger.settings(); const btn = [...document.querySelectorAll('#lbHost [data-a="startTplName"],#lbHost [data-a="startTpl"]')][0]; btn.click(); await new Promise(r => setTimeout(r, 400)); const tog = document.querySelectorAll(".lb-live-body .lb-demo-toggle").length, before = document.querySelectorAll(".lb-live-body .ea-card").length; const t = document.querySelector(".lb-live-body .lb-demo-toggle"); if (t) t.click(); await new Promise(r => setTimeout(r, 200)); return { gym: s.gym, listOnce: s.listOnce, tog, before, after: document.querySelectorAll(".lb-live-body .ea-card").length }; });
      assert.strictEqual(lg.gym, false, "live workouts open in List view");
      assert.strictEqual(lg.listOnce, true);
      assert.ok(lg.tog > 0 && lg.before === 0 && lg.after === 1, "demos start collapsed and one opens on tap: " + JSON.stringify(lg));
      assert.deepStrictEqual(errors, []);
      await page.close();
    });

    await t.test("workout logger: the green 'Beat last time' line shows for a lift done before, in List view and after ticking a set", async () => {
      // Regression guard (Aziz, Nov 3): this motivating line must never silently vanish from the live workout.
      const { page, errors } = await openApp(browser, PHONES[0], seed);
      await openTrain(page);
      const startPushA = () => page.evaluate(async () => { const b = document.createElement("button"); b.dataset.a = "startTpl"; b.dataset.id = "push-a"; document.getElementById("lbHost").appendChild(b); b.click(); b.remove(); await new Promise(r => setTimeout(r, 300)); });
      const hints = () => page.evaluate(() => [...document.querySelectorAll(".lb-live-body .lb-hint")].map(e => e.textContent));
      await startPushA();
      assert.deepStrictEqual(await hints(), [], "no line before there is any history");
      // Log 60 kg × 10 on every working set of Push A, tick them all and finish.
      await page.evaluate(async () => {
        document.querySelectorAll(".lb-live-body .lb-setrow:not(.head)").forEach(r => [["w", "60"], ["r", "10"]].forEach(([k, v]) => { const i = r.querySelector(`input[data-k="${k}"]`); if (i) { i.value = v; i.dispatchEvent(new Event("input", { bubbles: true })); } }));
        for (const c of [...document.querySelectorAll(".lb-live-body .lb-chk")]) { const x = document.querySelector(`.lb-chk[data-ei="${c.dataset.ei}"][data-si="${c.dataset.si}"]`); if (x && x.getAttribute("aria-pressed") !== "true") x.click(); }
        document.querySelector('[data-a="finish"]').click(); await new Promise(r => setTimeout(r, 200));
        const keep = document.querySelector('[data-a="finishSave"][data-upd="0"]'); if (keep) keep.click(); await new Promise(r => setTimeout(r, 200));
        document.querySelectorAll('[data-a="closeSheet"]').forEach(b => b.click());
      });
      await startPushA();
      const h = await hints();
      assert.ok(h.length >= 3, "every weighted lift from last time gets the line: " + JSON.stringify(h));
      assert.ok(h.includes("Beat last time: aim for 60 kg × 11 on one set."), JSON.stringify(h));
      assert.strictEqual(await page.evaluate(() => getComputedStyle(document.querySelector(".lb-live-body .lb-hint")).display), "block", "and it is visible");
      await page.evaluate(() => document.querySelector(".lb-live-body .lb-chk").click()); await page.waitForTimeout(150);
      assert.strictEqual((await hints()).length, h.length, "ticking a set keeps the line");
      // Cancel workout (Aziz, Nov 3): Gym mode and the Finish sheet offer it, it asks first, and it saves nothing.
      await page.evaluate(async () => { document.querySelector('[data-a="gymToggle"]').click(); await new Promise(r => setTimeout(r, 150)); });
      assert.ok(await page.evaluate(() => [...document.querySelectorAll('[data-a="askDiscard"]')].some(b => b.offsetParent)), "Gym mode shows Cancel workout");
      await page.evaluate(async () => { document.querySelector('[data-a="gymToggle"]').click(); await new Promise(r => setTimeout(r, 150)); });
      const sheet = await page.evaluate(async () => {
        const r = document.querySelector(".lb-live-body .lb-setrow:not(.head)"), i = r.querySelector('input[data-k="w"]'); i.value = "99"; i.dispatchEvent(new Event("input", { bubbles: true }));
        document.querySelector('[data-a="finish"]').click(); await new Promise(r => setTimeout(r, 150));
        const ask = [...document.querySelectorAll('[data-a="askDiscard"]')].pop(); if (!ask) return null; ask.click(); await new Promise(r => setTimeout(r, 150));
        const conf = [...document.querySelectorAll('[data-a="cancelLiveFromSheet"]')].pop(), txt = conf && conf.closest('[role="dialog"], .lb-sheet') ? conf.closest('[role="dialog"], .lb-sheet').textContent : '';
        if (conf) conf.click(); await new Promise(r => setTimeout(r, 200));
        return { txt, active: localStorage.getItem("lb_active") };
      });
      assert.ok(sheet, "the Finish sheet offers Cancel workout");
      assert.match(sheet.txt, /Nothing from it will be saved/, "it asks before discarding");
      assert.strictEqual(sheet.active, "null", "no workout is in progress afterwards");
      await startPushA();
      assert.ok((await hints()).includes("Beat last time: aim for 60 kg × 11 on one set."), "the cancelled 99 kg session was not saved and the past workout is untouched");
      // Train page (workout hidden): Finish workout / End workout sit under the Resume bar; End asks, then discards.
      const end = await page.evaluate(async () => {
        const w = ms => new Promise(r => setTimeout(r, ms));
        document.querySelector('[data-a="minimize"]').click(); await w(150);
        const fin = !!document.querySelector('[data-a="barFinish"]'), b = document.querySelector('[data-a="barEnd"]'); if (!b) return { fin };
        b.click(); await w(150);
        const c = [...document.querySelectorAll('[data-a="cancelLiveFromSheet"]')].pop(); if (c) c.click(); await w(200);
        return { fin, asked: !!c, active: localStorage.getItem("lb_active"), bar: !!document.querySelector('[data-a="barEnd"]') };
      });
      assert.deepStrictEqual(end, { fin: true, asked: true, active: "null", bar: false }, "Train page Finish/End workout");
      assert.deepStrictEqual(errors, []);
      await page.close();
    });

    await t.test("goal setup: opens first for a new install, Skip is remembered, Settings reruns it, the result applies only on confirm", async () => {
      const { page, errors } = await openApp(browser, PHONES[0], null, { keepSetup: true });
      assert.ok(await page.$('.gs-wrap[role="dialog"]'), "a fresh install starts on the questionnaire");
      // Regression (Aziz, Nov 2): on a signed-in phone the local cache is empty until the cloud answers, and the
      // questionnaire opened on every launch. Before the store has decided, an empty cache must not count as "new user".
      const early = await page.evaluate(() => { document.querySelector(".gs-wrap").remove(); gsOpen = null; gsFirstRunChecked = false; storeReady = false; render(); const opened = !!document.querySelector(".gs-wrap"); storeReady = true; render(); return { opened, later: !!document.querySelector(".gs-wrap") }; });
      assert.strictEqual(early.opened, false, "nothing opens while the store is still deciding");
      assert.strictEqual(early.later, true, "and it opens once the store has settled with no data");
      assert.ok(await page.$('.gs-wrap [data-gs="skip"]'), "a new user can skip it");
      await page.click('.gs-wrap [data-gs="skip"]');
      await page.waitForFunction(() => !document.querySelector(".gs-wrap"));
      await page.reload(); await page.waitForFunction(() => document.querySelector("#main").children.length > 0); await page.waitForTimeout(200);
      assert.strictEqual(await page.$(".gs-wrap"), null, "Skip is remembered across opens");
      const seeded = await openApp(browser, PHONES[0], seed, { keepSetup: true });
      assert.strictEqual(await seeded.page.$(".gs-wrap"), null, "someone with entries (Aziz) is never interrupted");
      await go(seeded.page, "settings");
      await seeded.page.click('#main [data-act="goalsetup"]');
      const p2 = seeded.page, before = await p2.evaluate(() => kcalTarget(TODAY));
      const wide = async () => p2.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(await p2.$(".gs-wrap"), "Settings → Your numbers → Start opens it");
      assert.ok(await p2.$(".gs-wrap svg.gs-art"), "each step has an illustration");
      await p2.click('.gs-wrap [data-gs="next"]');
      assert.ok(await p2.$(".gs-wrap .gs-err"), "empty answers show what is missing");
      await p2.click('.gs-wrap [data-gs="pick"][data-v="male"]');
      await p2.fill('.gs-wrap [data-gs-f="age"]', "29"); await p2.fill('.gs-wrap [data-gs-f="heightCm"]', "172");
      assert.strictEqual(await p2.$eval('.gs-wrap [data-gs-f="kg"]', i => i.value), "90.1", "weight is prefilled from the latest weigh-in");
      // Optional body fat + waist: method and date are stored, both become Health markers entries
      await p2.evaluate(() => { document.querySelector(".gs-wrap details.gs-more").open = true; });
      await p2.fill('.gs-wrap [data-gs-f="bodyFatPct"]', "22"); await p2.selectOption('.gs-wrap [data-gs-f="bodyFatMethod"]', "calipers"); await p2.fill('.gs-wrap [data-gs-f="waistCm"]', "95");
      assert.ok((await wide()) <= 1, "about step with the optional block fits the phone");
      await p2.click('.gs-wrap [data-gs="next"]'); assert.ok((await wide()) <= 1, "activity step fits the phone");
      await p2.click('.gs-wrap [data-gs="pick"][data-v="moderate"]'); await p2.click('.gs-wrap [data-gs="next"]');
      // Goals are multi-select: lose fat + build muscle is a recomp (no aggressive/extreme pace, protein 2.2 g/kg)
      await p2.click('.gs-wrap [data-gs="goal"][data-v="cut"]'); await p2.click('.gs-wrap [data-gs="goal"][data-v="muscle"]');
      const pressed = await p2.$$eval('.gs-wrap [data-gs="goal"][aria-pressed="true"]', els => els.map(e => e.dataset.v));
      assert.deepStrictEqual(pressed, ["cut", "muscle"], "both goals stay selected");
      await p2.click('.gs-wrap [data-gs="goal"][data-v="maintain"]');
      assert.deepStrictEqual(await p2.$$eval('.gs-wrap [data-gs="goal"][aria-pressed="true"]', els => els.map(e => e.dataset.v)), ["maintain", "muscle"], "a second direction replaces the first");
      await p2.click('.gs-wrap [data-gs="goal"][data-v="cut"]'); await p2.click('.gs-wrap [data-gs="next"]');
      assert.deepStrictEqual(await p2.$$eval('.gs-wrap [data-gs="pick"][data-k="pace"]', els => els.map(e => e.dataset.v)), ["easy", "regular"], "recomp offers only the gentle paces");
      await p2.click('.gs-wrap [data-gs="pick"][data-v="regular"]'); await p2.fill('.gs-wrap [data-gs-f="targetKg"]', "80"); await p2.click('.gs-wrap [data-gs="next"]');
      await p2.waitForSelector(".gs-wrap .gs-hero");
      assert.match(await p2.evaluate(() => document.querySelector(".gs-wrap .gs-sub").textContent), /Lose fat \+ Build muscle/);
      assert.ok((await wide()) <= 1, "result step fits the phone");
      const r = await p2.evaluate(() => ({ hero: document.querySelector(".gs-hero").textContent, ms: document.querySelectorAll(".gs-ms div").length, cmp: !!document.querySelector(".gs-cmp"), kcal: kcalTarget(TODAY), cyc: document.querySelector('.gs-wrap [data-gs-c="cycling"]') ? document.querySelector('.gs-wrap [data-gs-c="cycling"]').checked : null }));
      assert.match(r.hero, /Maintenance about/); assert.ok(r.ms >= 2, "milestones with dates"); assert.ok(r.cmp, "existing numbers are compared, not overwritten");
      assert.strictEqual(r.kcal, before, "nothing changes before confirm");
      const bodyTxt = await p2.evaluate(() => document.querySelector(".gs-wrap .gs-body").textContent);
      assert.match(bodyTxt, /Lean mass about [\d.]+ kg/); assert.match(bodyTxt, /±4 points by calipers/); assert.match(bodyTxt, /not a body-fat measurement/); assert.match(bodyTxt, /treat it as a range/);
      assert.strictEqual(r.cyc, false, "lift-day calorie shift is offered, off by default");
      await p2.click('.gs-wrap [data-gs-c="cycling"]');
      await p2.click('.gs-wrap [data-gs="apply"]');
      await p2.waitForFunction(() => !document.querySelector(".gs-wrap"));
      const after = await p2.evaluate(() => ({ kcal: kcalTarget(TODAY), prof: S.docs.prefs.main.profile, gs: S.docs.prefs.main.goalSetup, floor: KCAL_FLOOR, cyc: S.docs.prefs.main.cycling, base: APPT.kcal }));
      assert.ok(after.base !== before && after.base === after.prof.cutKcal, "confirm applies the calories everywhere");
      assert.strictEqual(after.prof.goalKg, 80); assert.strictEqual(after.gs.answers.goal, "cut"); assert.deepStrictEqual(after.gs.answers.goals, ["cut", "muscle"]); assert.strictEqual(after.gs.result.proteinPerKg, 2.2); assert.strictEqual(after.floor, after.prof.kcalFloor);
      assert.strictEqual(after.cyc && after.cyc.on, true, "ticking the box turns calorie cycling on");
      assert.strictEqual(after.gs.answers.bodyFatPct, 22); assert.strictEqual(after.gs.answers.bodyFatMethod, "calipers"); assert.strictEqual(after.gs.answers.bodyFatAt, await p2.evaluate(() => TODAY)); assert.strictEqual(after.gs.result.tdeeSource, "bodyfat");
      const mk = await p2.evaluate(() => Object.values(S.docs.markers || {}).map(m => [m.preset, (m.entries || []).map(e => e.v)]).sort());
      assert.deepStrictEqual(mk, [["bodyfat", [22]], ["waist", [95]]], "both measurements are logged as health markers once");
      assert.ok(Math.abs(after.kcal - after.base) <= 400 && after.kcal !== after.base, "today's target is the cycled one, lift or rest day");
      // Reviews shows the plan as phases: start, goal, and an optional return to maintenance; nothing mandatory
      await go(p2, "progress"); await p2.click('#main [data-act="ptab"][data-k="reviews"]');
      await p2.waitForSelector("#main .pc-phases");
      const ph = await p2.evaluate(() => ({ kinds: [...document.querySelectorAll("#main .pc-tl li")].map(l => l.className.split(" ")[0]), text: document.querySelector("#main .pc-phases").textContent, wide: document.documentElement.scrollWidth - window.innerWidth }));
      assert.ok(ph.kinds[0] === "start" && ph.kinds.includes("goal") && ph.kinds[ph.kinds.length - 1] === "after", JSON.stringify(ph.kinds));
      assert.match(ph.text, /Maintenance means eating about what you burn/); assert.match(ph.text, /never switches your calories on its own/); assert.doesNotMatch(ph.text, /mandatory/);
      assert.ok(ph.wide <= 1, "phases card fits the phone");
      // Logging a weight a kilo away from the plan's weight offers an update; closer does not.
      await go(p2, "today");
      await p2.fill("#wkg", "90.6"); await p2.click('form[data-form="weight"] button[type=submit]');
      assert.strictEqual(await p2.$(".toast .undo"), null, "0.5 kg moves nothing");
      await p2.fill("#wkg", "89.0"); await p2.click('form[data-form="weight"] button[type=submit]'); await p2.waitForTimeout(100);
      await p2.fill("#wkg", "89.0"); await p2.click('form[data-form="weight"] button[type=submit]');     // outlier guard asks for a second tap
      await p2.waitForSelector(".toast .undo");
      assert.match(await p2.$eval(".toast:has(.undo)", t => t.textContent), /Update your plan/);
      await p2.click(".toast .undo");
      assert.ok(await p2.$(".gs-wrap"), "Update reopens the questionnaire");
      assert.strictEqual(await p2.$eval('.gs-wrap [data-gs-f="kg"]', i => i.value), "89", "with the new weight");
      assert.deepStrictEqual(errors, []); assert.deepStrictEqual(seeded.errors, []);
      await page.close(); await p2.close();
    });

    await t.test("milestones: trend-based weight numbers and workout counts, celebrated once, old ones recorded quietly", async () => {
      // 61 days losing 0.5 kg/wk from 91.9 (the trend passed 90 kg weeks ago) and 10 workouts, the tenth yesterday.
      const seedMs = today => {
        const d = { weights: {}, days: {}, workouts: {}, prefs: {} };
        for (let i = 0; i < 61; i++) { const date = addDays(today, -(60 - i)); d.weights[date] = { date, kg: Math.round((91.9 - 0.5 * i / 7) * 10) / 10 }; }
        for (let i = 0; i < 10; i++) { const date = addDays(today, -(1 + i * 3)); d.workouts[date] = { date, session: "Push A", sets: { "Bench Press": [{ w: 80, r: 8 }] } }; }
        return d;
      };
      const { page, errors } = await openApp(browser, PHONES[0], seedMs);
      await page.evaluate(() => { const a = { sex: "male", age: 29, heightCm: 172, kg: 91.9, activity: "moderate", goal: "cut", pace: "regular", targetKg: 80 }; const start = addDays(TODAY, -60); const r = GoalSetup.compute(a, { today: start }); const p = clone(S.docs.prefs.main || {}); p.profile = { ...(p.profile || {}), ...r.profile }; p.goalSetup = { answers: a, result: r, at: start + "T07:00:00Z" }; put("prefs", "main", p); });
      await page.waitForTimeout(150);
      const st = await page.evaluate(() => ({ toast: [...document.querySelectorAll(".toast")].map(t => t.textContent), seen: Object.keys(S.docs.prefs.main.milestones || {}).sort(), card: document.querySelector('#main details[data-keep="f:ms"]') ? document.querySelector('#main details[data-keep="f:ms"]').textContent : "" }));
      assert.ok(st.seen.includes("kg:90") && st.seen.includes("workouts:10"), JSON.stringify(st.seen));
      assert.ok(st.toast.some(t => /10 workouts logged/.test(t)), "the fresh one (yesterday) is celebrated: " + JSON.stringify(st.toast));
      assert.ok(!st.toast.some(t => /90 kg/.test(t)), "the weeks-old weight milestone is recorded without a toast");
      assert.match(st.card, /90 kg on the trend/); assert.match(st.card, /10 workouts logged/); assert.match(st.card, /Next up:/);
      await page.reload(); await page.waitForFunction(() => document.querySelector("#main").children.length > 0); await page.waitForTimeout(150);
      assert.deepStrictEqual(await page.evaluate(() => [...document.querySelectorAll(".toast")].map(t => t.textContent).filter(t => /logged|on the trend|est\. 1RM|steady/.test(t))), [], "nothing fires twice");
      assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1);
      assert.deepStrictEqual(errors, []);
      await page.close();
    });

    await t.test("workout: hold an exercise name and drag it to reorder; its sets go with it and nothing opens", async () => {
      const { page, errors } = await openApp(browser, PHONES[0], seed);
      await go(page, "train");
      await page.evaluate(() => document.querySelector('[data-a="startEmpty"]').click()); await page.waitForTimeout(250);
      await page.evaluate(() => document.querySelector('.lb-live [data-a="addEx"]').click()); await page.waitForTimeout(250);
      await page.evaluate(() => [...document.querySelectorAll('.lb-sheet .lb-exrow')].filter(r => !/bike|run|row/i.test(r.textContent)).slice(0, 3).forEach(r => r.click()));
      await page.evaluate(() => document.querySelector('[data-a="pickDone"]').click()); await page.waitForTimeout(250);
      await page.evaluate(() => { document.querySelector('.lb-live-body').scrollTop = 0; const i = document.querySelector('.lb-exblock[data-ei="0"] input[data-k="r"]'); i.value = "12"; i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true })); });
      const names = () => page.evaluate(() => [...document.querySelectorAll(".lb-exblock .lb-exhead .lb-link")].map(x => x.textContent));
      const before = await names();
      const hd = await page.locator('.lb-exblock[data-ei="0"] .lb-exhead .lb-link').boundingBox();
      const cdp = await page.context().newCDPSession(page);
      const x = hd.x + 30, y = hd.y + hd.height / 2;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      await page.waitForTimeout(550);
      assert.ok(await page.evaluate(() => document.querySelector(".lb-live").classList.contains("lb-reordering")), "holding folds the list");
      const held = await page.locator(".lb-exblock.dragging").boundingBox();
      for (let i = 1; i <= 15; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: held.y + held.height / 2 + i * 14 }] }); await page.waitForTimeout(16); }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.waitForTimeout(300);
      const after = await names();
      assert.deepStrictEqual(after, [before[1], before[2], before[0]], "first exercise dropped at the end");
      const r = await page.evaluate(() => ({ reps: document.querySelector('.lb-exblock[data-ei="2"] input[data-k="r"]').value, folded: document.querySelector(".lb-live").classList.contains("lb-reordering"), sheets: document.querySelectorAll(".lb-sheet").length }));
      assert.strictEqual(r.reps, "12", "the set typed before the drag moved with its exercise");
      assert.strictEqual(r.folded, false); assert.strictEqual(r.sheets, 0, "the hold did not open the exercise");
      // A quick tap still opens the exercise as before.
      await page.waitForTimeout(300);
      const sheetsBefore = await page.evaluate(() => document.querySelectorAll(".lb-sheet").length);
      await page.locator('.lb-exblock[data-ei="0"] .lb-exhead .lb-link').tap(); await page.waitForTimeout(250);
      assert.ok(await page.evaluate(n => document.querySelectorAll(".lb-sheet").length > n, sheetsBefore), "a tap still opens the exercise");
      assert.deepStrictEqual(errors, []);
      await page.close();
    });

    await t.test("plan check: two weeks of logs → estimate card with a range, weekly report plan line, apply only on tap", async () => {
      // 28 days of weigh-ins losing 0.15 kg/wk while eating 2,370: slower than the plan's 0.46, so the estimate is lower and a change is offered.
      const seedPlan = today => {
        const d = { weights: {}, days: {}, workouts: {}, prefs: {} };
        for (let i = 0; i < 28; i++) { const date = addDays(today, -(27 - i)); d.weights[date] = { date, kg: Math.round((91.9 - 0.15 * i / 7) * 10) / 10 }; d.days[date] = { date, food: [{ id: "a", name: "Food", kcal: 2370, p: 180, c: 250, f: 65, eaten: true }], water: 0, supps: {}, treadmill: false }; }
        return d;
      };
      const { page, errors } = await openApp(browser, PHONES[0], seedPlan);
      await page.evaluate(() => { const a = { sex: "male", age: 29, heightCm: 172, kg: 91.9, activity: "moderate", goal: "cut", pace: "regular", targetKg: 80 }; const start = addDays(TODAY, -27); const r = GoalSetup.compute(a, { today: start }); const p = clone(S.docs.prefs.main || {}); p.profile = { ...(p.profile || {}), ...r.profile }; p.goalSetup = { answers: a, result: r, at: start + "T07:00:00Z" }; put("prefs", "main", p); });
      await page.waitForTimeout(200);
      const before = await page.evaluate(() => ({ kcal: kcalTarget(TODAY), nudge: !!document.querySelector('#main [data-act="pcgo"]'), R: planCheck() }));
      assert.strictEqual(before.R.status, "ready", JSON.stringify(before.R.reasons));
      assert.strictEqual(before.R.verdict, "offer"); assert.ok(before.nudge, "Today shows the plan-check nudge");
      await page.click('#main [data-act="pcgo"]');
      await page.waitForSelector("#main .pc-card [data-pc=\"apply\"]");
      const card = await page.evaluate(() => ({ text: document.querySelector("#main .pc-card").textContent, wide: document.documentElement.scrollWidth - window.innerWidth, wr: document.querySelector("#main .wr-verdict") ? document.querySelector("#main .wr-verdict").textContent : "" }));
      assert.match(card.text, /Estimated maintenance/); assert.match(card.text, /about [\d,]+–[\d,]+ kcal/); assert.match(card.text, /Nothing changes unless you tap/);
      assert.ok(card.wide <= 1, "plan check card fits the phone");
      await page.evaluate(() => { const f = document.querySelector('#main details[data-keep="f:wr"]'); if (f) f.open = true; });
      const wr = await page.evaluate(() => document.querySelector("#main .wr-verdict") ? document.querySelector("#main .wr-verdict").textContent : "");
      assert.match(wr, /Plan: lose about 0.46 kg a week/); assert.match(wr, /Slower than planned|On plan|Faster/); assert.doesNotMatch(wr, /water likely/);
      // "Ask again in a week" changes nothing; "Use N kcal" applies and keeps the start date
      await page.click('#main .pc-card [data-pc="later"]');
      await page.waitForTimeout(150);
      const later = await page.evaluate(() => ({ kcal: kcalTarget(TODAY), rc: S.docs.prefs.main.goalSetup.recheck.decision, card: document.querySelector("#main .pc-card").textContent }));
      assert.strictEqual(later.kcal, before.kcal); assert.strictEqual(later.rc, "later"); assert.match(later.card, /reminded on/);
      await page.evaluate(() => { const p = clone(S.docs.prefs.main); delete p.goalSetup.recheck; put("prefs", "main", p); });
      await page.waitForSelector('#main .pc-card [data-pc="apply"]');
      await page.click('#main .pc-card [data-pc="apply"]');
      await page.waitForTimeout(150);
      const after = await page.evaluate(() => ({ kcal: kcalTarget(TODAY), prof: S.docs.prefs.main.profile, gs: S.docs.prefs.main.goalSetup, card: document.querySelector("#main .pc-card").textContent }));
      assert.ok(after.kcal < before.kcal && after.kcal === after.prof.cutKcal, "applied calories drive the day target: " + after.kcal);
      assert.strictEqual(after.prof.start, addDays(await page.evaluate(() => TODAY), -27), "plan start date is kept");
      assert.strictEqual(after.gs.result.profile.goalKg, 80); assert.strictEqual(after.gs.recheck.decision, "apply");
      assert.match(after.card, /changed to [\d,]+ kcal/);
      assert.deepStrictEqual(errors, []);
      await page.close();
    });

    for (const phone of PHONES) {
      await t.test(phone.name + ": every tab renders with no errors and no sideways scroll", async () => {
        for (const data of [null, seed]) {
          const { page, errors } = await openApp(browser, phone, data);
          for (const tab of TABS.concat("settings")) {
            await go(page, tab);
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
