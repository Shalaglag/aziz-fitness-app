// The whole route on a phone-sized screen: the built app (app/index.html in Chromium, 360×800) → the coach
// service running in the local Workers runtime (wrangler dev) → a mock Claude API. Checks the consent card,
// that nothing is sent before consent, the streamed answer, the cost line, and the AI settings meter.
// Not part of npm test (needs wrangler + Playwright): node test/app-e2e.mjs [screenshot.png]
import http from "node:http";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const here = path.dirname(fileURLToPath(import.meta.url));
const PID = "aziz-fitness";
const b64u = buf => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const pub = await crypto.subtle.exportKey("jwk", kp.publicKey);
const now = Math.floor(Date.now() / 1000);
const h = b64u(JSON.stringify({ alg: "RS256", kid: "k1" })), p = b64u(JSON.stringify({ iss: "https://securetoken.google.com/" + PID, aud: PID, sub: "uidAziz", iat: now, exp: now + 3600, email: "aziz@example.com" }));
const TOKEN = h + "." + p + "." + b64u(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, new TextEncoder().encode(h + "." + p)));

const seen = [];
const mock = http.createServer((req, res) => {
  if (req.url === "/jwks") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ keys: [{ kty: "RSA", n: pub.n, e: pub.e, kid: "k1", alg: "RS256" }] })); }
  let body = ""; req.on("data", c => body += c); req.on("end", async () => {
    const b = JSON.parse(body); seen.push(b);
    const ar = /Arabic/.test(b.messages[b.messages.length - 1].content);
    res.writeHead(200, { "content-type": "text/event-stream" });
    const ev = (e, d) => res.write("event: " + e + "\ndata: " + JSON.stringify(d) + "\n\n");
    ev("message_start", { type: "message_start", message: { id: "m", type: "message", role: "assistant", model: b.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 350, cache_creation_input_tokens: 4800, cache_read_input_tokens: 0, output_tokens: 1 } } });
    ev("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
    const answer = ar ? "متوسط وزنك لسبعة أيام 91.0 كغ، أي أقل بـ 0.6 كغ من الأسبوع الماضي." : "Your 7-day average is 91.0 kg, down from the week before. Keep the plan.";
    const text = JSON.stringify({ answer, evidence: ["Weight 7-day avg 91.0 kg"], missing: [], suggestion: null, actions: [] });
    for (const part of [text.slice(0, 30), text.slice(30)]) { ev("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: part } }); await new Promise(r => setTimeout(r, 50)); }
    ev("content_block_stop", { type: "content_block_stop", index: 0 });
    ev("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 260 } });
    ev("message_stop", { type: "message_stop" }); res.end();
  });
});
await new Promise(r => mock.listen(0, "127.0.0.1", r));
const MP = mock.address().port, PORT = 8890 + Math.floor(Math.random() * 100);
const vars = { ANTHROPIC_API_KEY: "sk-test-not-real", ANTHROPIC_BASE_URL: "http://127.0.0.1:" + MP, FIREBASE_JWKS_URL: "http://127.0.0.1:" + MP + "/jwks", ALLOWED_EMAILS: "aziz@example.com" };
const wr = spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--ip", "127.0.0.1", "--persist-to", mkdtempSync(path.join(tmpdir(), "coach-")), "--show-interactive-dev-session=false", ...Object.entries(vars).flatMap(([k, v]) => ["--var", k + ":" + v])], { cwd: path.join(here, ".."), stdio: "ignore", detached: true, env: Object.assign({}, process.env, { WRANGLER_SEND_METRICS: "false" }) });
const base = "http://127.0.0.1:" + PORT;
for (let i = 0; i < 120; i++) { try { if ((await fetch(base + "/v1/health")).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 500)); }

let failed = false;
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true });
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  await page.route(/^https:\/\/(fonts\.|www\.gstatic\.com)/, r => r.fulfill({ body: "" }));
  await page.route(/\/vendor\/firebase-/, r => r.fulfill({ body: "" }));
  // The phone talks to https://mizan-coach.test; here that host is the local Worker.
  const sent = [];
  await page.route("https://mizan-coach.test/**", async route => {
    const req = route.request(); sent.push(req.url());
    const r = await fetch(base + new URL(req.url()).pathname, { method: req.method(), headers: req.headers(), body: req.postData() || undefined });
    await route.fulfill({ status: r.status, headers: Object.fromEntries(r.headers), body: Buffer.from(await r.arrayBuffer()) });
  });
  await page.goto("file://" + path.join(here, "../../app/index.html"));
  await page.waitForFunction(() => document.querySelector("#main").children.length > 0);
  await page.evaluate(() => { const b = document.querySelector('.gs-wrap [data-gs="skip"]'); if (b) b.click(); });
  await page.evaluate(t => {
    const today = TODAY, add = n => new Date(Date.parse(today + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
    [91.9, 91.5, 91.2, 90.8, 90.9, 90.6, 90.1].forEach((kg, i) => { S.docs.weights[add(i - 6)] = { date: add(i - 6), kg }; });
    S.docs.prefs.main = Object.assign({}, S.docs.prefs.main || {}, { coachService: "https://mizan-coach.test" });
    window.CloudStore = Object.assign(window.CloudStore || {}, { idToken: async () => t });
  }, TOKEN);
  await page.click(".co-fab");
  await page.fill("[data-coach-input]", "Is my weight going down?");
  await page.press("[data-coach-input]", "Enter");
  await page.waitForSelector(".co-consent");
  assert.equal(sent.filter(u => u.endsWith("/v1/chat")).length, 0, "nothing sent before consent");
  await page.click('[data-coach-consent="yes"]');
  await page.waitForFunction(() => /Your 7-day average is 91.0 kg/.test(document.querySelector(".co-msgs") ? document.querySelector(".co-msgs").textContent : ""));
  assert.equal(seen[0].model, "claude-haiku-5-5");
  assert.ok(JSON.stringify(seen[0].system).includes("avg7"), "the data pack reached Claude");
  await page.fill("[data-coach-input]", "هل وزني ينزل؟");
  await page.press("[data-coach-input]", "Enter");
  await page.waitForFunction(() => /متوسط وزنك/.test(document.querySelector(".co-msgs").textContent));
  assert.equal(seen[1].messages.length, 3, "the second question carries the first turn");
  await page.click("[data-coach-settings]");
  await page.waitForFunction(() => /of your \$100 cap this month \(2 answers\)/.test(document.querySelector(".co-settings") ? document.querySelector(".co-settings").textContent : ""));
  const consent = await page.evaluate(() => S.docs.prefs.main.coachAI);
  assert.ok(consent && consent.consent, "consent stored in prefs");
  const wide = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  assert.ok(wide, "no sideways scrolling");
  assert.deepEqual(errors, []);
  if (process.argv[2]) await page.screenshot({ path: process.argv[2] });
  console.log("app-e2e: ok (consent gate, streamed English + Arabic answers, multi-turn, spending meter, no page errors)");
} catch (e) { failed = true; console.log("app-e2e: FAILED", e.message); }
finally { await browser.close(); try { process.kill(-wr.pid, "SIGTERM"); } catch (e) {} mock.close(); }
process.exit(failed ? 1 : 0);
