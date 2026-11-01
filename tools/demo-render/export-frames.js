// Exports per-frame skeleton joints and equipment shapes of the built-in demos (modules/exercise-anim)
// as JSON, so another renderer (Blender) can draw the same exact motion with a different body.
// Usage: node tools/demo-render/export-frames.js squat-barbell bicep-curl-dumbbell > out.json  (or --dir pilot-data)
global.window = global;
const fs = require('fs'), path = require('path');
require('../../modules/workout-logger/workout-logger.js');
const A = require('../../modules/exercise-anim/exercise-anim.js');
const r = v => Array.isArray(v) ? v.map(r) : (typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : (v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, r(x)])) : v));
const args = process.argv.slice(2), di = args.indexOf('--dir'), dir = di >= 0 ? args.splice(di, 2)[1] : null;
args.forEach(id => {
  const def = A.defs[id]; if (!def) throw new Error('unknown id ' + id);
  const FPS = 30, N = Math.round(def.dur * FPS), frames = [];
  for (let i = 0; i < N; i++) {
    const f = A.frame(id, i / N), sk = f.sk, keep = {};
    ['P', 'up', 'f', 'side', 'neckB', 'head', 'sh', 'el', 'wr', 'hand', 'grip', 'hip', 'kn', 'an', 'toe', 'fd'].forEach(k => keep[k] = sk[k]);
    frames.push({ sk: r(keep), props: r(def.props ? def.props(sk) : []) });
  }
  const out = { id, name: def.name, eq: def.eq, dur: def.dur, fps: FPS, hi: def.hi, sec: def.sec || [], cam: def.cam || {}, body: A.B, frames };
  const js = JSON.stringify(out);
  if (dir) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, id + '.json'), js); } else process.stdout.write(js + '\n');
});
