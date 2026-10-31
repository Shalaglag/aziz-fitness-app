/* Lighter weights after a break (break ramp) for the Aziz Cut Tracker.
 * Plain JS, no imports, no network, no state of its own: everything is read off the lift's history.
 *
 * Rule: when a lift was last done 7+ days ago, the next session suggests ~90% of the last pre-break
 * working weights, the one after ~95%, then normal progression resumes. A 28+ day break ramps in
 * three sessions (80%, 90%, 95%). Weights round DOWN to the equipment step, so the suggestion is
 * never heavier than the maths. Reps stay at the pre-break reps.
 *
 * API (BreakRamp):
 *   TIERS                                  -> [{minDays, factors}] longest break first
 *   daysBetween(a, b)                      -> whole days from a to b (ISO "YYYY-MM-DD" or ms)
 *   roundDown(w, step)                     -> w floored to the step (2.5 kg default)
 *   plan(history, {today, step, minDays})  -> {ramp:false, reason} or
 *                                             {ramp:true, stage, of, factor, gapDays, base:{date, sets}, sets:[{w,r}], text}
 *       history: [{date, sets:[{w, r}]}] in any order; date is ISO or ms; sets are working sets.
 *   fromShell(workouts, name)              -> history for one exercise from the app's workouts/{date} docs
 *   fromLogger(lbWorkouts, exId, {excludeId}) -> history for one exercise from lb_workouts docs
 *   analyzeShell(workouts, {today, names, step}) -> {lifts:[{name, ...plan}], count} for every lift ramping today
 *   noteHtml(plan, unit)                   -> one-line note for Gym mode / Quick log ("" when no ramp)
 *   cardHtml(result, unit)                 -> Train card listing the lifts to go lighter on ("" when none)
 *   css                                    -> inject once
 */
