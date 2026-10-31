/* ExerciseSwap: one-tap swaps when a machine is taken, plus a "this hurt" flag.
 * Plain JS, no imports, no network. Exposes window.ExerciseSwap (or module.exports in Node).
 *
 * - options(name)      ranked like-for-like swaps for any exercise; never a hip hinge
 *                      (deadlifts, RDLs, hip thrusts, back extensions and their lookalikes).
 * - linkSwap(workout)  records which plan slot a substitute stood in for, so history stays linked.
 * - history(name)      sets for a plan slot, including sessions where a substitute was used.
 * - flagHurt / pending flag a lift that hurt; next time it comes up, a swap is suggested.
 * - openSheet()        small bottom-sheet UI using the shell's CSS tokens (classes prefixed xs-).
 *
 * Swap order follows the "Exercise swaps for avoided lifts" reference (Oct 25).
 */
(function (root) {
  'use strict';

  // ---------- Avoid list ----------
  // Every lift Aziz skips is a hip hinge. Lookalikes from the reference are banned too.
  const AVOID_RE = new RegExp([
    'dead\\s*-?lift', '\\brdl', 'romanian', 'stiff[\\s-]*leg', 'rack\\s*pull', 'good\\s*morning',
    'hip\\s*thrust', 'glute\\s*bridge', 'back\\s*extension', 'hyper\\s*-?extension', 'roman\\s*chair',
    'reverse\\s*hyper', 'glute[\\s-]*ham', '\\bghr\\b', 'pull[\\s-]*through', 'kettlebell\\s*swing',
    '\\bkb\\s*swing', 'nordic'
  ].join('|'), 'i');
  const isAvoided = name => AVOID_RE.test(String(name || ''));

  // ---------- Catalog ----------
  // name | muscle | equipment | logger library name ('' = log as a custom exercise) | aliases (;)
  // `name` is the name sets are logged under. Plan names match the shell's PROGRAM.
  const CAT_SRC = `Bench Press (Barbell)|Chest|Barbell|Bench Press (Barbell)|
Bench Press (Smith Machine)|Chest|Smith machine|Bench Press (Smith Machine)|Smith bench
Chest Press (Machine)|Chest|Machine|Chest Press (Machine)|Machine chest press
Bench Press (Dumbbell)|Chest|Dumbbell|Bench Press (Dumbbell)|DB bench;DB Bench Press
Incline DB Press|Chest|Dumbbell|Incline Bench Press (Dumbbell)|Incline Dumbbell Press
Incline Bench Press (Smith Machine)|Chest|Smith machine|Incline Bench Press (Smith Machine)|Incline Smith press
Incline Chest Press (Machine)|Chest|Machine|Incline Chest Press (Machine)|Incline machine press
Incline Bench Press (Barbell)|Chest|Barbell|Incline Bench Press (Barbell)|
Gundam (Chest Machine)|Chest|Machine|Gundam Chest Press (Machine)|Gundam Chest Press (machine)
Cable Crossover|Chest|Cable|Cable Crossover|
Pec Deck (Machine)|Chest|Machine|Pec Deck (Machine)|Pec deck
Chest Fly (Dumbbell)|Chest|Dumbbell|Chest Fly (Dumbbell)|DB fly
Low-to-High Cable Fly|Chest|Cable|Low-to-High Cable Fly|
Seated DB Overhead Press|Shoulders (press)|Dumbbell|Seated Overhead Press (Dumbbell)|Seated Dumbbell Overhead Press
Shoulder Press (Machine)|Shoulders (press)|Machine|Shoulder Press (Machine)|Machine shoulder press
Smith Seated Press|Shoulders (press)|Smith machine|Seated Overhead Press (Smith Machine)|Smith seated shoulder press
Arnold Press (Dumbbell)|Shoulders (press)|Dumbbell|Arnold Press (Dumbbell)|
Lateral Raise (Cable)|Side delts|Cable|Lateral Raise (Cable)|Cable lateral raise
Side Delts|Side delts|Dumbbell|Lateral Raise (Dumbbell)|Lateral Raise (Dumbbell);DB lateral raise
Lateral Raise (Machine)|Side delts|Machine|Lateral Raise (Machine)|
Standing Side Delts (Machine)|Side delts|Machine|Standing Lateral Raise (Machine)|Standing Side Delt Machine
Front Raise (DB)|Front delts|Dumbbell|Front Raise (Dumbbell)|Front Raise (dumbbell)
Front Raise (Cable)|Front delts|Cable|Front Raise (Cable)|
Reverse Fly (Machine)|Rear delts|Machine|Reverse Fly (Machine)|Rear delt machine
Face Pull (Cable)|Rear delts|Cable|Face Pull (Cable)|Face pull
Chest-Supported Reverse Fly (Dumbbell)|Rear delts|Dumbbell|Reverse Fly (Dumbbell)|Reverse Fly (Dumbbell)
Triceps Extension (Cable)|Triceps|Cable|Triceps Extension (Cable)|Cable Triceps Extension;Overhead cable extension
Overhead Triceps Extension (Dumbbell)|Triceps|Dumbbell|Overhead Triceps Extension (Dumbbell)|
Skull Crusher (EZ Bar)|Triceps|Barbell|Skull Crusher (EZ Bar)|
Triceps Pushdown (Straight bar)|Triceps|Cable|Triceps Pushdown (Straight Bar)|Triceps Pushdown
Triceps Rope|Triceps|Cable|Triceps Rope Pushdown (Cable)|Triceps Rope Pushdown
Single-Arm Pushdown (Cable)|Triceps|Cable|Single-Arm Pushdown (Cable)|
Triceps Dip (Machine)|Triceps|Machine|Triceps Dip (Machine)|
Lat Pulldown, Wide|Lats|Cable|Lat Pulldown - Wide Grip (Cable)|Lat Pulldown (wide grip)
Lat Pulldown, Close Grip|Lats|Cable|Lat Pulldown - Close Grip (Cable)|
Lat Pulldown, Single Arm|Lats|Cable|Lat Pulldown - Single Arm (Cable)|Single-Arm Lat Pulldown
Lat Pulldown (Machine)|Lats|Machine|Lat Pulldown (Machine)|Machine pulldown
Assisted Pull Up (Machine)|Lats|Assisted|Assisted Pull Up (Machine)|Assisted pull-up
Iso-Lateral High Row (Plate-loaded)|Lats|Plate-loaded|Iso-Lateral High Row (Plate-loaded)|
Pullover (Machine)|Lats|Machine|Pullover (Machine)|Pullover Machine
Straight-Arm Pulldown (Cable)|Lats|Cable|Straight-Arm Pulldown (Cable)|
Seated Row (Cable)|Mid back|Cable|Seated Row (Cable)|Seated Cable Row
Iso-Lateral Low Row|Mid back|Plate-loaded|Iso-Lateral Low Row (Plate-loaded)|Iso-Lateral Low Row (plate)
Chest-Supported Row (Machine)|Mid back|Machine|Chest-Supported Row (Machine)|Chest-supported row
Seated Row (Machine)|Mid back|Machine|Seated Row (Machine)|
T-Bar Row|Mid back|Plate-loaded|T-Bar Row|
Chest-Supported T-Bar Row|Mid back|Plate-loaded|Chest-Supported T-Bar Row (Machine)|Chest-supported T-bar row
Chest-Supported DB Row|Mid back|Dumbbell|Chest-Supported Row (Dumbbell)|Chest-supported DB row
Traps Machine|Traps|Machine|Shrug (Machine)|Shrug Machine
Shrug (Dumbbell)|Traps|Dumbbell|Shrug (Dumbbell)|
Shrug (Barbell)|Traps|Barbell|Shrug (Barbell)|
DB Curl|Biceps|Dumbbell|Bicep Curl (Dumbbell)|Dumbbell Curl
Hammer Curl (Dumbbell)|Biceps|Dumbbell|Hammer Curl (Dumbbell)|
Seated Bicep Curl|Biceps|Machine|Seated Bicep Curl (Machine)|Seated Biceps Curl (machine)
Preacher Curl (Machine)|Biceps|Machine|Preacher Curl (Machine)|
Preacher Curl (EZ Bar)|Biceps|Barbell|Preacher Curl (EZ Bar)|
Cable Standing Biceps|Biceps|Cable|Standing Bicep Curl (Cable)|Standing Cable Curl
Bayesian Curl (Cable)|Biceps|Cable|Bayesian Curl (Cable)|
Bicep Curl (Barbell)|Biceps|Barbell|Bicep Curl (Barbell)|
Hack Squat|Quads|Machine|Hack Squat (Machine)|
Pendulum Squat (Machine)|Quads|Machine|Pendulum Squat (Machine)|Pendulum squat
Leg Press (Machine)|Quads|Machine|Leg Press (Machine)|45° leg press;Leg press
Smith Squat|Quads|Smith machine|Squat (Smith Machine)|Smith Machine Squat
Belt Squat|Quads|Machine|Belt Squat (Machine)|
Leg Extension|Quads|Machine|Leg Extension (Machine)|
Single-Leg Extension|Quads|Machine|Single Leg Extension (Machine)|Single-leg extension
Smith Split Squat|Quads|Smith machine|Split Squat (Smith Machine)|Smith or DB split squat;Split squat
Lying Leg Curl|Hamstrings|Machine|Lying Leg Curl (Machine)|
Seated Leg Curl (Machine)|Hamstrings|Machine|Seated Leg Curl (Machine)|Seated leg curl
Single-Leg Lying Curl|Hamstrings|Machine|Lying Leg Curl (Single Leg)|Single-leg lying curl
Standing Leg Curl (Machine)|Hamstrings|Machine|Standing Leg Curl (Machine)|
Hip Adductor|Adductors|Machine|Hip Adductor (Machine)|Hip Adductor Machine
Cable Adduction|Adductors|Cable|Hip Adduction (Cable)|
Copenhagen Plank|Adductors|Duration|Copenhagen Plank|
Hip Abductor|Glutes|Machine|Hip Abductor (Machine)|Hip Abductor Machine
Cable Abduction|Glutes|Cable|Hip Abduction (Cable)|
Glute Kickback (Machine)|Glutes|Machine|Glute Kickback (Machine)|Glute kickback machine
Glute Kickback (Cable)|Glutes|Cable|Glute Kickback (Cable)|Cable kickback
Standing Calf Raise|Calves|Machine|Standing Calf Raise (Machine)|Calf raises
Calf Press on Seated Leg Press|Calves|Machine|Calf Press (Leg Press)|Calf press on leg press
Smith Standing Calf Raise|Calves|Smith machine|Calf Raise (Smith Machine)|
Seated Calf Raise (Machine)|Calves|Machine|Seated Calf Raise (Machine)|
Seated Abs|Core|Machine|Seated Abs (Machine)|Seated Ab Crunch (machine)
Cable Crunch|Core|Cable|Cable Crunch|
Decline Crunch|Core|Reps only|Decline Crunch|
Hanging Leg Raise|Core|Reps only|Hanging Leg Raise|`;

  // Plan exercise -> backups in order (reference table first, then like-for-like fills).
  const SWAPS = {
    'Bench Press (Barbell)': ['Bench Press (Smith Machine)', 'Chest Press (Machine)', 'Bench Press (Dumbbell)'],
    'Incline DB Press': ['Incline Bench Press (Smith Machine)', 'Incline Chest Press (Machine)', 'Incline Bench Press (Barbell)'],
    'Gundam (Chest Machine)': ['Chest Press (Machine)', 'Bench Press (Dumbbell)', 'Bench Press (Smith Machine)'],
    'Cable Crossover': ['Pec Deck (Machine)', 'Low-to-High Cable Fly', 'Chest Fly (Dumbbell)'],
    'Seated DB Overhead Press': ['Shoulder Press (Machine)', 'Smith Seated Press', 'Arnold Press (Dumbbell)'],
    'Lateral Raise (Cable)': ['Side Delts', 'Lateral Raise (Machine)', 'Standing Side Delts (Machine)'],
    'Side Delts': ['Lateral Raise (Cable)', 'Lateral Raise (Machine)', 'Standing Side Delts (Machine)'],
    'Standing Side Delts (Machine)': ['Lateral Raise (Machine)', 'Lateral Raise (Cable)', 'Side Delts'],
    'Front Raise (DB)': ['Front Raise (Cable)', 'Lateral Raise (Cable)', 'Shoulder Press (Machine)'],
    'Reverse Fly (Machine)': ['Face Pull (Cable)', 'Chest-Supported Reverse Fly (Dumbbell)'],
    'Triceps Extension (Cable)': ['Overhead Triceps Extension (Dumbbell)', 'Skull Crusher (EZ Bar)', 'Triceps Rope'],
    'Triceps Pushdown (Straight bar)': ['Triceps Rope', 'Single-Arm Pushdown (Cable)', 'Triceps Dip (Machine)'],
    'Triceps Rope': ['Triceps Pushdown (Straight bar)', 'Single-Arm Pushdown (Cable)', 'Overhead Triceps Extension (Dumbbell)'],
    'Lat Pulldown, Wide': ['Assisted Pull Up (Machine)', 'Lat Pulldown (Machine)', 'Lat Pulldown, Close Grip'],
    'Lat Pulldown, Single Arm': ['Iso-Lateral High Row (Plate-loaded)', 'Lat Pulldown (Machine)', 'Lat Pulldown, Close Grip'],
    'Seated Row (Cable)': ['Iso-Lateral Low Row', 'Chest-Supported Row (Machine)', 'Seated Row (Machine)'],
    'Pullover (Machine)': ['Straight-Arm Pulldown (Cable)', 'Lat Pulldown, Close Grip'],
    'T-Bar Row': ['Chest-Supported T-Bar Row', 'Chest-Supported DB Row', 'Chest-Supported Row (Machine)'],
    'Iso-Lateral Low Row': ['Seated Row (Cable)', 'Chest-Supported Row (Machine)', 'Seated Row (Machine)'],
    'Traps Machine': ['Shrug (Dumbbell)', 'Shrug (Barbell)'],
    'DB Curl': ['Hammer Curl (Dumbbell)', 'Cable Standing Biceps', 'Preacher Curl (Machine)'],
    'Seated Bicep Curl': ['Preacher Curl (Machine)', 'Preacher Curl (EZ Bar)', 'DB Curl'],
    'Cable Standing Biceps': ['Bayesian Curl (Cable)', 'DB Curl', 'Bicep Curl (Barbell)'],
    'Hack Squat': ['Pendulum Squat (Machine)', 'Leg Press (Machine)'],
    'Smith Squat': ['Leg Press (Machine)', 'Belt Squat'],
    'Leg Extension': ['Single-Leg Extension', 'Smith Split Squat'],
    'Lying Leg Curl': ['Seated Leg Curl (Machine)', 'Single-Leg Lying Curl', 'Standing Leg Curl (Machine)'],
    'Hip Adductor': ['Cable Adduction', 'Copenhagen Plank'],
    'Hip Abductor': ['Cable Abduction', 'Glute Kickback (Machine)'],
    'Standing Calf Raise': ['Calf Press on Seated Leg Press', 'Smith Standing Calf Raise', 'Seated Calf Raise (Machine)'],
    'Calf Press on Seated Leg Press': ['Standing Calf Raise', 'Smith Standing Calf Raise', 'Seated Calf Raise (Machine)'],
    'Seated Abs': ['Cable Crunch', 'Decline Crunch', 'Hanging Leg Raise']
  };

  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const CATALOG = [], BY_KEY = {};
  CAT_SRC.split('\n').forEach(line => {
    const [name, muscle, equip, lib, aliases] = line.split('|');
    const e = { name, muscle, equip, lib: lib || null, plan: !!SWAPS[name] };
    CATALOG.push(e);
    [name, lib].concat((aliases || '').split(';')).filter(Boolean).forEach(a => { if (!BY_KEY[norm(a)]) BY_KEY[norm(a)] = e; });
  });
  const lookup = name => BY_KEY[norm(name)] || null;
  // Canonical log name for anything we know (e.g. "Hack Squat (Machine)" -> "Hack Squat").
  const canonical = name => (lookup(name) || { name: String(name || '') }).name;
  const loggerId = e => e && e.lib ? e.lib.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : null;

  // ---------- History ----------
  // workouts: [{date, session, sets:{name:[{w,r,unit?}]}, swapped?:{usedName: planName}}]
  const asList = w => Array.isArray(w) ? w : Object.values(w || {});
  const byDateDesc = (a, b) => String(b.date).localeCompare(String(a.date));
  function setsFor(workout, name) {
    const k = norm(name), c = norm(canonical(name));
    for (const key of Object.keys(workout.sets || {})) if (norm(key) === k || norm(canonical(key)) === c) return { key, sets: workout.sets[key] };
    return null;
  }
  // The plan slot an exercise stood in for on that day, if any.
  function slotOf(workout, usedName) {
    const m = workout.swapped || {};
    for (const k of Object.keys(m)) if (norm(canonical(k)) === norm(canonical(usedName))) return m[k];
    return null;
  }
  // Every logged entry for `name`: its own sessions plus sessions where a substitute filled
  // its plan slot (via: 'swap'), and, for a substitute, the slots it filled (via: 'self').
  function history(name, workouts) {
    const c = norm(canonical(name)), out = [];
    asList(workouts).forEach(w => {
      const own = setsFor(w, name);
      if (own && own.sets && own.sets.length) out.push({ date: w.date, session: w.session, name: own.key, sets: own.sets, via: 'direct', slot: slotOf(w, own.key) });
      Object.entries(w.swapped || {}).forEach(([used, slot]) => {
        if (norm(canonical(slot)) !== c || norm(canonical(used)) === c) return;
        const s = setsFor(w, used);
        if (s && s.sets && s.sets.length) out.push({ date: w.date, session: w.session, name: s.key, sets: s.sets, via: 'swap', slot });
      });
    });
    return out.sort(byDateDesc);
  }
  const topSet = sets => (sets || []).reduce((b, s) => (!b || (+s.w || 0) > (+b.w || 0) || ((+s.w || 0) === (+b.w || 0) && (+s.r || 0) > (+b.r || 0))) ? s : b, null);
  function lastTime(name, workouts) {
    const h = history(name, workouts).filter(x => x.via === 'direct');
    if (!h.length) return null;
    const t = topSet(h[0].sets);
    return { date: h[0].date, w: t ? t.w : null, r: t ? t.r : null, unit: t && t.unit || null };
  }
  // Writes the link into a workouts/{date} doc (returns a copy). planName = the slot it replaced.
  function linkSwap(workout, planName, usedName) {
    const w = Object.assign({}, workout || {});
    w.swapped = Object.assign({}, w.swapped || {});
    if (!planName || norm(canonical(planName)) === norm(canonical(usedName))) delete w.swapped[canonical(usedName)];
    else w.swapped[canonical(usedName)] = canonical(planName);
    if (!Object.keys(w.swapped).length) delete w.swapped;
    return w;
  }

  // ---------- State (hurt flags + swap log) ----------
  // Stored by the shell as one doc, e.g. prefs/swaps: {hurt:{key:{name,date,note,times}}, log:[...]}
  const empty = () => ({ hurt: {}, log: [] });
  const clone = s => ({ hurt: Object.assign({}, (s && s.hurt) || {}), log: ((s && s.log) || []).slice() });
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  function flagHurt(state, name, o) {
    o = o || {}; const s = clone(state), k = norm(canonical(name)), prev = s.hurt[k];
    s.hurt[k] = { name: canonical(name), date: o.date || today(), note: o.note || (prev && prev.note) || '', times: (prev ? prev.times : 0) + 1 };
    return s;
  }
  function clearHurt(state, name) { const s = clone(state); delete s.hurt[norm(canonical(name))]; return s; }
  const hurtInfo = (state, name) => ((state && state.hurt) || {})[norm(canonical(name))] || null;
  function recordSwap(state, o) {
    const s = clone(state);
    s.log.push({ date: o.date || today(), session: o.session || null, from: canonical(o.from), to: canonical(o.to), reason: o.reason || 'taken' });
    if (s.log.length > 200) s.log = s.log.slice(-200);
    return s;
  }

  // ---------- Suggestions ----------
  // Ranked swaps for `name`. Curated backups first, then same-muscle catalog entries.
  // Never returns an avoided lift or the exercise itself; lifts flagged as hurting go last.
  // o: {state, workouts, exclude:[names already in today's session], limit}
  function options(name, o) {
    o = o || {}; const state = o.state, workouts = o.workouts || [];
    const self = lookup(name), selfKey = norm(canonical(name));
    const seen = new Set([selfKey].concat((o.exclude || []).map(n => norm(canonical(n))))), list = [];
    const push = (e, why) => {
      const k = norm(e.name);
      if (seen.has(k) || isAvoided(e.name) || isAvoided(e.lib)) return;
      seen.add(k); list.push({ e, why });
    };
    (SWAPS[canonical(name)] || []).forEach((n, i) => { const e = lookup(n); if (e) push(e, i === 0 ? 'Best match' : 'Backup ' + i); });
    // Recent stand-ins Aziz has actually used for this slot.
    ((state && state.log) || []).slice().reverse().forEach(x => { if (norm(x.from) === selfKey) { const e = lookup(x.to); if (e) push(e, 'Used before'); } });
    if (self) CATALOG.forEach(e => { if (e.muscle === self.muscle) push(e, 'Same muscle'); });
    const res = list.map(({ e, why }, i) => {
      const h = hurtInfo(state, e.name);
      return { name: e.name, muscle: e.muscle, equip: e.equip, loggerId: loggerId(e), plan: e.plan, why, hurt: h, last: lastTime(e.name, workouts), _i: i };
    });
    // Hurt lifts sink; the rest keep the reference order (first choice when the machine is free).
    res.sort((a, b) => (!!a.hurt - !!b.hurt) || (a._i - b._i));
    res.forEach(r => delete r._i);
    return res.slice(0, o.limit || 6);
  }
  // For a session's exercise list: which ones were flagged as hurting, and the swap to suggest.
  function pending(exercises, state, o) {
    return (exercises || []).map(n => typeof n === 'string' ? n : n && (n.name || n[0])).filter(Boolean).map(n => {
      const h = hurtInfo(state, n);
      if (!h) return null;
      const opts = options(n, Object.assign({}, o, { state }));
      return { exercise: canonical(n), flagged: h, suggest: opts.find(x => !x.hurt) || null };
    }).filter(Boolean);
  }

  // ---------- UI ----------
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CSS = `.xs-overlay{position:fixed;inset:0;z-index:1100;background:rgba(0,0,0,.45);display:flex;align-items:flex-end;justify-content:center}
.xs-sheet{background:var(--surface,#fff);color:var(--ink,#111);width:100%;max-width:520px;max-height:85vh;overflow:auto;border-radius:var(--r,14px) var(--r,14px) 0 0;padding:16px 16px calc(16px + env(safe-area-inset-bottom));font-family:var(--body,system-ui,sans-serif);box-sizing:border-box}
.xs-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:10px}
.xs-head h3{margin:0;font-family:var(--display,inherit);font-size:18px}
.xs-head p{margin:2px 0 0;color:var(--muted,#666);font-size:13px}
.xs-x{background:none;border:0;color:var(--muted,#666);font-size:22px;line-height:1;cursor:pointer;padding:4px}
.xs-opt{display:flex;width:100%;text-align:left;align-items:center;justify-content:space-between;gap:10px;background:var(--sunk,#f4f4f4);color:inherit;border:1px solid var(--line,#ddd);border-radius:calc(var(--r,14px) - 4px);padding:12px;margin:0 0 8px;cursor:pointer;font:inherit}
.xs-opt:hover,.xs-opt:focus-visible{border-color:var(--accent,#2a6);outline:none}
.xs-opt b{display:block;font-size:15px}
.xs-opt small{color:var(--muted,#666);font-size:12px}
.xs-tag{font-size:11px;font-family:var(--mono,monospace);color:var(--muted,#666);white-space:nowrap;text-align:right}
.xs-tag.best{color:var(--accent,#2a6)}
.xs-tag.bad{color:var(--bad,#c33)}
.xs-row{display:flex;gap:8px;margin-top:6px}
.xs-btn{flex:1;font:inherit;font-size:14px;padding:10px;border-radius:calc(var(--r,14px) - 4px);border:1px solid var(--line,#ddd);background:var(--surface,#fff);color:var(--ink,#111);cursor:pointer}
.xs-btn.warn{border-color:var(--warn,#c80);color:var(--warn,#c80)}
.xs-note{width:100%;box-sizing:border-box;font:inherit;font-size:14px;padding:8px;border-radius:8px;border:1px solid var(--line,#ddd);background:var(--sunk,#f4f4f4);color:inherit;margin-top:8px}
.xs-foot{color:var(--muted,#666);font-size:12px;margin:10px 0 0}
.xs-banner{display:flex;gap:10px;align-items:center;justify-content:space-between;border:1px solid var(--warn,#c80);border-radius:calc(var(--r,14px) - 4px);padding:10px 12px;margin:0 0 8px;font-family:var(--body,system-ui,sans-serif);font-size:14px;color:var(--ink,#111);background:var(--surface,#fff)}
.xs-banner small{display:block;color:var(--muted,#666);font-size:12px}
.xs-banner .xs-row{margin:0;flex:0 0 auto}
.xs-banner .xs-btn{flex:0 0 auto;padding:6px 10px;font-size:13px}`;
  function injectCss() {
    if (typeof document === 'undefined' || document.getElementById('xs-css')) return;
    const st = document.createElement('style'); st.id = 'xs-css'; st.textContent = CSS; document.head.appendChild(st);
  }
  const fmtLast = l => l && l.w != null ? 'Last ' + l.w + (l.unit || '') + ' × ' + l.r + ' · ' + l.date : 'No history yet';

  // openSheet({exercise, state, workouts, onPick(opt), onHurt(note), onFine()}) -> {close}
  // onPick gets the chosen option; the shell logs sets under opt.name and calls linkSwap.
  function openSheet(o) {
    injectCss();
    const opts = options(o.exercise, o), h = hurtInfo(o.state, o.exercise);
    const ov = document.createElement('div'); ov.className = 'xs-overlay';
    ov.innerHTML = '<div class="xs-sheet" role="dialog" aria-modal="true" aria-label="Swap exercise">' +
      '<div class="xs-head"><div><h3>Swap ' + esc(canonical(o.exercise)) + '</h3><p>Same muscle, same rep range and effort. Log it as its own lift; history stays linked.</p></div><button class="xs-x" data-xs="close" aria-label="Close">×</button></div>' +
      (opts.length ? opts.map((x, i) => '<button class="xs-opt" data-xs="pick" data-i="' + i + '"><span><b>' + esc(x.name) + '</b><small>' + esc(x.equip) + ' · ' + esc(fmtLast(x.last)) + '</small></span>' +
        '<span class="xs-tag' + (x.hurt ? ' bad' : i === 0 ? ' best' : '') + '">' + esc(x.hurt ? 'Hurt ' + x.hurt.date : x.why) + '</span></button>').join('')
        : '<p class="xs-foot">No safe swaps known for this one.</p>') +
      '<div class="xs-row">' + (h ? '<button class="xs-btn" data-xs="fine">It felt fine, clear flag</button>' : '<button class="xs-btn warn" data-xs="hurt">This hurt</button>') + '</div>' +
      '<div data-xs="hurtbox" hidden><input class="xs-note" placeholder="Where? (optional, e.g. left shoulder)" maxlength="80"><div class="xs-row"><button class="xs-btn warn" data-xs="hurtsave">Flag it, suggest a swap next time</button></div></div>' +
      (h ? '<p class="xs-foot">Flagged as hurting on ' + esc(h.date) + (h.note ? ' (' + esc(h.note) + ')' : '') + '.</p>' : '') +
      '<p class="xs-foot">Deadlifts, RDLs, hip thrusts, back extensions and their lookalikes are never suggested.</p></div>';
    const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    ov.addEventListener('click', e => {
      if (e.target === ov) return close();
      const b = e.target.closest('[data-xs]'); if (!b) return;
      const a = b.dataset.xs;
      if (a === 'close') close();
      else if (a === 'pick') { close(); o.onPick && o.onPick(opts[+b.dataset.i]); }
      else if (a === 'hurt') { const box = ov.querySelector('[data-xs="hurtbox"]'); box.hidden = false; box.querySelector('input').focus(); b.parentNode.hidden = true; }
      else if (a === 'hurtsave') { const note = ov.querySelector('.xs-note').value.trim(); close(); o.onHurt && o.onHurt(note); }
      else if (a === 'fine') { close(); o.onFine && o.onFine(); }
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(ov);
    const first = ov.querySelector('.xs-opt'); if (first) first.focus();
    return { close };
  }
  // renderNotice(container, {exercises, state, workouts, onSwap(exercise, opt), onKeep(exercise)})
  // Shows a banner per hurt-flagged lift in today's session with a one-tap suggested swap.
  function renderNotice(el, o) {
    injectCss();
    const items = pending(o.exercises, o.state, o);
    el.innerHTML = items.map((p, i) => '<div class="xs-banner"><div><b>' + esc(p.exercise) + ' hurt last time</b><small>' +
      esc(p.flagged.date + (p.flagged.note ? ' · ' + p.flagged.note : '')) + (p.suggest ? ' · try ' + esc(p.suggest.name) : '') + '</small></div><div class="xs-row">' +
      (p.suggest ? '<button class="xs-btn warn" data-xs="swap" data-i="' + i + '">Swap</button>' : '') + '<button class="xs-btn" data-xs="keep" data-i="' + i + '">Keep</button></div></div>').join('');
    el.onclick = e => {
      const b = e.target.closest('[data-xs]'); if (!b) return;
      const p = items[+b.dataset.i];
      if (b.dataset.xs === 'swap') o.onSwap && o.onSwap(p.exercise, p.suggest);
      else o.onKeep && o.onKeep(p.exercise);
    };
    return items.length;
  }

  const api = { isAvoided, canonical, lookup, options, history, lastTime, linkSwap, empty, flagHurt, clearHurt, hurtInfo, recordSwap, pending, openSheet, renderNotice, catalog: CATALOG, swaps: SWAPS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ExerciseSwap = api;
})(typeof window !== 'undefined' ? window : this);
