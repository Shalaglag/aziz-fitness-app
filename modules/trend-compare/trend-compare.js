/* Compare any two trends on one chart (MacroFactor-style overlay) for the Aziz Cut Tracker.
 * Plain JS, no imports, no network. Reads the app's own collections:
 *   docs = { weights: {date:{kg}}, days: {date:{food:[{kcal,p,eaten}], steps, sleep}}, cardio: {date:{sessions:[{min}]}},
 *            workouts: {date:{sets:{"<exercise>":[{w,r}]}}} }
 * API:
 *   TrendCompare.css                         -> string, inject once (uses the app's tokens)
 *   TrendCompare.series(docs, opts)          -> [{key, label, unit, points:[{date, v}]}] every series that can be drawn
 *   TrendCompare.correlate(a, b, opts)       -> {n, r, strength, dir, note} for two series (same-day pairs, Pearson r)
 *   TrendCompare.chart(a, b, opts)           -> SVG string, A on the left axis, B on the right axis
 *   TrendCompare.html(docs, opts)            -> HTML string: one card for the Progress tab (self-wires its pickers)
 *   TrendCompare.summary(docs, opts)         -> plain-text line for the coach / a chat
 * opts: today (ISO), trend ([{date,trend}] from TrendTDEE.series; otherwise an EWMA 0.1 is computed here),
 *       lifts ([{name,key,unit,points:[{date,e1rm}]}] from StrengthAnalytics.analyze; otherwise Epley on workouts/{date}),
 *       a / b (series keys), range (days, 14|28|90|0 = all). Picks persist in prefs when opts.onPick is given.
 * The correlation is descriptive only: same-day pairs, at least 7 of them, and the note says it is not cause.
 */
