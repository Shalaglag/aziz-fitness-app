// Run: node --test modules/run-tracker/run-tracker.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { Cardio } = require("../cardio/cardio.js");
global.Cardio = Cardio;
const { RunTracker: T } = require("./run-tracker.js");

// A straight line north from Kuwait City: 1 m of latitude = 1/111195 degrees on a 6371 km sphere. 3 m/s = 10.8 km/h.
const START = [29.3759, 47.9774];
const north = (m) => [START[0] + m / 111195, START[1]];
function track(metres, mps, { every = 5, ele } = {}) {
  const pts = [];
  for (let t = 0; t * mps <= metres; t += every) pts.push([...north(t * mps), ele ? ele(t) : null, t]);
  return pts;
}

test("haversine: 1 km north is 1000 m within a metre", () => {
  assert.ok(Math.abs(T.haversine(START, north(1000)) - 1000) < 1);
});

test("accept: drops inaccurate fixes, teleports and standing jitter", () => {
  const prev = [...START, null, 0];
  assert.equal(T.accept(null, prev, 10), true);
  assert.equal(T.accept(null, prev, 80), false, "accuracy worse than 35 m");
  assert.equal(T.accept(prev, [...north(1), null, 5], 10), false, "1 m is jitter");
  assert.equal(T.accept(prev, [...north(500), null, 5], 10), false, "100 m/s is a GPS jump");
  assert.equal(T.accept(prev, [...north(15), null, 5], 10), true);
});

test("stats: distance, moving time, pace, km splits, climb; pauses over a minute don't count as time", () => {
  const pts = track(2500, 3, { ele: t => 10 + t / 100 });
  const s = T.stats(pts);
  assert.ok(Math.abs(s.km - 2.5) < 0.01, "km " + s.km);
  assert.equal(s.sec, 830);                       // 2490 m at 3 m/s, 5 s steps
  assert.ok(Math.abs(s.paceSec - 334) <= 1, "pace " + s.paceSec);
  assert.equal(s.splits.length, 2);
  assert.ok(Math.abs(s.splits[0].sec - 333) <= 1 && Math.abs(s.splits[1].sec - 333) <= 1, JSON.stringify(s.splits));
  assert.equal(s.gain, 8);
  assert.equal(s.maxKmh, 10.8);
  // a 10 minute stop in the middle: same distance, same moving time
  const paused = pts.map(p => p[3] > 400 ? [p[0], p[1], p[2], p[3] + 600] : p);
  const ps = T.stats(paused);
  assert.ok(Math.abs(ps.km - s.km) < 0.001);
  assert.equal(ps.sec, s.sec - 5);                // the one 605 s step is dropped
  assert.equal(T.stats([]).paceSec, null);
});

