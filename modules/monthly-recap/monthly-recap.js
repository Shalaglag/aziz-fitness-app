/* Monthly recap card: one month of the cut on one card, savable as a PNG.
 *
 *   MonthlyRecap.compute(docs, opts) -> recap data (see README)
 *   MonthlyRecap.html(docs, opts)    -> the Progress-tab card (month nav, tiles, Save as image)
 *   MonthlyRecap.summary(recap)      -> plain-text summary for copy/paste
 *   MonthlyRecap.svg(recap, opts)    -> 1080×1080 share card as an SVG string
 *   MonthlyRecap.toPng(svg)          -> Promise<Blob> (browser only; canvas)
 *   MonthlyRecap.save(recap, opts)   -> renders the PNG and hands it to the downloads capability
 *   MonthlyRecap.months(docs, opts)  -> ["2026-10", ...] months that have any data, oldest first
 *
 * docs = the app's S.docs: weights, days, workouts, cardio, lb_workouts (optional).
 * opts: today (ISO), ym ("YYYY-MM", default = today's month), targets (AppTargets object or date => targets),
 *       sessionFor(date) -> session name, units / mainLifts (passed on to StrengthAnalytics),
 *       strength (StrengthAnalytics, default window.StrengthAnalytics), score (DailyScore, default window.DailyScore),
 *       start (ISO, the cut start; months before it are not offered), name (title on the image, optional).
 * Plain JS, no imports or network; protein target 160 g unless targets say otherwise. Never writes anything.
 */
