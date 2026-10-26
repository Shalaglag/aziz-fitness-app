/* TravelWorkout: turn today's gym session into a dumbbell, band or bodyweight version.
 * Plain JS, no imports, no network. Exposes window.TravelWorkout (or module.exports in Node).
 *
 * - convert(exercises, {kit, swap, workouts}) -> one travel move per plan slot, same muscle,
 *   reps adjusted for the kit. Reuses ExerciseSwap: its catalog gives the muscle of each plan
 *   lift and its dumbbell swaps come first when the kit has dumbbells. Never a hip hinge:
 *   every output passes ExerciseSwap.isAvoided (deadlifts, RDLs, hip thrusts, back extensions,
 *   good mornings, glute bridges, swings, Nordics ...), on top of this module's own list.
 * - apply(workoutDoc, items, kit) links each travel move to its plan slot with ExerciseSwap.linkSwap,
 *   so sets log under the travel name and history() still shows them under the plan lift.
 * - clear(workoutDoc) undoes that. active(workoutDoc) -> kit name or null.
 * - cardHtml({...}) renders the Train-tab card; buttons carry data-act="twkit|twapply|twclear".
 *
 * Kits: dumbbell = dumbbells (+ a bench if there is one, + bodyweight fills),
 *       band = a resistance band with a door anchor (+ bodyweight fills), bodyweight = nothing.
 */
