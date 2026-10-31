/* PRCelebrate — celebrate a personal record the moment a set is checked off.
 * Plain JS, no DOM of its own: describes the record (what was beaten and the old best),
 * picks a vibration pattern, and fires toast + vibrate through callbacks the host passes in.
 * Inputs follow the workout logger's shapes: `kinds` from setPRs() ('Est. 1RM', 'Weight',
 * 'Volume', 'Reps', 'Distance', 'Time') and `R` from records() (previous bests, kg-based `v`).
 */
const PRCelebrate = (() => {
  const epley = (w, r) => (!w || !r) ? 0 : r === 1 ? w : w * (1 + r / 30);
  const num = v => { const n = parseFloat(v); return isFinite(n) ? n : null; };
  const fmtN = (n, d) => { if (n == null || !isFinite(n)) return ''; const s = (+n).toFixed(d); return s.indexOf('.') < 0 ? s : s.replace(/\.?0+$/, '') || '0'; };
  const toKg = (v, unit) => unit === 'lb' ? v * 0.45359237 : v;
  const fromKg = (v, unit) => unit === 'lb' ? v / 0.45359237 : v;
  const dateTxt = (at, fmtDate) => {
    if (!at) return '';
    if (fmtDate) return fmtDate(at);
    try { return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch (e) { return ''; }
  };
  const setTxt = (r, unit) => r && r.w != null ? fmtN(r.w, 2) + ' ' + (r.unit || unit) + (r.r ? ' × ' + r.r : '') : '';

  // describe(kinds, R, set, opts) -> { kinds, lines:[{kind, now, was, at}], headline, detail, text }
  // opts: { name, unit ('kg'|'lb'), e1rm (fn), fmtDate (fn) }
  function describe(kinds, R, set, opts) {
    opts = opts || {}; R = R || {}; set = set || {};
    const unit = opts.unit || 'kg', e1 = opts.e1rm || epley;
    const w = num(set.w) || 0, r = num(set.r) || 0, wk = toKg(w, unit);
    const lines = (kinds || []).map(kind => {
      let now = '', was = '', at = '';
      if (kind === 'Weight') { now = fmtN(w, 2) + ' ' + unit; if (R.weight) { was = setTxt(R.weight, unit); at = R.weight.at; } }
      else if (kind === 'Est. 1RM') { now = fmtN(fromKg(e1(wk, r), unit), 1) + ' ' + unit; if (R.e1rm) { was = fmtN(fromKg(R.e1rm.v, unit), 1) + ' ' + unit + (R.e1rm.w != null ? ' (' + setTxt(R.e1rm, unit) + ')' : ''); at = R.e1rm.at; } }
      else if (kind === 'Volume') { now = fmtN(w * r, 0) + ' ' + unit; if (R.volume) { was = fmtN(fromKg(R.volume.v, unit), 0) + ' ' + unit + (R.volume.w != null ? ' (' + setTxt(R.volume, unit) + ')' : ''); at = R.volume.at; } }
      else if (kind === 'Reps') { now = r + ' reps'; if (R.reps) { was = R.reps.v + ' reps'; at = R.reps.at; } }
      else if (kind === 'Distance') { now = fmtN(num(set.km), 2) + ' km'; if (R.km) { was = fmtN(R.km.v, 2) + ' km'; at = R.km.at; } }
      else if (kind === 'Time') { const m = num(set.min) || 0, s = num(set.sec) || 0; now = (m ? m + ' min' : '') + (s ? (m ? ' ' : '') + s + ' s' : ''); const pm = R.min && R.min.v, ps = R.sec && R.sec.v; was = (pm ? pm + ' min' : '') + (ps ? (pm ? ' ' : '') + ps + ' s' : ''); at = (R.min && R.min.at) || (R.sec && R.sec.at) || ''; }
      else { now = ''; }
      return { kind, now, was, at };
    });
    const main = lines[0];
    const headline = (opts.name ? opts.name + ': ' : '') + (lines.length > 1 ? lines.length + ' records' : lines.length ? lines[0].kind + ' record' : 'New record');
    const detail = main ? [main.now, main.was ? 'was ' + main.was + (main.at ? ' on ' + dateTxt(main.at, opts.fmtDate) : '') : ''].filter(Boolean).join(' · ') : '';
    const extra = lines.slice(1).map(l => l.kind + (l.was ? ' (was ' + l.was + ')' : '')).join(', ');
    const text = headline + (detail ? ' · ' + detail : '') + (extra ? ' · also ' + extra : '');
    return { kinds: kinds || [], lines, headline, detail, text };
  }

  // Short double tap for one record, a longer celebratory burst for several. Empty when nothing was beaten.
  function vibration(kinds) {
    const n = Array.isArray(kinds) ? kinds.length : (kinds | 0);
    if (!n) return [];
    if (n === 1) return [60, 60, 60];
    if (n === 2) return [60, 60, 60, 60, 120];
    return [60, 50, 60, 50, 60, 50, 200];
  }

  // Banner HTML for the gym view. `esc` is the host's HTML escaper.
  function bannerHtml(d, esc) {
    esc = esc || (s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));
    if (!d || !d.lines.length) return '';
    return '<div class="lb-gym-pr pr-celebrate" role="status"><b>🏆 ' + esc(d.headline) + '</b>' +
      '<span class="pr-celebrate-lines">' + d.lines.map(l => '<span>' + esc(l.kind) + ' ' + esc(l.now) + (l.was ? ' <small>was ' + esc(l.was) + '</small>' : '') + '</span>').join('') + '</span></div>';
  }

  // fire(d, { toast, vibrate, nav }) -> { toasted, vibrated }. `vibrate: false` respects the user's setting.
  function fire(d, io) {
    io = io || {};
    const out = { toasted: false, vibrated: false };
    if (!d || !d.kinds.length) return out;
    if (typeof io.toast === 'function') { io.toast('🏆 ' + d.text); out.toasted = true; }
    const nav = io.nav || (typeof navigator !== 'undefined' ? navigator : null);
    if (io.vibrate !== false && nav && typeof nav.vibrate === 'function') {
      try { out.vibrated = nav.vibrate(vibration(d.kinds)) !== false; } catch (e) { out.vibrated = false; }
    }
    return out;
  }

  const css = '.pr-celebrate b{display:block;font-size:1rem}.pr-celebrate-lines{display:block;margin-top:4px;font-weight:600;font-size:.88rem;opacity:.95}.pr-celebrate-lines>span{display:block}.pr-celebrate small{opacity:.8;font-weight:500}';

  return { describe, vibration, bannerHtml, fire, css, epley };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = PRCelebrate;
if (typeof globalThis !== 'undefined') globalThis.PRCelebrate = PRCelebrate;
