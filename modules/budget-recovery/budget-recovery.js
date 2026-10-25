/* Over-budget day recovery for the Aziz Cut Tracker.
 * Plain JS, no imports, no network. Reads the app's own days/{date} docs:
 *   {date, food:[{kcal, eaten, ...}], budgetAdj:{<sourceDate>: -kcal}, recovery:{choice, at, ...}}
 * API:
 *   BudgetRecovery.css                          -> string, inject once (uses the app's tokens)
 *   BudgetRecovery.eatenKcal(dayDoc)            -> kcal of items marked eaten
 *   BudgetRecovery.plan(date, days)             -> {date, eaten, target, surplus, reason, text,
 *                                                   recommended, options:{spread, walk}}
 *   BudgetRecovery.apply(plan, choice, at)      -> [{date, patch}] to merge into days/{date}
 *                                                   (choice: "spread" | "walk" | "skip")
 *   BudgetRecovery.targetFor(date, days)        -> that day's kcal target after any recovery cuts
 *   BudgetRecovery.cardHtml(plan)               -> "Went over today?" card ("" when nothing to do);
 *                                                   buttons carry data-recover="spread|walk|skip"
 *                                                   and data-recover-date="<source date>"
 *
 * The rule (from the plan: 2,000 kcal, never cut to 1,500-1,700 or 1,800, Friday is a free day):
 *   surplus <= 100 kcal       -> nothing to do (the app already calls 1,900-2,100 "on target")
 *   Friday                    -> nothing to do, and nothing is ever taken from Saturday for it
 *   otherwise, two options:
 *     spread -> take the surplus off the next 3 non-Friday days, at most 150 kcal a day, so no day
 *               drops below 1,850. Anything above 450 kcal is let go: one day does not undo a week.
 *     walk   -> one extra 30-min brisk walk (~150-200 kcal at ~92 kg, on top of the post-lift
 *               treadmill). If the surplus is above ~175 kcal, the rest is spread as above.
 *   recommended: walk when the surplus fits inside it (<= 200 kcal), otherwise spread.
 *   Cuts come from carbs or fat; protein stays at 160 g+.
 */