const TrendCompare = (() => {
  const DAY = 864e5, ALPHA = 0.1, MIN_PAIRS = 7, RANGES = [14, 28, 90, 0];
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const ms = s => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  const iso = t => new Date(t).toISOString().slice(0, 10);
  const add = (s, n) => iso(ms(s) + n * DAY);
  const diff = (a, b) => Math.round((ms(b) - ms(a)) / DAY);
  const short = s => { const d = new Date(ms(s)); return MON[d.getUTCMonth()] + " " + d.getUTCDate(); };
  const localToday = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const num = v => { const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v; return typeof n === "number" && isFinite(n) ? n : null; };
  const isDate = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const keyOf = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const fmtV = (v, unit) => unit === "kg" || unit === "h" ? (Math.round(v * 10) / 10).toFixed(1) : Math.round(v).toLocaleString("en-US");

  const byDate = (coll, pick) => Object.entries(coll || {})
    .map(([k, doc]) => ({ date: isDate(doc && doc.date) ? doc.date : k, v: doc ? pick(doc) : null }))
    .filter(p => isDate(p.date) && p.v != null && isFinite(p.v))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  function ewma(weights) { // same rule as TrendTDEE.series: interpolate gaps, EWMA 0.1, flat after the last weigh-in
    const w = byDate(weights, d => { const k = num(d.kg); return k > 20 && k < 400 ? k : null; });
    const out = []; let t = null;
    for (let i = 0; i < w.length; i++) {
      const a = w[i], b = w[i + 1];
      for (let d = a.date; !b ? d === a.date : d < b.date; d = add(d, 1)) {
        const fill = d === a.date || !b ? a.v : a.v + (b.v - a.v) * diff(a.date, d) / diff(a.date, b.date);
        t = t == null ? fill : t + ALPHA * (fill - t);
        out.push({ date: d, v: Math.round(t * 100) / 100 });
      }
    }
    return out;
  }

  const eaten = day => ((day && day.food) || []).filter(i => i && i.eaten);
  const stepCount = day => { const s = day && day.steps; return typeof s === "number" ? s : s && num(s.count) || 0; };
  const e1rm = (kg, r) => (!(kg > 0) || !(r >= 1) || r > 20) ? null : r === 1 ? kg : kg * (1 + r / 30);

  function liftsFromWorkouts(workouts) {
    const by = {};
    Object.entries(workouts || {}).forEach(([k, w]) => {
      const date = isDate(w && w.date) ? w.date : k;
      if (!isDate(date) || !w || !w.sets) return;
      Object.entries(w.sets).forEach(([name, sets]) => {
        let top = null;
        (sets || []).forEach(s => { const v = e1rm(num(s && s.w), num(s && s.r)); if (v != null && (top == null || v > top)) top = v; });
        if (top == null) return;
        const key = keyOf(name);
        (by[key] = by[key] || { name: String(name).trim(), key, unit: "kg", points: [] }).points.push({ date, e1rm: top });
      });
    });
    return Object.values(by).map(l => { l.points.sort((a, b) => (a.date < b.date ? -1 : 1)); return l; });
  }

  function series(docs, opts = {}) {
    docs = docs || {};
    const today = isDate(opts.today) ? opts.today : localToday();
    const cut = pts => pts.filter(p => p.date <= today);
    const trend = Array.isArray(opts.trend) ? opts.trend.map(p => ({ date: p.date, v: num(p.trend) })).filter(p => isDate(p.date) && p.v != null) : ewma(docs.weights);
    const out = [
      { key: "trend", label: "Trend weight", unit: "kg", points: cut(trend) },
      { key: "weight", label: "Scale weight", unit: "kg", points: cut(byDate(docs.weights, d => { const k = num(d.kg); return k > 20 && k < 400 ? k : null; })) },
      { key: "kcal", label: "Calories eaten", unit: "kcal", points: cut(byDate(docs.days, d => { const f = eaten(d); return f.length ? f.reduce((s, i) => s + (num(i.kcal) || 0), 0) : null; })) },
      { key: "protein", label: "Protein eaten", unit: "g", points: cut(byDate(docs.days, d => { const f = eaten(d); return f.length ? f.reduce((s, i) => s + (num(i.p) || 0), 0) : null; })) },
      { key: "steps", label: "Steps", unit: "steps", points: cut(byDate(docs.days, d => stepCount(d) > 0 ? stepCount(d) : null)) },
      { key: "sleep", label: "Sleep", unit: "h", points: cut(byDate(docs.days, d => { const h = num(d.sleep); return h > 0 ? h : null; })) },
      { key: "cardio", label: "Cardio minutes", unit: "min", points: cut(byDate(docs.cardio, d => { const m = (d.sessions || []).reduce((s, x) => s + (num(x && x.min) || 0), 0); return m > 0 ? m : null; })) },
    ];
    const lifts = Array.isArray(opts.lifts) ? opts.lifts : liftsFromWorkouts(docs.workouts);
    lifts.forEach(l => {
      if (!l || !Array.isArray(l.points)) return;
      const pts = cut(l.points.map(p => ({ date: p.date, v: num(p.e1rm) })).filter(p => isDate(p.date) && p.v != null));
      if (pts.length) out.push({ key: "lift:" + (l.key || keyOf(l.name)), label: "Est. 1RM · " + String(l.name || l.key), unit: l.unit === "lb" ? "lb" : "kg", points: pts, lift: true });
    });
    return out;
  }

  function window_(s, today, range) {
    if (!range) return s.points;
    const from = add(today, -(range - 1));
    return s.points.filter(p => p.date >= from);
  }

  function correlate(a, b, opts = {}) {
    const today = isDate(opts.today) ? opts.today : localToday();
    const pa = window_(a, today, opts.range || 0), pb = window_(b, today, opts.range || 0);
    const mb = new Map(pb.map(p => [p.date, p.v]));
    const pairs = pa.filter(p => mb.has(p.date)).map(p => [p.v, mb.get(p.date)]);
    const n = pairs.length;
    if (n < MIN_PAIRS) return { n, r: null, strength: "none", dir: null, note: n ? "Only " + n + " day" + (n === 1 ? "" : "s") + " with both logged. " + MIN_PAIRS + " are needed for a correlation." : "No days where both were logged yet." };
    const mx = pairs.reduce((s, p) => s + p[0], 0) / n, my = pairs.reduce((s, p) => s + p[1], 0) / n;
    let sxy = 0, sxx = 0, syy = 0;
    pairs.forEach(([x, y]) => { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; });
    if (!sxx || !syy) return { n, r: null, strength: "none", dir: null, note: "One of the two didn't change over these " + n + " days, so there is nothing to correlate." };
    const r = Math.round(sxy / Math.sqrt(sxx * syy) * 100) / 100;
    const ar = Math.abs(r);
    const strength = ar < 0.2 ? "none" : ar < 0.4 ? "weak" : ar < 0.7 ? "moderate" : "strong";
    const dir = r > 0 ? "same" : "opposite";
    const la = a.label.toLowerCase(), lb = b.label.toLowerCase();
    const rs = "r = " + (r < 0 ? "−" : "") + ar.toFixed(2);
    const note = strength === "none"
      ? "Over " + n + " shared days, " + la + " and " + lb + " moved independently (" + rs + ")."
      : "Over " + n + " shared days, higher " + la + " went with " + (dir === "same" ? "higher " : "lower ") + lb + " (" + rs + ", " + strength + "). Same-day link only, not cause: a change in one is often days away from a change in the other.";
    return { n, r, strength, dir, note };
  }

  function ticks(lo, hi) {
    if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
    const raw = (hi - lo) / 4, p = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * p).find(s => s >= raw);
    const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step, out = [];
    for (let v = a; v <= b + step / 2; v += step) out.push(Math.round(v * 1000) / 1000);
    return { lo: a, hi: b, vals: out };
  }

  function chart(a, b, opts = {}) {
    const today = isDate(opts.today) ? opts.today : localToday();
    const range = opts.range || 0;
    const pa = window_(a, today, range), pb = window_(b, today, range);
    if (!pa.length && !pb.length) return '<p class="muted tc-small">Nothing logged in this range for either series.</p>';
    const all = pa.concat(pb);
    const first = range ? add(today, -(range - 1)) : all.reduce((m, p) => (p.date < m ? p.date : m), all[0].date);
    const last = range ? today : all.reduce((m, p) => (p.date > m ? p.date : m), all[0].date);
    const span = Math.max(6, diff(first, last));
    const W = 640, H = 240, L = 48, R = 48, T = 14, B = 28;
    const x = d => L + diff(first, d) / span * (W - L - R);
    const scale = pts => { if (!pts.length) return null; const vs = pts.map(p => p.v); const t = ticks(Math.min(...vs), Math.max(...vs)); return { t, y: v => T + (t.hi - v) / (t.hi - t.lo) * (H - T - B) }; };
    const sa = scale(pa), sb = scale(pb);
    const line = (pts, sc, cls) => {
      if (!sc) return "";
      const pp = pts.map(p => x(p.date).toFixed(1) + "," + sc.y(p.v).toFixed(1));
      const sparse = pts.length < 3 || diff(pts[0].date, pts[pts.length - 1].date) / pts.length > 1.5;
      return (pts.length > 1 ? '<polyline class="' + cls + '" points="' + pp.join(" ") + '"/>' : "") +
        (sparse || pts.length < 20 ? pts.map(p => '<circle class="' + cls + '" cx="' + x(p.date).toFixed(1) + '" cy="' + sc.y(p.v).toFixed(1) + '" r="3"/>').join("") : "") +
        '<circle class="' + cls + ' tc-last" cx="' + x(pts[pts.length - 1].date).toFixed(1) + '" cy="' + sc.y(pts[pts.length - 1].v).toFixed(1) + '" r="4.5"/>';
    };
    const axis = (sc, side) => !sc ? "" : sc.t.vals.map(v => (side === "l" ? '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + sc.y(v).toFixed(1) + '" y2="' + sc.y(v).toFixed(1) + '" class="tc-grid"/>' : "") +
      '<text x="' + (side === "l" ? L - 6 : W - R + 6) + '" y="' + (sc.y(v) + 4).toFixed(1) + '" text-anchor="' + (side === "l" ? "end" : "start") + '" class="tc-tick tc-tick-' + side + '">' + fmtV(v, (side === "l" ? a : b).unit) + "</text>").join("");
    return '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(a.label) + " and " + esc(b.label) + ' over time">' +
      axis(sa, "l") + axis(sb, "r") +
      '<text x="' + L + '" y="' + (H - 8) + '" class="tc-date">' + short(first) + '</text><text x="' + (W - R) + '" y="' + (H - 8) + '" text-anchor="end" class="tc-date">' + short(last) + "</text>" +
      line(pa, sa, "tc-a") + line(pb, sb, "tc-b") + "</svg>";
  }

  const pickOr = (list, key, fallback) => list.find(s => s.key === key && s.points.length) || list.find(s => s.key === fallback && s.points.length) || list.find(s => s.points.length) || list[0];

  function resolve(docs, opts) {
    const list = series(docs, opts);
    const a = pickOr(list, opts.a || PICK.a, "trend");
    let b = pickOr(list, opts.b || PICK.b, "steps");
    if (b === a) b = list.find(s => s !== a && s.points.length) || b;
    const range = RANGES.includes(+opts.range) ? +opts.range : RANGES.includes(PICK.range) ? PICK.range : 28;
    return { list, a, b, range, today: isDate(opts.today) ? opts.today : localToday() };
  }

  function body(R) {
    const { list, a, b, range, today } = R;
    const c = correlate(a, b, { today, range });
    const opt = (s, cur) => '<option value="' + esc(s.key) + '"' + (s === cur ? " selected" : "") + (s.points.length ? "" : " disabled") + ">" + esc(s.label) + (s.points.length ? "" : " (nothing logged)") + "</option>";
    const group = (cur) => { const plain = list.filter(s => !s.lift), lifts = list.filter(s => s.lift); return plain.map(s => opt(s, cur)).join("") + (lifts.length ? '<optgroup label="Lifts (est. 1RM)">' + lifts.map(s => opt(s, cur)).join("") + "</optgroup>" : ""); };
    const lastOf = s => { const p = window_(s, today, range); return p.length ? fmtV(p[p.length - 1].v, s.unit) + " " + s.unit + " · " + short(p[p.length - 1].date) : "nothing in range"; };
    return '<div class="tc-pick">' +
      '<label class="tc-sel tc-sel-a"><span class="tc-sw tc-sw-a"></span><select data-tc="a" aria-label="First series">' + group(a) + "</select></label>" +
      '<label class="tc-sel tc-sel-b"><span class="tc-sw tc-sw-b"></span><select data-tc="b" aria-label="Second series">' + group(b) + "</select></label>" +
      '<select data-tc="range" aria-label="Range">' + RANGES.map(r => '<option value="' + r + '"' + (r === range ? " selected" : "") + ">" + (r ? "Last " + r + " days" : "All time") + "</option>").join("") + "</select></div>" +
      '<div class="tc-legend"><span><i class="tc-sw tc-sw-a"></i>' + esc(a.label) + ' <b class="tc-mono">' + lastOf(a) + '</b></span><span><i class="tc-sw tc-sw-b"></i>' + esc(b.label) + ' <b class="tc-mono">' + lastOf(b) + "</b></span></div>" +
      '<div class="chart tc-chart">' + chart(a, b, { today, range }) + "</div>" +
      '<p class="tc-note ' + (c.r == null ? "muted" : "tc-" + c.strength) + '">' + esc(c.note) + "</p>";
  }

  let PICK = { a: null, b: null, range: 28 }, LAST = null, bound = false;
  function bind() {
    if (bound || typeof document === "undefined") return;
    bound = true;
    document.addEventListener("change", ev => {
      const sel = ev.target && ev.target.closest && ev.target.closest("[data-tc]");
      if (!sel || !LAST) return;
      const card = sel.closest(".tc-card"); if (!card) return;
      const k = sel.dataset.tc;
      PICK[k] = k === "range" ? +sel.value : sel.value;
      const R = resolve(LAST.docs, Object.assign({}, LAST.opts, { a: PICK.a, b: PICK.b, range: PICK.range }));
      PICK.a = R.a.key; PICK.b = R.b.key; PICK.range = R.range;
      const box = card.querySelector(".tc-body"); if (box) box.innerHTML = body(R);
      if (typeof LAST.opts.onPick === "function") { try { LAST.opts.onPick(Object.assign({}, PICK)); } catch (e) {} }
    });
  }

  function html(docs, opts = {}) {
    if (opts.pick && !PICK.a) PICK = Object.assign({}, PICK, opts.pick);
    const R = resolve(docs, opts);
    LAST = { docs, opts }; bind();
    PICK.a = R.a.key; PICK.b = R.b.key; PICK.range = R.range;
    const logged = R.list.filter(s => s.points.length).length;
    const head = '<div class="spread"><h2>Compare trends</h2><span class="label">' + logged + " series available</span></div>";
    if (logged < 2) return '<section class="card tc-card">' + head + '<p class="muted">Log weigh-ins plus one more thing (food, steps, sleep, cardio or a workout) and you can overlay any two here.</p></section>';
    return '<section class="card tc-card">' + head + '<div class="tc-body">' + body(R) + "</div>" +
      '<p class="muted tc-small">Left axis is the first series, right axis the second. Each axis is scaled to its own range so shapes line up; read the numbers off the sides.</p></section>';
  }

  function summary(docs, opts = {}) {
    const R = resolve(docs, opts);
    const c = correlate(R.a, R.b, { today: R.today, range: R.range });
    return "Compare: " + R.a.label + " vs " + R.b.label + " (" + (R.range ? "last " + R.range + " days" : "all time") + "). " + c.note;
  }

  const css = [
    ".tc-pick{display:flex;flex-wrap:wrap;gap:8px;align-items:center}",
    ".tc-sel{display:flex;align-items:center;gap:6px;flex:1 1 180px;min-width:0}.tc-sel select{flex:1;min-width:0}",
    ".tc-sw{display:inline-block;width:12px;height:12px;border-radius:3px;flex:none}.tc-sw-a{background:var(--accent)}.tc-sw-b{background:var(--protein)}",
    ".tc-legend{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:.88rem}.tc-legend span{display:flex;align-items:center;gap:6px}.tc-mono{font-family:var(--mono);font-weight:600}",
    ".tc-chart svg{width:100%;height:auto;display:block}",
    ".tc-grid{stroke:var(--line);stroke-width:1}.tc-tick{font-size:11px;font-family:var(--mono);fill:var(--muted)}.tc-tick-l{fill:var(--accent)}.tc-tick-r{fill:var(--protein)}.tc-date{font-size:11px;fill:var(--muted)}",
    "polyline.tc-a{fill:none;stroke:var(--accent);stroke-width:2.5;stroke-linejoin:round}polyline.tc-b{fill:none;stroke:var(--protein);stroke-width:2.5;stroke-linejoin:round}",
    "circle.tc-a{fill:var(--accent)}circle.tc-b{fill:var(--protein)}circle.tc-last{stroke:var(--surface);stroke-width:2}",
    ".tc-note{margin:0;font-size:.9rem}.tc-moderate,.tc-strong{font-weight:600}.tc-small{font-size:.82rem;margin:0}",
  ].join("\n");

  return { css, series, correlate, chart, html, summary, RANGES, MIN_PAIRS };
})();
if (typeof window !== "undefined") window.TrendCompare = TrendCompare;
if (typeof module !== "undefined" && module.exports) module.exports = TrendCompare;
