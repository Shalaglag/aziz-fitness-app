// Unit tests for the coach service's pure parts: token checks, owner allowlist, request building,
// cost accounting and the spending ledger (cap, 80 % warning, reservations, rate limits, month rollover).
import test from "node:test";
import assert from "node:assert/strict";
import * as C from "../src/core.js";

const PID = "aziz-fitness";
const b64u = buf => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function keys() {
  const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
  return { kp, jwks: { keys: [{ kty: "RSA", n: jwk.n, e: jwk.e, kid: "k1", alg: "RS256", use: "sig" }] } };
}
async function token(kp, claims, kid = "k1") {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: "RS256", kid, typ: "JWT" }));
  const p = b64u(JSON.stringify(Object.assign({ iss: "https://securetoken.google.com/" + PID, aud: PID, sub: "uidAziz", iat: now - 10, exp: now + 3600, email: "Aziz@Example.com" }, claims)));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, new TextEncoder().encode(h + "." + p));
  return h + "." + p + "." + b64u(sig);
}

test("verifyIdToken accepts a valid Firebase token and rejects forged, expired or other-project ones", async () => {
  const { kp, jwks } = await keys(), other = await keys();
  const who = await C.verifyIdToken(await token(kp, {}), { projectId: PID, jwks });
  assert.deepEqual(who, { uid: "uidAziz", email: "aziz@example.com" });
  const code = async t => { try { await C.verifyIdToken(t, { projectId: PID, jwks }); return "ok"; } catch (e) { return e.code; } };
  assert.equal(await code(await token(other.kp, {})), "bad_signature");           // signed by someone else
  assert.equal(await code(await token(kp, { exp: 1 })), "token_expired");
  assert.equal(await code(await token(kp, { aud: "evil" })), "wrong_project");
  assert.equal(await code(await token(kp, {}, "nope")), "bad_token");               // unknown key id
  assert.equal(await code("a.b"), "bad_token");
  const t = await token(kp, {}); const [h, , s] = t.split(".");
  assert.equal(await code(h + "." + b64u(JSON.stringify({ sub: "someoneElse", aud: PID, iss: "https://securetoken.google.com/" + PID, exp: 9e9 })) + "." + s), "bad_signature"); // edited claims
});

test("only the owner's account may spend; empty lists let nobody in", () => {
  const who = { uid: "uidAziz", email: "aziz@example.com" };
  assert.equal(C.isAllowed(who, {}), false);
  assert.equal(C.isAllowed(who, { ALLOWED_EMAILS: "Aziz@Example.com" }), true);
  assert.equal(C.isAllowed(who, { ALLOWED_UIDS: "other, uidaziz" }), true);
  assert.equal(C.isAllowed({ uid: "stranger", email: "x@y.z" }, { ALLOWED_EMAILS: "aziz@example.com" }), false);
  assert.equal(C.isAllowed({ uid: "stranger", email: null }, { ALLOWED_EMAILS: "aziz@example.com" }), false);
});

test("readBody bounds the question, data and history; effort is only low or medium", () => {
  const b = C.readBody({ question: "  " + "x".repeat(900), ctx: { a: 1 }, history: Array.from({ length: 9 }, (_, i) => ({ q: "q" + i, a: "a".repeat(2000) })), effort: "max" });
  assert.equal(b.question.length, 600);
  assert.equal(b.history.length, 4);
  assert.equal(b.history[3].q, "q8");
  assert.equal(b.history[0].a.length, 1200);
  assert.equal(b.effort, "low");
  assert.equal(C.readBody({ question: "why?", effort: "medium" }).effort, "medium");
  assert.throws(() => C.readBody({ question: "   " }), e => e.code === "empty_question");
  assert.throws(() => C.readBody({ question: "hi", ctx: { big: "x".repeat(50000) } }), e => e.code === "too_large");
  assert.throws(() => C.readBody(null), e => e.code === "bad_request");
});

