/* Liftbook: Strong-style workout logger for Aziz's fitness app.
 * Plain JS, no imports, no network. Mount with:
 *   WorkoutLogger.mount(element, { storage, onFinish, weights })
 * storage: { list(coll) -> Promise<doc[]>, put(coll, id, doc) -> Promise, remove(coll, id) -> Promise }
 *   Collections used: lb_templates, lb_workouts, lb_exercises, lb_measures, lb_meta.
 *   Omit storage to use localStorage.
 * onFinish(workout, shellRecord): called after a workout is saved. shellRecord matches the
 *   app shell's workouts/{date} shape: {date, session, idx, sets:{name:[{w,r}]}, treadmill}.
 * weights: optional { list() -> Promise<[{date:'YYYY-MM-DD', kg}]>, put(date, kg) -> Promise }
 *   so body weight logs go to the shell's own weights collection.
 * formCues: optional FormCues.create(guide) instance (form cues, no external links).
 * anim: optional ExerciseAnim.create() instance. Exercises it has get a built-in 3D animated demo in Gym
 *   mode and the exercise sheet, and the Demo button opens it full screen.
 * Voice: when window.VoiceLog exists, the live workout header shows a mic that opens VoiceLog's sheet and logs the
 *   spoken sets into the current workout (exported as WorkoutLogger.applyVoice for tests).
 * targets: optional AppTargets.resolve(...) object; the body-weight goal reads targets.goalKg.
 * Rest timer look (settings.restStyle: bar | half | ring | fill | plates | blocks; ring and fill take the whole
 * screen like Strong), notification countdown look (settings.restNotify: big | clock | bar | plain | endsAt, sent as
 * `look` on lb:rest for the Android shell) *   screen like Strong) and end sound (settings.restSound: a GymSounds.REST_SOUNDS id) are picked in Settings. A ticked set plays
 *   settings.setSound (a GymSounds.SET_SOUNDS id, default 'check' = Aziz's recording, or 'off').
 * Live workouts open in Gym mode (one set at a time, big steppers, RIR, rest countdown with "up next");
 *   "List view" in the header switches to the full table. Sets may carry rir (0-4, 4 = 4+).
 * Styling uses the shell tokens (--bg --surface --sunk --line --ink --muted --accent --accent-ink
 *   --good --warn --bad --display --body --mono --r) with fallbacks.
 */
