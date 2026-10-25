// Tests for progress-photos.js. Run: node modules/progress-photos/test.js (uses the preinstalled Playwright + Chromium).
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const P = require('./progress-photos.js');

// ---------- pure helpers ----------
const docs = {
  '2026-11-08': { date: '2026-11-08', front: 'b'.repeat(32), side: 'c'.repeat(32), back: 'd'.repeat(32), waist: 101, align: { front: { x: 2, y: -1, s: 1.05 } } },
  '2026-10-25': { date: '2026-10-25', front: 'a'.repeat(32), side: 'e'.repeat(32) },
  '2026-11-01': { date: '2026-11-01' },
};
const weights = [{ date: '2026-10-25', kg: 91.9 }, { date: '2026-11-07', kg: 90.2 }, { date: '2026-11-08', kg: 90.0 }];
assert.deepStrictEqual(P.sets(docs).map(d => d.date), ['2026-10-25', '2026-11-08'], 'empty days are skipped, oldest first');
assert.deepStrictEqual(P.datesWith(docs, 'back'), ['2026-11-08']);
assert.deepStrictEqual(P.defaultPair(docs, 'front'), { before: '2026-10-25', after: '2026-11-08' });
assert.strictEqual(P.defaultPair(docs, 'back'), null);
assert.deepStrictEqual(P.nextDue({}, '2026-10-25'), { date: '2026-10-25', state: 'start' });
assert.strictEqual(P.nextDue(docs, '2026-11-10').state, 'done');
assert.strictEqual(P.nextDue(docs, '2026-11-10').date, '2026-11-15');
assert.strictEqual(P.nextDue(docs, '2026-11-16').state, 'due');
assert.deepStrictEqual(P.nextDue({ x: { date: '2026-11-08', front: 'a'.repeat(32) } }, '2026-11-09').missing, ['Side', 'Back']);
assert.strictEqual(P.weightNear(weights, '2026-11-08').kg, 90.0, 'exact day wins');
assert.strictEqual(P.weightNear(weights, '2026-11-05').kg, 90.2, 'closest within 3 days');
assert.strictEqual(P.weightNear(weights, '2026-11-01'), null, 'nothing within 3 days');
assert.strictEqual(P.srcOf('a'.repeat(32)), '/_blob/' + 'a'.repeat(32));
assert.strictEqual(P.srcOf('idb:xyz'), null);
assert.strictEqual(P.srcOf('data:image/jpeg;base64,AA'), 'data:image/jpeg;base64,AA');
assert.strictEqual(P.srcOf('javascript:alert(1)'), null);
const fr = P.frames(docs, 'front', weights, [{ date: '2026-10-26', waist: 104 }]);
assert.strictEqual(fr.length, 2);
assert.deepStrictEqual([fr[0].week, fr[1].week], [1, 3]);
assert.deepStrictEqual([fr[0].kg, fr[1].kg, fr[1].dKg], [91.9, 90.0, -1.9]);
assert.deepStrictEqual([fr[0].waist, fr[1].waist, fr[1].dWaist], [104, 101, -3], 'logged waist used when none typed; typed waist wins');
assert.strictEqual(P.xform(fr[1].align), 'transform:translate(2%,-1%) scale(1.05)');
assert.strictEqual(P.xform({ x: 0, y: 0, s: 1 }), '');
console.log('helpers ok');

