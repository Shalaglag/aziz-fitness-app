/* Mizan coach service: a Cloudflare Worker between the app and the Claude API.
 *
 *   GET  /v1/health  -> {ok, model, keySet}                      no sign-in; says whether it is set up
 *   GET  /v1/usage   -> this month's spending summary             owner only
 *   POST /v1/cap     {capUsd} -> sets the monthly cap ($1-$100)   owner only
 *   POST /v1/tidy    {text, lang, hints} -> {text}  owner only; cleans a voice transcript (same cap)
 *   POST /v1/chat    {question, ctx, history, effort, lang}       owner only; streams NDJSON lines:
 *        {"t":"d","text":"…"} answer text as it arrives, then
 *        {"t":"done","costUsd","usage","stop","month"} or {"t":"error","error"}
 *
 *   POST /v1/read    {kind:"menu", images:[{media_type, data}]}  owner only; reads a menu's nutrition numbers:
 *        {text, costUsd, month}   (text is the model's JSON answer; the instructions are fixed on the server)
 *   GET  /v1/foods?q=…&pageSize=25[&types=Foundation,SR Legacy]  owner only; USDA FoodData Central search (no Claude,
 *        no spending; cached a day): {foods:[trimmed hits], totalHits, fdcKey:"own"|"demo", cached}
 *   GET  /v1/food?id=<fdcId>                                      owner only; one food's details with its portions
 *
 * Every request needs the Firebase ID token of a signed-in Mizan account (Authorization: Bearer …), and the
 * account must be listed in ALLOWED_EMAILS or ALLOWED_UIDS (both empty = nobody). The API key is the Worker
 * secret ANTHROPIC_API_KEY; it never leaves this service. Spending goes through one Durable Object (the
 * ledger), which reserves a high estimate before each call, refuses calls that would pass the cap, and swaps
 * the estimate for the real cost when Anthropic reports the tokens. Nothing a user asks is logged or stored.
 *
 * Settings (Cloudflare dashboard → the Worker → Settings → Variables and Secrets):
 *   ANTHROPIC_API_KEY  secret, required to answer (unset -> 503 no_key)
 *   ALLOWED_EMAILS     the email(s) Aziz signs in to Mizan with, comma separated
 *   ALLOWED_UIDS       optional Firebase user ids instead of emails
 *   PER_MINUTE / PER_DAY  per-account question limits (default 6 / 60)
 *   FDC_API_KEY        optional secret: a free api.data.gov key for USDA food search (without it DEMO_KEY: 30/hour, 50/day)
 * The monthly cap starts at $100 (Aziz, Nov 2; his prepaid credit is $100 in total, not monthly) and is changed from the app (Ask Claude → spending).
 */
import Anthropic from "@anthropic-ai/sdk";
import { MODEL, LIMITS, JWKS_URL, err, verifyIdToken, isAllowed, readBody, buildRequest, promptChars, estimateUsd,
  ledgerReserve, ledgerSettle, ledgerSetCap, ledgerTidy, ledgerSummary, foldEvent, round6,
  readImageBody, buildReadRequest, readEstimateUsd, readTidyBody, buildTidyRequest, tidyEstimateUsd,
  FDC, foodsQuery, fdcSearchRequest, fdcCacheKey, trimFdcSearch, trimFdcFood, foodIdQuery, fdcFoodRequest, fdcFoodCacheKey } from "./core.js";

const CORS = {
  "access-control-allow-origin": "*", // bearer tokens only, no cookies: any page still needs the owner's sign-in
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-max-age": "86400",
};
const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: Object.assign({ "content-type": "application/json", "cache-control": "no-store" }, CORS) });
const tz = env => env.COACH_TZ || "Asia/Kuwait";
const limits = env => ({ perMinute: parseInt(env.PER_MINUTE || "6", 10) || 6, perDay: parseInt(env.PER_DAY || "60", 10) || 60, inFlight: 2 });

let jwksCache = { until: 0, jwks: null };
async function googleKeys() {
  if (jwksCache.jwks && Date.now() < jwksCache.until) return jwksCache.jwks;
  const r = await fetch(googleKeys.url || JWKS_URL);
  if (!r.ok) throw err("auth_unavailable", 503);
  const m = /max-age=(\d+)/.exec(r.headers.get("cache-control") || "");
  jwksCache = { jwks: await r.json(), until: Date.now() + Math.min(6 * 3600, m ? +m[1] : 3600) * 1000 };
  return jwksCache.jwks;
}

