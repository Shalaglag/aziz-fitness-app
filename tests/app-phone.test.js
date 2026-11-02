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

// Sections live in a side drawer (☰) since Oct 31: open it, then tap the section.
// The bottom bar is the default since Nov 1; its More button opens the same drawer when ☰ is hidden.
async function go(page, tab) { await page.evaluate(() => { const m = document.getElementById("menuBtn"); (getComputedStyle(m).display === "none" ? document.querySelector("#bottomNav button[data-more]") : m).click(); }); await page.click(tab === "settings" ? "#openSettings" : `#tabs button[data-tab="${tab}"]`); await page.waitForTimeout(150); }

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
      assert.deepStrictEqual(v, ["2,000", "870", "1,130"], "budget ignores the 450 kcal treadmill and 14k steps");
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
      await go(page, "train");
      await page.waitForFunction(() => !document.getElementById("lbHost").hidden && /Templates/.test(document.getElementById("lbHost").textContent));
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
      await go(page, "train");
      await page.waitForFunction(() => !document.getElementById("lbHost").hidden && /Templates/.test(document.getElementById("lbHost").textContent));
      await page.evaluate(() => { window.played = []; GymSounds.play = n => { played.push(n); return true; }; window.cues = []; ["lb:rest", "lb:rest-stop"].forEach(k => addEventListener(k, () => cues.push(k))); });
      // Quick log timer bar
      await page.evaluate(() => startTimer(1));
      await page.waitForFunction(() => played.includes("restDone"), null, { timeout: 4000 });
      assert.deepStrictEqual(await page.evaluate(() => cues), ["lb:rest", "lb:rest-stop"], "quick log tells the Android shell to schedule and cancel the rest notification");
      // Full logger: start a template, tick one set, Finish (through any confirm sheets)
      const finishOne = async () => {
        // Tap the newest visible match (sheets stack on top of the logger)
        const tap = a => page.evaluate(a => { const b = [...document.querySelectorAll(`[data-a="${a}"]`)].filter(e => e.offsetParent).pop(); if (b) b.click(); return !!b; }, a);
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
      await page.evaluate(() => WorkoutLogger.setSettings({ setSound: "check", sound: true }));
      // Quick log tick plays it too
      await page.evaluate(() => { played.length = 0; });
      const quick = await page.evaluate(() => { const c = document.querySelector('[data-act="setdone"]'); if (c) c.click(); return !!c; });
      if (quick) assert.ok(await page.evaluate(() => played.includes("check")), "quick log tick plays Check");
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

    await t.test("guide: search filters sections and jump chips exist; progress has four sections", async () => {
      const { page, errors } = await openApp(browser, PHONES[0], seed);
      await go(page, "guide");
      assert.ok((await page.$$('.jump .chip')).length >= 7, "jump chips");
      await page.fill("#libq", "creatine"); await page.waitForTimeout(150);
      const cards = await page.$$eval('#main .card.guide h3', els => els.map(e => e.textContent));
      assert.deepStrictEqual(cards, ["Supplements"]);
      await go(page, "progress");
      const tabs = await page.$$eval('.subnav [data-act="ptab"]', els => els.map(e => e.textContent));
      assert.deepStrictEqual(tabs, ["Weight", "Lifts", "Food", "Reviews"]);
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
      assert.deepStrictEqual(chips, ["coral", "red", "white", "green", "yellow", "blue"]);
      assert.deepStrictEqual(errors, []);
      await page.close();
    });

    await t.test("ticking sets never hides a row: every template, every set (Aziz's bench warm-ups vanished after the 4th tick)", async () => {
      const { page, errors } = await openApp(browser, PHONES[0], seed);
      await go(page, "train");
      await page.waitForFunction(() => !document.getElementById("lbHost").hidden && /Templates/.test(document.getElementById("lbHost").textContent));
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
      await page.click(".dd-water .label");
      await page.waitForTimeout(900);
      assert.ok(await visible("#waterCard"), "tapping the Water tile scrolls to the Water card");
      const before = await page.evaluate(() => getDay(TODAY).water);
      await page.click('.dd-water [data-act="water"][data-ml="250"]');
      assert.strictEqual(await page.evaluate(() => getDay(TODAY).water), before + 250, "the tile's +250 chip still adds water");
      for (const [tile, target] of [[".dd-weight", "#wkg"], [".dd-recovery", "#sleepH"]]) {
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
      await go(page, "train");
      await page.waitForFunction(() => !document.getElementById("lbHost").hidden && /Templates/.test(document.getElementById("lbHost").textContent));
      const lg = await page.evaluate(async () => { const s = WorkoutLogger.settings(); const btn = [...document.querySelectorAll('#lbHost [data-a="startTplName"],#lbHost [data-a="startTpl"]')][0]; btn.click(); await new Promise(r => setTimeout(r, 400)); const tog = document.querySelectorAll(".lb-live-body .lb-demo-toggle").length, before = document.querySelectorAll(".lb-live-body .ea-card").length; const t = document.querySelector(".lb-live-body .lb-demo-toggle"); if (t) t.click(); await new Promise(r => setTimeout(r, 200)); return { gym: s.gym, listOnce: s.listOnce, tog, before, after: document.querySelectorAll(".lb-live-body .ea-card").length }; });
      assert.strictEqual(lg.gym, false, "live workouts open in List view");
      assert.strictEqual(lg.listOnce, true);
      assert.ok(lg.tog > 0 && lg.before === 0 && lg.after === 1, "demos start collapsed and one opens on tap: " + JSON.stringify(lg));
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
