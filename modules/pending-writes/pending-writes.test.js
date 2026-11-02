const test = require("node:test");
const assert = require("node:assert");
const PW = require("./pending-writes.js");

function mem() { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; }, m }; }
function harness(execImpl) {
  const storage = mem(); const calls = []; let fail = false;
  const exec = async w => { calls.push(JSON.parse(JSON.stringify(w))); if (fail) { const e = new Error("offline"); e.code = "unavailable"; throw e; } if (execImpl) return execImpl(w); };
  const q = PW.create({ storage, key: "p", mergeCols: ["days"], exec, onChange: () => {} });
  return { q, storage, calls, setFail: v => { fail = v; } };
}

test("changedFields: only differing top-level keys; removed key forces a full write", () => {
  assert.deepStrictEqual(PW.changedFields({ a: 1, b: [1], c: { x: 1 } }, { a: 1, b: [1, 2], c: { x: 1 }, d: 5 }), ["b", "d"]);
  assert.strictEqual(PW.changedFields({ a: 1, b: 2 }, { a: 1 }), null);
  assert.strictEqual(PW.changedFields(undefined, { a: 1 }), null);
  assert.deepStrictEqual(PW.changedFields({ a: 1 }, { a: 1 }), []);
});

test("a successful write leaves nothing pending; days writes carry changed fields", async () => {
  const h = harness();
  await h.q.put("days", "2026-10-25", { date: "2026-10-25", water: 500, food: [] }, { date: "2026-10-25", water: 0, food: [] });
  assert.strictEqual(h.q.size(), 0);
  assert.deepStrictEqual(h.calls[0].fields, ["water"]);
  assert.deepStrictEqual(PW.pick(h.calls[0].data, h.calls[0].fields), { water: 500 });
  await h.q.put("weights", "2026-10-25", { kg: 91 }, undefined);
  assert.strictEqual(h.calls[1].fields, undefined);
});

test("unchanged doc is not written at all", async () => {
  const h = harness();
  await h.q.put("days", "d", { a: 1 }, { a: 1 });
  assert.strictEqual(h.calls.length, 0);
});

test("a failed write is kept in storage, retried, and cleared on success", async () => {
  const h = harness(); h.setFail(true);
  await h.q.put("weights", "w1", { kg: 90 }, undefined);
  assert.strictEqual(h.q.size(), 1);
  assert.match(JSON.parse(h.storage.m.p)["weights/w1"].err, /offline/);
  // a new page load picks it up
  const q2 = PW.create({ storage: h.storage, key: "p", exec: async w => { h.calls.push(w); } });
  assert.strictEqual(q2.load(), 1);
  await q2.retryAll();
  assert.strictEqual(q2.size(), 0);
  assert.strictEqual(JSON.parse(h.storage.m.p)["weights/w1"], undefined);
});

test("two failed field writes to the same day coalesce into one with both fields", async () => {
  const h = harness(); h.setFail(true);
  const base = { date: "d", water: 0, steps: 0, food: [] };
  await h.q.put("days", "d", { ...base, water: 500 }, base);
  await h.q.put("days", "d", { ...base, water: 500, steps: 8000 }, { ...base, water: 500 });
  assert.strictEqual(h.q.size(), 1);
  h.setFail(false); h.calls.length = 0;
  await h.q.retryAll();
  assert.strictEqual(h.calls.length, 1);
  assert.deepStrictEqual(h.calls[0].fields.sort(), ["steps", "water"]);
  assert.strictEqual(h.calls[0].data.steps, 8000);
});

test("a full write queued after a field write sends the whole doc", async () => {
  const h = harness(); h.setFail(true);
  await h.q.put("days", "d", { a: 2, b: 1 }, { a: 1, b: 1 });
  await h.q.put("days", "d", { a: 2 }, { a: 2, b: 1 });   // key removed → full doc
  h.setFail(false); h.calls.length = 0;
  await h.q.retryAll();
  assert.strictEqual(h.calls[0].fields, undefined);
  assert.deepStrictEqual(h.calls[0].data, { a: 2 });
});

test("overlay keeps pending local changes on top of an incoming snapshot", async () => {
  const h = harness(); h.setFail(true);
  await h.q.put("days", "d", { date: "d", water: 750, food: [] }, { date: "d", water: 0, food: [] });
  await h.q.put("weights", "w2", { kg: 89 }, undefined);
  await h.q.remove("weights", "w1");
  const days = h.q.overlay("days", { d: { date: "d", water: 0, food: [{ id: 1 }] }, e: { date: "e" } });
  assert.deepStrictEqual(days.d, { date: "d", water: 750, food: [{ id: 1 }] });   // server's food kept, local water wins
  assert.deepStrictEqual(days.e, { date: "e" });
  const w = h.q.overlay("weights", { w1: { kg: 95 }, w3: { kg: 88 } });
  assert.deepStrictEqual(w, { w3: { kg: 88 }, w2: { kg: 89 } });
});

test("writes to one document run one at a time, in order", async () => {
  let active = 0, max = 0; const order = [];
  const q = PW.create({ storage: mem(), exec: async w => { active++; max = Math.max(max, active); await new Promise(r => setTimeout(r, 5)); order.push(w.data.n); active--; } });
  await Promise.all([q.put("weights", "a", { n: 1 }), q.put("weights", "a", { n: 2 }), q.put("weights", "b", { n: 3 })]);
  assert.strictEqual(max, 2);           // a and b in parallel
  assert.deepStrictEqual(order.sort(), [2, 3]);   // a's two writes coalesced into the latest one
});

test("bulk(): writes are stored once and sent in batches through execMany", async () => {
  const storage = mem(); const single = [], batches = [];
  const q = PW.create({ storage, key: "p", mergeCols: ["days"], batchSize: 3, exec: async w => single.push(w.id), execMany: async ws => batches.push(ws.map(w => w.id)), onChange: () => {} });
  await q.bulk(async () => { for (let i = 0; i < 7; i++) await q.put("workouts", "d" + i, { date: "d" + i }, undefined); });
  assert.strictEqual(q.size(), 0);
  assert.deepStrictEqual(batches, [["d0", "d1", "d2"], ["d3", "d4", "d5"], ["d6"]]);
  assert.deepStrictEqual(single, []);
  // a field merge inside a bulk still goes alone
  await q.bulk(async () => { await q.put("workouts", "x", { a: 1 }, undefined); await q.put("workouts", "y", { a: 1 }, undefined); await q.put("days", "d", { date: "d", water: 1 }, { date: "d", water: 0 }); });
  assert.deepStrictEqual(batches[3], ["x", "y"]);
  assert.deepStrictEqual(single, ["d"]);
});

test("a failed batch keeps every write, records the error, and clears on a later retry", async () => {
  const storage = mem(); let fail = true; const fails = [];
  const q = PW.create({ storage, key: "p", mergeCols: [], exec: async () => {}, execMany: async () => { if (fail) throw new Error("permission-denied"); }, onChange: () => {}, onFail: w => fails.push(w.id) });
  await q.bulk(async () => { await q.put("workouts", "a", { a: 1 }); await q.put("workouts", "b", { b: 1 }); });
  assert.strictEqual(q.size(), 2);
  assert.strictEqual(q.firstError(), "permission-denied");
  assert.deepStrictEqual(fails, ["a"]);
  assert.strictEqual(JSON.parse(storage.m.p)["workouts/b"].err, "permission-denied");
  fail = false; await q.retryAll();
  assert.strictEqual(q.size(), 0); assert.strictEqual(q.firstError(), null);
});