async function owner(req, env) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) throw err("not_signed_in", 401);
  const who = await verifyIdToken(token, { projectId: env.FIREBASE_PROJECT_ID, jwks: await googleKeys() });
  if (!isAllowed(who, env)) throw err("not_allowed", 403, { uid: who.uid });
  return who;
}
const ledger = env => env.LEDGER.get(env.LEDGER.idFromName("mizan"));

// Bounded: one SDK retry (busy / network errors before any text), the service's own timeout, no other model.
const claude = env => new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: env.ANTHROPIC_BASE_URL || undefined, maxRetries: 1, timeout: +env.TIMEOUT_MS || LIMITS.timeoutMs });
const upstreamError = (status, message) => /credit balance/i.test(message || "") ? ["out_of_credit", 402]
  : status === 401 || status === 403 ? ["bad_key", 503] : status === 429 || status === 529 || status >= 500 ? ["upstream_busy", 503] : status ? ["upstream_rejected", 502] : ["upstream_unreachable", 504];

async function chat(req, env, ctx, who) {
  if (!env.ANTHROPIC_API_KEY) return json(503, { error: "no_key" });
  if (+(req.headers.get("content-length") || 0) > 64 * 1024) return json(413, { error: "too_large" });
  const input = readBody(await req.json().catch(() => null));
  const body = buildRequest(input, env);
  const id = crypto.randomUUID();
  const book = ledger(env);
  const r = await book.reserve({ uid: who.uid, usd: estimateUsd(promptChars(input), body.max_tokens), id, now: Date.now(), tz: tz(env) }, limits(env));
  if (!r.ok) return json(r.status, { error: r.error, retryAfter: r.retryAfter || undefined, month: r.summary || undefined });

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort("timeout"), +env.TIMEOUT_MS || LIMITS.timeoutMs);
  const settle = usage => book.settle({ id, usage, now: Date.now(), tz: tz(env) });
  const acc = { text: "", usage: null, stop: null, error: null };
  // Wait for the first event so a refused or failed call is answered with a proper status, not a 200.
  const stream = claude(env).messages.stream(body, { signal: ctl.signal });
  const events = stream[Symbol.asyncIterator]();
  let first;
  try { first = await events.next(); }
  catch (e) {
    clearTimeout(timer); await settle(null);
    if (ctl.signal.aborted) return json(504, { error: "timeout" });
    const [code, status] = upstreamError(e instanceof Anthropic.APIError ? e.status : 0, e && e.message);
    console.log("coach upstream", e instanceof Anthropic.APIError ? e.status : "network"); // status only; never the request or the answer
    return json(status, { error: code });
  }

  const { readable, writable } = new TransformStream();
  const out = writable.getWriter(), enc = new TextEncoder();
  ctx.waitUntil((async () => {
    let clientGone = false;
    const send = async o => { if (clientGone) return; try { await out.write(enc.encode(JSON.stringify(o) + "\n")); } catch (e) { clientGone = true; ctl.abort("client"); } };
    try {
      for (let it = first; !it.done; it = await events.next()) {
        const t = foldEvent(acc, { data: it.value });
        if (t) await send({ t: "d", text: t });
        if (clientGone) break;
      }
    } catch (e) { acc.error = ctl.signal.aborted && ctl.signal.reason === "timeout" ? "timeout" : clientGone ? "cancelled" : "stream_broken"; }
    clearTimeout(timer);
    // Usage Anthropic reported. If the answer was cut off, the output it had generated is unknown, so it is
    // counted as the whole max_tokens (an upper bound) rather than guessed low.
    let usage = acc.usage;
    if (usage && (acc.error || !acc.stop)) { usage = Object.assign({}, usage, { output_tokens: Math.max(+usage.output_tokens || 0, body.max_tokens) }); if (!acc.error) acc.error = "stream_broken"; }
    let s = null;
    try { s = await settle(usage); } catch (e) {}
    if (acc.error) await send({ t: "error", error: acc.error, costUsd: s ? s.usd : null, month: s ? s.summary : null });
    else await send({ t: "done", stop: acc.stop, costUsd: s ? s.usd : null, month: s ? s.summary : null,
      usage: { input: usage.input_tokens || 0, cacheWrite: usage.cache_creation_input_tokens || 0, cacheRead: usage.cache_read_input_tokens || 0, output: usage.output_tokens || 0 } });
    try { await out.close(); } catch (e) {}
  })());
  return new Response(readable, { status: 200, headers: Object.assign({ "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-coach-model": MODEL }, CORS) });
}

