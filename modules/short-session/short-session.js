/* ShortSession: fit today's session into 30, 45 or 60 minutes.
 * Plain JS, no imports, no network. Exposes window.ShortSession (or module.exports in Node).
 *
 * - estimate(items, {cardioMin}) -> {lifting, cardio, total} minutes from a simple timing model
 *   (warm-up, work per set, rest by lift type, a superset halves the rest, a change-over per exercise).
 * - plan(exercises, {minutes, mainLifts, cardioMin, swap}) -> the trimmed session: main compounds keep
 *   all their sets; accessories are supersetted, then cut to 2 sets, then dropped (lowest priority
 *   first: later in the list and a muscle already covered); the treadmill block scales 30 → 20 → 10 → 0
 *   between those steps. Returns what changed and the new estimate.
 * - apply(workoutDoc, plan) / clear / active store the choice on workouts/{date}.short.
 * - cardHtml({...}) renders the Train-tab card; buttons carry data-act="ssmin|ssapply|ssclear".
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ShortSession = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BUDGETS = [30, 45, 60];
  const TIMING = { warmup: 5, work: 0.75, restMain: 2.5, restAcc: 1.5, restSuperset: 0.75, change: 0.5 };
  const CARDIO_STEPS = [20, 10, 0];
  const DEFAULT_MAIN = ['Bench Press (Barbell)', 'Incline DB Press', 'Gundam (Chest Machine)', 'Seated DB Overhead Press', 'Lat Pulldown, Wide', 'Seated Row (Cable)', 'T-Bar Row', 'Hack Squat', 'Leg Extension', 'Lying Leg Curl'];
  const MUSCLE_HINTS = [[/bench|chest|crossover|press/i, 'Chest'], [/lat|row|pullover/i, 'Back'], [/delt|raise|shoulder/i, 'Shoulders'], [/tricep/i, 'Triceps'], [/bicep|curl(?! \(leg\))/i, 'Biceps'], [/leg curl/i, 'Hamstrings'], [/squat|extension/i, 'Quads'], [/calf/i, 'Calves'], [/abs|crunch/i, 'Abs'], [/adductor|abductor|hip/i, 'Hips'], [/trap|shrug/i, 'Traps']];

  const swapApi = o => (o && o.swap) || (typeof window !== 'undefined' && window.ExerciseSwap) || null;
  const r1 = x => Math.round(x * 10) / 10;

  function muscleOf(name, X) {
    if (X && typeof X.lookup === 'function') { try { const e = X.lookup(name); if (e && e.muscle) return e.muscle; } catch (e) { /* fall through */ } }
    if (/lying leg curl|seated leg curl/i.test(name)) return 'Hamstrings';
    const hit = MUSCLE_HINTS.find(([re]) => re.test(name));
    return hit ? hit[1] : 'Other';
  }

  /** exercises: names or shell PROGRAM rows [name, w, reps, sets, unit, note]. */
  function normalize(exercises, o) {
    const X = swapApi(o), mains = (o && o.mainLifts) || DEFAULT_MAIN;
    return (exercises || []).map((e, i) => {
      const name = Array.isArray(e) ? e[0] : typeof e === 'string' ? e : (e && e.name) || '';
      const sets = Array.isArray(e) ? +e[3] || 1 : (e && +e.sets) || 1;
      const reps = Array.isArray(e) ? e[2] : e && e.reps;
      return { name, origSets: sets, sets, reps, main: mains.includes(name), muscle: muscleOf(name, X), i, pair: null, drop: false };
    });
  }

  function estimate(items, o) {
    o = o || {};
    const t = Object.assign({}, TIMING, o.timing);
    let lifting = items.some(it => !it.drop) ? t.warmup : 0;
    items.forEach(it => {
      if (it.drop || !it.sets) return;
      const rest = it.main ? t.restMain : it.pair ? t.restSuperset : t.restAcc;
      lifting += t.change + it.sets * (t.work + rest);
    });
    const cardio = Math.max(0, +o.cardioMin || 0);
    return { lifting: r1(lifting), cardio, total: r1(lifting + cardio) };
  }

  /** Drop order for accessories: later in the session and a muscle already worked go first. */
  function priority(items) {
    const seen = new Set();
    return items.map(it => {
      let p = it.main ? -100 : it.i;
      if (!it.main && seen.has(it.muscle)) p += 100;
      seen.add(it.muscle);
      return p;
    });
  }

  /** Superset only accessories that sit together between main lifts, different muscles first. */
  function pairAccessories(items) {
    items.forEach(x => { if (!x.main) x.pair = null; });
    const runs = []; let run = [];
    items.forEach(it => { if (it.main) { if (run.length) runs.push(run); run = []; } else if (!it.drop) run.push(it); });
    if (run.length) runs.push(run);
    let letter = 0;
    runs.forEach(acc => {
      for (let a = 0; a < acc.length; a++) {
        if (acc[a].pair) continue;
        let b = acc.findIndex((x, j) => j > a && !x.pair && x.muscle !== acc[a].muscle);
        if (b < 0) b = acc.findIndex((x, j) => j > a && !x.pair);
        if (b < 0) continue;
        acc[a].pair = acc[b].pair = String.fromCharCode(65 + letter++);
      }
    });
    return items.filter(it => it.pair).length;
  }

  function plan(exercises, o) {
    o = o || {};
    const minutes = +o.minutes || 60;
    const cardioOrig = o.cardioMin == null ? 30 : Math.max(0, +o.cardioMin || 0);
    const items = normalize(exercises, o);
    const full = estimate(items, { cardioMin: cardioOrig, timing: o.timing });
    let cardioMin = cardioOrig;
    const steps = [];
    const est = () => estimate(items, { cardioMin, timing: o.timing });
    const fits = () => est().total <= minutes + 0.01;
    const pri = priority(items);
    const byPriority = () => items.map((it, k) => ({ it, p: pri[k] })).filter(x => !x.it.main && !x.it.drop).sort((a, b) => b.p - a.p).map(x => x.it);
    const scaleCardio = () => {
      const next = CARDIO_STEPS.find(m => m < cardioMin);
      if (next == null) return false;
      steps.push(next ? 'Treadmill ' + cardioMin + ' → ' + next + ' min' : 'Skip the treadmill today');
      cardioMin = next; return true;
    };

    if (!fits()) { const n = pairAccessories(items); if (n) steps.push('Superset the accessories (' + n + ' moves, shorter rests)'); }
    if (!fits() && cardioMin > CARDIO_STEPS[0]) scaleCardio();
    // trim accessory sets to 2, lowest priority first
    while (!fits()) {
      const it = byPriority().find(x => x.sets > 2);
      if (!it) break;
      it.sets = 2; steps.push(it.name + ': ' + it.origSets + ' → 2 sets');
    }
    // drop accessories: a second move for a muscle goes first, the treadmill goes before any first-of-muscle move
    while (!fits()) {
      if (cardioMin > 10 && scaleCardio()) continue;
      const it = byPriority()[0];
      if (!it) break;
      if (pri[items.indexOf(it)] < 100 && cardioMin > 0) { scaleCardio(); continue; }
      it.drop = true; it.pair = null; steps.push('Skip ' + it.name);
      pairAccessories(items);
    }
    while (!fits() && scaleCardio()) { /* last resort: cardio to 0 */ }
    while (!fits()) {
      const it = items.filter(x => x.main && !x.drop && x.sets > 2).sort((a, b) => b.i - a.i)[0];
      if (!it) break;
      it.sets = 2; steps.push(it.name + ': ' + it.origSets + ' → 2 sets (main lift, still 2 hard sets)');
    }
    const e = est();
    return { minutes, items, cardioMin, cardioOrig, est: e, full, steps, over: r1(Math.max(0, e.total - minutes)) };
  }

  // ---------- state on workouts/{date} ----------
  function apply(doc, p) {
    const w = Object.assign({}, doc);
    const sets = {}; const pairs = {};
    p.items.forEach(it => { if (!it.drop && it.sets !== it.origSets) sets[it.name] = it.sets; if (it.pair) (pairs[it.pair] = pairs[it.pair] || []).push(it.name); });
    w.short = { minutes: p.minutes, sets, drop: p.items.filter(it => it.drop).map(it => it.name), pairs: Object.keys(pairs).sort().map(k => pairs[k]), cardioMin: p.cardioMin, est: p.est.total };
    return w;
  }
  function clear(doc) { const w = Object.assign({}, doc); delete w.short; return w; }
  const active = doc => (doc && doc.short && doc.short.minutes) || null;
  /** Per-exercise view of a stored choice: {sets|null, drop, pair} for the shell's exercise rows. */
  function slot(doc, name) {
    const s = doc && doc.short; if (!s) return { sets: null, drop: false, pair: null };
    const k = (s.pairs || []).findIndex(p => p.includes(name));
    return { sets: s.sets && s.sets[name] != null ? s.sets[name] : null, drop: (s.drop || []).includes(name), pair: k < 0 ? null : String.fromCharCode(65 + k) };
  }

  // ---------- UI ----------
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const mins = m => Math.round(m) + ' min';
  const css = `
.ss-card .ss-mins{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}
.ss-card .ss-est{display:flex;gap:10px;flex-wrap:wrap;font-size:.88rem;color:var(--muted);margin:4px 0}
.ss-card .ss-est b{color:var(--text,inherit)}
.ss-card .ss-steps{margin:8px 0 0;padding-left:18px;font-size:.88rem;display:grid;gap:4px}
.ss-card .ss-on{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:6px}
.ss-skip{opacity:.6}
.ss-skip .sets,.ss-skip details{display:none}
`;

  /**
   * cardHtml({session, exercises, minutes, active, open, mainLifts, cardioMin, swap, plan})
   * minutes: the budget being previewed; active: minutes stored on the day's workout, else null.
   */
  function cardHtml(o) {
    o = o || {};
    const minutes = o.active || o.minutes || 45;
    const p = o.plan || plan(o.exercises, { minutes, mainLifts: o.mainLifts, cardioMin: o.cardioMin, swap: o.swap });
    const chips = BUDGETS.map(m => '<button class="chip" data-act="ssmin" data-min="' + m + '" aria-pressed="' + (m === minutes) + '">' + m + ' min</button>').join('');
    const est = '<div class="ss-est"><span>Full session <b>' + mins(p.full.total) + '</b></span><span>This plan <b>' + mins(p.est.total) + '</b> (' + mins(p.est.lifting) + ' lifting' + (p.cardioMin ? ' + ' + mins(p.cardioMin) + ' treadmill' : '') + ')</span></div>';
    const steps = p.steps.length ? '<ul class="ss-steps">' + p.steps.map(s => '<li>' + esc(s) + '</li>').join('') + '</ul>' : '<p class="muted" style="font-size:.88rem">The full session already fits. Nothing to trim.</p>';
    const over = p.over ? '<p class="note" style="font-size:.85rem">Still about ' + mins(p.over) + ' over. Main lifts keep their sets; take shorter rests on the accessories.</p>' : '';
    const body = o.active
      ? '<div class="ss-on"><span class="pill good">Short session on · ' + o.active + ' min</span><button class="btn ghost small" data-act="ssclear">Back to the full session</button></div>'
      : '<div class="ss-on"><button class="btn small" data-act="ssapply" data-min="' + minutes + '">Use the ' + minutes + ' min version today</button></div>';
    return '<div class="card ss-card"><details' + (o.open || o.active ? ' open' : '') + ' data-keep="short"><summary><b>Short on time?</b> <span class="muted" style="font-size:.85rem">' + (o.active ? o.active + ' min version' : 'full session ~' + mins(p.full.total)) + '</span></summary>' +
      '<div class="ss-mins">' + chips + '</div>' + est + steps + over + body + '</details></div>';
  }

  const api = { BUDGETS, TIMING, CARDIO_STEPS, normalize, estimate, plan, apply, clear, active, slot, cardHtml, css };
  return api;
});
