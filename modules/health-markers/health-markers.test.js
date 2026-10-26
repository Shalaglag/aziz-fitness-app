// Run: node --test modules/health-markers/health-markers.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { HealthMarkers: H } = require("./health-markers.js");

const T = "2026-10-26";
let n = 0;
const uid = () => "u" + (++n);
const mk = (input) => H.newMarker(input, { uid, now: "2026-10-20T08:00:00Z" }).doc;
const log = (doc, date, value, note) => { const r = H.addEntry(doc, { date, value, note }, { uid, now: date + "T07:00:00Z" }); assert.ok(r.ok, "addEntry " + value); return r.doc; };

test("presets fill name, unit, kind and range; custom markers need a name", () => {
  const rhr = mk({ preset: "rhr" });
  assert.equal(rhr.name, "Resting heart rate");
  assert.equal(rhr.unit, "bpm");
  assert.equal(rhr.kind, "num");
  assert.deepEqual([rhr.low, rhr.high], [50, 80]);
  assert.match(rhr.id, /^resting-heart-rate-u\d+$/);
  const bp = mk({ preset: "bp" });
  assert.equal(bp.kind, "bp");
  const custom = mk({ name: "Ferritin (lab)", unit: "ng/mL", low: "30", high: "400" });
  assert.deepEqual([custom.low, custom.high], [30, 400]);
  assert.deepEqual(H.newMarker({ unit: "x" }).errors, ["name"]);
  assert.deepEqual(H.newMarker({ name: "A", low: "10", high: "5" }).errors, ["range"]);
  assert.deepEqual(H.newMarker({ name: "A", low: "abc" }).errors, ["range"]);
  // the form sends low/high strings; cleared fields mean no range
  assert.equal(mk({ preset: "rhr", low: "", high: "" }).low, null, "cleared range is dropped");
  assert.equal(mk({ preset: "rhr", low: "", high: "90" }).high, 90);
});

test("parseValue: numbers with comma decimals, blood pressure as sys/dia", () => {
  assert.deepEqual(H.parseValue("72", { kind: "num" }), { ok: true, v: 72 });
  assert.deepEqual(H.parseValue("5,4", { kind: "num" }), { ok: true, v: 5.4 });
  assert.equal(H.parseValue("", { kind: "num" }).ok, false);
  assert.equal(H.parseValue("abc", { kind: "num" }).ok, false);
  assert.deepEqual(H.parseValue("120/80", { kind: "bp" }), { ok: true, v: 120, v2: 80 });
  assert.deepEqual(H.parseValue("118 76", { kind: "bp" }), { ok: true, v: 118, v2: 76 });
  assert.equal(H.parseValue("120", { kind: "bp" }).ok, false, "bp needs both numbers");
  assert.equal(H.parseValue("80/120", { kind: "bp" }).ok, false, "diastolic must be below systolic");
});

test("entries are kept sorted, latest wins, remove works", () => {
  let d = mk({ preset: "rhr" });
  d = log(d, "2026-10-24", "70");
  d = log(d, "2026-10-20", "74", "after a bad night");
  d = log(d, "2026-10-26", "68");
  assert.deepEqual(H.entries(d).map(e => e.date), ["2026-10-20", "2026-10-24", "2026-10-26"]);
  assert.equal(H.latest(d).v, 68);
  assert.equal(H.entries(d)[0].note, "after a bad night");
  assert.deepEqual(H.addEntry(d, { date: "2026-10-26", value: "" }).errors, ["value"]);
  assert.deepEqual(H.addEntry(d, { date: "26/10/2026", value: "70" }).errors, ["date"]);
  const id = H.entries(d)[1].id;
  const d2 = H.removeEntry(d, id);
  assert.equal(H.entries(d2).length, 2);
  assert.equal(H.entries(d).length, 3, "removeEntry does not mutate");
});

