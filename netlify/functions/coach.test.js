const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const core = require("./lib/coach-core.js");
const Coach = require("../../modules/coach/coach.js");

// A throwaway RSA key pair + self-signed-looking cert substitute: createPublicKey accepts a public key PEM
// as well as an x509 cert, so the test signs with the private key and verifies with the public PEM.
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const pub = publicKey.export({ type: "spki", format: "pem" });
const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
const PID = "aziz-fitness";
function makeToken(over = {}, kid = "k1", key = privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const payload = Object.assign({ iss: "https://securetoken.google.com/" + PID, aud: PID, sub: "uid123", iat: now - 10, exp: now + 3600, email: "a@b.c" }, over);
  const head = b64({ alg: "RS256", kid }) + "." + b64(payload);
  const sig = crypto.sign("RSA-SHA256", Buffer.from(head), key).toString("base64url");
  return head + "." + sig;
}
const certs = { k1: pub };

test("verifyIdToken accepts a valid token and returns the uid", () => {
  const r = core.verifyIdToken(makeToken(), { projectId: PID, certs });
  assert.equal(r.uid, "uid123");
  assert.equal(r.email, "a@b.c");
});

test("verifyIdToken rejects expired, wrong-project, unknown-key and tampered tokens", () => {
  const code = fn => { try { fn(); return "ok"; } catch (e) { return e.code; } };
  assert.equal(code(() => core.verifyIdToken(makeToken({ exp: Math.floor(Date.now() / 1000) - 5 }), { projectId: PID, certs })), "token_expired");
  assert.equal(code(() => core.verifyIdToken(makeToken({ aud: "other" }), { projectId: PID, certs })), "wrong_project");
  assert.equal(code(() => core.verifyIdToken(makeToken({}, "nope"), { projectId: PID, certs })), "bad_token");
  const other = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  assert.equal(code(() => core.verifyIdToken(makeToken({}, "k1", other), { projectId: PID, certs })), "bad_signature");
  const t = makeToken(); const parts = t.split("."); parts[1] = b64({ iss: "https://securetoken.google.com/" + PID, aud: PID, sub: "someone-else", exp: Math.floor(Date.now() / 1000) + 100 });
  assert.equal(code(() => core.verifyIdToken(parts.join("."), { projectId: PID, certs })), "bad_signature");
  assert.equal(code(() => core.verifyIdToken("garbage", { projectId: PID, certs })), "bad_token");
  assert.equal(code(() => core.verifyIdToken(makeToken(), { projectId: "", certs })), "no_project");
});

test("daily cap counts per day and blocks at the cap", () => {
  const today = "2026-10-26";
  let u = core.nextUsage(null, today, 3);
  assert.deepEqual([u.allowed, u.n], [true, 1]);
  u = core.nextUsage(core.usageDoc(u.doc), today, 3); assert.equal(u.n, 2);
  u = core.nextUsage(core.usageDoc(u.doc), today, 3); assert.equal(u.n, 3);
  const blocked = core.nextUsage(core.usageDoc(u.doc), today, 3);
  assert.equal(blocked.allowed, false);
  const tomorrow = core.nextUsage(core.usageDoc(u.doc), "2026-10-27", 3);
  assert.deepEqual([tomorrow.allowed, tomorrow.n], [true, 1]);
  assert.equal(core.usageDoc({ fields: { date: { stringValue: today }, n: { integerValue: "7" } } }).n, 7);
});

test("localDate uses the Kuwait day boundary", () => {
  assert.equal(core.localDate(Date.UTC(2026, 9, 25, 22, 30)), "2026-10-26"); // 01:30 in Kuwait
});

test("buildMessages validates sizes and composes the shared prompt", () => {
  const ctx = { today: "2026-10-26", targets: { kcal: 2000 } };
  const b = core.buildMessages({ question: "  Should I   rest today? ", ctx, history: [{ q: "a", a: "b" }, { q: 1, a: 2 }] }, Coach);
  assert.equal(b.question, "Should I rest today?");
  assert.equal(b.history.length, 1);
  assert.ok(b.prompt.includes("Never invent numbers"));
  assert.ok(b.prompt.includes('"kcal":2000'));
  assert.equal(b.prompt, Coach.prompt("Should I rest today?", ctx, [{ q: "a", a: "b" }]));
  assert.throws(() => core.buildMessages({ question: "" }, Coach), e => e.code === "empty_question");
  assert.throws(() => core.buildMessages({ question: "x", ctx: { big: "y".repeat(core.MAX_CTX_CHARS) } }, Coach), e => e.code === "prompt_too_large");
  assert.throws(() => core.buildMessages(null, Coach), e => e.code === "bad_request");
});
