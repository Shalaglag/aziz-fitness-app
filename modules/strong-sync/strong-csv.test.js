const test = require("node:test");
const assert = require("node:assert");
const StrongCSV = require("./strong-csv.js");

// Trimmed from Aziz's real export (Nov 2026 layout: quoted, semicolon, "Weight (kg)", "Note" rows).
const CSV = `"Workout #";"Date";"Workout Name";"Duration (sec)";"Exercise Name";"Set Order";"Weight (kg)";"Reps";"RPE";"Distance (meters)";"Seconds";"Notes";"Workout Notes"
"1";"2026-10-28 15:56:18";"Push A";"3900";"Bench Press (Barbell)";"1";"90.0";"8";"";"";"";"";""
"1";"2026-10-28 15:56:18";"Push A";"3900";"Bench Press (Barbell)";"2";"90.0";"7";"";"";"";"";""
"1";"2026-10-28 15:56:18";"Push A";"3900";"Incline Bench Press (Dumbbell)";"Note";"";"";"";"";"";"Lbs";""
"1";"2026-10-28 15:56:18";"Push A";"3900";"Incline Bench Press (Dumbbell)";"1";"29.48348";"10";"";"";"";"";""
"1";"2026-10-28 15:56:18";"Push A";"3900";"Incline Bench Press (Dumbbell)";"2";"";"";"";"";"";"";""
"1";"2026-10-28 15:56:18";"Push A";"3900";"Gundam";"1";"60.0";"8";"";"";"";"";""
"1";"2026-10-28 15:56:18";"Push A";"3900";"Bench Press (Dumbbell)";"1";"30.0";"10";"";"";"";"";""
"2";"2026-10-29 15:57:54";"Back triceps abs";"3000";"Lat Pulldown - Wide Grip (Cable)";"1";"80.0";"8";"";"";"";"";""
"2";"2026-10-29 15:57:54";"Back triceps abs";"3000";"traps machine (front back)";"1";"80.0";"10";"";"";"";"";""
"2";"2026-10-29 15:57:54";"Back triceps abs";"3000";"Seated abs";"1";"5.0";"100";"";"";"";"";""
`;

const PROGRAM = {
  "Push A": [["Bench Press (Barbell)", 90, 8, 2, "kg"], ["Incline DB Press", 65, 10, 2, "lb"], ["Gundam (Chest Machine)", 60, 8, 3, "kg"]],
  "Pull B": [["Lat Pulldown, Wide", 80, 8, 3, "kg"], ["Traps Machine", 80, 10, 2, "kg"], ["Seated Abs", 5, 100, 1, "kg"]],
};
const ROTATION = ["Push A", "Pull B"];

test("parses the quoted semicolon export, skips Note rows and empty sets", () => {
  const w = StrongCSV.parse(CSV);
  assert.equal(w.length, 2);
  assert.equal(w[0].date, "2026-10-28");
  assert.equal(w[0].durationMin, 65);
  const inc = w[0].exercises.find(e => e.name === "Incline Bench Press (Dumbbell)");
  assert.equal(inc.sets.length, 1);
});

test("maps Aziz's Strong names to the program and converts lb exercises", () => {
  const { docs, report } = StrongCSV.toWorkouts(CSV, { program: PROGRAM, rotation: ROTATION });
  const d1 = docs["2026-10-28"], d2 = docs["2026-10-29"];
  assert.equal(d1.session, "Push A");
  assert.deepEqual(d1.sets["Incline DB Press"], [{ w: 65, r: 10 }]);
  assert.deepEqual(d1.sets["Gundam (Chest Machine)"], [{ w: 60, r: 8 }]);
  assert.equal(d2.session, "Pull B");
  assert.ok(d2.sets["Lat Pulldown, Wide"] && d2.sets["Traps Machine"] && d2.sets["Seated Abs"]);
  assert.equal(report.workouts, 2);
  assert.equal(report.sets, 8);
});

test("a dumbbell bench never lands on the barbell bench", () => {
  const { docs, report } = StrongCSV.toWorkouts(CSV, { program: PROGRAM, rotation: ROTATION });
  assert.deepEqual(docs["2026-10-28"].sets["Bench Press (Barbell)"], [{ w: 90, r: 8 }, { w: 90, r: 7 }]);
  assert.deepEqual(docs["2026-10-28"].sets["Bench Press (Dumbbell)"], [{ w: 30, r: 10 }]);
  assert.deepEqual(Object.keys(report.unmatched), ["Bench Press (Dumbbell)"]);
  assert.equal(StrongCSV.matchName("seated chest cable", ["Seated Row (Cable)"]), null);
});

test("re-import keeps app-typed sets and drops the previous Strong keys, even renamed ones", () => {
  const first = StrongCSV.toWorkouts(CSV, { program: PROGRAM, rotation: ROTATION }).docs;
  const existing = JSON.parse(JSON.stringify(first));
  existing["2026-10-28"].sets["Cable Crossover"] = [{ w: 16.5, r: 10 }]; // typed in the app
  existing["2026-10-28"].sets["Gundam"] = [{ w: 55, r: 8 }]; // saved under its Strong name by an older importer
  existing["2026-10-28"].strong.names.push("Gundam");
  const { docs } = StrongCSV.toWorkouts(CSV, { program: PROGRAM, rotation: ROTATION, existing });
  const d = docs["2026-10-28"];
  assert.deepEqual(d.sets["Cable Crossover"], [{ w: 16.5, r: 10 }]);
  assert.equal(d.sets["Gundam"], undefined);
  assert.deepEqual(d.sets["Gundam (Chest Machine)"], [{ w: 60, r: 8 }]);
  assert.deepEqual(d.sets["Bench Press (Barbell)"].length, 2);
  assert.ok(d.strong.names.includes("Bench Press (Barbell)") && !d.strong.names.includes("Gundam"));
});
