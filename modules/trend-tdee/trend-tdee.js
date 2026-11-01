/* Trend weight + adaptive calorie burn (TDEE) for the Aziz Cut Tracker.
 * Plain JS, no imports, no network. Reads the app's own collections:
 *   docs = { days: {date: {food:[{kcal,eaten,est,...}]}}, weights: {date: {kg}} }
 * API:
 *   TrendTDEE.css                            -> string, inject once (uses the app's tokens)
 *   TrendTDEE.series(weights, {today})       -> [{date, kg|null, trend}] one row per calendar day
 *   TrendTDEE.estimate(docs, {today})        -> numbers for the card (see estimate() below)
 *   TrendTDEE.html(docs, {today})            -> HTML string: one card for the Progress tab
 *   TrendTDEE.summary(docs, {today})         -> plain-text summary to paste into a chat
 * Trend: EWMA, alpha 0.1 (Hacker's Diet). Gaps between weigh-ins are filled by straight-line
 * interpolation before smoothing; after the last weigh-in the trend holds flat.
 * Burn: average eaten kcal on logged days minus the weight slope × 7,700 kcal/kg. The slope is a
 * least-squares fit on raw weigh-ins over the last 28 days (min 14), ending yesterday so a
 * half-logged today never counts. Only food marked eaten is counted.
 */
