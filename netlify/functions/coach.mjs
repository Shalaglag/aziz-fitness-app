/* POST /api/coach: the Ask Claude endpoint for the app's own website.
 *
 * The browser sends {question, ctx, history} with the signed-in person's Firebase ID token in
 * `Authorization: Bearer …`. This function checks the token against Google's public keys, counts the
 * question against a per-day cap (users/{uid}/coach/usage, written through Firestore's REST API with
 * that same token, so the person's own rules apply), composes the prompt with the shared Coach module and
 * streams Claude's reply back as plain text. The API key never reaches the browser.
 *
 * Environment (Netlify site settings):
 *   ANTHROPIC_API_KEY   required to answer; unset -> 503 {"error":"no_key"} and the app says so
 *   FIREBASE_PROJECT_ID defaults to the projectId in app/cloud-config.js
 *   COACH_MODEL         default claude-opus-5-5
 *   COACH_DAILY_CAP     default 40 questions a person a day
 *   COACH_MAX_TOKENS    default 700
 *   COACH_TZ            day boundary for the cap, default Asia/Kuwait
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";

const require = createRequire(import.meta.url);
const core = require("./lib/coach-core.js");
const Coach = require("../../modules/coach/coach.js");

export const config = { path: "/api/coach" };

const CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
let certCache = { at: 0, certs: null };
async function googleCerts() {
  if (certCache.certs && Date.now() - certCache.at < 3600e3) return certCache.certs;
  const r = await fetch(CERTS_URL);
  if (!r.ok) throw Object.assign(new Error("certs"), { code: "auth_unavailable", status: 503 });
  certCache = { at: Date.now(), certs: await r.json() };
  return certCache.certs;
}

function projectId() {
  if (process.env.FIREBASE_PROJECT_ID) return process.env.FIREBASE_PROJECT_ID;
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(path.join(here, "../../app/cloud-config.js"), "utf8");
    const m = /projectId:\s*"([^"]*)"/.exec(src);
    return m && m[1] ? m[1] : "";
  } catch (e) { return ""; }
}

const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

// The per-day counter lives in the person's own data, written with their token (Firestore rules allow it).
async function countQuestion(pid, uid, token) {
  const cap = parseInt(process.env.COACH_DAILY_CAP || "40", 10) || 40;
  const url = `https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents/users/${uid}/coach/usage`;
  const h = { authorization: "Bearer " + token, "content-type": "application/json" };
  let current = null;
  const g = await fetch(url, { headers: h });
  if (g.ok) current = core.usageDoc(await g.json()); else if (g.status !== 404) throw Object.assign(new Error("usage"), { code: "usage_unavailable", status: 503 });
  const next = core.nextUsage(current, core.localDate(Date.now(), process.env.COACH_TZ), cap);
  if (!next.allowed) return next;
  const p = await fetch(url + "?updateMask.fieldPaths=date&updateMask.fieldPaths=n", { method: "PATCH", headers: h, body: JSON.stringify(next.doc) });
  if (!p.ok) throw Object.assign(new Error("usage"), { code: "usage_unavailable", status: 503 });
  return next;
}

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "method" });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return json(503, { error: "no_key" });
  const pid = projectId();
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return json(401, { error: "not_signed_in" });

  let who, built, usage;
  try {
    who = core.verifyIdToken(token, { projectId: pid, certs: await googleCerts() });
    built = core.buildMessages(await req.json().catch(() => null), Coach);
    usage = await countQuestion(pid, who.uid, token);
  } catch (e) {
    return json(e.status || 400, { error: e.code || "bad_request" });
  }
  if (!usage.allowed) return json(429, { error: "daily_cap", cap: usage.cap });

  const client = new Anthropic({ apiKey: key });
  const model = process.env.COACH_MODEL || "claude-opus-5-5";
  const maxTokens = parseInt(process.env.COACH_MAX_TOKENS || "700", 10) || 700;
  const enc = new TextEncoder();
  let stream;
  try {
    stream = client.messages.stream({
      model, max_tokens: maxTokens,
      system: core.SYSTEM,
      output_config: { effort: "low" },
      messages: [{ role: "user", content: built.prompt }],
    }, { signal: req.signal });
  } catch (e) {
    return json(502, { error: "upstream" });
  }
  const body = new ReadableStream({
    async start(controller) {
      try {
        for await (const ev of stream) {
          if (ev.type === "content_block_delta" && ev.delta && ev.delta.type === "text_delta") controller.enqueue(enc.encode(ev.delta.text));
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === "refusal") controller.enqueue(enc.encode(JSON.stringify({ answer: "I can't help with that one. Try asking it another way." })));
      } catch (e) {
        // Mid-stream failure: the client sees a short or empty body and shows "couldn't be read, try again".
      }
      controller.close();
    },
    cancel() { try { stream.abort(); } catch (e) {} },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-coach-usage": `${usage.n}/${usage.cap}` } });
};
