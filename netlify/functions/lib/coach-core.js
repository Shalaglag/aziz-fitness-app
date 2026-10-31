/* Server-side pieces of the Ask Claude endpoint, kept free of I/O so they can be tested:
 *   verifyIdToken(token, {projectId, certs, now})  -> {uid} or throws {code}
 *   usageDoc / nextUsage                           -> the per-user daily counter (Firestore REST shape)
 *   buildMessages(body, Coach)                      -> validated {question, ctx, history, prompt}
 * No network here: the function (coach.mjs) fetches the Google certs and talks to Firestore and Anthropic.
 */
const crypto = require("crypto");

const MAX_QUESTION = 600, MAX_CTX_CHARS = 60000, MAX_HISTORY = 4;

const err = (code, status) => { const e = new Error(code); e.code = code; e.status = status || 400; return e; };
const b64url = s => Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");

// Firebase ID tokens are RS256 JWTs signed by Google; the public certs are x509 PEMs keyed by `kid`.
function verifyIdToken(token, opts) {
  const { projectId, certs, now = Date.now() } = opts || {};
  if (!projectId) throw err("no_project", 503);
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw err("bad_token", 401);
  let header, payload;
  try { header = JSON.parse(b64url(parts[0]).toString("utf8")); payload = JSON.parse(b64url(parts[1]).toString("utf8")); } catch (e) { throw err("bad_token", 401); }
  if (!header || header.alg !== "RS256" || !header.kid || !certs || !certs[header.kid]) throw err("bad_token", 401);
  let ok = false;
  try { ok = crypto.verify("RSA-SHA256", Buffer.from(parts[0] + "." + parts[1]), crypto.createPublicKey(certs[header.kid]), b64url(parts[2])); } catch (e) { ok = false; }
  if (!ok) throw err("bad_signature", 401);
  const t = Math.floor(now / 1000);
  if (!payload || typeof payload.exp !== "number" || payload.exp <= t) throw err("token_expired", 401);
  if (typeof payload.iat === "number" && payload.iat > t + 300) throw err("bad_token", 401);
  if (payload.aud !== projectId || payload.iss !== "https://securetoken.google.com/" + projectId) throw err("wrong_project", 401);
  if (typeof payload.sub !== "string" || !payload.sub || payload.sub.length > 128) throw err("bad_token", 401);
  return { uid: payload.sub, email: payload.email || null };
}

// Daily counter stored at users/{uid}/coach/usage as {date, n}. Firestore REST documents look like
// {fields:{date:{stringValue}, n:{integerValue:"3"}}}.
function usageDoc(doc) {
  const f = (doc && doc.fields) || {};
  return { date: f.date && f.date.stringValue || "", n: f.n ? parseInt(f.n.integerValue || f.n.doubleValue || "0", 10) || 0 : 0 };
}
function nextUsage(current, today, cap) {
  const u = current && current.date === today ? current : { date: today, n: 0 };
  if (u.n >= cap) return { allowed: false, n: u.n, cap };
  return { allowed: true, n: u.n + 1, cap, doc: { fields: { date: { stringValue: today }, n: { integerValue: String(u.n + 1) } } } };
}
const localDate = (now, tz) => { try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "Asia/Kuwait", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now)); } catch (e) { return new Date(now).toISOString().slice(0, 10); } };

// What the browser sends: {question, ctx, history}. ctx is the Coach.context() pack (already minimal);
// the server re-checks sizes and composes the prompt with the shared Coach.prompt so the rules can't be
// dropped client-side.
function buildMessages(body, Coach) {
  if (!body || typeof body !== "object") throw err("bad_request", 400);
  const question = String(body.question || "").replace(/\s+/g, " ").trim().slice(0, MAX_QUESTION);
  if (!question) throw err("empty_question", 400);
  const ctx = body.ctx && typeof body.ctx === "object" && !Array.isArray(body.ctx) ? body.ctx : {};
  const ctxJson = JSON.stringify(ctx);
  if (ctxJson.length > MAX_CTX_CHARS) throw err("prompt_too_large", 413);
  const history = (Array.isArray(body.history) ? body.history : []).slice(-MAX_HISTORY)
    .filter(h => h && typeof h.q === "string" && typeof h.a === "string").map(h => ({ q: h.q.slice(0, MAX_QUESTION), a: h.a.slice(0, 1500) }));
  return { question, ctx, history, prompt: Coach.prompt(question, ctx, history) };
}

const SYSTEM = "You are the personal fitness coach built into the user's own tracking app. Follow the rules in the message exactly: use only the DATA given, never invent values, say what is missing, explain why with evidence, and reply with only the requested JSON.";

module.exports = { verifyIdToken, usageDoc, nextUsage, localDate, buildMessages, SYSTEM, MAX_QUESTION, MAX_CTX_CHARS, MAX_HISTORY };