// Menu screenshots -> the printed numbers as JSON. Not streamed: the app waits for the whole list anyway.
async function readMenu(req, env, who) {
  if (!env.ANTHROPIC_API_KEY) return json(503, { error: "no_key" });
  if (+(req.headers.get("content-length") || 0) > 8 * 1024 * 1024) return json(413, { error: "too_large" });
  const input = readImageBody(await req.json().catch(() => null));
  const body = buildReadRequest(input);
  const id = crypto.randomUUID(), book = ledger(env);
  const r = await book.reserve({ uid: who.uid, usd: readEstimateUsd(input), id, now: Date.now(), tz: tz(env) }, limits(env));
  if (!r.ok) return json(r.status, { error: r.error, retryAfter: r.retryAfter || undefined, month: r.summary || undefined });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort("timeout"), +env.TIMEOUT_MS || 90000);
  let msg;
  try { msg = await claude(env).messages.create(body, { signal: ctl.signal }); }
  catch (e) {
    clearTimeout(timer); await book.settle({ id, usage: null, now: Date.now(), tz: tz(env) });
    if (ctl.signal.aborted) return json(504, { error: "timeout" });
    const [code, status] = upstreamError(e instanceof Anthropic.APIError ? e.status : 0, e && e.message);
    console.log("read upstream", e instanceof Anthropic.APIError ? e.status : "network");
    return json(status, { error: code });
  }
  clearTimeout(timer);
  const s = await book.settle({ id, usage: msg.usage || null, now: Date.now(), tz: tz(env) }).catch(() => null);
  const text = (msg.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  return json(200, { text, stop: msg.stop_reason || null, costUsd: s ? s.usd : null, month: s ? s.summary : null });
}

// USDA FoodData Central, proxied so the data.gov key stays here. Owner only, no Claude, no spending; answers are cached a day
// (the same search from the phone twice costs USDA one call). FDC's own 429 is passed on as rate_limited.
async function fdcProxy(env, ctx, input, buildReq, cacheKeyOf, trim) {
  const cache = typeof caches !== "undefined" && caches.default ? caches.default : null;
  const ck = new Request(cacheKeyOf(input));
  if (cache) { const hit = await cache.match(ck).catch(() => null); if (hit) { const j = await hit.json().catch(() => null); if (j) return json(200, Object.assign(j, { cached: true })); } }
  const { url, init } = buildReq(input, env.FDC_API_KEY);
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort("timeout"), 15000);
  let res; try { res = await fetch(url, Object.assign({}, init, { signal: ctl.signal })); } catch (e) { clearTimeout(timer); return json(ctl.signal.aborted ? 504 : 502, { error: ctl.signal.aborted ? "timeout" : "upstream_unavailable" }); }
  clearTimeout(timer);
  if (res.status === 429) return json(429, { error: "rate_limited", retryAfter: +(res.headers.get("retry-after") || 0) || undefined, fdcKey: env.FDC_API_KEY ? "own" : "demo" });
  if (res.status === 404) return json(404, { error: "not_found" });
  if (!res.ok) { console.log("fdc upstream", res.status); return json(502, { error: "upstream_error", status: res.status }); }
  const body = Object.assign(trim(await res.json().catch(() => null)), { fdcKey: env.FDC_API_KEY ? "own" : "demo", source: "USDA FoodData Central" });
  if (cache) { const stored = new Response(JSON.stringify(body), { headers: { "content-type": "application/json", "cache-control": "public, max-age=" + FDC.cacheSeconds } }); const putP = cache.put(ck, stored).catch(() => {}); if (ctx && ctx.waitUntil) ctx.waitUntil(putP); }
  return json(200, body);
}

