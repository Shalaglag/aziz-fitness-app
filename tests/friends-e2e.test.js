// Two phones, two accounts, one Firebase emulator: sign up, invite by code, accept, share steps, see the
// leaderboard, start and join a challenge, prove the other account's private data is unreadable, remove the
// friend. Needs the Firebase emulators (Auth + Firestore), so it is skipped unless they are running:
//   cd tools/firestore-rules && npm install && npm run e2e
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
let chromium; try { ({ chromium } = require("playwright")); } catch (e) {}
const EMU = process.env.FIRESTORE_EMULATOR_HOST;
const APP = "file://" + path.join(__dirname, "../app/index.html");
const CFG = { apiKey: "demo-key", authDomain: "localhost", projectId: "demo-mizan", appId: "1:1:web:demo", emulator: { host: "127.0.0.1", firestorePort: EMU ? +EMU.split(":")[1] : 8080, authPort: +(process.env.FIREBASE_AUTH_EMULATOR_PORT || 9099) } };

async function phone(browser, email, name) {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage(); const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("dialog", d => d.accept());
  await page.addInitScript(c => { window.FITNESS_CLOUD_CONFIG = c; }, CFG);
  await page.route(/^https:\/\/(fonts\.|www\.gstatic\.com)/, r => r.fulfill({ body: "" }));
  await page.goto(APP);
  await page.waitForSelector("form.cs-card");
  await page.fill(".cs-card input[name=email]", email); await page.fill(".cs-card input[name=pw]", "secret123");
  await page.click('.cs-card button[data-m="up"]');
  await page.waitForFunction(() => !document.querySelector(".cs-card") && S.mode === "sync");
  await page.waitForFunction(() => window.CloudStore && CloudStore.raw() && frInst && frInst.state.me && frInst.state.code);
  const go = async tab => { await page.evaluate(() => { const m = document.getElementById("menuBtn"); (getComputedStyle(m).display === "none" ? document.querySelector("#bottomNav button[data-more]") : m).click(); }); await page.click(`#tabs button[data-tab="${tab}"]`); await page.waitForTimeout(150); };
  const sub = async k => { await page.click(`[data-fr="sub"][data-k="${k}"]`); await page.waitForTimeout(100); };
  await go("friends"); await sub("friends");
  await page.waitForSelector('[data-fr="editprofile"]');
  await page.click('[data-fr="editprofile"]'); await page.fill("#frName", name); await page.click('[data-fr="saveprofile"]');
  await page.waitForFunction(n => document.querySelector("#main").innerText.includes(n), name);
  const text = () => page.evaluate(() => document.querySelector("#main").innerText);
  const wait = (re, ms) => page.waitForFunction(r => new RegExp(r, "i").test(document.querySelector("#main").innerText), re.source, { timeout: ms || 15000 });
  return { ctx, page, errors, go, sub, text, wait, uid: await page.evaluate(() => CloudStore.raw().uid) };
}
const setSteps = (p, n) => p.page.evaluate(n => put("days", TODAY, Object.assign(getDay(TODAY), { steps: { count: n, at: new Date().toISOString(), source: "health-connect" } })), n);