test("thin keeps the ends; svg draws a path with start and finish; mapsLink is a walking route", () => {
  const pts = track(3010, 3, { every: 1 });
  const th = T.thin(pts, 100);
  assert.equal(th.length, 100);
  assert.deepEqual([th[0], th[99]], [pts[0], pts[pts.length - 1]]);
  const svg = T.svg(pts, { splits: T.stats(pts).splits });
  assert.match(svg, /<path d="M/);
  assert.ok(svg.includes("<title>Start</title>") && svg.includes("<title>Finish</title>"));
  assert.equal((svg.match(/<text/g) || []).length, 3, "three km markers");
  assert.match(T.svg([]), /No route yet/);
  const link = T.mapsLink(pts);
  assert.ok(link.startsWith("https://www.google.com/maps/dir/?api=1&travelmode=walking&origin=29.37590,47.97740&destination=29.4029"), link);
  assert.equal(link.split("waypoints=")[1].split("|").length, 9);
  assert.match(T.mapsLink([pts[0]]), /maps\/search/);
  assert.equal(T.mapsLink([]), null);
});

test("gpx: export round-trips through parseGPX, and real-world GPX with time/ele parses", () => {
  const run = T.makeRun(track(1200, 3, { ele: () => 12.5 }), Date.parse("2026-11-20T06:30:00Z"));
  assert.equal(run.date, "2026-11-20");
  const xml = T.gpx(run);
  assert.match(xml, /<gpx version="1.1"/);
  const back = T.parseGPX(xml);
  assert.equal(back.pts.length, run.pts.length);
  assert.equal(back.startAt, "2026-11-20T06:30:00.000Z");
  assert.deepEqual(back.pts[3], run.pts[3]);
  const strava = `<gpx><trk><name>Morning Run</name><trkseg>
    <trkpt lat="29.3759" lon="47.9774"><ele>5.0</ele><time>2026-11-21T04:00:00Z</time></trkpt>
    <trkpt lat="29.3800" lon="47.9774"><ele>6.0</ele><time>2026-11-21T04:02:30Z</time></trkpt>
    <trkpt lat="29.3850" lon="47.9780"/></trkseg></trk></gpx>`;
  const g = T.parseGPX(strava);
  assert.equal(g.pts.length, 3); assert.equal(g.name, "Morning Run"); assert.deepEqual(g.pts[1], [29.38, 47.9774, 6, 150]);
  assert.equal(T.parseGPX("<gpx></gpx>").pts.length, 0);
});

test("toSession: a run becomes a Cardio session of kind run with pace-derived speed and an estimate", () => {
  const run = T.makeRun(track(5000, 3), Date.parse("2026-11-20T06:30:00Z"));
  const s = T.toSession(run, { weightKg: 90 });
  assert.equal(s.kind, "run"); assert.equal(s.min, 28); assert.equal(s.km, 5);
  assert.ok(Math.abs(s.speed - 10.7) < 0.2, "speed " + s.speed);
  assert.equal(s.incline, null); assert.equal(s.kcalSrc, "est"); assert.ok(s.kcal > 300 && s.kcal < 600, s.kcal);
  assert.equal(s.runId, run.id); assert.equal(s.id, "run-" + run.id); assert.equal(s.source, "gps");
});

test("live run: start → positions → finish writes runs/{date} and cardio/{date}; discard writes nothing", () => {
  T._reset();
  let watcher = null;
  const geo = { watchPosition: (ok, err) => { watcher = ok; return 7; }, clearWatch: id => { assert.equal(id, 7); watcher = null; } };
  const writes = [], docs = { runs: {}, cardio: {}, days: {} };
  const ctx = { docs, geo, noTimer: true, put: (c, id, doc) => { writes.push(c); docs[c][id] = doc; }, toast: () => {}, now: () => Date.parse("2026-11-20T06:30:00Z") };
  const btn = act => ({ closest: () => ({ dataset: { run: act } }) });
  assert.equal(T.handle(btn("start"), ctx), true);
  assert.ok(T.live().startAt && watcher);
  const t0 = ctx.now();
  for (let t = 0; t <= 1100; t += 5) watcher({ coords: { latitude: north(t * 3)[0], longitude: START[1], accuracy: t === 50 ? 90 : 8, altitude: null }, timestamp: t0 + t * 1000 });
  assert.equal(T.live().pts.length, 220, "one bad fix skipped");
  assert.ok(T.cardHTML("2026-11-20", docs).includes('data-run="finish"'));
  T.handle(btn("finish"), ctx);
  assert.deepEqual(writes, ["runs", "cardio"]);
  assert.equal(watcher, null, "watch cleared");
  const run = docs.runs["2026-11-20"].runs[0];
  assert.ok(Math.abs(run.km - 3.3) < 0.01, run.km);
  assert.equal(run.splits.length, 3);
  assert.equal(docs.cardio["2026-11-20"].sessions[0].kind, "run");
  assert.deepEqual(T.live(), {});
  // card shows the saved run with GPX and Google Maps
  const html = T.cardHTML("2026-11-20", docs);
  assert.ok(html.includes("3.30 km") && html.includes('data-run="gpx"') && html.includes("google.com/maps/dir"), html.slice(0, 300));
  // discard
  T.handle(btn("start"), ctx); watcher({ coords: { latitude: START[0], longitude: START[1], accuracy: 5 }, timestamp: t0 });
  T.handle(btn("discard"), ctx);
  assert.equal(writes.length, 2); assert.deepEqual(T.live(), {});
  // delete removes both docs' entries
  T.handle({ closest: () => ({ dataset: { run: "del", id: run.id, date: "2026-11-20" } }) }, ctx);
  assert.equal(docs.runs["2026-11-20"].runs.length, 0);
  assert.equal(docs.cardio["2026-11-20"].sessions.length, 0);
  assert.equal(T.handle({ closest: () => null }, ctx), false);
});

test("start without GPS tells the user; a denied watch shows the blocked message", () => {
  T._reset();
  const msgs = [];
  assert.equal(T.handle({ closest: () => ({ dataset: { run: "start" } }) }, { geo: null, toast: m => msgs.push(m), put: () => {} }), true);
  assert.match(msgs[0], /No GPS/);
  const geo = { watchPosition: (ok, err) => { err({ code: 1, message: "denied" }); return 1; }, clearWatch: () => {} };
  T.start({ geo, noTimer: true });
  assert.match(T.live().err, /Location blocked/);
  assert.match(T.cardHTML("2026-11-20", {}), /Location blocked/);
  T._reset();
});

test("importGPX and progressHTML / summary", () => {
  const docs = { runs: {}, cardio: {} };
  const ctx = { docs, put: (c, id, doc) => { docs[c][id] = doc; }, toast: () => {} };
  const run = T.importGPX(T.gpx(T.makeRun(track(4000, 2.8), Date.parse("2026-11-18T05:00:00Z"))), ctx);
  assert.equal(run.source, "gpx"); assert.equal(run.date, "2026-11-18");
  assert.equal(docs.cardio["2026-11-18"].sessions[0].source, "gpx");
  const html = T.progressHTML(docs, { today: "2026-11-20" });
  assert.ok(html.includes("km this week") && html.includes("best pace"));
  assert.match(T.summary(docs, { today: "2026-11-20" }), /1 run this week, 4\.0 km, avg pace 5:5\d \/km/);
  assert.equal(T.progressHTML({}, {}), "");
  assert.equal(T.importGPX("<gpx/>", ctx), null);
});
