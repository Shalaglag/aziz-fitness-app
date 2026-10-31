// node --test modules/calendar-reminders/calendar-reminders.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const CR = require("./calendar-reminders.js");

const CTX = { from: "2026-10-26", review: "2026-11-07", now: "2026-10-26T05:00:00Z",
  supps: [{ key: "creatine", name: "Creatine", dose: "5 g", time: "14:00", with: "with Meal 1", on: true }, { key: "mag", name: "Magnesium", time: "22:30", on: false }] };

test("defaults give weigh-in, two training series, four water checks, the review and the supplements that are on", () => {
  const evs = CR.events(CR.settings({}), CTX);
  const ids = evs.map(e => e.uid);
  assert.deepEqual(ids, ["cr-weigh", "cr-train", "cr-train-sat", "cr-water-1100", "cr-water-1300", "cr-water-1700", "cr-water-1900", "cr-review-20261107", "cr-supp-creatine"]);
  const w = evs[0]; assert.equal(w.time, "07:00"); assert.equal(w.rrule, "FREQ=DAILY"); assert.equal(w.start, "2026-10-26");
  const t = evs[1]; assert.equal(t.time, "15:30"); assert.equal(t.rrule, "FREQ=WEEKLY;BYDAY=SU,MO,TU,WE,TH"); assert.deepEqual(t.alarms, [30, 0]);
  const s = evs[2]; assert.equal(s.time, "10:00"); assert.equal(s.start, "2026-10-31", "first Saturday on/after Oct 26 2026");
  const r = evs[7]; assert.equal(r.start, "2026-11-07"); assert.equal(r.rrule, undefined); assert.deepEqual(r.alarms, [1440, 0]);
  assert.equal(evs[8].summary, "Creatine 5 g");
});

test("DTSTART of a weekly rule lands on a listed weekday", () => {
  // Oct 30 2026 is a Friday: Sun-Thu series must start Sunday Nov 1, Saturday series on Oct 31
  const evs = CR.events(CR.settings({}), { from: "2026-10-30" });
  assert.equal(evs.find(e => e.uid === "cr-train").start, "2026-11-01");
  assert.equal(evs.find(e => e.uid === "cr-train-sat").start, "2026-10-31");
  assert.equal(CR._firstOn("2026-10-26", ["MO"]), "2026-10-26", "Oct 26 2026 is a Monday");
});

test("switches and saved times are honoured; bad values fall back to defaults", () => {
  const s = CR.settings({ reminders: { weigh: false, water: false, supps: false, trainTime: "16:00", satOn: false, reviewTime: "25:99", waterTimes: ["x", "08:00"] } });
  assert.equal(s.trainTime, "16:00"); assert.equal(s.reviewTime, "09:00"); assert.deepEqual(s.waterTimes, ["08:00"]);
  const evs = CR.events(s, CTX);
  assert.deepEqual(evs.map(e => e.uid), ["cr-train", "cr-review-20261107"]);
  assert.equal(evs[0].time, "16:00");
});

test("a review already in the past, or missing, produces no review event", () => {
  const s = CR.settings({});
  assert.equal(CR.events(s, { from: "2026-11-08", review: "2026-11-07" }).some(e => /review/.test(e.uid)), false);
  assert.equal(CR.events(s, { from: "2026-11-01" }).some(e => /review/.test(e.uid)), false);
  assert.equal(CR.events(s, { from: "2026-11-07", review: "2026-11-07" }).some(e => /review/.test(e.uid)), true, "review day itself still counts");
});

