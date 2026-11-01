// Run: node --test modules/gym-sounds/gym-sounds.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
const G = require("./gym-sounds.js");

test("both sounds render, peak under clipping, end in silence", () => {
  assert.deepEqual(G.NAMES, ["restDone", "finish"]);
  for (const name of G.NAMES) {
    const x = G.render(name, 22050);
    let peak = 0; for (const v of x) peak = Math.max(peak, Math.abs(v));
    assert.ok(peak > 0.8 && peak <= 0.86, name + " peak " + peak);
    assert.ok(Math.abs(x[x.length - 1]) < 1e-3, name + " fades out");
    assert.ok(x.length / 22050 < 2, name + " is short");
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
  const raw = path.join(__dirname, "../../android/app/src/main/res/raw/rest_done.wav");
  assert.ok(Buffer.from(b).equals(fs.readFileSync(raw)), "run node modules/gym-sounds/make-wav.js");
});

test("play without Web Audio returns false instead of throwing", () => {
  assert.equal(G.play("restDone"), false);
  assert.equal(G.prime(), false);
});