// Voice clean-up: one short Haiku call under the same ledger, cap and per-account limits as the chat.
async function tidy(req, env, who) {
  if (!env.ANTHROPIC_API_KEY) return json(503, { error: "no_key" });
  if (+(req.headers.get("content-length") || 0) > 16 * 1024) return json(413, { error: "too_large" });
  const input = readTidyBody(await req.json().catch(() => null));
  const body = buildTidyRequest(input);
  const id = crypto.randomUUID(), book = ledger(env);
  const r = await book.reserve({ uid: who.uid, usd: tidyEstimateUsd(input), id, now: Date.now(), tz: tz(env) }, limits(env));
  if (!r.ok) return json(r.status, { error: r.error, retryAfter: r.retryAfter || undefined, month: r.summary || undefined });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort("timeout"), Math.min(+env.TIMEOUT_MS || 20000, 20000));
  let msg;
  try { msg = await claude(env).messages.create(body, { signal: ctl.signal }); }
  catch (e) {
    clearTimeout(timer); await book.settle({ id, usage: null, now: Date.now(), tz: tz(env) });
    if (ctl.signal.aborted) return json(504, { error: "timeout" });
    const [code, status] = upstreamError(e instanceof Anthropic.APIError ? e.status : 0, e && e.message);
    console.log("tidy upstream", e instanceof Anthropic.APIError ? e.status : "network");
    return json(status, { error: code });
  }
  clearTimeout(timer);
  const s = await book.settle({ id, usage: msg.usage || null, now: Date.now(), tz: tz(env) }).catch(() => null);
  const text = (msg.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
  return json(200, { text: msg.stop_reason === "max_tokens" ? "" : text, costUsd: s ? s.usd : null, month: s ? s.summary : null });
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    googleKeys.url = env.FIREBASE_JWKS_URL || null; // test override only; production uses Google's keys
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    try {
      if (url.pathname === "/v1/health" && req.method === "GET") return json(200, { ok: true, model: MODEL, keySet: !!env.ANTHROPIC_API_KEY, ownerSet: !!(env.ALLOWED_EMAILS || env.ALLOWED_UIDS), fdcKeySet: !!env.FDC_API_KEY });
      if (url.pathname === "/v1/foods" && req.method === "GET") { await owner(req, env); return await fdcProxy(env, ctx, foodsQuery(url.searchParams), fdcSearchRequest, fdcCacheKey, trimFdcSearch); }
      if (url.pathname === "/v1/food" && req.method === "GET") { await owner(req, env); return await fdcProxy(env, ctx, foodIdQuery(url.searchParams), fdcFoodRequest, fdcFoodCacheKey, j => ({ food: trimFdcFood(j) })); }
      if (url.pathname === "/v1/usage" && req.method === "GET") { await owner(req, env); return json(200, await ledger(env).summary({ now: Date.now(), tz: tz(env) })); }
      if (url.pathname === "/v1/cap" && req.method === "POST") {
        await owner(req, env);
        const b = await req.json().catch(() => ({}));
        const r = await ledger(env).setCap({ capUsd: b && b.capUsd, now: Date.now(), tz: tz(env) });
        return r.ok ? json(200, r.summary) : json(400, { error: r.error });
      }
      if (url.pathname === "/v1/chat" && req.method === "POST") return await chat(req, env, ctx, await owner(req, env));
      if (url.pathname === "/v1/read" && req.method === "POST") return await readMenu(req, env, await owner(req, env));
      if (url.pathname === "/v1/tidy" && req.method === "POST") return await tidy(req, env, await owner(req, env));
      return json(404, { error: "not_found" });
    } catch (e) {
      if (e && e.code) return json(e.status || 400, { error: e.code, uid: e.uid || undefined });
      console.log("coach error", e && e.name);
      return json(500, { error: "server_error" });
    }
  },
};

// The spending ledger. One instance ("mizan") holds the month's totals. A Durable Object handles one call at a
// time while its storage reads and writes are pending, so two answers can never both squeeze under the cap.
import { DurableObject } from "cloudflare:workers";
export class CoachLedger extends DurableObject {
  async load(now, tzName) { return ledgerTidy(await this.ctx.storage.get("ledger"), now, tzName); }
  async reserve(req, lim) { const r = ledgerReserve(await this.ctx.storage.get("ledger"), req, lim); await this.ctx.storage.put("ledger", r.state); delete r.state; return r; }
  async settle(req) { const r = ledgerSettle(await this.ctx.storage.get("ledger"), req); await this.ctx.storage.put("ledger", r.state); delete r.state; return r; }
  async setCap(req) { const r = ledgerSetCap(await this.ctx.storage.get("ledger"), req.capUsd, req.now, req.tz); await this.ctx.storage.put("ledger", r.state); delete r.state; return r; }
  async summary(req) { const s = await this.load(req.now, req.tz); await this.ctx.storage.put("ledger", s); return ledgerSummary(s); }
}
export { round6 };
