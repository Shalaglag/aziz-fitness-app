// node --test modules/exercise-3d/exercise-3d.test.mjs
import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs'; import { createRequire } from 'node:module';
const require = createRequire(import.meta.url); const R = new URL('../../', import.meta.url).pathname;
globalThis.window = globalThis;
require(R + 'modules/workout-logger/workout-logger.js'); require(R + 'modules/exercise-anim/exercise-anim.js');
const X = require(R + 'modules/exercise-3d/exercise-3d.js');
const DATA = JSON.parse(fs.readFileSync(R + 'modules/exercise-3d/exercises.json', 'utf8'));
const META = JSON.parse(fs.readFileSync(R + 'app/3d/body_meta.json', 'utf8'));
const ids = Object.keys(DATA.exercises);

test('every 3D exercise exists in the motions, stays preview, and names only known muscles', () => {
  assert.ok(ids.length >= 3);
  for (const id of ids) {
    const e = DATA.exercises[id];
    assert.ok(window.ExerciseAnim.defs[id], id + ' has a motion');
    assert.equal(e.status, 'preview', id + ' is not reviewed yet');
    for (const m of [...(e.primary || []), ...(e.secondary || [])]) assert.ok(META.muscles.includes(m.replace(/@[LR]$/, '')), id + ': unknown muscle ' + m);
    assert.ok(['overhand', 'underhand', 'neutral'].includes(e.gripType), id + ' grip type');
  }
});

test('body meta matches the 200k body and its skeleton', () => {
  assert.ok(META.tris_body >= 190000, 'about 200k triangles');
  for (const b of ['root', 'spine02', 'wrist.L', 'finger3-3.R', 'foot.L']) assert.ok(META.bones.includes(b), b);
  assert.ok(fs.statSync(R + 'app/3d/body.glb').size < 6.5e6, 'body.glb stays compact');
});

test('engine poses each exercise with the hands on the handle and the fingers closed', async () => {
  const THREE = await import(R + 'app/vendor/three-r160/three.module.min.js');
  const { GLTFLoader } = await import(R + 'app/vendor/three-r160/GLTFLoader.js');
  const buf = fs.readFileSync(R + 'app/3d/body.glb');
  const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length), '');
  const e = X.core(THREE, gltf, META, { data: DATA });
  for (const id of ids) {
    assert.ok(e.setExercise(id), id);
    for (const t of [0, 0.25, 0.5, 0.75]) {
      e.pose(t);
      const c = e.contacts();
      const grips = Object.keys(c).filter(k => /grip/.test(k));
      assert.ok(grips.length >= 1, id + ' holds a handle');
      for (const k of grips) assert.ok(c[k].pos.every(Number.isFinite), id + ' ' + k);
    }
  }
  const g = e.solveGrip('L', 0.016 / e.K);
  const curl = g.F.f.map(a => (a[0] + a[1] + a[2]) * 180 / Math.PI);
  assert.ok(curl.every(d => d > 90), 'fingers wrap the handle: ' + curl.map(Math.round));
  assert.ok(g.thumbGapMm < 12, 'thumb closes on the handle: ' + g.thumbGapMm.toFixed(1) + ' mm');
});

test('both hands on one spot (goblet squat, landmine) keep the equipment in place', async () => {
  const THREE = await import(R + 'app/vendor/three-r160/three.module.min.js');
  const { GLTFLoader } = await import(R + 'app/vendor/three-r160/GLTFLoader.js');
  const buf = fs.readFileSync(R + 'app/3d/body.glb');
  const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length), '');
  const e = X.core(THREE, gltf, META, { data: { exercises: {} } });
  for (const id of ['goblet-squat-dumbbell', 'landmine-press']) {
    const cur = e.setExercise(id);
    assert.ok(Number.isFinite(cur.radius) && Number.isFinite(cur.center.x), id + ' framing');
    for (const sh of cur.shapes) for (const k of ['a', 'b', 'c']) if (sh[k]) assert.ok(sh[k].every(Number.isFinite), id + ' equipment point ' + k);
  }
});
