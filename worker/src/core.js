/* Pure pieces of the Mizan coach service (Cloudflare Worker), kept free of I/O so they can be tested in Node:
 *   PRICES / costUsd(usage) / estimateUsd(chars, maxTokens)  -> Haiku 5.5 list prices and per-request cost
 *   verifyIdToken(token, {projectId, jwks, now})           -> {uid, email} or throws {code, status} (WebCrypto)
 *   isAllowed(who, env)                                    -> only the owner's account(s) may spend the credit
 *   readBody(body)                                         -> validated {question, ctx, history, effort, lang}
 *   buildRequest(input, env)                               -> the Messages API request body
 *   ledger*                                                -> the monthly spending ledger (state in, state out)
 *   foldEvent(acc, ev)                                     -> fold one SDK stream event into text / usage / stop
 * The Worker (index.js) does the network calls; the ledger runs inside one Durable Object, so every
 * reserve/settle is applied one at a time (no two requests can both pass the cap).
 */

// Claude Haiku 5.5 list prices, USD per million tokens (platform.claude.com, checked 2026-11-02).
// The long-context rates apply when one prompt is over 100K tokens; the service never sends that much.
export const MODEL = "claude-haiku-5-5";
export const PRICES = {
  base: { input: 0.10, output: 0.50, cacheWrite5m: 0.125, cacheRead: 0.01 },
  long: { input: 0.50, output: 2.50, cacheWrite5m: 0.625, cacheRead: 0.05 },
  longOver: 100000,
};

export const LIMITS = {
  question: 600,          // characters in one question
  ctxChars: 40000,        // the app's data summary (JSON characters)
  history: 4,             // earlier turns sent back
  historyQ: 600, historyA: 1200,
  maxTokens: { low: 900, medium: 1400 }, // thinking + the JSON answer
  timeoutMs: 60000,
};

const err = (code, status, extra) => Object.assign(new Error(code), { code, status: status || 400 }, extra || {});
export { err };

const M = 1e6;
export function costUsd(u) {
  u = u || {};
  const inTok = (+u.input_tokens || 0), cw = (+u.cache_creation_input_tokens || 0), cr = (+u.cache_read_input_tokens || 0), out = (+u.output_tokens || 0);
  const p = inTok + cw + cr > PRICES.longOver ? PRICES.long : PRICES.base;
  return (inTok * p.input + cw * p.cacheWrite5m + cr * p.cacheRead + out * p.output) / M;
}
// Before a call: a deliberately high guess. Every character counted as one token (real text runs
// about 3-4 characters a token, Arabic about 2), all of it billed as a cache write, and the whole
// max_tokens used. The reservation is replaced by the real cost when the answer ends.
export function estimateUsd(promptChars, maxTokens) {
  const inTok = Math.ceil(promptChars) + 400;
  const p = inTok > PRICES.longOver ? PRICES.long : PRICES.base;
  return (inTok * p.cacheWrite5m + maxTokens * p.output) / M;
}
export const round6 = x => Math.round((+x || 0) * 1e6) / 1e6;

// ---------- Firebase ID token (RS256 JWT) ----------
const b64urlBytes = s => { s = String(s).replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; const bin = atob(s); const b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return b; };
const b64urlJson = s => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));
export const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

