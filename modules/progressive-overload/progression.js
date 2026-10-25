// Double progression for Aziz's program. Pairs with overload-program.json.
// nextStep(exercise, increments, setReps, rirOk) -> what to do next session.
//   exercise:   one entry of overload-program.json "exercises"
//   increments: overload-program.json "increments"
//   setReps:    reps done on each working set at exercise.load, e.g. [10, 9]
//   rirOk:      true if the sets ended 1-2 reps short of failure with clean form

function nextStep(exercise, increments, setReps, rirOk = true) {
  const { load, unit, min, max } = exercise;
  if (exercise.excluded || min == null) {
    return { action: "confirm", load, text: exercise.note || "Confirm this exercise's numbers first." };
  }
  const reps = setReps.filter((r) => Number.isFinite(r) && r > 0);
  if (!reps.length) return { action: "none", load, text: "Enter the reps for each working set." };

  const inc = increments[exercise.equipment];
  const lowest = Math.min(...reps);

  if (lowest >= max && rirOk) {
    const next = Math.round((load + inc.amount) * 100) / 100;
    return {
      action: "add-load",
      load: next,
      text: `Every set hit ${max}. Next session use ${next} ${unit}, which is ${inc.label}, and aim for ${min}+ reps on every set.`,
    };
  }
  if (lowest >= max && !rirOk) {
    return { action: "hold", load, text: `You reached ${max} but it was a grind. Repeat ${load} ${unit} until ${max} feels like 1-2 reps left.` };
  }
  if (Math.max(...reps) < min) {
    return {
      action: "below-range",
      load,
      text: `Every set was under ${min}. Keep ${load} ${unit}. If this happens 2 sessions in a row, take 5-10% off and rebuild.`,
    };
  }
  const targets = reps.map((r) => (r === lowest ? Math.min(r + 1, max) : r));
  return {
    action: "add-reps",
    load,
    targets,
    text: `Keep ${load} ${unit}. Aim for ${targets.join(", ")} reps.`,
  };
}

if (typeof module !== "undefined") module.exports = { nextStep };