(function (global) {
  'use strict';

  // ---------- Exercise library ----------
  // name | body part | category | flags (c = compound, x = avoided in Aziz's plan)
  const LIB_SRC = `Bench Press (Barbell)|Chest|Barbell|c
Incline Bench Press (Barbell)|Chest|Barbell|c
Decline Bench Press (Barbell)|Chest|Barbell|c
Close-Grip Bench Press (Barbell)|Triceps|Barbell|c
Bench Press (Dumbbell)|Chest|Dumbbell|c
Incline Bench Press (Dumbbell)|Chest|Dumbbell|c
Bench Press (Smith Machine)|Chest|Smith machine|c
Incline Bench Press (Smith Machine)|Chest|Smith machine|c
Chest Press (Machine)|Chest|Machine|c
Gundam Chest Press (Machine)|Chest|Machine|c
Incline Chest Press (Machine)|Chest|Machine|c
Chest Fly (Dumbbell)|Chest|Dumbbell|
Pec Deck (Machine)|Chest|Machine|
Cable Crossover|Chest|Cable|
Low-to-High Cable Fly|Chest|Cable|
Push Up|Chest|Bodyweight|
Chest Dip|Chest|Bodyweight|c
Decline Bench Press (Dumbbell)|Chest|Dumbbell|c
Incline Chest Fly (Dumbbell)|Chest|Dumbbell|
Chest Fly (Cable)|Chest|Cable|
Incline Cable Fly|Chest|Cable|
Chest Press (Plate-loaded)|Chest|Plate-loaded|c
Pullover (Dumbbell)|Chest|Dumbbell|
Weighted Dip|Chest|Bodyweight|c
Decline Bench Press (Smith Machine)|Chest|Smith machine|c
Chest Press (Cable)|Chest|Cable|c
Floor Press (Barbell)|Chest|Barbell|c
Incline Chest Press (Plate-loaded)|Chest|Plate-loaded|c
Decline Chest Press (Machine)|Chest|Machine|c
Incline Push Up|Chest|Bodyweight|
Decline Push Up|Chest|Bodyweight|
Diamond Push Up|Chest|Bodyweight|
Landmine Press|Chest|Barbell|c
Svend Press (Plate)|Chest|Plate-loaded|c
Wide Push Up|Chest|Bodyweight|
Lat Pulldown - Wide Grip (Cable)|Back|Cable|c
Lat Pulldown - Close Grip (Cable)|Back|Cable|c
Lat Pulldown - Single Arm (Cable)|Back|Cable|
Lat Pulldown (Machine)|Back|Machine|c
Pull Up|Back|Bodyweight|c
Chin Up|Back|Bodyweight|c
Assisted Pull Up (Machine)|Back|Assisted|c
Seated Row (Cable)|Back|Cable|c
Seated Row (Machine)|Back|Machine|c
Iso-Lateral Low Row (Plate-loaded)|Back|Plate-loaded|c
Iso-Lateral High Row (Plate-loaded)|Back|Plate-loaded|c
T-Bar Row|Back|Plate-loaded|c
Bent Over Row (Barbell)|Back|Barbell|c
One-Arm Row (Dumbbell)|Back|Dumbbell|c
Chest-Supported Row (Machine)|Back|Machine|c
Pullover (Machine)|Back|Machine|
Straight-Arm Pulldown (Cable)|Back|Cable|
Shrug (Machine)|Back|Machine|
Shrug (Dumbbell)|Back|Dumbbell|
Shrug (Barbell)|Back|Barbell|
Deadlift (Barbell)|Back|Barbell|cx
Romanian Deadlift (Barbell)|Hamstrings|Barbell|cx
Romanian Deadlift (Dumbbell)|Hamstrings|Dumbbell|cx
Back Extension|Back|Bodyweight|x
Lat Pulldown (Reverse Grip)|Back|Cable|c
Lat Pulldown (V-Bar)|Back|Cable|c
Lat Pulldown (Neutral Grip)|Back|Cable|c
Pull Up (Wide Grip)|Back|Bodyweight|c
Pull Up (Neutral Grip)|Back|Bodyweight|c
Pull Up (Weighted)|Back|Bodyweight|c
Seated Row (Wide Grip, Cable)|Back|Cable|c
Seated Row (Single Arm, Cable)|Back|Cable|c
Seated Row (Neutral Grip, Cable)|Back|Cable|c
Bent Over Row (Dumbbell)|Back|Dumbbell|c
Chest-Supported Row (Dumbbell)|Back|Dumbbell|c
Chest-Supported T-Bar Row (Machine)|Back|Plate-loaded|c
High Row (Machine)|Back|Machine|c
Low Row (Machine)|Back|Machine|c
Sumo Deadlift (Barbell)|Back|Barbell|cx
Trap Bar Deadlift|Back|Barbell|cx
Lat Pulldown (Plate-loaded)|Back|Plate-loaded|c
Chin Up (Weighted)|Back|Bodyweight|
Inverted Row|Back|Bodyweight|c
Bent Over Row (Reverse Grip, Barbell)|Back|Barbell|c
Pendlay Row (Barbell)|Back|Barbell|c
Chest-Supported Row (Plate-loaded)|Back|Plate-loaded|c
Row (Smith Machine)|Back|Smith machine|c
Rear Delt Row (Dumbbell)|Back|Dumbbell|c
Pullover (Cable)|Back|Cable|
Straight-Arm Pulldown (Rope)|Back|Cable|c
Rack Pull (Barbell)|Back|Barbell|cx
Hyperextension (Weighted)|Back|Bodyweight|
Shrug (Smith Machine)|Back|Smith machine|
Standing Row (Cable)|Back|Cable|c
Landmine Row|Back|Barbell|c
Meadows Row|Back|Barbell|c
Deficit Deadlift (Barbell)|Back|Barbell|cx
Deadlift (Smith Machine)|Back|Smith machine|cx
Deadlift (Dumbbell)|Back|Dumbbell|cx
Shrug (Cable)|Back|Cable|
Farmer's Walk|Back|Dumbbell|
Overhead Press (Barbell)|Shoulders|Barbell|c
Seated Overhead Press (Dumbbell)|Shoulders|Dumbbell|c
Shoulder Press (Machine)|Shoulders|Machine|c
Arnold Press (Dumbbell)|Shoulders|Dumbbell|c
Lateral Raise (Dumbbell)|Shoulders|Dumbbell|
Lateral Raise (Cable)|Shoulders|Cable|
Lateral Raise (Machine)|Shoulders|Machine|
Standing Lateral Raise (Machine)|Shoulders|Machine|
Front Raise (Dumbbell)|Shoulders|Dumbbell|
Front Raise (Cable)|Shoulders|Cable|
Reverse Fly (Machine)|Shoulders|Machine|
Reverse Fly (Dumbbell)|Shoulders|Dumbbell|
Face Pull (Cable)|Shoulders|Cable|
Upright Row (Cable)|Shoulders|Cable|
Overhead Press (Dumbbell)|Shoulders|Dumbbell|c
Seated Overhead Press (Barbell)|Shoulders|Barbell|c
Overhead Press (Smith Machine)|Shoulders|Smith machine|c
Shoulder Press (Plate-loaded)|Shoulders|Plate-loaded|c
Lateral Raise (Single Arm, Cable)|Shoulders|Cable|
Reverse Fly (Cable)|Shoulders|Cable|
Seated Overhead Press (Smith Machine)|Shoulders|Smith machine|c
Push Press (Barbell)|Shoulders|Barbell|c
Lateral Raise (Seated, Dumbbell)|Shoulders|Dumbbell|
Lateral Raise (Plate-loaded)|Shoulders|Plate-loaded|
Front Raise (Barbell)|Shoulders|Barbell|
Front Raise (Rope, Cable)|Shoulders|Cable|
Reverse Fly (Seated, Dumbbell)|Shoulders|Dumbbell|
Reverse Fly (Incline, Dumbbell)|Shoulders|Dumbbell|
Upright Row (Barbell)|Shoulders|Barbell|c
Upright Row (Dumbbell)|Shoulders|Dumbbell|c
Rotator Cuff External Rotation (Cable)|Shoulders|Cable|
Landmine Shoulder Press|Shoulders|Barbell|c
Front Raise (Plate)|Shoulders|Plate-loaded|
Y Raise (Cable)|Shoulders|Cable|
Bicep Curl (Barbell)|Biceps|Barbell|
Bicep Curl (Dumbbell)|Biceps|Dumbbell|
Hammer Curl (Dumbbell)|Biceps|Dumbbell|
Incline Curl (Dumbbell)|Biceps|Dumbbell|
Preacher Curl (Machine)|Biceps|Machine|
Preacher Curl (EZ Bar)|Biceps|Barbell|
Seated Bicep Curl (Machine)|Biceps|Machine|
Standing Bicep Curl (Cable)|Biceps|Cable|
Bayesian Curl (Cable)|Biceps|Cable|
Concentration Curl (Dumbbell)|Biceps|Dumbbell|
Bicep Curl (EZ Bar)|Biceps|Barbell|
Bicep Curl (Cable)|Biceps|Cable|
Bicep Curl (Single Arm, Cable)|Biceps|Cable|
Bicep Curl (Seated, Dumbbell)|Biceps|Dumbbell|
Hammer Curl (Cable Rope)|Biceps|Cable|
Preacher Curl (Dumbbell)|Biceps|Dumbbell|
Bicep Curl (Rope, Cable)|Biceps|Cable|
Hammer Curl (Cross Body, Dumbbell)|Biceps|Dumbbell|
Incline Hammer Curl (Dumbbell)|Biceps|Dumbbell|
Preacher Curl (Cable)|Biceps|Cable|
Preacher Curl (Barbell)|Biceps|Barbell|
Spider Curl (Dumbbell)|Biceps|Dumbbell|
Overhead Cable Curl|Biceps|Cable|
Zottman Curl (Dumbbell)|Biceps|Dumbbell|
Drag Curl (Barbell)|Biceps|Barbell|
Curl (Smith Machine)|Biceps|Smith machine|
Triceps Pushdown (Straight Bar)|Triceps|Cable|
Triceps Rope Pushdown (Cable)|Triceps|Cable|
Triceps Extension (Cable)|Triceps|Cable|
Single-Arm Pushdown (Cable)|Triceps|Cable|
Skull Crusher (EZ Bar)|Triceps|Barbell|
Overhead Triceps Extension (Dumbbell)|Triceps|Dumbbell|
Triceps Dip (Machine)|Triceps|Machine|
Bench Dip|Triceps|Bodyweight|c
Triceps Dip|Triceps|Bodyweight|c
Triceps Extension (Machine)|Triceps|Machine|
Triceps Kickback (Dumbbell)|Triceps|Dumbbell|
Triceps Pushdown (V-Bar)|Triceps|Cable|
Triceps Kickback (Cable)|Triceps|Cable|
Triceps Pushdown (Reverse Grip)|Triceps|Cable|
Lying Triceps Extension (Dumbbell)|Triceps|Dumbbell|
Skull Crusher (Dumbbell)|Triceps|Dumbbell|
Skull Crusher (Cable)|Triceps|Cable|
Overhead Triceps Extension (EZ Bar)|Triceps|Barbell|
Overhead Triceps Extension (Single Arm, Dumbbell)|Triceps|Dumbbell|
Close-Grip Bench Press (Smith Machine)|Triceps|Smith machine|c
Close-Grip Push Up|Triceps|Bodyweight|
JM Press (Barbell)|Triceps|Barbell|c
Triceps Dip (Plate-loaded Machine)|Triceps|Plate-loaded|c
Wrist Curl (Dumbbell)|Forearms|Dumbbell|
Reverse Curl (EZ Bar)|Forearms|Barbell|
Wrist Curl (Barbell)|Forearms|Barbell|
Reverse Wrist Curl (Dumbbell)|Forearms|Dumbbell|
Reverse Wrist Curl (Barbell)|Forearms|Barbell|
Reverse Curl (Barbell)|Forearms|Barbell|
Reverse Curl (Cable)|Forearms|Cable|
Dead Hang|Forearms|Bodyweight|
Squat (Barbell)|Quads|Barbell|c
Front Squat (Barbell)|Quads|Barbell|c
Squat (Smith Machine)|Quads|Smith machine|c
Hack Squat (Machine)|Quads|Machine|c
Pendulum Squat (Machine)|Quads|Machine|c
Leg Press (Machine)|Quads|Machine|c
Leg Extension (Machine)|Quads|Machine|
Bulgarian Split Squat (Dumbbell)|Quads|Dumbbell|c
Walking Lunge (Dumbbell)|Quads|Dumbbell|c
Goblet Squat (Dumbbell)|Quads|Dumbbell|c
Squat (Dumbbell)|Quads|Dumbbell|c
Squat (Machine)|Quads|Machine|c
Lunge (Dumbbell)|Quads|Dumbbell|c
Lunge (Barbell)|Quads|Barbell|c
Reverse Lunge (Dumbbell)|Quads|Dumbbell|c
Split Squat (Dumbbell)|Quads|Dumbbell|c
Step Up (Dumbbell)|Quads|Dumbbell|c
Bodyweight Squat|Quads|Bodyweight|
Sumo Squat (Dumbbell)|Quads|Dumbbell|c
Front Squat (Smith Machine)|Quads|Smith machine|c
Belt Squat (Machine)|Quads|Machine|c
Leg Press (Single Leg)|Quads|Machine|c
Leg Press (Horizontal)|Quads|Machine|c
Reverse Lunge (Barbell)|Quads|Barbell|c
Split Squat (Smith Machine)|Quads|Smith machine|c
Bulgarian Split Squat (Smith Machine)|Quads|Smith machine|c
Bulgarian Split Squat (Barbell)|Quads|Barbell|c
Step Up (Barbell)|Quads|Barbell|c
Single Leg Extension (Machine)|Quads|Machine|
Box Squat (Barbell)|Quads|Barbell|c
Overhead Squat (Barbell)|Quads|Barbell|c
Zercher Squat (Barbell)|Quads|Barbell|c
Hack Squat (Barbell)|Quads|Barbell|c
Reverse Lunge (Smith Machine)|Quads|Smith machine|c
Sissy Squat|Quads|Bodyweight|
Wall Sit|Quads|Duration|
Lying Leg Curl (Machine)|Hamstrings|Machine|
Seated Leg Curl (Machine)|Hamstrings|Machine|
Standing Leg Curl (Machine)|Hamstrings|Machine|
Nordic Curl|Hamstrings|Reps only|
Glute-Ham Raise|Hamstrings|Bodyweight|x
Stiff-Leg Deadlift (Barbell)|Hamstrings|Barbell|cx
Good Morning (Barbell)|Hamstrings|Barbell|cx
Single-Leg Romanian Deadlift (Dumbbell)|Hamstrings|Dumbbell|cx
Romanian Deadlift (Smith Machine)|Hamstrings|Smith machine|cx
Lying Leg Curl (Single Leg)|Hamstrings|Machine|
Seated Leg Curl (Single Leg)|Hamstrings|Machine|
Leg Curl (Cable)|Hamstrings|Cable|
Leg Curl (Plate-loaded)|Hamstrings|Plate-loaded|
Hip Thrust (Barbell)|Glutes|Barbell|cx
Hip Thrust (Machine)|Glutes|Machine|cx
Reverse Hyper (Machine)|Glutes|Machine|x
Cable Pull-Through|Glutes|Cable|x
Glute Kickback (Cable)|Glutes|Cable|
Glute Kickback (Machine)|Glutes|Machine|
Hip Abductor (Machine)|Glutes|Machine|
Hip Thrust (Smith Machine)|Glutes|Smith machine|cx
Hip Thrust (Dumbbell)|Glutes|Dumbbell|cx
Single Leg Hip Thrust|Glutes|Bodyweight|cx
Glute Bridge (Barbell)|Glutes|Barbell|
Glute Bridge|Glutes|Bodyweight|
Hip Abduction (Cable)|Glutes|Cable|
Hip Adduction (Cable)|Glutes|Cable|
Donkey Kick (Cable)|Glutes|Cable|
Glute Kickback (Smith Machine)|Glutes|Smith machine|
Frog Pump|Glutes|Bodyweight|
Step Up (Weighted Glute Focus)|Glutes|Dumbbell|c
Hip Adductor (Machine)|Adductors|Machine|
Copenhagen Plank|Adductors|Duration|
Standing Calf Raise (Machine)|Calves|Machine|
Seated Calf Raise (Machine)|Calves|Machine|
Calf Press (Leg Press)|Calves|Machine|
Calf Raise (Smith Machine)|Calves|Smith machine|
Donkey Calf Raise (Machine)|Calves|Machine|
Calf Raise (Dumbbell, Single Leg)|Calves|Dumbbell|
Calf Raise (Bodyweight)|Calves|Bodyweight|
Calf Raise (Hack Squat)|Calves|Machine|
Calf Raise (Barbell)|Calves|Barbell|
Seated Abs (Machine)|Core|Machine|
Cable Crunch|Core|Cable|
Decline Crunch|Core|Reps only|
Hanging Leg Raise|Core|Reps only|
Ab Wheel Rollout|Core|Reps only|
Russian Twist|Core|Reps only|
Plank|Core|Duration|
Crunch|Core|Reps only|
Sit Up|Core|Reps only|
Lying Leg Raise|Core|Reps only|
Hanging Knee Raise|Core|Reps only|
Captain's Chair Leg Raise|Core|Reps only|
Side Plank|Core|Duration|
Pallof Press (Cable)|Core|Cable|c
Cable Woodchop|Core|Cable|
Decline Sit Up|Core|Reps only|
Reverse Crunch|Core|Reps only|
Bicycle Crunch|Core|Reps only|
V Up|Core|Reps only|
Dead Bug|Core|Reps only|
Bird Dog|Core|Reps only|
Hollow Hold|Core|Duration|
Mountain Climber|Core|Reps only|
Side Bend (Dumbbell)|Core|Dumbbell|
Oblique Crunch (Machine)|Core|Machine|
Torso Rotation (Machine)|Core|Machine|
Back Extension (Machine)|Core|Machine|
Toes to Bar|Core|Reps only|
Cable Crunch (Standing)|Core|Cable|
Flutter Kick|Core|Reps only|
Dragon Flag|Core|Reps only|
Russian Twist (Weighted)|Core|Dumbbell|
Ab Wheel Rollout (Standing)|Core|Reps only|
Treadmill (Incline Walk)|Cardio|Cardio|
Treadmill Run|Cardio|Cardio|
Stationary Bike|Cardio|Cardio|
Elliptical|Cardio|Cardio|
Rowing Machine|Cardio|Cardio|
Stair Climber|Cardio|Cardio|
Walking (Outdoor)|Cardio|Cardio|
Running (Outdoor)|Cardio|Cardio|
Cycling (Outdoor)|Cardio|Cardio|
Swimming|Cardio|Cardio|
Jump Rope|Cardio|Cardio|
Air Bike|Cardio|Cardio|
Ski Erg|Cardio|Cardio|
Stair Climber (Stepmill)|Cardio|Cardio|
Kettlebell Swing|Other|Kettlebell|
Goblet Squat (Kettlebell)|Other|Kettlebell|c
Turkish Get-Up (Kettlebell)|Other|Kettlebell|
Burpee|Other|Reps only|
Thruster (Barbell)|Other|Barbell|c
Power Clean (Barbell)|Other|Barbell|`;

  const PARTS = ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Forearms', 'Quads', 'Hamstrings', 'Glutes', 'Adductors', 'Calves', 'Core', 'Cardio', 'Other'];
  const CATS = ['Barbell', 'Dumbbell', 'Kettlebell', 'Machine', 'Plate-loaded', 'Smith machine', 'Cable', 'Bodyweight', 'Assisted', 'Reps only', 'Duration', 'Cardio'];
  const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const LIB = {};
  LIB_SRC.split('\n').forEach(line => {
    const [name, part, cat, fl = ''] = line.split('|');
    LIB[slug(name)] = { id: slug(name), name, part, cat, compound: fl.includes('c'), avoided: fl.includes('x') };
  });

  // ---------- Aziz's program (plan doc section 10, Strong templates, Oct 2026) ----------
  // [exercise, unit, weight, reps, sets, note, warm-up weights]
  const TREAD = ['Treadmill (Incline Walk)', 'cardio', 2.0, 30, 1, '~4.0 km/h, incline ~3, 30 min after every lift'];
  const PROGRAM_SRC = [
    ['Push A', [
      ['Bench Press (Barbell)', 'kg', 90, 8, 2, '35 kg/side. Main lift.', [20, 40, 60, 70]],
      ['Lateral Raise (Cable)', 'kg', 7.5, 10, 3],
      ['Incline Bench Press (Dumbbell)', 'lb', 65, 10, 2, 'Main lift.'],
      ['Cable Crossover', 'kg', 16.5, 10, 3],
      ['Triceps Extension (Cable)', 'kg', 15, 10, 3],
      ['Triceps Pushdown (Straight Bar)', 'kg', 32.5, 10, 2],
      ['Standing Lateral Raise (Machine)', 'kg', 66, 10, 3, 'Standing side delts machine (replaced front raise).'],
      TREAD]],
    ['Pull A', [
      ['Lat Pulldown - Wide Grip (Cable)', 'kg', 80, 8, 3, 'Main lift.'],
      ['Lat Pulldown - Single Arm (Cable)', 'kg', 60, 10, 3],
      ['Seated Row (Cable)', 'kg', 95, 8, 2, 'Main lift.'],
      ['Pullover (Machine)', 'kg', 61, 8, 2],
      ['Bicep Curl (Dumbbell)', 'lb', 30, 10, 3],
      ['Seated Bicep Curl (Machine)', 'kg', 25, 10, 3],
      ['Reverse Fly (Machine)', 'kg', 61, 10, 1],
      TREAD]],
    ['Lower A', [
      ['Leg Extension (Machine)', 'kg', 122, 8, 3, 'Main lift.'],
      ['Hack Squat (Machine)', 'kg', 70, 8, 2, 'Main lift.'],
      ['Squat (Smith Machine)', 'kg', 40, 7, 1],
      ['Lying Leg Curl (Machine)', 'kg', 63, 8, 2, 'Main lift.'],
      ['Hip Adductor (Machine)', 'kg', 85, 10, 3],
      ['Standing Calf Raise (Machine)', 'kg', 60, 10, 3],
      ['Seated Abs (Machine)', 'kg', 5, 100, 1, '5 kg × 100 as logged in Strong. Check this.'],
      TREAD]],
    ['Push B', [
      ['Gundam Chest Press (Machine)', 'kg', 60, 8, 3, 'Main lift.'],
      ['Seated Overhead Press (Dumbbell)', 'lb', 60, 8, 3, 'Main lift.'],
      ['Lateral Raise (Dumbbell)', 'kg', 7.5, 10, 3, 'Logged as "Side Delts" in Strong. Replace with the cable version if that is what you use.'],
      ['Reverse Fly (Machine)', 'kg', 61, 10, 3, '2–3 sets.'],
      ['Front Raise (Dumbbell)', 'lb', 30, 10, 1],
      ['Triceps Rope Pushdown (Cable)', 'kg', 15, 10, 2],
      ['Triceps Pushdown (Straight Bar)', 'kg', 32.5, 10, 2],
      TREAD]],
    ['Pull B', [
      ['T-Bar Row', 'kg', 50, 8, 3, 'Main lift.'],
      ['Lat Pulldown - Single Arm (Cable)', 'kg', 60, 8, 3, '8–10 reps.'],
      ['Iso-Lateral Low Row (Plate-loaded)', 'kg', 70, 10, 2],
      ['Seated Row (Cable)', 'kg', 90, 8, 2, 'Main lift.'],
      ['Shrug (Machine)', 'kg', 80, 10, 2, 'Traps machine.'],
      ['Standing Bicep Curl (Cable)', 'kg', 16, 10, 3],
      TREAD]],
    ['Lower B', [
      ['Lying Leg Curl (Machine)', 'kg', 63, 8, 3, 'Main lift.'],
      ['Leg Extension (Machine)', 'kg', 122, 8, 2, 'Main lift.'],
      ['Hack Squat (Machine)', 'kg', 70, 8, 2, 'Main lift.'],
      ['Squat (Smith Machine)', 'kg', 40, 10, 2],
      ['Hip Abductor (Machine)', 'kg', 135, 20, 3],
      ['Calf Press (Leg Press)', 'kg', 65, 10, 2],
      ['Seated Abs (Machine)', 'kg', 5, 100, 1, '5 kg × 100 as logged in Strong. Check this.'],
      TREAD]]
  ];
  // Exercise names the app shell (and its weekly report / quick log) uses, from the plan doc.
  const SHELL_NAMES = {
    'incline-bench-press-dumbbell': 'Incline DB Press', 'triceps-pushdown-straight-bar': 'Triceps Pushdown (Straight bar)',
    'standing-lateral-raise-machine': 'Standing Side Delts (Machine)', 'lat-pulldown-wide-grip-cable': 'Lat Pulldown, Wide',
    'lat-pulldown-single-arm-cable': 'Lat Pulldown, Single Arm', 'bicep-curl-dumbbell': 'DB Curl', 'seated-bicep-curl-machine': 'Seated Bicep Curl',
    'leg-extension-machine': 'Leg Extension', 'hack-squat-machine': 'Hack Squat', 'squat-smith-machine': 'Smith Squat',
    'lying-leg-curl-machine': 'Lying Leg Curl', 'hip-adductor-machine': 'Hip Adductor', 'standing-calf-raise-machine': 'Standing Calf Raise',
    'seated-abs-machine': 'Seated Abs', 'gundam-chest-press-machine': 'Gundam (Chest Machine)', 'seated-overhead-press-dumbbell': 'Seated DB Overhead Press',
    'lateral-raise-dumbbell': 'Side Delts', 'front-raise-dumbbell': 'Front Raise (DB)', 'triceps-rope-pushdown-cable': 'Triceps Rope',
    'iso-lateral-low-row-plate-loaded': 'Iso-Lateral Low Row', 'shrug-machine': 'Traps Machine', 'standing-bicep-curl-cable': 'Cable Standing Biceps',
    'hip-abductor-machine': 'Hip Abductor', 'calf-press-leg-press': 'Calf Press on Seated Leg Press'
  };
  const ROTATION = ['Push A', 'Pull A', 'Lower A', 'Rest', 'Push B', 'Pull B', 'Lower B', 'Rest'];
  const MAIN_LIFTS = ['Bench Press (Barbell)', 'Incline Bench Press (Dumbbell)', 'Gundam Chest Press (Machine)', 'Seated Overhead Press (Dumbbell)', 'Lat Pulldown - Wide Grip (Cable)', 'Seated Row (Cable)', 'T-Bar Row', 'Hack Squat (Machine)', 'Leg Extension (Machine)', 'Lying Leg Curl (Machine)'].map(slug);

  function buildProgram() {
    return PROGRAM_SRC.map(([name, list], i) => ({
      id: slug(name), name, folder: 'My program', order: i, notes: '',
      exercises: list.map(([exName, unit, w, r, n, note, warm]) => {
        const sets = [];
        if (unit === 'cardio') sets.push({ t: 'n', km: w, min: r });
        else {
          (warm || []).forEach(ww => sets.push({ t: 'w', w: ww, r: '' }));
          for (let k = 0; k < n; k++) sets.push({ t: 'n', w, r });
        }
        return { exId: slug(exName), unit: unit === 'cardio' ? 'kg' : unit, notes: note || '', sets };
      })
    }));
  }

  // ---------- Measurements ----------
  const MEASURES = [
    ['weight', 'Body weight', 'kg'], ['bodyfat', 'Body fat', '%'], ['calories', 'Calories', 'kcal'],
    ['waist', 'Waist', 'cm'], ['chest', 'Chest', 'cm'], ['shoulders', 'Shoulders', 'cm'], ['neck', 'Neck', 'cm'],
    ['hips', 'Hips', 'cm'], ['bicepL', 'Left bicep', 'cm'], ['bicepR', 'Right bicep', 'cm'], ['forearm', 'Forearm', 'cm'],
    ['thighL', 'Left thigh', 'cm'], ['thighR', 'Right thigh', 'cm'], ['calf', 'Calf', 'cm']
  ].map(([id, name, unit]) => ({ id, name, unit }));
  // Goal weight comes from the host's AppTargets (opts.targets.goalKg); 80 kg is only the standalone preview's fallback.
  const goalKg = () => { const t = S.opts && S.opts.targets; return t ? (t.goalKg != null ? +t.goalKg : null) : 80; };

  const DEFAULT_SETTINGS = {
    unit: 'kg', restCompound: 150, restIso: 90, sound: true, vibrate: true, wake: true, rpe: false, rir: false, gym: false,
    restStyle: 'bar', restSound: 'restDone', restNotify: 'big', countBuzz: true, setSound: 'check',
    bar: 20, barLb: 45, platesKg: [25, 20, 15, 10, 5, 2.5, 1.25], platesLb: [45, 35, 25, 10, 5, 2.5],
    rotOverride: null, seeded: false
  };

  // ---------- Utilities ----------
  const LB = 0.45359237;
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = o => JSON.parse(JSON.stringify(o));
  const num = v => (v === '' || v == null || isNaN(+v)) ? null : +v;
  const toKg = (w, unit) => unit === 'lb' ? w * LB : w;
  const fmtN = (n, d = 1) => n == null ? '' : (Math.round(n * 10 ** d) / 10 ** d).toLocaleString('en-US');
  const e1rm = (w, r) => (!w || !r) ? 0 : r === 1 ? w : w * (1 + r / 30);
  const DAY = 864e5;
  const isoDate = ts => { const d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const fromIso = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12).getTime(); };
  const fmtDate = (ts, o) => new Date(ts).toLocaleDateString('en-US', o || { weekday: 'short', month: 'short', day: 'numeric' });
  const fmtTime = ts => new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const fmtDur = ms => { const m = Math.max(0, Math.round(ms / 6e4)); return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + 'm'; };
  const clock = ms => { const s = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(ss).padStart(2, '0'); };
  const mmss = s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  // Typed rest time -> seconds. "1:45", "105", "105s", "2m", "1m30s", "2.5" (under 10 = minutes). 0/off -> 0. Bad -> null.
  function parseRest(v) {
    v = String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, '').replace(',', '.');
    if (!v) return null;
    if (v === 'off' || v === '-') return 0;
    let sec = null, m;
    if ((m = v.match(/^(\d{1,3}):(\d{1,2})$/))) { if (+m[2] < 60) sec = +m[1] * 60 + +m[2]; }
    else if ((m = v.match(/^(?:(\d+(?:\.\d+)?)m(?:in)?)?(?:(\d+)s(?:ec)?)?$/)) && (m[1] || m[2])) sec = Math.round((+m[1] || 0) * 60 + (+m[2] || 0));
    else if ((m = v.match(/^\d+(?:\.\d+)?$/))) { const n = +v; sec = Math.round(n < 10 ? n * 60 : n); }
    if (sec == null || !isFinite(sec)) return null;
    return Math.min(sec, 3600);
  }
  const startOfDay = ts => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const startOfWeek = ts => { const d = new Date(startOfDay(ts)); d.setDate(d.getDate() - d.getDay()); return d.getTime(); }; // Sunday weeks
  const relDay = ts => { const d = Math.round((startOfDay(Date.now()) - startOfDay(ts)) / DAY); return d === 0 ? 'Today' : d === 1 ? 'Yesterday' : d < 7 ? d + ' days ago' : fmtDate(ts, { month: 'short', day: 'numeric' }); };

  // ---------- Storage ----------
  function localStorageAdapter(prefix) {
    const key = c => prefix + c;
    const read = c => { try { return JSON.parse(localStorage.getItem(key(c)) || '{}'); } catch (e) { return {}; } };
    const write = (c, v) => { try { localStorage.setItem(key(c), JSON.stringify(v)); } catch (e) { } };
    return {
      async list(c) { return Object.values(read(c)); },
      async put(c, id, doc) { const all = read(c); all[id] = doc; write(c, all); },
      async remove(c, id) { const all = read(c); delete all[id]; write(c, all); }
    };
  }

  const COLL = { templates: 'lb_templates', workouts: 'lb_workouts', exercises: 'lb_exercises', measures: 'lb_measures' };
  // Saved settings over the defaults, then anything changed before they loaded on top.
  function mergeSettings(defaults, saved, early) {
    const s = Object.assign({}, saved || {}); delete s.id;
    return Object.assign(clone(defaults), s, early || {});
  }
  const S = { storage: null, opts: {}, data: { templates: {}, workouts: {}, exercises: {}, measures: {} }, settings: clone(DEFAULT_SETTINGS), active: null, ready: false, shellWeights: null };
  const chains = {};
  function queue(path, fn) {
    chains[path] = (chains[path] || Promise.resolve()).then(fn).catch(e => toast('Not saved: ' + (e && (e.code || e.message) || 'storage error')));
    return chains[path];
  }
  function put(kind, obj) {
    S.data[kind][obj.id] = obj; bump();
    return queue(kind + '/' + obj.id, () => S.storage.put(COLL[kind], obj.id, clone(obj)));
  }
  function remove(kind, id) {
    delete S.data[kind][id]; bump();
    return queue(kind + '/' + id, () => S.storage.remove(COLL[kind], id));
  }
  // Settings changed before loadAll() has read the saved ones (the host's Settings screen mounts the logger and can be
  // tapped while a big history is still loading) are kept here and laid over the saved settings once they arrive.
  // Writing then would save defaults over everything else, and loading would undo the tap: the rest timer look
  // "went back to the default" the next time a workout (or Gym mode) saved settings.
  let earlySettings = null, settingsLoaded = false;
  function noteSetting(k, v) { S.settings[k] = v; if (!settingsLoaded) (earlySettings = earlySettings || {})[k] = v; saveSettings(); }
  function saveSettings() { if (!settingsLoaded) return; queue('meta/settings', () => S.storage.put('lb_meta', 'settings', clone(Object.assign({ id: 'settings' }, S.settings)))); }
  let activeTimer = null;
  function saveActive(now) {
    try { localStorage.setItem('lb_active', JSON.stringify(S.active)); } catch (e) { }
    // Friends: a "working out now" badge for connected people (modules/friends); name + start only.
    try { window.dispatchEvent(new CustomEvent('lb:active', { detail: { workout: S.active ? { id: S.active.id, name: S.active.name, start: S.active.start } : null } })); } catch (e) { }
    workoutCue();
    clearTimeout(activeTimer);
    const go = () => queue('meta/active', () => S.storage.put('lb_meta', 'active', { id: 'active', workout: S.active ? clone(S.active) : null, at: Date.now() }));
    if (now) go(); else activeTimer = setTimeout(go, 1200);
  }

  async function loadAll() {
    const [t, w, e, m, meta] = await Promise.all(['lb_templates', 'lb_workouts', 'lb_exercises', 'lb_measures', 'lb_meta'].map(c => S.storage.list(c).catch(() => [])));
    const index = arr => Object.fromEntries((arr || []).filter(d => d && d.id).map(d => [d.id, d]));
    S.data = { templates: index(t), workouts: index(w), exercises: index(e), measures: index(m) };
    const metaIdx = index(meta);
    const early = earlySettings; earlySettings = null;
    S.settings = mergeSettings(DEFAULT_SETTINGS, metaIdx.settings, early);
    settingsLoaded = true;
    if (early) saveSettings();
    // Nov 2026: live workouts open in the Strong-style List view (all exercises in one list). Applied once; Gym mode stays available in Settings.
    if (!S.settings.listOnce) { S.settings.gym = false; S.settings.listOnce = true; saveSettings(); }
    let act = metaIdx.active ? metaIdx.active.workout : null;
    try { const loc = JSON.parse(localStorage.getItem('lb_active') || 'null'); if (loc && (!act || (loc.updated || 0) > (act.updated || 0))) act = loc; } catch (e) { }
    S.active = act && !act.end ? act : null;
    if (S.opts.weights) { try { S.shellWeights = await S.opts.weights.list(); } catch (e) { S.shellWeights = null; } }
    if (!S.settings.seeded && !Object.keys(S.data.templates).length) {
      buildProgram().forEach(tpl => put('templates', tpl));
      S.settings.seeded = true; saveSettings();
    }
    bump(); S.ready = true;
  }

  // ---------- Derived data (memoized per data version) ----------
  let cache = {};
  function bump() { cache = {}; }
  function memo(k, fn) { return k in cache ? cache[k] : (cache[k] = fn()); }
  function getEx(id) {
    const base = LIB[id], over = S.data.exercises[id];
    if (!base && !over) return { id, name: id, part: 'Other', cat: 'Machine' };
    return Object.assign({}, base || {}, over || {});
  }
  const allExercises = () => memo('allEx', () => {
    const ids = new Set(Object.keys(LIB).concat(Object.keys(S.data.exercises).filter(k => S.data.exercises[k].custom)));
    return [...ids].map(getEx).sort((a, b) => a.name.localeCompare(b.name));
  });
  const fieldsFor = ex => ({ Bodyweight: ['r'], 'Reps only': ['r'], Duration: ['sec'], Cardio: ['km', 'min'] }[ex.cat] || ['w', 'r']);
  const isWeighted = ex => fieldsFor(ex)[0] === 'w';
  const restFor = (exId) => { const ex = getEx(exId); return ex.rest || (ex.compound ? S.settings.restCompound : S.settings.restIso); };
  const restOf = e => e.rest || restFor(e.exId);
  const restLabel = s => s > 0 ? mmss(s) : 'Off';
  // Rest after one set: its own time (Strong-style, tap the line under the set) or the exercise's.
  const setRestOf = (e, s) => (s && s.rest) || restOf(e);
  const defUnit = exId => getEx(exId).unit || S.settings.unit;
  const workouts = () => memo('ws', () => Object.values(S.data.workouts).filter(w => w.end).sort((a, b) => b.start - a.start));
  const templatesSorted = () => memo('ts', () => Object.values(S.data.templates).sort((a, b) => (a.folder || '').localeCompare(b.folder || '') || (a.order ?? 99) - (b.order ?? 99) || a.name.localeCompare(b.name)));
  function sessions(exId, excludeId) {
    return memo('s|' + exId + '|' + (excludeId || ''), () => {
      const out = [];
      workouts().forEach(w => { if (w.id === excludeId) return; w.exercises.forEach(e => { if (e.exId === exId) out.push({ w, e }); }); });
      return out;
    });
  }
  const working = e => e.sets.filter(s => s.t !== 'w' && s.done !== false);
  function bestSet(e) {
    let b = null;
    working(e).forEach(s => { const v = e1rm(toKg(num(s.w) || 0, e.unit), num(s.r) || 0); if (!b || v > b.v) b = { s, v }; });
    return b;
  }
  function records(exId, excludeId) {
    return memo('r|' + exId + '|' + (excludeId || ''), () => {
      const R = { e1rm: null, weight: null, volume: null, sessionVol: null, reps: null, reps0: {}, km: null, min: null, sec: null };
      sessions(exId, excludeId).slice().reverse().forEach(({ w, e }) => {
        let sv = 0;
        working(e).forEach(s => {
          const wk = toKg(num(s.w) || 0, e.unit), r = num(s.r) || 0, at = w.start;
          const upd = (k, v, extra) => { if (v > 0 && (!R[k] || v > R[k].v)) R[k] = Object.assign({ v, at, wid: w.id }, extra); };
          upd('e1rm', e1rm(wk, r), { w: num(s.w), r, unit: e.unit });
          upd('weight', wk, { w: num(s.w), r, unit: e.unit });
          upd('volume', wk * r, { w: num(s.w), r, unit: e.unit });
          upd('reps', r);
          upd('km', num(s.km) || 0); upd('min', num(s.min) || 0); upd('sec', num(s.sec) || 0);
          if (r && r <= 15 && wk && (!R.reps0[r] || wk > R.reps0[r].v)) R.reps0[r] = { v: wk, w: num(s.w), unit: e.unit, at };
          sv += wk * r;
        });
        if (sv > 0 && (!R.sessionVol || sv > R.sessionVol.v)) R.sessionVol = { v: sv, at: w.start };
      });
      return R;
    });
  }
  function setPRs(exId, unit, s, excludeId) {
    if (s.t === 'w') return [];
    const R = records(exId, excludeId), ex = getEx(exId), out = [];
    if (!sessions(exId, excludeId).length) return out;
    if (isWeighted(ex)) {
      const wk = toKg(num(s.w) || 0, unit), r = num(s.r) || 0;
      if (R.e1rm && e1rm(wk, r) > R.e1rm.v + 1e-6) out.push('Est. 1RM');
      if (R.weight && wk > R.weight.v + 1e-6) out.push('Weight');
      if (R.volume && wk * r > R.volume.v + 1e-6) out.push('Volume');
    } else {
      ['r', 'km', 'min', 'sec'].forEach(f => { const k = f === 'r' ? 'reps' : f; const v = num(s[f]); if (v && R[k] && v > R[k].v) out.push(k === 'reps' ? 'Reps' : k === 'km' ? 'Distance' : 'Time'); });
    }
    return out;
  }
  // PR celebration (modules/pr-celebrate): what was beaten and the old best, for the toast and the gym banner.
  const PRC = typeof PRCelebrate !== 'undefined' ? PRCelebrate : (typeof globalThis !== 'undefined' && globalThis.PRCelebrate) || null;
  function celebration(e, s) {
    if (!PRC || !s.pr || !s.pr.length) return null;
    const ex = getEx(e.exId);
    return PRC.describe(s.pr, records(e.exId, E.doc && E.doc.id), s, { name: ex.name, unit: e.unit, e1rm, fmtDate: at => fmtDate(at, { month: 'short', day: 'numeric' }) });
  }
  function workoutStats(w) {
    let vol = 0, sets = 0, prs = 0;
    w.exercises.forEach(e => working(e).forEach(s => { sets++; vol += toKg(num(s.w) || 0, e.unit) * (num(s.r) || 0); if (s.pr && s.pr.length) prs++; }));
    return { vol, sets, prs, dur: (w.end || Date.now()) - w.start };
  }
  const fmtSet = (s, e, ex) => {
    ex = ex || getEx(e.exId);
    const f = fieldsFor(ex);
    if (f[0] === 'km') return [s.km != null && s.km !== '' ? fmtN(+s.km, 2) + ' km' : '', s.min != null && s.min !== '' ? fmtN(+s.min) + ' min' : ''].filter(Boolean).join(' · ');
    if (f[0] === 'sec') return s.sec ? mmss(+s.sec) : '';
    if (f[0] === 'r') return s.r !== '' && s.r != null ? s.r + ' reps' : '';
    if ((s.w === '' || s.w == null) && (s.r === '' || s.r == null)) return '';
    return fmtN(+s.w || 0, 2) + ' ' + (e.unit || 'kg') + (s.r !== '' && s.r != null ? ' × ' + s.r : '');
  };
  function rotationInfo() {
    return memo('rot', () => {
      const ws = workouts();
      const last = ws.find(w => w.templateName && ROTATION.includes(w.templateName));
      let idx = 0;
      if (last) idx = (ROTATION.indexOf(last.templateName) + 1) % ROTATION.length;
      const o = S.settings.rotOverride;
      if (o && (!last || o.at > last.end)) idx = o.idx;
      return { idx, name: ROTATION[idx], last };
    });
  }
  const templateByName = name => templatesSorted().find(t => t.name === name);

  // Main-lift drop check: best working e1RM per session, flag when it fell 2 sessions in a row.
  function liftTrend(exId) {
    const ss = sessions(exId).slice(0, 8).map(({ w, e }) => { const b = bestSet(e); return b ? { at: w.start, v: b.v, s: b.s, unit: e.unit } : null; }).filter(Boolean);
    const dropping = ss.length >= 3 && ss[0].v < ss[1].v - 1e-6 && ss[1].v < ss[2].v - 1e-6;
    return { ss, dropping };
  }
  // Double progression hint (optional, 8–12 reps): all working sets at the top of the range -> add load.
  function progressionHint(exId, unit, prevE) {
    const ex = getEx(exId);
    if (!prevE || !isWeighted(ex)) return '';
    const ws = working(prevE).filter(s => num(s.r));
    if (!ws.length) return '';
    const top = Math.max(...ws.map(s => num(s.w) || 0));
    const atTop = ws.filter(s => (num(s.w) || 0) === top);
    const minR = Math.min(...atTop.map(s => num(s.r)));
    const step = weightStep(ex, unit);
    if (minR >= 12) return 'All sets hit 12 last time. Try ' + fmtN(stepWeight(top, 1, step), 2) + ' ' + unit + '.';
    return 'Beat last time: aim for ' + fmtN(top, 2) + ' ' + unit + ' × ' + (minR + 1) + ' on one set.';
  }

  // ---------- Gym mode helpers ----------
  // Weight increment per exercise. Default by equipment; an exercise can save its machine's real step (ex.step,
  // in ex.stepUnit) so steppers, progression hints and warm-ups land on weights the stack actually has.
  const defaultStep = (ex, unit) => unit === 'lb' ? 5 : (ex.cat === 'Dumbbell' ? 2 : 2.5);
  const weightStep = (ex, unit) => {
    const st = num(ex.step);
    if (!st || st <= 0) return defaultStep(ex, unit);
    const su = ex.stepUnit || ex.unit || S.settings.unit;
    if (su === unit) return st;
    return Math.max(0.25, Math.round((unit === 'lb' ? st / LB : st * LB) * 4) / 4);
  };
  const snapStep = (v, step) => step > 0 ? Math.round(Math.round(v / step) * step * 100) / 100 : Math.round(v * 100) / 100;
  // One click on a weight stepper: move by the step and land on the step grid (61 kg + 2.5 -> 62.5, not 63.5).
  const stepWeight = (v, d, step) => Math.max(0, snapStep((num(v) || 0) + d * step, step));
  const FIELD_STEP = { r: 1, km: 0.1, min: 1, sec: 5 };
  const stepFor = (ex, unit, k) => k === 'w' ? weightStep(ex, unit) : FIELD_STEP[k];
  const bumpVal = (v, d) => Math.max(0, Math.round(((num(v) || 0) + d) * 100) / 100);
  // Order sets get done in Gym mode: straight sets top to bottom; a superset (neighbours sharing ss) alternates A1 B1 A2 B2 …
  function gymOrder(exs) {
    const out = [];
    for (let i = 0; i < exs.length;) {
      let j = i + 1;
      if (exs[i].ss) while (j < exs.length && exs[j].ss === exs[i].ss) j++;
      const group = []; for (let g = i; g < j; g++) group.push(g);
      const rounds = Math.max(0, ...group.map(g => exs[g].sets.length));
      for (let r = 0; r < rounds; r++) group.forEach(g => { if (r < exs[g].sets.length) out.push([g, r]); });
      i = j;
    }
    return out;
  }
  // Next unchecked set after `from` ([ei, si]) in gym order, wrapping round to skipped ones; null when everything is checked.
  function nextPending(exs, from) {
    const ord = gymOrder(exs), k = from ? ord.findIndex(p => p[0] === from[0] && p[1] === from[1]) : -1;
    for (let n = 1; n <= ord.length; n++) { const p = ord[(k + n) % ord.length]; if (!exs[p[0]].sets[p[1]].done) return p; }
    return null;
  }
  // Where to pick up: the first unchecked set after the furthest checked one (so skipped warm-ups don't pull you back).
  function resumePoint(exs) {
    const ord = gymOrder(exs); let last = null;
    ord.forEach(p => { if (exs[p[0]].sets[p[1]].done) last = p; });
    return nextPending(exs, last);
  }
  // Rest after a set unless the next set due is a later exercise of the same superset round.
  function restAfter(exs, ei, si) {
    const e = exs[ei]; if (!e || !e.ss) return true;
    const nx = nextPending(exs, [ei, si]);
    return !(nx && nx[0] > ei && exs[nx[0]].ss === e.ss);
  }
  // Today's set against the matching set last time (weights converted to `unit`). Fields missing on either side are null.
  function compareSets(cur, prev, unit, prevUnit) {
    if (!prev) return null;
    let pw = num(prev.w); if (pw != null && prevUnit && prevUnit !== unit) pw = prevUnit === 'lb' ? pw * LB : pw / LB;
    const cw = num(cur.w), cr = num(cur.r), pr = num(prev.r);
    const dw = cw != null && pw != null ? Math.round((cw - pw) * 100) / 100 : null;
    const dr = cr != null && pr != null ? cr - pr : null;
    const de = cw != null && cr != null && pw != null && pr != null && cr > 0 && pr > 0 ? Math.round((e1rm(toKg(cw, unit), cr) - e1rm(toKg(pw, unit), pr)) * 10) / 10 : null;
    return { dw, dr, de };
  }

  // ---------- Root, events, sheets ----------
  let root, overlay, tab = 'workout', histMode = 'list', calMonth = null, exFilter = { q: '', part: '', cat: '', sort: 'name' };
  const actions = {};
  function on(name, fn) { actions[name] = fn; }
  function delegate(el) {
    el.addEventListener('click', ev => {
      const t = ev.target.closest('[data-a]');
      if (!t || !el.contains(t)) return;
      const fn = actions[t.dataset.a];
      if (fn) { ev.preventDefault(); fn(t, ev); }
    });
    el.addEventListener('input', ev => { const t = ev.target; if (t.dataset.in && actions[t.dataset.in]) actions[t.dataset.in](t, ev); });
    el.addEventListener('change', ev => { const t = ev.target; if (t.dataset.ch && actions[t.dataset.ch]) actions[t.dataset.ch](t, ev); });
    // A list picture that fails to load (clip not shipped yet) turns back into the letter circle.
    el.addEventListener('error', ev => { const t = ev.target; if (t && t.classList && t.classList.contains('lb-thumb-img')) t.remove(); }, true);
  }
  const sheets = [];
  function openSheet(o) {
    const el = document.createElement('div');
    el.className = 'lb-sheet-wrap';
    el.innerHTML = '<div class="lb-scrim" data-a="closeSheet"></div><div class="lb-sheet' + (o.full ? ' full' : '') + '" role="dialog" aria-modal="true"><div class="lb-sheet-head"><button class="lb-link" data-a="closeSheet">' + (o.closeLabel || 'Close') + '</button><h2></h2><div class="lb-sheet-right"></div></div><div class="lb-sheet-body"></div></div>';
    overlay.appendChild(el);
    const sh = { el, o, render() { el.querySelector('h2').textContent = typeof o.title === 'function' ? o.title() : o.title; el.querySelector('.lb-sheet-right').innerHTML = o.right ? o.right() : ''; el.querySelector('.lb-sheet-body').innerHTML = o.body(); o.mount && o.mount(el); } };
    sheets.push(sh); sh.render();
    requestAnimationFrame(() => el.classList.add('open'));
    return sh;
  }
  function closeSheet() {
    const sh = sheets.pop(); if (!sh) return;
    sh.o.onClose && sh.o.onClose();
    sh.el.classList.remove('open'); sh.el.classList.add('closing'); setTimeout(() => sh.el.remove(), 240);
    if (!sheets.length) renderMain();
  }
  const topSheet = () => sheets[sheets.length - 1];
  function closeAllSheets() { while (sheets.length) { const sh = sheets.pop(); sh.el.remove(); } }
  on('closeSheet', () => closeSheet());
  let toastT;
  function toast(msg) {
    if (!overlay) return;
    let t = overlay.querySelector('.lb-toast');
    if (!t) { t = document.createElement('div'); t.className = 'lb-toast'; t.setAttribute('role', 'status'); overlay.appendChild(t); }
    t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // ---------- Audio / wake lock ----------
  let audio = null, wakeLock = null;
  // GymSounds (modules/gym-sounds) gives the Strong-style cues; the three plain tones stay as a fallback.
  const GS = () => (typeof window !== 'undefined' && window.GymSounds) || null;
  function beep(name) {
    if (!S.settings.sound) return;
    if (GS() && (GS().play(name || S.settings.restSound || 'restDone') || GS().play('restDone'))) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.22, 0.44].forEach((d, i) => { const o = audio.createOscillator(), g = audio.createGain(); o.frequency.value = i === 2 ? 1320 : 880; g.gain.setValueAtTime(0.0001, audio.currentTime + d); g.gain.exponentialRampToValueAtTime(0.25, audio.currentTime + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + d + 0.18); o.connect(g).connect(audio.destination); o.start(audio.currentTime + d); o.stop(audio.currentTime + d + 0.2); });
    } catch (e) { }
  }
  // The sound a ticked set makes (settings.setSound: a GymSounds.SET_SOUNDS id or 'off'); Aziz's own Check by default.
  function setDoneSound() { const v = S.settings.setSound || 'check'; if (v !== 'off' && GS()) { GS().prime(); GS().play(v); } }
  function primeAudio() { if (S.settings.sound && GS()) { GS().prime(); return; } try { if (S.settings.sound && !audio) audio = new (window.AudioContext || window.webkitAudioContext)(); if (audio && audio.state === 'suspended') audio.resume(); } catch (e) { } }
  async function keepAwake(onState) {
    try {
      if (onState && S.settings.wake && navigator.wakeLock && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
      if (!onState && wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch (e) { wakeLock = null; }
  }

  // ---------- Main views ----------
  const TABS = [['workout', 'Workout'], ['history', 'History'], ['exercises', 'Exercises'], ['progress', 'Progress'], ['tools', 'Tools']];
  let shownTab = null, enterSel = null;
  function renderMain() {
    if (!root) return;
    if (!S.ready) { root.innerHTML = '<div class="lb-empty">Loading your workouts…</div>'; return; }
    const body = { workout: viewWorkout, history: viewHistory, exercises: viewExercises, progress: viewProgress, tools: viewTools }[tab]();
    const tabs = TABS.filter(([k]) => k === tab || !(S.opts.hideTabs || []).includes(k));
    root.innerHTML = (S.opts.title ? '<h1 class="lb-screen-title">' + esc(S.opts.title) + '</h1>' : '') + '<nav class="lb-subnav" aria-label="Workout sections">' + tabs.map(([k, l]) => '<button data-a="tab" data-k="' + k + '" class="' + (k === tab ? 'on' : '') + '" aria-current="' + (k === tab) + '">' + l + '</button>').join('') + '</nav>' + activeBanner() + '<div class="lb-view">' + body + '</div>';
    // Short entry motion (CSS lb-in): the section fades in when you switch Workout/History/…, or the card that changed (e.g. Skip to the next session).
    const sel = tab !== shownTab ? '.lb-view' : enterSel; shownTab = tab; enterSel = null;
    const anim = sel && root.querySelector(sel); if (anim) anim.classList.add('lb-in');
    const q = root.querySelector('#lb-exq'); if (q && exFilter.focus) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  }
  on('tab', t => { tab = t.dataset.k; renderMain(); });
  function activeBanner() {
    if (!S.active || E) return '';
    return '<button class="lb-active-bar" data-a="resume"><span class="dot"></span><span><b>' + esc(S.active.name) + '</b> in progress</span><span class="lb-mono" data-clock="' + S.active.start + '">' + clock(Date.now() - S.active.start) + '</span><span class="lb-chev">Resume</span></button>' +
      '<div class="lb-active-acts"><button class="lb-btn primary small" data-a="barFinish">Finish workout</button><button class="lb-btn ghost danger small" data-a="barEnd">End workout</button></div>';
  }
  // Train page shortcuts while a workout is hidden: open it and go straight to Finish, or to the "Cancel this workout?" confirm.
  on('barFinish', () => { actions.resume(); if (E && E.mode === 'live') actions.finish(); });
  on('barEnd', () => { actions.resume(); if (E && E.mode === 'live') actions.askDiscard(); });

  // Workout tab
  function viewWorkout() {
    const rot = rotationInfo();
    let up = '';
    if (rot.name === 'Rest') {
      const nextName = ROTATION[(rot.idx + 1) % ROTATION.length];
      up = '<section class="lb-card lb-next"><div class="lb-eyebrow">Up next in your rotation</div><h3>Rest day</h3><p class="lb-muted">' + (rot.last ? 'Last session: ' + esc(rot.last.templateName) + ', ' + relDay(rot.last.start).toLowerCase() + '. ' : '') + 'Next lift after rest: ' + esc(nextName) + '.</p><div class="lb-row"><button class="lb-btn" data-a="rotSkip">Rest done, show ' + esc(nextName) + '</button><button class="lb-btn ghost" data-a="startTplName" data-n="' + esc(nextName) + '">Train ' + esc(nextName) + ' anyway</button></div></section>';
    } else {
      const tpl = templateByName(rot.name);
      up = '<section class="lb-card lb-next"><div class="lb-eyebrow">Up next in your rotation</div><h3>' + esc(rot.name) + '</h3>' + (tpl ? '<p class="lb-muted">' + tpl.exercises.length + ' exercises · ' + tpl.exercises.reduce((n, e) => n + e.sets.filter(s => s.t !== 'w').length, 0) + ' working sets' + (rot.last ? ' · last session ' + esc(rot.last.templateName) + ' ' + relDay(rot.last.start).toLowerCase() : '') + '</p>' : '<p class="lb-muted">No template named ' + esc(rot.name) + ' yet.</p>') + '<div class="lb-row">' + (tpl ? '<button class="lb-btn primary" data-a="startTpl" data-id="' + tpl.id + '">Start ' + esc(rot.name) + '</button>' : '') + '<button class="lb-btn ghost" data-a="rotSkip">Skip to next</button></div><div class="lb-rot">' + ROTATION.map((n, i) => '<span class="' + (i === rot.idx ? 'on' : '') + (n === 'Rest' ? ' rest' : '') + '">' + esc(n) + '</span>').join('') + '</div></section>';
    }
    const groups = {};
    templatesSorted().forEach(t => { (groups[t.folder || 'Other templates'] = groups[t.folder || 'Other templates'] || []).push(t); });
    const tplHtml = Object.keys(groups).map(f => '<h4 class="lb-folder">' + esc(f) + ' <span class="lb-muted">' + groups[f].length + '</span></h4><div class="lb-grid">' + groups[f].map(tplCard).join('') + '</div>').join('');
    const anyTpl = Object.keys(S.data.templates).length;
    return up +
      '<div class="lb-row"><button class="lb-btn wide" data-a="startEmpty">Start an empty workout</button></div>' +
      '<div class="lb-section-head"><h3>Templates</h3><div class="lb-row tight"><button class="lb-btn small" data-a="newTpl">New template</button>' + (anyTpl ? '' : '') + '</div></div>' +
      (anyTpl ? tplHtml : '<div class="lb-empty">No templates yet. <button class="lb-link" data-a="loadProgram">Load the Push / Pull / Lower program</button> or create your own.</div>');
  }
  function tplCard(t) {
    const last = workouts().find(w => w.templateId === t.id);
    return '<button class="lb-card lb-tpl" data-a="tplPreview" data-id="' + t.id + '"><div class="lb-tpl-top"><b>' + esc(t.name) + '</b><span class="lb-muted small">' + (last ? relDay(last.start) : 'Not done yet') + '</span></div><p>' + esc(t.exercises.map(e => getEx(e.exId).name.replace(/ \(.*\)$/, '')).join(', ')) + '</p></button>';
  }
  on('rotSkip', () => { const r = rotationInfo(); S.settings.rotOverride = { idx: (r.idx + 1) % ROTATION.length, at: Date.now() }; saveSettings(); bump(); enterSel = '.lb-next'; renderMain(); });
  on('loadProgram', () => { buildProgram().forEach(t => { if (!S.data.templates[t.id]) put('templates', t); }); toast('Loaded 6 templates'); renderMain(); });
  on('tplPreview', t => {
    const tpl = S.data.templates[t.dataset.id]; if (!tpl) return;
    openSheet({
      title: tpl.name,
      body: () => {
        const last = workouts().find(w => w.templateId === tpl.id);
        return (tpl.notes ? '<p class="lb-note">' + esc(tpl.notes) + '</p>' : '') + '<p class="lb-muted">' + (last ? 'Last performed ' + relDay(last.start).toLowerCase() + ' · ' + fmtDur(last.end - last.start) : 'Not performed yet') + '</p>' +
          '<ol class="lb-plist">' + tpl.exercises.map(e => { const ex = getEx(e.exId); const ws = e.sets.filter(s => s.t !== 'w'); const wu = e.sets.length - ws.length; return '<li><b>' + esc(ex.name) + '</b><span>' + ws.length + ' × ' + esc(ws[0] ? fmtSet(ws[0], e, ex) : '') + (wu ? ' · ' + wu + ' warm-up' : '') + '</span>' + (e.notes ? '<em>' + esc(e.notes) + '</em>' : '') + '</li>'; }).join('') + '</ol>' +
          '<div class="lb-row"><button class="lb-btn primary wide" data-a="startTpl" data-id="' + tpl.id + '">Start workout</button></div>' +
          '<div class="lb-row"><button class="lb-btn ghost" data-a="editTpl" data-id="' + tpl.id + '">Edit</button><button class="lb-btn ghost" data-a="dupTpl" data-id="' + tpl.id + '">Duplicate</button><button class="lb-btn ghost danger" data-a="askDelTpl" data-id="' + tpl.id + '">Delete</button></div><div class="lb-confirm" id="lb-deltpl" hidden><p>Delete the template "' + esc(tpl.name) + '"? Past workouts stay in your history.</p><button class="lb-btn danger" data-a="delTpl" data-id="' + tpl.id + '">Delete template</button></div>';
      }
    });
  });
  on('askDelTpl', () => { const c = topSheet().el.querySelector('#lb-deltpl'); if (c) c.hidden = false; });
  on('delTpl', t => { remove('templates', t.dataset.id); closeSheet(); toast('Template deleted'); });
  on('dupTpl', t => { const c = clone(S.data.templates[t.dataset.id]); c.id = uid(); c.name += ' (copy)'; c.order = 99; put('templates', c); closeSheet(); toast('Duplicated'); });

  // History tab
  function viewHistory() {
    const ws = workouts();
    const head = '<div class="lb-section-head"><h3>History</h3><div class="lb-seg"><button data-a="histMode" data-k="list" class="' + (histMode === 'list' ? 'on' : '') + '">List</button><button data-a="histMode" data-k="cal" class="' + (histMode === 'cal' ? 'on' : '') + '">Calendar</button></div></div>';
    if (!ws.length) return head + '<div class="lb-empty">Finished workouts show up here with their sets, volume and records. Start one from the Workout tab.</div>';
    if (histMode === 'cal') return head + calendar(ws);
    let html = '', month = '';
    ws.slice(0, 200).forEach(w => {
      const m = fmtDate(w.start, { month: 'long', year: 'numeric' });
      if (m !== month) { month = m; html += '<h4 class="lb-folder">' + m + '</h4>'; }
      html += histCard(w);
    });
    return head + html;
  }
  function histCard(w) {
    const st = workoutStats(w);
    return '<button class="lb-card lb-hist" data-a="histOpen" data-id="' + w.id + '"><div class="lb-tpl-top"><b>' + esc(w.name) + '</b><span class="lb-muted small">' + fmtDate(w.start) + '</span></div><div class="lb-stats"><span>' + fmtDur(st.dur) + '</span><span>' + fmtN(st.vol, 0) + ' kg</span><span>' + st.sets + ' sets</span>' + (st.prs ? '<span class="lb-pr">' + st.prs + ' PR' + (st.prs > 1 ? 's' : '') + '</span>' : '') + '</div><ul class="lb-hlines">' + w.exercises.map(e => { const ex = getEx(e.exId); const ws = working(e); const b = bestSet(e); return '<li><span>' + ws.length + ' × ' + esc(ex.name) + '</span><span class="lb-muted">' + esc(b ? fmtSet(b.s, e, ex) : ws[0] ? fmtSet(ws[0], e, ex) : '') + '</span></li>'; }).join('') + '</ul></button>';
  }
  on('histMode', t => { histMode = t.dataset.k; renderMain(); });
  function calendar(ws) {
    const base = calMonth || startOfDay(Date.now());
    const d0 = new Date(base); d0.setDate(1);
    const y = d0.getFullYear(), m = d0.getMonth();
    const days = new Date(y, m + 1, 0).getDate(), lead = d0.getDay();
    const byDay = {};
    ws.forEach(w => { (byDay[isoDate(w.start)] = byDay[isoDate(w.start)] || []).push(w); });
    let cells = '';
    for (let i = 0; i < lead; i++) cells += '<span></span>';
    let count = 0;
    for (let d = 1; d <= days; d++) {
      const key = isoDate(new Date(y, m, d).getTime()), list = byDay[key];
      if (list) count += list.length;
      const today = key === isoDate(Date.now());
      cells += list ? '<button class="has' + (today ? ' today' : '') + '" data-a="histOpen" data-id="' + list[0].id + '" title="' + esc(list.map(w => w.name).join(', ')) + '">' + d + '<i>' + esc(list[0].name.slice(0, 6)) + '</i></button>' : '<span class="' + (today ? 'today' : '') + '">' + d + '</span>';
    }
    return '<div class="lb-card"><div class="lb-cal-head"><button class="lb-btn small ghost" data-a="calNav" data-d="-1" aria-label="Previous month">‹</button><b>' + fmtDate(d0.getTime(), { month: 'long', year: 'numeric' }) + '</b><button class="lb-btn small ghost" data-a="calNav" data-d="1" aria-label="Next month">›</button></div><div class="lb-cal">' + ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(x => '<em>' + x + '</em>').join('') + cells + '</div><p class="lb-muted small">' + count + ' workout' + (count === 1 ? '' : 's') + ' this month</p></div>';
  }
  on('calNav', t => { const d = new Date(calMonth || Date.now()); d.setDate(1); d.setMonth(d.getMonth() + +t.dataset.d); calMonth = d.getTime(); renderMain(); });
  on('histOpen', t => {
    const id = t.dataset.id;
    openSheet({
      title: () => (S.data.workouts[id] || {}).name || 'Workout',
      body: () => {
        const w = S.data.workouts[id]; if (!w) return '<div class="lb-empty">This workout was deleted.</div>';
        const st = workoutStats(w);
        return '<p class="lb-muted">' + fmtDate(w.start, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) + ' · ' + fmtTime(w.start) + '</p><div class="lb-tiles"><div><b>' + fmtDur(st.dur) + '</b><span>Duration</span></div><div><b>' + fmtN(st.vol, 0) + '</b><span>Volume kg</span></div><div><b>' + st.sets + '</b><span>Sets</span></div><div><b>' + st.prs + '</b><span>PRs</span></div></div>' + (w.notes ? '<p class="lb-note">' + esc(w.notes) + '</p>' : '') +
          w.exercises.map(e => { const ex = getEx(e.exId); let n = 0; return '<div class="lb-hex"><button class="lb-link strong" data-a="exOpen" data-id="' + e.exId + '">' + esc(ex.name) + '</button>' + (e.notes ? '<p class="lb-muted small">' + esc(e.notes) + '</p>' : '') + '<table class="lb-tbl"><tbody>' + e.sets.map(s => '<tr><td class="lb-settag ' + s.t + '">' + (s.t === 'n' ? ++n : s.t.toUpperCase()) + '</td><td>' + esc(fmtSet(s, e, ex)) + (s.rpe ? ' <span class="lb-muted">@' + s.rpe + '</span>' : '') + (num(s.rir) != null ? ' <span class="lb-muted">RIR ' + s.rir + '</span>' : '') + '</td><td class="r">' + (isWeighted(ex) && s.t !== 'w' && num(s.r) ? '<span class="lb-muted small">1RM ' + fmtN(e1rm(+s.w, +s.r), 1) + '</span>' : '') + (s.pr && s.pr.length ? ' <span class="lb-pr" title="' + esc(s.pr.join(', ')) + '">PR</span>' : '') + '</td></tr>').join('') + '</tbody></table></div>'; }).join('') +
          '<div class="lb-row"><button class="lb-btn primary" data-a="again" data-id="' + id + '">Perform again</button><button class="lb-btn ghost" data-a="editWorkout" data-id="' + id + '">Edit</button><button class="lb-btn ghost" data-a="saveAsTpl" data-id="' + id + '">Save as template</button><button class="lb-btn ghost" data-a="shareWorkout" data-id="' + id + '">Share</button><button class="lb-btn ghost" data-a="copySummary" data-id="' + id + '">Copy summary</button><button class="lb-btn ghost danger" data-a="askDelW">Delete</button></div><div class="lb-confirm" id="lb-delw" hidden><p>Delete this workout from your history? This can’t be undone.</p><button class="lb-btn danger" data-a="delW" data-id="' + id + '">Delete workout</button></div>';
      }
    });
  });
  on('askDelW', () => { const c = topSheet().el.querySelector('#lb-delw'); if (c) c.hidden = false; });
  on('delW', t => { remove('workouts', t.dataset.id); closeSheet(); toast('Workout deleted'); });
  on('saveAsTpl', t => {
    const w = S.data.workouts[t.dataset.id];
    const tpl = { id: uid(), name: w.name, folder: 'My templates', order: 99, notes: '', exercises: w.exercises.map(e => ({ exId: e.exId, unit: e.unit, notes: e.notes || '', rest: e.rest, ss: e.ss, sets: e.sets.map(s => { const c = clone(s); delete c.done; delete c.pr; return c; }) })) };
    put('templates', tpl); toast('Saved as template "' + tpl.name + '"');
  });
  function summaryText(w) {
    const st = workoutStats(w);
    return w.name + ' — ' + fmtDate(w.start) + '\n' + fmtDur(st.dur) + ' · ' + fmtN(st.vol, 0) + ' kg volume · ' + st.sets + ' sets' + (st.prs ? ' · ' + st.prs + ' PRs' : '') + '\n\n' +
      w.exercises.map(e => { const ex = getEx(e.exId); let n = 0; return ex.name + '\n' + e.sets.map(s => '  ' + (s.t === 'n' ? ++n : s.t.toUpperCase()) + ': ' + fmtSet(s, e, ex) + (s.pr && s.pr.length ? ' (PR)' : '')).join('\n'); }).join('\n\n');
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); toast('Copied'); }
    catch (e) {
      openSheet({ title: 'Copy this text', body: () => '<textarea class="lb-input lb-copy" readonly rows="14">' + esc(text) + '</textarea><p class="lb-muted small">Copying is blocked here. Select the text and copy it.</p>', mount: el => { const ta = el.querySelector('textarea'); ta.focus(); ta.select(); } });
    }
  }
  on('copySummary', t => copyText(summaryText(S.data.workouts[t.dataset.id])));

  // Share: WhatsApp-ready text + PNG card via the WorkoutShare module (opts.share or window.WorkoutShare).
  // Without the module, Share falls back to copying the plain summary.
  function shareModule() { return S.opts.share || (typeof window !== 'undefined' && window.WorkoutShare) || null; }
  function shareWorkout(w) {
    const WS = shareModule();
    if (!w) return;
    if (!WS) return copyText(summaryText(w));
    let sum, cv;
    try { sum = WS.summarize(w, getEx); cv = WS.draw(sum, { footer: S.opts.shareFooter || '' }); }
    catch (e) { return copyText(summaryText(w)); }
    const txt = WS.text(sum, { footer: S.opts.shareFooter || '' });
    const canFiles = typeof navigator !== 'undefined' && !!navigator.share;
    openSheet({
      title: 'Share workout',
      body: () => '<div class="lb-share"><img alt="' + esc(sum.name) + ' workout card"></div>' +
        '<div class="lb-row"><button class="lb-btn primary" data-a="shareSend">' + (canFiles ? 'Share…' : 'Save image') + '</button><button class="lb-btn ghost" data-a="shareCopy">Copy text</button>' + (canFiles ? '<button class="lb-btn ghost" data-a="shareSave">Save image</button>' : '') + '</div>' +
        '<details class="lb-share-text"><summary class="lb-muted small">Preview the text</summary><pre>' + esc(txt) + '</pre></details>',
      mount: el => { const img = el.querySelector('img'); try { img.src = cv.toDataURL('image/png'); } catch (e) { img.remove(); } }
    });
    shareCtx = { sum, cv, txt, WS };
  }
  let shareCtx = null;
  on('shareWorkout', t => shareWorkout(S.data.workouts[t.dataset.id]));
  on('shareSend', async () => {
    if (!shareCtx) return;
    const r = await shareCtx.WS.share(shareCtx.sum, { canvas: shareCtx.cv, footer: S.opts.shareFooter || '' });
    if (r === 'shared') toast('Shared'); else if (r === 'shared-text') toast('Shared the text (this browser can\u2019t share images)'); else if (r === 'copied') toast('Text copied, image downloaded'); else if (r === 'saved') toast('Image downloaded'); else if (r === 'failed') copyText(shareCtx.txt);
  });
  on('shareCopy', () => { if (shareCtx) copyText(shareCtx.txt); });
  on('shareSave', () => {
    if (!shareCtx) return;
    const name = (shareCtx.sum.name || 'workout').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() + '-' + isoDate(shareCtx.sum.start) + '.png';
    try { shareCtx.WS.download(shareCtx.cv.toDataURL('image/png'), name); toast('Image downloaded'); } catch (e) { toast('Could not save the image'); }
  });

  // Exercises tab
  function filteredExercises() {
    const q = exFilter.q.toLowerCase().trim();
    return allExercises().filter(e => (!q || e.name.toLowerCase().includes(q) || e.part.toLowerCase().includes(q)) && (!exFilter.part || e.part === exFilter.part) && (!exFilter.cat || e.cat === exFilter.cat));
  }
  function exFilters(prefix) {
    return '<div class="lb-filter"><input id="' + prefix + 'q" class="lb-input" type="search" placeholder="Search exercises" value="' + esc(exFilter.q) + '" data-in="exSearch" aria-label="Search exercises"><select class="lb-input" data-ch="exCat" aria-label="Equipment"><option value="">All equipment</option>' + CATS.map(c => '<option' + (c === exFilter.cat ? ' selected' : '') + '>' + c + '</option>').join('') + '</select><select class="lb-input" data-ch="exSort" aria-label="Sort"><option value="name"' + (exFilter.sort !== 'count' ? ' selected' : '') + '>A–Z</option><option value="count"' + (exFilter.sort === 'count' ? ' selected' : '') + '>Most done</option></select></div><div class="lb-chips">' + ['', ...PARTS].map(p => '<button data-a="exPart" data-k="' + p + '" class="' + (p === exFilter.part ? 'on' : '') + '">' + (p || 'All') + '</button>').join('') + '</div>';
  }
  function viewExercises() {
    const list = filteredExercises();
    return '<div class="lb-section-head"><h3>Exercises</h3><button class="lb-btn small" data-a="newEx">New exercise</button></div>' + exFilters('lb-ex') + '<div id="lb-exlist">' + exListHtml(list, 'exOpen') + '</div>';
  }
  // Strong-style rows: list picture (a still of the exercise's video clip, or a letter circle), name,
  // body part, and how many workouts it was done in (imported Strong history counts too).
  function exThumb(e) {
    const an = S.opts && S.opts.anim, src = an && an.thumb ? an.thumb(e.id) : null;
    return '<span class="lb-thumb" aria-hidden="true"><i>' + esc((e.name.match(/[A-Za-z0-9]/) || ['?'])[0].toUpperCase()) + '</i>' + (src ? '<img class="lb-thumb-img" src="' + esc(src) + '" alt="" loading="lazy" decoding="async" width="48" height="48">' : '') + '</span>';
  }
  const timesBand = n => n >= 50 ? '50+ times' : n >= 20 ? '20–49 times' : n >= 10 ? '10–19 times' : n >= 1 ? '1–9 times' : 'Not done yet';
  function exListHtml(list, act, picked) {
    if (!list.length) return '<div class="lb-empty">No exercise matches. Create it with New exercise.</div>';
    const byCount = exFilter.sort === 'count';
    const rows = list.map(e => ({ e, n: sessions(e.id).length }));
    if (byCount) rows.sort((a, b) => b.n - a.n || a.e.name.localeCompare(b.e.name));
    let html = '', head = '';
    rows.forEach(({ e, n }) => {
      const H = byCount ? timesBand(n) : e.name[0].toUpperCase();
      if (H !== head) { head = H; html += '<div class="lb-letter">' + esc(H) + '</div>'; }
      const sub = esc(e.part) + (/\(/.test(e.name) || e.cat === e.part ? '' : ' · ' + esc(e.cat)) + (e.custom ? ' · custom' : '') + (MAIN_LIFTS.includes(e.id) ? ' · <span class="lb-tag">Main lift</span>' : '') + (e.avoided ? ' · <span class="lb-tag warn">Avoided in plan</span>' : '');
      html += '<button class="lb-exrow' + (picked && picked.includes(e.id) ? ' picked' : '') + '" data-a="' + act + '" data-id="' + e.id + '">' + exThumb(e) + '<span class="lb-exname"><b>' + esc(e.name) + '</b><small>' + sub + '</small></span><span class="lb-excount"' + (n ? ' aria-label="Done ' + n + ' times"' : '') + '>' + (n || '') + '</span></button>';
    });
    return html;
  }
  let exSearchT;
  on('exSearch', t => { exFilter.q = t.value; clearTimeout(exSearchT); exSearchT = setTimeout(refreshExList, 120); });
  on('exCat', t => { exFilter.cat = t.value; refreshExList(); });
  on('exSort', t => { exFilter.sort = t.value === 'count' ? 'count' : 'name'; refreshExList(); });
  on('exPart', t => { exFilter.part = t.dataset.k; refreshExList(); const box = t.parentElement; box.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === t)); });
  function refreshExList() {
    const sh = topSheet();
    if (sh && sh.o.picker) { sh.el.querySelector('#lb-picklist').innerHTML = exListHtml(filteredExercises(), 'pickToggle', sh.o.picked); return; }
    const box = root.querySelector('#lb-exlist'); if (box) box.innerHTML = exListHtml(filteredExercises(), 'exOpen');
  }
  on('newEx', () => exEditor(null));
  function exEditor(id, after) {
    const ex = id ? getEx(id) : { name: exFilter.q || '', part: 'Chest', cat: 'Machine' };
    openSheet({
      title: id ? 'Edit exercise' : 'New exercise',
      body: () => '<label class="lb-field">Name<input id="lb-exname" class="lb-input" value="' + esc(ex.name) + '"' + (id && LIB[id] ? ' disabled' : '') + '></label><label class="lb-field">Body part<select id="lb-expart" class="lb-input"' + (id && LIB[id] ? ' disabled' : '') + '>' + PARTS.map(p => '<option' + (p === ex.part ? ' selected' : '') + '>' + p + '</option>').join('') + '</select></label><label class="lb-field">Equipment<select id="lb-excat" class="lb-input"' + (id && LIB[id] ? ' disabled' : '') + '>' + CATS.map(c => '<option' + (c === ex.cat ? ' selected' : '') + '>' + c + '</option>').join('') + '</select></label>' +
        '<label class="lb-field">Default unit<select id="lb-exunit" class="lb-input"><option value="">App default (' + S.settings.unit + ')</option><option value="kg"' + (ex.unit === 'kg' ? ' selected' : '') + '>kg</option><option value="lb"' + (ex.unit === 'lb' ? ' selected' : '') + '>lb</option></select></label><label class="lb-field">Rest timer (seconds)<input id="lb-exrest" class="lb-input" inputmode="numeric" placeholder="' + (ex.compound ? S.settings.restCompound : S.settings.restIso) + '" value="' + esc(ex.rest || '') + '"></label><label class="lb-field">Machine settings and notes<textarea id="lb-exmemo" class="lb-input" rows="3" placeholder="Seat height 4, pad on notch 6…">' + esc(ex.memo || '') + '</textarea></label>' +
        stepFieldHtml(ex) +
        '<label class="lb-check"><input type="checkbox" id="lb-excomp"' + (ex.compound ? ' checked' : '') + '> Big compound lift (uses the longer rest)</label>' +
        '<div class="lb-row"><button class="lb-btn primary wide" data-a="saveEx" data-id="' + (id || '') + '">Save</button></div>',
      onSave: after
    });
  }
  on('saveEx', t => {
    const el = topSheet().el, id = t.dataset.id;
    const v = s => el.querySelector(s).value.trim();
    const isLib = id && LIB[id];
    const name = v('#lb-exname');
    if (!isLib && !name) { toast('Give the exercise a name'); return; }
    const newId = id || ('c-' + slug(name) + '-' + uid().slice(-4));
    const unit = v('#lb-exunit') || undefined, step = num(v('#lb-exstep'));
    const doc = Object.assign({}, S.data.exercises[newId] || {}, { id: newId, unit, rest: num(v('#lb-exrest')) || undefined, memo: v('#lb-exmemo'), compound: el.querySelector('#lb-excomp').checked, step: step > 0 ? step : undefined, stepUnit: step > 0 ? (unit || S.settings.unit) : undefined });
    if (!isLib) Object.assign(doc, { name, part: v('#lb-expart'), cat: v('#lb-excat'), custom: true });
    put('exercises', JSON.parse(JSON.stringify(doc)));
    const after = topSheet().o.onSave;
    closeSheet(); toast('Saved');
    if (after) after(newId);
    const sh = topSheet(); if (sh) sh.render();
  });
  // Weight increment input with the common stack steps as chips. Saved in the exercise's logging unit.
  function stepFieldHtml(ex) {
    const unit = ex.unit || S.settings.unit, cur = num(ex.step) && (ex.stepUnit || unit) === unit ? +ex.step : '';
    const chips = unit === 'lb' ? [2.5, 5, 10] : [1, 1.25, 2, 2.5, 5];
    return '<label class="lb-field">Weight step (' + unit + ')<input id="lb-exstep" class="lb-input num" inputmode="decimal" placeholder="' + fmtN(defaultStep(ex, unit), 2) + ' (' + esc(ex.cat || 'Machine') + ' default)" value="' + cur + '"></label>' +
      '<div class="lb-row tight lb-chips">' + chips.map(c => '<button type="button" class="lb-btn small' + (cur === c ? ' primary' : ' ghost') + '" data-a="stepChip" data-v="' + c + '">' + fmtN(c, 2) + '</button>').join('') + '</div>' +
      '<p class="lb-muted small">The smallest jump this machine or dumbbell rack allows. Steppers, "try X next" hints and warm-ups round to it.</p>';
  }
  on('stepChip', t => { const el = topSheet().el, inp = el.querySelector('#lb-exstep'); if (inp) inp.value = t.dataset.v; el.querySelectorAll('[data-a="stepChip"]').forEach(b => { b.classList.toggle('primary', b === t); b.classList.toggle('ghost', b !== t); }); });
  // Quick machine setup while logging: seat / pin notes and the weight step, without leaving the workout.
  function memoHtml(ex, editable) {
    const txt = ex.memo ? esc(ex.memo).replace(/\n+/g, ' · ') : '';
    if (!editable) return txt ? '<p class="lb-memo small">' + txt + '</p>' : '';
    if (!txt) return ''; // empty: "Machine settings" sits in the exercise's ••• menu instead of a line under every exercise
    return '<button class="lb-memo-btn" data-a="exSetup" data-id="' + esc(ex.id) + '" aria-label="Machine settings">⚙ ' + txt + '</button>';
  }
  on('exSetupM', t => { const e = menuEx(t); closeSheet(); actions.exSetup({ dataset: { id: e.exId } }); });
  on('exSetup', t => {
    const id = t.dataset.id;
    openSheet({
      title: () => 'Machine settings · ' + getEx(id).name,
      body: () => { const ex = getEx(id); return '<label class="lb-field">Seat, pins, grips, notes<textarea id="lb-exmemo" class="lb-input" rows="3" placeholder="Seat 4, chest pad 6, handles wide…">' + esc(ex.memo || '') + '</textarea></label>' + stepFieldHtml(ex) + '<div class="lb-row"><button class="lb-btn primary wide" data-a="saveSetup" data-id="' + esc(id) + '">Save</button></div>'; }
    });
  });
  on('saveSetup', t => {
    const el = topSheet().el, id = t.dataset.id, ex = getEx(id), unit = ex.unit || S.settings.unit, step = num(el.querySelector('#lb-exstep').value);
    const doc = Object.assign({}, S.data.exercises[id] || {}, { id, memo: el.querySelector('#lb-exmemo').value.trim(), step: step > 0 ? step : undefined, stepUnit: step > 0 ? unit : undefined });
    put('exercises', JSON.parse(JSON.stringify(doc)));
    closeSheet(); toast('Saved');
    if (E) renderEditor(); else renderMain();
    const sh = topSheet(); if (sh) sh.render();
  });

  let exTab = 'about';
  // Form cues (optional FormCues instance passed as opts.formCues).
  const formFor = id => { const fc = S.opts && S.opts.formCues; return fc ? fc.find(id) || fc.find(getEx(id).name) : null; };
  // Demos start collapsed: a small "Demo" toggle expands the built-in animation card in place (Gym mode, List view, About).
  const demoOpen = new Set();
  function demoSlot(id) {
    const an = S.opts && S.opts.anim; if (!an || !an.has(id)) return '';
    return demoOpen.has(id)
      ? '<div class="lb-demo-wrap">' + an.cardHtml(id) + '<button type="button" class="lb-link small" data-a="demoHide" data-id="' + esc(id) + '">Hide demo</button></div>'
      : '<button type="button" class="lb-demo-toggle" data-a="demoShow" data-id="' + esc(id) + '" aria-expanded="false">&#9654; Demo</button>';
  }
  function demoRerender() { if (E) renderEditor(); const sh = topSheet(); if (sh) sh.render(); }
  on('demoShow', t => { demoOpen.add(t.dataset.id); demoRerender(); });
  on('demoHide', t => { demoOpen.delete(t.dataset.id); demoRerender(); });
  // Demo button: opens the built-in animation (opts.anim). No external video or search links.
  function demoBtn(id) {
    const an = S.opts && S.opts.anim;
    return an && an.has(id) ? '<button type="button" class="lb-btn small ghost" data-ea-open="' + esc(id) + '">Demo</button>' : '';
  }
  on('exOpen', t => {
    const id = t.dataset.id; exTab = 'about';
    openSheet({
      title: () => getEx(id).name, full: true,
      right: () => '<button class="lb-link" data-a="exEdit" data-id="' + id + '">Edit</button>',
      body: () => '<div class="lb-seg wide">' + [['about', 'About'], ['history', 'History'], ['charts', 'Charts'], ['records', 'Records']].map(([k, l]) => '<button data-a="exTab" data-k="' + k + '" class="' + (exTab === k ? 'on' : '') + '">' + l + '</button>').join('') + '</div>' + exDetail(id)
    });
  });
  on('exEdit', t => exEditor(t.dataset.id));
  on('exTab', t => { exTab = t.dataset.k; topSheet().render(); });
  function exDetail(id) {
    const ex = getEx(id), ss = sessions(id), R = records(id), weighted = isWeighted(ex);
    if (exTab === 'about') {
      return demoSlot(id) + '<div class="lb-tiles"><div><b>' + esc(ex.part) + '</b><span>Body part</span></div><div><b>' + esc(ex.cat) + '</b><span>Equipment</span></div><div><b>' + ss.length + '</b><span>Sessions</span></div><div><b>' + mmss(restFor(id)) + '</b><span>Rest timer</span></div>' + (weighted ? '<div><b>' + fmtN(weightStep(ex, ex.unit || S.settings.unit), 2) + ' ' + (ex.unit || S.settings.unit) + '</b><span>Weight step' + (num(ex.step) ? '' : ' (default)') + '</span></div>' : '') + '</div>' +
        (ex.avoided ? '<p class="lb-warnbox">Your plan avoids this lift (no deadlifts, RDLs, hip thrusts, back extensions, glute-ham raises, reverse hypers or cable pull-throughs). Pick a machine-based option instead.</p>' : '') +
        (MAIN_LIFTS.includes(id) ? '<p class="lb-note">Main lift on your watchlist. If it drops 2 sessions in a row, check sleep, pre-workout food and volume before touching calories.</p>' : '') +
        '<h4>Machine settings and notes</h4><p class="' + (ex.memo ? '' : 'lb-muted') + '">' + (ex.memo ? esc(ex.memo).replace(/\n/g, '<br>') : 'Nothing saved. Tap Edit to keep seat height, pin positions or cues here.') + '</p>' +
        (ss.length ? '<p class="lb-muted small">First logged ' + fmtDate(ss[ss.length - 1].w.start, { month: 'short', day: 'numeric', year: 'numeric' }) + ' · last ' + relDay(ss[0].w.start).toLowerCase() + '</p>' : '') +
        (S.opts.formCues ? S.opts.formCues.detailHtml(formFor(id)) : '') + (S.opts.tips ? S.opts.tips.detailHtml(id) : '');
    }
    if (!ss.length) return '<div class="lb-empty">No sets logged for this exercise yet.</div>';
    if (exTab === 'history') {
      return ss.slice(0, 60).map(({ w, e }) => { let n = 0; return '<div class="lb-hex"><div class="lb-tpl-top"><button class="lb-link strong" data-a="histOpen" data-id="' + w.id + '">' + esc(w.name) + '</button><span class="lb-muted small">' + fmtDate(w.start, { month: 'short', day: 'numeric', year: 'numeric' }) + '</span></div><table class="lb-tbl"><tbody>' + e.sets.map(s => '<tr><td class="lb-settag ' + s.t + '">' + (s.t === 'n' ? ++n : s.t.toUpperCase()) + '</td><td>' + esc(fmtSet(s, e, ex)) + '</td><td class="r">' + (weighted && s.t !== 'w' && num(s.r) ? '<span class="lb-muted small">' + fmtN(e1rm(+s.w, +s.r), 1) + ' ' + e.unit + '</span>' : '') + (s.pr && s.pr.length ? ' <span class="lb-pr">PR</span>' : '') + '</td></tr>').join('') + '</tbody></table></div>'; }).join('');
    }
    const asc = ss.slice().reverse();
    if (exTab === 'charts') {
      if (!weighted) {
        const f = fieldsFor(ex);
        const key = f[0] === 'km' ? 'km' : f[0] === 'sec' ? 'sec' : 'r';
        return chartBlock('Best ' + (key === 'km' ? 'distance (km)' : key === 'sec' ? 'time (s)' : 'reps'), asc.map(({ w, e }) => ({ x: w.start, y: Math.max(0, ...working(e).map(s => num(s[key]) || 0)) })));
      }
      const u = S.settings.unit, conv = v => u === 'lb' ? v / LB : v;
      return chartBlock('Estimated 1RM (' + u + ')', asc.map(({ w, e }) => { const b = bestSet(e); return { x: w.start, y: b ? conv(b.v) : 0 }; })) +
        chartBlock('Heaviest weight (' + u + ')', asc.map(({ w, e }) => ({ x: w.start, y: conv(Math.max(0, ...working(e).map(s => toKg(num(s.w) || 0, e.unit)))) }))) +
        chartBlock('Session volume (' + u + ')', asc.map(({ w, e }) => ({ x: w.start, y: conv(working(e).reduce((a, s) => a + toKg(num(s.w) || 0, e.unit) * (num(s.r) || 0), 0)) }))) +
        chartBlock('Best set volume (' + u + ')', asc.map(({ w, e }) => ({ x: w.start, y: conv(Math.max(0, ...working(e).map(s => toKg(num(s.w) || 0, e.unit) * (num(s.r) || 0)))) })));
    }
    // records
    const u = S.settings.unit, show = r => r ? fmtN(u === 'lb' ? r.v / LB : r.v, 1) + ' ' + u : '–';
    if (!weighted) return '<div class="lb-tiles">' + [['reps', 'Max reps'], ['km', 'Max distance (km)'], ['min', 'Longest (min)'], ['sec', 'Longest (s)']].filter(([k]) => R[k]).map(([k, l]) => '<div><b>' + fmtN(R[k].v, 2) + '</b><span>' + l + '</span></div>').join('') + '</div>';
    const reps = Object.keys(R.reps0).map(Number).sort((a, b) => a - b);
    return '<div class="lb-tiles"><div><b>' + show(R.e1rm) + '</b><span>Est. 1RM</span></div><div><b>' + show(R.weight) + '</b><span>Heaviest weight</span></div><div><b>' + show(R.volume) + '</b><span>Best set volume</span></div><div><b>' + show(R.sessionVol) + '</b><span>Best session volume</span></div></div>' +
      (R.e1rm ? '<p class="lb-muted small">Est. 1RM from ' + fmtN(R.e1rm.w, 2) + ' ' + R.e1rm.unit + ' × ' + R.e1rm.r + ' on ' + fmtDate(R.e1rm.at, { month: 'short', day: 'numeric' }) + ' (Epley formula).</p>' : '') +
      '<h4>Rep records</h4><table class="lb-tbl"><thead><tr><th>Reps</th><th>Best weight</th><th class="r">Date</th></tr></thead><tbody>' + reps.map(r => '<tr><td>' + r + '</td><td>' + fmtN(R.reps0[r].w, 2) + ' ' + R.reps0[r].unit + '</td><td class="r lb-muted">' + fmtDate(R.reps0[r].at, { month: 'short', day: 'numeric' }) + '</td></tr>').join('') + '</tbody></table>';
  }

  // Charts
  function chartBlock(title, pts, opts) { return '<div class="lb-chart"><h4>' + esc(title) + '</h4>' + lineChart(pts.filter(p => p.y > 0), opts) + '</div>'; }
  function niceTicks(min, max, n) {
    const span = max - min || Math.abs(max) || 1, step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0)), step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0) || mag * 10;
    const out = []; for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(6)); return out;
  }
  function lineChart(pts, opts) {
    opts = opts || {};
    if (pts.length < 1) return '<p class="lb-muted small">Not enough data yet.</p>';
    const W = 320, H = 150, L = 34, R = 14, T = 14, B = 22;
    const ys = pts.map(p => p.y).concat(opts.goal != null ? [opts.goal] : []);
    let lo = Math.min(...ys), hi = Math.max(...ys); const pad = (hi - lo) * 0.12 || hi * 0.05 || 1; lo -= pad; hi += pad;
    const x0 = pts[0].x, x1 = pts[pts.length - 1].x, sx = x => pts.length === 1 ? (L + W - R) / 2 : L + (x - x0) / (x1 - x0 || 1) * (W - L - R), sy = y => T + (hi - y) / (hi - lo) * (H - T - B);
    const ticks = niceTicks(lo, hi, 3);
    const line = pts.map(p => sx(p.x).toFixed(1) + ',' + sy(p.y).toFixed(1)).join(' ');
    const last = pts[pts.length - 1];
    let svg = '<svg class="lb-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Chart">';
    ticks.forEach(t => { svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + sy(t) + '" y2="' + sy(t) + '" class="grid"/><text x="' + (L - 4) + '" y="' + (sy(t) + 3) + '" text-anchor="end" class="ax">' + fmtN(t, 1) + '</text>'; });
    if (opts.goal != null) svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + sy(opts.goal) + '" y2="' + sy(opts.goal) + '" class="goal"/><text x="' + (W - R) + '" y="' + (sy(opts.goal) - 4) + '" text-anchor="end" class="ax goaltxt">Goal ' + opts.goal + '</text>';
    if (pts.length > 1) svg += '<polygon class="area" points="' + sx(x0) + ',' + (H - B) + ' ' + line + ' ' + sx(x1) + ',' + (H - B) + '"/><polyline class="ln" points="' + line + '"/>';
    if (pts.length <= 40) pts.forEach(p => { svg += '<circle class="pt" cx="' + sx(p.x) + '" cy="' + sy(p.y) + '" r="2.4"/>'; });
    svg += '<circle class="pt end" cx="' + sx(last.x) + '" cy="' + sy(last.y) + '" r="4.2"/><text class="val" x="' + Math.min(sx(last.x), W - R - 2) + '" y="' + (sy(last.y) - 9) + '" text-anchor="' + (pts.length === 1 ? 'middle' : 'end') + '">' + fmtN(last.y, 1) + '</text>';
    svg += '<text x="' + L + '" y="' + (H - 6) + '" class="ax">' + fmtDate(x0, { month: 'short', day: 'numeric' }) + '</text>' + (pts.length > 1 ? '<text x="' + (W - R) + '" y="' + (H - 6) + '" text-anchor="end" class="ax">' + fmtDate(x1, { month: 'short', day: 'numeric' }) + '</text>' : '');
    return svg + '</svg>';
  }
  function barChart(bars, label) {
    const W = 320, H = 130, L = 22, R = 6, T = 12, B = 22, max = Math.max(1, ...bars.map(b => b.v));
    const bw = (W - L - R) / bars.length;
    let svg = '<svg class="lb-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(label) + '">';
    niceTicks(0, max, 2).forEach(t => { const y = T + (1 - t / max) * (H - T - B); svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '" class="grid"/><text x="' + (L - 4) + '" y="' + (y + 3) + '" text-anchor="end" class="ax">' + t + '</text>'; });
    bars.forEach((b, i) => { const h = b.v / max * (H - T - B), x = L + i * bw + bw * 0.18; svg += '<rect class="bar' + (b.hi ? ' hi' : '') + '" x="' + x.toFixed(1) + '" y="' + (H - B - h).toFixed(1) + '" width="' + (bw * 0.64).toFixed(1) + '" height="' + Math.max(h, b.v ? 1.5 : 0).toFixed(1) + '" rx="2"/>' + (b.l ? '<text x="' + (x + bw * 0.32).toFixed(1) + '" y="' + (H - 7) + '" text-anchor="middle" class="ax">' + esc(b.l) + '</text>' : ''); });
    return svg + '</svg>';
  }

  // Progress tab
  function weightPoints() {
    if (S.shellWeights) return S.shellWeights.filter(w => w && w.date && w.kg).map(w => ({ x: fromIso(w.date), y: +w.kg })).sort((a, b) => a.x - b.x);
    return Object.values(S.data.measures).filter(m => m.type === 'weight').map(m => ({ x: m.date, y: +m.value })).sort((a, b) => a.x - b.x);
  }
  function measurePoints(type) { return type === 'weight' ? weightPoints() : Object.values(S.data.measures).filter(m => m.type === type).map(m => ({ x: m.date, y: +m.value, id: m.id })).sort((a, b) => a.x - b.x); }
  function viewProgress() {
    const ws = workouts(), now = Date.now(), wk0 = startOfWeek(now);
    const weeks = []; for (let i = 11; i >= 0; i--) { const s = wk0 - i * 7 * DAY; weeks.push({ s, v: ws.filter(w => w.start >= s && w.start < s + 7 * DAY).length }); }
    let streak = 0; for (let i = weeks.length - 1; i >= 0; i--) { if (weeks[i].v) streak++; else if (i === weeks.length - 1) continue; else break; }
    const thisWeek = weeks[weeks.length - 1].v;
    const vol7 = ws.filter(w => w.start > now - 7 * DAY).reduce((a, w) => a + workoutStats(w).vol, 0);
    const parts = {}; ws.filter(w => w.start > now - 7 * DAY).forEach(w => w.exercises.forEach(e => { const p = getEx(e.exId).part; if (p !== 'Cardio') parts[p] = (parts[p] || 0) + working(e).length; }));
    const partRows = Object.entries(parts).sort((a, b) => b[1] - a[1]);
    const maxP = Math.max(1, ...partRows.map(p => p[1]));
    const lifts = MAIN_LIFTS.map(id => ({ id, ex: getEx(id), t: liftTrend(id) }));
    const wp = weightPoints(), lastW = wp[wp.length - 1];
    return '<div class="lb-tiles"><div><b>' + thisWeek + '</b><span>Workouts this week</span></div><div><b>' + streak + '</b><span>Week streak</span></div><div><b>' + fmtN(vol7 / 1000, 1) + 't</b><span>Volume, last 7 days</span></div><div><b>' + ws.length + '</b><span>Total workouts</span></div></div>' +
      '<section class="lb-card"><h4>Workouts per week</h4>' + barChart(weeks.map((w, i) => ({ v: w.v, hi: i === weeks.length - 1, l: i % 3 === 2 || i === weeks.length - 1 ? fmtDate(w.s, { month: 'numeric', day: 'numeric' }) : '' })), 'Workouts per week') + '</section>' +
      '<section class="lb-card"><h4>Main lifts</h4><p class="lb-muted small">Best working set per session (estimated 1RM). A red flag means it dropped 2 sessions in a row.</p><div class="lb-lifts">' + lifts.map(({ id, ex, t }) => { const s0 = t.ss[0]; return '<button class="lb-lift' + (t.dropping ? ' drop' : '') + '" data-a="exOpen" data-id="' + id + '"><span class="nm">' + esc(ex.name) + '</span><span class="lb-mono">' + (s0 ? esc(fmtSet(s0.s, { unit: s0.unit, exId: id })) : '<span class="lb-muted">no sets yet</span>') + '</span>' + spark(t.ss.slice().reverse().map(s => s.v)) + (t.dropping ? '<span class="lb-flag">Dropped 2 sessions in a row. Check sleep, pre-workout food and volume first.</span>' : '') + '</button>'; }).join('') + '</div></section>' +
      '<section class="lb-card"><h4>Sets per muscle, last 7 days</h4>' + (partRows.length ? '<div class="lb-bars">' + partRows.map(([p, n]) => '<div><span>' + esc(p) + '</span><i style="width:' + (n / maxP * 100).toFixed(0) + '%"></i><b>' + n + '</b></div>').join('') + '</div>' : '<p class="lb-muted">No working sets in the last 7 days.</p>') + '</section>' +
      '<div class="lb-section-head"><h3>Measurements</h3><button class="lb-btn small" data-a="logMeasure" data-k="weight">Log</button></div>' +
      '<button class="lb-card lb-weight" data-a="measureOpen" data-k="weight"><div class="lb-tpl-top"><b>Body weight</b><span class="lb-muted small">' + (goalKg() != null ? 'Goal ' + goalKg() + ' kg' : '') + '</span></div>' + (lastW ? '<div class="lb-big">' + fmtN(lastW.y, 1) + ' <small>kg</small></div><p class="lb-muted small">' + fmtDate(lastW.x) + (goalKg() != null ? ' · ' + fmtN(lastW.y - goalKg(), 1) + ' kg to go' : '') + '</p>' + lineChart(wp.slice(-30), { goal: goalKg() }) : '<p class="lb-muted">No weigh-ins yet.</p>') + '</button>' +
      '<div class="lb-mgrid">' + MEASURES.filter(m => m.id !== 'weight').map(m => { const p = measurePoints(m.id), l = p[p.length - 1]; return '<button class="lb-card lb-m" data-a="measureOpen" data-k="' + m.id + '"><span>' + esc(m.name) + '</span><b>' + (l ? fmtN(l.y, 1) + ' ' + m.unit : '–') + '</b></button>'; }).join('') + '</div>';
  }
  function spark(vals) {
    if (vals.length < 2) return '<span></span>';
    const W = 70, H = 22, lo = Math.min(...vals), hi = Math.max(...vals), r = hi - lo || 1;
    const pts = vals.map((v, i) => (i / (vals.length - 1) * (W - 4) + 2).toFixed(1) + ',' + (H - 3 - (v - lo) / r * (H - 6)).toFixed(1)).join(' ');
    return '<svg class="lb-spark" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true"><polyline points="' + pts + '"/></svg>';
  }
  on('measureOpen', t => {
    const m = MEASURES.find(x => x.id === t.dataset.k);
    openSheet({
      title: m.name,
      right: () => '<button class="lb-link" data-a="logMeasure" data-k="' + m.id + '">Log</button>',
      body: () => {
        const p = measurePoints(m.id);
        if (!p.length) return '<div class="lb-empty">No entries yet. Tap Log to add the first one.</div>';
        let extra = '';
        if (m.id === 'weight') {
          const last7 = p.filter(x => x.x > p[p.length - 1].x - 7 * DAY), avg = last7.reduce((a, x) => a + x.y, 0) / last7.length;
          extra = '<div class="lb-tiles"><div><b>' + fmtN(p[p.length - 1].y, 1) + '</b><span>Latest kg</span></div><div><b>' + (last7.length >= 3 ? fmtN(avg, 1) : '–') + '</b><span>7-day average</span></div><div><b>' + fmtN(p[p.length - 1].y - p[0].y, 1) + '</b><span>Change kg</span></div>' + (goalKg() != null ? '<div><b>' + fmtN(p[p.length - 1].y - goalKg(), 1) + '</b><span>To ' + goalKg() + ' kg</span></div>' : '') + '</div><p class="lb-muted small">Judge progress by weekly averages, not single weigh-ins. Saturday readings can run high after Friday’s salty meal.</p>';
        }
        return extra + lineChart(p, m.id === 'weight' ? { goal: goalKg() } : {}) + '<table class="lb-tbl"><tbody>' + p.slice().reverse().map((x, i, arr) => { const prev = arr[i + 1]; return '<tr><td>' + fmtDate(x.x, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) + '</td><td class="r">' + fmtN(x.y, 1) + ' ' + m.unit + '</td><td class="r lb-muted small">' + (prev ? (x.y - prev.y >= 0 ? '+' : '') + fmtN(x.y - prev.y, 1) : '') + '</td><td class="r">' + (x.id ? '<button class="lb-link danger small" data-a="delMeasure" data-id="' + x.id + '" aria-label="Delete entry">Delete</button>' : '') + '</td></tr>'; }).join('') + '</tbody></table>';
      }
    });
  });
  on('logMeasure', t => {
    const m = MEASURES.find(x => x.id === t.dataset.k);
    openSheet({
      title: 'Log ' + m.name.toLowerCase(),
      body: () => '<label class="lb-field">Measurement<select id="lb-mtype" class="lb-input">' + MEASURES.map(x => '<option value="' + x.id + '"' + (x.id === m.id ? ' selected' : '') + '>' + x.name + ' (' + x.unit + ')</option>').join('') + '</select></label><label class="lb-field">Value<input id="lb-mval" class="lb-input" inputmode="decimal" autofocus></label><label class="lb-field">Date<input id="lb-mdate" class="lb-input" type="date" value="' + isoDate(Date.now()) + '"></label><div class="lb-row"><button class="lb-btn primary wide" data-a="saveMeasure">Save</button></div>'
    });
  });
  on('saveMeasure', async () => {
    const el = topSheet().el, type = el.querySelector('#lb-mtype').value, value = num(el.querySelector('#lb-mval').value.replace(',', '.')), date = el.querySelector('#lb-mdate').value || isoDate(Date.now());
    if (value == null) { toast('Enter a number'); return; }
    if (type === 'weight' && S.opts.weights) {
      try { await S.opts.weights.put(date, value); S.shellWeights = (S.shellWeights || []).filter(w => w.date !== date).concat([{ date, kg: value }]); bump(); }
      catch (e) { toast('Not saved: ' + (e.code || e.message)); return; }
    } else put('measures', { id: type + '-' + date, type, value, date: fromIso(date) });
    closeSheet(); toast('Logged'); const sh = topSheet(); if (sh) sh.render();
  });
  on('delMeasure', t => { remove('measures', t.dataset.id); topSheet().render(); });

  // Tools tab
  let plate = { mode: 'total', val: 90, unit: 'kg' }, warm = { w: 90, unit: 'kg' }, orm = { w: 90, r: 8 };
  function viewTools() {
    return '<section class="lb-card"><h4>Plate calculator</h4>' + plateTool() + '</section>' +
      '<section class="lb-card"><h4>Warm-up calculator</h4>' + warmTool() + '</section>' +
      '<section class="lb-card"><h4>1RM calculator</h4>' + ormTool() + '</section>' +
      '<section class="lb-card"><h4>Rest timer</h4><p class="lb-muted small">Starts on its own when you check off a set. Start one by hand here.</p><div class="lb-row">' + [60, 90, 120, 150, 180].map(s => '<button class="lb-btn small" data-a="restManual" data-s="' + s + '">' + mmss(s) + '</button>').join('') + '</div><div class="lb-row tight"><input id="lb-restman" class="lb-input num lb-restin" inputmode="text" placeholder="Any time, e.g. 2:15" aria-label="Rest time"><button class="lb-btn small primary" data-a="restManualTyped">Start</button></div></section>' +
      '<section class="lb-card"><h4>Settings</h4>' + settingsHtml() + '</section>' +
      '<section class="lb-card"><h4>Your data</h4><p class="lb-muted small">Bring your history over from Strong (Settings → Export data in Strong gives a CSV), or back everything up.</p><div class="lb-row"><label class="lb-btn small">Import Strong CSV<input type="file" accept=".csv,text/csv" data-ch="importCsv" hidden></label><button class="lb-btn small ghost" data-a="exportCsv">Export CSV</button><button class="lb-btn small ghost" data-a="exportJson">Back up (JSON)</button><label class="lb-btn small ghost">Restore backup<input type="file" accept=".json,application/json" data-ch="importJson" hidden></label></div><label class="lb-field inline">Weights in the Strong file are in<select id="lb-impunit" class="lb-input"><option>kg</option><option>lb</option></select></label></section>';
  }
  function platesFor(perSide, unit) {
    const list = unit === 'lb' ? S.settings.platesLb : S.settings.platesKg, out = [];
    let rem = Math.round(perSide * 100) / 100;
    list.forEach(p => { while (rem >= p - 1e-9) { out.push(p); rem = Math.round((rem - p) * 100) / 100; } });
    return { plates: out, rem };
  }
  // Smallest total you can actually load at or above this per-side weight.
  function loadableUp(perSide, unit) {
    const list = unit === 'lb' ? S.settings.platesLb : S.settings.platesKg, small = Math.min(...list), r = platesFor(Math.max(0, perSide), unit);
    return r.rem > 0 ? Math.round((perSide - r.rem + small) * 100) / 100 : Math.round(perSide * 100) / 100;
  }
  const PLATE_COLORS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];
  function plateSvg(plates, unit) {
    const list = unit === 'lb' ? S.settings.platesLb : S.settings.platesKg;
    const W = 300, H = 110, cy = H / 2; let x = 40;
    let svg = '<svg class="lb-svg lb-plates" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Plates on one side"><rect class="sleeve" x="10" y="' + (cy - 6) + '" width="' + (W - 20) + '" height="12" rx="3"/><rect class="collar" x="30" y="' + (cy - 14) + '" width="8" height="28" rx="2"/>';
    plates.forEach(p => { const i = list.indexOf(p), h = 96 - i * 11, w = 14 - Math.min(i, 5); svg += '<rect class="plate ' + PLATE_COLORS[i] + '" x="' + x + '" y="' + (cy - h / 2) + '" width="' + w + '" height="' + h + '" rx="2.5"/>'; x += w + 2; });
    return svg + '</svg>';
  }
  function plateTool() {
    const bar = plate.unit === 'lb' ? S.settings.barLb : S.settings.bar;
    const per = plate.mode === 'total' ? (plate.val - bar) / 2 : plate.val;
    const total = plate.mode === 'total' ? plate.val : plate.val * 2 + bar;
    const r = platesFor(Math.max(0, per), plate.unit);
    return '<div class="lb-row tight"><div class="lb-seg"><button data-a="plateMode" data-k="total" class="' + (plate.mode === 'total' ? 'on' : '') + '">Total weight</button><button data-a="plateMode" data-k="side" class="' + (plate.mode === 'side' ? 'on' : '') + '">Per side</button></div><div class="lb-seg"><button data-a="plateUnit" data-k="kg" class="' + (plate.unit === 'kg' ? 'on' : '') + '">kg</button><button data-a="plateUnit" data-k="lb" class="' + (plate.unit === 'lb' ? 'on' : '') + '">lb</button></div></div>' +
      '<div class="lb-row tight"><label class="lb-field inline">' + (plate.mode === 'total' ? 'Total' : 'Per side') + '<input class="lb-input num" id="lb-plateval" inputmode="decimal" value="' + plate.val + '" data-in="plateVal"></label><label class="lb-field inline">Bar<input class="lb-input num" inputmode="decimal" value="' + bar + '" data-in="barVal"></label></div>' +
      '<div id="lb-plateout">' + (per < 0 ? '<p class="lb-muted">That is lighter than the bar.</p>' : plateSvg(r.plates, plate.unit) + '<p><b>Each side:</b> ' + (r.plates.length ? r.plates.join(' + ') + ' ' + plate.unit : 'empty bar') + (r.rem > 0 ? ' <span class="lb-warn">(' + fmtN(r.rem, 2) + ' ' + plate.unit + ' left over)</span>' : '') + '</p>' + (r.rem > 0 ? '<p class="lb-hint small">Load ' + fmtN(total - r.rem * 2, 2) + ' or ' + fmtN(loadableUp(per, plate.unit) * 2 + bar, 2) + ' ' + plate.unit + ' instead.</p>' : '') + '<p class="lb-muted small">Total on the bar: ' + fmtN(total - r.rem * 2, 2) + ' ' + plate.unit + ' · ' + fmtN(Math.max(0, per), 2) + ' per side</p>') + '</div>';
  }
  function refreshTool(id, html) { const el = root.querySelector(id) || (topSheet() && topSheet().el.querySelector(id)); if (el) el.innerHTML = html; }
  on('plateMode', t => { const bar = plate.unit === 'lb' ? S.settings.barLb : S.settings.bar; if (t.dataset.k !== plate.mode) plate.val = t.dataset.k === 'side' ? Math.max(0, (plate.val - bar) / 2) : plate.val * 2 + bar; plate.mode = t.dataset.k; rerenderTools(); });
  on('plateUnit', t => { plate.unit = t.dataset.k; rerenderTools(); });
  on('plateVal', t => { plate.val = num(t.value) || 0; partialPlate(); });
  on('barVal', t => { const v = num(t.value) || 0; if (plate.unit === 'lb') S.settings.barLb = v; else S.settings.bar = v; saveSettingsSoon(); partialPlate(); });
  function partialPlate() { const tmp = document.createElement('div'); tmp.innerHTML = plateTool(); refreshTool('#lb-plateout', tmp.querySelector('#lb-plateout').innerHTML); }
  function rerenderTools() { const sh = topSheet(); if (sh && sh.o.tool) sh.render(); else renderMain(); }
  let settingsT; function saveSettingsSoon() { clearTimeout(settingsT); settingsT = setTimeout(saveSettings, 600); }
  function warmSets(w, unit, bar, step) {
    step = step || (unit === 'lb' ? 5 : 2.5); const rd = v => Math.max(bar, snapStep(v, step));
    const plan = [[0, 10], [0.5, 8], [0.7, 5], [0.85, 3]];
    const out = []; plan.forEach(([p, r]) => { const v = p ? rd(w * p) : bar; if (v < w && !out.some(o => o.w === v)) out.push({ w: v, r }); });
    return out;
  }
  function warmTool() {
    const bar = warm.unit === 'lb' ? S.settings.barLb : S.settings.bar, list = warmSets(warm.w, warm.unit, bar);
    return '<div class="lb-row tight"><label class="lb-field inline">Working weight<input class="lb-input num" inputmode="decimal" value="' + warm.w + '" data-in="warmVal"></label><div class="lb-seg"><button data-a="warmUnit" data-k="kg" class="' + (warm.unit === 'kg' ? 'on' : '') + '">kg</button><button data-a="warmUnit" data-k="lb" class="' + (warm.unit === 'lb' ? 'on' : '') + '">lb</button></div></div><div id="lb-warmout"><table class="lb-tbl"><thead><tr><th>Set</th><th>Weight</th><th>Reps</th><th class="r">Plates per side</th></tr></thead><tbody>' + list.map((s, i) => '<tr><td class="lb-settag w">W' + (i + 1) + '</td><td>' + fmtN(s.w, 2) + ' ' + warm.unit + '</td><td>' + s.r + '</td><td class="r lb-muted small">' + (platesFor((s.w - bar) / 2, warm.unit).plates.join(' + ') || 'bar') + '</td></tr>').join('') + '<tr><td class="lb-settag n">1</td><td><b>' + fmtN(warm.w, 2) + ' ' + warm.unit + '</b></td><td>work</td><td class="r lb-muted small">' + (platesFor((warm.w - bar) / 2, warm.unit).plates.join(' + ') || 'bar') + '</td></tr></tbody></table><p class="lb-muted small">Bar, then about 50%, 70% and 85% of your working weight. Your saved Push A bench warm-ups (bar, 40, 60, 70) are already in the template.</p></div>';
  }
  on('warmVal', t => { warm.w = num(t.value) || 0; const tmp = document.createElement('div'); tmp.innerHTML = warmTool(); refreshTool('#lb-warmout', tmp.querySelector('#lb-warmout').innerHTML); });
  on('warmUnit', t => { warm.unit = t.dataset.k; rerenderTools(); });
  function ormTool() {
    const one = e1rm(orm.w, orm.r);
    const pct = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15].map(r => ({ r, w: r === 1 ? one : one / (1 + r / 30) }));
    return '<div class="lb-row tight"><label class="lb-field inline">Weight<input class="lb-input num" inputmode="decimal" value="' + orm.w + '" data-in="ormW"></label><label class="lb-field inline">Reps<input class="lb-input num" inputmode="numeric" value="' + orm.r + '" data-in="ormR"></label></div><div id="lb-ormout"><div class="lb-big">' + fmtN(one, 1) + ' <small>est. 1RM</small></div><div class="lb-reptable">' + pct.map(p => '<div><b>' + fmtN(p.w, 1) + '</b><span>' + p.r + ' rep' + (p.r > 1 ? 's' : '') + ' · ' + Math.round(p.w / (one || 1) * 100) + '%</span></div>').join('') + '</div></div>';
  }
  function ormRefresh() { const tmp = document.createElement('div'); tmp.innerHTML = ormTool(); refreshTool('#lb-ormout', tmp.querySelector('#lb-ormout').innerHTML); }
  on('ormW', t => { orm.w = num(t.value) || 0; ormRefresh(); });
  on('ormR', t => { orm.r = num(t.value) || 0; ormRefresh(); });
  function settingsHtml() {
    const st = S.settings, tog = (k, l) => '<label class="lb-check"><input type="checkbox" data-ch="setTog" data-k="' + k + '"' + (st[k] ? ' checked' : '') + '> ' + l + '</label>';
    return '<label class="lb-field inline">Default unit<select class="lb-input" data-ch="setUnit"><option' + (st.unit === 'kg' ? ' selected' : '') + '>kg</option><option' + (st.unit === 'lb' ? ' selected' : '') + '>lb</option></select></label>' +
      '<label class="lb-field inline">Rest after big compounds (m:ss)<input class="lb-input num lb-restin" inputmode="text" placeholder="2:30" value="' + mmss(st.restCompound) + '" data-ch="setRest" data-k="restCompound"></label><label class="lb-field inline">Rest after other lifts (m:ss)<input class="lb-input num lb-restin" inputmode="text" placeholder="1:30" value="' + mmss(st.restIso) + '" data-ch="setRest" data-k="restIso"></label>' +
      restLookHtml() +
      tog('sound', 'Play a sound when rest ends') + tog('vibrate', 'Vibrate when rest ends') + tog('countBuzz', 'Buzz at 3, 2 and 1 seconds left') + tog('wake', 'Keep the screen on during a workout') + tog('rpe', 'Show an RPE column') + tog('rir', 'Show an RIR column (reps in reserve)') + tog('gym', 'Open workouts in Gym mode (big buttons, one set at a time)');
  }
  function restLookHtml() {
    const st = S.settings, chips = (k, list) => '<div class="lb-row tight lb-chips">' + list.map(([id, l]) => '<button class="lb-btn small' + (st[k] === id ? ' primary' : ' ghost') + '" data-a="setPick" data-k="' + k + '" data-v="' + id + '" aria-pressed="' + (st[k] === id) + '">' + esc(l) + '</button>').join('') + '</div>';
    return '<div class="lb-field"><span>Rest timer look</span>' + chips('restStyle', REST_STYLES) + '<button class="lb-link small" data-a="restTry">Try it (10 s)</button></div>' +
      '<div class="lb-field"><span>Countdown in the notification</span>' + chips('restNotify', REST_NOTIFY) + '<small class="lb-muted">' + esc(REST_NOTIFY_HELP[restNotify()]) + '</small></div>' +
      '<div class="lb-field"><span>Sound when rest ends</span>' + chips('restSound', restSounds()) + '</div>' +
      '<div class="lb-field"><span>Sound when you tick a set</span>' + chips('setSound', setSounds()) + '</div>';
  }
  on('setPick', t => {
    const k = t.dataset.k, v = t.dataset.v;
    if (k === 'restStyle' && !REST_STYLES.some(r => r[0] === v)) return;
    if (k === 'restSound' && !restSounds().some(r => r[0] === v)) return;
    if (k === 'restNotify' && !REST_NOTIFY.some(r => r[0] === v)) return;
    noteSetting(k, v);
    if (k === 'restNotify' && rest) restCue(); // the live notification switches look at once
    if (k === 'setSound' && !setSounds().some(r => r[0] === v)) return;
    if ((k === 'restSound' || k === 'setSound') && v !== 'off' && GS()) { GS().prime(); GS().play(v); }
    if (k === 'restStyle' && rest) renderRest();
    rerenderTools();
  });
  on('restTry', () => { primeAudio(); previewRest(10); });
  on('setTog', t => noteSetting(t.dataset.k, t.checked));
  on('setUnit', t => { S.settings.unit = t.value; saveSettings(); bump(); });
  on('setRest', t => { const v = parseRest(t.value); if (v == null || v < 5) { toast('Type a time like 1:45 or 105'); t.value = mmss(S.settings[t.dataset.k]); return; } S.settings[t.dataset.k] = v; t.value = mmss(v); saveSettings(); });
  on('setNum', t => { const v = num(t.value); if (v) { S.settings[t.dataset.k] = v; saveSettings(); } });

  // Import / export
  const csvCell = v => { v = v == null ? '' : String(v); return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  function toCsv() {
    const rows = [['Date', 'Workout Name', 'Duration', 'Exercise Name', 'Set Order', 'Weight', 'Weight Unit', 'Reps', 'Distance', 'Seconds', 'RPE', 'Notes', 'Workout Notes']];
    workouts().slice().reverse().forEach(w => w.exercises.forEach(e => { let n = 0; const ex = getEx(e.exId); e.sets.forEach(s => rows.push([new Date(w.start).toISOString().replace('T', ' ').slice(0, 19), w.name, fmtDur(w.end - w.start), ex.name, s.t === 'n' ? ++n : s.t.toUpperCase(), s.w ?? '', e.unit, s.r ?? '', s.km ?? '', s.sec != null && s.sec !== '' ? s.sec : (s.min ? +s.min * 60 : ''), s.rpe ?? '', e.notes || '', w.notes || ''])); }));
    return rows.map(r => r.map(csvCell).join(',')).join('\n');
  }
  async function offerFile(filename, data) {
    const dl = S.opts.downloads || (global.claude && global.claude.use ? await global.claude.use('downloads').catch(() => null) : null);
    if (dl) { try { await dl.save({ filename, data }); return; } catch (e) { if (e && e.code === 'cancelled') return; } }
    copyText(data);
  }
  on('exportCsv', () => offerFile('liftbook-workouts-' + isoDate(Date.now()) + '.csv', toCsv()));
  on('exportJson', () => offerFile('liftbook-backup-' + isoDate(Date.now()) + '.json', JSON.stringify({ app: 'liftbook', v: 1, exported: Date.now(), data: S.data, settings: S.settings }, null, 1)));
  function parseCsv(text) {
    const first = text.split('\n')[0]; const sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"') q = true; else if (c === sep) { row.push(cell); cell = ''; } else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; } else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(c => c.trim()));
  }
  const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  function parseDurMs(s) { if (!s) return 0; let ms = 0; const h = /(\d+)\s*h/.exec(s), m = /(\d+)\s*m(?!s)/.exec(s), sec = /(\d+)\s*s/.exec(s); if (h) ms += h[1] * 36e5; if (m) ms += m[1] * 6e4; if (sec) ms += sec[1] * 1e3; if (!h && !m && !sec && /^\d+$/.test(s.trim())) ms = +s * 1e3; return ms; }
  function guessCat(name) { const p = /\(([^)]+)\)\s*$/.exec(name); const k = p ? p[1].toLowerCase() : ''; return k.includes('barbell') ? 'Barbell' : k.includes('dumbbell') ? 'Dumbbell' : k.includes('cable') ? 'Cable' : k.includes('smith') ? 'Smith machine' : k.includes('plate') ? 'Plate-loaded' : k.includes('assisted') ? 'Assisted' : k.includes('bodyweight') ? 'Bodyweight' : k.includes('machine') ? 'Machine' : 'Machine'; }
  on('importCsv', async t => {
    const file = t.files && t.files[0]; if (!file) return;
    const unitSel = root.querySelector('#lb-impunit'), unit = unitSel ? unitSel.value : 'kg';
    const text = await file.text(); t.value = '';
    const r = await importStrong(text, { unit });
    if (r.error) { toast(r.error); return; }
    toast('Imported ' + r.added + ' workouts' + (r.updated ? ', updated ' + r.updated : '') + (r.skipped ? ', skipped ' + r.skipped + ' logged here' : '') + (r.newEx ? ', added ' + r.newEx + ' exercises' : ''));
  });
  // Strong names Aziz used (Nov 2024 - Oct 2026 export) -> library names. Keys are norm()ed.
  const STRONG_ALIASES = {
    'seatedabs': 'Seated Abs (Machine)', 'tricepspushdowncablestraightbar': 'Triceps Pushdown (Straight Bar)',
    'latpulldownunderhandcable': 'Lat Pulldown (Reverse Grip)', 'trapsmachinefrontback': 'Shrug (Machine)', 'trapsmachine': 'Shrug (Machine)',
    'calfpressonseatedlegpress': 'Calf Press (Leg Press)', 'highrowmachine': 'High Row (Machine)',
    'isolaterallowrowplate': 'Iso-Lateral Low Row (Plate-loaded)', 'isolateralrowmachine': 'Iso-Lateral Low Row (Plate-loaded)',
    'sidedeltsshoulders': 'Lateral Raise (Dumbbell)', 'sidedelts': 'Lateral Raise (Dumbbell)', 'standingsidedelts': 'Standing Lateral Raise (Machine)',
    'tricepsropecable': 'Triceps Rope Pushdown (Cable)', 'tricepsrope': 'Triceps Rope Pushdown (Cable)', 'seatedoverheadmachine': 'Shoulder Press (Machine)',
    'bicepseatedcurl': 'Seated Bicep Curl (Machine)', 'seatedbicepcurl': 'Seated Bicep Curl (Machine)', 'seatedshouldersmithback': 'Seated Overhead Press (Smith Machine)',
    'hacksquat': 'Hack Squat (Machine)', 'gundam': 'Gundam Chest Press (Machine)', 'gundamchestmachine': 'Gundam Chest Press (Machine)',
    'legpress': 'Leg Press (Machine)', 'cablestandingbiceps': 'Standing Bicep Curl (Cable)', 'latpulldownsinglearm': 'Lat Pulldown - Single Arm (Cable)',
    'flatbenchbarbell': 'Bench Press (Barbell)', 'ezbarcurl': 'Bicep Curl (EZ Bar)', 'legextension': 'Leg Extension (Machine)', 'lyinglegcurl': 'Lying Leg Curl (Machine)',
    'hipadductor': 'Hip Adductor (Machine)', 'hipabductor': 'Hip Abductor (Machine)', 'standingcalfraise': 'Standing Calf Raise (Machine)', 'smithsquat': 'Squat (Smith Machine)',
    'inclinedbpress': 'Incline Bench Press (Dumbbell)', 'dbcurl': 'Bicep Curl (Dumbbell)', 'frontraisedb': 'Front Raise (Dumbbell)', 'seateddboverheadpress': 'Seated Overhead Press (Dumbbell)',
    'latpulldownwide': 'Lat Pulldown - Wide Grip (Cable)', 'isolaterallowrow': 'Iso-Lateral Low Row (Plate-loaded)',
  };
  const PROG_UNIT = {}; PROGRAM_SRC.forEach(([, list]) => list.forEach(([n, u]) => { if (u === 'kg' || u === 'lb') PROG_UNIT[slug(n)] = u; }));
  // Pure: Strong CSV text -> {workouts:[{doc, action}], newExercises:[], error?}. action: add | update (same import again) | skip (a workout logged here that day).
  // Handles both Strong layouts (comma + "Weight", or semicolon + "Weight (kg)" + "Duration (sec)"), Note rows, warm-up/drop/failure set orders.
  function parseStrong(text, opts) {
    opts = opts || {};
    const rows = parseCsv(String(text || '').replace(/^﻿/, ''));
    if (rows.length < 2) return { error: 'That file has no rows', workouts: [], newExercises: [] };
    const h = rows[0].map(x => x.trim().toLowerCase()), col = re => h.findIndex(x => re.test(x));
    const ci = { date: col(/^date$/), name: col(/^workout name$/), dur: col(/^duration/), ex: col(/^exercise name$/), order: col(/^set order$/), w: col(/^weight/), r: col(/^reps$/), d: col(/^distance/), s: col(/^seconds$/), notes: col(/^notes$/), wnotes: col(/^workout notes$/), rpe: col(/^rpe$/), wu: col(/^weight unit$/) };
    if (ci.date < 0 || ci.ex < 0) return { error: 'This doesn’t look like a Strong export (needs Date and Exercise Name columns)', workouts: [], newExercises: [] };
    const fileUnit = ci.w >= 0 && /\(lb/.test(h[ci.w]) ? 'lb' : ci.w >= 0 && /\(kg/.test(h[ci.w]) ? 'kg' : (opts.unit === 'lb' ? 'lb' : 'kg');
    const durSec = ci.dur >= 0 && /sec/.test(h[ci.dur]);
    const byName = {}; allExercises().forEach(e => { byName[norm(e.name)] = e.id; });
    const libByName = {}; Object.values(LIB).forEach(e => { libByName[norm(e.name)] = e.id; });
    const newExercises = [], newIds = {};
    const existing = (opts.existing || Object.values(S.data.workouts)).filter(w => w && w.start);
    const byId = {}; existing.forEach(w => { byId[w.id] = w; });
    const loggedDays = new Set(existing.filter(w => !w.imported).map(w => isoDate(w.start)));
    const groups = new Map();
    rows.slice(1).forEach(r => {
      const key = r[ci.date] + '|' + (ci.name >= 0 ? r[ci.name] : '');
      if (!groups.has(key)) groups.set(key, []); groups.get(key).push(r);
    });
    const out = [];
    for (const [, g] of groups) {
      const r0 = g[0], start = new Date(String(r0[ci.date]).trim().replace(' ', 'T')).getTime();
      if (isNaN(start)) continue;
      const name = (ci.name >= 0 && String(r0[ci.name]).trim()) || 'Workout';
      const durMs = ci.dur >= 0 ? (durSec ? (num(r0[ci.dur]) || 0) * 1e3 : parseDurMs(r0[ci.dur])) : 0;
      const w = { id: 'imp-' + start.toString(36) + '-' + slug(name).slice(0, 12), name, templateName: ROTATION.includes(name) ? name : undefined, start, end: start + (durMs || 60 * 6e4), notes: ci.wnotes >= 0 ? String(r0[ci.wnotes] || '').trim() : '', exercises: [], imported: true, source: 'strong' };
      const tpl = templateByName(name); if (tpl) w.templateId = tpl.id;
      g.forEach(r => {
        const exName = String(r[ci.ex] || '').trim(); if (!exName) return;
        const order = (ci.order >= 0 ? String(r[ci.order] || '') : '').trim().toUpperCase();
        if (order && !/^\d+$/.test(order) && !['W', 'D', 'F'].includes(order)) return; // Note / Rest Timer rows
        const n = norm(exName), alias = STRONG_ALIASES[n];
        let exId = byName[n] || (alias && (libByName[norm(alias)] || byName[norm(alias)])) || newIds[n];
        if (!exId) { exId = 'c-' + slug(exName); newIds[n] = exId; if (!S.data.exercises[exId] && !LIB[exId]) newExercises.push({ id: exId, name: exName, part: 'Other', cat: guessCat(exName), custom: true }); }
        const ex = getEx(exId), f = fieldsFor(ex);
        const wv = num(r[ci.w]), rv = num(r[ci.r]);
        const sec = num(ci.s >= 0 ? r[ci.s] : ''), km = num(ci.d >= 0 ? r[ci.d] : '');
        if (wv == null && rv == null && sec == null && km == null) return; // empty set left in Strong
        const rowUnit = (ci.wu >= 0 && r[ci.wu]) || fileUnit;
        let e = w.exercises[w.exercises.length - 1];
        if (!e || e.exId !== exId) { e = { exId, unit: getEx(exId).unit || PROG_UNIT[exId] || rowUnit, notes: ci.notes >= 0 ? String(r[ci.notes] || '').trim() : '', sets: [] }; w.exercises.push(e); }
        const s = { t: order === 'W' ? 'w' : order === 'D' ? 'd' : order === 'F' ? 'f' : 'n', w: wv == null ? '' : convW(wv, rowUnit, e.unit), r: rv == null ? '' : Math.round(rv), done: true };
        if (f[0] === 'km') { s.km = km ?? ''; s.min = sec ? Math.round(sec / 6) / 10 : ''; }
        if (f[0] === 'sec') s.sec = sec ?? '';
        if (ci.rpe >= 0 && num(r[ci.rpe])) s.rpe = num(r[ci.rpe]);
        e.sets.push(s);
      });
      if (!w.exercises.length) continue;
      const day = isoDate(start);
      const action = byId[w.id] ? (byId[w.id].imported ? 'update' : 'skip') : loggedDays.has(day) ? 'skip' : 'add';
      out.push({ doc: w, action });
    }
    return { workouts: out, newExercises };
  }
  function convW(v, from, to) { if (!from || !to || from === to) return v; const kg = from === 'lb' ? v * LB : v; const o = to === 'lb' ? kg / LB : kg; return Math.round(o * 4) / 4; }
  // Host entry: import a Strong export into the logger's history (Settings > Data and backup uses it too). Re-importing the same file updates, never doubles.
  async function importStrong(text, opts) {
    if (S.readyP) await S.readyP;
    const p = parseStrong(text, opts);
    if (p.error) return { error: p.error, added: 0, updated: 0, skipped: 0, newEx: 0 };
    p.newExercises.forEach(e => put('exercises', e));
    let added = 0, updated = 0, skipped = 0; const docs = [];
    for (const { doc, action } of p.workouts) {
      if (action === 'skip') { skipped++; continue; }
      if (action === 'update') updated++; else added++;
      docs.push(doc);
    }
    if (S.storage && S.storage.putMany && docs.length > 1) {
      // One batched write per 200 workouts (the host's db batch) instead of a request per workout.
      docs.forEach(d => { S.data.workouts[d.id] = d; });
      await queue('workouts/*import', () => S.storage.putMany(COLL.workouts, docs.map(clone)));
    } else docs.forEach(d => put('workouts', d));
    bump(); if (root && !E && !sheets.length) renderMain();
    return { added, updated, skipped, newEx: p.newExercises.length, workouts: p.workouts.length };
  }
  on('importJson', async t => {
    const file = t.files && t.files[0]; if (!file) return; t.value = '';
    try {
      const j = JSON.parse(await file.text()); if (j.app !== 'liftbook' || !j.data) throw new Error('not a Liftbook backup');
      for (const kind of Object.keys(COLL)) for (const doc of Object.values(j.data[kind] || {})) await put(kind, doc);
      if (j.settings) { S.settings = Object.assign(S.settings, j.settings); saveSettings(); }
      renderMain(); toast('Backup restored');
    } catch (e) { toast('Could not restore: ' + e.message); }
  });

  // ---------- Live workout / template editor ----------
  // E.mode: 'live' (logging now), 'edit' (fixing a past workout), 'template' (editing a template)
  let E = null, rest = null, tickT = null;
  function newWorkoutFrom(tpl, from) {
    const w = { id: uid(), name: tpl ? tpl.name : (from ? from.name : workoutNameNow()), templateId: tpl ? tpl.id : from && from.templateId, templateName: tpl ? tpl.name : from && from.templateName, start: Date.now(), notes: '', exercises: [], updated: Date.now() };
    const src = tpl || from;
    if (src) w.exercises = src.exercises.map(e => ({ exId: e.exId, unit: e.unit || defUnit(e.exId), notes: '', tplNote: e.notes || '', rest: e.rest, ss: e.ss, base: tpl ? e.sets.map(s => clone(s)) : null, sets: e.sets.map(s => Object.assign({ t: s.t, w: '', r: '', km: '', min: '', sec: '', done: false }, s.rest ? { rest: s.rest } : {})) }));
    // Host hook: opts.adaptStart({name, exercises:[{exId, name, sets}]}) may return {exercises:[{from, exId?, name, sets?, note?}], suffix?}
    // (the app uses it for its Travel workout and Short-on-time choices). Unknown names become custom exercises.
    if (tpl && S.opts && S.opts.adaptStart) {
      try {
        const a = S.opts.adaptStart({ name: tpl.name, exercises: w.exercises.map(e => ({ exId: e.exId, name: getEx(e.exId).name, sets: e.sets.filter(s => s.t !== 'w').length })) });
        if (a && Array.isArray(a.exercises)) { w.exercises = adaptExercises(w, a.exercises); if (a.suffix) w.name += ' · ' + a.suffix; }
      } catch (err) { console.error('[logger] adaptStart', err); }
    }
    return w;
  }
  const blankSet = () => ({ t: 'n', w: '', r: '', km: '', min: '', sec: '', done: false });
  function adaptExercises(w, list) {
    return list.map(x => {
      const base = w.exercises.find(e => e.exId === x.from) || null;
      let exId = x.exId && S.data.exercises[x.exId] ? x.exId : null;
      if (!exId) {
        const n = String(x.name || '').trim().toLowerCase();
        const hit = Object.values(S.data.exercises).find(e => String(e.name).trim().toLowerCase() === n);
        if (hit) exId = hit.id; else { exId = 'c-' + slug(x.name || 'exercise'); put('exercises', { id: exId, name: x.name || 'Exercise', part: 'Other', cat: guessCat(x.name || ''), custom: true }); }
      }
      const same = !!base && exId === base.exId;
      let sets = base ? base.sets.map(s => Object.assign({}, s)) : [];
      if (!same) sets = sets.filter(s => s.t !== 'w');
      if (!sets.length) sets = Array.from({ length: x.sets || 3 }, blankSet);
      if (x.sets) { let keep = x.sets; sets = sets.filter(s => s.t === 'w' || keep-- > 0); }
      return { exId, unit: same ? base.unit : defUnit(exId), notes: '', tplNote: x.note || (same ? base.tplNote : ''), rest: base ? base.rest : undefined, ss: same ? base.ss : undefined, base: same ? base.base : null, sets };
    });
  }
  function workoutNameNow() { const h = new Date().getHours(); return h < 12 ? 'Morning workout' : h < 17 ? 'Afternoon workout' : 'Evening workout'; }
  function startLive(w) {
    if (S.active) { askReplaceActive(w); return; }
    closeAllSheets();
    S.active = w; saveActive(true);
    openEditor('live', w); keepAwake(true);
  }
  function askReplaceActive(w) {
    openSheet({ title: 'Workout in progress', body: () => '<p>You already have <b>' + esc(S.active.name) + '</b> running. Resume it, or discard it and start ' + esc(w.name) + '?</p><div class="lb-row"><button class="lb-btn primary" data-a="resume">Resume ' + esc(S.active.name) + '</button><button class="lb-btn danger" data-a="discardAndStart">Discard and start new</button></div>', pending: w });
  }
  on('discardAndStart', () => { const w = topSheet().o.pending; S.active = null; saveActive(true); stopRest(); startLive(w); });
  on('startEmpty', () => startLive(newWorkoutFrom(null)));
  on('startTpl', t => startLive(newWorkoutFrom(S.data.templates[t.dataset.id])));
  on('startTplName', t => { const tpl = templateByName(t.dataset.n); if (tpl) startLive(newWorkoutFrom(tpl)); });
  on('again', t => { const w = S.data.workouts[t.dataset.id]; const n = newWorkoutFrom(null, w); n.exercises.forEach((e, i) => { e.base = w.exercises[i].sets.map(s => clone(s)); }); startLive(n); });
  on('resume', () => { closeAllSheets(); if (S.active) { openEditor('live', S.active); keepAwake(true); } });
  on('editWorkout', t => { closeAllSheets(); openEditor('edit', clone(S.data.workouts[t.dataset.id])); });
  on('editTpl', t => { closeAllSheets(); openEditor('template', clone(S.data.templates[t.dataset.id])); });
  const blankTemplate = () => openEditor('template', { id: uid(), name: 'New template', folder: 'My templates', order: 99, notes: '', exercises: [] });
  on('newTpl', () => { if (S.opts.programs && S.opts.programs.size) openProgramPicker(); else blankTemplate(); });
  on('blankTpl', () => { closeAllSheets(); blankTemplate(); });
  // Ready-made programs (opts.programs, e.g. NippardPrograms): pick one, preview its days, add them as templates in a folder of their own.
  function openProgramPicker() {
    const list = S.opts.programs.list();
    const groups = {}; list.forEach(p => { (groups[p.source] = groups[p.source] || []).push(p); });
    openSheet({
      title: 'New template',
      body: () => '<div class="lb-row"><button class="lb-btn primary wide" data-a="blankTpl">Blank template</button></div>' +
        '<h4 class="lb-folder">Ready-made programs <span class="lb-muted">' + list.length + '</span></h4><p class="lb-muted small">No split yet? Pick a programme and its days are added to your templates, with Jeff Nippard\'s sets, reps, RPE, rest and notes. Edit anything after.</p>' +
        Object.keys(groups).map(src => '<p class="lb-eyebrow">' + esc(src) + '</p><div class="lb-grid">' + groups[src].map(p => '<button class="lb-card lb-tpl" data-a="progPreview" data-id="' + esc(p.id) + '"><div class="lb-tpl-top"><b>' + esc(p.name.replace(/^.*· /, '')) + '</b><span class="lb-muted small">' + p.days + 'x/week</span></div><p>' + esc(p.level) + ' · ' + p.workouts + ' days · ' + esc(p.time) + (S.data.templates['np-' + p.id + '-1'] ? ' · added' : '') + '</p></button>').join('') + '</div>').join('')
    });
  }
  on('progPreview', t => {
    const p = S.opts.programs.get(t.dataset.id); if (!p) return;
    const added = !!S.data.templates['np-' + p.id + '-1'];
    openSheet({
      title: p.name,
      body: () => '<p class="lb-note">' + esc(p.blurb) + '</p><p class="lb-muted small">' + esc(p.level) + ' · ' + p.days + ' days a week · about ' + esc(p.time) + ' per session · from ' + esc(p.source) + '</p>' +
        p.workouts.map(w => '<h4 class="lb-folder">' + esc(w.name) + '</h4><ol class="lb-plist">' + w.exercises.map(e => { const ex = getEx(e.ex); const ws = e.sets.filter(x => x.t !== 'w'); const wu = e.sets.length - ws.length; return '<li><b>' + esc(ex.name) + '</b><span>' + ws.length + ' × ' + esc(ws[0] && ws[0].r !== '' && ws[0].r != null ? ws[0].r + ' reps' : (ws[0] && ws[0].sec ? ws[0].sec + ' s' : '')) + (wu ? ' · ' + wu + ' warm-up' : '') + '</span>' + (e.notes ? '<em>' + esc(e.notes) + '</em>' : '') + '</li>'; }).join('') + '</ol>').join('') +
        '<div class="lb-row"><button class="lb-btn primary wide" data-a="progAdd" data-id="' + esc(p.id) + '">' + (added ? 'Add again (replaces its templates)' : 'Add to my templates') + '</button></div>'
    });
  });
  on('progAdd', t => {
    const id = t.dataset.id, tpls = S.opts.programs.templates(id, { unit: S.settings.unit, order: 50 });
    tpls.forEach(tp => put('templates', tp));
    closeAllSheets(); toast('Added ' + tpls.length + ' templates'); renderMain();
  });

  let liveEl;
  function openEditor(mode, doc) {
    E = { mode, doc, view: mode === 'live' && S.settings.gym ? 'gym' : 'list', cur: null, flash: null };
    if (!liveEl) { liveEl = document.createElement('section'); liveEl.className = 'lb-live'; liveEl.setAttribute('role', 'dialog'); liveEl.setAttribute('aria-label', 'Workout'); overlay.appendChild(liveEl); bindSwipe(liveEl); }
    liveEl.innerHTML = '<header class="lb-live-head"></header><div class="lb-live-body"></div><div class="lb-rest" hidden></div>';
    liveEl.hidden = false; document.documentElement.classList.add('lb-noscroll');
    liveEl.classList.remove('lb-live-in'); void liveEl.offsetWidth; liveEl.classList.add('lb-live-in'); clearTimeout(liveEl._inT); liveEl._inT = setTimeout(() => liveEl.classList.remove('lb-live-in'), 320);
    renderEditor(); renderRest(); startTick();
    liveEl.querySelector('.lb-live-body').scrollTop = 0;
    renderMain();
  }
  function closeEditor() {
    E = null; if (liveEl) liveEl.hidden = true; document.documentElement.classList.remove('lb-noscroll');
    renderMain();
  }
  on('minimize', () => { closeEditor(); });
  function headHtml() {
    if (E.mode === 'live') return '<button class="lb-link" data-a="minimize" aria-label="Minimize workout">Hide</button><span class="lb-headmid"><span class="lb-mono lb-elapsed" data-clock="' + E.doc.start + '">' + clock(Date.now() - E.doc.start) + '</span><button class="lb-link small" data-a="gymToggle">' + (E.view === 'gym' ? 'List view' : 'Gym mode') + '</button></span><span class="lb-headend">' + (global.VoiceLog ? '<button class="lb-mic" data-a="voice" aria-label="Log by voice" title="Log by voice">' + MIC_ICON + '</button>' : '') + '<button class="lb-btn primary small" data-a="finish">Finish</button></span>';
    return '<button class="lb-link" data-a="cancelEdit">Cancel</button><b>' + (E.mode === 'template' ? 'Edit template' : 'Edit workout') + '</b><button class="lb-btn primary small" data-a="saveEdit">Save</button>';
  }
  // ---------- Voice logging (VoiceLog module, optional) ----------
  const MIC_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 15a4 4 0 0 0 4-4V6a4 4 0 1 0-8 0v5a4 4 0 0 0 4 4zm6-4a1 1 0 1 1 2 0 8 8 0 0 1-7 7.94V21h2a1 1 0 1 1 0 2H9a1 1 0 1 1 0-2h2v-2.06A8 8 0 0 1 4 11a1 1 0 1 1 2 0 6 6 0 0 0 12 0z"/></svg>';
  on('voice', () => {
    if (!global.VoiceLog || !E) return;
    const cur = E.view === 'gym' && fixCur() ? E.doc.exercises[E.cur[0]] : null;
    global.VoiceLog.open({ exercises: allExercises(), unit: S.settings.unit, current: cur ? cur.exId : undefined, prefer: E.doc.exercises.map(e => e.exId), onApply: applyVoice });
  });
  // entries: [{exId, unit, sets:[{t,w,r,km,min,sec,done}]}] from VoiceLog. Fills the exercise's pending sets first, then appends.
  function applyVoice(entries) {
    if (!E) return 0;
    let n = 0; const names = [];
    (entries || []).forEach(en => {
      let ei = E.doc.exercises.findIndex(x => x.exId === en.exId), e = E.doc.exercises[ei];
      if (!e) { e = { exId: en.exId, unit: en.unit || defUnit(en.exId), notes: '', sets: [] }; E.doc.exercises.push(e); ei = E.doc.exercises.length - 1; }
      const ex = getEx(en.exId); names.push(ex.name);
      en.sets.forEach(src => {
        const vals = Object.assign({}, src);
        if (vals.w && en.unit && en.unit !== e.unit) vals.w = fmtN(en.unit === 'lb' ? +vals.w * LB : +vals.w / LB, 1).replace(/,/g, '');
        let j = e.sets.findIndex(x => !x.done && x.t !== 'w');
        if (j < 0) { e.sets.push({ t: 'n', w: '', r: '', km: '', min: '', sec: '', done: false }); j = e.sets.length - 1; }
        const s = e.sets[j];
        ['w', 'r', 'km', 'min', 'sec'].forEach(k => { if (vals[k] !== '' && vals[k] != null) s[k] = String(vals[k]); });
        s.done = true; s.pr = setPRs(e.exId, e.unit, s, E.doc.id); n++;
      });
    });
    if (!n) return 0;
    touch(); renderEditor(); renderRest();
    toast('Logged ' + n + ' set' + (n > 1 ? 's' : '') + ': ' + [...new Set(names)].join(', '));
    return n;
  }
  // Check every unchecked set whose fields have numbers or can be filled from last time (same rule as completeSet). Returns how many were ticked.
  // onDone(e, s) runs for each newly ticked set. Pass a clone of the exercises to just count.
  function fillRemaining(exs, fields, ex, ph, prev, match, onDone) {
    let n = 0;
    exs.forEach(e => {
      const f = fields(ex(e.exId)), pv = prev(e);
      e.sets.forEach((s, j) => {
        if (s.done) return;
        const p = match(pv, e, j);
        f.forEach(k => { const v = ph(pv, p, e, k); if ((s[k] === '' || s[k] == null) && v !== '') s[k] = String(v).replace(/,/g, ''); });
        if (f.every(k => s[k] === '' || s[k] == null)) return;
        s.done = true; n++; if (onDone) onDone(e, s);
      });
    });
    return n;
  }
  function prevFor(e) {
    if (E.mode === 'template') { const s = sessions(e.exId)[0]; return { sets: s ? s.e.sets : [], src: 'last', unit: s ? s.e.unit : e.unit }; }
    const s = sessions(e.exId, E.doc.id)[0];
    if (s) return { sets: s.e.sets, src: 'last', unit: s.e.unit, e: s.e };
    if (e.base) return { sets: e.base, src: 'base', unit: e.unit };
    return { sets: [], src: '' };
  }
  function prevMatch(prev, e, i) {
    // match by set type order: i-th warm-up to i-th warm-up, i-th working to i-th working
    const s = e.sets[i], kind = s.t === 'w' ? 'w' : 'x';
    const k = e.sets.slice(0, i).filter(x => (x.t === 'w' ? 'w' : 'x') === kind).length;
    const hit = prev.sets.filter(x => (x.t === 'w' ? 'w' : 'x') === kind)[k];
    if (hit) return prev.src === 'base' ? Object.assign({ _base: true }, hit) : hit;
    const b = e.base && e.base.filter(x => (x.t === 'w' ? 'w' : 'x') === kind)[k];
    return b ? Object.assign({ _base: true }, b) : null;
  }
  // Placeholder for field k: last time's value (converted when it was logged in the other unit) or the template baseline.
  const phFor = (prev, p, e, k) => p && p[k] !== '' && p[k] != null ? (!p._base && prev.unit && k === 'w' && prev.unit !== e.unit ? fmtN(prev.unit === 'lb' ? p.w * LB : p.w / LB, 1) : p[k]) : '';
  const extraCols = ex => isWeighted(ex) ? ['rpe', 'rir'].filter(k => S.settings[k]) : [];
  function renderEditor() {
    if (!E) return;
    const d = E.doc, live = E.mode !== 'template';
    liveEl.querySelector('.lb-live-head').innerHTML = headHtml();
    if (global.MusicControl && global.MusicControl.mountWorkout) try { global.MusicControl.mountWorkout(liveEl); } catch (e) { }
    liveEl.classList.toggle('gym', E.view === 'gym');
    if (E.view === 'gym') { const body = liveEl.querySelector('.lb-live-body'); body.innerHTML = gymHtml(); return; }
    const ssColors = {};
    let html = '<div class="lb-live-meta"><input class="lb-title-in" value="' + esc(d.name) + '" data-in="wName" aria-label="Name">' +
      (E.mode === 'template' ? '<label class="lb-field inline">Folder<input class="lb-input" value="' + esc(d.folder || '') + '" data-in="tFolder"></label>' : '<p class="lb-muted small">' + fmtDate(d.start, { weekday: 'long', month: 'short', day: 'numeric' }) + ' · started ' + fmtTime(d.start) + '</p>') +
      '<textarea class="lb-input lb-notes" rows="1" placeholder="' + (E.mode === 'template' ? 'Template notes' : 'Workout notes') + '" data-in="wNotes">' + esc(d.notes || '') + '</textarea></div>';
    d.exercises.forEach((e, i) => {
      const ex = getEx(e.exId), f = fieldsFor(ex), prev = prevFor(e);
      if (e.ss && !ssColors[e.ss]) ssColors[e.ss] = Object.keys(ssColors).length;
      const ssIdx = e.ss ? ssColors[e.ss] : -1;
      const hint = E.mode === 'live' ? progressionHint(e.exId, e.unit, prev.e) : '';
      const xc = extraCols(ex);
      const cols = '2.1rem 1fr ' + f.map(() => '4.2rem').join(' ') + xc.map(() => ' 3rem').join('') + (live ? ' 2.6rem' : ' 2rem');
      const dm = live ? demoSlot(e.exId) : '', dmHead = !!dm && !demoOpen.has(e.exId);
      html += '<article class="lb-exblock' + (e.ss ? ' ss ss' + (ssIdx % 4) : '') + '" data-ei="' + i + '">' +
        (e.ss ? '<div class="lb-sslabel">Superset ' + String.fromCharCode(65 + ssIdx) + '</div>' : '') +
        '<div class="lb-exhead"><button class="lb-link strong" data-a="exOpen" data-id="' + e.exId + '">' + esc(ex.name) + '</button>' + (dmHead ? dm : '') + '<button class="lb-icon" data-a="exMenu" data-ei="' + i + '" aria-label="Exercise options">•••</button></div>' +
        (dm && !dmHead ? dm : '') +
        (live && S.opts.formCues ? S.opts.formCues.inlineHtml(formFor(e.exId), e.exId) : '') + (live && S.opts.tips ? S.opts.tips.inlineHtml(e.exId) : '') +
        (ex.avoided ? '<p class="lb-warnbox small">Your plan avoids this lift.</p>' : '') +
        (e.tplNote ? '<p class="lb-muted small">' + esc(e.tplNote) + '</p>' : '') +
        memoHtml(ex, live) +
        (hint ? '<p class="lb-hint small">' + esc(hint) + '</p>' : '') +
        (e.showNote || e.notes ? '<textarea class="lb-input lb-notes" rows="1" placeholder="Note for this exercise" data-in="eNote" data-ei="' + i + '">' + esc(e.notes || '') + '</textarea>' : '') +
        '<div class="lb-sets" style="--cols:' + cols + '"><div class="lb-setrow head"><span>Set</span><span>Previous</span>' + f.map(k => '<span>' + ({ w: e.unit.toUpperCase(), r: 'Reps', km: 'Km', min: 'Min', sec: 'Sec' }[k]) + '</span>').join('') + xc.map(k => '<span>' + k.toUpperCase() + '</span>').join('') + '<span>' + (live ? '✓' : '') + '</span></div>';
      let n = 0;
      // Every set stays on screen once ticked (Strong-style); nothing folds away mid-workout.
      e.sets.forEach((s, j) => {
        const p = prevMatch(prev, e, j), label = s.t === 'n' ? ++n : s.t.toUpperCase();
        const pTxt = p ? fmtSet(p, { unit: p._base ? e.unit : (prev.unit || e.unit), exId: e.exId }, ex) : '';
        html += '<div class="lb-setwrap"><div class="lb-swipe-del"><button class="lb-swipe-btn" data-a="delSet" data-ei="' + i + '" data-si="' + j + '" tabindex="-1">Delete</button></div><div class="lb-setrow' + (s.done ? ' done' : '') + '" data-ei="' + i + '" data-si="' + j + '"><button class="lb-settag ' + s.t + '" data-a="setType" data-ei="' + i + '" data-si="' + j + '" aria-label="Set type">' + label + '</button>' +
          '<button class="lb-prev' + (p && p._base ? ' base' : '') + '" data-a="usePrev" data-ei="' + i + '" data-si="' + j + '" title="' + (p && p._base ? 'Template baseline' : 'Last time') + '">' + (pTxt ? esc(pTxt) : '–') + '</button>' +
          f.map(k => { const ph = phFor(prev, p, e, k); return '<input class="lb-cell" inputmode="' + (k === 'r' || k === 'sec' ? 'numeric' : 'decimal') + '" data-in="cell" data-k="' + k + '" data-ei="' + i + '" data-si="' + j + '" value="' + esc(s[k] ?? '') + '" placeholder="' + esc(ph) + '" aria-label="' + k + '">'; }).join('') +
          xc.map(k => '<input class="lb-cell" inputmode="' + (k === 'rir' ? 'numeric' : 'decimal') + '" data-in="cell" data-k="' + k + '" data-ei="' + i + '" data-si="' + j + '" value="' + esc(s[k] ?? '') + '" aria-label="' + k.toUpperCase() + '">').join('') +
          (live ? '<button class="lb-chk" data-a="check" data-ei="' + i + '" data-si="' + j + '" aria-label="Complete set" aria-pressed="' + !!s.done + '">✓</button>' : '<button class="lb-icon small" data-a="delSet" data-ei="' + i + '" data-si="' + j + '" aria-label="Delete set">×</button>') +
          (s.pr && s.pr.length ? '<span class="lb-prrow">PR · ' + esc(s.pr.join(', ')) + '</span>' : '') + '</div></div>' +
          (ex.cat !== 'Cardio' ? restLineHtml(e, s, i, j) : '');
      });
      html += '</div><div class="lb-exfoot"><button class="lb-btn small ghost" data-a="addSet" data-ei="' + i + '">Add set</button><button class="lb-link small" data-a="restEdit" data-ei="' + i + '">Rest ' + restLabel(restOf(e)) + '</button></div></article>';
    });
    html += '<div class="lb-row col"><button class="lb-btn wide" data-a="addEx">Add exercises</button>' + (E.mode === 'live' ? '<button class="lb-btn wide ghost danger" data-a="askCancel">Cancel workout</button><div class="lb-confirm" id="lb-cancelw" hidden><p>Discard this workout? Nothing from it will be saved.</p><button class="lb-btn danger" data-a="cancelLive">Discard workout</button></div>' : '') + (E.mode === 'template' && S.data.templates[d.id] ? '' : '') + '</div>';
    const body = liveEl.querySelector('.lb-live-body'), top = body.scrollTop;
    body.innerHTML = html; body.scrollTop = top;
  }
  // ---------- Gym mode: one set at a time, big controls ----------
  function fixCur() {
    const exs = E.doc.exercises, c = E.cur;
    if (!c || !exs[c[0]] || !exs[c[0]].sets[c[1]]) E.cur = resumePoint(exs) || (exs.length && exs[0].sets.length ? [0, 0] : null);
    return E.cur;
  }
  // Label for set j: warm-ups count separately ("Warm-up 1"), working/drop/failure sets as "Set 2 of 3".
  function setLabel(e, j) {
    const s = e.sets[j], kind = s.t === 'w' ? 'w' : 'x';
    const k = e.sets.slice(0, j + 1).filter(x => (x.t === 'w' ? 'w' : 'x') === kind).length;
    if (kind === 'w') return 'Warm-up ' + k;
    return 'Set ' + k + ' of ' + e.sets.filter(x => x.t !== 'w').length + (s.t === 'd' ? ' · drop set' : s.t === 'f' ? ' · to failure' : '');
  }
  function gymCtx() {
    const [ei, si] = E.cur, e = E.doc.exercises[ei], ex = getEx(e.exId), prev = prevFor(e), p = prevMatch(prev, e, si), s = e.sets[si];
    const vals = {}; fieldsFor(ex).forEach(k => { vals[k] = s[k] !== '' && s[k] != null ? s[k] : phFor(prev, p, e, k); });
    return { ei, si, e, ex, prev, p, s, vals, pUnit: p && !p._base ? (prev.unit || e.unit) : e.unit };
  }
  const signed = (v, d) => (v > 0 ? '+' : v < 0 ? '−' : '±') + fmtN(Math.abs(v), d);
  function gymCmpHtml(c) {
    const { e, ex, p, s, vals, pUnit } = c;
    let out = '';
    if (p) {
      const pTxt = fmtSet(p, { unit: pUnit, exId: e.exId }, ex) + (num(p.rir) != null ? ' · RIR ' + p.rir : p.rpe ? ' · @' + p.rpe : '');
      out += '<div class="lb-gym-last"><span>' + (p._base ? 'Plan target' : 'Last time') + '</span><b>' + esc(pTxt) + '</b></div>';
    } else out += '<div class="lb-gym-last"><span>Last time</span><b class="lb-muted">First time logging this set</b></div>';
    // Back after 7+ days off this lift: the host's BreakRamp suggests 90% / 95% of the pre-break weights.
    if (S.opts.breakRamp && isWeighted(ex) && s.t !== 'w') {
      try { out += S.opts.breakRamp.noteHtml(S.opts.breakRamp.plan(S.opts.breakRamp.fromLogger(workouts(), e.exId, { excludeId: E.doc.id }), { today: Date.now(), step: weightStep(ex, e.unit) }), e.unit); } catch (err) {}
    }
    if (p && isWeighted(ex)) {
      const d = compareSets(vals, p, e.unit, pUnit), chips = [];
      if (d && d.dw != null) chips.push('<span class="lb-delta ' + (d.dw > 0 ? 'up' : d.dw < 0 ? 'down' : '') + '">' + signed(d.dw, 2) + ' ' + e.unit + '</span>');
      if (d && d.dr != null) chips.push('<span class="lb-delta ' + (d.dr > 0 ? 'up' : d.dr < 0 ? 'down' : '') + '">' + signed(d.dr, 0) + ' rep' + (Math.abs(d.dr) === 1 ? '' : 's') + '</span>');
      if (d && d.de != null) chips.push('<span class="lb-delta ' + (d.de > 0 ? 'up' : d.de < 0 ? 'down' : '') + '">Est. 1RM ' + signed(d.de, 1) + ' kg</span>');
      const same = d && [d.dw, d.dr, d.de].every(v => v == null || v === 0);
      if (chips.length) out += '<div class="lb-gym-deltas">' + (same ? '<span class="lb-delta">Same as ' + (p._base ? 'plan' : 'last time') + '</span>' : chips.join('')) + '</div>';
    }
    if (!s.done && s.t !== 'w') {
      const pr = setPRs(e.exId, e.unit, Object.assign({}, s, vals), E.doc.id);
      if (pr.length) out += '<p class="lb-gym-prpace">Record if you hit this: ' + esc(pr.join(', ')) + '</p>';
    }
    return out;
  }
  function gymHtml() {
    const d = E.doc;
    if (!fixCur()) return '<div class="lb-gym"><div class="lb-gym-card center"><p>No sets in this workout yet.</p><button class="lb-btn primary wide" data-a="addEx">Add exercises</button></div></div>';
    const c = gymCtx(), { ei, si, e, ex, prev, s, vals } = c, f = fieldsFor(ex);
    const ssIds = []; d.exercises.forEach(x => { if (x.ss && !ssIds.includes(x.ss)) ssIds.push(x.ss); });
    const partners = e.ss ? d.exercises.map((x, k) => ({ x, k })).filter(o => o.x.ss === e.ss) : [];
    const fc = S.opts.formCues, entry = fc ? formFor(e.exId) : null;
    const hint = s.t !== 'w' ? progressionHint(e.exId, e.unit, prev.e) : '';
    const fLabel = k => ({ w: e.unit, r: 'Reps', km: 'Km', min: 'Minutes', sec: 'Seconds' }[k]);
    const stepTxt = k => fmtN(stepFor(ex, e.unit, k), 2);
    let n = 0;
    let html = '<div class="lb-gym">' +
      (E.flash ? (typeof E.flash === 'object' && PRC ? PRC.bannerHtml(E.flash, esc) : '<div class="lb-gym-pr" role="status">New record · ' + esc(E.flash) + '</div>') : '') +
      '<div class="lb-gym-top"><span>Exercise ' + (ei + 1) + ' of ' + d.exercises.length + '</span>' +
      (e.ss ? '<span class="lb-gym-ss ss' + (ssIds.indexOf(e.ss) % 4) + '">Superset ' + String.fromCharCode(65 + ssIds.indexOf(e.ss)) + ' · ' + (partners.findIndex(o => o.k === ei) + 1) + '/' + partners.length + '</span>' : '') + '</div>' +
      '<div class="lb-gym-headrow"><button class="lb-gym-name" data-a="exOpen" data-id="' + e.exId + '">' + esc(ex.name) + '</button><button class="lb-icon" data-a="exMenu" data-ei="' + ei + '" aria-label="Exercise options">•••</button></div>' +
      demoSlot(e.exId) +
      (e.ss ? '<p class="lb-muted small">Alternate with ' + esc(partners.filter(o => o.k !== ei).map(o => getEx(o.x.exId).name).join(', ')) + ', rest after the round.</p>' : '') +
      '<div class="lb-gym-tools">' + demoBtn(e.exId, entry) +
      '<button class="lb-btn small ghost" data-a="exOpen" data-id="' + e.exId + '">How to</button><button class="lb-btn small ghost" data-a="restEdit" data-ei="' + ei + '">Rest ' + restLabel(restOf(e)) + '</button>' +
      (isWeighted(ex) ? '<button class="lb-btn small ghost" data-a="exPlates" data-ei="' + ei + '">Plates</button>' : '') + '</div>' +
      (fc && entry ? fc.inlineHtml(entry, e.exId) : '') +
      (ex.avoided ? '<p class="lb-warnbox small">Your plan avoids this lift.</p>' : '') +
      memoHtml(ex, true) +
      '<div class="lb-gym-dots" role="group" aria-label="Sets">' + e.sets.map((x, j) => '<button class="lb-gym-dot ' + x.t + (x.done ? ' done' : '') + (j === si ? ' cur' : '') + '" data-a="gGo" data-ei="' + ei + '" data-si="' + j + '" aria-label="' + esc(setLabel(e, j)) + (x.done ? ', done' : '') + '">' + (x.t === 'n' ? ++n : x.t.toUpperCase()) + '</button>').join('') + '<button class="lb-gym-dot add" data-a="gAdd" aria-label="Add a set">+</button></div>' +
      '<section class="lb-gym-card' + (s.done ? ' done' : '') + '">' +
      '<div class="lb-gym-setlabel">' + esc(setLabel(e, si)) + (s.done ? ' <span class="lb-gym-ok">✓ done</span>' : '') + '</div>' +
      '<div id="lb-gym-cmp">' + gymCmpHtml(c) + '</div>' +
      (hint && !s.done ? '<p class="lb-hint small">' + esc(hint) + '</p>' : '') +
      f.map(k => { const st = stepFor(ex, e.unit, k), ph = phFor(prev, c.p, e, k); return '<div class="lb-gym-field"><span class="lb-gym-flabel">' + esc(fLabel(k)) + '</span>' +
        '<button class="lb-gym-step" data-a="gStep" data-k="' + k + '" data-d="-1" aria-label="Minus ' + stepTxt(k) + '">−' + (k === 'r' ? '' : '<small>' + stepTxt(k) + '</small>') + '</button>' +
        '<input class="lb-gym-num" inputmode="' + (k === 'r' || k === 'sec' ? 'numeric' : 'decimal') + '" data-in="cell" data-k="' + k + '" data-ei="' + ei + '" data-si="' + si + '" value="' + esc(s[k] ?? '') + '" placeholder="' + esc(ph) + '" aria-label="' + esc(fLabel(k)) + '">' +
        '<button class="lb-gym-step" data-a="gStep" data-k="' + k + '" data-d="1" aria-label="Plus ' + stepTxt(k) + '">+' + (k === 'r' ? '' : '<small>' + stepTxt(k) + '</small>') + '</button></div>'; }).join('') +
      (isWeighted(ex) && s.t !== 'w' ? '<div class="lb-gym-flabel rir">Reps in reserve</div><div class="lb-gym-rir" role="group" aria-label="Reps in reserve">' + [0, 1, 2, 3, 4].map(v => '<button class="' + (num(s.rir) === v ? 'on' : '') + '" data-a="gRir" data-v="' + v + '" aria-pressed="' + (num(s.rir) === v) + '">' + (v === 4 ? '4+' : v) + '</button>').join('') + '</div>' : '') +
      '</section>';
    const nx = nextPending(d.exercises, [ei, si]);
    if (!s.done) html += '<button class="lb-gym-done" data-a="gDone">✓ Done</button>';
    else html += '<div class="lb-gym-pair"><button class="lb-btn ghost" data-a="gUndo">Undo</button>' + (nx ? '<button class="lb-gym-done" data-a="gNext">Next set ›</button>' : '<button class="lb-gym-done ok" data-a="finish">All sets done · Finish</button>') + '</div>';
    html += '<div class="lb-gym-nav"><button class="lb-btn ghost" data-a="gNav" data-d="-1"' + (ei ? '' : ' disabled') + '>‹ Prev</button><button class="lb-btn ghost" data-a="addEx">+ Exercise</button><button class="lb-btn ghost" data-a="gNav" data-d="1"' + (ei < d.exercises.length - 1 ? '' : ' disabled') + '>Next ›</button></div>';
    html += '<button class="lb-btn wide ghost danger" data-a="askDiscard">Cancel workout</button>';
    return html + '</div>';
  }
  function gymRefresh() { const el = liveEl && liveEl.querySelector('#lb-gym-cmp'); if (el && E && E.cur) el.innerHTML = gymCmpHtml(gymCtx()); }
  // Shown under the big rest countdown: what's due next and what to aim for.
  function upNextHtml() {
    if (!E || !E.cur) return '';
    const exs = E.doc.exercises, c = E.cur, s = exs[c[0]] && exs[c[0]].sets[c[1]];
    if (!s) return '';
    const nx = s.done ? nextPending(exs, c) : c;
    if (!nx) return '<p class="lb-rest-next">All sets done. Finish when you’re ready.</p>';
    const e = exs[nx[0]], prev = prevFor(e), p = prevMatch(prev, e, nx[1]);
    const tgt = p ? fmtSet(p, { unit: p._base ? e.unit : (prev.unit || e.unit), exId: e.exId }) : '';
    return '<p class="lb-rest-next">Up next: <b>' + esc(getEx(e.exId).name) + '</b> · ' + esc(setLabel(e, nx[1])) + (tgt ? (p._base ? ' · plan ' : ' · last ') + esc(tgt) : '') + '</p>';
  }
  const gymGo = (ei, si) => { E.cur = [ei, si]; E.flash = null; renderEditor(); renderRest(); liveEl.querySelector('.lb-live-body').scrollTop = 0; };
  on('gymToggle', () => {
    E.view = E.view === 'gym' ? 'list' : 'gym'; S.settings.gym = E.view === 'gym'; saveSettings();
    renderEditor(); renderRest();
  });
  on('gGo', t => gymGo(+t.dataset.ei, +t.dataset.si));
  on('gNav', t => {
    const i = E.cur[0] + +t.dataset.d, e = E.doc.exercises[i]; if (!e) return;
    const j = e.sets.findIndex(s => !s.done); gymGo(i, j < 0 ? 0 : j);
  });
  on('gNext', () => { const nx = nextPending(E.doc.exercises, E.cur); if (nx) gymGo(nx[0], nx[1]); });
  on('gStep', t => {
    const c = gymCtx(), k = t.dataset.k, start = c.vals[k] === '' || c.vals[k] == null ? 0 : String(c.vals[k]).replace(/,/g, '');
    c.s[k] = String(k === 'w' ? stepWeight(start, +t.dataset.d, weightStep(c.ex, c.e.unit)) : bumpVal(start, +t.dataset.d * stepFor(c.ex, c.e.unit, k)));
    if (c.s.done) c.s.pr = setPRs(c.e.exId, c.e.unit, c.s, E.doc.id);
    touch();
    const inp = liveEl.querySelector('.lb-gym-num[data-k="' + k + '"]'); if (inp) inp.value = c.s[k];
    gymRefresh();
  });
  on('gRir', t => { const c = gymCtx(), v = +t.dataset.v; c.s.rir = num(c.s.rir) === v ? null : v; touch(); renderEditor(); });
  on('gAdd', () => {
    const e = E.doc.exercises[E.cur[0]], last = e.sets[e.sets.length - 1];
    e.sets.push({ t: last && last.t !== 'w' ? last.t : 'n', w: '', r: '', km: '', min: '', sec: '', done: false });
    touch(); gymGo(E.cur[0], e.sets.length - 1);
  });
  on('gUndo', () => { const c = gymCtx(); c.s.done = false; c.s.pr = []; touch(); renderEditor(); });
  on('gDone', () => {
    const [ei, si] = E.cur, s = E.doc.exercises[ei].sets[si];
    if (!completeSet(ei, si, true)) return; // the gym screen shows its own record banner
    E.flash = s.pr && s.pr.length ? (celebration(E.doc.exercises[ei], s) || getEx(E.doc.exercises[ei].exId).name + ': ' + s.pr.join(', ')) : null;
    const nx = nextPending(E.doc.exercises, [ei, si]); if (nx) E.cur = nx;
    touch(); renderEditor(); renderRest(); liveEl.querySelector('.lb-live-body').scrollTop = 0;
  });
  function touch() { if (E && E.mode === 'live') { E.doc.updated = Date.now(); S.active = E.doc; saveActive(); } }
  const cellOf = t => E.doc.exercises[+t.dataset.ei];
  on('wName', t => { E.doc.name = t.value; touch(); });
  on('wNotes', t => { E.doc.notes = t.value; touch(); });
  on('tFolder', t => { E.doc.folder = t.value; });
  on('eNote', t => { cellOf(t).notes = t.value; touch(); });
  on('cell', t => {
    const e = cellOf(t), s = e.sets[+t.dataset.si], k = t.dataset.k;
    s[k] = t.value.replace(',', '.');
    if (k === 'rir') s.rir = num(s.rir);
    if (s.done && E.mode === 'live') { s.pr = setPRs(e.exId, e.unit, s, E.doc.id); }
    touch();
    if (E.view === 'gym') gymRefresh();
  });
  on('usePrev', t => {
    const e = cellOf(t), j = +t.dataset.si, p = prevMatch(prevFor(e), e, j); if (!p) return;
    const s = e.sets[j]; fieldsFor(getEx(e.exId)).forEach(k => { if (p[k] !== '' && p[k] != null) s[k] = p[k]; });
    touch(); renderEditor();
  });
  // Check off set j of exercise i: blanks take last time's numbers, records are flagged, the rest timer starts.
  // Returns false (and says why) when there's nothing to log.
  function completeSet(i, j, quiet) {
    primeAudio();
    E.doc.focusEx = null; // a ticked set puts the shade's "current exercise" back on the resume point
    const e = E.doc.exercises[i], s = e.sets[j], ex = getEx(e.exId), f = fieldsFor(ex), prev = prevFor(e), p = prevMatch(prev, e, j);
    f.forEach(k => { const ph = phFor(prev, p, e, k); if ((s[k] === '' || s[k] == null) && ph !== '') s[k] = String(ph).replace(/,/g, ''); });
    if (f.every(k => s[k] === '' || s[k] == null)) { toast('Enter ' + (f[0] === 'w' ? 'weight and reps' : 'a value') + ' first'); return false; }
    s.done = true; s.pr = setPRs(e.exId, e.unit, s, E.doc.id);
    setDoneSound();
    const cel = celebration(e, s);
    if (s.pr.length && !quiet) { if (cel) PRC.fire(cel, { toast, vibrate: !!S.settings.vibrate }); else toast('New record: ' + ex.name + ' · ' + s.pr.join(', ')); }
    if (ex.cat !== 'Cardio' && restAfter(E.doc.exercises, i, j)) startRest(setRestOf(e, s), [i, j]);
    if (S.settings.vibrate && navigator.vibrate && !(cel && !quiet)) try { navigator.vibrate(15); } catch (er) { }
    return true;
  }
  on('check', t => {
    const e = cellOf(t), j = +t.dataset.si, s = e.sets[j];
    if (!s.done) { if (!completeSet(+t.dataset.ei, j)) return; } else { s.done = false; s.pr = []; }
    touch(); renderEditor();
  });
  on('addSet', t => {
    const e = cellOf(t), last = e.sets[e.sets.length - 1];
    const s = { t: 'n', w: '', r: '', km: '', min: '', sec: '', done: false };
    if (last && E.mode !== 'live') ['w', 'r', 'km', 'min', 'sec'].forEach(k => { s[k] = last[k] ?? ''; });
    e.sets.push(s); touch(); renderEditor();
  });
  on('delSet', t => { cellOf(t).sets.splice(+t.dataset.si, 1); touch(); renderEditor(); });
  // ---------- Swipe a set row left to delete it (Strong-style) ----------
  // A short swipe reveals a Delete button; a long one (past half the row) deletes on release.
  const SWIPE_REVEAL = 88, SWIPE_START = 8, SWIPE_MIN = 40, SWIPE_FAR = 0.55;
  function swipeDecision(dx, dy, width) {
    if (!(dx < 0) || Math.abs(dx) <= Math.abs(dy)) return 'none';
    if (-dx >= width * SWIPE_FAR) return 'delete';
    return -dx >= SWIPE_MIN ? 'reveal' : 'none';
  }
  function bindSwipe(el) {
    let sw = null, openWrap = null;
    const setX = (wrap, x) => { wrap.querySelector('.lb-setrow').style.transform = x ? 'translateX(' + x + 'px)' : ''; };
    const closeOpen = () => { if (openWrap) { openWrap.classList.remove('open', 'far'); setX(openWrap, 0); openWrap = null; } };
    el.addEventListener('pointerdown', ev => {
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      const wrap = ev.target.closest('.lb-setwrap');
      if (openWrap && wrap !== openWrap) closeOpen();
      if (!wrap || !el.contains(wrap) || ev.target.closest('.lb-swipe-del')) return;
      sw = { wrap, x0: ev.clientX, y0: ev.clientY, id: ev.pointerId, base: wrap === openWrap ? -SWIPE_REVEAL : 0, drag: false, off: 0 };
    });
    el.addEventListener('pointermove', ev => {
      if (!sw || ev.pointerId !== sw.id) return;
      const dx = ev.clientX - sw.x0, dy = ev.clientY - sw.y0;
      if (!sw.drag) {
        if (Math.abs(dy) > SWIPE_START && Math.abs(dy) > Math.abs(dx)) { sw = null; return; }
        if (Math.abs(dx) <= SWIPE_START) return;
        sw.drag = true; sw.wrap.classList.add('swiping');
        try { sw.wrap.setPointerCapture(ev.pointerId); } catch (e) { }
      }
      const w = sw.wrap.offsetWidth || 1;
      sw.off = Math.max(-w, Math.min(0, sw.base + dx));
      sw.wrap.classList.toggle('far', -sw.off >= w * SWIPE_FAR);
      setX(sw.wrap, sw.off);
    });
    const end = ev => {
      if (!sw || ev.pointerId !== sw.id) return;
      const cur = sw; sw = null;
      if (!cur.drag) { if (cur.wrap === openWrap && !ev.target.closest('[data-a]')) closeOpen(); return; }
      cur.wrap.classList.remove('swiping');
      // The drag's trailing click must not tick or open anything.
      const eat = e => { e.stopPropagation(); e.preventDefault(); };
      el.addEventListener('click', eat, { capture: true, once: true }); setTimeout(() => el.removeEventListener('click', eat, { capture: true }), 400);
      const d = ev.type === 'pointercancel' ? 'none' : swipeDecision(cur.off, 0, cur.wrap.offsetWidth || 1);
      const row = cur.wrap.querySelector('.lb-setrow');
      if (d === 'delete' && E && row) {
        const e = E.doc.exercises[+row.dataset.ei];
        if (e && e.sets[+row.dataset.si]) { e.sets.splice(+row.dataset.si, 1); touch(); if (navigator.vibrate) try { navigator.vibrate(12); } catch (x) { } }
        openWrap = null; renderEditor(); return;
      }
      if (d === 'reveal') { closeOpen(); cur.wrap.classList.add('open'); cur.wrap.classList.remove('far'); setX(cur.wrap, -SWIPE_REVEAL); openWrap = cur.wrap; }
      else { cur.wrap.classList.remove('open', 'far'); setX(cur.wrap, 0); if (cur.wrap === openWrap) openWrap = null; }
    };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  }
  on('setType', t => {
    const ei = +t.dataset.ei, si = +t.dataset.si;
    openSheet({
      title: 'Set type', body: () => [['n', 'Working set'], ['w', 'Warm-up'], ['d', 'Drop set'], ['f', 'To failure']].map(([k, l]) => '<button class="lb-option" data-a="pickType" data-k="' + k + '" data-ei="' + ei + '" data-si="' + si + '"><span class="lb-settag ' + k + '">' + (k === 'n' ? '1' : k.toUpperCase()) + '</span>' + l + '</button>').join('') + '<button class="lb-option danger" data-a="pickType" data-k="del" data-ei="' + ei + '" data-si="' + si + '">Delete this set</button>'
    });
  });
  on('pickType', t => {
    const e = E.doc.exercises[+t.dataset.ei], si = +t.dataset.si;
    if (t.dataset.k === 'del') e.sets.splice(si, 1); else { e.sets[si].t = t.dataset.k; if (e.sets[si].done) e.sets[si].pr = setPRs(e.exId, e.unit, e.sets[si], E.doc.id); }
    closeSheet(); touch(); renderEditor();
  });
  // Strong-style rest line between sets: shows that set's rest; counts down while it runs; tap to type any time.
  function restLineHtml(e, s, i, j) {
    const sec = setRestOf(e, s), lbl = restLabel(sec);
    return '<button class="lb-restline' + (sec > 0 ? '' : ' off') + (s.rest ? ' own' : '') + '" data-a="restSet" data-ei="' + i + '" data-si="' + j + '" data-lbl="' + lbl + '" aria-label="Rest after this set: ' + lbl + '. Tap to change"><i></i><span class="lb-mono">' + lbl + '</span><i></i></button>';
  }
  // One sheet for "rest after this set" (si given) and "rest for this exercise" (si null): type any time, or tap a quick pick.
  function restSheet(ei, si) {
    const e = E.doc.exercises[ei], s = si == null ? null : e.sets[si], cur = s ? setRestOf(e, s) : restOf(e), name = esc(getEx(e.exId).name);
    const running = s && rest && rest.at && rest.at[0] === ei && rest.at[1] === si;
    openSheet({
      title: s ? 'Rest after this set' : 'Rest timer for this exercise',
      body: () => '<label class="lb-field">Rest time (m:ss)<input id="lb-restin" class="lb-input lb-restin" inputmode="text" enterkeyhint="done" autocomplete="off" placeholder="e.g. 1:45 or 105" value="' + (cur > 0 ? mmss(cur) : '') + '"></label>' +
        '<p class="lb-muted small">Type any time: 1:45, 105 (seconds), 2m or 2.5 (minutes). Leave empty or type 0 to turn it off.</p>' +
        '<div class="lb-row tight lb-chips">' + [0, 60, 90, 120, 180].map(v => '<button type="button" class="lb-btn small ghost" data-a="restQuick" data-s="' + v + '">' + (v ? mmss(v) : 'Off') + '</button>').join('') + '</div>' +
        (s ? '<label class="lb-check"><input type="checkbox" id="lb-restall"> All sets of ' + name + ' in this workout</label>' : '') +
        '<label class="lb-check"><input type="checkbox" id="lb-restdef"' + (s ? '' : ' checked') + '> Use this every time for ' + name + '</label>' +
        (running ? '<div class="lb-row tight"><button class="lb-btn small ghost" data-a="restAdj" data-d="-15">−15</button><button class="lb-btn small ghost" data-a="restAdj" data-d="15">+15</button><button class="lb-btn small ghost" data-a="restSkip">Skip rest</button></div>' : '') +
        '<div class="lb-row"><button class="lb-btn primary wide" data-a="restSave" data-ei="' + ei + '"' + (s ? ' data-si="' + si + '"' : '') + '>' + (running ? 'Save and restart timer' : 'Save') + '</button></div>',
      mount: el => { const inp = el.querySelector('#lb-restin'); if (!inp) return; inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); const b = el.querySelector('[data-a="restSave"]'); b && b.click(); } }); setTimeout(() => { try { inp.focus(); inp.select(); } catch (er) { } }, 60); }
    });
  }
  on('restEdit', t => restSheet(+t.dataset.ei, null));
  on('restSet', t => restSheet(+t.dataset.ei, +t.dataset.si));
  on('restQuick', t => { const inp = topSheet() && topSheet().el.querySelector('#lb-restin'); if (inp) { inp.value = +t.dataset.s ? mmss(+t.dataset.s) : ''; inp.focus(); } });
  on('restSave', t => {
    const sh = topSheet(), el = sh.el, ei = +t.dataset.ei, si = t.dataset.si == null ? null : +t.dataset.si, e = E.doc.exercises[ei];
    const raw = el.querySelector('#lb-restin').value, v = raw.trim() === '' ? 0 : parseRest(raw);
    if (v == null) { toast('Type a time like 1:45 or 105'); return; }
    const val = v >= 5 ? v : -1; // -1 = timer off (anything under 5 s counts as off)
    const all = si == null || (el.querySelector('#lb-restall') || {}).checked, def = (el.querySelector('#lb-restdef') || {}).checked;
    if (all) { e.rest = val; e.sets.forEach(x => { delete x.rest; }); } else e.sets[si].rest = val;
    if (def) put('exercises', Object.assign({}, S.data.exercises[e.exId] || {}, { id: e.exId, rest: val }));
    const restart = si != null && rest && rest.at && rest.at[0] === ei && rest.at[1] === si;
    closeSheet(); touch(); renderEditor();
    if (restart) { if (val > 0) startRest(val, [ei, si]); else stopRest(); }
  });
  on('exMenu', t => {
    const i = +t.dataset.ei, e = E.doc.exercises[i], ex = getEx(e.exId), weighted = isWeighted(ex);
    const opt = (a, l, extra) => '<button class="lb-option' + (extra || '') + '" data-a="' + a + '" data-ei="' + i + '">' + l + '</button>';
    openSheet({
      title: ex.name, body: () =>
        opt('exNote', e.notes || e.showNote ? 'Edit note' : 'Add a note') +
        (weighted ? opt('exWarm', 'Add warm-up sets') + opt('exPlates', 'Plate calculator for this lift') + opt('exUnit', 'Switch to ' + (e.unit === 'kg' ? 'lb' : 'kg')) : '') +
        (getEx(e.exId).memo ? '' : opt('exSetupM', 'Machine settings (seat, pin, weight step)')) +
        opt('exSuper', e.ss ? 'Remove from superset' : 'Superset with the next exercise') +
        opt('exUp', 'Move up') + opt('exDown', 'Move down') + opt('exReplace', 'Replace exercise') + opt('exRemove', 'Remove exercise', ' danger')
    });
  });
  const menuEx = t => E.doc.exercises[+t.dataset.ei];
  on('exNote', t => { menuEx(t).showNote = true; closeSheet(); renderEditor(); const ta = liveEl.querySelector('textarea[data-in="eNote"][data-ei="' + t.dataset.ei + '"]'); if (ta) ta.focus(); });
  on('exUnit', t => { const e = menuEx(t); e.unit = e.unit === 'kg' ? 'lb' : 'kg'; put('exercises', Object.assign({}, S.data.exercises[e.exId] || {}, { id: e.exId, unit: e.unit })); closeSheet(); touch(); renderEditor(); });
  on('exWarm', t => {
    const e = menuEx(t), first = e.sets.find(s => s.t !== 'w');
    const p = first ? prevMatch(prevFor(e), e, e.sets.indexOf(first)) : null;
    const top = num(first && first.w) || num(p && p.w);
    if (!top) { closeSheet(); toast('Enter the working weight first'); return; }
    const bar = e.unit === 'lb' ? S.settings.barLb : S.settings.bar;
    const ws = warmSets(top, e.unit, getEx(e.exId).cat === 'Barbell' ? bar : 0).map(s => ({ t: 'w', w: s.w, r: s.r, done: false }));
    e.sets = e.sets.filter(s => s.t !== 'w' || s.done).concat([]);
    const firstWork = e.sets.findIndex(s => s.t !== 'w'); e.sets.splice(firstWork < 0 ? e.sets.length : firstWork, 0, ...ws);
    closeSheet(); touch(); renderEditor();
  });
  on('exPlates', t => {
    const e = menuEx(t), first = e.sets.find(s => s.t !== 'w' && num(s.w)) || e.sets.find(s => s.t !== 'w');
    const p = first ? prevMatch(prevFor(e), e, e.sets.indexOf(first)) : null;
    plate = { mode: 'total', val: num(first && first.w) || num(p && p.w) || 60, unit: e.unit };
    openSheet({ title: 'Plate calculator', tool: true, body: plateTool });
  });
  on('exSuper', t => {
    const i = +t.dataset.ei, e = E.doc.exercises[i], next = E.doc.exercises[i + 1];
    if (e.ss) { const g = e.ss; E.doc.exercises.forEach(x => { if (x.ss === g) delete x.ss; }); }
    else if (next) { const g = next.ss || uid(); e.ss = g; next.ss = g; }
    else toast('Add another exercise below first');
    closeSheet(); touch(); renderEditor();
  });
  function moveEx(i, d) { const a = E.doc.exercises, j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; }
  on('exUp', t => { moveEx(+t.dataset.ei, -1); closeSheet(); touch(); renderEditor(); });
  on('exDown', t => { moveEx(+t.dataset.ei, 1); closeSheet(); touch(); renderEditor(); });
  on('exRemove', t => { E.doc.exercises.splice(+t.dataset.ei, 1); closeSheet(); touch(); renderEditor(); });
  on('exReplace', t => { const i = +t.dataset.ei; closeSheet(); openPicker(ids => { const e = E.doc.exercises[i]; e.exId = ids[0]; e.unit = defUnit(ids[0]); e.base = null; e.tplNote = ''; e.sets.forEach(s => { s.done = false; s.pr = []; }); touch(); renderEditor(); }, true); });
  on('addEx', () => openPicker(ids => { ids.forEach(id => E.doc.exercises.push({ exId: id, unit: defUnit(id), notes: '', sets: [0, 1, 2].slice(0, getEx(id).cat === 'Cardio' ? 1 : 3).map(() => ({ t: 'n', w: '', r: '', km: '', min: '', sec: '', done: false })) })); touch(); renderEditor(); setTimeout(() => { const b = liveEl.querySelector('.lb-live-body'); b.scrollTop = b.scrollHeight; }, 30); }));
  function openPicker(done, single) {
    exFilter.q = '';
    openSheet({
      title: single ? 'Replace exercise' : 'Add exercises', full: true, picker: true, picked: [], single, done,
      right: () => '<button class="lb-btn primary small" data-a="pickDone">' + (single ? 'Replace' : 'Add') + '</button>',
      body: () => exFilters('lb-pk') + '<div class="lb-row tight"><button class="lb-link small" data-a="newExPick">Create a new exercise</button></div><div id="lb-picklist">' + exListHtml(filteredExercises(), 'pickToggle', topSheet() ? topSheet().o.picked : []) + '</div>'
    });
  }
  on('pickToggle', t => {
    const sh = topSheet(), id = t.dataset.id, ex = getEx(id);
    if (sh.o.single) sh.o.picked = [id]; else { const k = sh.o.picked.indexOf(id); if (k >= 0) sh.o.picked.splice(k, 1); else sh.o.picked.push(id); }
    if (ex.avoided && sh.o.picked.includes(id)) toast(ex.name + ' is on your avoid list');
    sh.el.querySelectorAll('.lb-exrow').forEach(b => b.classList.toggle('picked', sh.o.picked.includes(b.dataset.id)));
    sh.el.querySelector('[data-a="pickDone"]').textContent = (sh.o.single ? 'Replace' : 'Add') + (sh.o.picked.length && !sh.o.single ? ' (' + sh.o.picked.length + ')' : '');
  });
  on('pickDone', () => { const sh = topSheet(); if (!sh.o.picked.length) { toast('Pick at least one exercise'); return; } const ids = sh.o.picked.slice(), fn = sh.o.done; closeSheet(); fn(ids); });
  on('newExPick', () => { const picker = topSheet(); exEditor(null, id => { picker.o.picked.push(id); picker.render(); }); });
  on('askCancel', () => { const c = liveEl.querySelector('#lb-cancelw'); if (c) { c.hidden = false; c.scrollIntoView({ block: 'center' }); } });
  on('cancelLive', () => { S.active = null; saveActive(true); stopRest(); keepAwake(false); closeEditor(); toast('Workout discarded'); });
  on('cancelEdit', () => closeEditor());
  on('saveEdit', () => {
    const d = E.doc;
    if (E.mode === 'template') {
      d.exercises.forEach(e => { delete e.showNote; delete e.base; delete e.tplNote; e.sets.forEach(s => { delete s.done; delete s.pr; }); });
      put('templates', JSON.parse(JSON.stringify(d))); closeEditor(); toast('Template saved'); return;
    }
    const cleaned = cleanWorkout(d); if (!cleaned) { toast('Check at least one set'); return; }
    cleaned.exercises.forEach(e => e.sets.forEach(s => { s.pr = setPRs(e.exId, e.unit, s, cleaned.id); }));
    put('workouts', cleaned); closeEditor(); toast('Workout updated');
  });
  function cleanWorkout(d) {
    const w = clone(d);
    w.exercises = w.exercises.map(e => { delete e.showNote; delete e.base; delete e.tplNote; e.sets = e.sets.filter(s => s.done); return e; }).filter(e => e.sets.length);
    if (!w.exercises.length) return null;
    delete w.updated; return w;
  }
  on('finish', () => {
    const d = E.doc;
    const unchecked = d.exercises.reduce((n, e) => n + e.sets.filter(s => !s.done && fieldsFor(getEx(e.exId)).some(k => s[k] !== '' && s[k] != null)).length, 0);
    const doneCount = d.exercises.reduce((n, e) => n + e.sets.filter(s => s.done).length, 0);
    if (!doneCount) { openSheet({ title: 'Nothing logged yet', body: () => '<p>Check off at least one set to save this workout, or cancel it.</p><div class="lb-row"><button class="lb-btn primary" data-a="closeSheet">Keep going</button><button class="lb-btn danger" data-a="cancelLiveFromSheet">Discard workout</button></div>' }); return; }
    const fillable = fillRemaining(clone(d.exercises), fieldsFor, getEx, phFor, prevFor, prevMatch);
    if (unchecked || fillable) {
      const n = Math.max(unchecked, fillable), what = unchecked ? unchecked + ' set' + (unchecked > 1 ? 's have' : ' has') + ' numbers but ' + (unchecked > 1 ? 'aren’t' : 'isn’t') + ' checked.' : fillable + ' set' + (fillable > 1 ? 's aren’t' : ' isn’t') + ' checked yet.';
      openSheet({ title: 'Finish workout?', body: () => '<p>' + what + ' Unchecked sets are not saved.</p><div class="lb-row">' +
        (fillable ? '<button class="lb-btn primary" data-a="finishCheckAll">Finish and check remaining (' + n + ')</button>' : '') +
        '<button class="lb-btn ' + (fillable ? 'ghost' : 'primary') + '" data-a="finishConfirm">Finish anyway</button><button class="lb-btn ghost" data-a="closeSheet">Go back</button></div>' +
        '<div class="lb-row"><button class="lb-btn ghost danger wide" data-a="askDiscard">Cancel workout (save nothing)</button></div>' });
      return;
    }
    finishFlow();
  });
  on('cancelLiveFromSheet', () => { closeAllSheets(); actions.cancelLive(); });
  // "Cancel workout" from the Finish sheet or Gym mode: confirm, then drop the live workout. Saved workouts are never touched.
  on('askDiscard', () => {
    if (!E || E.mode !== 'live') return;
    const n = E.doc.exercises.reduce((k, e) => k + e.sets.filter(s => s.done).length, 0);
    openSheet({ title: 'Cancel this workout?', body: () => '<p>' + esc(E.doc.name || 'This workout') + ' will be discarded' + (n ? ', including ' + n + ' checked set' + (n > 1 ? 's' : '') : '') + '. Nothing from it will be saved. Past workouts are not affected.</p><div class="lb-row"><button class="lb-btn danger" data-a="cancelLiveFromSheet">Discard workout</button><button class="lb-btn ghost" data-a="closeSheet">Keep going</button></div>' });
  });
  on('finishConfirm', () => { closeSheet(); finishFlow(); });
  // "Finish and check remaining": tick every unchecked set that has numbers or can take last time's, flag records, then finish. No rest timer, no per-set sound.
  on('finishCheckAll', () => {
    closeSheet();
    const d = E.doc, n = fillRemaining(d.exercises, fieldsFor, getEx, phFor, prevFor, prevMatch, (e, s) => { s.pr = setPRs(e.exId, e.unit, s, d.id); });
    if (n) { touch(); toast('Checked ' + n + ' set' + (n > 1 ? 's' : '')); }
    finishFlow();
  });
  function finishFlow() {
    const d = E.doc, tpl = d.templateId && S.data.templates[d.templateId];
    if (tpl && templateChanged(tpl, d)) {
      openSheet({ title: 'Update "' + tpl.name + '"?', body: () => '<p>Your weights, reps or exercises differ from the template. Save today’s numbers as the new targets?</p><div class="lb-row"><button class="lb-btn primary" data-a="finishSave" data-upd="1">Update template</button><button class="lb-btn ghost" data-a="finishSave" data-upd="0">Keep template</button></div>' });
      return;
    }
    finishSave(false);
  }
  function templateChanged(tpl, d) {
    const sig = es => JSON.stringify(es.map(e => [e.exId, e.sets.filter(s => s.done !== false).map(s => [s.t, +s.w || 0, +s.r || 0])]));
    return sig(tpl.exercises) !== sig(d.exercises.map(e => ({ exId: e.exId, sets: e.sets.filter(s => s.done) })));
  }
  on('finishSave', t => { closeSheet(); finishSave(t.dataset.upd === '1'); });
  function finishSave(updateTpl) {
    const d = E.doc; d.end = Date.now();
    const w = cleanWorkout(d);
    w.exercises.forEach(e => e.sets.forEach(s => { s.pr = setPRs(e.exId, e.unit, s, w.id); }));
    if (updateTpl) {
      const tpl = clone(S.data.templates[d.templateId]);
      tpl.exercises = w.exercises.map(e => { const old = tpl.exercises.find(x => x.exId === e.exId) || {}; return { exId: e.exId, unit: e.unit, notes: old.notes || '', rest: e.rest, ss: e.ss, sets: e.sets.map(s => { const c = clone(s); delete c.done; delete c.pr; if (c.t === 'w') c.r = c.r || ''; return c; }) }; });
      put('templates', tpl);
    }
    put('workouts', w);
    S.active = null; saveActive(true); stopRest(); keepAwake(false); closeEditor();
    if (S.settings.sound && GS()) GS().play('finish');
    if (S.settings.rotOverride) { S.settings.rotOverride = null; saveSettings(); }
    const shell = toShellRecord(w);
    if (S.opts.onFinish) { try { S.opts.onFinish(clone(w), shell); } catch (e) { } }
    summarySheet(w);
  }
  function toShellRecord(w) {
    const sets = {}; let treadmill = false;
    w.exercises.forEach(e => { const ex = getEx(e.exId); if (ex.cat === 'Cardio') { if (/treadmill/i.test(ex.name)) treadmill = true; return; } sets[SHELL_NAMES[e.exId] || ex.name] = working(e).map(s => num(s.rir) != null ? { w: num(s.w), r: num(s.r), unit: e.unit, rir: num(s.rir) } : { w: num(s.w), r: num(s.r), unit: e.unit }); });
    const idx = ROTATION.indexOf(w.templateName);
    return { date: isoDate(w.start), session: w.templateName || w.name, idx: idx >= 0 ? idx : null, sets, treadmill, durationMin: Math.round((w.end - w.start) / 6e4) };
  }
  function summarySheet(w) {
    const st = workoutStats(w), prs = [];
    w.exercises.forEach(e => e.sets.forEach(s => { if (s.pr && s.pr.length) prs.push({ ex: getEx(e.exId).name, s, e }); }));
    const tread = w.exercises.some(e => /treadmill/i.test(getEx(e.exId).name) && e.sets.length);
    const drops = MAIN_LIFTS.filter(id => w.exercises.some(e => e.exId === id) && liftTrend(id).dropping).map(getEx);
    openSheet({
      title: 'Workout complete', closeLabel: 'Done',
      body: () => '<div class="lb-done-hero"><b>' + esc(w.name) + '</b><span>' + fmtDate(w.start) + '</span></div><div class="lb-tiles"><div><b>' + fmtDur(st.dur) + '</b><span>Duration</span></div><div><b>' + fmtN(st.vol, 0) + '</b><span>Volume kg</span></div><div><b>' + st.sets + '</b><span>Sets</span></div><div><b>' + prs.length + '</b><span>Records</span></div></div>' +
        (prs.length ? '<h4>New records</h4><ul class="lb-prlist">' + prs.map(p => '<li><b>' + esc(p.ex) + '</b> ' + esc(fmtSet(p.s, p.e)) + ' <span class="lb-pr">' + esc(p.s.pr.join(', ')) + '</span></li>').join('') + '</ul>' : '') +
        (drops.length ? '<p class="lb-warnbox">' + esc(drops.map(x => x.name).join(', ')) + ' dropped 2 sessions in a row. Check sleep, pre-workout food and volume before changing calories.</p>' : '') +
        (tread ? '' : '<p class="lb-note">Don’t forget your 30 min treadmill (about 4.0 km/h, incline 3).</p>') +
        '<div class="lb-row"><button class="lb-btn primary" data-a="shareWorkout" data-id="' + w.id + '">Share</button><button class="lb-btn ghost" data-a="copySummary" data-id="' + w.id + '">Copy summary</button><button class="lb-btn ghost" data-a="histOpen" data-id="' + w.id + '">View details</button></div>'
    });
  }

  // ---------- Rest timer ----------
  // Looks (Settings → Rest timer look). ring and fill cover the whole screen like Strong; "Minimise" drops to the bar for that rest.
  const REST_STYLES = [['bar', 'Loading bar'], ['half', 'Half circle'], ['ring', 'Full circle'], ['fill', 'Screen fill'], ['plates', 'Plates off the bar'], ['blocks', 'Blocks']];
  const FULL_STYLES = { ring: 1, fill: 1 };
  const setSounds = () => (GS() && GS().SET_SOUNDS ? GS().SET_SOUNDS.map(r => [r.id, r.label]) : []).concat([['off', 'Off']]);
  const restSounds = () => (GS() && GS().REST_SOUNDS ? GS().REST_SOUNDS.map(r => [r.id, r.label]).concat(GS().customInfo && GS().customInfo() ? [['custom', 'Your sound: ' + GS().customInfo().name]] : []) : [['restDone', 'Bell (Strong-style)']]);
  const restStyle = () => (REST_STYLES.some(r => r[0] === S.settings.restStyle) ? S.settings.restStyle : 'bar');
  // Looks of the Android notification countdown (modules/android-shell RestTimerPlugin). Picked in Settings → Workout.
  const REST_NOTIFY = [['big', 'Big clock'], ['clock', 'Clock only'], ['bar', 'Loading bar'], ['plain', 'Plain'], ['endsAt', 'Ends at']];
  const REST_NOTIFY_HELP = { big: 'Rest timer on the left, the time counting down big on the right.', clock: 'Just the time, large and centred.', bar: 'A loading bar that empties under the time.', plain: 'A normal Android notification; the countdown sits in its corner.', endsAt: 'Shows the clock time your rest ends, with the countdown in the corner.' };
  const restNotify = () => (REST_NOTIFY.some(r => r[0] === S.settings.restNotify) ? S.settings.restNotify : 'big');
  // Persistent workout notification on Android (modules/android-shell RestTimerPlugin): what the shade shows between
  // rests. `focusEx` (set by its "Next exercise" button) overrides the resume point until that exercise is done.
  function workoutInfo() {
    const w = S.active; if (!w) return null;
    const exs = w.exercises || [];
    let cur = null;
    if (w.focusEx != null && exs[w.focusEx] && exs[w.focusEx].sets.some(x => !x.done)) cur = [w.focusEx, exs[w.focusEx].sets.findIndex(x => !x.done)];
    else cur = resumePoint(exs);
    const total = exs.reduce((n, e) => n + e.sets.length, 0), done = exs.reduce((n, e) => n + e.sets.filter(x => x.done).length, 0);
    let exercise = null, set = null, next = null;
    if (cur) {
      const e = exs[cur[0]]; exercise = getEx(e.exId).name; set = setLabel(e, cur[1]);
      for (let i = cur[0] + 1; i < exs.length; i++) if (exs[i].sets.some(x => !x.done)) { next = getEx(exs[i].exId).name; break; }
    }
    return { id: w.id, name: w.name, start: w.start, exercise, set, next, done, total, look: restNotify() };
  }
  let workoutCueT = null;
  function workoutCue() {
    clearTimeout(workoutCueT);
    workoutCueT = setTimeout(() => { try { const i = workoutInfo(); window.dispatchEvent(new CustomEvent(i ? 'lb:workout' : 'lb:workout-stop', { detail: i || {} })); } catch (e) { } }, 150);
  }
  // "Next exercise" on the notification: move to the next exercise with sets left (wrapping round).
  function nextExercise() {
    const w = S.active; if (!w) return;
    const exs = w.exercises || [], info = workoutInfo(), from = info && info.exercise ? exs.findIndex(e => getEx(e.exId).name === info.exercise) : -1;
    let pick = -1;
    for (let n = 1; n <= exs.length; n++) { const i = (from + n) % exs.length; if (exs[i] && exs[i].sets.some(x => !x.done)) { pick = i; break; } }
    if (pick < 0) return;
    w.focusEx = pick; w.updated = Date.now(); saveActive();
    if (E && E.mode === 'live' && E.doc === w) {
      if (E.view === 'gym') { const j = exs[pick].sets.findIndex(x => !x.done); gymGo(pick, j < 0 ? 0 : j); }
      else { const el = liveEl && liveEl.querySelector('.lb-exblock[data-ei="' + pick + '"]'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
    }
  }
  // "Rest" on the notification: the current exercise's rest.
  function restFromShade() {
    if (rest) return;
    const w = S.active, info = workoutInfo();
    const e = w && info && info.exercise ? (w.exercises || []).find(x => getEx(x.exId).name === info.exercise) : null;
    startRest(e ? restOf(e) : (S.settings.restIso || 90));
  }
  function restCue() { if (!rest) return; try { window.dispatchEvent(new CustomEvent('lb:rest', { detail: { end: rest.end, total: rest.total, sound: S.settings.restSound || 'restDone', look: restNotify() } })); } catch (e) { } }
  // Plates per side, inner to outer; they come off outer first as the rest runs down.
  const REST_PLATES = [['20', 'b', 1], ['15', 'y', .86], ['10', 'g', .72], ['5', 'w', .56], ['2.5', 'r', .44]];
  const REST_BLOCKS = 10;
  function startRest(sec, at) { if (!sec || sec < 5) return; rest = { end: Date.now() + sec * 1000, total: sec, alerted: false, at: at || null }; persistRest(); renderRest(); startTick(); restCue(); }
  function previewRest(sec) { startRest(sec); }
  function stopRest() { rest = null; persistRest(); renderRest(); try { window.dispatchEvent(new CustomEvent('lb:rest-stop')); } catch (e) { } }
  function persistRest() { try { localStorage.setItem('lb_rest', JSON.stringify(rest)); } catch (e) { } }
  on('restManualTyped', () => { const inp = document.getElementById('lb-restman'), v = inp && parseRest(inp.value); if (!v || v < 5) { toast('Type a time like 2:15 or 135'); return; } primeAudio(); startRest(v); toast('Rest timer ' + mmss(v)); });
  on('restManual', t => { primeAudio(); startRest(+t.dataset.s); toast('Rest timer ' + mmss(+t.dataset.s)); renderRest(); });
  // −15/+15 moves the end time but keeps the full length the ring/bar is measured against, so the visual jumps
  // with the number (−15 on a 1:30 rest drops it by a sixth). It only grows when +15 pushes time left past it.
  function adjustRest(r, d, now) {
    const end = Math.max(now, r.end + d * 1000), left = (end - now) / 1000;
    return Object.assign({}, r, { end, total: Math.max(r.total, Math.ceil(left), 1), buzz: undefined, alerted: false });
  }
  function restAdjust(d) {
    if (!rest) return;
    rest = adjustRest(rest, d, Date.now()); persistRest();
    if (rest.end <= Date.now()) return stopRest();
    renderRest();
    // Re-arm the locked-phone end sound for the new end time (same notification id, so it replaces the old one).
    restCue();
  }
  on('restAdj', t => restAdjust(+t.dataset.d));
  on('restSkip', () => stopRest());
  // Skip / +15 s buttons on the Android rest-countdown notification (modules/android-shell).
  try {
    window.addEventListener('lb:rest-skip', () => { if (rest) stopRest(); });
    window.addEventListener('lb:rest-adjust', e => restAdjust(+((e.detail || {}).d) || 15));
    window.addEventListener('lb:workout-next', () => nextExercise());
    window.addEventListener('lb:rest-start', () => restFromShade());
  } catch (e) { }
  on('restMini', () => { if (!rest) return; rest.mini = true; persistRest(); renderRest(); });
  on('restFull', () => { if (!rest) return; rest.mini = false; persistRest(); renderRest(); });
  function restHost() { return E && liveEl && !liveEl.hidden ? liveEl.querySelector('.lb-rest') : floatingRest(); }
  let floatEl;
  function floatingRest() { if (!floatEl) { floatEl = document.createElement('div'); floatEl.className = 'lb-rest floating'; floatEl.hidden = true; overlay.appendChild(floatEl); } return floatEl; }
  const restLeft = () => Math.max(0, Math.ceil((rest.end - Date.now()) / 1000));
  const restFrac = () => Math.max(0, Math.min(1, (rest.end - Date.now()) / (rest.total * 1000)));
  function restVisual(style, p, left) {
    const time = '<span class="lb-rest-time lb-mono" aria-live="off">' + mmss(left) + '</span>';
    if (style === 'half') return '<div class="lb-rest-half"><svg viewBox="0 0 200 108" aria-hidden="true"><path class="trk" d="M12 100 A88 88 0 0 1 188 100" pathLength="100"/><path class="val" d="M12 100 A88 88 0 0 1 188 100" pathLength="100"/></svg>' + time + '</div>';
    if (style === 'ring') return '<div class="lb-rest-ring"><svg viewBox="0 0 100 100" aria-hidden="true"><circle class="trk" cx="50" cy="50" r="45" pathLength="100"/><circle class="val" cx="50" cy="50" r="45" pathLength="100"/></svg><div class="lb-rest-mid">' + time + '<span class="lb-rest-of">of ' + mmss(rest.total) + '</span></div></div>';
    if (style === 'fill') return '<div class="lb-rest-level" aria-hidden="true"></div><div class="lb-rest-mid">' + time + '<span class="lb-rest-of">rest · ' + mmss(rest.total) + '</span></div>';
    if (style === 'plates') { const side = REST_PLATES.map(([kg, c, h], i) => '<i class="pl ' + c + '" data-i="' + i + '" style="--h:' + h + '" title="' + kg + ' kg"></i>'); return '<div class="lb-rest-plates" aria-hidden="true"><span class="side l">' + side.slice().reverse().join('') + '</span><span class="sleeve"></span><span class="side r">' + side.join('') + '</span></div>'; }
    if (style === 'blocks') return '<div class="lb-rest-blocks" aria-hidden="true">' + Array.from({ length: REST_BLOCKS }, (_, i) => '<i data-i="' + i + '"></i>').join('') + '</div>';
    return '<div class="lb-rest-bar"><i></i></div>';
  }
  // Moves the countdown without rebuilding it: --p (rest left, 0-1) drives bars, arcs and the fill level.
  // The rest line under the set that started this rest counts down in place, like Strong.
  function paintLines() {
    if (!liveEl) return;
    const left = rest ? restLeft() : 0, p = rest ? restFrac() : 0;
    liveEl.querySelectorAll('.lb-restline').forEach(b => {
      const on = !!(rest && rest.at && +b.dataset.ei === rest.at[0] && +b.dataset.si === rest.at[1]), sp = b.querySelector('span');
      b.classList.toggle('on', on);
      if (on) { b.style.setProperty('--p', p.toFixed(4)); if (sp) sp.textContent = mmss(left); }
      else if (sp && sp.textContent !== b.dataset.lbl) { sp.textContent = b.dataset.lbl; b.style.removeProperty('--p'); }
    });
  }
  function paintRest(h) {
    paintLines();
    if (!rest || !h) return;
    const p = restFrac(), left = restLeft();
    h.style.setProperty('--p', p.toFixed(4));
    h.classList.toggle('ending', left <= 10);
    const tEl = h.querySelector('.lb-rest-time'); if (tEl) tEl.textContent = mmss(left);
    const plates = Math.ceil(p * REST_PLATES.length - 1e-9), blocks = Math.ceil(p * REST_BLOCKS - 1e-9);
    h.querySelectorAll('.lb-rest-plates .pl').forEach(el => el.classList.toggle('off', +el.dataset.i >= plates));
    h.querySelectorAll('.lb-rest-blocks i').forEach(el => el.classList.toggle('off', +el.dataset.i >= blocks));
  }
  function renderRest() {
    const hosts = [liveEl && liveEl.querySelector('.lb-rest'), floatEl].filter(Boolean);
    hosts.forEach(h => { h.hidden = true; h.classList.remove('full'); h.removeAttribute('role'); });
    paintLines();
    if (!rest) return;
    const h = restHost(); h.hidden = false;
    const left = restLeft(), chosen = restStyle(), full = FULL_STYLES[chosen] && !rest.mini, style = FULL_STYLES[chosen] && rest.mini ? 'bar' : chosen;
    const inline = !(style === 'half' || full);
    const ctl = '<div class="lb-rest-row"><button class="lb-btn small ghost" data-a="restAdj" data-d="-15" aria-label="15 seconds less">−15</button>' + (inline ? '<span class="lb-rest-time lb-mono" aria-live="off">' + mmss(left) + '</span>' : '') + '<button class="lb-btn small ghost" data-a="restAdj" data-d="15" aria-label="15 seconds more">+15</button><button class="lb-btn small" data-a="restSkip">Skip</button>' +
      (FULL_STYLES[chosen] && rest.mini ? '<button class="lb-btn small ghost" data-a="restFull" aria-label="Full screen">⤢</button>' : '') + '</div>';
    h.dataset.style = style;
    h.classList.toggle('full', !!full);
    if (full) { h.setAttribute('role', 'dialog'); h.setAttribute('aria-label', 'Rest timer'); }
    h.innerHTML = (full ? '<button class="lb-rest-min" data-a="restMini" data-close aria-label="Minimise rest timer">Minimise</button><div class="lb-rest-eyebrow">Rest</div>' : '') + restVisual(style, restFrac(), left) + ctl + (E && E.view === 'gym' && (h !== floatEl || full) ? upNextHtml() : '');
    paintRest(h);
  }
  function startTick() {
    if (tickT) return;
    tickT = setInterval(() => {
      document.querySelectorAll('[data-clock]').forEach(el => { el.textContent = clock(Date.now() - +el.dataset.clock); });
      if (rest) {
        const left = Math.ceil((rest.end - Date.now()) / 1000);
        if (left <= 0) { if (!rest.alerted) { rest.alerted = true; beep(); if (S.settings.vibrate && navigator.vibrate) try { navigator.vibrate([200, 100, 200]); } catch (e) { } toast('Rest is over'); } stopRest(); }
        else {
          // 3-2-1: one short buzz as each of the last three seconds starts, then the end sound.
          if (left <= 3 && S.settings.countBuzz !== false && rest.buzz !== left) { rest.buzz = left; if (navigator.vibrate) try { navigator.vibrate(left === 1 ? 220 : 120); } catch (e) { } }
          const h = restHost();
          if (h && !h.hidden && h.firstChild) paintRest(h); else renderRest();
        }
      }
      if (!rest && !S.active && !E) { clearInterval(tickT); tickT = null; }
    }, 500);
  }

  // ---------- Styles ----------
  const CSS = `
.lb,.lb-overlay{--lb-bg:var(--bg,#f3f4f6);--lb-surface:var(--surface,#fff);--lb-sunk:var(--sunk,#e9ebef);--lb-line:var(--line,#d7dae0);--lb-ink:var(--ink,#16181d);--lb-muted:var(--muted,#5f6572);--lb-accent:var(--accent,#c8262f);--lb-accent-ink:var(--accent-ink,#fff);--lb-good:var(--good,#1b8a52);--lb-warn:var(--warn,#a86400);--lb-bad:var(--bad,#c42b2b);--lb-display:var(--display,"Barlow Condensed",system-ui,sans-serif);--lb-body:var(--body,"Barlow",system-ui,sans-serif);--lb-mono:var(--mono,ui-monospace,"SF Mono",Menlo,monospace);--lb-r:var(--r,12px);font-family:var(--lb-body);color:var(--lb-ink)}
:where(.lb,.lb-overlay) *{box-sizing:border-box}
:where(.lb,.lb-overlay) :where(button,input,select,textarea){font:inherit;color:inherit}
:where(.lb,.lb-overlay) :where(button){cursor:pointer;background:none;border:0;padding:0;text-align:inherit}
.lb :focus-visible,.lb-overlay :focus-visible{outline:2px solid var(--lb-accent);outline-offset:2px}
:where(.lb,.lb-overlay) h3{font-family:var(--lb-display);font-size:1.45rem;font-weight:700;margin:0;letter-spacing:.01em;text-wrap:balance}
:where(.lb,.lb-overlay) h4{font-family:var(--lb-display);font-size:1.05rem;font-weight:700;margin:.2rem 0 .5rem;text-transform:uppercase;letter-spacing:.06em}
:where(.lb,.lb-overlay) p{margin:.35rem 0;line-height:1.45}
.lb-muted{color:var(--lb-muted)} .small{font-size:.82rem}
.lb-mono{font-family:var(--lb-mono);font-variant-numeric:tabular-nums}
.lb-subnav{display:flex;gap:4px;background:var(--lb-sunk);border-radius:999px;padding:4px;margin:0 0 14px;overflow-x:auto;scrollbar-width:none}
.lb-subnav button{flex:1 1 auto;padding:8px 6px;border-radius:999px;font-weight:600;font-size:.86rem;color:var(--lb-muted);text-align:center;white-space:nowrap}
.lb-subnav button.on{background:var(--lb-surface);color:var(--lb-ink);box-shadow:0 1px 2px rgba(0,0,0,.12)}
.lb-view{display:flex;flex-direction:column;gap:14px;padding-bottom:24px}
.lb-card{display:block;width:100%;background:var(--lb-surface);border:1px solid var(--lb-line);border-radius:var(--lb-r);padding:14px;min-width:0}
button.lb-card{text-align:left}
button.lb-card:hover{border-color:var(--lb-muted)}
.lb-eyebrow{font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;color:var(--lb-muted);font-weight:600}
.lb-next h3{font-size:2rem;margin:.1rem 0}
.lb-rot{display:flex;flex-wrap:wrap;gap:4px;margin-top:12px}
.lb-rot span{font-size:.72rem;padding:3px 7px;border-radius:6px;background:var(--lb-sunk);color:var(--lb-muted);font-weight:600}
.lb-rot span.rest{font-style:italic}
.lb-rot span.on{background:var(--lb-accent);color:var(--lb-accent-ink)}
.lb-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;align-items:center}
.lb-row.tight{margin-top:6px} .lb-row.col{flex-direction:column;align-items:stretch;margin-top:18px}
.lb-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:42px;padding:8px 16px;border-radius:10px;background:var(--lb-sunk);font-weight:600;border:1px solid transparent}
.lb-btn.primary{background:var(--lb-accent);color:var(--lb-accent-ink)}
.lb-btn.ghost{background:transparent;border-color:var(--lb-line)}
.lb-btn.danger{color:var(--lb-bad)} .lb-btn.primary.danger,.lb-confirm .lb-btn.danger{background:var(--lb-bad);color:#fff;border-color:transparent}
.lb-btn.small{min-height:34px;padding:5px 12px;font-size:.88rem}
.lb-btn.wide{width:100%}
.lb-link{color:var(--lb-accent);font-weight:600} .lb-link.strong{color:var(--lb-ink);font-family:var(--lb-display);font-size:1.15rem;font-weight:700;text-align:left}
.lb-link.danger{color:var(--lb-bad)}
.lb-icon{min-width:36px;min-height:32px;border-radius:8px;color:var(--lb-muted);font-weight:700;letter-spacing:.05em}
.lb-icon:hover{background:var(--lb-sunk)}
.lb-section-head{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-top:6px}
.lb-folder{margin:4px 0 -4px!important;color:var(--lb-muted);font-size:.85rem!important}
.lb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}
.lb-tpl p{margin:.3rem 0 0;color:var(--lb-muted);font-size:.86rem;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.lb-tpl-top{display:flex;justify-content:space-between;gap:8px;align-items:baseline}
.lb-tpl-top b{font-family:var(--lb-display);font-size:1.2rem}
.lb-empty{padding:22px 16px;text-align:center;color:var(--lb-muted);border:1px dashed var(--lb-line);border-radius:var(--lb-r)}
.lb-active-bar{display:flex;align-items:center;gap:10px;width:100%;padding:10px 14px;margin:-4px 0 12px;border-radius:var(--lb-r);background:var(--lb-accent);color:var(--lb-accent-ink)}
.lb-active-bar .dot{width:9px;height:9px;border-radius:50%;background:currentColor;animation:lbpulse 1.4s 6}
.lb-demo-toggle{display:inline-flex;align-items:center;gap:6px;padding:5px 11px;margin:2px 0 8px;border-radius:999px;border:1px solid var(--lb-line);background:var(--lb-surface);color:var(--lb-muted);font-size:.84rem;font-weight:600;font-family:inherit}
.lb-demo-wrap{display:flex;flex-direction:column;align-items:flex-start;gap:2px;margin-bottom:6px}.lb-demo-wrap .ea-card{width:100%;margin:0}
.lb-screen-title{font-family:var(--display,inherit);font-size:1.9rem;line-height:1;margin:2px 0 12px;font-weight:700}

.lb-active-bar .lb-chev{margin-left:auto;font-weight:700}
.lb-active-acts{display:flex;gap:8px;margin:-6px 0 12px}.lb-active-acts .lb-btn{flex:1}
@keyframes lbpulse{50%{opacity:.3}}
.lb-stats{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:.85rem;color:var(--lb-muted);margin:.25rem 0 .4rem;font-variant-numeric:tabular-nums}
.lb-hlines{list-style:none;margin:0;padding:0;font-size:.88rem}
.lb-hlines li{display:flex;justify-content:space-between;gap:10px;padding:2px 0}
.lb-hlines li span:first-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lb-hlines li span:last-child{white-space:nowrap;font-variant-numeric:tabular-nums}
.lb-pr{display:inline-block;padding:1px 7px;border-radius:999px;background:var(--lb-good);color:#fff;font-size:.72rem;font-weight:700;letter-spacing:.04em}
.lb-tag{font-size:.7rem;padding:2px 7px;border-radius:999px;background:var(--lb-sunk);color:var(--lb-muted);font-weight:600;white-space:nowrap}
.lb-tag.warn{color:var(--lb-warn)}
.lb-seg{display:inline-flex;background:var(--lb-sunk);border-radius:10px;padding:3px;gap:2px}
.lb-seg button{padding:6px 12px;border-radius:8px;font-weight:600;font-size:.88rem;color:var(--lb-muted)}
.lb-seg button.on{background:var(--lb-surface);color:var(--lb-ink);box-shadow:0 1px 2px rgba(0,0,0,.12)}
.lb-seg.wide{display:flex;margin-bottom:12px} .lb-seg.wide button{flex:1}
.lb-cal-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.lb-cal{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;text-align:center}
.lb-cal em{font-style:normal;font-size:.72rem;color:var(--lb-muted);font-weight:600}
.lb-cal span,.lb-cal button{aspect-ratio:1;max-width:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;border-radius:8px;font-size:.85rem;font-variant-numeric:tabular-nums;text-align:center}
.lb-cal button.has{background:var(--lb-accent);color:var(--lb-accent-ink);font-weight:700}
.lb-cal button.has i{font-style:normal;font-size:.58rem;font-weight:600;opacity:.9;line-height:1}
.lb-cal .today{outline:2px solid var(--lb-ink);outline-offset:-2px}
.lb-filter{display:flex;gap:8px} .lb-filter input{flex:1;min-width:0} .lb-filter select{width:auto;max-width:45%}
.lb-input{width:100%;min-height:42px;padding:8px 12px;border-radius:10px;border:1px solid var(--lb-line);background:var(--lb-surface);color:var(--lb-ink)}
.lb-input.num{width:6.5rem;font-variant-numeric:tabular-nums}
textarea.lb-input{resize:vertical;min-height:42px;line-height:1.4}
.lb-chips{display:flex;gap:6px;overflow-x:auto;padding:8px 0 4px;scrollbar-width:none}
.lb-chips button{padding:5px 11px;border-radius:999px;border:1px solid var(--lb-line);font-size:.82rem;font-weight:600;white-space:nowrap;color:var(--lb-muted)}
.lb-chips button.on{background:var(--lb-ink);color:var(--lb-surface);border-color:var(--lb-ink)}
.lb-letter{font-family:var(--lb-display);font-weight:700;color:var(--lb-muted);padding:10px 4px 2px;font-size:.9rem}
.lb-exrow{display:flex;align-items:center;gap:12px;width:100%;padding:8px 6px;border-bottom:1px solid var(--lb-line);border-radius:8px;text-align:left}
.lb-exrow b{display:block;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis} .lb-exrow small{display:block;color:var(--lb-muted);font-size:.8rem;margin-top:1px}
.lb-exname{flex:1;min-width:0}
.lb-thumb{position:relative;flex:none;width:48px;height:48px;border-radius:50%;background:var(--lb-sunk);display:grid;place-items:center;overflow:hidden}
.lb-thumb i{font-style:normal;font-weight:600;font-size:1.25rem;color:var(--lb-muted)}
.lb-thumb-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:10px;background:#eceef2}
.lb-thumb:has(.lb-thumb-img){border-radius:10px}
.lb-excount{flex:none;min-width:2ch;text-align:right;font-size:1.05rem;color:var(--lb-muted);font-variant-numeric:tabular-nums}
.lb-exrow .lb-tag{font-size:.68rem;vertical-align:1px}
.lb-exrow.picked{background:color-mix(in srgb,var(--lb-accent) 14%,transparent)}
.lb-exrow.picked b::before{content:"✓ ";color:var(--lb-accent)}
.lb-field{display:flex;flex-direction:column;gap:4px;font-size:.85rem;font-weight:600;color:var(--lb-muted);margin-top:10px}
.lb-field.inline{flex-direction:row;align-items:center;gap:8px;flex-wrap:wrap}
.lb-field.inline .lb-input:not(.num){width:auto}
.lb-check{display:flex;gap:8px;align-items:center;margin-top:10px;font-size:.92rem}
.lb-check input{width:18px;height:18px;accent-color:var(--lb-accent)}
.lb-tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.lb-tiles > div{background:var(--lb-sunk);border-radius:10px;padding:10px;min-width:0}
.lb-tiles b{display:block;font-family:var(--lb-display);font-size:1.35rem;font-weight:700;font-variant-numeric:tabular-nums;overflow-wrap:anywhere;line-height:1.1}
.lb-tiles span{font-size:.72rem;color:var(--lb-muted);font-weight:600}
@media (max-width:520px){.lb-tiles{grid-template-columns:repeat(2,1fr)}}
.lb-big{font-family:var(--lb-display);font-size:2.4rem;font-weight:700;line-height:1;margin:.4rem 0;font-variant-numeric:tabular-nums}
.lb-big small{font-size:1rem;color:var(--lb-muted)}
.lb-svg{width:100%;height:auto;display:block;margin-top:6px}
.lb-svg .grid{stroke:var(--lb-line);stroke-width:1}
.lb-svg .ax{fill:var(--lb-muted);font-size:9px;font-family:var(--lb-body)}
.lb-svg .ln{fill:none;stroke:var(--lb-accent);stroke-width:2.2;stroke-linejoin:round;stroke-linecap:round}
.lb-svg .area{fill:var(--lb-accent);opacity:.1}
.lb-svg .pt{fill:var(--lb-surface);stroke:var(--lb-accent);stroke-width:1.6}
.lb-svg .pt.end{fill:var(--lb-accent)}
.lb-svg .val{fill:var(--lb-ink);font-size:10px;font-weight:700;font-family:var(--lb-body)}
.lb-svg .goal{stroke:var(--lb-good);stroke-dasharray:4 3;stroke-width:1.4}
.lb-svg .goaltxt{fill:var(--lb-good)}
.lb-svg .bar{fill:var(--lb-muted);opacity:.45} .lb-svg .bar.hi{fill:var(--lb-accent);opacity:1}
.lb-plates .sleeve{fill:var(--lb-muted);opacity:.5} .lb-plates .collar{fill:var(--lb-ink)}
.lb-plates .plate{stroke:var(--lb-line);stroke-width:1}
.lb-plates .p1{fill:#d1262e}.lb-plates .p2{fill:#1f5fbf}.lb-plates .p3{fill:#e3b300}.lb-plates .p4{fill:#1f8a4c}.lb-plates .p5{fill:#f4f4f4}.lb-plates .p6{fill:#2a2a2a}.lb-plates .p7{fill:#a7adb5}
.lb-chart{margin-top:12px}
.lb-lifts{display:flex;flex-direction:column}
.lb-lift{display:grid;grid-template-columns:1fr auto 70px;gap:4px 10px;align-items:center;padding:8px 0;border-bottom:1px solid var(--lb-line);width:100%}
.lb-lift:last-child{border-bottom:0}
.lb-lift .nm{font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lb-lift .lb-mono{font-size:.82rem;white-space:nowrap}
.lb-spark{width:70px;height:22px} .lb-spark polyline{fill:none;stroke:var(--lb-accent);stroke-width:1.6}
.lb-lift.drop .nm{color:var(--lb-bad)} .lb-lift.drop .lb-spark polyline{stroke:var(--lb-bad)}
.lb-flag{grid-column:1/-1;font-size:.78rem;color:var(--lb-bad)}
.lb-bars > div{display:grid;grid-template-columns:6.5rem 1fr 2rem;gap:8px;align-items:center;padding:3px 0;font-size:.88rem}
.lb-bars i{display:block;height:10px;border-radius:5px;background:var(--lb-accent)}
.lb-bars b{text-align:right;font-variant-numeric:tabular-nums}
.lb-mgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px}
.lb-m{display:flex;flex-direction:column;gap:2px;padding:10px 12px} .lb-m span{font-size:.8rem;color:var(--lb-muted);font-weight:600} .lb-m b{font-variant-numeric:tabular-nums}
.lb-reptable{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:6px;margin-top:8px}
.lb-reptable div{background:var(--lb-sunk);border-radius:8px;padding:6px 8px} .lb-reptable b{display:block;font-variant-numeric:tabular-nums} .lb-reptable span{font-size:.72rem;color:var(--lb-muted)}
.lb-tbl{width:100%;border-collapse:collapse;font-size:.9rem;font-variant-numeric:tabular-nums;margin-top:6px}
.lb-tbl td,.lb-tbl th{padding:6px 4px;border-bottom:1px solid var(--lb-line);text-align:left}
.lb-tbl th{font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;color:var(--lb-muted)}
.lb-tbl .r{text-align:right}
.lb-settag{display:inline-flex;align-items:center;justify-content:center;min-width:1.6rem;height:1.6rem;border-radius:7px;font-weight:700;font-size:.95rem;background:none;font-variant-numeric:tabular-nums}
td.lb-settag{display:table-cell;text-align:center;width:2.2rem;background:none}
.lb-settag.w{color:var(--lb-warn)} .lb-settag.d{color:#7a4fd0} .lb-settag.f{color:var(--lb-bad)}
.lb-note{background:var(--lb-sunk);border-radius:10px;padding:8px 12px;font-size:.9rem}
.lb-warnbox{border:1px solid var(--lb-warn);color:var(--lb-warn);border-radius:10px;padding:8px 12px;font-size:.88rem}
.lb-warn{color:var(--lb-warn)}
.lb-confirm{margin-top:10px;padding:12px;border-radius:10px;border:1px solid var(--lb-bad)}
.lb-plist{padding-left:1.2rem;margin:.6rem 0}
.lb-plist li{padding:5px 0;border-bottom:1px solid var(--lb-line)} .lb-plist li b{display:block}
.lb-plist span{color:var(--lb-muted);font-size:.86rem;font-variant-numeric:tabular-nums} .lb-plist em{display:block;font-size:.8rem;color:var(--lb-muted)}
.lb-hex{padding:10px 0;border-bottom:1px solid var(--lb-line)}
.lb-overlay{position:fixed;inset:0;pointer-events:none;z-index:1000}
.lb-overlay > *{pointer-events:auto}
.lb-sheet-wrap{position:fixed;inset:0;display:flex;align-items:flex-end;justify-content:center;z-index:20}
.lb-scrim{position:absolute;inset:0;background:rgba(10,12,16,.45);opacity:0;transition:opacity .24s cubic-bezier(.2,.8,.2,1)}
.lb-sheet{position:relative;width:100%;max-width:640px;max-height:88%;display:flex;flex-direction:column;background:var(--lb-bg);color:var(--lb-ink);border-radius:18px 18px 0 0;transform:translateY(40px);opacity:0;transition:transform .26s cubic-bezier(.2,.8,.2,1),opacity .22s cubic-bezier(.2,.8,.2,1);padding-bottom:env(safe-area-inset-bottom,0px)}
.lb-sheet.full{height:94%;max-height:94%}
.lb-sheet-wrap.closing{pointer-events:none} .lb-sheet-wrap.open .lb-scrim{opacity:1} .lb-sheet-wrap.open .lb-sheet{transform:none;opacity:1}
.lb-sheet-head{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;padding:12px max(16px,env(safe-area-inset-right,0px)) 10px max(16px,env(safe-area-inset-left,0px));border-bottom:1px solid var(--lb-line)}
.lb-sheet-head h2{margin:0;font-family:var(--lb-display);font-size:1.2rem;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lb-sheet-right{min-width:3rem;display:flex;justify-content:flex-end}
.lb-sheet-body{overflow-y:auto;padding:12px max(16px,env(safe-area-inset-right,0px)) 24px max(16px,env(safe-area-inset-left,0px));-webkit-overflow-scrolling:touch}
.lb-option{display:flex;gap:10px;align-items:center;width:100%;padding:13px 6px;border-bottom:1px solid var(--lb-line);font-weight:600}
.lb-option.danger{color:var(--lb-bad)}
.lb-copy{font-family:var(--lb-mono);font-size:.8rem}
.lb-live{position:fixed;inset:0;z-index:10;background:var(--lb-bg);display:flex;flex-direction:column;padding-top:env(safe-area-inset-top,0px)}
.lb-live.lb-live-in{animation:lb-live-in .28s cubic-bezier(.2,.8,.2,1) backwards}
@keyframes lb-live-in{from{opacity:0;transform:translateY(28px)}}
.lb-in{animation:lb-in .22s cubic-bezier(.2,.8,.2,1) backwards}
@keyframes lb-in{from{opacity:0;transform:translateY(6px)}}
.lb-live-head{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;padding:10px max(16px,env(safe-area-inset-right,0px)) 10px max(16px,env(safe-area-inset-left,0px));border-bottom:1px solid var(--lb-line);background:var(--lb-surface)}
.lb-live-head > b,.lb-elapsed{text-align:center;font-weight:700}
.lb-elapsed{font-size:1.1rem}
.lb-live-body{flex:1;overflow-y:auto;background:var(--lb-surface);padding:12px max(16px,env(safe-area-inset-right,0px)) 120px max(16px,env(safe-area-inset-left,0px));-webkit-overflow-scrolling:touch}
.lb-live-body > *{max-width:720px;margin-left:auto;margin-right:auto}
.lb-title-in{width:100%;border:0;background:transparent;font-family:var(--lb-display);font-size:1.55rem;font-weight:700;padding:2px 0;color:var(--lb-ink)}
.lb-notes{margin-top:6px}
.lb-live-body .lb-notes{min-height:34px;padding:6px 10px;font-size:.9rem}
.lb-exblock{margin-top:20px;padding:0 2px;background:transparent;border:0;border-radius:0}
.lb-exblock.ss{padding-left:10px}
.lb-exblock.ss{border-left:4px solid var(--lb-accent)}
.lb-exblock.ss1{border-left-color:#1f5fbf}.lb-exblock.ss2{border-left-color:#1f8a4c}.lb-exblock.ss3{border-left-color:#e3b300}
.lb-sslabel{font-size:.7rem;text-transform:uppercase;letter-spacing:.1em;font-weight:700;color:var(--lb-muted)}
.lb-exhead{display:flex;justify-content:space-between;align-items:center;gap:8px}
.lb-exhead .lb-link.strong{flex:1;min-width:0;line-height:1.2}
.lb-exhead .lb-demo-toggle{margin:0;flex:none;padding:3px 9px;font-size:.78rem}
.lb-exhead h3{color:var(--lb-accent);font-size:1.1rem;font-weight:600;font-family:var(--lb-body)}
.lb-exhead .lb-link.strong{color:var(--lb-accent);font-size:1.1rem;font-weight:600;font-family:var(--lb-body)}
.lb-memo{color:var(--lb-muted);font-style:italic}
.lb-memo-btn{display:block;width:100%;text-align:left;background:none;border:1px dashed var(--lb-line);color:var(--lb-muted);border-radius:10px;padding:6px 10px;font:inherit;font-size:.85rem;font-style:italic;cursor:pointer;margin:4px 0}
.lb-memo-btn:not(.empty){border-style:solid;color:inherit;font-style:normal}
.lb-chips{margin:-4px 0 6px}
.lb-hint{color:var(--lb-good);font-weight:600}
.lb-sets{margin-top:6px}
.lb-exblock .fc-inline{margin:.3rem 0 .2rem}.lb-exblock .fc-inline>summary{padding:.3rem .6rem;font-size:.8rem}
.lb-exblock > p.small{margin:.2rem 0;font-size:.8rem}
.lb-setrow{display:grid;grid-template-columns:var(--cols);gap:8px;align-items:center;padding:4px 2px;border-radius:10px;min-height:42px}
.lb-setrow.head{min-height:0;padding:0 2px 2px;font-size:.68rem;text-transform:uppercase;letter-spacing:.14em;color:var(--lb-ink);font-weight:700}
.lb-setrow.head span{text-align:center} .lb-setrow.head span:nth-child(2){text-align:left}
.lb-setrow.done{background:color-mix(in srgb,var(--lb-good) 16%,transparent)}
.lb-setwrap{position:relative;overflow:hidden;border-radius:10px;touch-action:pan-y}
.lb-swipe-del{position:absolute;inset:0;display:flex;justify-content:flex-end;background:var(--lb-bad);border-radius:10px;visibility:hidden}
.lb-setwrap.swiping .lb-swipe-del,.lb-setwrap.open .lb-swipe-del{visibility:visible}
.lb-swipe-btn{width:88px;height:100%;border:0;background:transparent;color:#fff;font:inherit;font-weight:800;font-size:.92rem;transition:width .15s}
.lb-setwrap.far .lb-swipe-btn{width:100%;text-align:left;padding-left:16px}
.lb-setwrap .lb-setrow{position:relative;background:var(--lb-surface);transition:transform .18s cubic-bezier(.2,.8,.2,1)}
.lb-setwrap.swiping .lb-setrow{transition:none}
.lb-setwrap .lb-setrow.done{background:color-mix(in srgb,var(--lb-good) 16%,var(--lb-surface))}
.lb-prev{font-size:.88rem;color:var(--lb-muted);opacity:.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;font-variant-numeric:tabular-nums;text-align:left}
.lb-prev.base{font-style:italic}
.lb-cell{width:100%;min-width:0;height:2.15rem;font-size:1.05rem;text-align:center;border-radius:8px;border:1px solid transparent;background:var(--lb-sunk);color:var(--lb-ink);font-weight:600;font-variant-numeric:tabular-nums;padding:0 4px}
.lb-cell::placeholder{color:var(--lb-muted);opacity:.75;font-weight:500}
.lb-cell:focus{border-color:var(--lb-accent);outline:none;background:var(--lb-surface)}
.lb-setrow.done .lb-cell{background:transparent}
.lb-chk{height:2.15rem;border-radius:8px;background:var(--lb-sunk);color:var(--lb-muted);font-weight:800;font-size:1rem;display:flex;align-items:center;justify-content:center}
.lb-setrow.done .lb-chk{background:var(--lb-good);color:#fff}
.lb-prrow{grid-column:2/-1;font-size:.72rem;font-weight:700;color:var(--lb-good);letter-spacing:.03em}
.lb-restline{display:flex;align-items:center;gap:10px;width:100%;min-height:24px;padding:0 2px;background:none;border:0;color:var(--lb-accent);font-weight:600;font-size:.85rem;font-variant-numeric:tabular-nums;cursor:pointer}
.lb-restline i{flex:1;height:4px;border-radius:2px;background:color-mix(in srgb,var(--lb-accent) 18%,transparent);position:relative;overflow:hidden}
.lb-restline.off{color:var(--lb-muted)} .lb-restline.off i{background:color-mix(in srgb,var(--lb-muted) 18%,transparent)}
.lb-restline.own span{text-decoration:underline dotted;text-underline-offset:3px}
.lb-restline.on{color:var(--lb-ink);font-weight:800}
.lb-restline.on i::after{content:"";position:absolute;inset:0;background:var(--lb-accent);transform-origin:left;transform:scaleX(var(--p,1))}
.lb-restline.on i:last-child::after{transform-origin:right}
.lb-restin{font-size:1.4rem;font-variant-numeric:tabular-nums;letter-spacing:.04em}
.lb-exfoot{display:flex;justify-content:center;align-items:center;margin-top:4px;gap:14px;position:relative}
.lb-exfoot .lb-btn{flex:1;background:none;border:0;color:var(--lb-accent);text-transform:uppercase;letter-spacing:.08em;font-weight:700;font-size:.85rem;min-height:38px}
.lb-exfoot .lb-link{position:absolute;right:0}
.lb-rest{position:absolute;left:0;right:0;bottom:0;background:var(--lb-surface);border-top:1px solid var(--lb-line);padding:8px max(16px,env(safe-area-inset-right,0px)) calc(10px + env(safe-area-inset-bottom,0px)) max(16px,env(safe-area-inset-left,0px));box-shadow:0 -6px 20px rgba(0,0,0,.12)}
.lb-rest.floating{position:fixed;z-index:15;left:max(12px,env(safe-area-inset-left,0px));right:max(12px,env(safe-area-inset-right,0px));bottom:calc(76px + env(safe-area-inset-bottom,0px));border-radius:14px;border:1px solid var(--lb-line);max-width:480px;margin:0 auto}
.lb-rest-bar{height:5px;background:var(--lb-sunk);border-radius:3px;overflow:hidden} .lb-rest-bar i{display:block;height:100%;width:calc(var(--p,1) * 100%);background:var(--lb-accent);transition:width .5s linear}
.lb-rest.ending .lb-rest-time{animation:lb-rest-pulse 1s ease-in-out infinite}
@keyframes lb-rest-pulse{50%{opacity:.55}}
.lb-rest-half{position:relative;max-width:260px;margin:0 auto} .lb-rest-half svg{display:block;width:100%;height:auto;overflow:visible}
.lb-rest-half path,.lb-rest-ring circle{fill:none;stroke-width:12;stroke-linecap:round} .lb-rest-ring circle{stroke-width:5}
.lb-rest-half .trk,.lb-rest-ring .trk{stroke:var(--lb-sunk)} .lb-rest-half .val,.lb-rest-ring .val{stroke:var(--lb-accent);stroke-dasharray:100 100;stroke-dashoffset:calc((1 - var(--p,1)) * 100);transition:stroke-dashoffset .5s linear}
.lb-rest-half .lb-rest-time{position:absolute;left:0;right:0;bottom:2px;text-align:center}
.lb-rest-ring{position:relative;width:min(78vw,52vh,360px);aspect-ratio:1;max-width:100%;margin:0 auto} .lb-rest-ring svg{width:100%;height:100%;transform:rotate(-90deg)}
.lb-rest-mid{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;pointer-events:none}
.lb-rest-of{color:var(--lb-muted);font-size:.95rem}
.lb-rest-plates{display:flex;align-items:center;justify-content:center;height:58px;margin:4px auto 2px;max-width:100%}
.lb-rest-plates .sleeve{flex:0 1 120px;height:6px;border-radius:3px;background:var(--lb-muted);opacity:.6}
.lb-rest-plates .side{display:flex;align-items:center;gap:2px}
.lb-rest-plates .pl{display:block;width:9px;height:calc(var(--h) * 56px);border-radius:3px;transition:transform .45s ease,opacity .45s ease}
.lb-rest-plates .pl.b{background:#1F5FD1}.lb-rest-plates .pl.y{background:#F2C230}.lb-rest-plates .pl.g{background:#1B8048}.lb-rest-plates .pl.w{background:#EEF0F2;box-shadow:inset 0 0 0 1px #A9B1BA}.lb-rest-plates .pl.r{background:#D0302A}
.lb-rest-plates .l .pl.off{transform:translateX(-26px);opacity:0}.lb-rest-plates .r .pl.off{transform:translateX(26px);opacity:0}
.lb-rest-blocks{display:grid;grid-template-columns:repeat(10,1fr);gap:4px;max-width:720px;margin:0 auto}
.lb-rest-blocks i{display:block;height:14px;border-radius:3px;background:var(--lb-accent);transition:background-color .3s ease,opacity .3s ease}
.lb-rest-blocks i.off{background:var(--lb-sunk)}
.lb-rest.full{position:fixed;inset:0;z-index:30;border:0;border-radius:0;max-width:none;margin:0;box-shadow:none;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:calc(16px + env(safe-area-inset-top,0px)) max(16px,env(safe-area-inset-right,0px)) calc(24px + env(safe-area-inset-bottom,0px)) max(16px,env(safe-area-inset-left,0px));background:var(--lb-bg);overflow:hidden;animation:lb-rest-in .25s ease-out}
@keyframes lb-rest-in{from{opacity:0;transform:scale(.98)}}
.lb-rest.full .lb-rest-time{font-family:var(--lb-display);font-size:clamp(3.5rem,18vw,6rem);line-height:1;min-width:0}
.lb-rest.full .lb-rest-row{position:relative;z-index:1} .lb-rest.full .lb-rest-row .lb-btn{min-height:56px;min-width:72px;font-size:1.05rem}
.lb-rest.full .lb-rest-next{position:relative;z-index:1}
.lb-rest-eyebrow{position:relative;z-index:1;text-transform:uppercase;letter-spacing:.12em;font-weight:700;font-size:.8rem;color:var(--lb-muted)}
.lb-rest-min{position:absolute;z-index:2;top:calc(12px + env(safe-area-inset-top,0px));right:max(12px,env(safe-area-inset-right,0px));min-height:44px;padding:0 14px;border-radius:22px;border:1px solid var(--lb-line);background:var(--lb-surface);color:var(--lb-ink);font:600 .9rem var(--lb-body);cursor:pointer}
.lb-rest.full[data-style="fill"] .lb-rest-mid{position:relative;inset:auto;z-index:1}
.lb-rest-level{position:absolute;left:0;right:0;bottom:0;height:calc(var(--p,1) * 100%);background:color-mix(in srgb,var(--lb-accent) 26%,var(--lb-bg));border-top:3px solid var(--lb-accent);transition:height .5s linear}
.lb-chips{flex-wrap:wrap;gap:6px;margin-top:4px}
@media (prefers-reduced-motion:reduce){.lb-rest *,.lb-rest{transition:none!important;animation:none!important}}
.lb-rest-row{display:flex;gap:10px;align-items:center;justify-content:center;margin-top:6px;max-width:720px;margin-left:auto;margin-right:auto}
.lb-rest-time{font-size:1.7rem;font-weight:700;min-width:5.5rem;text-align:center}
.lb-headmid{display:flex;flex-direction:column;align-items:center;gap:1px;line-height:1.15}
.lb-headend{display:flex;align-items:center;gap:8px}
.lb-mic{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:50%;border:1px solid var(--lb-line);background:var(--lb-sunk);color:var(--lb-accent);cursor:pointer;padding:0}
.lb-live.gym .lb-live-body{padding-bottom:200px}
.lb-gym{display:flex;flex-direction:column;gap:12px}
.lb-gym-top{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:.74rem;letter-spacing:.12em;text-transform:uppercase;color:var(--lb-muted);font-weight:700}
.lb-gym-ss{padding:3px 8px;border-radius:999px;color:#fff;background:var(--lb-accent)}
.lb-gym-ss.ss1{background:#2f6fd6} .lb-gym-ss.ss2{background:#7a4cc9} .lb-gym-ss.ss3{background:#0f8a7e}
.lb-gym-headrow{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
.lb-gym-name{font-family:var(--lb-display);font-size:2.1rem;font-weight:700;line-height:1.02;letter-spacing:.005em;text-wrap:balance;min-width:0}
.lb-gym-tools{display:flex;gap:6px;flex-wrap:wrap} .lb-gym-tools a.lb-btn{text-decoration:none;color:inherit}
.lb-gym-dots{display:flex;gap:6px;flex-wrap:wrap}
.lb-gym-dot{min-width:46px;height:40px;padding:0 10px;border-radius:999px;background:var(--lb-sunk);font-weight:800;display:inline-flex;align-items:center;justify-content:center}
.lb-gym-dot.w{color:var(--lb-warn)} .lb-gym-dot.d,.lb-gym-dot.f{color:var(--lb-bad)}
.lb-gym-dot.done{background:var(--lb-good);color:#fff}
.lb-gym-dot.cur{box-shadow:0 0 0 2px var(--lb-bg),0 0 0 4px var(--lb-accent)}
.lb-gym-dot.add{background:transparent;border:1px dashed var(--lb-line);color:var(--lb-muted)}
.lb-gym-card{background:var(--lb-surface);border:1px solid var(--lb-line);border-radius:calc(var(--lb-r) + 4px);padding:16px}
.lb-gym-card.done{border-color:var(--lb-good)}
.lb-gym-card.center{text-align:center}
.lb-gym-setlabel{font-family:var(--lb-display);font-size:1.5rem;font-weight:700;display:flex;align-items:center;gap:10px}
.lb-gym-ok{font-family:var(--lb-body);font-size:.85rem;color:var(--lb-good);font-weight:700}
.lb-gym-last{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-top:8px;padding:10px 12px;border-radius:10px;background:var(--lb-sunk)}
.lb-gym-last span{font-size:.74rem;letter-spacing:.1em;text-transform:uppercase;color:var(--lb-muted);font-weight:700;white-space:nowrap}
.lb-gym-last b{text-align:right;font-variant-numeric:tabular-nums}
.lb-gym-deltas{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.lb-delta{padding:4px 10px;border-radius:999px;background:var(--lb-sunk);font-weight:700;font-size:.85rem;font-variant-numeric:tabular-nums}
.lb-delta.up{background:color-mix(in srgb,var(--lb-good) 16%,transparent);color:var(--lb-good)}
.lb-delta.down{background:color-mix(in srgb,var(--lb-warn) 16%,transparent);color:var(--lb-warn)}
.lb-gym-prpace{margin:8px 0 0;font-weight:700;color:var(--lb-good);font-size:.9rem}
.lb-gym-field{display:grid;grid-template-columns:72px minmax(0,1fr) 72px;gap:10px;align-items:center;margin-top:14px}
.lb-gym-flabel{grid-column:1/-1;text-align:center;font-size:.74rem;letter-spacing:.12em;text-transform:uppercase;color:var(--lb-muted);font-weight:700;margin-bottom:-6px}
.lb-gym-flabel.rir{margin:16px 0 6px}
.lb-gym-step{height:72px;border-radius:16px;background:var(--lb-sunk);font-size:1.8rem;font-weight:800;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1;touch-action:manipulation;user-select:none}
.lb-gym-step small{font-size:.78rem;font-weight:700;color:var(--lb-muted);margin-top:3px}
.lb-gym-step:active{transform:scale(.96);background:var(--lb-line)}
.lb-gym-num{width:100%;height:76px;text-align:center;font-family:var(--lb-display);font-size:3rem;font-weight:700;border-radius:16px;border:2px solid transparent;background:transparent;color:var(--lb-ink);font-variant-numeric:tabular-nums;padding:0}
.lb-gym-num::placeholder{color:var(--lb-muted);opacity:.55}
.lb-gym-num:focus{outline:none;border-color:var(--lb-accent);background:var(--lb-sunk)}
.lb-gym-rir{display:grid;grid-template-columns:repeat(5,1fr);gap:6px}
.lb-gym-rir button{text-align:center;height:52px;border-radius:12px;background:var(--lb-sunk);font-weight:800;font-size:1.1rem;touch-action:manipulation}
.lb-gym-rir button.on{background:var(--lb-ink);color:var(--lb-surface)}
.lb-gym-done{display:block;width:100%;min-height:76px;border-radius:18px;background:var(--lb-accent);color:var(--lb-accent-ink);font-family:var(--lb-display);font-size:1.75rem;font-weight:700;letter-spacing:.02em;text-align:center;touch-action:manipulation;transition:transform .12s}
.lb-gym-done:active{transform:scale(.98)}
.lb-gym-done.ok{background:var(--lb-good);color:#fff}
.lb-gym-pair{display:grid;grid-template-columns:auto 1fr;gap:10px;align-items:stretch} .lb-gym-pair .lb-btn{min-height:76px;padding:0 18px}
.lb-gym-nav{display:grid;grid-template-columns:1fr auto 1fr;gap:8px} .lb-gym-nav .lb-btn{min-height:52px;padding:6px 10px;font-size:.9rem}
.lb-gym-nav .lb-btn:disabled{opacity:.4}
.lb-gym-pr{background:var(--lb-good);color:#fff;border-radius:12px;padding:12px 14px;font-weight:800;text-align:center;animation:lb-pop .35s ease-out}.pr-celebrate b{display:block;font-size:1rem}.pr-celebrate-lines{display:block;margin-top:4px;font-weight:600;font-size:.88rem;opacity:.95}.pr-celebrate-lines>span{display:block}.pr-celebrate small{opacity:.8;font-weight:500}
@keyframes lb-pop{from{transform:scale(.94);opacity:0}to{transform:none;opacity:1}}
.lb-live.gym .lb-rest:not(.full){padding-top:12px}
.lb-live.gym .lb-rest-bar{height:8px;border-radius:4px}
.lb-live.gym .lb-rest:not(.full) .lb-rest-time{font-family:var(--lb-display);font-size:3.4rem;min-width:7rem;line-height:1}
.lb-live.gym .lb-rest:not(.full) .lb-rest-row .lb-btn{min-height:56px;min-width:64px;font-size:1.05rem}
.lb-rest-next{text-align:center;margin:8px auto 0;max-width:720px;color:var(--lb-muted);font-size:.9rem}
.lb-rest-next b{color:var(--lb-ink)}
@media (max-width:360px){.lb-gym-field{grid-template-columns:60px minmax(0,1fr) 60px}.lb-gym-num{font-size:2.5rem}.lb-gym-name{font-size:1.8rem}.lb-live.gym .lb-rest:not(.full) .lb-rest-row{gap:6px}.lb-live.gym .lb-rest:not(.full) .lb-rest-time{font-size:2.6rem;min-width:5rem}.lb-live.gym .lb-rest:not(.full) .lb-rest-row .lb-btn{min-width:52px;padding:6px 8px}}
.lb-done-hero{text-align:center;padding:10px 0 14px} .lb-done-hero b{display:block;font-family:var(--lb-display);font-size:1.9rem} .lb-done-hero span{color:var(--lb-muted)}
.lb-share{background:var(--lb-sunk);border-radius:var(--lb-r);padding:8px;margin-bottom:10px} .lb-share img{display:block;width:100%;height:auto;border-radius:calc(var(--lb-r)*.7);box-shadow:0 6px 24px rgba(0,0,0,.18)} .lb-share-text{margin-top:10px} .lb-share-text pre{white-space:pre-wrap;font:inherit;font-size:.9rem;background:var(--lb-sunk);padding:10px;border-radius:var(--lb-r);margin:6px 0 0}
.lb-prlist{list-style:none;padding:0;margin:0} .lb-prlist li{padding:6px 0;border-bottom:1px solid var(--lb-line)}
.lb-toast{position:fixed;left:50%;bottom:calc(90px + env(safe-area-inset-bottom,0px));transform:translate(-50%,20px);background:var(--lb-ink);color:var(--lb-surface);padding:10px 16px;border-radius:999px;font-weight:600;font-size:.9rem;opacity:0;transition:opacity .2s,transform .2s;z-index:40;max-width:calc(100% - 32px);text-align:center;pointer-events:none}
.lb-toast.show{opacity:1;transform:translate(-50%,0)}
.lb [hidden],.lb-overlay [hidden],.lb-overlay[hidden]{display:none!important}
html.lb-noscroll,html.lb-noscroll body{overflow:hidden}
@media (prefers-reduced-motion:reduce){.lb *,.lb-overlay *{transition:none!important;animation:none!important}}
`;

  // ---------- Mount ----------
  async function mount(el, opts) {
    opts = opts || {};
    S.opts = opts; S.storage = opts.storage || localStorageAdapter('lb:');
    if (!document.getElementById('lb-style')) { const st = document.createElement('style'); st.id = 'lb-style'; st.textContent = CSS; document.head.appendChild(st); }
    if (opts.anim) {
      opts.anim.info = id => {
        const g = opts.formCues ? opts.formCues.find(id) || opts.formCues.find(getEx(id).name) : null;
        return { title: getEx(id).name, cues: g ? g.cues : [], steps: g ? g.steps : [] };
      };
      opts.anim.attach(document);
    }
    if (opts.formCues) { if (!document.getElementById('fc-style')) { const st = document.createElement('style'); st.id = 'fc-style'; st.textContent = opts.formCues.css; document.head.appendChild(st); } opts.formCues.attach(document); }
    if (opts.tips && opts.tips.css && !document.getElementById('nt-style')) { const st = document.createElement('style'); st.id = 'nt-style'; st.textContent = opts.tips.css; document.head.appendChild(st); }
    root = el; root.classList.add('lb');
    overlay = document.querySelector('.lb-overlay') || document.body.appendChild(Object.assign(document.createElement('div'), { className: 'lb-overlay' }));
    if (!root.dataset.lbBound) { delegate(root); root.dataset.lbBound = '1'; }
    if (!overlay.dataset.lbBound) { delegate(overlay); overlay.dataset.lbBound = '1'; }
    renderMain();
    S.readyP = loadAll(); await S.readyP;
    if (S.active) workoutCue(); // a workout restored from the last session goes back into the Android shade
    try { const r = JSON.parse(localStorage.getItem('lb_rest') || 'null'); if (r && r.end > Date.now()) rest = r; } catch (e) { }
    renderMain();
    if (S.active || rest) startTick();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && E && E.mode === 'live') keepAwake(true); });
    return api;
  }
  // Called by a host when its storage changed underneath (another device): reload and redraw.
  async function refresh() { await loadAll(); if (!E && !sheets.length) renderMain(); }
  // Host settings screen: read the logger's settings and change some of them (gym, unit, rest) without opening its Tools tab.
  function settings() { return clone(S.settings); }
  function setSettings(patch) { Object.keys(patch || {}).forEach(k => noteSetting(k, patch[k])); if (!E && !sheets.length) renderMain(); return clone(S.settings); }
  const api = { mount, refresh, importStrong, parseStrong, buildProgram, toShellRecord, applyVoice, settings, setSettings, previewRest, restStyles: REST_STYLES, restNotifyLooks: REST_NOTIFY, workoutInfo, library: LIB, rotation: ROTATION, mainLifts: MAIN_LIFTS, show(k) { tab = k; renderMain(); },
    parseRest, setRestOf, fillRemaining,
    mergeSettings, gym: { gymOrder, nextPending, resumePoint, restAfter, compareSets, weightStep, bumpVal, snapStep, stepWeight, warmSets, loadableUp, adjustRest },
    swipe: { swipeDecision } };
  global.WorkoutLogger = api;
})(typeof window !== 'undefined' ? window : globalThis);