const BudgetRecovery = (() => {
  const TARGET = 2000;
  const FLOOR = 1850;          // lowest a recovery day may go
  const MAX_CUT = TARGET - FLOOR;
  const DAYS = 3;
  const IGNORE = 100;          // within this, the day is on target
  const WALK = { minutes: 30, kcal: [150, 200], credit: 175 };
  const DAY = 864e5;

  const iso = ms => new Date(ms).toISOString().slice(0, 10);
  const addDays = (date, n) => iso(Date.parse(date + "T00:00:00Z") + n * DAY);
  const isFriday = date => new Date(date + "T00:00:00Z").getUTCDay() === 5;
  const fmt = n => Math.round(n).toLocaleString("en-US");
  const round10 = n => Math.round(n / 10) * 10;

  function eatenKcal(doc) {
    if (!doc || !Array.isArray(doc.food)) return 0;
    return doc.food.reduce((s, i) => s + (i && i.eaten ? Number(i.kcal) || 0 : 0), 0);
  }

  // Sum of cuts already planned on a day, from any source day.
  function existingCut(doc) {
    const adj = doc && doc.budgetAdj;
    if (!adj) return 0;
    return Object.values(adj).reduce((s, v) => s + Math.min(0, Number(v) || 0), 0);
  }

  function targetFor(date, days) {
    if (isFriday(date)) return TARGET;
    return Math.max(FLOOR, TARGET + existingCut((days || {})[date]));
  }

  // Spread `kcal` over the next DAYS non-Friday days after `date`, respecting room left above FLOOR.
  function spreadFrom(date, kcal, days, sourceDate) {
    const out = [];
    let d = date;
    while (out.length < DAYS) {
      d = addDays(d, 1);
      if (isFriday(d)) continue;
      const doc = (days || {})[d];
      const already = existingCut(doc) - Math.min(0, Number(doc && doc.budgetAdj && doc.budgetAdj[sourceDate]) || 0);
      out.push({ date: d, room: Math.max(0, MAX_CUT + already) });
    }
    let left = Math.max(0, round10(kcal));
    const even = round10(left / DAYS);
    out.forEach((day, i) => {
      const want = i === DAYS - 1 ? left : Math.min(left, even);
      day.cut = Math.min(day.room, want);
      left -= day.cut;
    });
    // second pass: push anything a full day could not take onto days with room
    out.forEach(day => { const more = Math.min(day.room - day.cut, left); day.cut += more; left -= more; });
    const list = out.filter(d => d.cut > 0).map(d => ({ date: d.date, cut: d.cut, target: TARGET - (MAX_CUT - d.room) - d.cut }));
    return { days: list, covered: list.reduce((s, d) => s + d.cut, 0) };
  }

  function plan(date, days) {
    days = days || {};
    const doc = days[date];
    const eaten = eatenKcal(doc);
    const target = targetFor(date, days);
    const surplus = Math.round(eaten - target);
    const base = { date, eaten, target, surplus, options: null, recommended: null };
    if (doc && doc.recovery && doc.recovery.choice) return { ...base, reason: "handled", choice: doc.recovery.choice, text: handledText(doc.recovery) };
    if (surplus <= IGNORE) return { ...base, reason: surplus > 0 ? "small" : "under", text: "" };
    if (isFriday(date)) return { ...base, reason: "friday", text: "Friday is a free day. Nothing to make up, and Saturday stays at 2,000." };

    const spread = spreadFrom(date, surplus, days, date);
    spread.letGo = Math.max(0, surplus - spread.covered);
    const walkRest = Math.max(0, surplus - WALK.credit);
    const walkSpread = walkRest > IGNORE / 2 ? spreadFrom(date, walkRest, days, date) : { days: [], covered: 0 };
    const walk = { ...WALK, days: walkSpread.days, covered: walkSpread.covered, letGo: Math.max(0, walkRest - walkSpread.covered) };
    const recommended = surplus <= WALK.kcal[1] ? "walk" : "spread";
    return { ...base, reason: "recover", options: { spread, walk }, recommended,
      text: `${fmt(surplus)} kcal over ${fmt(target)}. No need to starve tomorrow: pick one.` };
  }

  function handledText(r) {
    if (r.choice === "spread") return "Spread over the next days.";
    if (r.choice === "walk") return "Extra 30-min walk planned.";
    return "Let it go. Weekly average is what counts.";
  }

  function apply(p, choice, at) {
    if (!p || p.reason !== "recover") return [];
    const stamp = at || new Date().toISOString();
    const opt = choice === "spread" ? p.options.spread : choice === "walk" ? p.options.walk : null;
    const writes = [{ date: p.date, patch: { recovery: { choice: opt ? choice : "skip", surplus: p.surplus, at: stamp } } }];
    if (opt) opt.days.forEach(d => writes.push({ date: d.date, patch: { budgetAdj: { [p.date]: -d.cut } } }));
    return writes;
  }

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const day = d => new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const list = ds => ds.map(d => `${day(d.date)} ${fmt(d.target)} (−${d.cut})`).join(", ");

  function cardHtml(p) {
    if (!p || p.reason !== "recover") return "";
    const { spread, walk } = p.options;
    const spreadLine = `Next ${spread.days.length} days: ${list(spread.days)}.` + (spread.letGo ? ` The last ${fmt(spread.letGo)} kcal is let go.` : "");
    const walkLine = `One extra 30-min brisk walk, today or tomorrow (~${walk.kcal[0]}–${walk.kcal[1]} kcal).` +
      (walk.days.length ? ` Plus ${list(walk.days)}.` : "") + (walk.letGo ? ` The last ${fmt(walk.letGo)} kcal is let go.` : "");
    const opt = (key, title, body) => `<div class="br-opt${p.recommended === key ? " rec" : ""}"><b>${title}${p.recommended === key ? ' <span class="br-tag">Suggested</span>' : ""}</b><p>${esc(body)}</p>` +
      `<button class="br-btn" data-recover="${key}" data-recover-date="${p.date}">${key === "walk" ? "I'll walk" : "Spread it"}</button></div>`;
    return `<div class="card br-card"><h3>Went over today?</h3><p class="br-sum">${esc(p.text)}</p>` +
      opt("walk", "Walk it off", walkLine) + opt("spread", "Spread it", spreadLine) +
      `<p class="br-note">Cuts come from carbs or fat. Protein stays at 160 g+. No day goes below ${fmt(FLOOR)}, and Fridays are never touched.</p>` +
      `<button class="br-btn ghost" data-recover="skip" data-recover-date="${p.date}">Let it go</button></div>`;
  }

  const css = `
.br-card{border-left:4px solid var(--warn)}
.br-sum{margin:0 0 10px}
.br-opt{border:1px solid var(--line);border-radius:var(--r,12px);padding:10px 12px;margin:0 0 8px;background:var(--sunk)}
.br-opt.rec{border-color:var(--accent)}
.br-opt p{margin:4px 0 8px;color:var(--muted)}
.br-tag{font:600 .7em var(--mono);color:var(--accent);margin-left:6px;text-transform:uppercase}
.br-note{color:var(--muted);font-size:.85em;margin:4px 0 10px}
.br-btn{min-height:44px;padding:0 16px;border-radius:calc(var(--r,12px)*.6);border:1px solid var(--accent);background:var(--accent);color:var(--accent-ink);font-weight:600;cursor:pointer}
.br-btn.ghost{background:transparent;color:var(--ink);border-color:var(--line)}
`;

  return { css, TARGET, FLOOR, WALK, eatenKcal, targetFor, plan, apply, cardHtml };
})();

if (typeof module !== "undefined") module.exports = { BudgetRecovery };