export async function verifyIdToken(token, opts) {
  const { projectId, jwks, now = Date.now(), subtle = crypto.subtle } = opts || {};
  if (!projectId) throw err("no_project", 503);
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw err("bad_token", 401);
  let header, payload;
  try { header = b64urlJson(parts[0]); payload = b64urlJson(parts[1]); } catch (e) { throw err("bad_token", 401); }
  const jwk = header && header.alg === "RS256" && header.kid && jwks && (jwks.keys || []).find(k => k.kid === header.kid);
  if (!jwk) throw err("bad_token", 401);
  let ok = false;
  try {
    const key = await subtle.importKey("jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    ok = await subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlBytes(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1]));
  } catch (e) { ok = false; }
  if (!ok) throw err("bad_signature", 401);
  const t = Math.floor(now / 1000);
  if (!payload || typeof payload.exp !== "number" || payload.exp <= t) throw err("token_expired", 401);
  if (typeof payload.iat === "number" && payload.iat > t + 300) throw err("bad_token", 401);
  if (typeof payload.auth_time === "number" && payload.auth_time > t + 300) throw err("bad_token", 401);
  if (payload.aud !== projectId || payload.iss !== "https://securetoken.google.com/" + projectId) throw err("wrong_project", 401);
  if (typeof payload.sub !== "string" || !payload.sub || payload.sub.length > 128) throw err("bad_token", 401);
  return { uid: payload.sub, email: typeof payload.email === "string" ? payload.email.toLowerCase() : null };
}

// Only the owner's account(s) may spend the credit. Both lists are comma separated Worker variables;
// both empty means nobody (the service fails closed).
const list = s => String(s || "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
export function isAllowed(who, env) {
  if (!who) return false;
  const uids = list(env.ALLOWED_UIDS), emails = list(env.ALLOWED_EMAILS);
  return uids.includes(String(who.uid).toLowerCase()) || (!!who.email && emails.includes(who.email));
}

// ---------- request body ----------
const clean = (s, n) => String(s == null ? "" : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/[ \t]+/g, " ").trim().slice(0, n);
export function readBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw err("bad_request", 400);
  const question = clean(body.question, LIMITS.question);
  if (!question) throw err("empty_question", 400);
  const ctx = body.ctx && typeof body.ctx === "object" && !Array.isArray(body.ctx) ? body.ctx : {};
  const ctxJson = JSON.stringify(ctx);
  if (ctxJson.length > LIMITS.ctxChars) throw err("too_large", 413);
  const history = (Array.isArray(body.history) ? body.history : []).slice(-LIMITS.history)
    .filter(h => h && typeof h.q === "string" && typeof h.a === "string")
    .map(h => ({ q: clean(h.q, LIMITS.historyQ), a: clean(h.a, LIMITS.historyA) })).filter(h => h.q && h.a);
  const effort = body.effort === "medium" ? "medium" : "low";
  const lang = body.lang === "ar" ? "ar" : body.lang === "en" ? "en" : "auto";
  return { question, ctx, ctxJson, history, effort, lang };
}

// ---------- the Messages API request ----------
// The rules live here, on the server, so a modified app can't drop them. Kept stable byte for byte so the
// rules + data prefix can be read from the prompt cache on follow-up questions.
export const SYSTEM = [
  "You are the coach inside Mizan, the user's own fitness tracking app. You answer the user's questions about their training, food, body weight and recovery.",
  "Use ONLY the DATA the app sends (everything it has logged, plus the answers from its goal questionnaire). Never invent numbers, foods, nutrition values, workouts, dates or medical facts. If something you need isn't in DATA, say it isn't logged and what to log, or ask one short clarifying question instead of guessing.",
  "Goals: DATA.plan.goals lists every goal the user chose in the questionnaire (for example cut + muscle means losing fat while building muscle). Judge pace and advice against those goals, not a generic diet.",
  "Numbers: use the values the app already worked out (targets, todaySoFar, review, calorieBurn, lifts). You may add or subtract them; do not recompute targets with your own formulas.",
  "Days marked logged:false have no food data; never treat them as zero or as on target. Judge weight by averages and trends, never one weigh-in.",
  "Lifting: base loads on lifts.last5 and planToday; at most one small step (2.5 kg or one rep) when the last session hit its reps at effort 3 or less, hold when effort was 4-5 or readiness is low. Never suggest exercises in exercisesThatHurt.",
  "Food: pick only from plannedToday, savedMeals, menuToday or foods already in the logs, respect dislikes, and say what fits kcalLeft and proteinLeft.",
  "Technique: use exerciseAsked only. Say the app has a verified demo when demoVideo says so; never give a link.",
  "Pain, injury, illness or medication: general guidance only, and suggest a professional.",
  "You cannot change anything yourself. You may propose at most 2 actions, only from: set_calorie_target {kcal} (at most 150 kcal from the current target per step), add_saved_meal {name} (from savedMeals), add_menu_item {name} (from menuToday), swap_exercise {from, to} (from = an exercise in planToday), show_exercise {name}. Give each a short why. The app shows the exact change and the user must confirm it, so never say a change is done. Otherwise actions is [].",
  "Language: reply in the language of the question. For Arabic, use simple Modern Standard Arabic and keep numbers as digits with their units. Plain, friendly words, under 120 words in answer, no markdown.",
  "Reply with only one JSON object, no other text:",
  '{"answer":"...","evidence":["Weight 7-day avg 90.8 kg vs 91.6 kg the week before"],"missing":["what isn\'t logged that would help"],"suggestion":null,"actions":[]}',
  'suggestion is null or {"title":"short action","why":"one sentence"}. evidence quotes values from DATA. If you asked a clarifying question, put it in answer and leave evidence empty.',
].join("\n");

export function buildRequest(input, env) {
  env = env || {};
  const effort = input.effort === "medium" ? "medium" : "low";
  const messages = [];
  // Earlier turns as real turns; the assistant side is replayed in the JSON shape it was asked for.
  input.history.forEach(h => { messages.push({ role: "user", content: "Question: " + h.q }); messages.push({ role: "assistant", content: JSON.stringify({ answer: h.a }) }); });
  messages.push({ role: "user", content: (input.lang === "ar" ? "(The user writes in Arabic.)\n" : "") + "Question: " + input.question });
  return {
    model: MODEL, // fixed: the service never switches to another model
    max_tokens: LIMITS.maxTokens[effort],
    output_config: { effort },
    // Rules + data are the stable prefix; one breakpoint after the data lets a follow-up question in the same
    // chat read them from the cache at a tenth of the price. A one-off question pays 1.25x on that part
    // (about $0.0001), so it is kept only because chats usually have follow-ups.
    system: [
      { type: "text", text: SYSTEM },
      { type: "text", text: "DATA:\n" + input.ctxJson, cache_control: { type: "ephemeral" } },
    ],
    messages,
  };
}
export const promptChars = (input) => SYSTEM.length + input.ctxJson.length + input.question.length + input.history.reduce((s, h) => s + h.q.length + h.a.length, 0);

// ---------- the monthly ledger ----------
// state = {month, capUsd, allTimeUsd (every month so far, to compare with the prepaid credit), confirmedUsd, unsettledUsd, requests, tokens:{in, out, cacheWrite, cacheRead},
//          open:{id:{uid, usd, at}}, users:{uid:{day, n, recent:[ms]}}}
// confirmedUsd: priced from the token counts Anthropic reported. unsettledUsd: requests whose end was never
// seen (the worker died mid-answer), counted at their high estimate so nothing slips past the cap.
export const DEFAULT_CAP = 100, MAX_CAP = 100, WARN_AT = 0.8, STALE_MS = 10 * 60e3;
export const monthOf = (now, tz) => localDate(now, tz).slice(0, 7);
export function localDate(now, tz) { try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "Asia/Kuwait", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now)); } catch (e) { return new Date(now).toISOString().slice(0, 10); } }