const MonthlyRecap = (() => {
  const PRO = 160;
  const num = v => (v === "" || v == null || isNaN(+v) ? null : +v);
  const pad = n => String(n).padStart(2, "0");
  const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
  const localToday = () => { const d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
  const ymOf = iso => String(iso).slice(0, 7);
  const addDays = (iso, n) => { const [y, m, d] = iso.split("-").map(Number); const x = new Date(y, m - 1, d + n); return x.getFullYear() + "-" + pad(x.getMonth() + 1) + "-" + pad(x.getDate()); };
  const daysIn = ym => { const [y, m] = ym.split("-").map(Number); return new Date(y, m, 0).getDate(); };
  const addMonths = (ym, n) => { const [y, m] = ym.split("-").map(Number); const x = new Date(y, m - 1 + n, 1); return x.getFullYear() + "-" + pad(x.getMonth() + 1); };
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const label = ym => { const [y, m] = ym.split("-").map(Number); return MONTHS[m - 1] + " " + y; };
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt1 = n => (Math.round(n * 10) / 10).toFixed(1);
  const asList = c => Array.isArray(c) ? c : Object.values(c || {});
  const lbDate = w => { const d = new Date(w.start); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
  const hasSets = w => !!w && !!w.sets && Object.values(w.sets).some(a => Array.isArray(a) && a.some(s => s && (num(s.w) || num(s.r))));
  const G = typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : {});

  function targetsAt(opts, date) {
    const t = typeof opts.targets === "function" ? opts.targets(date) : opts.targets;
    return { pro: (t && num(t.proteinMin)) || PRO };
  }

  // Fallback PR finder when StrengthAnalytics is not around: Epley on workouts/{date}, kg assumed.
  function fallbackPRs(docs, from, to, today) {
    const e1 = (w, r) => (w > 0 && r > 0 ? (r === 1 ? w : w * (1 + r / 30)) : null);
    const rows = [];
    Object.entries(docs.workouts || {}).forEach(([k, w]) => {
      const date = isDate(w && w.date) ? w.date : k;
      if (!isDate(date) || date > today || !w || !w.sets) return;
      Object.entries(w.sets).forEach(([name, sets]) => {
        let top = null;
        (Array.isArray(sets) ? sets : []).forEach(s => { const v = s && e1(num(s.w) || 0, num(s.r) || 0); if (v != null && (!top || v > top)) top = v; });
        if (top != null) rows.push({ date, name: name.trim(), e1rm: top });
      });
    });
    rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const best = {}, prs = [];
    rows.forEach(r => {
      const k = r.name.toLowerCase();
      if (best[k] != null && r.e1rm > best[k] + 1e-9 && r.date >= from && r.date <= to) prs.push({ name: r.name, date: r.date, e1rm: r.e1rm, from: best[k] });
      if (best[k] == null || r.e1rm > best[k]) best[k] = r.e1rm;
    });
    return prs;
  }

  function prsFor(docs, from, to, opts) {
    const SA = opts.strength || G.StrengthAnalytics;
    if (SA && SA.analyze) {
      try {
        const a = SA.analyze(docs, { today: opts.today, units: opts.units, mainLifts: opts.mainLifts, weeks: 1 });
        const prs = [];
        (a.lifts || []).forEach(L => {
          let prev = null;
          (L.points || []).forEach(p => {
            if (p.pr && p.date >= from && p.date <= to) prs.push({ name: L.name, date: p.date, e1rm: p.e1rm, from: prev, main: !!L.main, unit: L.unit || "kg" });
            if (p.e1rm != null && (prev == null || p.e1rm > prev)) prev = p.e1rm;
          });
        });
        return prs;
      } catch (e) { /* fall through */ }
    }
    return fallbackPRs(docs, from, to, opts.today);
  }

  function months(docs, opts = {}) {
    docs = docs || {};
    const today = isDate(opts.today) ? opts.today : localToday();
    const set = new Set([ymOf(today)]);
    if (isDate(opts.start)) set.add(ymOf(opts.start));
    ["weights", "days", "workouts", "cardio"].forEach(c => Object.keys(docs[c] || {}).forEach(d => { if (isDate(d) && d <= today && (!isDate(opts.start) || d >= opts.start.slice(0, 7) + "-01")) set.add(ymOf(d)); }));
    asList(docs.lb_workouts).forEach(w => { if (w && w.end && w.start > 0) { const d = lbDate(w); if (d <= today) set.add(ymOf(d)); } });
    return [...set].filter(m => m <= ymOf(today)).sort();
  }

  function compute(docs, opts = {}) {
    docs = docs || {};
    const today = isDate(opts.today) ? opts.today : localToday();
    const ym = /^\d{4}-\d{2}$/.test(opts.ym || "") ? opts.ym : ymOf(today);
    const from = ym + "-01", monthEnd = ym + "-" + pad(daysIn(ym));
    const to = monthEnd < today ? monthEnd : today;        // never counts days that haven't happened
    const inMonth = d => isDate(d) && d >= from && d <= to;
    const complete = monthEnd < today;
    const daysSoFar = inMonth(to) ? +to.slice(8) : 0;

    // ---- weight ----
    const ws = Object.values(docs.weights || {}).filter(w => w && isDate(w.date) && num(w.kg) != null && w.date <= to).sort((a, b) => (a.date < b.date ? -1 : 1));
    const inside = ws.filter(w => w.date >= from);
    const before = ws.filter(w => w.date < from && w.date >= addDays(from, -7));
    const startW = before.length ? before[before.length - 1] : inside[0] || null;
    const endW = inside.length ? inside[inside.length - 1] : null;
    const weight = { n: inside.length, start: startW ? startW.kg : null, startDate: startW ? startW.date : null, end: endW ? endW.kg : null, endDate: endW ? endW.date : null, delta: startW && endW && endW.date > startW.date ? endW.kg - startW.kg : null };

    // ---- workouts ----
    const liftDays = new Set(); let sets = 0;
    asList(docs.lb_workouts).forEach(w => {
      if (!w || !w.end || !(w.start > 0) || !Array.isArray(w.exercises)) return;
      const d = lbDate(w); if (!inMonth(d)) return;
      let n = 0; w.exercises.forEach(e => (e && Array.isArray(e.sets) ? e.sets : []).forEach(s => { if (s && s.t !== "w" && s.done !== false && num(s.r) > 0) n++; }));
      if (n) { liftDays.add(d); sets += n; }
    });
    Object.entries(docs.workouts || {}).forEach(([k, w]) => {
      const d = isDate(w && w.date) ? w.date : k;
      if (!inMonth(d) || !hasSets(w) || liftDays.has(d)) return;
      liftDays.add(d);
      Object.values(w.sets).forEach(a => (Array.isArray(a) ? a : []).forEach(s => { if (s && (num(s.w) || num(s.r))) sets++; }));
    });
    const workouts = { count: liftDays.size, sets, dates: [...liftDays].sort() };

    // ---- cardio ----
    let cSessions = 0, cMin = 0, cKm = 0; const cDays = new Set();
    Object.entries(docs.cardio || {}).forEach(([k, c]) => {
      const d = isDate(c && c.date) ? c.date : k; if (!inMonth(d)) return;
      (Array.isArray(c.sessions) ? c.sessions : []).forEach(s => { if (!s) return; cSessions++; cDays.add(d); cMin += num(s.min) || 0; cKm += num(s.km) || 0; });
    });
    Object.entries(docs.days || {}).forEach(([k, day]) => {
      const d = isDate(day && day.date) ? day.date : k;
      if (inMonth(d) && day && day.treadmill && !cDays.has(d)) { cSessions++; cDays.add(d); }
    });
    const cardio = { sessions: cSessions, minutes: Math.round(cMin), km: Math.round(cKm * 10) / 10 };

    // ---- protein hit rate ----
    let logged = 0, hit = 0, proSum = 0;
    Object.entries(docs.days || {}).forEach(([k, day]) => {
      const d = isDate(day && day.date) ? day.date : k; if (!inMonth(d) || !day) return;
      const food = (day.food || []).filter(i => i && i.eaten); if (!food.length) return;
      const p = food.reduce((s, i) => s + (num(i.p) || 0), 0);
      logged++; proSum += p; if (p >= targetsAt(opts, d).pro) hit++;
    });
    const protein = { logged, hit, pct: logged ? Math.round(hit / logged * 100) : null, avg: logged ? Math.round(proSum / logged) : null, target: targetsAt(opts, to).pro };

    // ---- daily score: best streak of good days, average score ----
    const DS = opts.score || G.DailyScore;
    let best = 0, run = 0, scored = 0, scoreSum = 0, goodDays = 0, scoreOk = false;
    if (DS && DS.score) {
      scoreOk = true;
      for (let d = from; d <= to; d = addDays(d, 1)) {
        let s = null;
        try { s = DS.score(docs, d, { targets: opts.targets, session: opts.sessionFor ? opts.sessionFor(d) : undefined }); } catch (e) { s = null; }
        const good = !!(s && s.good);
        if (s && s.logged) { scored++; scoreSum += s.score; }
        if (good) { goodDays++; run++; if (run > best) best = run; }
        else if (d < today || (s && s.logged)) run = 0;     // an unfinished today never breaks the run
      }
    }
    const score = { available: scoreOk, bestStreak: best, currentStreak: run, goodDays, scoredDays: scored, avg: scored ? Math.round(scoreSum / scored) : null };

    // ---- PRs ----
    const prs = prsFor(docs, from, to, Object.assign({}, opts, { today }));
    prs.sort((a, b) => (b.main - a.main) || (b.e1rm - a.e1rm));

    const empty = !weight.n && !workouts.count && !cardio.sessions && !protein.logged && !prs.length;
    return { ym, label: label(ym), from, to, complete, daysSoFar, empty, weight, workouts, cardio, protein, score, prs, prCount: prs.length };
  }

  function summary(r) {
    const L = [r.label + (r.complete ? "" : " (so far)") + " recap"];
    if (r.weight.delta != null) L.push("Weight: " + fmt1(r.weight.start) + " → " + fmt1(r.weight.end) + " kg (" + (r.weight.delta <= 0 ? "−" : "+") + fmt1(Math.abs(r.weight.delta)) + " kg)");
    else if (r.weight.end != null) L.push("Weight: " + fmt1(r.weight.end) + " kg (one weigh-in)");
    L.push("Workouts: " + r.workouts.count + (r.workouts.sets ? " (" + r.workouts.sets + " sets)" : ""));
    if (r.cardio.sessions) L.push("Cardio: " + r.cardio.sessions + " sessions" + (r.cardio.minutes ? ", " + r.cardio.minutes + " min" : ""));
    L.push("PRs: " + r.prCount + (r.prs.length ? " (" + r.prs.slice(0, 3).map(p => p.name).join(", ") + ")" : ""));
    if (r.score.available) L.push("Best streak: " + r.score.bestStreak + " good day" + (r.score.bestStreak === 1 ? "" : "s") + (r.score.avg != null ? " · avg score " + r.score.avg : ""));
    L.push("Protein hit: " + (r.protein.pct == null ? "no food logged" : r.protein.hit + "/" + r.protein.logged + " days (" + r.protein.pct + "%)"));
    return L.join("\n");
  }

  const css = `
.mr-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.mr-nav{display:flex;align-items:center;gap:6px}
.mr-nav button{min-width:36px;padding:4px 8px}
.mr-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px}
@media(max-width:360px){.mr-grid{grid-template-columns:repeat(2,1fr)}}
.mr-tile{background:var(--sunk,#f3f3f3);border-radius:var(--r,12px);padding:10px 10px 8px;min-width:0}
.mr-tile .v{font-size:1.35rem;font-weight:700;line-height:1.15;font-variant-numeric:tabular-nums}
.mr-tile .v.good{color:var(--good,#1f8a4c)}.mr-tile .v.warn{color:var(--warn,#b36b00)}
.mr-tile .label{display:block;margin-top:2px}
.mr-prs{margin:10px 0 0;padding:0;list-style:none;font-size:.92rem}
.mr-prs li{display:flex;justify-content:space-between;gap:8px;padding:3px 0;border-top:1px solid var(--line,#e5e5e5)}
.mr-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.mr-preview{margin-top:10px}.mr-preview img{width:100%;border-radius:var(--r,12px);display:block}
`;

  function html(docs, opts = {}) {
    const today = isDate(opts.today) ? opts.today : localToday();
    const ms = months(docs, opts), ym = /^\d{4}-\d{2}$/.test(opts.ym || "") ? opts.ym : ymOf(today);
    const r = compute(docs, Object.assign({}, opts, { ym, today }));
    const i = ms.indexOf(ym), prev = i > 0 ? ms[i - 1] : (ms.length && ym > ms[0] ? addMonths(ym, -1) : null), next = ym < ymOf(today) ? addMonths(ym, 1) : null;
    const tile = (v, lab, cls) => `<div class="mr-tile"><div class="v num ${cls || ""}">${v}</div><span class="label">${lab}</span></div>`;
    const w = r.weight;
    const kg = w.delta != null ? (w.delta <= 0 ? "−" : "+") + fmt1(Math.abs(w.delta)) : "—";
    const tiles = [
      tile(kg, w.delta != null ? "kg " + (w.delta <= 0 ? "lost" : "gained") : w.end != null ? "kg: one weigh-in" : "kg: no weigh-ins", w.delta != null ? (w.delta <= 0 ? "good" : "warn") : ""),
      tile(r.workouts.count, r.workouts.count === 1 ? "workout" : "workouts" + (r.workouts.sets ? " · " + r.workouts.sets + " sets" : "")),
      tile(r.prCount, r.prCount === 1 ? "PR" : "PRs", r.prCount ? "good" : ""),
      tile(r.score.available ? r.score.bestStreak : "—", "best streak (good days)", r.score.bestStreak >= 7 ? "good" : ""),
      tile(r.protein.pct == null ? "—" : r.protein.pct + "%", r.protein.pct == null ? "protein: no food logged" : "protein hit · " + r.protein.hit + "/" + r.protein.logged + " days", r.protein.pct == null ? "" : r.protein.pct >= 80 ? "good" : r.protein.pct < 50 ? "warn" : ""),
      tile(r.cardio.sessions, "cardio" + (r.cardio.minutes ? " · " + r.cardio.minutes + " min" : "")),
    ].join("");
    const prs = r.prs.length ? `<ul class="mr-prs">${r.prs.slice(0, 4).map(p => `<li><span>${esc(p.name)}</span><span class="num">${p.from != null ? fmt1(p.from) + " → " : ""}${fmt1(p.e1rm)} ${esc(p.unit || "kg")} e1RM</span></li>`).join("")}${r.prs.length > 4 ? `<li class="muted">+${r.prs.length - 4} more</li>` : ""}</ul>` : "";
    const note = r.empty ? `<p class="muted">Nothing logged in ${esc(r.label)} yet.</p>` : r.complete ? "" : `<p class="muted" style="font-size:.9rem">Through ${esc(r.to.slice(8))} ${esc(MONTHS[+r.ym.slice(5) - 1])}. The card fills in as the month goes.</p>`;
    return `<div class="card mr" data-mr="${esc(ym)}">
  <div class="mr-head"><h3>Month recap</h3>
    <div class="mr-nav"><button type="button" data-mr-month="${prev || ""}" ${prev ? "" : "disabled"} aria-label="Previous month">‹</button><span class="label">${esc(r.label)}</span><button type="button" data-mr-month="${next || ""}" ${next ? "" : "disabled"} aria-label="Next month">›</button></div></div>
  <div class="mr-grid">${tiles}</div>${prs}${note}
  <div class="mr-actions"><button type="button" class="primary" data-mr-save="${esc(ym)}" ${r.empty ? "disabled" : ""}>Save as image</button><button type="button" data-mr-copy="${esc(ym)}" ${r.empty ? "disabled" : ""}>Copy summary</button></div>
  <div class="mr-preview" data-mr-preview hidden></div>
</div>`;
  }

  // ---- share image ----
  const W = 1080;
  function svg(r, opts = {}) {
    const c = Object.assign({ bg: "#111418", card: "#1b2028", ink: "#f4f6f8", muted: "#9aa4b2", accent: "#f0b429", good: "#4cc38a", warn: "#f59e0b" }, opts.colors || {});
    const font = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
    const w = r.weight, kg = w.delta != null ? (w.delta <= 0 ? "−" : "+") + fmt1(Math.abs(w.delta)) : "—";
    const tiles = [
      { v: kg, l: w.delta != null ? "kg " + (w.delta <= 0 ? "lost" : "gained") : "kg (no weigh-ins)", col: w.delta != null && w.delta <= 0 ? c.good : c.ink },
      { v: String(r.workouts.count), l: r.workouts.count === 1 ? "workout" : "workouts", col: c.ink },
      { v: String(r.prCount), l: r.prCount === 1 ? "personal record" : "personal records", col: r.prCount ? c.good : c.ink },
      { v: r.score.available ? String(r.score.bestStreak) : "—", l: "best streak (good days)", col: c.ink },
      { v: r.protein.pct == null ? "—" : r.protein.pct + "%", l: "protein target hit", col: r.protein.pct == null ? c.ink : r.protein.pct >= 80 ? c.good : r.protein.pct < 50 ? c.warn : c.ink },
      { v: String(r.cardio.sessions), l: r.cardio.minutes ? "cardio · " + r.cardio.minutes + " min" : "cardio sessions", col: c.ink },
    ];
    const TW = (W - 72 * 2 - 24 * 2) / 3, TH = 200, top = 300;
    const tileSvg = tiles.map((t, i) => {
      const x = 72 + (i % 3) * (TW + 24), y = top + Math.floor(i / 3) * (TH + 24);
      return `<rect x="${x}" y="${y}" width="${TW}" height="${TH}" rx="24" fill="${c.card}"/>
<text x="${x + 28}" y="${y + 108}" font-family="${font}" font-size="76" font-weight="700" fill="${t.col}">${esc(t.v)}</text>
<text x="${x + 28}" y="${y + 160}" font-family="${font}" font-size="26" fill="${c.muted}">${esc(t.l)}</text>`;
    }).join("\n");
    const prLines = r.prs.slice(0, 3).map((p, i) => `<text x="72" y="${800 + i * 46}" font-family="${font}" font-size="30" fill="${c.ink}">${esc(p.name)} <tspan fill="${c.muted}">· ${p.from != null ? fmt1(p.from) + " → " : ""}${fmt1(p.e1rm)} ${esc(p.unit || "kg")} e1RM</tspan></text>`).join("\n");
    const wline = w.start != null && w.end != null && w.delta != null ? `${fmt1(w.start)} → ${fmt1(w.end)} kg` : w.end != null ? `${fmt1(w.end)} kg` : "";
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}">
<rect width="${W}" height="${W}" fill="${c.bg}"/>
<rect x="72" y="96" width="72" height="12" rx="6" fill="${c.accent}"/>
<text x="72" y="190" font-family="${font}" font-size="80" font-weight="800" fill="${c.ink}">${esc(r.label)}</text>
<text x="72" y="246" font-family="${font}" font-size="30" fill="${c.muted}">${esc((opts.name ? opts.name + " · " : "") + (r.complete ? "Month recap" : "Month so far · through " + r.to.slice(8) + " " + MONTHS[+r.ym.slice(5) - 1]))}${wline ? esc(" · " + wline) : ""}</text>
${tileSvg}
${r.prs.length ? `<text x="72" y="760" font-family="${font}" font-size="26" font-weight="700" fill="${c.accent}" letter-spacing="2">NEW RECORDS</text>\n${prLines}` : `<text x="72" y="800" font-family="${font}" font-size="30" fill="${c.muted}">${esc(r.score.available && r.score.avg != null ? "Average day score " + r.score.avg + " / 100 · " + r.score.goodDays + " good days" : r.protein.logged ? "Average protein " + r.protein.avg + " g a day" : "Keep logging and this card fills in.")}</text>`}
<text x="72" y="${W - 72}" font-family="${font}" font-size="26" fill="${c.muted}">${esc(opts.footer || "Made with my cut tracker")}</text>
</svg>`;
  }

  function toPng(svgText, size = W) {
    return new Promise((resolve, reject) => {
      if (typeof document === "undefined") return reject(new Error("No DOM"));
      const img = new Image();
      img.onload = () => {
        try {
          const cv = document.createElement("canvas"); cv.width = size; cv.height = size;
          cv.getContext("2d").drawImage(img, 0, 0, size, size);
          cv.toBlob(b => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
        } catch (e) { reject(e); }
      };
      img.onerror = () => reject(new Error("SVG did not render"));
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgText);
    });
  }

  // Returns {saved:true} when the downloads capability took the file, else {saved:false, blob, url} so the
  // caller can show the image inline (long-press to save on a phone). opts.downloads = the capability.
  async function save(r, opts = {}) {
    const blob = await toPng(svg(r, opts));
    const filename = "recap-" + r.ym + ".png";
    let dl = opts.downloads;
    if (dl === undefined && G.claude && G.claude.use) dl = await G.claude.use("downloads").catch(() => null);
    if (dl && dl.save) {
      try { await dl.save({ filename, data: blob }); return { saved: true, filename, blob }; }
      catch (e) { if (e && e.code === "cancelled") return { saved: false, cancelled: true, filename, blob }; }
    }
    const url = typeof URL !== "undefined" && URL.createObjectURL ? URL.createObjectURL(blob) : null;
    return { saved: false, filename, blob, url };
  }

  return { compute, html, summary, svg, toPng, save, months, css, PRO };
})();
if (typeof module !== "undefined" && module.exports) module.exports = MonthlyRecap;
