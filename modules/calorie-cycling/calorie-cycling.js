/* Calorie cycling: eat more on lifting days, less on rest days, same weekly total.
 * Plain JS, no imports, no network. Generic: every number comes from the AppTargets object
 * and the saved state; nothing about one person is built in.
 *
 * State (host stores it at prefs/main.cycling):  {on, delta, trainDays:[weekday 0-6]}
 *   on        -> false by default: the target stays flat until the person turns it on
 *   delta     -> kcal added on a training day (default 150, step 50, 50-400)
 *   trainDays -> weekdays that lift (default Sun-Thu + Sat = everything but Friday)
 *
 * API
 *   CalorieCycling.css
 *   CalorieCycling.defaults(opts)                 -> a fresh state
 *   CalorieCycling.normalize(state, opts)         -> state with every field valid
 *   CalorieCycling.plan(targets, state, opts)     -> {on, base, weekKcal, nTrain, nRest, delta, restDelta,
 *                                                     trainKcal, restKcal, trainCarbs:[lo,hi], restCarbs:[lo,hi],
 *                                                     trainDays, restDays, clamped, reason}
 *   CalorieCycling.isTraining(date, state, opts)  -> true | false  (opts.training(date) may answer first)
 *   CalorieCycling.target(targets, date, state, opts) -> {kcal, kind:"train"|"rest"|"flat", delta, carbsLo, carbsHi}
 *   CalorieCycling.apply(state, action, opts)     -> new state; actions from data-cc-action:
 *                                                     on | off | more | less | day:<0-6>
 *   CalorieCycling.html(targets, state, opts)     -> card HTML ("" when targets.kcal is unknown)
 *
 * The rule: the week keeps the same calories. Training days get +delta, rest days give it back
 * (delta * nTrain / nRest). Protein and fat never move; carbs carry the whole swing (4 kcal/g).
 * A rest day never drops more than MAX_REST_DROP below the base target: delta is clamped so the
 * week still balances, and the card says so.
 */