const BreakRamp = (() => {
  const DAY = 864e5;
  const TIERS = [
    { minDays: 28, factors: [0.8, 0.9, 0.95] },
    { minDays: 7, factors: [0.9, 0.95] },
  ];
  const ms = d => typeof d === "number" ? d : Date.parse(String(d).length <= 10 ? d + "T00:00:00Z" : d);
  const dayOf = d => Math.floor(ms(d) / DAY);
  const daysBetween = (a, b) => dayOf(b) - dayOf(a);
  const num = v => (v === "" || v == null || isNaN(+v) ? null : +v);
  const roundDown = (w, step) => { step = step || 2.5; return Math.round(Math.floor(w / step + 1e-9) * step * 100) / 100; };
  const pct = f => Math.round(f * 100) + "%";
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const tierFor = (gap, minDays) => TIERS.find(t => t.minDays >= minDays ? gap >= t.minDays : false) || (gap >= minDays ? TIERS[TIERS.length - 1] : null);

  // Working sets with a real weight, in logged order.
  const workSets = sets => (sets || []).filter(s => s && num(s.w) != null && num(s.w) > 0).map(s => ({ w: num(s.w), r: num(s.r) }));

  function plan(history, opts) {
    opts = opts || {};
    const today = opts.today || new Date().toISOString().slice(0, 10), minDays = opts.minDays || 7, step = opts.step || 2.5;
    const h = (history || []).filter(s => s && s.date != null && workSets(s.sets).length && dayOf(s.date) <= dayOf(today))
      .sort((a, b) => ms(b.date) - ms(a.date));
    if (!h.length) return { ramp: false, reason: "no-history" };
    // Walk back from the latest session until a gap of minDays+ days: sessions before that gap are "after the break".
    let k = 0, gap = daysBetween(h[0].date, today);
    const maxStages = TIERS[0].factors.length;
    while (gap < minDays) {
      if (k + 1 >= h.length) return { ramp: false, reason: "no-break" };
      gap = daysBetween(h[k + 1].date, h[k].date);
      k++;
      if (k > maxStages) return { ramp: false, reason: "no-break" };
    }
    const tier = tierFor(gap, minDays);
    if (!tier) return { ramp: false, reason: "no-break" };
    const stage = k + 1;            // k sessions already done since the break
    if (stage > tier.factors.length) return { ramp: false, reason: "ramp-done", gapDays: gap };
    const base = h[k], factor = tier.factors[stage - 1];
    const sets = workSets(base.sets).map(s => ({ w: roundDown(s.w * factor, step), r: s.r }));
    const txt = stage === 1
      ? `${gap} days since this lift. Start at ${pct(factor)} of last time, then ${tier.factors.slice(1).map(pct).join(" then ")} before adding weight.`
      : `Session ${stage} of ${tier.factors.length} back after a ${gap}-day break: ${pct(factor)} of your pre-break weights.`;
    return { ramp: true, stage, of: tier.factors.length, factor, gapDays: gap, base: { date: base.date, sets: workSets(base.sets) }, sets, text: txt };
  }

  // workouts: the app's workouts/{date} map {date, sets:{"<name>":[{w,r}]}}
  function fromShell(workouts, name) {
    const out = [];
    Object.keys(workouts || {}).forEach(d => {
      const w = workouts[d]; if (!w || !w.sets || !w.sets[name]) return;
      const sets = workSets(w.sets[name]); if (sets.length) out.push({ date: w.date || d, sets });
    });
    return out;
  }
  // lbWorkouts: WorkoutLogger lb_workouts docs {id, start, exercises:[{exId, sets:[{t, w, r, done}]}]}
  function fromLogger(lbWorkouts, exId, opts) {
    opts = opts || {};
    const out = [];
    (lbWorkouts || []).forEach(w => {
      if (!w || w.id === opts.excludeId || !w.start) return;
      (w.exercises || []).forEach(e => {
        if (e.exId !== exId) return;
        const sets = workSets((e.sets || []).filter(s => s.done !== false && s.t !== "w"));
        if (sets.length) out.push({ date: w.start, sets });
      });
    });
    return out;
  }

  function analyzeShell(workouts, opts) {
    opts = opts || {};
    const names = opts.names || Array.from(new Set([].concat(...Object.keys(workouts || {}).map(d => Object.keys((workouts[d] && workouts[d].sets) || {})))));
    const lifts = [];
    names.forEach(name => { const p = plan(fromShell(workouts, name), opts); if (p.ramp) lifts.push(Object.assign({ name }, p)); });
    lifts.sort((a, b) => b.gapDays - a.gapDays || a.name.localeCompare(b.name));
    return { lifts, count: lifts.length };
  }

  const topW = sets => sets.length ? Math.max(...sets.map(s => s.w)) : null;
  function noteHtml(p, unit) {
    if (!p || !p.ramp) return "";
    unit = unit || "kg";
    return `<div class="br-note"><b>Back after ${p.gapDays} days</b> · ${pct(p.factor)} today: ${esc(p.sets.map(s => s.w + (s.r ? "×" + s.r : "")).join(", "))} ${esc(unit)} (session ${p.stage} of ${p.of})</div>`;
  }
  function cardHtml(res, unit) {
    if (!res || !res.lifts || !res.lifts.length) return "";
    unit = unit || "kg";
    const rows = res.lifts.map(l => `<li><span>${esc(l.name)}</span><b>${topW(l.sets)} ${esc(unit)}</b><small>${pct(l.factor)} · ${l.gapDays} days off · ${l.stage}/${l.of}</small></li>`).join("");
    return `<section class="card br-card"><h3>Go lighter today</h3><p class="br-muted">${res.count} lift${res.count === 1 ? "" : "s"} after a break. Ease back in: 90% then 95% of your old weights before adding load again. Same reps, clean form.</p><ul class="br-list">${rows}</ul></section>`;
  }
  const css = `.br-card h3{margin:0 0 4px}.br-muted{color:var(--muted);font-size:13px;margin:0 0 8px}
.br-list{list-style:none;margin:0;padding:0}.br-list li{display:grid;grid-template-columns:1fr auto;gap:0 10px;padding:6px 0;border-top:1px solid var(--line)}
.br-list li b{font-family:var(--mono);color:var(--accent)}.br-list li small{grid-column:1/3;color:var(--muted)}
.br-note{background:var(--sunk);border-left:3px solid var(--accent);border-radius:var(--r);padding:6px 10px;font-size:13px;margin:6px 0}`;

  return { TIERS, daysBetween, roundDown, plan, fromShell, fromLogger, analyzeShell, noteHtml, cardHtml, css };
})();
if (typeof module !== "undefined") module.exports = { BreakRamp };
