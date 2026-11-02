// node --test modules/voice-log/voice-log.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const VoiceLog = require("./voice-log.js");
require("../workout-logger/workout-logger.js");
const LIB = Object.values(globalThis.WorkoutLogger.library);
const parse = (t, o = {}) => VoiceLog.parse(t, Object.assign({ exercises: LIB, unit: "kg" }, o));
const one = (t, o) => { const r = parse(t, o); assert.equal(r.length, 1, "one entry for " + JSON.stringify(t)); return r[0]; };

test("number words become digits, including tens+ones, hundreds and halves", () => {
  assert.equal(VoiceLog.words("sixty for ten ten eight"), "60 for 10 10 8");
  assert.equal(VoiceLog.words("one hundred and twenty kilos"), "120 kilos");
  assert.equal(VoiceLog.words("twenty five point five"), "25.5");
  assert.equal(VoiceLog.words("two and a half"), "2.5");
  assert.equal(VoiceLog.words("eight, seven, six"), "8, 7, 6");
  assert.equal(VoiceLog.words("Bench 60 for 10"), "bench 60 for 10");
});

test("weight 'for' reps list: bench 60 for 10, 10, 8", () => {
  const e = one("bench 60 for 10, 10, 8");
  assert.equal(e.exercise.name, "Bench Press (Barbell)");
  assert.equal(e.weight, 60); assert.equal(e.unit, "kg");
  assert.deepEqual(e.reps, [10, 10, 8]);
  assert.deepEqual(VoiceLog.toSets(e, e.exercise).map(s => [s.w, s.r, s.done]), [["60", "10", true], ["60", "10", true], ["60", "8", true]]);
});

test("explicit units, reps and set counts", () => {
  let e = one("incline dumbbell press 30 kilos 12 reps 3 sets");
  assert.equal(e.exercise.name, "Incline Bench Press (Dumbbell)"); assert.equal(e.weight, 30); assert.deepEqual(e.reps, [12, 12, 12]);
  e = one("hack squat 100 kg 3 sets of 8");
  assert.equal(e.exercise.name, "Hack Squat (Machine)"); assert.deepEqual(e.reps, [8, 8, 8]);
  e = one("bench 135 pounds for 5");
  assert.equal(e.unit, "lb"); assert.equal(e.weight, 135); assert.deepEqual(e.reps, [5]);
  e = one("leg extension at 70 for 12");
  assert.equal(e.weight, 70); assert.deepEqual(e.reps, [12]);
  e = one("lat pulldown 55 by 10 10 8");
  assert.equal(e.weight, 55); assert.deepEqual(e.reps, [10, 10, 8]);
});

test("spoken numbers work end to end", () => {
  const e = one("seated row sixty kilos for twelve twelve ten");
  assert.equal(e.exercise.name, "Seated Row (Cable)"); assert.equal(e.weight, 60); assert.deepEqual(e.reps, [12, 12, 10]);
});

test("bodyweight exercises take every number as reps", () => {
  const e = one("pull ups 8 7 6");
  assert.equal(e.exercise.name, "Pull Up"); assert.equal(e.weight, null); assert.deepEqual(e.reps, [8, 7, 6]);
  assert.deepEqual(VoiceLog.toSets(e, e.exercise).map(s => s.r), ["8", "7", "6"]);
});

test("cardio and duration exercises fill km/min or sec", () => {
  let e = one("treadmill 30 minutes 2 km");
  assert.equal(e.exercise.cat, "Cardio"); assert.equal(e.min, 30); assert.equal(e.km, 2);
  assert.deepEqual(VoiceLog.toSets(e, e.exercise).map(s => [s.km, s.min]), [["2", "30"]]);
  e = one("plank 1 minute");
  assert.equal(e.exercise.name, "Plank"); assert.deepEqual(VoiceLog.toSets(e, e.exercise).map(s => s.sec), ["60"]);
  e = one("plank 45 seconds");
  assert.deepEqual(VoiceLog.toSets(e, e.exercise).map(s => s.sec), ["45"]);
});

test("'then' / 'and' split into several exercises", () => {
  const r = parse("bench 60 for 10 10 8 and lat pulldown 55 for 12 12 then hack squat 90 for 10");
  assert.deepEqual(r.map(e => e.exercise.name), ["Bench Press (Barbell)", "Lat Pulldown (Machine)", "Hack Squat (Machine)"]);
  assert.deepEqual(r.map(e => e.reps), [[10, 10, 8], [12, 12], [10]]);
});

test("no exercise named: falls back to the current one, otherwise asks", () => {
  let e = one("60 for 10 10 8", { current: "bench-press-barbell" });
  assert.equal(e.exercise.id, "bench-press-barbell"); assert.equal(e.weight, 60);
  e = one("60 for 10 10 8");
  assert.equal(e.exercise, null); assert.deepEqual(e.reps, [10, 10, 8]);
  assert.deepEqual(VoiceLog.toSets(e, null).map(s => s.r), ["10", "10", "8"]);
});

