// End-to-end check of the Worker in the local Cloudflare runtime (wrangler dev), with a mock Claude API and
// mock Google keys. Not part of npm test (it needs wrangler installed in worker/): run `node test/e2e.mjs`.
// Covers: health, sign-in required, strangers refused, owner streaming + cost, usage summary, concurrent
// questions, the 80 % warning and the hard stop at the cap, cap changes, upstream busy, out of credit, timeout and a cut-off stream.
import http from "node:http";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const PID = "aziz-fitness";
const b64u = buf => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const pub = await crypto.subtle.exportKey("jwk", kp.publicKey);
async function token(claims) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: "RS256", kid: "k1" }));
  const p = b64u(JSON.stringify(Object.assign({ iss: "https://securetoken.google.com/" + PID, aud: PID, sub: "uidAziz", iat: now, exp: now + 3600, email: "aziz@example.com" }, claims)));
  return h + "." + p + "." + b64u(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, new TextEncoder().encode(h + "." + p)));
}

// ---- mock Google keys + Claude API ----
let mode = "ok", seen = [];
const mock = http.createServer((req, res) => {
  if (req.url === "/jwks") { res.writeHead(200, { "content-type": "application/json", "cache-control": "max-age=60" }); return res.end(JSON.stringify({ keys: [{ kty: "RSA", n: pub.n, e: pub.e, kid: "k1", alg: "RS256" }] })); }
  let body = ""; req.on("data", c => body += c); req.on("end", async () => {
    seen.push({ key: req.headers["x-api-key"] || String(req.headers.authorization || "").replace(/^Bearer /, ""), body: JSON.parse(body) });
    if (mode === "busy") { res.writeHead(529, { "content-type": "application/json" }); return res.end('{"type":"error","error":{"type":"overloaded_error"}}'); }
    if (mode === "credit") { res.writeHead(400, { "content-type": "application/json" }); return res.end('{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}'); }
    res.writeHead(200, { "content-type": "text/event-stream" });
    const ev = (e, d) => res.write("event: " + e + "\ndata: " + JSON.stringify(d) + "\n\n");
    ev("message_start", { type: "message_start", message: { id: "msg_test", type: "message", role: "assistant", model: "claude-haiku-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 400, cache_creation_input_tokens: 5000, cache_read_input_tokens: 0, output_tokens: 1 } } });
    ev("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } });
    ev("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig" } });
    ev("content_block_stop", { type: "content_block_stop", index: 0 });
    ev("content_block_start", { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } });
    if (mode === "slow") { await new Promise(r => setTimeout(r, 4000)); }
    const parts = ['{"answer":"Your 7-day average', ' is down 0.6 kg.","evidence":[],"missing":[],"suggestion":null,"actions":[]}'];
    for (const t of parts) { ev("content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: t } }); await new Promise(r => setTimeout(r, 30)); }
    if (mode === "cut") { res.destroy(); return; }
    ev("content_block_stop", { type: "content_block_stop", index: 1 });
    ev("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: mode === "pricey" ? 1700000 : 300 } });
    ev("message_stop", { type: "message_stop" });
    res.end();
  });
});
await new Promise(r => mock.listen(0, "127.0.0.1", r));
const MP = mock.address().port;

// ---- the Worker ----
const PORT = 8790 + Math.floor(Math.random() * 100);
const vars = { ANTHROPIC_API_KEY: "sk-test-not-real", ANTHROPIC_BASE_URL: "http://127.0.0.1:" + MP, FIREBASE_JWKS_URL: "http://127.0.0.1:" + MP + "/jwks", ALLOWED_EMAILS: "aziz@example.com", PER_MINUTE: "50", PER_DAY: "500", TIMEOUT_MS: "2500" };
const wr = spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--ip", "127.0.0.1", "--persist-to", mkdtempSync(path.join(tmpdir(), "coach-")), "--show-interactive-dev-session=false", ...Object.entries(vars).flatMap(([k, v]) => ["--var", k + ":" + v])], { stdio: ["ignore", "pipe", "pipe"], detached: true, env: Object.assign({}, process.env, { WRANGLER_SEND_METRICS: "false" }) });
let log = ""; wr.stdout.on("data", d => log += d); wr.stderr.on("data", d => log += d);
const base = "http://127.0.0.1:" + PORT;
for (let i = 0; i < 120; i++) { try { const r = await fetch(base + "/v1/health"); if (r.ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 500)); }

const results = [];
const check = async (name, fn) => { try { await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error("timed out")), 20000))]); results.push("ok   " + name); } catch (e) { results.push("FAIL " + name + ": " + e.message.slice(0, 400).replace(/\n/g, " ")); } console.log(results[results.length - 1]); };
const owner = await token({}), stranger = await token({ sub: "uidStranger", email: "someone@else.com" });
const H = t => ({ authorization: "Bearer " + t, "content-type": "application/json" });
const ask = (t, q, extra) => fetch(base + "/v1/chat", { method: "POST", headers: H(t), body: JSON.stringify(Object.assign({ question: q, ctx: { weight: { avg7: 90.8 } } }, extra)) });
const lines = async r => (await r.text()).trim().split("\n").filter(Boolean).map(l => JSON.parse(l));