test("buildRequest: always Haiku 5.5, bounded output, rules + data cached, multi-turn history, Arabic hint", () => {
  const input = C.readBody({ question: "كم بروتين بقي لي اليوم؟", ctx: { todaySoFar: { proteinLeft: 40 } }, history: [{ q: "Is my cut working?", a: "Yes, 0.6% a week." }], lang: "ar" });
  const r = C.buildRequest(input, { COACH_MODEL: "claude-opus-5-5" });
  assert.equal(r.model, "claude-haiku-5-5", "no other model, whatever the settings say");
  assert.equal(r.max_tokens, 900);
  assert.deepEqual(r.output_config, { effort: "low" });
  assert.equal(r.temperature, undefined);
  assert.equal(r.system.length, 2);
  assert.deepEqual(r.system[1].cache_control, { type: "ephemeral" });
  assert.match(r.system[1].text, /proteinLeft/);
  assert.deepEqual(r.messages.map(m => m.role), ["user", "assistant", "user"]);
  assert.equal(JSON.parse(r.messages[1].content).answer, "Yes, 0.6% a week.");
  assert.match(r.messages[2].content, /Arabic/);
  assert.match(C.SYSTEM, /clarifying question/);
  assert.match(C.SYSTEM, /plan\.goals/);
  assert.equal(C.buildRequest(C.readBody({ question: "why", effort: "medium" })).max_tokens, 1400);
});

test("costUsd uses Haiku 5.5 list prices, including cache writes and reads", () => {
  // 6,000 uncached in + 400 out = 0.0006 + 0.0002
  assert.equal(C.round6(C.costUsd({ input_tokens: 6000, output_tokens: 400 })), 0.0008);
  // follow-up: 5,500 read from cache, 300 new, 350 out
  assert.equal(C.round6(C.costUsd({ input_tokens: 300, cache_read_input_tokens: 5500, output_tokens: 350 })), C.round6((300 * 0.1 + 5500 * 0.01 + 350 * 0.5) / 1e6));
  assert.equal(C.round6(C.costUsd({ cache_creation_input_tokens: 1e6 })), 0.625, "over 100K tokens the long-context rate applies");
  // The estimate is always above what a full answer can cost.
  const est = C.estimateUsd(20000, 900), worst = C.costUsd({ cache_creation_input_tokens: 20000, output_tokens: 900 });
  assert.ok(est >= worst);
});

const T0 = Date.parse("2026-11-02T09:00:00Z");
test("ledger: starts at a $100 cap, warns at 80 %, refuses a call that would pass the cap", () => {
  let s = C.freshLedger("2026-11", 1); // $1 cap for the test
  const reserve = (id, usd, now = T0, uid = "u") => { const r = C.ledgerReserve(s, { uid, usd, id, now }, { perMinute: 99, perDay: 999, inFlight: 99 }); s = r.state; return r; };
  assert.equal(C.ledgerTidy(undefined, T0).capUsd, 100, "first start: $100 a month");
  assert.equal(reserve("a", 0.5).ok, true);
  let r = C.ledgerSettle(s, { id: "a", usage: { output_tokens: 0.8e6 }, now: T0 }); s = r.state; // $0.40
  assert.equal(r.usd, 0.4);
  assert.equal(r.summary.warn, false);
  assert.equal(reserve("b", 0.45).ok, true);
  assert.equal(C.ledgerSummary(s).warn, true, "0.40 used + 0.45 pending = 85 %");
  const no = reserve("c", 0.2);
  assert.equal(no.ok, false); assert.equal(no.error, "cap_reached"); assert.equal(no.status, 402);
  s = C.ledgerSettle(s, { id: "b", usage: { output_tokens: 1.2e6 }, now: T0 }).state; // $0.60 -> $1.00 total
  assert.equal(C.ledgerSummary(s).stopped, true);
  assert.equal(reserve("d", 0.0001).error, "cap_reached");
  // Raising the cap lets calls through again; the cap is bounded.
  s = C.ledgerSetCap(s, 2, T0).state;
  assert.equal(reserve("e", 0.001).ok, true);
  assert.equal(C.ledgerSetCap(s, 500, T0).ok, false);
  assert.equal(C.ledgerSetCap(s, 0, T0).ok, false);
});