test("exercises already in the workout win ties and nicknames resolve", () => {
  assert.equal(one("bench 60 for 10", { prefer: ["bench-press-dumbbell"] }).exercise.id, "bench-press-dumbbell");
  assert.equal(one("bench 60 for 10", { prefer: ["bench-press-barbell"] }).sure, true);
  assert.equal(one("lat pulldown 50 for 10", { prefer: ["lat-pulldown-wide-grip-cable"] }).exercise.id, "lat-pulldown-wide-grip-cable");
  assert.equal(one("treadmill 30 minutes", { prefer: ["treadmill-incline-walk"] }).exercise.id, "treadmill-incline-walk");
  assert.equal(one("side delts 10 kilos 15 15 12").exercise.name.startsWith("Lateral Raise"), true);
  assert.equal(one("rope pushdown 25 for 15, 15").exercise.name, "Triceps Rope Pushdown (Cable)");
  assert.equal(one("gundam 50 for 10").exercise.name, "Gundam Chest Press (Machine)");
  assert.equal(one("smith squat 60 for 10").exercise.name, "Squat (Smith Machine)");
  assert.equal(one("single arm pulldown 25 for 12").exercise.name, "Lat Pulldown - Single Arm (Cable)");
  assert.equal(one("rdl 80 for 8 8").exercise.name, "Romanian Deadlift (Barbell)");
});

test("unsure matches are flagged and carry candidates to pick from", () => {
  const e = one("bench 60 for 10");
  assert.equal(e.sure, false);
  assert.ok(e.candidates.length >= 2);
  assert.ok(e.candidates.every(c => /Bench/.test(c.name)));
});

test("junk does not crash and yields nothing to log", () => {
  assert.deepEqual(parse(""), []);
  assert.deepEqual(parse("hello there"), []);
  assert.equal(parse("bench").length, 1);
  assert.deepEqual(VoiceLog.toSets(parse("bench")[0], parse("bench")[0].exercise), []);
});

test("error texts tell Aziz to use the keyboard mic when the browser can't listen", () => {
  assert.match(VoiceLog.errorText("not-allowed"), /keyboard/);
  assert.match(VoiceLog.errorText("unsupported"), /keyboard/);
  assert.match(VoiceLog.errorText("no-speech"), /again/);
});

test("the food card and sheet HTML render without a DOM", () => {
  assert.match(VoiceLog.foodCardHtml(), /data-vlf="mic"/);
  assert.equal(VoiceLog.speech.supported(), false);
  assert.ok(VoiceLog.css.includes(".vl-mic"));
});

test("inside the Android app the native Speech plugin listens, streams partial text and maps errors", async () => {
  const fs = require("fs"), path = require("path"), root = path.join(__dirname, "..", "..");
  const listeners = {}; let removed = 0, starts = [], stops = 0, finish;
  const Speech = {
    addListener: (ev, fn) => { listeners[ev] = fn; return Promise.resolve({ remove() { removed++; } }); },
    start: o => { starts.push(o); return new Promise((res, rej) => { finish = { res, rej }; }); },
    stop: () => { stops++; return Promise.resolve(); }
  };
  global.window = { Capacitor: { isNativePlatform: () => true, Plugins: { Speech } } };
  try {
    assert.equal(VoiceLog.speech.supported(), true);
    assert.equal(VoiceLog.speech.native(), true);
    const seen = []; let ended = 0;
    const ctl = VoiceLog.speech.start({ onText: (t, f) => seen.push([t, f]), onEnd: () => ended++ });
    await new Promise(r => setTimeout(r, 0));
    assert.deepEqual(starts, [{ lang: "en-US" }]);
    listeners.partial({ text: "bench 60" });
    ctl.stop(); assert.equal(stops, 1);
    finish.res({ text: "bench 60 for 10 10 8" });
    await new Promise(r => setTimeout(r, 0));
    assert.deepEqual(seen, [["bench 60", false], ["bench 60 for 10 10 8", true]]);
    assert.equal(ended, 1); assert.equal(removed, 1);

    let code = null;
    VoiceLog.speech.start({ onError: c => { code = c; } });
    await new Promise(r => setTimeout(r, 0));
    finish.rej({ code: "not-allowed" });
    await new Promise(r => setTimeout(r, 0));
    assert.equal(code, "not-allowed");
    assert.match(VoiceLog.errorText("not-allowed"), /Settings/);
  } finally { delete global.window; }

  const src = fs.readFileSync(path.join(__dirname, "android/SpeechPlugin.kt"), "utf8");
  const built = fs.readFileSync(path.join(root, "android/app/src/main/java/com/azizfitness/app/SpeechPlugin.kt"), "utf8");
  assert.equal(built, src, "copy modules/voice-log/android/SpeechPlugin.kt into android/app/src/main/java/com/azizfitness/app/");
  assert.match(fs.readFileSync(path.join(root, "android/app/src/main/java/com/azizfitness/app/MainActivity.java"), "utf8"), /registerPlugin\(SpeechPlugin\.class\)/);
  const manifest = fs.readFileSync(path.join(root, "android/app/src/main/AndroidManifest.xml"), "utf8");
  assert.match(manifest, /android\.permission\.RECORD_AUDIO/);
  assert.match(manifest, /android\.speech\.RecognitionService/);
});
