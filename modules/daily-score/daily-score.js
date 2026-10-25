/* Daily score and streak for the Aziz Cut Tracker.
 * Plain JS, no imports, no network. Reads the app's own collections:
 *   docs = { days: {date: {food:[{kcal,p,eaten}], water, waterh:{ml}, supps:{creatine,omega,d3,mag}, treadmill, sleep}},
 *            workouts: {date: {session, sets:{name:[{w,r}]}, treadmill}} }
 * One score out of 100 per day, from six parts:
 *   Protein 25 (≥160 g eaten, partial from 120 g) · Calories 20 (1,850–2,150 eaten, partial to ±300; Friday free day skipped)
 *   Water 15 (3.5 L training days, 3 L otherwise) · Training 15 (sets logged 10 + treadmill 5; rest days and Fridays full marks)
 *   Supplements 10 (2.5 each) · Sleep 15 (≥7 h, partial from 5 h)
 * Sleep is optional: the app has no sleep input yet, so until days/{date}.sleep (hours slept the night before) is set,
 * that part is left out and the score is scaled from the other parts. Everything else counts as 0 when not logged.
 * A good day scores 80 or more with no part at zero (so skipping a lift or all supplements can't still pass). The streak counts good days in a row; today only joins once it reaches 80,
 * so an unfinished today never breaks it.
 * API:
 *   DailyScore.css                                -> string, inject once (uses the app's tokens)
 * opts.targets (optional, every call): an AppTargets object or date => targets; replaces 160 g / 1,850–2,150.
 *   DailyScore.score(docs, date, {session})       -> {date, score, good, logged, parts:[{key,label,got,max,ok,detail}]}
 *   DailyScore.streak(docs, today, {sessionFor})  -> {current, best, todayGood, last7:[{date,score,good}]}
 *   DailyScore.html(docs, date, {today, sessionFor}) -> HTML string for a card on the Today tab
 * session / sessionFor(date) is the planned session name (the app's sessionFor(d).session) so a rotation Rest day
 * without a workout doc still counts as rest. Without it, workouts/{date}.session is used.
 */
