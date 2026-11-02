#!/usr/bin/env node
// List pictures: one 144x144 WebP still per exercise of the shared 3D body (modules/exercise-3d: the
// Studio A look on the Extreme build Aziz chose, Nov 2), written to app/clips/thumbs3d/<exercise-id>.webp.
// The motion and equipment come from modules/exercise-anim; muscles and grip from modules/exercise-3d/exercises.json
// when the exercise is listed there, else from tools/clip-thumbs/thumb-muscles.json (exercise research).
// Run after adding or changing demos: node tools/clip-thumbs/make-3d-thumbs.js [t=0.5] [id ...]   (needs Playwright's Chromium)
const fs = require('fs'), path = require('path'), http = require('http');
const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '../..'), OUT = path.join(ROOT, 'app/clips/thumbs3d');
const args = process.argv.slice(2), T = args[0] && !isNaN(+args[0]) ? +args.shift() : 0.5, only = args;
const TYPES = { '.js': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.html': 'text/html' };
const PAGE = '<!doctype html><html><body><script src="/modules/exercise-anim/exercise-anim.js"></script><script src="/modules/exercise-3d/exercise-3d.js"></script></body></html>';
(async () => {
  const listed = JSON.parse(fs.readFileSync(path.join(ROOT, 'modules/exercise-3d/exercises.json'), 'utf8')).exercises;
  const guessed = JSON.parse(fs.readFileSync(path.join(__dirname, 'thumb-muscles.json'), 'utf8')).exercises;
  const server = http.createServer((q, r) => {
    const u = decodeURIComponent(q.url.split('?')[0]);
    if (u === '/thumbs.html') { r.writeHead(200, { 'content-type': 'text/html' }); return r.end(PAGE); }
    const f = path.join(ROOT, path.normalize(u));
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
  }).listen(0);
  const port = server.address().port;
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage();
  await p.goto(`http://127.0.0.1:${port}/thumbs.html`);
  const ids = await p.evaluate(({ listed, guessed }) => {
    window.EXERCISE_3D = { base: '/app/', exercises: Object.assign({}, guessed, listed) };
    return Object.keys(window.ExerciseAnim.defs);
  }, { listed, guessed });
  await p.evaluate(() => window.Exercise3D.load());
  let n = 0;
  for (const id of ids.filter(i => !only.length || only.includes(i))) {
    const b64 = await p.evaluate(({ id, t }) => {
      const A = window.ExerciseAnim, d = A.defs[id];
      const big = document.createElement('canvas'); big.width = big.height = 432;
      const g = big.getContext('2d'); g.fillStyle = '#eceef2'; g.fillRect(0, 0, 432, 432);
      const ok = window.Exercise3D.paint(g, 432, 432, id, { t: d.still ? 0 : t, yaw: A.views['3d'](d), pitch: (d.cam && d.cam.pitch) || 0.15, zoom: 1.1 });
      if (!ok) return null;
      const small = document.createElement('canvas'); small.width = small.height = 144;
      const s = small.getContext('2d'); s.imageSmoothingQuality = 'high'; s.drawImage(big, 0, 0, 144, 144);
      return small.toDataURL('image/webp', 0.75).split(',')[1];
    }, { id, t: T });
    if (!b64) { console.warn('no picture for ' + id); continue; }
    fs.writeFileSync(path.join(OUT, id + '.webp'), Buffer.from(b64, 'base64')); n++;
  }
  console.log('3D body thumbs: ' + n);
  await b.close(); server.close();
})().catch(e => { console.error(e); process.exit(1); });
