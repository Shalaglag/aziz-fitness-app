/* Workout share card: a finished workout as WhatsApp-ready text and as a PNG image.
 * Plain JS, no imports, no network. Generic: works for any Liftbook-style workout doc.
 *
 * Input (summarize): a workout doc from lb_workouts
 *   {id, name, start, end, notes, exercises:[{exId, unit, sets:[{t:'w'|'n'|'d'|'f', w, r, km, min, sec, done, pr:[...]}]}]}
 * plus getEx(exId) -> {name, cat, unit} (cat: Bodyweight | Reps only | Duration | Cardio | anything else = weighted).
 *
 * API:
 *   WorkoutShare.summarize(workout, getEx)        -> plain summary (below), safe to store or pass around
 *   WorkoutShare.text(summary, {footer})          -> WhatsApp text (*bold*, emoji, one line per exercise, PR list)
 *   WorkoutShare.layout(summary, {width})         -> {width, height, rows} the image draws; pure, used by draw and tests
 *   WorkoutShare.draw(summary, {canvas, theme, width, footer}) -> the canvas, painted (creates one when none is passed)
 *   WorkoutShare.share(summary, {canvas, filename, title, footer}) -> Promise<'shared'|'shared-text'|'copied'|'saved'>
 *        navigator.share with the PNG + text when files are supported, else share text, else copy text and download the PNG.
 *   WorkoutShare.compact(sets)                    -> "3 × 8 @ 80 kg" / "80×8, 80×7, 75×8" for a list of working sets
 *
 * Summary shape:
 *   { name, start, end, durationMin, volumeKg, sets, prCount, notes,
 *     exercises: [{ name, cat, unit, sets: [{label, text, w, r, pr:[...]}], warmups, compact, best, volumeKg }],
 *     prs: [{ exercise, text, kinds: [...] }] }
 */