const TrendTDEE = (() => {
  const START = "2026-10-25", REVIEW = "2026-11-07";
  // Plan defaults; opts.kcal (the cut target), opts.floor (lowest calories ever suggested) and opts.review override them.
  const KCAL_DEFAULT = 2000, FLOOR_DEFAULT = 1800;
  let KCAL = KCAL_DEFAULT, FLOOR = FLOOR_DEFAULT, REVIEW_AT = REVIEW;
  const posNum = v => typeof v === "number" && isFinite(v) && v > 0 ? v : null;
  const ALPHA = 0.1, KCAL_PER_KG = 7700, MIN_DAYS = 14, MAX_DAYS = 28, MIN_FOOD = 10, MIN_WEIGH = 8;
  const PACE_LO = 0.5, PACE_HI = 0.8; // kg per week, the plan band
  const DAY = 864e5, MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const ms = s => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  const iso = t => new Date(t).toISOString().slice(0, 10);
  const add = (s, n) => iso(ms(s) + n * DAY);
  const diff = (a, b) => Math.round((ms(b) - ms(a)) / DAY);
  const short = s => { const d = new Date(ms(s)); return MON[d.getUTCMonth()] + " " + d.getUTCDate(); };
  const localToday = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const num = v => { const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v; return typeof n === "number" && isFinite(n) ? n : null; };
  const isDate = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const f1 = n => (Math.round(n * 10) / 10).toFixed(1);
  const fint = n => Math.round(n).toLocaleString("en-US");
  const r50 = n => Math.round(n / 50) * 50;
  const sgn = (n, d = 1) => (n > 0 ? "+" : n < 0 ? "−" : "±") + Math.abs(n).toFixed(d);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function weighIns(weights) {
    return Object.entries(weights || {})
      .map(([k, w]) => ({ date: isDate(w && w.date) ? w.date : k, kg: num(w && w.kg) }))
      .filter(w => isDate(w.date) && w.kg != null && w.kg > 20 && w.kg < 400)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  function series(weights, opts = {}) {
    const w = weighIns(weights).filter(x => !isDate(opts.today) || x.date <= opts.today);
    if (!w.length) return [];
    const last = w[w.length - 1].date, end = isDate(opts.today) && opts.today > last ? opts.today : last;
    const by = {}; w.forEach(x => { by[x.date] = x.kg; });
    const out = [];
    let trend = w[0].kg, j = 0;
    for (let d = w[0].date; d <= end; d = add(d, 1)) {
      while (j < w.length - 1 && w[j + 1].date <= d) j++;
      let fill = null;
      if (d <= last) {
        const a = w[j], b = w[j + 1];
        fill = a.date === d || !b ? a.kg : a.kg + (b.kg - a.kg) * diff(a.date, d) / diff(a.date, b.date);
        trend = d === w[0].date ? fill : trend + ALPHA * (fill - trend);
      }
      out.push({ date: d, kg: d in by ? by[d] : null, trend: Math.round(trend * 100) / 100 });
    }
    return out;
  }

  function fit(points) { // least squares kg ~ day; returns slope (kg/day) and its standard error
    const n = points.length, mx = points.reduce((s, p) => s + p.x, 0) / n, my = points.reduce((s, p) => s + p.y, 0) / n;
    let sxx = 0, sxy = 0;
    points.forEach(p => { sxx += (p.x - mx) ** 2; sxy += (p.x - mx) * (p.y - my); });
    if (!sxx) return null;
    const slope = sxy / sxx, b = my - slope * mx;
    const ssr = points.reduce((s, p) => s + (p.y - (b + slope * p.x)) ** 2, 0);
    return { slope, se: n > 2 ? Math.sqrt(ssr / (n - 2) / sxx) : Infinity };
  }

  function eaten(docs, date) {
    const food = ((docs.days && docs.days[date] && docs.days[date].food) || []).filter(i => i && i.eaten);
    return food.length ? { kcal: food.reduce((s, i) => s + (num(i.kcal) || 0), 0), est: food.some(i => i.est) } : null;
  }

  /* Returns {
   *   today, from, to, days, ready, status: "empty"|"building"|"ready",
   *   trendNow, trendDelta7 (kg vs 7 days ago, null if no data), weighIns, foodDays, estDays,
   *   intakeAvg, rateKgWk, tdee, tdeeLo, tdeeHi, suggest: {lo, hi, keep} | null,
   *   readyOn (first date with enough days), reviewOpen (today > Nov 7), notes: [string]
   * } */
  function estimate(docs, opts = {}) {
    docs = docs || {};
    KCAL = posNum(opts.kcal) || KCAL_DEFAULT; FLOOR = posNum(opts.floor) || FLOOR_DEFAULT; REVIEW_AT = isDate(opts.review) ? opts.review : REVIEW;
    const today = isDate(opts.today) ? opts.today : localToday();
    const ser = series(docs.weights, { today });
    const at = d => { const r = ser.find(x => x.date === d); return r ? r.trend : null; };
    const trendNow = ser.length ? ser[ser.length - 1].trend : null;
    const wk = at(add(today, -7));
    const to = add(today, -1);
    const from = add(to, -(MAX_DAYS - 1)) < START ? START : add(to, -(MAX_DAYS - 1));
    const days = Math.max(0, diff(from, to) + 1);
    const R = {
      today, from, to, days, trendNow, trendDelta7: trendNow != null && wk != null ? trendNow - wk : null,
      weighIns: 0, foodDays: 0, estDays: 0, intakeAvg: null, rateKgWk: null, tdee: null, tdeeLo: null, tdeeHi: null,
      suggest: null, readyOn: add(START, MIN_DAYS), reviewOpen: today > REVIEW_AT, notes: [], ready: false, status: "empty",
    };
    if (!ser.length) return R;
    R.status = "building";
    const pts = [];
    let kcal = 0;
    for (let d = from; days && d <= to; d = add(d, 1)) {
      const w = docs.weights && docs.weights[d], kg = num(w && w.kg);
      if (kg != null && kg > 20 && kg < 400) pts.push({ x: diff(from, d), y: kg });
      const e = eaten(docs, d);
      if (e) { R.foodDays++; kcal += e.kcal; if (e.est) R.estDays++; }
    }
    R.weighIns = pts.length;
    if (R.foodDays) R.intakeAvg = kcal / R.foodDays;
    if (days < MIN_DAYS || R.foodDays < MIN_FOOD || R.weighIns < MIN_WEIGH) {
      const need = [];
      if (days < MIN_DAYS) need.push((MIN_DAYS - days) + " more day" + (MIN_DAYS - days === 1 ? "" : "s"));
      if (R.foodDays < MIN_FOOD) need.push("at least " + MIN_FOOD + " days of food logged (" + R.foodDays + " so far)");
      if (R.weighIns < MIN_WEIGH) need.push("at least " + MIN_WEIGH + " weigh-ins (" + R.weighIns + " so far)");
      R.notes.push("Needs " + need.join(", ") + ".");
      return R;
    }
    const f = fit(pts);
    if (!f || R.intakeAvg == null) return R;
    R.ready = true; R.status = "ready";
    R.rateKgWk = f.slope * 7;
    R.tdee = R.intakeAvg - f.slope * KCAL_PER_KG;
    const band = Math.min(600, f.se * KCAL_PER_KG);
    R.tdeeLo = R.tdee - band; R.tdeeHi = R.tdee + band;
    const lo = Math.max(FLOOR, r50(R.tdee - PACE_HI * KCAL_PER_KG / 7)), hi = Math.max(FLOOR, r50(R.tdee - PACE_LO * KCAL_PER_KG / 7));
    R.suggest = { lo, hi, keep: KCAL >= lo && KCAL <= hi };
    const missing = days - R.foodDays;
    if (missing) R.notes.push(missing + " day" + (missing === 1 ? "" : "s") + " without food logged " + (missing === 1 ? "was" : "were") + " left out. If those were bigger days (Fridays), real burn is a little lower than shown.");
    if (R.estDays) R.notes.push(R.estDays + " logged day" + (R.estDays === 1 ? " includes" : "s include") + " estimated items.");
    if (from <= add(START, 6)) R.notes.push("Includes the first week of the cut, when water and glycogen drop fast, so burn may read high. It settles as more weeks come in.");
    if (band >= 300) R.notes.push("Weigh-ins are noisy over this window, so the range is wide. More days will narrow it.");
    return R;
  }

  // ---------- rendering ----------
  const stat = (lab, v, sub) => '<div class="tt-stat"><span class="label">' + lab + '</span><span class="v">' + v + '</span><span class="tt-sub">' + sub + '</span></div>';

  function chartSvg(ser, from) {
    const rows = ser.filter(r => r.date >= from);
    const vals = rows.flatMap(r => (r.kg != null ? [r.kg, r.trend] : [r.trend]));
    if (rows.length < 2) return "";
    let lo = Math.floor((Math.min(...vals) - 0.2) * 2) / 2, hi = Math.ceil((Math.max(...vals) + 0.2) * 2) / 2;
    if (hi - lo < 1.5) { const m = (hi + lo) / 2; lo = Math.floor((m - 0.75) * 2) / 2; hi = lo + 1.5; }
    const W = 480, H = 200, L = 40, R = 8, T = 10, B = 26, n = rows.length;
    const x = i => L + (W - L - R) * (n === 1 ? 0.5 : i / (n - 1)), y = v => T + (H - T - B) * (hi - v) / (hi - lo);
    let g = "";
    const step = hi - lo > 3 ? 1 : 0.5;
    for (let v = lo; v <= hi + 1e-9; v += step) g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--line)"/><text x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + v.toFixed(1) + '</text>';
    [0, Math.floor((n - 1) / 2), n - 1].forEach((i, k, a) => { if (a.indexOf(i) === k) g += '<text x="' + x(i) + '" y="' + (H - 8) + '" text-anchor="' + (k === 0 ? "start" : k === 2 ? "end" : "middle") + '">' + short(rows[i].date) + '</text>'; });
    rows.forEach((r, i) => { if (r.kg != null) g += '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(r.kg).toFixed(1) + '" r="3.5" fill="var(--muted)" opacity=".7"><title>' + short(r.date) + ": " + f1(r.kg) + ' kg weighed</title></circle>'; });
    g += '<path d="' + rows.map((r, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(r.trend).toFixed(1)).join("") + '" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round"/>';
    const lr = rows[n - 1];
    g += '<circle cx="' + x(n - 1) + '" cy="' + y(lr.trend) + '" r="5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"><title>Trend ' + f1(lr.trend) + ' kg</title></circle>';
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Daily weigh-ins as dots with the smoothed trend weight as a line">' + g + '</svg>';
  }

  function verdict(E) {
    if (!E.ready) return "";
    const s = E.suggest;
    if (!E.reviewOpen) return "Hold " + fint(KCAL) + " until the " + short(REVIEW_AT) + " review. If it were today: " + (s.keep ? "keep " + fint(KCAL) + "." : "aim for " + fint(s.lo) + "–" + fint(s.hi) + " kcal.");
    if (s.keep) return fint(KCAL) + " kcal sits inside the " + fint(s.lo) + "–" + fint(s.hi) + " range for 0.5–0.8 kg a week. Keep it.";
    if (KCAL > s.hi) return "At " + fint(KCAL) + " you're losing slower than 0.5 kg a week. Move to " + fint(s.hi) + " kcal (range " + fint(s.lo) + "–" + fint(s.hi) + ").";
    return "At " + fint(KCAL) + " you're losing faster than 0.8 kg a week. You can eat up to " + fint(s.lo) + "–" + fint(s.hi) + " kcal and protect strength.";
  }

  function html(docs, opts) {
    const E = estimate(docs, opts), ser = series(docs && docs.weights, { today: E.today });
    const head = '<div class="spread"><h2>Trend weight and burn</h2><span class="label">' + (E.ready ? short(E.from) + " – " + short(E.to) : "Learning") + '</span></div>';
    if (E.status === "empty") return '<div class="card tt">' + head + '<p class="muted">Log a morning weigh-in on Today to start the trend.</p></div>';
    const trend = '<div class="tt-stats">' +
      stat("Trend weight", f1(E.trendNow) + ' <small>kg</small>', E.trendDelta7 != null ? sgn(E.trendDelta7) + " kg vs 7 days ago" : "smoothed from daily weigh-ins") +
      stat("Calorie burn", E.ready ? fint(r50(E.tdee)) + ' <small>kcal</small>' : "—", E.ready ? "likely " + fint(r50(E.tdeeLo)) + "–" + fint(r50(E.tdeeHi)) : "ready from " + short(E.readyOn)) +
      stat("Pace", E.ready ? sgn(E.rateKgWk, 2) + ' <small>kg/wk</small>' : "—", E.ready ? "eating " + fint(E.intakeAvg) + " kcal a day" : E.foodDays + " food days, " + E.weighIns + " weigh-ins") +
      '</div>';
    const chart = '<div class="tt-chart">' + chartSvg(ser, E.ready ? E.from : START) + '</div>';
    const v = verdict(E);
    const review = v ? '<p class="tt-verdict"><span class="tt-pill ' + (E.suggest.keep ? "good" : "warn") + '">' + (E.reviewOpen ? "Calorie review" : "Nov 7 preview") + '</span> ' + esc(v) + '</p>' : "";
    const notes = E.notes.length ? '<ul class="tt-notes">' + E.notes.map(t => '<li>' + esc(t) + '</li>').join("") + '</ul>' : "";
    return '<div class="card tt">' + head + trend + chart + review + notes +
      '<p class="tt-small">Dots are weigh-ins, the line is the trend. Burn = what you ate minus what the scale says, at 7,700 kcal per kg.</p></div>';
  }

  function summary(docs, opts) {
    const E = estimate(docs, opts), out = ["Trend weight and calorie burn (" + short(E.today) + ")"];
    if (E.status === "empty") return out.concat("No weigh-ins yet.").join("\n");
    out.push("Trend weight: " + f1(E.trendNow) + " kg" + (E.trendDelta7 != null ? " (" + sgn(E.trendDelta7) + " kg vs 7 days ago)" : ""));
    if (!E.ready) return out.concat("Burn estimate: not ready. " + E.notes.join(" ")).join("\n");
    out.push("Window: " + short(E.from) + "–" + short(E.to) + " (" + E.days + " days, " + E.foodDays + " with food logged, " + E.weighIns + " weigh-ins)");
    out.push("Eaten: " + fint(E.intakeAvg) + " kcal/day. Pace: " + sgn(E.rateKgWk, 2) + " kg/week.");
    out.push("Estimated burn: " + fint(r50(E.tdee)) + " kcal/day (likely " + fint(r50(E.tdeeLo)) + "–" + fint(r50(E.tdeeHi)) + ")");
    out.push(verdict(E));
    E.notes.forEach(n => out.push("Note: " + n));
    return out.join("\n");
  }

  const css = [
    ".tt-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px}",
    ".tt-stat{display:flex;flex-direction:column;gap:2px}.tt-stat .v{font-family:var(--display);font-size:1.8rem;font-weight:700;line-height:1.05}",
    ".tt-stat .v small{font-size:1rem;color:var(--muted)}.tt-sub,.tt-small{font-size:.85rem;color:var(--muted)}",
    ".tt-chart svg{display:block;width:100%;height:auto;overflow:visible}.tt-chart text{fill:var(--muted);font-family:var(--body);font-size:13px}",
    ".tt-verdict{margin:0;line-height:1.45}",
    ".tt-pill{display:inline-block;border-radius:999px;padding:2px 10px;font-size:.78rem;font-weight:600;border:1px solid currentColor;white-space:nowrap;margin-right:4px}",
    ".tt-pill.good{color:var(--good)}.tt-pill.warn{color:var(--warn)}",
    ".tt-notes{margin:0;padding-left:18px;font-size:.85rem;color:var(--muted);display:flex;flex-direction:column;gap:4px}",
  ].join("\n");

  return { css, series, estimate, html, summary, START, REVIEW };
})();
if (typeof module !== "undefined" && module.exports) module.exports = TrendTDEE;
