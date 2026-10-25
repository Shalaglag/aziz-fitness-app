// Run: node --test modules/ramadan/ramadan.test.js
const test = require("node:test");
const assert = require("node:assert");
const R = require("./ramadan.js");

const mins = (s) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };

test("Ramadan 1448 range and day numbers", () => {
  assert.deepStrictEqual(R.range(), { start: "2027-02-08", end: "2027-03-09", eid: "2027-03-10" });
  assert.strictEqual(R.dayOf("2027-02-07"), 0);
  assert.strictEqual(R.dayOf("2027-02-08"), 1);
  assert.strictEqual(R.dayOf("2027-03-09"), 30);
  assert.strictEqual(R.dayOf("2027-03-10"), 0);
  assert.strictEqual(R.dayOf("2027-02-09", { start: "2027-02-09" }), 1, "start can move a day after moon sighting");
});

test("Kuwait times are in the expected window and ordered", () => {
  for (const d of ["2027-02-08", "2027-02-23", "2027-03-09"]) {
    const t = R.times(d);
    assert.ok(mins(t.fajr) > mins("04:30") && mins(t.fajr) < mins("05:20"), d + " fajr " + t.fajr);
    assert.ok(mins(t.maghrib) > mins("17:25") && mins(t.maghrib) < mins("18:00"), d + " maghrib " + t.maghrib);
    assert.strictEqual(mins(t.fajr) - mins(t.imsak), 10);
    const seq = ["imsak", "fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"].map((k) => mins(t[k]));
    assert.deepStrictEqual(seq, [...seq].sort((a, b) => a - b), d + " order");
  }
  // Days get longer through Feb/Mar: Maghrib later, Fajr earlier.
  assert.ok(mins(R.times("2027-03-09").maghrib) > mins(R.times("2027-02-08").maghrib));
  assert.ok(mins(R.times("2027-03-09").fajr) < mins(R.times("2027-02-08").fajr));
});

test("training day, after iftar: meals, training and water window", () => {
  const p = R.plan("2027-02-10", { dayType: "training" });
  assert.ok(p.isRamadan);
  assert.deepStrictEqual(p.slots.map((s) => s.id), ["iftar", "train", "post", "suhoor"]);
  assert.strictEqual(p.slots[0].time, p.times.maghrib);
  assert.strictEqual(mins(p.slots[1].time) - mins(p.times.maghrib), 120);
  assert.deepStrictEqual(p.slots.map((s) => s.appSlot), ["Meal 1", null, "Snack", "Meal 2"]);
  assert.ok(mins(p.slots[3].time) < mins(p.suhoorBy), "suhoor before imsak");
  assert.strictEqual(p.water.from, p.times.maghrib);
  assert.strictEqual(p.water.to, p.suhoorBy);
  assert.strictEqual(p.water.checkpoints.reduce((a, c) => a + c.ml, 0), 3500);
  assert.ok(p.water.checkpoints.some((c) => c.ml === 1000 && /Gatorade/.test(c.note)));
  assert.ok(p.fastHours > 12 && p.fastHours < 13);
});

test("training before iftar puts Adonis and Gatorade at iftar", () => {
  const p = R.plan("2027-02-10", { dayType: "training", train: "before-iftar" });
  assert.strictEqual(p.slots[0].id, "train");
  assert.strictEqual(mins(p.times.maghrib) - mins(p.slots[0].time), 75);
  const iftar = p.slots.find((s) => s.id === "iftar");
  assert.ok(iftar.items.some((i) => /Adonis/.test(i)));
  assert.ok(iftar.items.some((i) => /Gatorade/.test(i)));
  assert.strictEqual(p.water.checkpoints.reduce((a, c) => a + c.ml, 0), 3500);
});

test("rest day and Friday: no training, 3 L water", () => {
  for (const dayType of ["rest", "friday"]) {
    const p = R.plan("2027-02-12", { dayType });
    assert.ok(!p.slots.some((s) => s.id === "train"));
    assert.strictEqual(p.water.checkpoints.reduce((a, c) => a + c.ml, 0), 3000);
    assert.ok(!p.water.checkpoints.some((c) => /Gatorade/.test(c.note)));
  }
  assert.ok(R.plan("2027-02-12", { dayType: "friday" }).notes.some((n) => /Friday/.test(n)));
});

test("html is empty outside Ramadan and a card inside", () => {
  assert.strictEqual(R.html("2026-10-25"), "");
  const h = R.html("2027-02-10", { dayType: "training" });
  assert.match(h, /Ramadan · day 3/);
  assert.match(h, /Suhoor ends/);
  assert.ok(R.css.includes("--surface"));
});