// ---------- browser ----------
(async () => {
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 860 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const reqs = [];
  page.on('request', r => reqs.push(r.url()));
  const url = 'file://' + path.join(__dirname, 'preview.html');
  await page.goto(url);
  await page.waitForSelector('.pp-cmp');

  // demo: slider, line-up, timelapse
  assert.strictEqual(await page.locator('.pp-hrow').count(), 6, 'six demo weeks listed');
  const stage = page.locator('[data-pp-stage]');
  await stage.scrollIntoViewIfNeeded();
  const box = await stage.boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2, { steps: 5 }); await page.mouse.up();
  const x = await stage.evaluate(el => parseFloat(el.style.getPropertyValue('--x')));
  assert(x > 15 && x < 25, 'dragging moves the divider, got ' + x);
  assert.strictEqual(await page.locator('[data-pp-range]').inputValue(), String(Math.round(x)));
  assert(await page.locator('.pp-before').evaluate(el => getComputedStyle(el).clipPath.startsWith('inset')), 'before layer is clipped');
  assert.match(await page.locator('[data-pp-stage] .pp-layer:not(.pp-before) img').getAttribute('style'), /scale\(/, 'after photo carries its alignment');

  // timelapse
  assert.strictEqual(await page.locator('[data-pp-ov="t"]').textContent(), 'Week 6 · Nov 29');
  assert.strictEqual(await page.locator('[data-pp-ov="k"]').textContent(), '88.6 kg (−3.3)');
  assert.strictEqual(await page.locator('[data-pp-ov="w"]').textContent(), 'Waist 98.5 cm (−5.5)');
  await page.locator('[data-pp-speed="fast"]').click();
  await page.locator('[data-pp-play]').click();
  await page.waitForFunction(() => document.querySelector('[data-pp-ov="t"]').textContent.startsWith('Week 1'), null, { timeout: 5000 });
  await page.waitForFunction(() => document.querySelector('[data-pp-ov="t"]').textContent.startsWith('Week 2'), null, { timeout: 5000 });
  await page.locator('[data-pp-play]').click();
  assert.strictEqual(await page.locator('[data-pp-play]').textContent(), 'Play');
  await page.locator('[data-pp-scrub]').fill('2');
  await page.waitForFunction(() => document.querySelector('[data-pp-ov="t"]').textContent.startsWith('Week 3'));

  // line-up on the latest side photo
  await page.locator('[data-pp-open="2026-11-29"]').click();
  await page.locator('[data-pp-align="side"]').click();
  const a = page.locator('[data-pp-astage]');
  await a.scrollIntoViewIfNeeded();
  const ab = await a.boundingBox();
  await page.mouse.move(ab.x + ab.width / 2, ab.y + ab.height / 2);
  await page.mouse.down(); await page.mouse.move(ab.x + ab.width / 2 - 30, ab.y + ab.height / 2 + 20, { steps: 4 }); await page.mouse.up();
  await page.locator('[data-pp-a="s"]').fill('110');
  const ghost = await page.locator('.pp-ghost img').getAttribute('style');
  assert.match(ghost, /translate\(-\d+(\.5)?%,\d+(\.5)?%\) scale\(1\.1\)/, 'drag + size slider move the ghost: ' + ghost);
  await page.locator('[data-pp-asave]').click();
  assert.strictEqual(await page.locator('.pp-align').count(), 0, 'panel closes on save');
  await page.locator('[data-pp-pose="side"]').click();
  assert.match(await page.locator('.pp-tlstage .pp-layer.is-on img').getAttribute('style'), /scale\(1\.1\)/, 'saved alignment shows in timelapse');

  // try mine: upload, waist, reload, delete
  await page.locator('[data-mode="mine"]').click();
  await page.waitForSelector('.pp-tile');
  const big = path.join(os.tmpdir(), 'pp-test-big.png');
  const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 3000; c.height = 4000; const g = c.getContext('2d'); g.fillStyle = '#c33'; g.fillRect(0, 0, 3000, 4000); g.fillStyle = '#333'; g.fillRect(1000, 800, 1000, 2400); return c.toDataURL('image/png'); });
  fs.writeFileSync(big, Buffer.from(png.split(',')[1], 'base64'));
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('[data-pp-pick="front"]').click()]);
  await chooser.setFiles(big);
  await page.waitForSelector('[data-pp-pick="front"].has img[src^="blob:"]');
  const dims = await page.locator('[data-pp-pick="front"] img').evaluate(el => new Promise(r => { const f = () => r([el.naturalWidth, el.naturalHeight]); el.complete ? f() : el.onload = f; }));
  assert.deepStrictEqual(dims, [1200, 1600], 'photo downscaled to 1600 px long edge');
  await page.locator('[data-pp-waist]').fill('103.5');
  await page.locator('[data-pp-waist]').blur();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('aziz-progress-photos') || '{}')[Object.keys(JSON.parse(localStorage.getItem('aziz-progress-photos') || '{}'))[0]]?.waist === 103.5);
  assert.strictEqual(await page.locator('.pp-due').textContent(), 'Still to take: Side, Back');

  await page.reload();
  await page.locator('[data-mode="mine"]').click();
  await page.waitForSelector('[data-pp-pick="front"].has img[src^="blob:"]', { timeout: 5000 });
  assert.strictEqual(await page.locator('[data-pp-waist]').inputValue(), '103.5', 'waist survives reload');

  await page.locator('[data-pp-del="front"]').click();
  assert.strictEqual(await page.locator('[data-pp-del="front"]').textContent(), 'Tap to delete', 'first tap only arms');
  await page.locator('[data-pp-del="front"]').click();
  await page.waitForSelector('[data-pp-pick="front"]:not(.has)');
  assert.strictEqual(await page.evaluate(() => localStorage.getItem('aziz-progress-photos')), '{}');

  // assets path: upload goes to the assets namespace, the doc stores the id, replace deletes the old asset
  await page.evaluate(() => {
    window.calls = []; window.saved = {};
    const assets = {
      upload: async (blob, o) => { calls.push(['upload', blob.type, o.type, blob.size]); return { id: (calls.length + '').padStart(32, 'f'), url: '' }; },
      delete: async id => { calls.push(['delete', id]); return { deleted: true }; },
    };
    const storage = { list: async () => Object.values(saved), put: async (c, id, d) => { calls.push(['put', c, id]); saved[id] = d; }, remove: async (c, id) => { delete saved[id]; } };
    const old = document.getElementById('pp'), fresh = document.createElement('div'); fresh.id = 'pp'; old.replaceWith(fresh); // drop the preview's own instance
    window.inst2 = ProgressPhotos.mount(document.getElementById('pp'), { storage, assets, today: '2026-11-01' });
  });
  await page.waitForSelector('.pp-note');
  assert.match(await page.locator('.pp-note').textContent(), /^Private to this app/);
  for (let i = 0; i < 2; i++) {
    const [ch] = await Promise.all([page.waitForEvent('filechooser'), page.locator('[data-pp-pick="back"]').click()]);
    await ch.setFiles(big);
    await page.waitForFunction(n => window.calls.filter(c => c[0] === 'put').length === n, i + 1);
  }
  await page.waitForFunction(() => window.calls.some(c => c[0] === 'delete'));
  const calls = await page.evaluate(() => window.calls);
  assert.deepStrictEqual(calls[0].slice(0, 3), ['upload', 'image/jpeg', 'image/jpeg']);
  assert(calls[0][3] < fs.statSync(big).size, 'uploaded JPEG is smaller than the original');
  assert.deepStrictEqual(calls.find(c => c[0] === 'delete'), ['delete', '1'.padStart(32, 'f')], 'replacing deletes the old asset');
  const saved = await page.evaluate(() => window.saved['2026-11-01']);
  assert.strictEqual(saved.back, '3'.padStart(32, 'f'));
  await page.waitForTimeout(300);
  assert(reqs.some(u => u.endsWith('/_blob/' + saved.back)), 'shows the asset via /_blob/<id>');
  assert.strictEqual(await page.locator('[data-pp-pick="back"] img').getAttribute('alt'), 'Photo unavailable', 'a missing asset shows a placeholder');

  // phone layout: no sideways scroll
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal scroll at 390 px');
  assert.deepStrictEqual(errors, [], 'no page errors');

  await page.goto(url);
  await page.waitForSelector('.pp-cmp');
  await browser.close();
  console.log('browser ok');
})().catch(e => { console.error(e); process.exit(1); });