test("status against the user's range, format with unit", () => {
  const rhr = mk({ preset: "rhr" });
  assert.equal(H.status(rhr, { v: 68 }), "ok");
  assert.equal(H.status(rhr, { v: 48 }), "low");
  assert.equal(H.status(rhr, { v: 88 }), "high");
  assert.equal(H.status(mk({ name: "Waist", unit: "cm" }), { v: 90 }), null, "no range, no verdict");
  assert.equal(H.format(rhr, { v: 68 }), "68 bpm");
  assert.equal(H.format(mk({ preset: "glucose" }), { v: 5 }), "5.0 mmol/L");
  const bp = mk({ preset: "bp" });
  assert.equal(H.format(bp, { v: 120, v2: 80 }), "120/80 mmHg");
  assert.equal(H.status(bp, { v: 120, v2: 80 }), "ok");
  assert.equal(H.status(bp, { v: 138, v2: 80 }), "high");
  assert.equal(H.status(bp, { v: 120, v2: 92 }), "high", "high diastolic counts too");
  assert.equal(H.format(rhr, null), "—");
});

test("stats: change vs previous reading, 90-day window", () => {
  let d = mk({ preset: "rhr" });
  d = log(d, "2026-06-01", "80"); // outside 90 days
  d = log(d, "2026-10-01", "72");
  d = log(d, "2026-10-20", "66");
  const st = H.stats(d, { today: T });
  assert.equal(st.latest.v, 66);
  assert.equal(st.change, -6);
  assert.equal(st.n, 2);
  assert.deepEqual([st.min, st.max, st.avg], [66, 72, 69]);
  const empty = H.stats(mk({ preset: "rhr" }), { today: T });
  assert.equal(empty.latest, null);
  assert.equal(empty.change, null);
});

test("chart needs two points, draws the range band and both bp lines", () => {
  let d = mk({ preset: "rhr" });
  assert.equal(H.chartSvg(d, { today: T }), "");
  d = log(d, "2026-10-20", "72");
  assert.equal(H.chartSvg(d, { today: T }), "");
  d = log(d, "2026-10-25", "68");
  const svg = H.chartSvg(d, { today: T });
  assert.match(svg, /^<svg viewBox="0 0 320 110"/);
  assert.match(svg, /<rect [^>]*fill="var\(--good\)"/, "range band");
  assert.equal((svg.match(/<circle/g) || []).length, 2);
  let bp = mk({ preset: "bp" });
  bp = log(bp, "2026-10-20", "125/82"); bp = log(bp, "2026-10-25", "118/78");
  assert.equal((H.chartSvg(bp, { today: T }).match(/<path /g) || []).length, 2, "systolic and diastolic lines");
  // old readings only: still charted (last 12) instead of an empty box
  let old = mk({ preset: "rhr" });
  old = log(old, "2025-01-01", "70"); old = log(old, "2025-02-01", "71");
  assert.match(H.chartSvg(old, { today: T }), /<svg/);
});

