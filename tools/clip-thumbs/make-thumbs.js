#!/usr/bin/env node
// Makes the small list pictures for exercise clips: one 144x144 WebP still per clip in
// modules/exercise-anim/clips.json, written to app/clips/thumbs/<clip-id>.webp.
// The still is taken a quarter of the way into the clip (top of the first rep), cropped to the middle 90%.
// Run after adding clips: node tools/clip-thumbs/make-thumbs.js [--force]   (needs ffmpeg)
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '../..');
const CLIPS = JSON.parse(fs.readFileSync(path.join(ROOT, 'modules/exercise-anim/clips.json'), 'utf8'));
const SRC = path.join(ROOT, 'app', CLIPS.base || 'clips/'), OUT = path.join(SRC, 'thumbs');
const force = process.argv.includes('--force');
fs.mkdirSync(OUT, { recursive: true });
let made = 0;
for (const [id, c] of Object.entries(CLIPS.clips)) {
  const src = path.join(SRC, c.file), dst = path.join(OUT, id + '.webp');
  if (!fs.existsSync(src)) { console.warn('missing clip', c.file); continue; }
  if (!force && fs.existsSync(dst) && fs.statSync(dst).mtimeMs >= fs.statSync(src).mtimeMs) continue;
  const t = ((c.seconds || 6.8) / (c.reps || 2) / 2).toFixed(2);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-ss', t, '-i', src, '-frames:v', '1',
    '-vf', 'crop=iw*0.9:ih*0.9,scale=144:144', '-c:v', 'libwebp', '-quality', '72', dst]);
  made++;
}
console.log('thumbs: made ' + made + ', total ' + fs.readdirSync(OUT).filter(f => f.endsWith('.webp')).length);