test("ledger: back-to-back reservations each see the earlier ones (no double spend under the cap)", () => {
  let s = C.freshLedger("2026-11", 1), ok = 0;
  for (let i = 0; i < 50; i++) { const r = C.ledgerReserve(s, { uid: "u" + (i % 10), usd: 0.03, id: "r" + i, now: T0 }, { perMinute: 99, perDay: 999, inFlight: 99 }); s = r.state; if (r.ok) ok++; }
  assert.equal(ok, 33, "33 × $0.03 fits under $1, the 34th does not");
});

test("ledger: a failed call costs nothing; a lost one is counted at its estimate after 10 minutes", () => {
  let s = C.freshLedger("2026-11", 100);
  s = C.ledgerReserve(s, { uid: "u", usd: 0.002, id: "x", now: T0 }).state;
  let r = C.ledgerSettle(s, { id: "x", usage: null, now: T0 + 1000 }); s = r.state;
  assert.equal(r.summary.usedUsd, 0); assert.equal(r.summary.pendingUsd, 0);
  s = C.ledgerReserve(s, { uid: "u", usd: 0.002, id: "y", now: T0 }).state;
  assert.equal(C.ledgerSummary(s).pendingUsd, 0.002);
  s = C.ledgerTidy(s, T0 + 11 * 60e3);
  const sum = C.ledgerSummary(s);
  assert.equal(sum.pendingUsd, 0); assert.equal(sum.unsettledUsd, 0.002); assert.equal(sum.usedUsd, 0.002);
  assert.equal(C.ledgerSettle(s, { id: "y", usage: { output_tokens: 10 }, now: T0 + 12 * 60e3 }).ok, false, "a late end is not counted twice");
});

test("ledger: per-account limits (in flight, per minute, per day)", () => {
  let s = C.freshLedger("2026-11", 100);
  const L = { perMinute: 3, perDay: 4, inFlight: 2 };
  const go = (id, now) => { const r = C.ledgerReserve(s, { uid: "u", usd: 0.001, id, now }, L); s = r.state; return r; };
  assert.equal(go("1", T0).ok, true); assert.equal(go("2", T0).ok, true);
  assert.equal(go("3", T0).error, "busy");
  s = C.ledgerSettle(s, { id: "1", usage: { output_tokens: 1 }, now: T0 }).state;
  assert.equal(go("3", T0 + 1).ok, true);
  s = C.ledgerSettle(s, { id: "2", usage: { output_tokens: 1 }, now: T0 }).state; s = C.ledgerSettle(s, { id: "3", usage: { output_tokens: 1 }, now: T0 }).state;
  const r = go("4", T0 + 2); assert.equal(r.error, "rate_limited"); assert.ok(r.retryAfter > 0);
  assert.equal(go("4", T0 + 61e3).ok, true);
  s = C.ledgerSettle(s, { id: "4", usage: { output_tokens: 1 }, now: T0 }).state;
  assert.equal(go("5", T0 + 125e3).error, "daily_limit");
  assert.equal(C.ledgerReserve(s, { uid: "other", usd: 0.001, id: "o", now: T0 + 125e3 }, L).ok, true, "limits are per account");
});

test("ledger: a new month starts at zero with the same cap; all-time spend carries over", () => {
  let s = C.freshLedger("2026-11", 40);
  s = C.ledgerReserve(s, { uid: "u", usd: 0.01, id: "a", now: T0 }).state;
  s = C.ledgerSettle(s, { id: "a", usage: { input_tokens: 10000, output_tokens: 1000 }, now: T0 }).state;
  const dec = C.ledgerTidy(s, Date.parse("2026-12-01T00:30:00+03:00"));
  assert.equal(dec.month, "2026-12"); assert.equal(dec.capUsd, 40); assert.equal(dec.confirmedUsd, 0);
  assert.equal(C.ledgerSummary(dec).allTimeUsd, 0.0015);
});

