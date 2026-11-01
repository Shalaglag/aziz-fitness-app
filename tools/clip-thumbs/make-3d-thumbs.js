#!/usr/bin/env node
// List pictures for exercises that have no video clip yet: one 144x144 WebP still of the built-in
// 3D demo (modules/exercise-anim) per exercise, written to app/clips/thumbs3d/<exercise-id>.webp.
// The logger shows the clip still when a clip exists, this one otherwise, and a letter circle last.
// Run after adding or changing 3D demos: node tools/clip-thumbs/make-3d-thumbs.js   (needs Playwright's Chromium)
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '../..'), OUT = path.join(ROOT, 'app/clips/thumbs3d');
const T = Number(process.argv[2] || 0.5);
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch(), p = await b.newPage();
  await p.setContent('<html><body></body></html>');
  await p.addScriptTag({ path: path.join(ROOT, 'modules/exercise-anim/exercise-anim.js') });
  const shots = await p.evaluate(t => {
    const A = window.ExerciseAnim, hex = h => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
    const colors = {}; Object.entries(A.palette.light).forEach(([k, v]) => { colors[k] = hex(v); });
    Object.assign(colors, { hi: hex('#d9392c'), line: '#d0d4da', shadow: 'rgba(20,30,50,0.18)' });
    const big = document.createElement('canvas'); big.width = big.height = 432;
    const small = document.createElement('canvas'); small.width = small.height = 144;
    const out = {};
    A.ids().forEach(id => {
      const d = A.defs[id], st = { t: d.still ? 0 : t, view: '3d', yaw: A.views['3d'](d), pitch: (d.cam && d.cam.pitch) || 0.15, speed: 1 };
      const g = big.getContext('2d'); A.draw(g, 432, 432, id, st, colors);
      const s = small.getContext('2d'); s.fillStyle = '#eceef2'; s.fillRect(0, 0, 144, 144); s.imageSmoothingQuality = 'high'; s.drawImage(big, 0, 0, 144, 144);
      out[id] = small.toDataURL('image/webp', 0.75).split(',')[1];
    });
    return out;
  }, T);
  Object.entries(shots).forEach(([id, b64]) => fs.writeFileSync(path.join(OUT, id + '.webp'), Buffer.from(b64, 'base64')));
  console.log('3D thumbs: ' + Object.keys(shots).length);
  await b.close();
})();