(function (root) {
  'use strict';

  const KITS = [
    { id: 'dumbbell', label: 'Dumbbells', equip: ['Dumbbell', 'Bodyweight'], hint: 'Hotel gym or a pair of dumbbells. Same reps as the plan, a little higher.' },
    { id: 'band', label: 'Bands', equip: ['Band', 'Bodyweight'], hint: 'One long band and a door anchor. Higher reps, slow negatives.' },
    { id: 'bodyweight', label: 'Bodyweight', equip: ['Bodyweight'], hint: 'Nothing but the room. Work to 1–2 reps short of failure.' }
  ];
  const kitOf = id => KITS.find(k => k.id === id) || KITS[0];

  // Own avoid list, a safety net if ExerciseSwap is missing. The same hinge family.
  const AVOID_RE = /dead\s*lift|\brdl\b|romanian|stiff[\s-]*leg|rack\s*pull|good\s*morning|hip\s*thrust|glute\s*bridge|bridge|back\s*extension|hyper\s*extension|hyperextension|glute[\s-]*ham|nordic|reverse\s*hyper|pull[\s-]*through|swing|roman\s*chair|superman|bird\s*dog/i;
  const ownAvoided = name => AVOID_RE.test(String(name || ''));

  // name | muscle (ExerciseSwap labels) | equip | reps lo-hi | cue
  const TRAVEL_SRC = `Floor Press (Dumbbell)|Chest|Dumbbell|8-12|Lie on the floor, elbows stop at the ground, press up and in.
Bench Press (Dumbbell)|Chest|Dumbbell|8-12|Needs a bench. Elbows 45°, pause an inch off the chest.
Chest Fly (Dumbbell)|Chest|Dumbbell|10-15|Floor or bench. Soft elbows, squeeze the dumbbells together at the top.
Push-Up|Chest|Bodyweight|10-20|Hands under shoulders, body straight, chest to the floor. Raise the feet to make it harder.
Decline Push-Up (feet raised)|Chest|Bodyweight|8-15|Feet on the bed or a chair. Hits the upper chest like an incline press.
Wide Push-Up|Chest|Bodyweight|10-20|Hands wider than the shoulders, elbows out a little. The fly of push-ups.
Slow Push-Up (3-second negative)|Chest|Bodyweight|8-12|Three seconds down, pause on the floor, drive up.
Band Chest Press|Chest|Band|12-20|Band anchored behind you at chest height. Step forward until the start is tense.
Band Fly|Chest|Band|12-20|Anchor behind, arms wide, bring the hands together in front of the chest.
Seated DB Overhead Press|Shoulders (press)|Dumbbell|8-12|Sit tall, press from the ears to lockout, lower slowly.
Arnold Press (Dumbbell)|Shoulders (press)|Dumbbell|8-12|Start palms facing you, rotate out as you press.
Band Overhead Press|Shoulders (press)|Band|12-20|Stand on the band, press overhead. Keep the ribs down.
Pike Push-Up|Shoulders (press)|Bodyweight|8-15|Hips high, hands and head make a triangle, lower the head to the floor.
Side Delts|Side delts|Dumbbell|10-15|Light dumbbells, lead with the elbows, stop at shoulder height.
Band Lateral Raise|Side delts|Band|15-20|Stand on the band, raise to shoulder height, pause at the top.
Lateral Raise (bottle or bag)|Side delts|Bodyweight|15-25|A water bottle or loaded bag in each hand. Slow 3-second negatives.
Side-Lying Lateral Raise (bottle)|Side delts|Bodyweight|15-25|Lie on one side, raise the top arm from the hip to vertical. Each side.
Lateral Raise Hold (isometric)|Side delts|Bodyweight|30-45|Seconds. Arms out at shoulder height, bottles in hand if you have them.
Front Raise (DB)|Front delts|Dumbbell|10-15|Raise to eye level, thumbs slightly up, lower under control.
Band Front Raise|Front delts|Band|15-20|Stand on the band, raise to eye level.
Front Raise (bottle or bag)|Front delts|Bodyweight|15-25|A bottle or loaded bag in each hand, raise to eye level, lower slowly.
Band Pull-Apart|Rear delts|Band|15-25|Arms straight at shoulder height, pull the band to the chest.
Band Face Pull|Rear delts|Band|12-20|Anchor at head height, pull to the face with elbows high.
Seated Bent-Over Reverse Fly (Dumbbell)|Rear delts|Dumbbell|12-15|Sit on the bed edge, chest on the knees so the back stays unloaded, fly the dumbbells out.
Reverse Snow Angel|Rear delts|Bodyweight|15-20|Lie face down, arms sweep from the hips to overhead with the thumbs up.
Overhead Triceps Extension (Dumbbell)|Triceps|Dumbbell|10-15|One dumbbell in both hands, elbows close to the head.
Lying Triceps Extension (Dumbbell)|Triceps|Dumbbell|10-15|On the floor or bench, lower the dumbbells past the ears.
Band Pushdown|Triceps|Band|15-20|Anchor high (door), elbows pinned, press down and out.
Band Overhead Extension|Triceps|Band|15-20|Anchor low, face away, extend overhead.
Diamond Push-Up|Triceps|Bodyweight|8-15|Hands together under the chest, elbows tucked.
Chair Dip|Triceps|Bodyweight|10-20|Hands on a chair or bed edge, legs out, lower until the elbows hit 90°.
Bodyweight Skull Crusher|Triceps|Bodyweight|8-15|Hands on a table edge, body straight, let the head drop under the hands and press back.
Single-Arm Row (Dumbbell)|Lats|Dumbbell|8-12|One hand on the bed or a bench, pull the dumbbell to the hip, chest supported.
Dumbbell Pullover (floor)|Lats|Dumbbell|10-15|Lie down, one dumbbell overhead to the floor behind you, pull back over the chest.
Band Lat Pulldown|Lats|Band|12-20|Anchor high, kneel, pull the elbows to the hips.
Band Straight-Arm Pulldown|Lats|Band|15-20|Anchor high, arms straight, sweep the hands to the thighs.
Band Single-Arm Row|Lats|Band|12-20|Anchor low, pull to the hip, pause at the back.
Pull-Up|Lats|Bodyweight|5-12|Any bar or door-frame bar. Chest to the bar, full stretch at the bottom.
Towel Door Row|Lats|Bodyweight|10-20|Towel through a closed door, lean back, row the chest to the hands.
Single-Arm Towel Row (door)|Lats|Bodyweight|10-15|Each arm. Same set-up, pull the elbow to the hip, pause at the back.
Inverted Row (table)|Mid back|Bodyweight|8-15|Lie under a sturdy table, pull the chest to the edge.
Chest-Supported Row (bed)|Mid back|Dumbbell|8-12|Lie face down on the bed with the arms hanging off the side, row both dumbbells.
Band Seated Row|Mid back|Band|12-20|Sit, band around the feet, pull to the stomach with the shoulder blades back.
Towel Row (door, elbows wide)|Mid back|Bodyweight|10-20|Same towel row, elbows out to the side for the mid back.
Single-Arm Inverted Row (table)|Mid back|Bodyweight|8-12|Each arm. Under the table, one hand on the edge, the other across the chest.
Shrug (Dumbbell)|Traps|Dumbbell|12-20|Straight up to the ears, 2-second hold at the top.
Band Shrug|Traps|Band|15-25|Stand on the band, shrug and hold.
Towel Shrug (door)|Traps|Bodyweight|15-25|Towel row position, keep the arms straight and pull the shoulders back and up.
DB Curl|Biceps|Dumbbell|10-15|Elbows at the sides, full stretch at the bottom.
Hammer Curl (Dumbbell)|Biceps|Dumbbell|10-15|Palms facing in. Hits the brachialis too.
Concentration Curl (Dumbbell)|Biceps|Dumbbell|10-15|Elbow braced on the inside of the knee, slow and strict.
Band Curl|Biceps|Band|15-20|Stand on the band, curl with the elbows fixed.
Band Hammer Curl|Biceps|Band|15-20|Palms in, same elbows-fixed rule.
Chin-Up|Biceps|Bodyweight|5-12|Underhand grip on any bar. Pull the chin over the bar.
Towel Curl (door, underhand)|Biceps|Bodyweight|10-20|Towel row with an underhand grip, elbows tucked, pull the hands to the shoulders.
Goblet Squat (Dumbbell)|Quads|Dumbbell|10-15|Dumbbell at the chest, sit between the heels, knees forward.
Split Squat (Dumbbell)|Quads|Dumbbell|8-12|Dumbbells at the sides, front shin forward, drop straight down.
Step-Up (Dumbbell)|Quads|Dumbbell|10-15|Chair or bench, drive through the whole front foot.
Band Squat|Quads|Band|15-20|Band under the feet and over the shoulders. Pause at the bottom.
Band Leg Extension (seated)|Quads|Band|15-20|Band anchored behind the chair leg, around the ankle, kick straight.
Bodyweight Squat|Quads|Bodyweight|15-25|Slow 3-second descent, pause at the bottom, knees over the toes.
Split Squat|Quads|Bodyweight|12-20|Long stance, front knee forward, back knee to the floor.
Reverse Lunge|Quads|Bodyweight|12-20|Step back, drop the back knee, drive up through the front foot.
Sissy Squat|Quads|Bodyweight|8-15|Hold a door frame, knees forward, lean back and lower. Quads only.
Wall Sit|Quads|Bodyweight|30-60|Seconds. Thighs parallel, back flat on the wall.
Band Leg Curl (lying)|Hamstrings|Band|15-20|Band anchored low behind you, loop at the ankle, lie face down and curl the heel to the glute.
Band Leg Curl (standing)|Hamstrings|Band|15-20|Anchor low, face it, curl one heel back. Hold the wall.
Towel Leg Curl (prone)|Hamstrings|Bodyweight|12-20|Face down, towel around one foot held in both hands, curl against your own pull. Knee flexion only.
Sliding Leg Curl|Hamstrings|Bodyweight|10-15|Lie on your back, heels on a towel on a smooth floor, drag the heels to the glutes and back out. Hips stay down.
Dumbbell Leg Curl (prone)|Hamstrings|Dumbbell|10-15|Face down, dumbbell held between the feet, curl the heels up. Light and slow.
Copenhagen Plank|Adductors|Bodyweight|20-45|Seconds. Top leg on a chair, hold the side plank.
Side-Lying Adduction|Adductors|Bodyweight|15-25|Lie on the side, top leg on a chair, raise the bottom leg to meet it.
Band Standing Adduction|Adductors|Band|15-20|Anchor low to the side, band at the inside ankle, sweep the leg across.
Side-Lying Hip Abduction|Glutes|Bodyweight|15-25|Lie on the side, raise the top leg with the toe slightly down.
Clamshell|Glutes|Bodyweight|20-30|Side-lying, knees bent, open the top knee. Add a band for more.
Band Lateral Walk|Glutes|Band|15-20|Steps each way. Band above the knees, stay low.
Band Side-Lying Hip Abduction|Glutes|Band|15-25|Band above the knees, side-lying, raise the top leg.
Single-Leg Calf Raise (step)|Calves|Bodyweight|15-25|Toes on a step, full stretch at the bottom, 2-second hold at the top.
Calf Raise (Dumbbell)|Calves|Dumbbell|12-20|Dumbbells in hand, toes on a step or book, slow negatives.
Band Seated Calf Raise|Calves|Band|20-30|Sit, band under the toes and held at the knees, point the feet.
Crunch|Core|Bodyweight|15-25|Hands by the ears, lift the shoulder blades, breathe out at the top.
Reverse Crunch|Core|Bodyweight|12-20|Knees to the chest, lift the hips an inch off the floor.
Dead Bug|Core|Bodyweight|10-15|Each side. Lower the opposite arm and leg, keep the lower back pressed down.
Plank|Core|Bodyweight|30-60|Seconds. Squeeze the glutes, tuck the ribs.
Weighted Crunch (Dumbbell)|Core|Dumbbell|12-20|Dumbbell held on the chest or overhead.
Band Kneeling Crunch|Core|Band|15-25|Anchor high, kneel, crunch the elbows to the knees.`;

  const CATALOG = [], BY_NAME = {};
  TRAVEL_SRC.split('\n').forEach(line => {
    const [name, muscle, equip, reps, cue] = line.split('|');
    const [lo, hi] = reps.split('-').map(Number);
    const e = { name, muscle, equip, reps: [lo, hi], cue, seconds: /Seconds\./.test(cue) };
    CATALOG.push(e); BY_NAME[name] = e;
  });

  const swapApi = o => (o && o.swap) || root.ExerciseSwap || null;
  const planName = x => Array.isArray(x) ? x[0] : (x && typeof x === 'object' ? x.name : x);
  const planReps = x => Array.isArray(x) ? Number(x[2]) || null : (x && typeof x === 'object' ? Number(x.reps) || null : null);
  const planSets = x => Array.isArray(x) ? Number(x[3]) || null : (x && typeof x === 'object' ? Number(x.sets) || null : null);

  function isAvoided(name, swap) {
    const X = swapApi({ swap });
    return ownAvoided(name) || !!(X && X.isAvoided(name));
  }

  // Rep range for a kit. Dumbbells keep the plan's reps (+4 for a range); bands and bodyweight
  // use the travel move's own range, never lower than the plan's reps.
  function repsFor(kitId, plan, entry) {
    const base = planReps(plan);
    if (entry && entry.seconds) return { lo: entry.reps[0], hi: entry.reps[1], seconds: true };
    if (kitId === 'dumbbell') {
      if (entry && entry.equip === 'Bodyweight') return { lo: Math.max(entry.reps[0], base || 0), hi: Math.max(entry.reps[1], (base || 0) + 4) };
      const lo = base || (entry ? entry.reps[0] : 8);
      return { lo, hi: lo + 4 };
    }
    if (!entry) { const lo = base || 12; return { lo: lo + 4, hi: lo + 8 }; }
    return { lo: Math.max(entry.reps[0], base || 0), hi: Math.max(entry.reps[1], (base || 0) + 4) };
  }

  /**
   * convert(exercises, {kit, swap, workouts}) -> [{plan, name, muscle, equip, reps:{lo,hi,seconds}, sets, cue, loggerId, via, missing}]
   * exercises: names or the shell's PROGRAM rows [name, w, reps, sets, unit, note].
   * via: 'swap' when the move came from ExerciseSwap's own dumbbell swaps, 'travel' from this catalog.
   */
  function convert(exercises, o) {
    o = o || {};
    const kit = kitOf(o.kit), X = swapApi(o), used = new Set(), out = [];
    const allowed = new Set(kit.equip);
    (exercises || []).forEach(plan => {
      const name = planName(plan);
      const canon = X ? X.canonical(name) : name;
      const self = X ? X.lookup(name) : null;
      const muscle = self ? self.muscle : (BY_NAME[name] ? BY_NAME[name].muscle : null);
      const sets = planSets(plan);
      let pick = null, via = null, loggerId = null;
      const ok = n => !used.has(n) && !isAvoided(n, X) && n !== canon && n !== name;
      // 1. The plan lift already fits the kit (e.g. DB curl with dumbbells): keep it.
      if (self && allowed.has(self.equip) && !isAvoided(name, X)) {
        pick = { name: self.name, muscle: self.muscle, equip: self.equip, reps: BY_NAME[self.name] ? BY_NAME[self.name].reps : null, cue: BY_NAME[self.name] ? BY_NAME[self.name].cue : '' };
        via = 'plan';
      }
      // 2. ExerciseSwap's own ranked swaps, if one uses the kit's equipment.
      if (!pick && X) {
        const opt = X.options(name, { workouts: o.workouts, limit: 30 }).find(x => allowed.has(x.equip) && ok(x.name));
        if (opt) { pick = { name: opt.name, muscle: opt.muscle, equip: opt.equip, reps: BY_NAME[opt.name] ? BY_NAME[opt.name].reps : null, cue: BY_NAME[opt.name] ? BY_NAME[opt.name].cue : '' }; via = 'swap'; loggerId = opt.loggerId; }
      }
      // 3. This catalog: same muscle, kit's own equipment first, then bodyweight fills.
      if (!pick && muscle) {
        const pool = CATALOG.filter(e => e.muscle === muscle && allowed.has(e.equip) && ok(e.name));
        pool.sort((a, b) => kit.equip.indexOf(a.equip) - kit.equip.indexOf(b.equip));
        if (pool.length) { pick = pool[0]; via = 'travel'; }
      }
      if (pick) used.add(pick.name);
      const entry = pick ? BY_NAME[pick.name] || null : null;
      out.push({
        plan: name, name: pick ? pick.name : null, muscle: pick ? pick.muscle : muscle, equip: pick ? pick.equip : null,
        reps: pick ? repsFor(kit.id, plan, entry || (pick.reps ? { reps: pick.reps, equip: pick.equip } : null)) : null,
        sets: sets, cue: pick ? pick.cue || '' : '', loggerId: loggerId || null, via, missing: !pick
      });
    });
    return out;
  }

  // ---------- workout doc ----------
  function apply(doc, items, kitId) {
    const X = swapApi();
    let w = Object.assign({}, doc, { sets: Object.assign({}, doc && doc.sets) });
    w = clear(w);
    const map = {};
    (items || []).forEach(it => {
      if (!it.name || it.missing || it.name === it.plan) return;
      // an earlier manual swap for this slot is replaced, as the shell's doSwap does
      Object.keys(w.swapped || {}).forEach(used => { if (w.swapped[used] === it.plan) { const s = Object.assign({}, w.swapped); delete s[used]; w.swapped = s; } });
      map[it.name] = it.plan;
      if (X) w = X.linkSwap(w, it.plan, it.name);
      else { w.swapped = Object.assign({}, w.swapped, { [it.name]: it.plan }); }
    });
    w.travel = { kit: kitOf(kitId).id, map };
    return w;
  }
  function clear(doc) {
    const w = Object.assign({}, doc);
    if (w.travel && w.travel.map && w.swapped) {
      const s = Object.assign({}, w.swapped);
      Object.keys(w.travel.map).forEach(used => { if (s[used] === w.travel.map[used]) delete s[used]; });
      if (Object.keys(s).length) w.swapped = s; else delete w.swapped;
    }
    delete w.travel;
    return w;
  }
  const active = doc => (doc && doc.travel && doc.travel.kit) || null;

  // ---------- UI ----------
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const fmtReps = r => !r ? '' : r.seconds ? r.lo + '–' + r.hi + ' s' : r.lo + '–' + r.hi + ' reps';

  const css = `
.tw-card .tw-kits{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}
.tw-card .tw-list{margin:8px 0 0;padding:0;list-style:none;display:grid;gap:8px}
.tw-card .tw-list li{display:grid;grid-template-columns:1fr auto;gap:2px 10px;padding:8px 10px;border-radius:var(--r,10px);background:var(--sunk,rgba(0,0,0,.04))}
.tw-card .tw-list li b{font-weight:600}
.tw-card .tw-list .tw-reps{font-family:var(--mono,ui-monospace,monospace);font-size:.85rem;color:var(--muted);white-space:nowrap}
.tw-card .tw-list .tw-sub{grid-column:1/-1;font-size:.82rem;color:var(--muted)}
.tw-card .tw-list li.tw-missing{border:1px dashed var(--line);background:transparent}
.tw-card .tw-on{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:6px}
`;

  /**
   * cardHtml({session, exercises, kit, items, active, open})
   * active: kit id when the day's workout already carries a travel conversion, else null.
   * open: show the full conversion list (default when active or when the user tapped a kit).
   */
  function cardHtml(o) {
    o = o || {};
    const kit = kitOf(o.active || o.kit);
    const items = o.items || convert(o.exercises, { kit: kit.id, swap: o.swap, workouts: o.workouts });
    const chips = KITS.map(k => '<button class="chip" data-act="twkit" data-kit="' + k.id + '" aria-pressed="' + (k.id === kit.id) + '">' + esc(k.label) + '</button>').join('');
    const list = items.map(it => it.missing
      ? '<li class="tw-missing"><b>' + esc(it.plan) + '</b><span class="tw-reps">skip</span><span class="tw-sub">No safe ' + esc(kit.label.toLowerCase()) + ' version. Add a set to the next ' + esc(it.muscle || '') + ' move.</span></li>'
      : '<li><b>' + esc(it.name) + '</b><span class="tw-reps">' + (it.sets ? '×' + it.sets + ' · ' : '') + esc(fmtReps(it.reps)) + '</span>' +
        '<span class="tw-sub">for ' + esc(it.plan) + (it.cue ? ' · ' + esc(it.cue) : '') + '</span></li>').join('');
    const n = items.filter(i => !i.missing).length;
    const body = o.active
      ? '<div class="tw-on"><span class="pill good">Travel version on · ' + esc(kit.label) + '</span><button class="btn ghost small" data-act="twclear">Back to the gym plan</button></div>' +
        '<p class="muted" style="font-size:.85rem;margin-top:6px">Sets log under the travel names below. History stays linked to the plan lift.</p>'
      : '<p class="muted" style="font-size:.88rem">' + esc(kit.hint) + '</p>' +
        '<div class="tw-on"><button class="btn small" data-act="twapply" data-kit="' + kit.id + '">Use this version today (' + n + ' of ' + items.length + ')</button></div>';
    return '<div class="card tw-card"><details' + (o.open || o.active ? ' open' : '') + ' data-keep="travel"><summary><b>Travel workout</b> <span class="muted" style="font-size:.85rem">' + (o.active ? kit.label : 'no gym? convert ' + esc(o.session || 'this session')) + '</span></summary>' +
      '<div class="tw-kits">' + chips + '</div>' + body + '<ul class="tw-list">' + list + '</ul></details></div>';
  }

  const api = { KITS, kitOf, catalog: CATALOG, isAvoided, convert, repsFor, apply, clear, active, cardHtml, css };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TravelWorkout = api;
})(typeof window !== 'undefined' ? window : this);