test("two accounts: invite, share steps, leaderboard, challenge, privacy, remove", { skip: !chromium ? "playwright not installed" : !EMU ? "Firebase emulators not running" : false }, async () => {
  const browser = await chromium.launch();
  try {
    const A = await phone(browser, "aziz@example.com", "Aziz"), B = await phone(browser, "bro@example.com", "Brother");
    assert.notEqual(A.uid, B.uid);
    // 1. invite by code
    const code = (await A.page.textContent(".fr-code")).trim();
    assert.match(code, /^[A-Z0-9]{3}-[A-Z0-9]{3}$/);
    await B.page.fill("#frCode", code.toLowerCase()); await B.page.click('[data-fr="sendrequest"]');
    await B.wait(/Waiting for them to accept/);
    await A.wait(/Brother[\s\S]*wants to connect/);
    await A.page.click('[data-fr="accept"]');
    await A.wait(/Friends · 1/); await B.wait(/Friends · 1/);
    assert.match(await A.text(), /Shares nothing yet|Hasn't shared anything yet/);
    // 2. private data stays private even between friends
    const denied = await B.page.evaluate(uid => CloudStore.raw().fs.collection("users").doc(uid).collection("days").get().then(() => "allowed", e => e.code), A.uid);
    assert.equal(denied, "permission-denied");
    // 3. nothing shared yet: the leaderboard says so instead of showing zeros
    await setSteps(A, 7400); await setSteps(B, 9100);
    await A.sub("leaderboard"); await A.wait(/Brother[\s\S]*Not sharing steps/);
    assert.doesNotMatch(await A.text(), /9,100/);
    // 4. both switch steps on -> numbers, goal progress, gap, updated time
    for (const p of [A, B]) { await p.sub("sharing"); await p.page.click('[data-fr="toggle"][data-k="steps"]'); await p.page.waitForFunction(() => frInst.state.myShare && frInst.state.myShare.steps); }
    await A.sub("leaderboard"); await A.wait(/9,100[\s\S]*900 to go/); await A.wait(/\+1,700 vs you/);
    assert.match(await A.text(), /7,400/);
    await A.page.click('[data-fr="period"][data-k="week"]'); await A.wait(/goal day/);
    // 5. compare sheet (steps shared, workouts not)
    await A.page.click('.fr-row[data-fr="compare"]'); await A.wait(/Compare[\s\S]*Steps today[\s\S]*7,400 \/ 10,000[\s\S]*9,100 \/ 10,000/);
    assert.match(await A.text(), /Workouts this week[\s\S]*Not shared/i);
    await A.page.click('[data-fr="closecompare"][data-close]');
    // 6. challenge: A creates, B joins, both appear with their steps
    await A.sub("challenges"); await A.page.click('[data-fr="newch"]'); await A.page.fill("#frChName", "Walk-off"); await A.page.click('[data-fr="createch"]');
    await A.wait(/Walk-off[\s\S]*Not joined yet: Brother/);
    await B.sub("challenges"); await B.wait(/Walk-off[\s\S]*invited you/); await B.page.click('[data-fr="join"]');
    await B.wait(/Walk-off[\s\S]*You[\s\S]*9,100/);
    await A.page.evaluate(() => render()); await A.wait(/Brother[\s\S]*9,100[\s\S]*steps[\s\S]*You[\s\S]*7,400[\s\S]*steps/);
    // an outsider can't read it: a third account with the challenge id
    const C = await phone(browser, "eve@example.com", "Eve");
    const chId = await A.page.evaluate(() => Object.keys(frInst.state.challenges)[0]);
    assert.equal(await C.page.evaluate(id => CloudStore.raw().fs.collection("challenges").doc(id).get().then(() => "allowed", e => e.code), chId), "permission-denied");
    assert.equal(await C.page.evaluate(uid => CloudStore.raw().fs.collection("shares").doc(uid).get().then(() => "allowed", e => e.code), A.uid), "permission-denied");
    await C.ctx.close();
    // 7. B stops sharing steps -> A's board says so; then A removes B -> B can no longer read A's share
    await B.sub("sharing"); await B.page.click('[data-fr="toggle"][data-k="steps"]');
    await A.sub("leaderboard"); await A.wait(/Brother[\s\S]*Not sharing steps/);
    await A.sub("friends"); await A.page.click('[data-fr="remove"]'); await A.wait(/No friends yet/);
    await B.sub("leaderboard"); await B.wait(/Invite a friend/);
    assert.equal(await B.page.evaluate(uid => CloudStore.raw().fs.collection("shares").doc(uid).get({ source: "server" }).then(() => "allowed", e => e.code), A.uid), "permission-denied");
    assert.deepEqual(A.errors, []); assert.deepEqual(B.errors, []);
  } finally { await browser.close(); }
});