const DailyScore = (() => {
  const START = "2026-10-25", GOOD = 80;
  const PRO = 160, PRO_FLOOR = 120, KCAL_LO = 1850, KCAL_HI = 2150, KCAL_SLACK = 300;
  const WATER_TRAIN = 3500, WATER_REST = 3000, SLEEP_OK = 7, SLEEP_FLOOR = 5;
  const SUPPS = ["creatine", "omega", "d3", "mag"];
  const DAY = 864e5, WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const ms = s => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  const iso = t => new Date(t).toISOString().slice(0, 10);
  const add = (s, n) => iso(ms(s) + n * DAY);
  const wday = s => new Date(ms(s)).getUTCDay();
  const localToday = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const num = v => { const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v; return typeof n === "number" && isFinite(n) ? n : null; };
  const clamp01 = x => Math.max(0, Math.min(1, x));
  const ramp = (v, lo, hi) => clamp01((v - lo) / (hi - lo));
  const fint = n => Math.round(n).toLocaleString("en-US");
  // opts.targets: an AppTargets object, or date => targets (diet-break days differ). Plan numbers otherwise.
  function limits(opts, date) {
    const t = typeof opts.targets === "function" ? opts.targets(date) : opts.targets;
    const pro = t && num(t.proteinMin), lo = t && num(t.kcalLo), hi = t && num(t.kcalHi);
    return { pro: pro || PRO, proFloor: pro ? Math.round(pro * 0.75) : PRO_FLOOR, lo: lo && hi ? lo : KCAL_LO, hi: lo && hi ? hi : KCAL_HI };
  }
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function score(docs, date, opts = {}) {
    const day = (docs.days && docs.days[date]) || {};
    const wk = (docs.workouts && docs.workouts[date]) || {};
    const food = (day.food || []).filter(i => i && i.eaten);
    const kcal = food.reduce((s, i) => s + (num(i.kcal) || 0), 0);
    const p = food.reduce((s, i) => s + (num(i.p) || 0), 0);
    const friday = wday(date) === 5;
    const session = opts.session || wk.session || null;
    const training = !friday && session !== "Rest";
    const water = (num(day.water) || 0) + ((day.waterh && num(day.waterh.ml)) || 0);
    const waterGoal = training ? WATER_TRAIN : WATER_REST;
    const lifted = Object.values(wk.sets || {}).some(a => (a || []).some(x => x && (num(x.w) || num(x.r))));
    const tread = !!(day.treadmill || wk.treadmill);
    const supps = SUPPS.filter(k => day.supps && day.supps[k]).length;
    const sleep = num(day.sleep);
    const L = limits(opts, date);
    const parts = [];
    const part = (key, label, max, frac, detail) => parts.push({ key, label, max, got: Math.round(max * frac * 10) / 10, ok: frac >= 1, detail });

    part("protein", "Protein", 25, food.length ? ramp(p, L.proFloor, L.pro) : 0, food.length ? Math.round(p) + " / " + L.pro + " g" : "No food ticked as eaten");
    if (!friday) {
      const off = kcal < L.lo ? L.lo - kcal : kcal > L.hi ? kcal - L.hi : 0;
      part("kcal", "Calories", 20, food.length ? clamp01(1 - off / KCAL_SLACK) : 0, food.length ? fint(kcal) + " kcal (" + fint(L.lo) + "–" + fint(L.hi) + ")" : "No food ticked as eaten");
    }
    part("water", "Water", 15, clamp01(water / waterGoal), (water / 1000).toFixed(1) + " / " + waterGoal / 1000 + " L");
    if (training) part("training", "Training + treadmill", 15, (lifted ? 10 : 0) / 15 + (tread ? 5 : 0) / 15,
      (lifted ? "Lifted" : "No sets logged") + " · " + (tread ? "treadmill done" : "no treadmill"));
    else part("training", "Training", 15, 1, friday ? "Friday free day" : "Rest day");
    part("supps", "Supplements", 10, supps / SUPPS.length, supps + " of " + SUPPS.length);
    if (sleep != null) part("sleep", "Sleep", 15, ramp(sleep, SLEEP_FLOOR, SLEEP_OK), sleep + " h (7+)");

    const got = parts.reduce((s, x) => s + x.got, 0), max = parts.reduce((s, x) => s + x.max, 0);
    const pct = max ? Math.round(got / max * 100) : 0;
    const logged = food.length > 0 || water > 0 || lifted || tread || supps > 0 || sleep != null;
    return { date, score: logged ? pct : 0, good: logged && pct >= GOOD && parts.every(x => x.got > 0), logged, sleepLogged: sleep != null, parts };
  }

  function streak(docs, today, opts = {}) {
    today = today || localToday();
    const sc = d => score(docs, d, { session: opts.sessionFor ? opts.sessionFor(d) : undefined, targets: opts.targets });
    const todayGood = today >= START && sc(today).good;
    let current = 0;
    for (let d = todayGood ? today : add(today, -1); d >= START && sc(d).good; d = add(d, -1)) current++;
    let best = 0, run = 0;
    for (let d = START; d <= today; d = add(d, 1)) { if (sc(d).good) best = Math.max(best, ++run); else run = 0; }
    const last7 = [];
    for (let i = 6; i >= 0; i--) { const d = add(today, -i); const s = sc(d); last7.push({ date: d, score: s.score, good: s.good, logged: s.logged, future: d < START }); }
    return { current, best, todayGood, last7 };
  }

  function html(docs, date, opts = {}) {
    const today = opts.today || localToday();
    const s = score(docs, date, { session: opts.sessionFor ? opts.sessionFor(date) : undefined, targets: opts.targets });
    const st = streak(docs, date < today ? date : today, opts);
    const tone = s.good ? "good" : s.score >= 60 ? "warn" : "bad";
    const ring = (() => {
      const r = 34, c = 2 * Math.PI * r, f = s.score / 100;
      return '<svg class="ds-ring" viewBox="0 0 80 80" role="img" aria-label="Daily score ' + s.score + ' out of 100">' +
        '<circle cx="40" cy="40" r="' + r + '" class="ds-track"/>' +
        '<circle cx="40" cy="40" r="' + r + '" class="ds-fill ds-' + tone + '" stroke-dasharray="' + (c * f).toFixed(1) + ' ' + c.toFixed(1) + '" transform="rotate(-90 40 40)"/>' +
        '<text x="40" y="46" text-anchor="middle" class="ds-num">' + s.score + '</text></svg>';
    })();
    const rows = s.parts.map(x => '<li class="' + (x.ok ? "ok" : "") + '"><span class="ds-lab">' + esc(x.label) + '</span><span class="ds-det">' + esc(x.detail) + '</span><span class="ds-pts">' + (Math.round(x.got * 10) / 10) + '<small>/' + x.max + '</small></span></li>').join("");
    const dots = st.last7.filter(d => !d.future).map(d => '<span class="ds-dot' + (d.good ? " good" : d.logged ? " part" : "") + '" title="' + d.date + ": " + (d.future ? "before the plan" : d.score) + '">' + WD[wday(d.date)][0] + '</span>').join("");
    const streakLine = st.current
      ? st.current + (st.current === 1 ? " good day" : " good days in a row") + (st.todayGood || date < today ? "" : ". Hit 80 today to make it " + (st.current + 1) + ".")
      : (date === today ? "Hit 80 today to start a streak." : "No streak on this day.");
    return '<div class="card ds-card"><div class="spread"><h3>Daily score</h3><span class="muted ds-small">Good day = 80+, nothing skipped</span></div>' +
      '<div class="ds-top">' + ring + '<div><p class="ds-streak"><b>' + streakLine + '</b></p><p class="muted ds-small">Best streak ' + st.best + ' · last 7 days</p><div class="ds-dots">' + dots + '</div></div></div>' +
      '<ul class="ds-parts">' + rows + '</ul>' +
      (date === today && !s.good ? '<p class="muted ds-small">So far today. Food counts once it’s ticked as eaten.</p>' : "") +
      (s.sleepLogged ? "" : '<p class="muted ds-small">Sleep isn’t logged, so the score is out of the other parts.</p>') + '</div>';
  }

  const css = `
.ds-card .ds-top{display:flex;gap:16px;align-items:center;margin:8px 0}
.ds-ring{width:84px;height:84px;flex:none}
.ds-track{fill:none;stroke:var(--sunk);stroke-width:8}
.ds-fill{fill:none;stroke-width:8;stroke-linecap:round;transition:stroke-dasharray .6s}
.ds-fill.ds-good{stroke:var(--good)}.ds-fill.ds-warn{stroke:var(--warn)}.ds-fill.ds-bad{stroke:var(--bad)}
.ds-num{font-family:var(--display);font-size:24px;font-weight:700;fill:var(--ink)}
.ds-streak{margin:0}.ds-small{font-size:.82rem}
.ds-dots{display:flex;gap:6px;margin-top:6px}
.ds-dot{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;font-size:.7rem;font-family:var(--mono);background:var(--sunk);color:var(--muted)}
.ds-dot.part{background:color-mix(in srgb,var(--warn) 30%,var(--sunk));color:var(--ink)}
.ds-dot.good{background:var(--good);color:var(--surface)}
.ds-parts{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}
.ds-parts li{display:grid;grid-template-columns:7.5rem 1fr auto;gap:8px;align-items:baseline;padding:6px 0;border-top:1px solid var(--line);font-size:.9rem}
.ds-lab{font-weight:600}.ds-det{color:var(--muted);font-size:.84rem}
.ds-pts{font-family:var(--mono);color:var(--muted)}.ds-parts li.ok .ds-pts{color:var(--good)}
@media (max-width:420px){.ds-parts li{grid-template-columns:1fr auto}.ds-det{grid-column:1/-1;grid-row:2}}
`;

  return { score, streak, html, css, GOOD, START };
})();
if (typeof module !== "undefined") module.exports = DailyScore;