export function freshLedger(month, capUsd, allTimeUsd) {
  return { month, capUsd: capUsd != null ? capUsd : DEFAULT_CAP, allTimeUsd: allTimeUsd || 0, confirmedUsd: 0, unsettledUsd: 0, requests: 0, tokens: { in: 0, out: 0, cacheWrite: 0, cacheRead: 0 }, open: {}, users: {} };
}
// Roll into a new month (the cap carries over) and expire reservations that never ended.
export function ledgerTidy(state, now, tz) {
  const month = monthOf(now, tz);
  let s = state && state.month ? state : freshLedger(month, state && state.capUsd, state && state.allTimeUsd);
  if (s.month !== month) {
    const carried = Object.values(s.open || {}).filter(r => now - r.at < STALE_MS);
    s = freshLedger(month, s.capUsd, s.allTimeUsd);
    // An answer that started last month and is still running is counted in the new month.
    carried.forEach((r, i) => { s.open["c" + i + "-" + r.at] = r; });
  }
  for (const [id, r] of Object.entries(s.open)) if (now - r.at >= STALE_MS) { s.unsettledUsd = round6(s.unsettledUsd + r.usd); s.allTimeUsd = round6((s.allTimeUsd || 0) + r.usd); delete s.open[id]; }
  return s;
}
export function ledgerSummary(s) {
  const pendingUsd = round6(Object.values(s.open).reduce((a, r) => a + r.usd, 0));
  const usedUsd = round6(s.confirmedUsd + s.unsettledUsd);
  const frac = s.capUsd > 0 ? (usedUsd + pendingUsd) / s.capUsd : 1;
  return { month: s.month, model: MODEL, capUsd: s.capUsd, confirmedUsd: round6(s.confirmedUsd), unsettledUsd: round6(s.unsettledUsd), pendingUsd, usedUsd, allTimeUsd: round6(s.allTimeUsd || 0), requests: s.requests, tokens: Object.assign({}, s.tokens), warnAt: WARN_AT, warn: frac >= WARN_AT, stopped: usedUsd + pendingUsd >= s.capUsd };
}
export function ledgerReserve(state, req, limits) {
  const { uid, usd, id, now, tz } = req;
  const L = Object.assign({ perMinute: 6, perDay: 60, inFlight: 2 }, limits || {});
  const s = ledgerTidy(state, now, tz);
  const day = localDate(now, tz);
  const u = s.users[uid] && s.users[uid].day === day ? s.users[uid] : { day, n: 0, recent: [] };
  u.recent = (u.recent || []).filter(t => now - t < 60e3);
  const mine = Object.values(s.open).filter(r => r.uid === uid).length;
  if (mine >= L.inFlight) return { ok: false, error: "busy", status: 429, state: s };
  if (u.recent.length >= L.perMinute) return { ok: false, error: "rate_limited", status: 429, retryAfter: Math.ceil((60e3 - (now - u.recent[0])) / 1000), state: s };
  if (u.n >= L.perDay) return { ok: false, error: "daily_limit", status: 429, state: s };
  const sum = ledgerSummary(s);
  if (sum.usedUsd + sum.pendingUsd + usd > s.capUsd) return { ok: false, error: "cap_reached", status: 402, summary: sum, state: s };
  u.n += 1; u.recent.push(now); s.users[uid] = u;
  s.open[id] = { uid, usd: round6(usd), at: now };
  return { ok: true, id, state: s, summary: ledgerSummary(s) };
}
// The answer ended: swap the estimate for the cost of the tokens Anthropic reported. With no usage at all
// (the call failed before Anthropic billed anything) nothing is added.
export function ledgerSettle(state, req) {
  const { id, usage, now, tz } = req;
  const s = ledgerTidy(state, now, tz);
  if (!s.open[id]) return { ok: false, state: s, summary: ledgerSummary(s) };
  delete s.open[id];
  const usd = usage ? costUsd(usage) : 0;
  if (usage) {
    s.confirmedUsd = round6(s.confirmedUsd + usd); s.allTimeUsd = round6((s.allTimeUsd || 0) + usd); s.requests += 1;
    s.tokens.in += +usage.input_tokens || 0; s.tokens.out += +usage.output_tokens || 0;
    s.tokens.cacheWrite += +usage.cache_creation_input_tokens || 0; s.tokens.cacheRead += +usage.cache_read_input_tokens || 0;
  }
  return { ok: true, usd: round6(usd), state: s, summary: ledgerSummary(s) };
}
export function ledgerSetCap(state, capUsd, now, tz) {
  const c = Math.round(+capUsd * 100) / 100;
  if (!(c >= 1 && c <= MAX_CAP)) return { ok: false, error: "bad_cap", state: ledgerTidy(state, now, tz) };
  const s = ledgerTidy(state, now, tz); s.capUsd = c;
  return { ok: true, state: s, summary: ledgerSummary(s) };
}

// ---------- Claude stream (events from the SDK's messages.stream) ----------
// Folds one event into the running usage / text; returns the text delta (if any).
export function foldEvent(acc, ev) {
  const d = ev.data || {};
  if (d.type === "message_start" && d.message && d.message.usage) acc.usage = Object.assign({}, d.message.usage);
  else if (d.type === "message_delta") { if (d.usage) acc.usage = Object.assign(acc.usage || {}, d.usage); if (d.delta && d.delta.stop_reason) acc.stop = d.delta.stop_reason; }
  else if (d.type === "content_block_delta" && d.delta && d.delta.type === "text_delta") { acc.text += d.delta.text; return d.delta.text; }
  else if (d.type === "error") acc.error = (d.error && d.error.type) || "upstream";
  return "";
}
