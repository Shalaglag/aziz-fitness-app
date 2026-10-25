// Run: node modules/exercise-swap/test.js
const assert = require('assert');
const X = require('./exercise-swap.js');
const PLAN = ["Bench Press (Barbell)","Lateral Raise (Cable)","Incline DB Press","Cable Crossover","Triceps Extension (Cable)","Triceps Pushdown (Straight bar)","Standing Side Delts (Machine)","Lat Pulldown, Wide","Lat Pulldown, Single Arm","Seated Row (Cable)","Pullover (Machine)","DB Curl","Seated Bicep Curl","Reverse Fly (Machine)","Leg Extension","Hack Squat","Smith Squat","Lying Leg Curl","Hip Adductor","Standing Calf Raise","Seated Abs","Gundam (Chest Machine)","Seated DB Overhead Press","Side Delts","Front Raise (DB)","Triceps Rope","T-Bar Row","Iso-Lateral Low Row","Traps Machine","Cable Standing Biceps","Hip Abductor","Calf Press on Seated Leg Press"];
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };

t('avoid list catches hinges and lookalikes', () => {
  ['Deadlift (Barbell)','Romanian Deadlift (Dumbbell)','RDL','Stiff-leg deadlift','Hip Thrust (Machine)','Back Extension','45° Hyperextension','Good Morning','Glute Bridge','Glute-Ham Raise','Reverse Hyper (Machine)','Cable Pull-Through','Kettlebell Swing','Nordic Curl','Rack Pull','Trap-bar deadlift','Roman chair'].forEach(s => assert(X.isAvoided(s), s));
  ['Leg Press (Machine)','Lying Leg Curl','Hack Squat','Chest-Supported Row (Machine)','Glute Kickback (Machine)','Hip Abductor'].forEach(s => assert(!X.isAvoided(s), s));
});
t('every plan lift has safe swaps, never itself, never a hinge', () => {
  PLAN.forEach(p => {
    const o = X.options(p, { limit: 20 });
    assert(o.length >= 2, p + ' has ' + o.length);
    o.forEach(x => { assert(!X.isAvoided(x.name), x.name); assert.notStrictEqual(X.canonical(x.name), X.canonical(p)); });
  });
  X.catalog.forEach(e => assert(!X.isAvoided(e.name) && !X.isAvoided(e.lib), e.name));
});
t('every swap target exists in the catalog', () => {
  Object.entries(X.swaps).forEach(([k, v]) => { assert(X.lookup(k), k); v.forEach(n => assert(X.lookup(n), n)); });
});
t('reference order: first choices', () => {
  assert.strictEqual(X.options('Hack Squat')[0].name, 'Pendulum Squat (Machine)');
  assert.strictEqual(X.options('Lying Leg Curl')[0].name, 'Seated Leg Curl (Machine)');
  assert.strictEqual(X.options('Seated Row (Cable)')[0].name, 'Iso-Lateral Low Row');
});
t('aliases from the logger and form guide resolve', () => {
  assert.strictEqual(X.canonical('Hack Squat (Machine)'), 'Hack Squat');
  assert.strictEqual(X.canonical('Lateral Raise (Dumbbell)'), 'Side Delts');
  assert.strictEqual(X.canonical('Gundam (chest machine)'), 'Gundam (Chest Machine)');
  assert.strictEqual(X.options('Lat Pulldown - Wide Grip (Cable)')[0].name, 'Assisted Pull Up (Machine)');
  assert.strictEqual(X.options('Hack Squat')[0].loggerId, 'pendulum-squat-machine');
});
t('unknown or avoided input still gives safe options or none', () => {
  assert.deepStrictEqual(X.options('Something new'), []);
  X.options('Romanian Deadlift (Barbell)').forEach(x => assert(!X.isAvoided(x.name)));
});
t('history stays linked through a swap', () => {
  let w1 = { date: '2026-10-20', session: 'Lower A', sets: { 'Hack Squat': [{ w: 70, r: 8 }] } };
  let w2 = { date: '2026-10-27', session: 'Lower A', sets: { 'Pendulum Squat (Machine)': [{ w: 60, r: 10 }, { w: 65, r: 8 }] } };
  w2 = X.linkSwap(w2, 'Hack Squat', 'Pendulum Squat (Machine)');
  assert.deepStrictEqual(w2.swapped, { 'Pendulum Squat (Machine)': 'Hack Squat' });
  const h = X.history('Hack Squat', [w1, w2]);
  assert.strictEqual(h.length, 2);
  assert.deepStrictEqual(h.map(x => x.via), ['swap', 'direct']);
  assert.strictEqual(h[0].name, 'Pendulum Squat (Machine)');
  const hs = X.history('Pendulum Squat (Machine)', [w1, w2]);
  assert.strictEqual(hs.length, 1); assert.strictEqual(hs[0].slot, 'Hack Squat');
  // last time on the substitute shows its own top set, not the hack squat's number
  assert.deepStrictEqual(X.options('Hack Squat', { workouts: [w1, w2] })[0].last, { date: '2026-10-27', w: 65, r: 8, unit: null });
  // undoing the link
  assert.strictEqual(X.linkSwap(w2, null, 'Pendulum Squat (Machine)').swapped, undefined);
  // object-of-docs input works too
  assert.strictEqual(X.history('Hack Squat', { a: w1, b: w2 }).length, 2);
});
t('hurt flag suggests a swap next time and sinks the hurt lift', () => {
  let s = X.empty();
  s = X.flagHurt(s, 'Seated DB Overhead Press', { date: '2026-10-25', note: 'right shoulder' });
  const p = X.pending(['Gundam (Chest Machine)', 'Seated DB Overhead Press', 'Side Delts'], s);
  assert.strictEqual(p.length, 1);
  assert.strictEqual(p[0].exercise, 'Seated DB Overhead Press');
  assert.strictEqual(p[0].suggest.name, 'Shoulder Press (Machine)');
  assert.strictEqual(p[0].flagged.note, 'right shoulder');
  // the machine press hurt too -> it drops below the others
  s = X.flagHurt(s, 'Shoulder Press (Machine)', { date: '2026-10-26' });
  const o = X.options('Seated DB Overhead Press', { state: s });
  assert.strictEqual(o[o.length - 1].name, 'Shoulder Press (Machine)');
  assert.strictEqual(X.pending(['Seated DB Overhead Press'], s)[0].suggest.name, 'Smith Seated Press');
  // repeat flags count up; clearing removes
  s = X.flagHurt(s, 'Seated DB Overhead Press');
  assert.strictEqual(X.hurtInfo(s, 'Seated DB Overhead Press').times, 2);
  assert.strictEqual(X.hurtInfo(s, 'Seated DB Overhead Press').note, 'right shoulder');
  s = X.clearHurt(s, 'Seated DB Overhead Press');
  assert.strictEqual(X.pending(['Seated DB Overhead Press'], s).length, 0);
  // PROGRAM rows ([name, w, r, ...]) are accepted
  assert.strictEqual(X.pending([['Shoulder Press (Machine)', 60, 8]], s).length, 1);
});
t('state helpers do not mutate input', () => {
  const s = X.empty(); X.flagHurt(s, 'Hack Squat'); X.recordSwap(s, { from: 'Hack Squat', to: 'Leg Press (Machine)' });
  assert.deepStrictEqual(s, { hurt: {}, log: [] });
});
t('a stand-in used before ranks among options', () => {
  let s = X.recordSwap(X.empty(), { date: '2026-10-25', from: 'Smith Squat', to: 'Hack Squat', reason: 'taken' });
  assert(X.options('Smith Squat', { state: s }).some(x => x.name === 'Hack Squat' && x.why === 'Used before'));
});
t('exclude drops lifts already in the session', () => {
  const o = X.options('Hack Squat', { exclude: ['Smith Squat', 'Leg Extension'] }).map(x => x.name);
  assert(!o.includes('Smith Squat') && !o.includes('Leg Extension') && o[0] === 'Pendulum Squat (Machine)');
});
console.log(n + ' tests passed');