test("card html: empty state, list rows, open marker, add form", () => {
  assert.match(H.html({}, { today: T }), /Track anything that isn't on the scale/);
  assert.match(H.html({}, { today: T }), /data-hm="add"/);
  let d = mk({ preset: "rhr" });
  d = log(d, "2026-10-20", "72"); d = log(d, "2026-10-25", "68");
  const docs = { markers: { [d.id]: d } };
  const list = H.html(docs, { today: T });
  assert.match(list, /Resting heart rate/);
  assert.match(list, /68 bpm/);
  assert.match(list, /-4 bpm since 20 Oct/);
  assert.match(list, /pill good/);
  assert.match(list, new RegExp(`data-hm="open" data-id="${d.id}"`));
  const open = H.html(docs, { today: T, date: T, openId: d.id });
  assert.match(open, /data-hm="log"/);
  assert.match(open, /<svg/);
  assert.match(open, /90-day avg/);
  assert.match(open, /data-hm="del-entry"/);
  assert.match(open, /Delete marker/);
  assert.doesNotMatch(open, /data-hm="add"/, "no add button while a marker is open");
  assert.match(H.html(docs, { today: T, openId: d.id, confirmDel: d.id }), /Tap again to delete/);
  const add = H.html(docs, { today: T, adding: true });
  assert.match(add, /data-hm="add-marker"/);
  assert.match(add, /<option value="bp"/);
  assert.match(H.html(docs, { today: T, adding: true, preset: "bp" }), /value="mmHg"/);
  // escaping
  const evil = mk({ name: "<b>x</b>", unit: "\"q\"" });
  assert.doesNotMatch(H.html({ markers: { [evil.id]: evil } }, { today: T }), /<b>x<\/b>/);
});

test("summary lines for the coach", () => {
  let d = mk({ preset: "rhr" });
  d = log(d, "2026-10-20", "72"); d = log(d, "2026-10-25", "88");
  const lines = H.summary({ markers: { [d.id]: d, empty: mk({ preset: "waist" }) } }, { today: T });
  assert.equal(lines.length, 1, "markers without entries are skipped");
  assert.equal(lines[0], "Resting heart rate: 88 bpm on 25 Oct (high), +16 since the previous reading");
});

// tiny DOM stand-in for handle()
function fakeEl(attrs, form) {
  const el = { dataset: attrs, closest(sel) { if (sel === "[data-hm]") return el; if (sel === "form") return form; if (sel === "[data-id]") return attrs.id ? el : (form || null); if (sel === ".hm-card") return {}; return null; } };
  return el;
}
function fakeForm(values) {
  const inputs = Object.entries(values).map(([name, value]) => ({ name, value }));
  const err = { hidden: true, textContent: "" };
  return { dataset: {}, querySelectorAll(sel) { return sel === "input,select" ? inputs : []; }, querySelector(sel) { return sel === ".hm-err" ? err : null; }, err };
}
function ctx(markers) {
  const c = { docs: { markers }, date: T, puts: [], removes: [], toasts: [], rer: [], uid };
  c.put = (col, id, doc) => { c.puts.push([col, id, doc]); markers[id] = doc; };
  c.remove = (col, id) => { c.removes.push([col, id]); delete markers[id]; };
  c.toast = m => c.toasts.push(m);
  c.rerender = o => c.rer.push(o);
  return c;
}

test("handle: add a marker, log, remove an entry, two-tap delete", () => {
  const markers = {};
  const c = ctx(markers);
  assert.equal(H.handle(fakeEl({ hm: "add" }), c), true);
  assert.deepEqual(c.rer.pop(), { adding: true });
  const bad = fakeForm({ preset: "", name: "", unit: "" });
  H.handle(fakeEl({ hm: "add-marker" }, bad), c);
  assert.equal(bad.err.hidden, false);
  assert.equal(c.puts.length, 0);
  H.handle(fakeEl({ hm: "add-marker" }, fakeForm({ preset: "rhr", name: "Resting heart rate", unit: "bpm", low: "50", high: "80", kind: "num" })), c);
  assert.equal(c.puts.length, 1);
  const id = c.puts[0][1];
  assert.deepEqual(c.rer.pop(), { openId: id });
  const f = fakeForm({ date: T, value: "66", note: "" });
  f.dataset.id = id;
  H.handle(fakeEl({ hm: "log" }, f), c);
  assert.equal(markers[id].entries.length, 1);
  assert.equal(c.toasts.pop(), "Resting heart rate: 66 bpm");
  const f2 = fakeForm({ date: T, value: "x" }); f2.dataset.id = id;
  H.handle(fakeEl({ hm: "log" }, f2), c);
  assert.equal(f2.err.hidden, false);
  assert.equal(markers[id].entries.length, 1);
  H.handle(fakeEl({ hm: "del-entry", id, entry: markers[id].entries[0].id }), c);
  assert.equal(markers[id].entries.length, 0);
  H.handle(fakeEl({ hm: "del-marker", id }), c);
  assert.deepEqual(c.rer.pop(), { openId: id, confirmDel: id }, "first tap only asks");
  assert.equal(c.removes.length, 0);
  H.handle(fakeEl({ hm: "del-marker", id, confirm: "1" }), c);
  assert.deepEqual(c.removes, [["markers", id]]);
  assert.equal(H.handle({ closest: () => null }, c), false);
});
