/* Friends: friends & family, step leaderboard, comparisons and private challenges for Mizan.
 *
 * Every person has their own Firebase account (modules/cloud-store). This module adds a few
 * top-level Firestore collections next to users/{uid} (see firestore.rules):
 *   profiles/{uid}            display name + avatar (owner writes; any signed-in person may `get` one)
 *   invites/{code}            invite code -> {uid, name, avatar}; `get` only, never listed
 *   requests/{from_to}        friend request (sender creates, either side deletes)
 *   friends/{a_b}             accepted friendship (a < b); created by the recipient of a request
 *   shares/{uid}              exactly what the owner chose to share; readable only by accepted friends
 *   challenges/{id}           private challenge; readable by the invited, joined by adding yourself
 *   challenges/{id}/entries/{uid}  a member's own numbers for that challenge's window
 *
 * Pure functions (buildShare, leaderboard, compare, challengeProgress, …) have no DOM or network and
 * are tested in friends.test.js. `mount()` wires Firestore listeners; `screenHTML()` draws the screen;
 * `handle(el, ctx)` runs the taps. Nothing is shared until the person turns a category on.
 */
const Friends = (() => {
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const n0 = n => Math.round(+n || 0).toLocaleString("en-US");
  const pad = n => String(n).padStart(2, "0");
  const iso = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const parse = s => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
  const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const DAYS_KEPT = 35;          // days of history in a share doc (enough for "this month")
  const STALE_H = 36;            // hours after which a friend's steps count as stale
  const AVATARS = ["🙂", "😎", "🦁", "🐯", "🦅", "🐺", "🦊", "🐻", "🏋️", "🏃", "🚴", "🧗", "⚡", "🔥", "🌙", "⭐"];
  const COLORS = ["#e2654f", "#2f6fd6", "#2a9d5c", "#c98a16", "#7a4fd1", "#1f9aa8", "#d13f8a", "#5c6b7a"];

  // What a person can share, each off by default. `key` is the field in shares/{uid}.
  const CATS = [
    { key: "steps", label: "Steps", sub: "Daily count and your step goal (Health Connect or typed)" },
    { key: "workouts", label: "Workouts", sub: "Which days you trained and your weekly goal, never the sets" },
    { key: "water", label: "Water", sub: "Progress toward your own water goal" },
    { key: "cardio", label: "Cardio", sub: "Minutes and distance per day" },
    { key: "strength", label: "Strength", sub: "Best set per exercise (kg), so the same lift can be compared" },
    { key: "nutrition", label: "Nutrition goals", sub: "Only whether you hit your calorie and protein targets, never meals" },
    { key: "weight", label: "Weight progress", sub: "Change over 30 days as kg or %, never your actual weight" }
  ];
  const CH_TYPES = [
    { key: "steps_total", label: "Most steps", unit: "steps", sub: "Whoever walks the most wins", target: false },
    { key: "steps_goal_days", label: "Most goal days", unit: "days", sub: "Days on which you reached your own step goal", target: false },
    { key: "workouts", label: "Workouts", unit: "workouts", sub: "First to log the chosen number of workouts, or the most", target: true },
    { key: "group_steps", label: "Team steps", unit: "steps", sub: "Everyone's steps add up toward one shared goal", target: true },
    { key: "active_days", label: "Active days", unit: "days", sub: "Days with a workout or your step goal met, aiming for a chosen number", target: true }
  ];

  const pairId = (a, b) => [a, b].sort().join("_");
  const reqId = (from, to) => from + "_" + to;
  function newCode(rnd = Math.random) {
    const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let s = "";
    for (let i = 0; i < 6; i++) s += A[Math.floor(rnd() * A.length) % A.length];
    return s.slice(0, 3) + "-" + s.slice(3);
  }
  const cleanCode = s => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^(.{3})(.{3})$/, "$1-$2");
  const colorFor = uid => COLORS[[...String(uid || "")].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
  const initials = name => String(name || "?").trim().split(/\s+/).slice(0, 2).map(w => w[0] || "").join("").toUpperCase() || "?";
  function avatarHTML(p, size) {
    const a = p && p.avatar, bg = colorFor(p && p.uid), cls = "fr-av" + (size === "lg" ? " lg" : "");
    return a && a !== "initials" ? `<span class="${cls}" style="background:${bg}22">${esc(a)}</span>` : `<span class="${cls}" style="background:${bg};color:#fff">${esc(initials(p && p.name))}</span>`;
  }
  function defaultSharing() { const o = {}; CATS.forEach(c => { o[c.key] = false; }); return o; }
  const stepCount = day => { const s = day && day.steps; return typeof s === "number" ? s : s && typeof s.count === "number" ? s.count : 0; };

  /* ---------- share doc: built from local data, only the categories switched on ---------- */
  // ctx: {today, getDay, docs:{days, weights, workouts, lb_workouts, lb_exercises, cardio}, stepGoal, waterGoal(date), kcalTarget(date), proteinMin, weekGoal}
  function buildShare(profile, sharing, ctx) {
    const today = ctx.today, from = addDays(today, -(DAYS_KEPT - 1));
    const dates = []; for (let d = from; d <= today; d = addDays(d, 1)) dates.push(d);
    const days = dates.map(d => [d, ctx.getDay ? ctx.getDay(d) : (ctx.docs.days[d] || {})]);
    const on = k => !!(sharing && sharing[k]);
    const share = { uid: profile.uid, name: profile.name || "Someone", avatar: profile.avatar || "initials", updatedAt: ctx.now || Date.now(), cats: {} };
    CATS.forEach(c => { share.cats[c.key] = on(c.key); });
    if (on("steps")) {
      const map = {}; let at = 0, source = null;
      days.forEach(([d, day]) => { const n = stepCount(day); if (n > 0) { map[d] = n; const s = day.steps; if (s && typeof s === "object" && s.at) { const t = Date.parse(s.at); if (t > at) { at = t; source = s.source || null; } } } });
      share.steps = { goal: ctx.stepGoal || 10000, days: map, at: at || null, source, connected: !!ctx.stepsConnected };
    }
    if (on("workouts")) {
      const set = new Set();
      Object.values(ctx.docs.lb_workouts || {}).forEach(w => { if (w && w.end && w.start) { const d = iso(new Date(w.start)); if (d >= from && d <= today) set.add(d); } });
      Object.entries(ctx.docs.workouts || {}).forEach(([d, w]) => { if (d >= from && d <= today && w && w.sets && Object.values(w.sets).some(a => Array.isArray(a) && a.some(s => s && (s.w || s.r)))) set.add(d); });
      share.workouts = { weekGoal: ctx.weekGoal || 4, dates: [...set].sort() };
    }
    if (on("water")) {
      const map = {}, goals = {};
      days.forEach(([d, day]) => { const ml = ctx.totalWater ? ctx.totalWater(day) : (day.water || 0); if (ml > 0) { map[d] = Math.round(ml); goals[d] = ctx.waterGoal ? ctx.waterGoal(d) : 3000; } });
      share.water = { goal: ctx.waterGoal ? ctx.waterGoal(today) : 3000, days: map, goals };
    }
    if (on("cardio")) {
      const map = {};
      Object.entries(ctx.docs.cardio || {}).forEach(([d, doc]) => { if (d < from || d > today) return; const ss = Array.isArray(doc && doc.sessions) ? doc.sessions.filter(s => s && +s.min > 0) : []; if (!ss.length) return; map[d] = { min: Math.round(ss.reduce((a, s) => a + (+s.min || 0), 0)), km: Math.round(ss.reduce((a, s) => a + (+s.km || 0), 0) * 10) / 10 }; });
      share.cardio = { days: map };
    }
    if (on("strength")) {
      const ex = {}, exNames = ctx.docs.lb_exercises || {}, since = Date.parse(addDays(today, -90) + "T00:00:00");
      Object.values(ctx.docs.lb_workouts || {}).forEach(w => {
        if (!w || !w.end || w.start < since) return;
        (w.exercises || []).forEach(e => {
          const name = (exNames[e.exId] && exNames[e.exId].name) || e.name; if (!name) return;
          (e.sets || []).forEach(s => {
            if (!s || s.t === "w" || s.done === false) return;
            const kg = e.unit === "lb" ? (+s.w || 0) * 0.45359237 : (+s.w || 0), r = +s.r || 0; if (!kg || !r) return;
            const v = r === 1 ? kg : kg * (1 + r / 30);
            if (!ex[name] || v > ex[name].e1rm) ex[name] = { kg: Math.round(kg * 10) / 10, reps: r, e1rm: Math.round(v * 10) / 10, at: iso(new Date(w.start)) };
          });
        });
      });
      share.strength = { ex };
    }
    if (on("nutrition")) {
      const map = {};
      days.forEach(([d, day]) => {
        const eaten = (day.food || []).filter(f => f && f.eaten); if (!eaten.length) return;
        const kcal = eaten.reduce((a, f) => a + (+f.kcal || 0), 0), p = eaten.reduce((a, f) => a + (+f.p || 0), 0);
        const t = ctx.kcalTarget ? ctx.kcalTarget(d) : 2000;
        map[d] = { kcalOk: kcal >= t * 0.85 && kcal <= t * 1.05, proteinOk: p >= (ctx.proteinMin || 0) };
      });
      share.nutrition = { days: map };
    }
    if (on("weight")) {
      const ws = Object.values(ctx.docs.weights || {}).filter(w => w && w.date && +w.kg > 0).sort((a, b) => a.date < b.date ? -1 : 1);
      const last = ws[ws.length - 1], cut = addDays(today, -30);
      const base = ws.filter(w => w.date <= cut).pop() || ws[0];
      if (last && base && last.date !== base.date) {
        const change = Math.round((last.kg - base.kg) * 10) / 10, pct = Math.round((last.kg - base.kg) / base.kg * 1000) / 10;
        const mode = sharing.weightMode === "percent" ? "percent" : "change";
        share.weight = mode === "percent" ? { mode, pct, since: base.date, days: diffDays(base.date, last.date) } : { mode, change, since: base.date, days: diffDays(base.date, last.date) };
      } else share.weight = { mode: sharing.weightMode === "percent" ? "percent" : "change", since: null };
    }
    return share;
  }

  /* ---------- periods and the leaderboard ---------- */
  function periodRange(period, today) {
    if (period === "week") { const dow = (parse(today).getDay() + 6) % 7; return { from: addDays(today, -dow), to: today, label: "This week" }; }
    if (period === "month") return { from: today.slice(0, 8) + "01", to: today, label: "This month" };
    return { from: today, to: today, label: "Today" };
  }
  const sumDays = (map, from, to, f) => { let s = 0; Object.entries(map || {}).forEach(([d, v]) => { if (d >= from && d <= to) s += f ? f(v) : (+v || 0); }); return s; };
  function ago(ms, now) {
    if (!ms) return "never";
    const m = Math.max(0, Math.round((now - ms) / 60000));
    if (m < 2) return "just now"; if (m < 60) return m + " min ago"; const h = Math.round(m / 60); if (h < 36) return h + " h ago"; return Math.round(h / 24) + " days ago";
  }
  // rows for everyone (me + friends) for one period; shares: {uid: shareDoc}, me is the uid of the viewer
  function leaderboard(shares, period, today, opts) {
    const o = opts || {}, now = o.now || Date.now(), { from, to } = periodRange(period, today), nDays = diffDays(from, to) + 1;
    const rows = Object.values(shares).map(sh => {
      const r = { uid: sh.uid, name: sh.name, avatar: sh.avatar, me: sh.uid === o.me, status: "ok", total: 0, goal: 0, pct: 0, remaining: 0, goalDays: 0, at: null, ago: "" };
      const st = sh.steps;
      if (!st || !sh.cats || !sh.cats.steps) { r.status = "notShared"; return r; }
      r.goal = st.goal || 10000; r.at = st.at || null; r.ago = ago(st.at, now);
      r.total = sumDays(st.days, from, to);
      r.goalDays = Object.entries(st.days || {}).filter(([d, v]) => d >= from && d <= to && v >= r.goal).length;
      const hasAny = Object.keys(st.days || {}).length > 0;
      if (!hasAny) { r.status = st.connected ? "noData" : "notConnected"; return r; }
      r.pct = period === "today" ? clamp(r.total / r.goal, 0, 1) : clamp(r.total / (r.goal * nDays), 0, 1);
      r.remaining = period === "today" ? Math.max(0, r.goal - r.total) : 0;
      if (!st.at || now - st.at > STALE_H * 3600e3) r.status = "stale";
      return r;
    });
    const rank = r => r.status === "ok" || r.status === "stale" ? 0 : 1;
    rows.sort((a, b) => rank(a) - rank(b) || b.total - a.total || String(a.name).localeCompare(String(b.name)));
    const mine = rows.find(r => r.me);
    rows.forEach(r => { r.diff = mine && !r.me && rank(r) === 0 && rank(mine) === 0 ? r.total - mine.total : null; });
    return { rows, from, to, nDays };
  }

  /* ---------- compare two people ---------- */
  function compare(a, b, today) {
    const wk = periodRange("week", today), m30 = addDays(today, -29);
    const both = k => a && b && a.cats && b.cats && a.cats[k] && b.cats[k] && a[k] && b[k];
    const one = k => (a && a.cats && a.cats[k] && a[k]) || (b && b.cats && b.cats[k] && b[k]);
    const na = k => (x => !x || !x.cats || !x.cats[k] ? "Not shared" : "No data");
    const rows = [];
    const row = (label, k, fa, fb) => rows.push({ label, key: k, a: both(k) || (a && a.cats && a.cats[k] && a[k]) ? fa(a[k]) : na(k)(a), b: both(k) || (b && b.cats && b.cats[k] && b[k]) ? fb(b[k]) : na(k)(b), available: !!one(k) });
    row("Steps today", "steps", s => n0(s.days[today] || 0) + " / " + n0(s.goal), s => n0(s.days[today] || 0) + " / " + n0(s.goal));
    row("Steps this week", "steps", s => n0(sumDays(s.days, wk.from, wk.to)), s => n0(sumDays(s.days, wk.from, wk.to)));
    const wkCount = w => w.dates.filter(d => d >= wk.from && d <= wk.to).length + " / " + (w.weekGoal || 4);
    row("Workouts this week", "workouts", wkCount, wkCount);
    const water = w => { const ml = w.days[today] || 0, g = (w.goals && w.goals[today]) || w.goal || 3000; return n0(ml) + " ml · " + Math.round(ml / g * 100) + "%"; };
    row("Water today", "water", water, water);
    const cardio = c => { const min = sumDays(c.days, wk.from, wk.to, v => v.min), km = sumDays(c.days, wk.from, wk.to, v => v.km); return min ? min + " min" + (km ? " · " + (Math.round(km * 10) / 10) + " km" : "") : "0 min"; };
    row("Cardio this week", "cardio", cardio, cardio);
    const nut = x => { const ds = Object.entries(x.days).filter(([d]) => d >= wk.from && d <= wk.to); return ds.filter(([, v]) => v.kcalOk).length + " kcal days · " + ds.filter(([, v]) => v.proteinOk).length + " protein days"; };
    row("Nutrition goals this week", "nutrition", nut, nut);
    const wt = x => x.since ? (x.mode === "percent" ? (x.pct > 0 ? "+" : "") + x.pct + "% in " + x.days + " days" : (x.change > 0 ? "+" : "") + x.change + " kg in " + x.days + " days") : "No weigh-ins yet";
    row("Weight change", "weight", wt, wt);
    const lifts = [];
    if (both("strength")) Object.keys(a.strength.ex || {}).filter(n => b.strength.ex && b.strength.ex[n]).sort().forEach(n => lifts.push({ name: n, a: a.strength.ex[n], b: b.strength.ex[n] }));
    return { rows, lifts, strengthShared: both("strength"), m30 };
  }

  /* ---------- challenges ---------- */
  function challengeStatus(ch, today) { return today < ch.start ? "upcoming" : today > ch.end ? "done" : "active"; }
  const chType = k => CH_TYPES.find(t => t.key === k) || CH_TYPES[0];
  // my entry for one challenge, from local data (only the fields that challenge needs)
  function buildEntry(ch, profile, ctx) {
    const to = ch.end < ctx.today ? ch.end : ctx.today, days = {};
    const needSteps = /steps|active/.test(ch.type), needW = /workouts|active/.test(ch.type);
    const wDates = new Set();
    if (needW) {
      Object.values(ctx.docs.lb_workouts || {}).forEach(w => { if (w && w.end && w.start) wDates.add(iso(new Date(w.start))); });
      Object.entries(ctx.docs.workouts || {}).forEach(([d, w]) => { if (w && w.sets && Object.values(w.sets).some(a => Array.isArray(a) && a.some(s => s && (s.w || s.r)))) wDates.add(d); });
    }
    for (let d = ch.start; d <= to; d = addDays(d, 1)) {
      const e = {};
      if (needSteps) { const n = stepCount(ctx.getDay ? ctx.getDay(d) : ctx.docs.days[d]); if (n > 0) { e.s = n; e.g = ctx.stepGoal || 10000; } }
      if (needW && wDates.has(d)) e.w = 1;
      if (Object.keys(e).length) days[d] = e;
    }
    return { uid: profile.uid, name: profile.name || "Someone", avatar: profile.avatar || "initials", days, updatedAt: ctx.now || Date.now() };
  }
  // scores every member; entries: {uid: entry}
  function challengeProgress(ch, entries, today) {
    const to = ch.end < today ? ch.end : today, status = challengeStatus(ch, today);
    const score = e => { let v = 0; Object.entries((e && e.days) || {}).forEach(([d, x]) => { if (d < ch.start || d > to) return;
      if (ch.type === "steps_total" || ch.type === "group_steps") v += x.s || 0;
      else if (ch.type === "steps_goal_days") v += x.s && x.g && x.s >= x.g ? 1 : 0;
      else if (ch.type === "workouts") v += x.w ? 1 : 0;
      else if (ch.type === "active_days") v += (x.w || (x.s && x.g && x.s >= x.g)) ? 1 : 0; }); return v; };
    const rows = (ch.members || []).map(uid => { const e = entries && entries[uid]; return { uid, name: (e && e.name) || (ch.names && ch.names[uid]) || "Someone", avatar: e && e.avatar, score: score(e), hasEntry: !!e, updatedAt: e && e.updatedAt }; });
    rows.sort((a, b) => b.score - a.score || String(a.name).localeCompare(String(b.name)));
    const total = rows.reduce((a, r) => a + r.score, 0), target = +ch.target || 0;
    const daysLeft = Math.max(0, diffDays(today, ch.end) + (today <= ch.end ? 0 : 0)), daysTotal = diffDays(ch.start, ch.end) + 1;
    let result = null;
    if (ch.type === "group_steps") result = { kind: "group", total, target, pct: target ? clamp(total / target, 0, 1) : 0, reached: target > 0 && total >= target };
    else if (status === "done") { const top = rows[0]; const tied = rows.filter(r => top && r.score === top.score); result = top && top.score > 0 ? { kind: "winner", winners: tied.map(r => r.name), score: top.score } : { kind: "none" }; }
    rows.forEach(r => { r.reached = target > 0 && ch.type !== "group_steps" && r.score >= target; });
    return { rows, status, total, target, daysLeft: status === "active" ? diffDays(today, ch.end) + 1 : status === "upcoming" ? diffDays(today, ch.start) : 0, daysTotal, result, type: chType(ch.type) };
  }
  function validateChallenge(f, today) {
    const errs = [];
    const t = chType(f.type);
    if (!f.name || !String(f.name).trim()) errs.push("Give the challenge a name.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.start || "") || !/^\d{4}-\d{2}-\d{2}$/.test(f.end || "")) errs.push("Pick a start and an end date.");
    else if (f.end < f.start) errs.push("The end date is before the start.");
    else if (f.end < today) errs.push("The end date is in the past.");
    else if (diffDays(f.start, f.end) > 92) errs.push("Keep a challenge to three months or less.");
    if (t.target && !(+f.target > 0)) errs.push("Type a goal (" + t.unit + ").");
    if (!f.invited || !f.invited.length) errs.push("Pick at least one friend.");
    return errs;
  }

  /* ---------- HTML ---------- */
  const css = `
.fr-av{display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:50%;font-size:1.3rem;font-weight:700;flex:none}
.fr-av.lg{width:64px;height:64px;font-size:2rem}
.fr-row{display:flex;align-items:center;gap:12px;padding:10px 0;border-top:1px solid var(--line);min-width:0}
.fr-row:first-child{border-top:0}
.fr-row .fr-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.fr-row .fr-name{font-weight:700;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.fr-row .fr-sub{font-size:.82rem;color:var(--muted)}
.fr-row .fr-num{font-family:var(--display);font-size:1.5rem;font-weight:700;text-align:right;line-height:1;flex:none}
.fr-row .fr-num small{display:block;font-family:inherit;font-size:.75rem;color:var(--muted);font-weight:600;margin-top:3px}
.fr-rank{width:22px;text-align:center;font-weight:700;color:var(--muted);flex:none}
.fr-lead{border:2px solid var(--accent);border-radius:14px;padding:6px 10px;margin:0 -10px}
.fr-bar{height:6px;border-radius:999px;background:var(--sunk);overflow:hidden;margin-top:4px}
.fr-bar i{display:block;height:100%;background:var(--accent)}
.fr-bar.good i{background:var(--good)}
.fr-empty{text-align:center;padding:18px 8px;display:flex;flex-direction:column;gap:10px;align-items:center}
.fr-empty .big{font-size:2.4rem}
.fr-code{font-family:var(--display);font-size:2rem;letter-spacing:.14em;text-align:center;padding:10px;border:1px dashed var(--line);border-radius:12px;user-select:all}
.fr-cmp{display:grid;grid-template-columns:1fr auto 1fr;gap:6px 10px;align-items:center}
.fr-cmp .h{font-weight:700;text-align:center;display:flex;flex-direction:column;align-items:center;gap:4px}
.fr-cmp .l{grid-column:1/-1;font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:600;margin-top:8px}
.fr-cmp .v{text-align:center;font-weight:600;font-size:.95rem}
.fr-cmp .v.na{color:var(--muted);font-weight:400;font-size:.85rem}
.fr-cmp .vs{color:var(--muted);font-size:.75rem}
.fr-avs{display:flex;gap:6px;flex-wrap:wrap}
.fr-avs button{width:40px;height:40px;border-radius:50%;border:2px solid var(--line);background:var(--surface);font-size:1.3rem;cursor:pointer}
.fr-avs button[aria-pressed="true"]{border-color:var(--accent)}
.fr-ch-head{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}
.fr-ch-head h3{margin:0}
.fr-pick label{display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid var(--line)}
.fr-pick label:first-child{border-top:0}
.fr-field{display:flex;flex-direction:column;gap:4px}
.fr-field input,.fr-field select{width:100%}
.fr-grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.fr-banner{background:var(--sunk);border-radius:12px;padding:10px 12px;font-size:.88rem}
`;
  const pill = (cls, t) => `<span class="pill ${cls}">${t}</span>`;
  const statusPill = r => r.status === "notShared" ? pill("", "Not sharing steps") : r.status === "notConnected" ? pill("warn", "Steps not connected") : r.status === "noData" ? pill("", "No steps yet") : r.status === "stale" ? pill("warn", "Updated " + r.ago) : "";

  function leaderboardHTML(st, ctx) {
    const seg = `<div class="subnav" role="tablist" aria-label="Period">${[["today", "Today"], ["week", "Week"], ["month", "Month"]].map(([k, l]) => `<button type="button" role="tab" data-fr="period" data-k="${k}" aria-pressed="${st.period === k}">${l}</button>`).join("")}</div>`;
    const shares = Object.assign({}, st.shares); if (st.myShare) shares[st.uid] = st.myShare;
    const lb = leaderboard(shares, st.period, ctx.today, { me: st.uid, now: ctx.now });
    const mine = lb.rows.find(r => r.me);
    let body;
    if (!st.friends.length) body = `<div class="fr-empty"><span class="big">👟</span><p>Invite a friend to see your steps side by side.</p><button class="btn" data-fr="sub" data-k="friends">Add friend</button></div>`;
    else {
      let rank = 0;
      body = `<div>${lb.rows.map(r => {
        const ranked = r.status === "ok" || r.status === "stale"; if (ranked) rank++;
        const num = ranked ? `<div class="fr-num">${n0(r.total)}<small>${st.period === "today" ? (r.remaining ? n0(r.remaining) + " to go" : "Goal reached") : r.goalDays + " goal day" + (r.goalDays === 1 ? "" : "s")}</small></div>` : "";
        const sub = ranked ? `${Math.round(r.pct * 100)}% of ${st.period === "today" ? "goal" : "goal × " + lb.nDays + " day" + (lb.nDays === 1 ? "" : "s")}${r.diff != null ? " · " + (r.diff >= 0 ? "+" : "−") + n0(Math.abs(r.diff)) + " vs you" : ""}${r.status === "ok" ? " · updated " + r.ago : ""}` : r.me && r.status === "notShared" ? `<button class="btn ghost small" data-fr="sub" data-k="sharing">Share your steps</button>` : r.me && r.status === "notConnected" ? `<button class="btn ghost small" data-fr="gosteps">Connect Health Connect</button>` : "";
        return `<div class="fr-row${r.me ? " fr-lead" : ""}" ${r.me ? "" : `data-fr="compare" data-k="${esc(r.uid)}" role="button" tabindex="0"`}><span class="fr-rank">${ranked ? rank : "–"}</span>${avatarHTML(r)}<div class="fr-main"><span class="fr-name">${esc(r.me ? "You" : r.name)} ${statusPill(r)}</span>${ranked ? `<div class="fr-bar${r.pct >= 1 ? " good" : ""}"><i style="width:${Math.round(r.pct * 100)}%"></i></div>` : ""}<span class="fr-sub">${sub}</span></div>${num}</div>`;
      }).join("")}</div>
      <p class="muted" style="font-size:.8rem">Steps come from each person's phone through Health Connect when Mizan is opened; Samsung Health can take a few minutes to pass them on. Tap a friend to compare more.</p>`;
    }
    return `<div class="card"><div class="spread"><h3 style="margin:0">Steps leaderboard</h3>${mine && mine.status === "ok" ? pill("info", "You: " + n0(mine.total)) : ""}</div>${seg}${body}</div>`;
  }

  function friendsHTML(st, ctx) {
    const me = st.me || {};
    const profile = `<div class="card"><div class="row" style="align-items:center">${avatarHTML({ uid: st.uid, name: me.name, avatar: me.avatar }, "lg")}<div style="flex:1;min-width:0"><div style="font-weight:700;font-size:1.1rem">${esc(me.name || "Set your name")}</div><div class="muted" style="font-size:.85rem">${esc(ctx.email || "")}</div></div><button class="btn ghost small" data-fr="editprofile">Edit</button></div>
      ${st.editProfile ? `<div class="fr-field"><label class="label" for="frName">Display name</label><input id="frName" maxlength="24" value="${esc(me.name || "")}" placeholder="How friends see you"></div>
      <div class="fr-field"><span class="label">Avatar</span><div class="fr-avs"><button type="button" data-fr="avatar" data-k="initials" aria-pressed="${!me.avatar || me.avatar === "initials"}">${esc(initials(me.name))}</button>${AVATARS.map(a => `<button type="button" data-fr="avatar" data-k="${a}" aria-pressed="${me.avatar === a}">${a}</button>`).join("")}</div></div>
      <div class="row"><button class="btn" data-fr="saveprofile">Save</button><button class="btn ghost" data-fr="editprofile">Cancel</button></div>` : ""}</div>`;
    const invite = `<div class="card"><div class="spread"><h3 style="margin:0">Add friend</h3></div>
      <p class="muted" style="font-size:.9rem">Your invite code. Send it to a brother or friend; they type it in their Mizan under Friends › Add friend.</p>
      <div class="fr-code">${esc(st.code || "……")}</div>
      <div class="row"><button class="btn small" data-fr="shareinvite">Share invite</button><button class="btn ghost small" data-fr="copyinvite">Copy code</button></div>
      <div class="fr-field"><label class="label" for="frCode">Have a code? Type it here</label><div class="row" style="flex-wrap:nowrap"><input id="frCode" placeholder="ABC-123" autocapitalize="characters" autocomplete="off" style="flex:1;min-width:0;text-transform:uppercase"><button class="btn" data-fr="sendrequest">Send request</button></div></div>
      ${st.err ? `<p class="note" style="color:var(--bad)">${esc(st.err)}</p>` : ""}</div>`;
    const reqs = (st.requestsIn.length || st.requestsOut.length) ? `<div class="card"><h3>Requests</h3>
      ${st.requestsIn.map(r => `<div class="fr-row">${avatarHTML({ uid: r.from, name: r.fromName, avatar: r.fromAvatar })}<div class="fr-main"><span class="fr-name">${esc(r.fromName || "Someone")}</span><span class="fr-sub">wants to connect</span></div><button class="btn small" data-fr="accept" data-k="${esc(r.id)}">Accept</button><button class="btn ghost small" data-fr="decline" data-k="${esc(r.id)}">Decline</button></div>`).join("")}
      ${st.requestsOut.map(r => `<div class="fr-row">${avatarHTML({ uid: r.to, name: r.toName, avatar: r.toAvatar })}<div class="fr-main"><span class="fr-name">${esc(r.toName || "Someone")}</span><span class="fr-sub">Waiting for them to accept</span></div><button class="btn ghost small" data-fr="decline" data-k="${esc(r.id)}">Cancel</button></div>`).join("")}</div>` : "";
    const list = `<div class="card"><h3>Friends${st.friends.length ? " · " + st.friends.length : ""}</h3>
      ${st.friends.length ? st.friends.map(f => { const sh = st.shares[f.uid]; const on = sh && sh.cats ? CATS.filter(c => sh.cats[c.key]).map(c => c.label) : []; return `<div class="fr-row">${avatarHTML({ uid: f.uid, name: (sh && sh.name) || f.name, avatar: sh && sh.avatar })}<div class="fr-main"><span class="fr-name">${esc((sh && sh.name) || f.name || "Friend")}</span><span class="fr-sub">${sh ? (on.length ? "Shares " + on.join(", ").toLowerCase() : "Shares nothing yet") : "Hasn't shared anything yet"}</span></div><button class="btn ghost small" data-fr="compare" data-k="${esc(f.uid)}">Compare</button><button class="iconbtn" data-fr="remove" data-k="${esc(f.pairId)}" data-name="${esc(f.name || "this friend")}" aria-label="Remove ${esc(f.name || "friend")}">✕</button></div>`; }).join("")
      : `<div class="fr-empty"><span class="big">👋</span><p>No friends yet. Share your code above, or type theirs.</p></div>`}
      <p class="muted" style="font-size:.8rem">Removing a friend stops sharing in both directions straight away. They keep only what their phone already showed, and nothing new reaches them.</p></div>`;
    return profile + invite + reqs + list;
  }

  function challengesHTML(st, ctx) {
    const today = ctx.today, all = Object.values(st.challenges);
    const mine = c => (c.members || []).includes(st.uid), invitedOnly = c => !mine(c) && (c.invited || []).includes(st.uid);
    const groups = { invite: all.filter(invitedOnly).filter(c => challengeStatus(c, today) !== "done"), active: all.filter(mine).filter(c => challengeStatus(c, today) === "active"), upcoming: all.filter(mine).filter(c => challengeStatus(c, today) === "upcoming"), done: all.filter(mine).filter(c => challengeStatus(c, today) === "done").sort((a, b) => a.end < b.end ? 1 : -1).slice(0, 10) };
    const card = (c, invite) => {
      const p = challengeProgress(c, st.entries[c.id] || {}, today), t = p.type;
      const head = `<div class="fr-ch-head"><div><h3>${esc(c.name)}</h3><div class="muted" style="font-size:.85rem">${esc(t.label)}${t.target ? " · goal " + n0(c.target) + " " + t.unit : ""} · ${fmtRange(c.start, c.end)}</div></div>${p.status === "active" ? pill("info", p.daysLeft + " day" + (p.daysLeft === 1 ? "" : "s") + " left") : p.status === "upcoming" ? pill("", "Starts in " + p.daysLeft + " day" + (p.daysLeft === 1 ? "" : "s")) : pill("good", "Finished")}</div>`;
      let body = "";
      if (invite) body = `<p class="muted" style="font-size:.9rem">${esc(c.names && c.names[c.creator] || "A friend")} invited you. Joining shares only the numbers this challenge needs (${/steps|active/.test(c.type) ? "daily steps and your step goal" : ""}${c.type === "active_days" ? " and " : ""}${/workouts|active/.test(c.type) ? "workout days" : ""}) with its ${(c.invited || []).length - 1} other participant${(c.invited || []).length === 2 ? "" : "s"}.</p><div class="row"><button class="btn" data-fr="join" data-k="${esc(c.id)}">Join</button><button class="btn ghost" data-fr="declinech" data-k="${esc(c.id)}">No thanks</button></div>`;
      else {
        if (p.result && p.result.kind === "group") body += `<div><div class="spread"><b>${n0(p.result.total)} of ${n0(p.result.target)} ${t.unit}</b><span class="muted">${Math.round(p.result.pct * 100)}%</span></div><div class="fr-bar${p.result.reached ? " good" : ""}"><i style="width:${Math.round(p.result.pct * 100)}%"></i></div>${p.result.reached ? `<p class="muted" style="font-size:.85rem">🎉 Team goal reached!</p>` : ""}</div>`;
        else if (p.result && p.result.kind === "winner") body += `<p>🏆 <b>${esc(p.result.winners.join(" and "))}</b> ${p.result.winners.length > 1 ? "tied" : "won"} with ${n0(p.result.score)} ${t.unit}.</p>`;
        else if (p.result && p.result.kind === "none") body += `<p class="muted">Nobody logged anything during this challenge.</p>`;
        body += `<div>${p.rows.map((r, i) => `<div class="fr-row"><span class="fr-rank">${i + 1}</span>${avatarHTML(r)}<div class="fr-main"><span class="fr-name">${esc(r.uid === st.uid ? "You" : r.name)}${r.reached ? " " + pill("good", "Goal reached") : ""}</span>${t.target && c.type !== "group_steps" ? `<div class="fr-bar${r.reached ? " good" : ""}"><i style="width:${Math.round(clamp(r.score / (+c.target || 1), 0, 1) * 100)}%"></i></div>` : ""}<span class="fr-sub">${r.hasEntry ? "updated " + ago(r.updatedAt, ctx.now) : "no data yet"}</span></div><div class="fr-num">${n0(r.score)}<small>${t.unit}</small></div></div>`).join("")}</div>`;
        const pending = (c.invited || []).filter(u => !(c.members || []).includes(u));
        if (pending.length && p.status !== "done") body += `<p class="muted" style="font-size:.82rem">Not joined yet: ${esc(pending.map(u => (c.names && c.names[u]) || "someone").join(", "))}</p>`;
        if (p.status !== "done") body += `<div class="row"><button class="btn ghost small" data-fr="leave" data-k="${esc(c.id)}">${c.creator === st.uid ? "Delete challenge" : "Leave"}</button></div>`;
      }
      return `<div class="card">${head}${body}</div>`;
    };
    const section = (title, list, invite) => list.length ? `<p class="label setcat">${title}</p>${list.map(c => card(c, invite)).join("")}` : "";
    const newBtn = `<div class="row" style="justify-content:flex-end"><button class="btn" data-fr="newch">New challenge</button></div>`;
    const form = st.chForm ? challengeFormHTML(st, ctx) : "";
    const empty = !all.length && !st.chForm ? `<div class="card fr-empty"><span class="big">🏁</span><p>${st.friends.length ? "Start a friendly challenge: most steps this week, a team step goal, or a workout count." : "Add a friend first, then challenge them."}</p>${st.friends.length ? `<button class="btn" data-fr="newch">New challenge</button>` : `<button class="btn" data-fr="sub" data-k="friends">Add friend</button>`}</div>` : "";
    return (all.length && !st.chForm && st.friends.length ? newBtn : "") + form + empty + section("Invitations", groups.invite, true) + section("Active", groups.active) + section("Upcoming", groups.upcoming) + section("Completed", groups.done);
  }
  function fmtRange(a, b) { const f = s => parse(s).toLocaleDateString("en-US", { month: "short", day: "numeric" }); return f(a) + " – " + f(b); }
  function challengeFormHTML(st, ctx) {
    const f = st.chForm, t = chType(f.type);
    return `<div class="card" role="dialog" aria-label="New challenge"><div class="fr-ch-head"><h3>New challenge</h3><button class="iconbtn" data-fr="newchclose" aria-label="Close">✕</button></div>
      <div class="fr-field"><label class="label" for="frChName">Name</label><input id="frChName" maxlength="40" value="${esc(f.name || "")}" placeholder="Weekend walk-off"></div>
      <div class="fr-field"><label class="label" for="frChType">Kind</label><select id="frChType" data-fr-change="chtype">${CH_TYPES.map(x => `<option value="${x.key}" ${f.type === x.key ? "selected" : ""}>${x.label}</option>`).join("")}</select><small class="muted">${esc(t.sub)}</small></div>
      <div class="fr-grid2"><div class="fr-field"><label class="label" for="frChStart">Start</label><input id="frChStart" type="date" value="${esc(f.start || ctx.today)}"></div><div class="fr-field"><label class="label" for="frChEnd">End</label><input id="frChEnd" type="date" value="${esc(f.end || addDays(ctx.today, 6))}"></div></div>
      ${t.target ? `<div class="fr-field"><label class="label" for="frChTarget">Goal (${t.unit})</label><input id="frChTarget" type="number" inputmode="numeric" min="1" value="${esc(f.target || (t.key === "workouts" ? 4 : t.key === "group_steps" ? 100000 : 5))}"></div>` : ""}
      <div class="fr-field"><span class="label">Who's in</span><div class="fr-pick">${st.friends.map(fr => `<label><input type="checkbox" data-fr-pick="${esc(fr.uid)}" ${(f.invited || []).includes(fr.uid) ? "checked" : ""}> ${avatarHTML({ uid: fr.uid, name: (st.shares[fr.uid] && st.shares[fr.uid].name) || fr.name, avatar: st.shares[fr.uid] && st.shares[fr.uid].avatar })} ${esc((st.shares[fr.uid] && st.shares[fr.uid].name) || fr.name || "Friend")}</label>`).join("")}</div><small class="muted">Each friend gets an invitation and joins only if they want to.</small></div>
      ${f.errs && f.errs.length ? `<p class="note" style="color:var(--bad)">${f.errs.map(esc).join("<br>")}</p>` : ""}
      <div class="row"><button class="btn" data-fr="createch">Create</button><button class="btn ghost" data-fr="newchclose">Cancel</button></div></div>`;
  }

  function sharingHTML(st) {
    const sh = st.sharing || defaultSharing();
    const sw = (k, on, label) => `<button class="switch" role="switch" aria-checked="${!!on}" data-fr="toggle" data-k="${k}" aria-label="${esc(label)}"></button>`;
    return `<div class="card"><h3>What you share</h3><p class="muted" style="font-size:.9rem">Everything is off until you switch it on. Only accepted friends see what's on, and only these summaries, never your meals, weigh-ins, sets, health records or location. Switch anything off at any time and it disappears from their phones the next time they open Mizan.</p>
      <div class="set-list">${CATS.map(c => `<div class="set-row"><span><span>${c.label}</span><small>${c.sub}</small></span>${sw(c.key, sh[c.key], "Share " + c.label)}</div>`).join("")}</div>
      ${sh.weight ? `<div class="set-row"><span><span>Weight as</span><small>Pick what friends see</small></span><span class="seg" role="group"><button type="button" data-fr="weightmode" data-k="change" aria-pressed="${(sh.weightMode || "change") === "change"}">kg change</button><button type="button" data-fr="weightmode" data-k="percent" aria-pressed="${sh.weightMode === "percent"}">% change</button></span></div>` : ""}
      ${sh.workouts ? `<div class="set-row"><span><span>Weekly workout goal</span><small>Used for your consistency bar</small></span><span class="seg" role="group">${[2, 3, 4, 5, 6].map(n => `<button type="button" data-fr="weekgoal" data-k="${n}" aria-pressed="${(sh.weekGoal || 4) === n}">${n}</button>`).join("")}</span></div>` : ""}
      <p class="muted" style="font-size:.8rem">Your shared summary is updated when you open Mizan and after each change, and holds the last ${DAYS_KEPT} days. Challenges share only the numbers the challenge needs with its participants, even when they are not your friends.</p></div>`;
  }

  function compareHTML(st, ctx) {
    const other = st.shares[st.compareUid], mine = st.myShare;
    if (!other) return "";
    const c = compare(mine, other, ctx.today);
    const v = x => `<span class="v${/^(Not shared|No data|No weigh-ins yet)$/.test(x) ? " na" : ""}">${esc(x)}</span>`;
    return `<div class="sheet-wrap" data-fr="closecompare"><div class="fsheet" role="dialog" aria-modal="true" aria-label="Compare"><div class="sheet-head"><button class="iconbtn" data-fr="closecompare" data-close aria-label="Close">✕</button><h2>Compare</h2><span></span></div><div class="sheet-body">
      <div class="fr-cmp"><div class="h">${avatarHTML({ uid: st.uid, name: mine && mine.name, avatar: mine && mine.avatar })}You</div><span class="vs">vs</span><div class="h">${avatarHTML(other)}${esc(other.name)}</div>
      ${c.rows.map(r => `<span class="l">${esc(r.label)}</span>${v(r.a)}<span class="vs"></span>${v(r.b)}`).join("")}
      ${c.strengthShared ? (c.lifts.length ? c.lifts.map(l => `<span class="l">${esc(l.name)} · best set</span>${v(l.a.kg + " kg × " + l.a.reps)}<span class="vs"></span>${v(l.b.kg + " kg × " + l.b.reps)}`).join("") : `<span class="l">Strength</span><span class="v na" style="grid-column:1/-1">No exercise you both logged in the last 90 days</span>`) : `<span class="l">Strength</span><span class="v na" style="grid-column:1/-1">${mine && mine.cats && mine.cats.strength ? esc(other.name) + " doesn't share lifts" : "Switch on Strength in Sharing to compare lifts"}</span>`}</div>
      <p class="muted" style="font-size:.8rem">Lifts are compared on the same exercise in kg (best set of the last 90 days). Weight shows change only, as each person chose. Updated ${ago(other.updatedAt, ctx.now)}.</p></div></div></div>`;
  }

  function screenHTML(st, ctx) {
    const sub = st.sub || "leaderboard";
    const nav = `<div class="subnav" role="tablist" aria-label="Friends sections">${[["leaderboard", "Steps"], ["friends", "Friends"], ["challenges", "Challenges"], ["sharing", "Sharing"]].map(([k, l]) => `<button type="button" role="tab" data-fr="sub" data-k="${k}" aria-pressed="${sub === k}">${l}${k === "friends" && st.requestsIn.length ? ` <span class="pill info">${st.requestsIn.length}</span>` : ""}</button>`).join("")}</div>`;
    let banner = "";
    if (st.backendOff) banner = `<div class="fr-banner">Friends isn't switched on in the server yet: the Firestore rules in the repo (firestore.rules) still have to be published in the Firebase console. Everything else in Mizan works as before.</div>`;
    else if (st.offline) banner = `<div class="fr-banner">Offline: showing the last copy. Friends updates when you're back online.</div>`;
    const body = sub === "friends" ? friendsHTML(st, ctx) : sub === "challenges" ? challengesHTML(st, ctx) : sub === "sharing" ? sharingHTML(st) : leaderboardHTML(st, ctx);
    return nav + banner + body + (st.compareUid ? compareHTML(st, ctx) : "");
  }
  function signedOutHTML(cloudReady) {
    return `<div class="card fr-empty"><span class="big">👥</span><p>Friends needs an account, so each person's data stays their own.</p>${cloudReady ? `<button class="btn" data-act="cloudsignin">Sign in or create account</button>` : `<p class="muted">Sign in isn't available in this copy of the app.</p>`}</div>`;
  }

  /* ---------- controller: Firestore listeners + actions ---------- */
  // opts: {fs, uid, email, today(), ctx() -> buildShare ctx, getSharing(), setSharing(obj), render(), toast(msg), share(text) -> Promise, navigator}
  function mount(opts) {
    const fs = opts.fs, uid = opts.uid;
    const st = { uid, me: null, code: null, requestsIn: [], requestsOut: [], friends: [], shares: {}, myShare: null, challenges: {}, entries: {}, backendOff: false, offline: false, err: null, sub: "leaderboard", period: "today", compareUid: null, editProfile: false, chForm: null, sharing: null };
    const subs = [], shareSubs = {}, entrySubs = {};
    const onErr = e => { if (e && e.code === "permission-denied") { st.backendOff = true; } else if (e && e.code === "unavailable") st.offline = true; opts.render(); };
    const sharingNow = () => Object.assign(defaultSharing(), opts.getSharing() || {});
    st.sharing = sharingNow();
    const tsOf = x => x && typeof x === "object" && x.toMillis ? x.toMillis() : (+x || 0);
    const norm = d => { const o = Object.assign({}, d); ["updatedAt", "at", "createdAt", "since"].forEach(k => { if (o[k] && typeof o[k] === "object") o[k] = tsOf(o[k]); }); if (o.steps && o.steps.at && typeof o.steps.at === "object") o.steps.at = tsOf(o.steps.at); return o; };

    // profile + invite code (created on first use)
    subs.push(fs.collection("profiles").doc(uid).onSnapshot(d => {
      st.me = d.exists ? Object.assign({ uid }, d.data()) : null; st.code = st.me && st.me.code || null;
      if (!st.me) { const local = opts.getSharing() || {}; st.me = { uid, name: local.name || (opts.email || "").split("@")[0] || "Me", avatar: local.avatar || "initials" }; saveProfile(st.me.name, st.me.avatar).catch(onErr); }
      opts.render();
    }, onErr));
    async function saveProfile(name, avatar) {
      name = String(name || "").trim().slice(0, 24) || "Me";
      let code = st.code;
      if (!code) { code = newCode(); await fs.collection("invites").doc(code).set({ uid, name, avatar: avatar || "initials" }); }
      else fs.collection("invites").doc(code).set({ uid, name, avatar: avatar || "initials" }).catch(() => {});
      await fs.collection("profiles").doc(uid).set({ name, avatar: avatar || "initials", code, updatedAt: Date.now() });
      st.me = { uid, name, avatar: avatar || "initials", code }; st.code = code;
      opts.setSharing(Object.assign({}, sharingNow(), { name, avatar: avatar || "initials" }));
      schedulePublish(0);
    }
    // requests
    subs.push(fs.collection("requests").where("to", "==", uid).onSnapshot(qs => { st.requestsIn = qs.docs.map(d => Object.assign({ id: d.id }, d.data())); opts.render(); }, onErr));
    subs.push(fs.collection("requests").where("from", "==", uid).onSnapshot(qs => { st.requestsOut = qs.docs.map(d => Object.assign({ id: d.id }, d.data())); opts.render(); }, onErr));
    // friends -> share listeners
    subs.push(fs.collection("friends").where("users", "array-contains", uid).onSnapshot(qs => {
      st.friends = qs.docs.map(d => { const x = d.data(); const other = (x.users || []).find(u => u !== uid); return { pairId: d.id, uid: other, name: x.names && x.names[other], since: tsOf(x.since) }; }).filter(f => f.uid);
      const want = new Set(st.friends.map(f => f.uid));
      Object.keys(shareSubs).forEach(u => { if (!want.has(u)) { shareSubs[u](); delete shareSubs[u]; delete st.shares[u]; if (st.compareUid === u) st.compareUid = null; } });
      want.forEach(u => subscribeShare(u, 0));
      opts.render();
    }, onErr));
    // A listener that is refused stops for good, and right after accepting a request the server may not have
    // the friendship yet (the write is still in flight), so a refused share listener is retried a few times.
    function subscribeShare(u, attempt) {
      if (shareSubs[u] || !st.friends.some(f => f.uid === u)) return;
      shareSubs[u] = fs.collection("shares").doc(u).onSnapshot(d => { if (d.exists) st.shares[u] = norm(Object.assign({ uid: u }, d.data())); else delete st.shares[u]; opts.render(); },
        e => { if (shareSubs[u]) { shareSubs[u](); delete shareSubs[u]; } delete st.shares[u]; opts.render(); if (e && e.code === "permission-denied" && attempt < 4) setTimeout(() => subscribeShare(u, attempt + 1), 1500 * (attempt + 1)); });
    }
    function subscribeEntries(id, attempt) {
      if (entrySubs[id] || !st.challenges[id]) return;
      entrySubs[id] = fs.collection("challenges").doc(id).collection("entries").onSnapshot(q => { const o = {}; q.docs.forEach(e => { o[e.id] = norm(Object.assign({ uid: e.id }, e.data())); }); st.entries[id] = o; opts.render(); },
        e => { if (entrySubs[id]) { entrySubs[id](); delete entrySubs[id]; } if (e && e.code === "permission-denied" && attempt < 4) setTimeout(() => subscribeEntries(id, attempt + 1), 1500 * (attempt + 1)); });
    }
    // challenges -> entry listeners
    subs.push(fs.collection("challenges").where("invited", "array-contains", uid).onSnapshot(qs => {
      const seen = new Set();
      st.challenges = {}; qs.docs.forEach(d => { st.challenges[d.id] = Object.assign({ id: d.id }, d.data()); seen.add(d.id); });
      Object.keys(entrySubs).forEach(id => { if (!seen.has(id)) { entrySubs[id](); delete entrySubs[id]; delete st.entries[id]; } });
      seen.forEach(id => subscribeEntries(id, 0));
      schedulePublish(500); opts.render();
    }, onErr));

    // publish my share + challenge entries when something changed (debounced, compared to the last copy)
    let pubTimer = null, lastShare = null, lastEntries = {};
    function schedulePublish(ms) { clearTimeout(pubTimer); pubTimer = setTimeout(() => { publish().catch(() => {}); }, ms == null ? 4000 : ms); }
    async function publish() {
      if (!st.me) return;
      const ctx = opts.ctx(), sharing = sharingNow();
      const profile = { uid, name: st.me.name, avatar: st.me.avatar };
      const share = buildShare(profile, sharing, ctx);
      const cmp = o => JSON.stringify(Object.assign({}, o, { updatedAt: 0 }));
      let changed = false;
      st.myShare = share;
      if (cmp(share) !== lastShare) { lastShare = cmp(share); changed = true; await fs.collection("shares").doc(uid).set(share); }
      for (const ch of Object.values(st.challenges)) {
        if (!(ch.members || []).includes(uid)) continue;
        if (ch.end < addDays(ctx.today, -2)) continue;
        const entry = buildEntry(ch, profile, ctx), key = cmp(entry);
        if (lastEntries[ch.id] !== key) { lastEntries[ch.id] = key; changed = true; await fs.collection("challenges").doc(ch.id).collection("entries").doc(uid).set(entry); }
      }
      if (changed) opts.render();
    }
    schedulePublish(1500);

    /* actions */
    async function sendRequest(codeRaw) {
      const code = cleanCode(codeRaw); st.err = null;
      if (!/^[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(code)) { st.err = "A code looks like ABC-123."; return opts.render(); }
      if (code === st.code) { st.err = "That's your own code."; return opts.render(); }
      const d = await fs.collection("invites").doc(code).get();
      if (!d.exists) { st.err = "No one has that code. Check it with your friend."; return opts.render(); }
      const other = d.data();
      if (st.friends.some(f => f.uid === other.uid)) { st.err = (other.name || "They") + " is already your friend."; return opts.render(); }
      const back = st.requestsIn.find(r => r.from === other.uid);
      if (back) return accept(back.id);
      await fs.collection("requests").doc(reqId(uid, other.uid)).set({ from: uid, to: other.uid, fromName: st.me.name, fromAvatar: st.me.avatar, toName: other.name || "", toAvatar: other.avatar || "", at: Date.now() });
      opts.toast("Request sent to " + (other.name || "your friend") + ". They accept it under Friends.");
      const inp = document.getElementById("frCode"); if (inp) inp.value = "";
    }
    async function accept(id) {
      const r = st.requestsIn.find(x => x.id === id); if (!r) return;
      const names = {}; names[uid] = st.me.name; names[r.from] = r.fromName || "Friend";
      await fs.collection("friends").doc(pairId(uid, r.from)).set({ users: [uid, r.from].sort(), names, since: Date.now() });
      await fs.collection("requests").doc(id).delete();
      opts.toast("You and " + (r.fromName || "your friend") + " are connected."); schedulePublish(0);
    }
    const decline = id => fs.collection("requests").doc(id).delete();
    async function remove(pair) { await fs.collection("friends").doc(pair).delete(); opts.toast("Friend removed. Sharing stopped both ways."); }
    async function createChallenge() {
      const f = st.chForm; readChForm();
      f.errs = validateChallenge(f, opts.today()); if (f.errs.length) return opts.render();
      const id = "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const names = {}; names[uid] = st.me.name; f.invited.forEach(u => { names[u] = (st.shares[u] && st.shares[u].name) || (st.friends.find(x => x.uid === u) || {}).name || "Friend"; });
      const t = chType(f.type);
      await fs.collection("challenges").doc(id).set({ id, name: String(f.name).trim().slice(0, 40), type: f.type, target: t.target ? +f.target : 0, start: f.start, end: f.end, creator: uid, invited: [uid, ...f.invited], members: [uid], names, createdAt: Date.now() });
      st.chForm = null; opts.toast("Challenge created. Your friends get an invitation."); schedulePublish(0);
    }
    function readChForm() {
      const f = st.chForm, g = id => document.getElementById(id);
      if (g("frChName")) f.name = g("frChName").value; if (g("frChType")) f.type = g("frChType").value; if (g("frChStart")) f.start = g("frChStart").value; if (g("frChEnd")) f.end = g("frChEnd").value; if (g("frChTarget")) f.target = g("frChTarget").value;
      f.invited = [...document.querySelectorAll("[data-fr-pick]:checked")].map(x => x.getAttribute("data-fr-pick"));
    }
    async function join(id) { const c = st.challenges[id]; if (!c) return; const names = Object.assign({}, c.names); names[uid] = st.me.name; await fs.collection("challenges").doc(id).update({ members: [...new Set([...(c.members || []), uid])], names }); opts.toast("You're in."); schedulePublish(0); }
    async function leave(id) {
      const c = st.challenges[id]; if (!c) return;
      if (c.creator === uid) { for (const u of Object.keys(st.entries[id] || {})) await fs.collection("challenges").doc(id).collection("entries").doc(u).delete().catch(() => {}); await fs.collection("challenges").doc(id).delete(); opts.toast("Challenge deleted."); return; }
      await fs.collection("challenges").doc(id).collection("entries").doc(uid).delete().catch(() => {});
      await fs.collection("challenges").doc(id).update({ members: (c.members || []).filter(u => u !== uid), invited: (c.invited || []).filter(u => u !== uid) });
      delete lastEntries[id]; opts.toast("You left the challenge. Your numbers were removed from it.");
    }
    const declineCh = id => { const c = st.challenges[id]; if (!c) return; return fs.collection("challenges").doc(id).update({ invited: (c.invited || []).filter(u => u !== uid) }); };

    function handle(el, target) {
      const a = el.getAttribute("data-fr"), k = el.getAttribute("data-k");
      const run = p => Promise.resolve(p).catch(e => { if (e && e.code === "permission-denied") { st.backendOff = true; opts.render(); } else opts.toast("Couldn't do that: " + (e && (e.code || e.message) || e)); });
      if (a === "sub") { st.sub = k; st.err = null; opts.render(); window.scrollTo(0, 0); return true; }
      if (a === "period") { st.period = k; opts.render(); return true; }
      if (a === "compare") { st.compareUid = k; opts.render(); return true; }
      if (a === "closecompare") { if (!el.hasAttribute("data-close") && target && target !== el) return true; st.compareUid = null; opts.render(); return true; }
      if (a === "editprofile") { st.editProfile = !st.editProfile; opts.render(); return true; }
      if (a === "avatar") { if (!st.me) st.me = { uid, name: "", avatar: "initials" }; st.me.avatar = k; const n = document.getElementById("frName"); if (n) st.me.name = n.value; opts.render(); return true; }
      if (a === "saveprofile") { const n = document.getElementById("frName"), me = st.me || { name: "", avatar: "initials" }; st.editProfile = false; run(saveProfile(n ? n.value : me.name, me.avatar).then(() => { opts.toast("Profile saved."); opts.render(); })); return true; }
      if (a === "shareinvite") { opts.share("Join me on Mizan! Install it from " + (opts.apkUrl || "the link I sent") + ", create your account, then open Friends › Add friend and type my code: " + st.code); return true; }
      if (a === "copyinvite") { (navigator.clipboard ? navigator.clipboard.writeText(st.code) : Promise.reject()).then(() => opts.toast("Code copied: " + st.code), () => opts.toast("Your code: " + st.code)); return true; }
      if (a === "sendrequest") { const i = document.getElementById("frCode"); run(sendRequest(i ? i.value : "")); return true; }
      if (a === "accept") { run(accept(k)); return true; }
      if (a === "decline") { run(decline(k)); return true; }
      if (a === "remove") { if (opts.confirm("Remove " + (el.getAttribute("data-name") || "this friend") + "? Sharing stops both ways.")) run(remove(k)); return true; }
      if (a === "toggle") { const s = sharingNow(); s[k] = !s[k]; opts.setSharing(s); st.sharing = s; schedulePublish(300); opts.render(); return true; }
      if (a === "weightmode") { const s = sharingNow(); s.weightMode = k; opts.setSharing(s); st.sharing = s; schedulePublish(300); opts.render(); return true; }
      if (a === "weekgoal") { const s = sharingNow(); s.weekGoal = +k; opts.setSharing(s); st.sharing = s; schedulePublish(300); opts.render(); return true; }
      if (a === "gosteps") { opts.goSteps && opts.goSteps(); return true; }
      if (a === "newch") { st.chForm = { type: "steps_total", start: opts.today(), end: addDays(opts.today(), 6), invited: st.friends.map(f => f.uid) }; opts.render(); return true; }
      if (a === "newchclose") { st.chForm = null; opts.render(); return true; }
      if (a === "createch") { run(createChallenge().then(() => opts.render())); return true; }
      if (a === "join") { run(join(k)); return true; }
      if (a === "declinech") { run(declineCh(k)); return true; }
      if (a === "leave") { const c = st.challenges[k]; if (c && opts.confirm(c.creator === uid ? "Delete this challenge for everyone?" : "Leave this challenge? Your numbers are removed from it.")) run(leave(k)); return true; }
      return false;
    }
    function change(el) { if (el.getAttribute("data-fr-change") === "chtype" && st.chForm) { readChForm(); st.chForm.target = ""; opts.render(); return true; } return false; }
    function refreshSharing() { st.sharing = sharingNow(); }
    function destroy() { subs.forEach(f => f()); Object.values(shareSubs).forEach(f => f()); Object.values(entrySubs).forEach(f => f()); }
    return { state: st, handle, change, schedulePublish, publish, refreshSharing, destroy, html: ctx => screenHTML(st, ctx) };
  }

  return { CATS, CH_TYPES, AVATARS, DAYS_KEPT, STALE_H, pairId, reqId, newCode, cleanCode, initials, avatarHTML, defaultSharing, buildShare, buildEntry, periodRange, leaderboard, compare, challengeStatus, challengeProgress, validateChallenge, ago, screenHTML, signedOutHTML, mount, css };
})();
if (typeof module !== "undefined" && module.exports) module.exports = Friends;
