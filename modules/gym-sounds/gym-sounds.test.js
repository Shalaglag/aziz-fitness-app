// Run: node --test modules/gym-sounds/gym-sounds.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
const G = require("./gym-sounds.js");

test("every sound renders, peaks under clipping, ends in silence", () => {
  assert.deepEqual(G.NAMES, ["restDone", "finish", "boxing", "dingdong", "beeps", "whistle", "gong", "doubleDing", "tap", "blip", "ping", "knock", "powerup", "blast", "aura", "scouter", "teleport", "impact"]);
  for (const name of G.NAMES) {
    const x = G.render(name, 22050);
    let peak = 0; for (const v of x) peak = Math.max(peak, Math.abs(v));
    assert.ok(peak > 0.8 && peak <= 0.86, name + " peak " + peak);
    assert.ok(Math.abs(x[x.length - 1]) < 1e-3, name + " fades out");
    assert.ok(x.length / 22050 <= 2.4, name + " is short");
  }
  assert.throws(() => G.render("nope"));
});

test("rest over is three dings: two quick, then a higher one", () => {
  const sr = 22050, x = G.render("restDone", sr);
  const loud = t => { let m = 0; for (let i = Math.round(t * sr); i < Math.round((t + 0.03) * sr); i++) m = Math.max(m, Math.abs(x[i])); return m; };
  assert.ok(loud(0.17) > loud(0.12) * 2, "second ding starts at 0.17 s");
  assert.ok(loud(0.34) > loud(0.29) * 2, "third ding starts at 0.34 s");
});

test("wav header and the Android copy match the in-app sound", () => {
  const b = G.wav("restDone", 22050), v = new DataView(b.buffer);
  assert.equal(String.fromCharCode(...b.slice(0, 4)), "RIFF");
  assert.equal(String.fromCharCode(...b.slice(8, 12)), "WAVE");
  assert.equal(v.getUint32(24, true), 22050);
  assert.equal(v.getUint16(34, true), 16);
  assert.equal(v.getUint32(40, true), b.length - 44);
  for (const { id } of G.REST_SOUNDS) {
    const raw = path.join(__dirname, "../../android/app/src/main/res/raw", G.rawName(id));
    assert.ok(Buffer.from(G.wav(id, 22050)).equals(fs.readFileSync(raw)), id + ": run node modules/gym-sounds/make-wav.js");
  }
});

test("rest sound choices: Aziz's double ding first, every id renders, Android-safe file names", () => {
  assert.equal(G.REST_SOUNDS[0].id, "doubleDing");
  assert.equal(G.rawName("restDone"), "rest_done.wav");
  for (const { id, label } of G.REST_SOUNDS) {
    assert.ok(G.NAMES.includes(id) && label, id);
    assert.match(G.rawName(id), /^[a-z0-9_]+\.wav$/);
  }
});

test("play without Web Audio returns false instead of throwing", () => {
  assert.equal(G.play("restDone"), false);
  assert.equal(G.prime(), false);
});

test("anime-style pack is labelled and the power-up rises in pitch", () => {
  const anime = G.REST_SOUNDS.filter(s => s.pack === "anime").map(s => s.id);
  assert.deepEqual(anime, ["powerup", "blast", "aura", "scouter", "teleport", "impact"]);
  const sr = 22050, x = G.render("powerup", sr);
  const crossings = (a, b) => { let c = 0; for (let i = Math.round(a * sr) + 1; i < Math.round(b * sr); i++) if ((x[i - 1] < 0) !== (x[i] < 0)) c++; return c; };
  assert.ok(crossings(1.0, 1.2) > crossings(0.1, 0.3) * 2, "pitch climbs during the charge");
});

test("custom sound: no file or no storage rejects; play without one is false", async () => {
  await assert.rejects(G.setCustom(null));
  assert.equal(G.customInfo(), null);
  assert.equal(G.play("custom"), false);
  await assert.rejects(G.setCustom({ size: 4 * 1024 * 1024, name: "big.mp3" }), /3 MB/);
});

test("double ding: two strikes 0.19 s apart", () => {
  const sr = 22050, x = G.render("doubleDing", sr);
  const loud = t => { let m = 0; for (let i = Math.round(t * sr); i < Math.round((t + 0.02) * sr); i++) m = Math.max(m, Math.abs(x[i])); return m; };
  assert.ok(loud(0.19) > loud(0.165) * 1.3, "second strike at 0.19 s");
});

test("set sounds: Check (Aziz's recording) is first, the rest are short synths", () => {
  assert.equal(G.SET_SOUNDS[0].id, "check");
  assert.deepEqual(G.CLIPS, ["check"]);
  for (const { id, label } of G.SET_SOUNDS.slice(1)) {
    assert.ok(G.NAMES.includes(id) && label, id);
    assert.ok(G.render(id, 22050).length / 22050 <= 1.0, id + " is a short tick");
  }
});

test("check clip: clips.js is the current check.mp3 and is a small MP3", () => {
  const C = require("./clips.js"), mp3 = fs.readFileSync(path.join(__dirname, "check.mp3"));
  assert.equal(C.check, mp3.toString("base64"), "run node modules/gym-sounds/make-clips.js");
  assert.equal(fs.readFileSync(path.join(__dirname, "clips.js"), "utf8"), require("./make-clips.js").source());
  assert.ok(mp3.length < 20000, "under 20 KB");
  assert.ok(mp3.slice(0, 3).toString() === "ID3" || (mp3[0] === 0xff && (mp3[1] & 0xe0) === 0xe0), "MP3 header");
});

test("check clip plays through Web Audio once decoded (fake AudioContext)", async () => {
  const started = [];
  globalThis.AudioContext = class {
    constructor() { this.state = "running"; this.destination = {}; this.sampleRate = 44100; }
    decodeAudioData(bytes, ok) { assert.ok(bytes.byteLength > 1000); setTimeout(() => ok({ duration: 0.9 }), 0); }
    createBufferSource() { return { connect() {}, start() { started.push(this.buffer); } }; }
  };
  try {
    assert.equal(G.play("check"), true, "first tap: decodes, then plays");
    await new Promise(r => setTimeout(r, 10));
    assert.equal(started.length, 1);
    assert.equal(G.play("check"), true);
    assert.equal(started.length, 2, "second tap plays straight away");
  } finally { delete globalThis.AudioContext; }
});