const WorkoutShare = (() => {
  const LB = 0.45359237;
  const num = v => (v === '' || v == null || isNaN(+v)) ? null : +v;
  const toKg = (w, unit) => unit === 'lb' ? w * LB : w;
  const fmtN = (n, d = 0) => (Math.round(n * 10 ** d) / 10 ** d).toLocaleString('en-US', { maximumFractionDigits: d });
  const mmss = s => Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0');
  const fieldsFor = cat => ({ Bodyweight: ['r'], 'Reps only': ['r'], Duration: ['sec'], Cardio: ['km', 'min'] }[cat] || ['w', 'r']);
  const fmtDate = (ms, o) => { try { return new Date(ms).toLocaleDateString('en-GB', o || { weekday: 'short', day: 'numeric', month: 'short' }); } catch (e) { return new Date(ms).toDateString(); } };
  const fmtDur = min => min >= 60 ? Math.floor(min / 60) + 'h ' + (min % 60) + 'm' : min + ' min';

  function setText(s, cat, unit) {
    const f = fieldsFor(cat);
    if (f[0] === 'km') return [num(s.km) != null ? fmtN(+s.km, 2) + ' km' : '', num(s.min) != null ? fmtN(+s.min) + ' min' : ''].filter(Boolean).join(' · ');
    if (f[0] === 'sec') return num(s.sec) != null ? mmss(+s.sec) : '';
    if (f[0] === 'r') return num(s.r) != null ? s.r + ' reps' : '';
    if (num(s.w) == null && num(s.r) == null) return '';
    return fmtN(num(s.w) || 0, 2) + ' ' + (unit || 'kg') + (num(s.r) != null ? ' × ' + s.r : '');
  }

  // "3 × 8 @ 80 kg" when every working set matches, otherwise "80×8, 80×7, 75×8" (weighted) or "12, 10, 8 reps".
  function compact(sets, unit) {
    const ws = sets.filter(s => s.text);
    if (!ws.length) return '';
    const weighted = ws.every(s => s.w != null);
    if (weighted) {
      const same = ws.every(s => s.w === ws[0].w && s.r === ws[0].r);
      if (same && ws[0].r != null) return ws.length + ' × ' + ws[0].r + ' @ ' + fmtN(ws[0].w, 2) + ' ' + (unit || 'kg');
      return ws.map(s => fmtN(s.w, 2) + (s.r != null ? '×' + s.r : '')).join(', ') + ' ' + (unit || 'kg');
    }
    if (ws.every(s => s.r != null && s.w == null && !/km|min|:/.test(s.text))) {
      const same = ws.every(s => s.r === ws[0].r);
      return same ? ws.length + ' × ' + ws[0].r + ' reps' : ws.map(s => s.r).join(', ') + ' reps';
    }
    return ws.map(s => s.text).join(', ');
  }

  function summarize(w, getEx) {
    getEx = getEx || (id => ({ name: id }));
    const start = +w.start || Date.now(), end = +w.end || Date.now();
    let volumeKg = 0, setCount = 0;
    const prs = [];
    const exercises = (w.exercises || []).map(e => {
      const ex = getEx(e.exId) || { name: e.exId };
      const cat = ex.cat || 'Machine', unit = e.unit || ex.unit || 'kg';
      const weighted = fieldsFor(cat)[0] === 'w';
      let n = 0, warmups = 0, exVol = 0, best = null;
      const sets = [];
      (e.sets || []).forEach(s => {
        if (s.done === false) return;
        if (s.t === 'w') { warmups++; return; }
        const text = setText(s, cat, unit);
        if (!text) return;
        n++; setCount++;
        const row = { label: s.t === 'n' || !s.t ? String(n) : String(s.t).toUpperCase(), text, w: weighted ? num(s.w) : null, r: num(s.r), pr: (s.pr || []).slice() };
        if (weighted) { const v = toKg(num(s.w) || 0, unit) * (num(s.r) || 0); exVol += v; if (!best || v > best.v || (v === best.v && (num(s.w) || 0) > (best.w || 0))) best = { v, w: num(s.w) || 0, text }; }
        if (row.pr.length) prs.push({ exercise: ex.name, text, kinds: row.pr });
        sets.push(row);
      });
      volumeKg += exVol;
      return { name: ex.name, cat, unit, sets, warmups, compact: compact(sets, unit), best: best ? best.text : (sets.length ? sets[0].text : ''), volumeKg: Math.round(exVol) };
    }).filter(e => e.sets.length);
    return {
      name: w.name || w.templateName || 'Workout', start, end, durationMin: Math.max(0, Math.round((end - start) / 6e4)),
      volumeKg: Math.round(volumeKg), sets: setCount, prCount: prs.length, notes: (w.notes || '').trim(), exercises, prs
    };
  }

  function text(sum, opts) {
    opts = opts || {};
    const lines = [];
    lines.push('🏋️ *' + sum.name + '* — ' + fmtDate(sum.start));
    const stats = ['⏱ ' + fmtDur(sum.durationMin), '🔢 ' + sum.sets + ' sets'];
    if (sum.volumeKg) stats.splice(1, 0, '📦 ' + fmtN(sum.volumeKg) + ' kg');
    if (sum.prCount) stats.push('🏆 ' + sum.prCount + ' PR' + (sum.prCount > 1 ? 's' : ''));
    lines.push(stats.join(' · '));
    lines.push('');
    sum.exercises.forEach(e => lines.push((e.sets.some(s => s.pr.length) ? '🏆 ' : '• ') + '*' + e.name + '* ' + e.compact));
    if (sum.prs.length) {
      lines.push('');
      lines.push('🏆 *New records*');
      sum.prs.forEach(p => lines.push('• ' + p.exercise + ' ' + p.text + ' (' + p.kinds.join(', ') + ')'));
    }
    if (sum.notes) { lines.push(''); lines.push('📝 ' + sum.notes); }
    if (opts.footer) { lines.push(''); lines.push(opts.footer); }
    return lines.join('\n');
  }

  // ---------- Image ----------
  const THEME = { bg: '#14161b', card: '#1d2027', ink: '#f4f5f7', muted: '#9aa1ad', accent: '#1F5FD1', good: '#2fb36b', line: '#2b2f38' };
  function themeFromCss(root) {
    try {
      const cs = getComputedStyle(root || document.documentElement);
      const get = (k, d) => { const v = cs.getPropertyValue(k).trim(); return v && !/var\(/.test(v) ? v : d; };
      return { bg: get('--bg', THEME.bg), card: get('--surface', THEME.card), ink: get('--ink', THEME.ink), muted: get('--muted', THEME.muted), accent: get('--accent', THEME.accent), good: get('--good', THEME.good), line: get('--line', THEME.line) };
    } catch (e) { return THEME; }
  }

  // Rows the card draws, top to bottom, with y offsets. Pure, so the height is known before a canvas exists.
  function layout(sum, opts) {
    opts = opts || {};
    const W = opts.width || 1080, P = 64, rows = [];
    let y = P;
    rows.push({ type: 'title', y, text: sum.name }); y += 92;
    rows.push({ type: 'sub', y, text: fmtDate(sum.start, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) }); y += 70;
    const tiles = [[fmtDur(sum.durationMin), 'Duration'], [fmtN(sum.volumeKg), 'Volume kg'], [String(sum.sets), 'Sets'], [String(sum.prCount), sum.prCount === 1 ? 'Record' : 'Records']];
    rows.push({ type: 'tiles', y, tiles }); y += 190;
    const maxEx = opts.maxExercises || 12;
    const shown = sum.exercises.slice(0, maxEx);
    shown.forEach(e => { rows.push({ type: 'exercise', y, name: e.name, detail: e.compact, pr: e.sets.some(s => s.pr.length), best: e.best }); y += 78; });
    if (sum.exercises.length > shown.length) { rows.push({ type: 'more', y, text: '+ ' + (sum.exercises.length - shown.length) + ' more exercises' }); y += 60; }
    if (sum.prs.length) {
      y += 20; rows.push({ type: 'heading', y, text: 'New records' }); y += 64;
      sum.prs.slice(0, 6).forEach(p => { rows.push({ type: 'pr', y, text: p.exercise + ' · ' + p.text, kinds: p.kinds.join(', ') }); y += 60; });
    }
    y += 30; rows.push({ type: 'footer', y, text: opts.footer || '' }); y += 70;
    return { width: W, height: y + P / 2, pad: P, rows };
  }

  function fit(ctx, s, max) {
    if (ctx.measureText(s).width <= max) return s;
    let t = s;
    while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1);
    return t + '…';
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function draw(sum, opts) {
    opts = opts || {};
    const L = layout(sum, opts);
    const cv = opts.canvas || document.createElement('canvas');
    cv.width = L.width; cv.height = L.height;
    const ctx = cv.getContext('2d');
    const T = Object.assign({}, THEME, opts.theme || (typeof document !== 'undefined' ? themeFromCss() : {}));
    const F = opts.font || 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    const P = L.pad, W = L.width, inner = W - P * 2;
    ctx.fillStyle = T.bg; ctx.fillRect(0, 0, W, L.height);
    ctx.fillStyle = T.accent; ctx.fillRect(0, 0, W, 14);
    ctx.textBaseline = 'top';
    L.rows.forEach(r => {
      if (r.type === 'title') { ctx.fillStyle = T.ink; ctx.font = '800 72px ' + F; ctx.fillText(fit(ctx, r.text, inner), P, r.y); }
      else if (r.type === 'sub') { ctx.fillStyle = T.muted; ctx.font = '500 32px ' + F; ctx.fillText(r.text, P, r.y); }
      else if (r.type === 'tiles') {
        const gap = 20, tw = (inner - gap * 3) / 4;
        r.tiles.forEach(([v, lab], i) => {
          const x = P + i * (tw + gap);
          ctx.fillStyle = T.card; roundRect(ctx, x, r.y, tw, 150, 22); ctx.fill();
          ctx.fillStyle = lab.startsWith('Record') && +v > 0 ? T.good : T.ink; ctx.font = '800 54px ' + F; ctx.fillText(fit(ctx, v, tw - 32), x + 20, r.y + 26);
          ctx.fillStyle = T.muted; ctx.font = '500 26px ' + F; ctx.fillText(lab, x + 20, r.y + 98);
        });
      }
      else if (r.type === 'exercise') {
        ctx.fillStyle = T.line; ctx.fillRect(P, r.y + 70, inner, 2);
        ctx.fillStyle = r.pr ? T.good : T.ink; ctx.font = '700 34px ' + F;
        const name = (r.pr ? '★ ' : '') + r.name;
        ctx.fillText(fit(ctx, name, inner * 0.55), P, r.y + 14);
        ctx.fillStyle = T.muted; ctx.font = '500 30px ' + F; ctx.textAlign = 'right';
        ctx.fillText(fit(ctx, r.detail, inner * 0.43), W - P, r.y + 16); ctx.textAlign = 'left';
      }
      else if (r.type === 'more') { ctx.fillStyle = T.muted; ctx.font = '500 28px ' + F; ctx.fillText(r.text, P, r.y + 12); }
      else if (r.type === 'heading') { ctx.fillStyle = T.good; ctx.font = '800 30px ' + F; ctx.fillText(r.text.toUpperCase(), P, r.y + 10); }
      else if (r.type === 'pr') {
        ctx.fillStyle = T.ink; ctx.font = '600 30px ' + F; ctx.fillText(fit(ctx, '🏆 ' + r.text, inner * 0.62), P, r.y + 8);
        ctx.fillStyle = T.good; ctx.font = '600 26px ' + F; ctx.textAlign = 'right'; ctx.fillText(fit(ctx, r.kinds, inner * 0.36), W - P, r.y + 12); ctx.textAlign = 'left';
      }
      else if (r.type === 'footer') {
        ctx.fillStyle = T.line; ctx.fillRect(P, r.y, inner, 2);
        ctx.fillStyle = T.muted; ctx.font = '500 26px ' + F;
        ctx.fillText(r.text || fmtDate(sum.start, { day: 'numeric', month: 'short', year: 'numeric' }), P, r.y + 24);
        ctx.textAlign = 'right'; ctx.fillText(fmtDur(sum.durationMin) + ' · ' + sum.sets + ' sets', W - P, r.y + 24); ctx.textAlign = 'left';
      }
    });
    return cv;
  }

  const toBlob = cv => new Promise(res => cv.toBlob ? cv.toBlob(b => res(b), 'image/png') : res(null));
  const safeName = s => (s || 'workout').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase();
  function download(url, name) { const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 0); }

  async function share(sum, opts) {
    opts = opts || {};
    const txt = text(sum, opts);
    const cv = opts.canvas || draw(sum, opts);
    const name = opts.filename || safeName(sum.name) + '-' + new Date(sum.start).toISOString().slice(0, 10) + '.png';
    const nav = typeof navigator !== 'undefined' ? navigator : {};
    const blob = await toBlob(cv);
    if (blob && nav.share && typeof File !== 'undefined') {
      const file = new File([blob], name, { type: 'image/png' });
      const data = { files: [file], title: opts.title || sum.name, text: txt };
      if (!nav.canShare || nav.canShare(data)) {
        try { await nav.share(data); return 'shared'; } catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
      }
    }
    if (nav.share) { try { await nav.share({ title: opts.title || sum.name, text: txt }); return 'shared-text'; } catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; } }
    let copied = false;
    try { await nav.clipboard.writeText(txt); copied = true; } catch (e) { }
    try { download(blob ? URL.createObjectURL(blob) : cv.toDataURL('image/png'), name); } catch (e) { return copied ? 'copied' : 'failed'; }
    return copied ? 'copied' : 'saved';
  }

  return { summarize, text, compact, layout, draw, share, themeFromCss, download, THEME, _fmt: { setText, fmtN, fmtDur } };
})();

if (typeof module !== 'undefined') module.exports = { WorkoutShare };