try {
  await check("health says key and owner are set, no secrets", async () => { const j = await (await fetch(base + "/v1/health")).json(); assert.deepEqual(j, { ok: true, model: "claude-haiku-5-5", keySet: true, ownerSet: true }); });
  await check("no token -> 401", async () => { const r = await fetch(base + "/v1/chat", { method: "POST", body: "{}" }); assert.equal(r.status, 401); });
  await check("forged token -> 401", async () => { const r = await ask(owner.slice(0, -4) + "AAAA", "hi"); assert.equal(r.status, 401); });
  await check("stranger's valid account -> 403 not_allowed, Claude never called", async () => { seen = []; const r = await ask(stranger, "hi"); assert.equal(r.status, 403); assert.equal((await r.json()).error, "not_allowed"); assert.equal(seen.length, 0); });
  await check("owner: streamed answer, Haiku 5.5, key sent only upstream, cost counted", async () => {
    seen = []; mode = "ok";
    const r = await ask(owner, "Is my cut working?", { history: [{ q: "hi", a: "hello" }] });
    assert.equal(r.status, 200); assert.match(r.headers.get("content-type"), /ndjson/);
    const L = await lines(r);
    assert.equal(L.filter(l => l.t === "d").map(l => l.text).join(""), '{"answer":"Your 7-day average is down 0.6 kg.","evidence":[],"missing":[],"suggestion":null,"actions":[]}');
    const done = L[L.length - 1]; assert.equal(done.t, "done"); assert.equal(done.stop, "end_turn");
    assert.equal(done.costUsd, (400 * 0.1 + 5000 * 0.125 + 300 * 0.5) / 1e6);
    assert.equal(seen[0].key, "sk-test-not-real"); assert.equal(seen[0].body.model, "claude-haiku-5-5"); assert.equal(seen[0].body.messages.length, 3);
    assert.ok(!JSON.stringify(L).includes("sk-test"), "key never in the reply");
  });
  await check("usage summary: confirmed spend, nothing pending", async () => { const j = await (await fetch(base + "/v1/usage", { headers: H(owner) })).json(); assert.equal(j.capUsd, 100); assert.equal(j.requests, 1); assert.equal(j.pendingUsd, 0); assert.ok(j.confirmedUsd > 0); assert.equal(j.warn, false); });
  await check("stranger can't read usage or change the cap", async () => { assert.equal((await fetch(base + "/v1/usage", { headers: H(stranger) })).status, 403); assert.equal((await fetch(base + "/v1/cap", { method: "POST", headers: H(stranger), body: '{"capUsd":100}' })).status, 403); });
  await check("6 questions at once: at most 2 run per account, the rest get 429 busy", async () => {
    const many = await Promise.all(Array.from({ length: 6 }, () => ask(owner, "q")));
    const codes = many.map(x => x.status);
    assert.ok(codes.filter(c => c === 200).length <= 2 && codes.every(c => c === 200 || c === 429), String(codes));
    await Promise.all(many.map(x => x.text()));
    const j = await (await fetch(base + "/v1/usage", { headers: H(owner) })).json(); assert.equal(j.pendingUsd, 0, "every reservation settled");
  });
  await check("80 % warning, then the hard stop at the cap (402 before Claude is called), raising it reopens", async () => {
    let r = await fetch(base + "/v1/cap", { method: "POST", headers: H(owner), body: JSON.stringify({ capUsd: 1 }) }); assert.equal(r.status, 200);
    mode = "pricey"; // the mock reports 1.7M output tokens = $0.85
    let L = await lines(await ask(owner, "q")); let done = L[L.length - 1];
    assert.equal(done.t, "done"); assert.equal(done.month.warn, true); assert.equal(done.month.stopped, false);
    L = await lines(await ask(owner, "q")); done = L[L.length - 1]; assert.equal(done.month.stopped, true, "spend now past $1");
    seen = []; mode = "ok";
    r = await ask(owner, "q"); assert.equal(r.status, 402); const j = await r.json(); assert.equal(j.error, "cap_reached"); assert.equal(j.month.stopped, true); assert.equal(seen.length, 0, "Claude not called");
    assert.equal((await fetch(base + "/v1/cap", { method: "POST", headers: H(owner), body: '{"capUsd":0.5}' })).status, 400);
    assert.equal((await fetch(base + "/v1/cap", { method: "POST", headers: H(owner), body: '{"capUsd":101}' })).status, 400);
    r = await fetch(base + "/v1/cap", { method: "POST", headers: H(owner), body: JSON.stringify({ capUsd: 100 }) }); assert.equal((await r.json()).capUsd, 100);
    r = await ask(owner, "q"); assert.equal(r.status, 200); await r.text();
  });
  await check("upstream overloaded twice -> 503 upstream_busy, nothing charged", async () => {
    mode = "busy"; seen = []; const before = (await (await fetch(base + "/v1/usage", { headers: H(owner) })).json()).usedUsd;
    const r = await ask(owner, "hi"); assert.equal(r.status, 503); assert.equal((await r.json()).error, "upstream_busy"); assert.equal(seen.length, 2, "one retry, no more");
    const after = await (await fetch(base + "/v1/usage", { headers: H(owner) })).json(); assert.equal(after.usedUsd, before); assert.equal(after.pendingUsd, 0);
  });
  await check("credit used up -> 402 out_of_credit", async () => { mode = "credit"; const r = await ask(owner, "hi"); assert.equal(r.status, 402); assert.equal((await r.json()).error, "out_of_credit"); });
  await check("slow upstream -> timeout error line, counted as an upper bound", async () => {
    mode = "slow"; const r = await ask(owner, "hi"); assert.equal(r.status, 200);
    const L = await lines(r); const last = L[L.length - 1]; assert.equal(last.t, "error"); assert.equal(last.error, "timeout"); assert.ok(last.costUsd >= 900 * 0.5 / 1e6);
  });
  await check("stream cut off -> error line, never a half answer marked done", async () => { mode = "cut"; const L = await lines(await ask(owner, "hi")); assert.equal(L[L.length - 1].t, "error"); });
} finally {
  try { process.kill(-wr.pid, "SIGTERM"); } catch (e) {} mock.close();
}
const failed = results.some(r => r.startsWith("FAIL"));
console.log(failed ? "e2e: FAILED" : "e2e: all " + results.length + " checks passed");
if (failed) console.log(log.slice(-3000));
process.exit(failed ? 1 : 0);