test("ics output is a valid, CRLF, folded calendar in Kuwait time", () => {
  const b = CR.build({}, CTX);
  assert.equal(b.filename, "cut-reminders-2026-10-26.ics");
  assert.equal(b.count, 9);
  const t = b.text;
  assert.ok(t.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"));
  assert.ok(t.endsWith("END:VCALENDAR\r\n"));
  assert.equal((t.match(/BEGIN:VEVENT/g) || []).length, 9);
  assert.equal((t.match(/BEGIN:VEVENT/g) || []).length, (t.match(/END:VEVENT/g) || []).length);
  assert.ok(t.includes("BEGIN:VTIMEZONE\r\nTZID:Asia/Kuwait\r\n"));
  assert.ok(t.includes("TZOFFSETTO:+0300"));
  assert.ok(t.includes("DTSTART;TZID=Asia/Kuwait:20261026T070000"));
  assert.ok(t.includes("DTSTAMP:20261026T050000Z"));
  assert.ok(t.includes("UID:cr-weigh-20261026@aziz-cut-tracker"));
  assert.ok(t.includes("RRULE:FREQ=WEEKLY;BYDAY=SU,MO,TU,WE,TH"));
  assert.ok(t.includes("TRIGGER:-PT1440M"), "review alarm the day before");
  assert.ok(t.includes("TRIGGER:PT0M"));
  // no raw line longer than 75 octets, and every continuation starts with a space
  for (const line of t.split("\r\n")) assert.ok(Buffer.byteLength(line, "utf8") <= 75, "line too long: " + line);
  assert.ok(!/\n(?! |BEGIN|END|[A-Z-]+[:;])/.test(t.replace(/\r/g, "").trimEnd()), "unfolded continuation");
  assert.ok(!t.includes("\n\n"));
});

test("text escaping: commas, semicolons and newlines in a summary are escaped", () => {
  const t = CR.ics([{ uid: "x", summary: "A, B; C", description: "line1\nline2", start: "2026-10-26", time: "08:00", minutes: 5 }], { stamp: "2026-10-26T00:00:00Z" });
  assert.ok(t.includes("SUMMARY:A\\, B\; C"));
  assert.ok(t.includes("DESCRIPTION:line1\\nline2"));
  assert.ok(t.includes("DURATION:PT5M"));
  assert.ok(!t.includes("RRULE"));
});

test("same day and settings give an identical file (stable ids so a re-import replaces)", () => {
  assert.equal(CR.build({}, CTX).text, CR.build({}, CTX).text);
  const a = CR.build({}, CTX).text, b = CR.build({ reminders: { trainTime: "16:00" } }, CTX).text;
  assert.notEqual(a, b);
  assert.deepEqual(a.match(/UID:[^\r]+/g), b.match(/UID:[^\r]+/g));
});

test("apply: save, water add/less and download", () => {
  let r = CR.apply("save", { weigh: true, train: false, weighTime: "06:30", waterTimes: ["12:00", "09:00"] }, {}, CTX);
  assert.equal(r.prefs.reminders.weighTime, "06:30"); assert.equal(r.prefs.reminders.train, false); assert.deepEqual(r.prefs.reminders.waterTimes, ["09:00", "12:00"]);
  assert.match(r.toast, /saved/i);
  r = CR.apply("water-add", {}, r.prefs, CTX);
  assert.deepEqual(r.prefs.reminders.waterTimes, ["09:00", "12:00", "14:00"]);
  r = CR.apply("water-less", {}, r.prefs, CTX);
  assert.deepEqual(r.prefs.reminders.waterTimes, ["09:00", "12:00"]);
  r = CR.apply("download", {}, r.prefs, CTX);
  assert.equal(r.download.filename, "cut-reminders-2026-10-26.ics");
  assert.ok(r.download.text.includes("DTSTART;TZID=Asia/Kuwait:20261026T063000"));
  assert.ok(!r.download.text.includes("cr-train-"), "training switched off");
  r = CR.apply("download", { weigh: false, train: false, water: false, review: false, supps: false }, {}, CTX);
  assert.equal(r.download, undefined); assert.match(r.toast, /turn on/i);
});

test("html renders the card with current values and the download count", () => {
  const h = CR.html({ reminders: { trainTime: "16:00" } }, CTX);
  assert.ok(h.includes('data-cr-form'));
  assert.ok(h.includes('name="trainTime" value="16:00"'));
  assert.ok(h.includes("Download 9 reminders (.ics)"));
  assert.ok(h.includes("Sun–Thu at 4 pm, Saturday at 10 am"));
  assert.ok(h.includes('data-cr="download"'));
  assert.ok(CR.css.includes(".cr-card"));
});

test("readForm collects switches, times and the water list from a DOM-like root", () => {
  const inputs = [
    { name: "weigh", type: "checkbox", checked: false }, { name: "weighTime", type: "time", value: "06:45" },
    { name: "water0", type: "time", value: "10:00" }, { name: "water1", type: "time", value: "" }, { name: "water2", type: "time", value: "18:00" },
  ];
  const root = { querySelector: sel => sel === "[data-cr-form]" ? { querySelectorAll: () => inputs } : null };
  const v = CR.readForm(root);
  assert.equal(v.weigh, false); assert.equal(v.weighTime, "06:45"); assert.deepEqual(v.waterTimes, ["10:00", "18:00"]);
  assert.deepEqual(CR.readForm({ querySelector: () => null }), {});
});

test("training and review reminders name the calorie target from ctx", () => {
  const all = CR.settings({ train: true, review: true });
  const txt = ev => CR.events(all, ev).map(e => e.description).join(" ");
  assert.match(txt(CTX), /inside the 2,000/);
  const t2 = txt({ ...CTX, kcal: 2150 });
  assert.match(t2, /inside the 2,150\)/);
  assert.match(t2, /whether 2,150 kcal stays/);
});