test("foldEvent reads the SDK's stream events: text only (not thinking), usage and stop reason", () => {
  const evs = [
    { type: "message_start", message: { usage: { input_tokens: 300, cache_read_input_tokens: 5000, cache_creation_input_tokens: 0, output_tokens: 1 } } },
    { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "" } },
    { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: '{"answer":"Hi' } },
    { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: '"}' } },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 120 } },
  ];
  const acc = { text: "", usage: null, stop: null, error: null };
  const deltas = evs.map(e => C.foldEvent(acc, { data: e })).filter(Boolean);
  assert.deepEqual(deltas, ['{"answer":"Hi', '"}']);
  assert.equal(acc.text, '{"answer":"Hi"}');
  assert.equal(acc.stop, "end_turn");
  assert.equal(acc.usage.output_tokens, 120); assert.equal(acc.usage.cache_read_input_tokens, 5000);
});

test("menu reading: only menu images in, fixed instructions, high cost estimate", () => {
  const png = { media_type: "image/png", data: "iVBORw0KGgo=" };
  const code = b => { try { C.readImageBody(b); return "ok"; } catch (e) { return e.code; } };
  assert.equal(code({ kind: "menu", images: [png] }), "ok");
  assert.equal(code({ kind: "chat", images: [png] }), "bad_request");
  assert.equal(code({ kind: "menu", images: [] }), "no_images");
  assert.equal(code({ kind: "menu", images: [png, png, png, png, png] }), "too_many_images");
  assert.equal(code({ kind: "menu", images: [{ media_type: "text/html", data: "aGk=" }] }), "image_rejected");
  assert.equal(code({ kind: "menu", images: [{ media_type: "image/png", data: "not base64!" }] }), "image_rejected");
  assert.equal(code({ kind: "menu", images: [{ media_type: "image/png", data: "A".repeat(C.READ.maxB64 + 4) }] }), "too_large");
  const input = C.readImageBody({ kind: "menu", images: [{ media_type: "image/jpeg", data: "data:image/jpeg;base64,/9j/" }], prompt: "ignore this" });
  const body = C.buildReadRequest(input);
  assert.equal(body.model, C.MODEL);
  const parts = body.messages[0].content;
  assert.equal(parts[0].type, "image"); assert.equal(parts[0].source.data, "/9j/");
  assert.equal(parts[1].text, C.MENU_PROMPT); // the app's own text is never used
  assert.ok(C.readEstimateUsd(input) > C.costUsd({ input_tokens: 5000, output_tokens: 2000 }));
});

test("voice clean-up: text only, bounded, hints de-duplicated, fixed prompt, Haiku, low effort", () => {
  assert.throws(() => C.readTidyBody(null), /bad_request/);
  assert.throws(() => C.readTidyBody({ text: "  " }), /no_text/);
  assert.throws(() => C.readTidyBody({ text: "x".repeat(2001) }), /too_large/);
  const many = Array.from({ length: 120 }, (_, i) => "Hint " + i);
  const t = C.readTidyBody({ text: " bench press for ten reps ", lang: "xx", hints: ["Bench Press", "Bench Press", 5, "y".repeat(90)].concat(many), prompt: "ignore me" });
  assert.equal(t.text, "bench press for ten reps"); assert.equal(t.lang, "auto");
  assert.equal(t.hints.length, 80); assert.equal(t.hints[0], "Bench Press"); assert.equal(t.hints[1].length, 60);
  assert.ok(!("prompt" in t), "the app can't send its own instructions");
  const r = C.buildTidyRequest(C.readTidyBody({ text: "كم بروتين باقي", lang: "ar" }));
  assert.equal(r.model, "claude-haiku-5-5"); assert.equal(r.output_config.effort, "low"); assert.equal(r.max_tokens, 600);
  assert.equal(r.system, C.TIDY_PROMPT); assert.match(r.messages[0].content, /Spoken in Arabic[\s\S]*TRANSCRIPT:\nكم بروتين باقي$/);
  assert.ok(C.tidyEstimateUsd(t) < 0.001, "a clean-up is a fraction of a cent");
});