const CalorieCycling = (() => {
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const DEFAULT_DELTA = 150, STEP = 50, MIN_DELTA = 50, MAX_DELTA = 400, MAX_REST_DROP = 300;
  const DEFAULT_TRAIN = [0, 1, 2, 3, 4, 6];

  const css = `
.cc .ccdays{display:flex;flex-wrap:wrap;gap:6px}
.cc .ccdays .chip{min-width:3.2em;text-align:center;padding:5px 0}
.cc .ccrow{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.cc .ccnum{font-variant-numeric:tabular-nums;font-weight:600}
.cc table td.n,.cc table th.n{text-align:right}
`;

  function weekday(date) {
    if (typeof date === "number") return ((date % 7) + 7) % 7;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date || ""));
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3]).getDay();
  }

  function defaults(opts = {}) {
    const td = Array.isArray(opts.trainDays) && opts.trainDays.length ? opts.trainDays : DEFAULT_TRAIN;
    return { on: false, delta: DEFAULT_DELTA, trainDays: cleanDays(td) };
  }
  function cleanDays(list) {
    return [...new Set((list || []).map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))].sort((a, b) => a - b);
  }
  function normalize(state, opts = {}) {
    const d = defaults(opts), s = Object.assign({}, state || {});
    const out = { on: !!s.on, delta: d.delta, trainDays: d.trainDays };
    const delta = Math.round(+s.delta);
    if (Number.isFinite(delta)) out.delta = Math.min(MAX_DELTA, Math.max(MIN_DELTA, Math.round(delta / STEP) * STEP));
    if (Array.isArray(s.trainDays)) out.trainDays = cleanDays(s.trainDays);
    return out;
  }

  function plan(targets, state, opts = {}) {
    const st = normalize(state, opts);
    const base = targets && targets.kcal != null && Number.isFinite(+targets.kcal) && +targets.kcal > 0 ? Math.round(+targets.kcal) : null;
    const nTrain = st.trainDays.length, nRest = 7 - nTrain;
    const restDays = [0, 1, 2, 3, 4, 5, 6].filter(d => !st.trainDays.includes(d));
    const out = { on: st.on, base, weekKcal: base === null ? null : base * 7, nTrain, nRest, delta: st.delta, restDelta: 0,
      trainKcal: base, restKcal: base, trainCarbs: null, restCarbs: null, trainDays: st.trainDays, restDays, clamped: false, reason: null };
    if (base === null) { out.reason = "no-target"; return out; }
    if (nRest === 0 || nTrain === 0) { out.reason = nRest === 0 ? "no-rest-days" : "no-train-days"; out.delta = 0; return out; }
    let delta = st.delta;
    // Rest days give back delta * nTrain / nRest. Keep that under MAX_REST_DROP.
    const maxDelta = Math.floor(MAX_REST_DROP * nRest / nTrain / STEP) * STEP;
    if (delta > maxDelta) { delta = Math.max(MIN_DELTA, maxDelta); out.clamped = true; }
    const restDelta = Math.round(delta * nTrain / nRest);
    out.delta = delta; out.restDelta = restDelta;
    out.trainKcal = base + delta; out.restKcal = base - restDelta;
    // Fix rounding so the week really sums to base*7.
    const diff = base * 7 - (out.trainKcal * nTrain + out.restKcal * nRest);
    if (diff) out.restKcal += Math.round(diff / nRest);
    const cLo = Number.isFinite(+targets.carbsLo) ? +targets.carbsLo : null, cHi = Number.isFinite(+targets.carbsHi) ? +targets.carbsHi : null;
    if (cLo !== null && cHi !== null) {
      out.trainCarbs = [Math.round(cLo + delta / 4), Math.round(cHi + delta / 4)];
      out.restCarbs = [Math.max(0, Math.round(cLo - restDelta / 4)), Math.max(0, Math.round(cHi - restDelta / 4))];
    }
    return out;
  }

  function isTraining(date, state, opts = {}) {
    if (typeof opts.training === "function") { try { const v = opts.training(date); if (v === true || v === false) return v; } catch (e) {} }
    const wd = weekday(date);
    return wd === null ? false : normalize(state, opts).trainDays.includes(wd);
  }

  function target(targets, date, state, opts = {}) {
    const p = plan(targets, state, opts);
    const flat = { kcal: p.base, kind: "flat", delta: 0, carbsLo: targets && targets.carbsLo != null ? +targets.carbsLo : null, carbsHi: targets && targets.carbsHi != null ? +targets.carbsHi : null };
    if (!p.on || p.base === null || p.reason) return flat;
    const train = isTraining(date, state, opts);
    const carbs = train ? p.trainCarbs : p.restCarbs;
    return { kcal: train ? p.trainKcal : p.restKcal, kind: train ? "train" : "rest", delta: train ? p.delta : -p.restDelta,
      carbsLo: carbs ? carbs[0] : flat.carbsLo, carbsHi: carbs ? carbs[1] : flat.carbsHi };
  }

  function apply(state, action, opts = {}) {
    const st = normalize(state, opts);
    const a = String(action || "");
    if (a === "on") st.on = true;
    else if (a === "off") st.on = false;
    else if (a === "more") st.delta = Math.min(MAX_DELTA, st.delta + STEP);
    else if (a === "less") st.delta = Math.max(MIN_DELTA, st.delta - STEP);
    else if (/^day:[0-6]$/.test(a)) { const d = +a.slice(4); st.trainDays = st.trainDays.includes(d) ? st.trainDays.filter(x => x !== d) : cleanDays(st.trainDays.concat(d)); }
    return st;
  }

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const n = v => Math.round(v).toLocaleString("en-US");

  function html(targets, state, opts = {}) {
    const p = plan(targets, state, opts);
    if (p.base === null) return "";
    const st = normalize(state, opts);
    const days = DAYS.map((lab, i) => `<button type="button" class="chip${st.trainDays.includes(i) ? "" : " rest"}" aria-pressed="${st.trainDays.includes(i)}" data-cc-action="day:${i}" title="${st.trainDays.includes(i) ? "Lift day" : "Rest day"}">${lab}</button>`).join("");
    let body;
    if (p.reason === "no-rest-days") body = `<p class="muted">Every day is a lift day, so there is nothing to shift. Mark at least one rest day.</p>`;
    else if (p.reason === "no-train-days") body = `<p class="muted">Mark the days you lift to move calories onto them.</p>`;
    else {
      const carbs = (c, base) => c ? `${c[0]}–${c[1]} g` : base ? `${base[0]}–${base[1]} g` : "—";
      const baseC = targets.carbsLo != null && targets.carbsHi != null ? [targets.carbsLo, targets.carbsHi] : null;
      body = `
      <div class="tablewrap"><table><thead><tr><th></th><th class="n">Days</th><th class="n">kcal</th><th class="n">Carbs</th></tr></thead><tbody>
        <tr><td>Lift day</td><td class="n">${p.nTrain}</td><td class="n ccnum">${n(p.trainKcal)}</td><td class="n">${carbs(p.trainCarbs, baseC)}</td></tr>
        <tr><td>Rest day</td><td class="n">${p.nRest}</td><td class="n ccnum">${n(p.restKcal)}</td><td class="n">${carbs(p.restCarbs, baseC)}</td></tr>
        <tr><td class="muted">Week</td><td class="n muted">7</td><td class="n muted">${n(p.weekKcal)} (same as ${n(p.base)} × 7)</td><td class="n muted">protein and fat unchanged</td></tr>
      </tbody></table></div>
      ${p.clamped ? `<p class="note" style="font-size:.85rem">Capped at +${p.delta} so a rest day never drops more than ${MAX_REST_DROP} kcal below ${n(p.base)}.</p>` : ""}`;
    }
    return `<div class="card cc" data-cc>
      <div class="spread"><h3>Eat more on lift days</h3><span class="pill ${p.on ? "good" : "info"}">${p.on ? "On" : "Off"}</span></div>
      <p class="muted" style="font-size:.9rem">Same calories for the week, more carbs around training, less on rest days. Weekly weight loss does not change; energy in the gym does.</p>
      <div class="ccrow"><span class="label">Extra on a lift day</span>
        <button type="button" class="btn small ghost" data-cc-action="less" aria-label="Less" ${st.delta <= MIN_DELTA ? "disabled" : ""}>−</button>
        <span class="ccnum">+${st.delta} kcal</span>
        <button type="button" class="btn small ghost" data-cc-action="more" aria-label="More" ${st.delta >= MAX_DELTA ? "disabled" : ""}>+</button>
      </div>
      <div><span class="label">Lift days</span><div class="ccdays" style="margin-top:6px">${days}</div></div>
      ${body}
      <div class="row">${p.on
        ? `<button type="button" class="btn ghost" data-cc-action="off">Turn off (flat ${n(p.base)} every day)</button>`
        : `<button type="button" class="btn" data-cc-action="on" ${p.reason ? "disabled" : ""}>Turn on</button>`}</div>
    </div>`;
  }

  return { css, DAYS, STEP, MIN_DELTA, MAX_DELTA, MAX_REST_DROP, defaults, normalize, plan, isTraining, target, apply, html, weekday };
})();

if (typeof module !== "undefined") module.exports = { CalorieCycling };
