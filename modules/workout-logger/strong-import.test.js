// Run: node --test modules/workout-logger/strong-import.test.js
const test = require('node:test');
const assert = require('node:assert');
require('./workout-logger.js');
const WL = globalThis.WorkoutLogger;

// Trimmed from Aziz's real export (Nov 2026 layout: quoted, semicolon, "Weight (kg)", "Duration (sec)", Note rows).
const CSV = `"Workout #";"Date";"Workout Name";"Duration (sec)";"Exercise Name";"Set Order";"Weight (kg)";"Reps";"RPE";"Distance (meters)";"Seconds";"Notes";"Workout Notes"
"1";"2026-10-28 15:56:18";"Push A";"3900";"Bench Press (Barbell)";"1";"90.0";"8";"";"";"";"";""
"1";"2026-10-28 15:56:18";"Push A";"3900";"Bench Press (Barbell)";"2";"90.0";"7";"";"";"";"";""
"1";"2026-10-28 15:56:18";"Push A";"3900";"Incline Bench Press (Dumbbell)";"Note";"";"";"";"";"";"Lbs";""
"1";"2026-10-28 15:56:18";"Push A";"3900";"Incline Bench Press (Dumbbell)";"1";"29.48348";"10";"";"";"";"";""
"1";"2026-10-28 15:56:18";"Push A";"3900";"Incline Bench Press (Dumbbell)";"2";"";"";"";"";"";"";""
"1";"2026-10-28 15:56:18";"Push A";"3900";"Gundam";"1";"60.0";"8";"";"";"";"";""
"1";"2026-10-28 15:56:18";"Push A";"3900";"Flat Bench Neutral Grip";"1";"30.0";"10";"";"";"";"";""
"2";"2026-10-29 15:57:54";"Back triceps abs";"3000";"Lat Pulldown - Wide Grip (Cable)";"1";"80.0";"8";"";"";"";"";""
"2";"2026-10-29 15:57:54";"Back triceps abs";"3000";"traps machine (front back)";"W";"40.0";"10";"";"";"";"";""
"2";"2026-10-29 15:57:54";"Back triceps abs";"3000";"traps machine (front back)";"1";"80.0";"10";"";"";"";"";""
"2";"2026-10-29 15:57:54";"Back triceps abs";"3000";"Seated abs";"1";"5.0";"100";"";"";"";"";""
`;

test('parses the real layout into finished logger workouts with duration, sets and library ids', () => {
  const { workouts, newExercises, error } = WL.parseStrong(CSV, { existing: [] });
  assert.equal(error, undefined);
  assert.equal(workouts.length, 2);
  const [a, b] = workouts.map(x => x.doc);
  assert.equal(a.name, 'Push A'); assert.equal(a.templateName, 'Push A');
  assert.equal(a.end - a.start, 3900 * 1000);
  assert.ok(a.imported && a.end, 'counts as a finished workout in History');
  assert.deepEqual(a.exercises.map(e => e.exId), ['bench-press-barbell', 'incline-bench-press-dumbbell', 'gundam-chest-press-machine', 'c-flat-bench-neutral-grip']);
  assert.deepEqual(a.exercises[0].sets.map(s => [s.w, s.r, s.t, s.done]), [[90, 8, 'n', true], [90, 7, 'n', true]]);
  assert.deepEqual(b.exercises.map(e => e.exId), ['lat-pulldown-wide-grip-cable', 'shrug-machine', 'seated-abs-machine']);
  assert.deepEqual(b.exercises[1].sets.map(s => s.t), ['w', 'n']);
  assert.deepEqual(newExercises.map(e => e.name), ['Flat Bench Neutral Grip']);
});

test('lb exercises come out in lb, Note rows and empty sets are dropped', () => {
  const a = WL.parseStrong(CSV, { existing: [] }).workouts[0].doc;
  const inc = a.exercises[1];
  assert.equal(inc.unit, 'lb');
  assert.deepEqual(inc.sets.map(s => [s.w, s.r]), [[65, 10]]);
});

test('re-import updates the earlier import and skips a day already logged in the app', () => {
  const first = WL.parseStrong(CSV, { existing: [] }).workouts.map(x => x.doc);
  const again = WL.parseStrong(CSV, { existing: first });
  assert.deepEqual(again.workouts.map(x => x.action), ['update', 'update']);
  const logged = [{ id: 'abc', name: 'Pull A', start: new Date('2026-10-29T18:00:00').getTime(), end: 1, exercises: [] }];
  const mixed = WL.parseStrong(CSV, { existing: logged });
  assert.deepEqual(mixed.workouts.map(x => x.action), ['add', 'skip']);
});

test('the old comma layout still imports', () => {
  const old = 'Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE\n2026-10-27 17:30:00,Workout,1h 5m,Lat Pulldown (Cable),1,80,8,0,0,,,\n';
  const { workouts } = WL.parseStrong(old, { existing: [] });
  assert.equal(workouts.length, 1);
  assert.equal(workouts[0].doc.end - workouts[0].doc.start, 65 * 60000);
  assert.deepEqual(workouts[0].doc.exercises[0].sets[0].w, 80);
});
