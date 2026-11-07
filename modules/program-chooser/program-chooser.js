/* program-chooser: "Help me choose" for Train > New template. A full-screen questionnaire in the goal-setup look
 * (steps, dots, animated SVG art, option buttons) that scores Jeff Nippard's ready-made programs
 * (modules/nippard-programs) against the answers and recommends the best three with reasons.
 * Plain JS, no imports. Needs GoalSetup.css on the page for the gs-* classes (the shell injects it) plus its own css.
 * API:
 *   ProgramChooser.QUESTIONS                        -> the steps (id, title, sub, multi, options[{id,label,sub}])
 *   ProgramChooser.recommend(answers, programs)     -> [{id, score, pct, reasons[], cautions[], program}] best first (programs = NippardPrograms.list())
 *   ProgramChooser.open({programs, added(id), onPick(id), onPreview(id), onClose(reason), onBack, document, mount})
 *       -> { el, close(), state() }; the result page's "Add to my templates" calls onPick(id) then closes.
 *   ProgramChooser.css                              -> CSS string, inject once.
 */
const ProgramChooser = (() => {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- what we know about each program (beyond days/level in programs.json) ----------
  // split: fb | ul | ppl | bro | mix. gear: barbell (rack + bar needed, big lifts carry the plan) | mixed | machine.
  // push: easy | steady | hard (how close to failure / intensity techniques). lvl: beginner | middle | advanced (any mix).
  // goal: muscle | strength | both | comeback. flex: days can move around the week. ss: superset built. simple: few exercises, repeat.
  const TAGS = {
    'ml-fb2': { split: 'fb', gear: 'mixed', push: 'steady', lvl: ['beginner', 'middle', 'advanced'], goal: ['muscle'], flex: true, ss: true, simple: true, time: 'medium' },
    'ml-fb3-beginner': { split: 'fb', gear: 'machine', push: 'easy', lvl: ['beginner'], goal: ['muscle'], flex: true, simple: true, time: 'long' },
    'ml-fb3': { split: 'fb', gear: 'barbell', push: 'hard', lvl: ['middle', 'advanced'], goal: ['muscle', 'strength', 'both'], flex: true, time: 'long' },
    'ml-ul4': { split: 'ul', gear: 'barbell', push: 'steady', lvl: ['middle', 'advanced'], goal: ['muscle', 'both'], time: 'long' },
    'ml-fb4': { split: 'fb', gear: 'mixed', push: 'steady', lvl: ['middle', 'advanced'], goal: ['muscle'], flex: true, time: 'long', variety: true },
    'ml-ulppl5': { split: 'mix', gear: 'barbell', push: 'hard', lvl: ['middle', 'advanced'], goal: ['muscle', 'both'], time: 'long', variety: true },
    'ml-ul6': { split: 'ul', gear: 'mixed', push: 'hard', lvl: ['middle', 'advanced'], goal: ['muscle'], time: 'long', variety: true },
    'ml-ppl6': { split: 'ppl', gear: 'barbell', push: 'hard', lvl: ['middle', 'advanced'], goal: ['muscle', 'both'], time: 'long', variety: true },
    'essentials-3x': { split: 'mix', gear: 'barbell', push: 'steady', lvl: ['beginner', 'middle', 'advanced'], goal: ['muscle', 'strength', 'both'], simple: true, time: 'medium' },
    'fund-fb3': { split: 'fb', gear: 'barbell', push: 'steady', lvl: ['beginner', 'middle'], goal: ['muscle', 'both'], flex: true, simple: true, time: 'medium' },
    'fund-ul4': { split: 'ul', gear: 'barbell', push: 'steady', lvl: ['beginner', 'middle'], goal: ['muscle'], simple: true, time: 'medium' },
    'fund-bro5': { split: 'bro', gear: 'mixed', push: 'steady', lvl: ['middle'], goal: ['muscle'], time: 'medium', arms: true },
    'comeback-ppl': { split: 'ppl', gear: 'mixed', push: 'easy', lvl: ['beginner', 'middle', 'advanced'], goal: ['comeback'], comeback: true, flex: true, time: 'medium', anyDays: [3, 6] },
    'comeback-ul': { split: 'ul', gear: 'mixed', push: 'easy', lvl: ['beginner', 'middle', 'advanced'], goal: ['comeback'], comeback: true, time: 'medium' },
    'pbb2-fb5': { split: 'fb', gear: 'machine', push: 'hard', lvl: ['middle', 'advanced'], goal: ['muscle'], time: 'long', variety: true, arms: true },
    'bts-beginner': { split: 'mix', gear: 'mixed', push: 'steady', lvl: ['beginner'], goal: ['muscle'], time: 'medium', simple: true },
    'bts-intermediate': { split: 'mix', gear: 'mixed', push: 'hard', lvl: ['middle', 'advanced'], goal: ['muscle'], time: 'long', variety: true },
    'powerbuilding-5x': { split: 'ul', gear: 'barbell', push: 'hard', lvl: ['middle', 'advanced'], goal: ['strength', 'both'], pb: true, time: 'long' }
  };
  const SPLIT_NAME = { fb: 'full body', ul: 'upper / lower', ppl: 'push / pull / legs', bro: 'one body part a day', mix: 'a mixed split' };
  const TIME_RANK = { short: 0, medium: 1, long: 2, xl: 3 };

  // Fallback for a program the chooser has no tags for (added later to programs.json).
  function tagsFor(p) {
    if (TAGS[p.id]) return TAGS[p.id];
    const lv = String(p.level || '').toLowerCase();
    return { split: 'mix', gear: 'mixed', push: 'steady', time: 'medium', goal: ['muscle'], lvl: lv.includes('beginner') ? ['beginner', 'middle'] : lv.includes('return') ? ['beginner', 'middle', 'advanced'] : ['middle', 'advanced'], comeback: lv.includes('return') };
  }

  // ---------- the questions ----------
  const QUESTIONS = [
    { id: 'situation', title: 'Where are you right now?', sub: 'This decides more than anything else.', options: [
      { id: 'training', label: 'Training steadily', sub: 'In the gym most weeks for the last few months' },
      { id: 'new', label: 'Just getting started', sub: 'Never lifted, or less than 6 months of it' },
      { id: 'break', label: 'Back after a break', sub: 'Holiday, exams, work, lost the habit: 4+ weeks off' },
      { id: 'injury', label: 'Back after an injury', sub: 'Cleared to train again and want to rebuild safely' },
      { id: 'restart', label: 'Restarting after months or years', sub: 'Used to lift, long time ago' }] },
    { id: 'away', title: 'How long were you away?', sub: 'Time off decides how gently to start.', when: a => ['break', 'injury', 'restart'].includes(a.situation), options: [
      { id: 'short', label: '2 to 4 weeks', sub: 'Strength is mostly still there' },
      { id: 'medium', label: '1 to 3 months', sub: 'Expect a few easy weeks first' },
      { id: 'long', label: '3 months or more', sub: 'Treat it as a fresh start' }] },
    { id: 'joints', title: 'Anything that still hurts?', sub: 'Pick all that apply. The pick leans away from heavy barbell work on a sore joint.', multi: true, none: 'nothing', options: [
      { id: 'nothing', label: 'Nothing, all good' },
      { id: 'shoulder', label: 'Shoulder', sub: 'Pressing or overhead work bothers it' },
      { id: 'back', label: 'Lower back', sub: 'Deadlifts, rows or squats bother it' },
      { id: 'knee', label: 'Knee', sub: 'Deep squats or lunges bother it' },
      { id: 'elbow', label: 'Elbow or wrist', sub: 'Curls, extensions or heavy pressing bother it' }] },
    { id: 'level', title: 'How long have you lifted with a plan?', sub: 'Honest answer, the beginner plans progress fastest.', options: [
      { id: 'beginner', label: 'Under a year', sub: 'Still adding weight most weeks' },
      { id: 'middle', label: '1 to 3 years', sub: 'Progress comes slower now' },
      { id: 'advanced', label: '3 years or more', sub: 'Need intensity techniques to keep growing' }] },
    { id: 'goal', title: 'What matters most?', sub: 'One answer. Every plan builds muscle, this sets the emphasis.', options: [
      { id: 'muscle', label: 'Build muscle', sub: 'Size and shape first' },
      { id: 'strength', label: 'Get stronger', sub: 'Bigger squat, bench and deadlift' },
      { id: 'both', label: 'Both, strength and size', sub: 'Powerbuilding' },
      { id: 'lean', label: 'Lose fat, keep muscle', sub: 'Training that fits a diet' },
      { id: 'fitness', label: 'Get back in shape', sub: 'Feel good, build the habit again' }] },
    { id: 'days', title: 'How many days a week can you really train?', sub: 'Pick what you can keep up for months, not a perfect week.', options: [
      { id: '2', label: '2 days' }, { id: '3', label: '3 days' }, { id: '4', label: '4 days' }, { id: '5', label: '5 days' }, { id: '6', label: '6 days' }] },
    { id: 'time', title: 'How long per session?', sub: 'Door to door in the gym.', options: [
      { id: 'short', label: 'Up to 45 minutes', sub: 'Short and sharp' },
      { id: 'medium', label: '45 to 60 minutes' },
      { id: 'long', label: '60 to 90 minutes' },
      { id: 'xl', label: 'More than 90 minutes', sub: 'Time is no problem' }] },
    { id: 'gear', title: 'What do you train with?', sub: 'Every plan can be edited after, but this picks the closest fit.', options: [
      { id: 'full', label: 'A full gym', sub: 'Racks, barbells, cables and machines' },
      { id: 'free', label: 'Mostly free weights', sub: 'Barbell, rack and dumbbells, few machines' },
      { id: 'machine', label: 'Mostly machines and cables', sub: 'Or you prefer them' },
      { id: 'home', label: 'Home: dumbbells and bands', sub: 'No barbell or rack' }] },
    { id: 'split', title: 'Which layout do you like?', sub: 'If you do not know, pick "Choose for me".', options: [
      { id: 'any', label: 'Choose for me' },
      { id: 'fb', label: 'Full body', sub: 'Every muscle every session' },
      { id: 'ul', label: 'Upper / lower', sub: 'Alternate upper and lower days' },
      { id: 'ppl', label: 'Push / pull / legs', sub: 'Classic three-way split' },
      { id: 'bro', label: 'One body part a day', sub: 'Chest day, back day, leg day' }] },
    { id: 'push', title: 'How hard do you like to push a set?', sub: 'Plans differ a lot here.', options: [
      { id: 'easy', label: 'Keep it comfortable', sub: 'A few reps left in the tank, build the habit' },
      { id: 'steady', label: 'Hard but controlled', sub: 'One or two reps short of failure' },
      { id: 'hard', label: 'All the way', sub: 'Failure, drop sets, partials, the works' }] },
    { id: 'focus', title: 'Anything you want to bring up?', sub: 'Pick all that apply. Plans with extra work there score higher.', multi: true, none: 'balanced', options: [
      { id: 'balanced', label: 'Everything, keep it balanced' },
      { id: 'arms', label: 'Arms' }, { id: 'chest', label: 'Chest' }, { id: 'back', label: 'Back' }, { id: 'shoulders', label: 'Shoulders' }, { id: 'legs', label: 'Legs and glutes' }] },
    { id: 'style', title: 'What keeps you going?', sub: 'The feel of the plan.', options: [
      { id: 'simple', label: 'Simple and repeatable', sub: 'Same lifts, add weight, no fuss' },
      { id: 'variety', label: 'Lots of variety', sub: 'Different exercises and rep ranges across the week' },
      { id: 'fast', label: 'Fast and sweaty', sub: 'Supersets and short rests' },
      { id: 'heavy', label: 'Heavy barbell work', sub: 'The big lifts are the point' }] },
    { id: 'schedule', title: 'Do your gym days move around?', sub: 'Some plans care which day is which.', options: [
      { id: 'fixed', label: 'Same days every week' },
      { id: 'moves', label: 'They move around', sub: 'Shift work, travel, kids' }] }
  ];
  const stepsFor = a => QUESTIONS.filter(q => !q.when || q.when(a));

  // ---------- scoring ----------
  function recommend(a, programs) {
    a = a || {}; programs = programs || [];
    const comeback = ['break', 'injury', 'restart'].includes(a.situation);
    const gentle = comeback && (a.situation === 'injury' || a.away === 'long' || a.away === 'medium' || a.situation === 'restart');
    const joints = (a.joints || []).filter(j => j !== 'nothing');
    const focus = (a.focus || []).filter(f => f !== 'balanced');
    const days = +a.days || 0;
    const out = programs.map(p => {
      const t = tagsFor(p), reasons = [], cautions = [];
      // why(text, priority): the most specific reasons (comeback 0, days 1, gear / joints / focus / style 2, split / goal / level 3, time / push / schedule 4) show first.
      const why = (txt, pr) => reasons.push([pr == null ? 3 : pr, txt]);
      let s = 0;
      // 1. Situation
      if (comeback) {
        if (t.comeback) { s += gentle ? 45 : 22; why(a.situation === 'injury' ? 'Built for coming back after an injury: light, form first' : 'Built for coming back after time off: easy first weeks', 0); }
        else if (gentle) { s -= 18; cautions.push('Not a comeback plan: start every lift lighter than you think'); }
        else if (a.away === 'short') { s += 2; }
      } else if (t.comeback) { s -= 30; cautions.push('A comeback plan: too easy if you train steadily'); }
      if (a.situation === 'new') { if (t.lvl.includes('beginner') && t.lvl.length <= 2) { s += 18; why('Made for someone starting out'); } else if (!t.lvl.includes('beginner')) { s -= 22; cautions.push('Written for lifters with a year or more behind them'); } }
      // 2. Level
      if (a.level) {
        if (t.lvl.includes(a.level)) { s += 14; if (a.level === 'advanced' && t.push === 'hard') why('Enough intensity for an experienced lifter'); else if (a.level === 'beginner' && t.lvl.length < 3) why('Beginner-friendly progression'); }
        else if (a.level === 'beginner') { s -= 16; cautions.push('More volume and intensity than a first-year lifter needs'); }
        else { s -= 8; cautions.push(a.level === 'advanced' ? 'A beginner plan: may be too light' : 'Aimed at a different experience level'); }
      }
      // 3. Goal
      if (a.goal) {
        if (a.goal === 'fitness') { if (t.comeback || t.simple) { s += 10; why('Simple sessions that rebuild the habit'); } }
        else if (a.goal === 'lean') { s += (t.split === 'fb' ? 8 : 0) + (t.ss ? 6 : 0); if (t.split === 'fb') why('Full-body days keep every muscle ticking over on a diet'); if (t.push === 'hard' && t.time === 'long') { s -= 4; } }
        else if (t.goal.includes(a.goal)) { s += 18; why(a.goal === 'strength' ? 'Heavy squat, bench and deadlift are the backbone' : a.goal === 'both' ? 'Strength work first, then bodybuilding volume' : 'Pure hypertrophy layout'); }
        else if (a.goal === 'strength' && !t.goal.includes('both')) { s -= 10; cautions.push('Little heavy barbell work for a strength goal'); }
        else if (a.goal === 'muscle' && t.goal.includes('strength') && !t.goal.includes('muscle')) { s -= 6; }
        if (a.goal === 'both' && t.pb) { s += 8; why('A powerbuilding plan by name', 2); }
      }
      // 4. Days
      if (days) {
        const range = t.anyDays || [p.days, p.days];
        if (days >= range[0] && days <= range[1]) { s += 30; why(days + ' days a week, exactly', 1); }
        else { const d = Math.min(Math.abs(days - range[0]), Math.abs(days - range[1])); if (d === 1) { s += 8; cautions.push('Written for ' + p.days + ' days: ' + (days < p.days ? 'you would roll the days over the week' : 'one day would be free or a repeat')); } else { s -= 14 * (d - 1); cautions.push('Needs ' + p.days + ' days, you have ' + days); } }
      }
      // 5. Time
      if (a.time) {
        const d = TIME_RANK[a.time] - TIME_RANK[t.time];
        if (d === 0) { s += 12; why('Sessions fit your ' + ({ short: 'short', medium: '45 to 60 minute', long: '60 to 90 minute', xl: 'long' })[a.time] + ' window', 4); }
        else if (d > 0) { s += 6; }
        else { s -= 10 * -d; cautions.push('Sessions run about ' + p.time + ', longer than you have'); }
      }
      // 6. Equipment and joints
      if (a.gear === 'machine' || a.gear === 'home') {
        if (t.gear === 'barbell') { s -= 24; cautions.push('Leans on barbell lifts: swap them with Exercise swap or pick a machine-friendly plan'); }
        else if (t.gear === 'machine') { s += 14; why('Machine and cable friendly', 2); }
        else s += 4;
        if (a.gear === 'home') { s -= 6; if (t.split === 'fb' || t.simple) s += 4; }
      } else if (a.gear === 'free') { if (t.gear === 'machine') { s -= 10; cautions.push('Uses a lot of machines'); } else if (t.gear === 'barbell') { s += 8; why('Built around free weights', 2); } }
      else if (a.gear === 'full') { s += 4; }
      if (joints.length) {
        if (t.gear === 'barbell') { s -= 8 * joints.length; cautions.push('Heavy barbell work with a sore ' + joints.map(j => ({ shoulder: 'shoulder', back: 'lower back', knee: 'knee', elbow: 'elbow' })[j]).join(' and ') + ': swap those lifts or ease in'); }
        else if (t.push === 'easy' || t.gear === 'machine') { s += 6 * joints.length; why('Gentler on a sore ' + (joints.length > 1 ? 'joint' : ({ shoulder: 'shoulder', back: 'lower back', knee: 'knee', elbow: 'elbow' })[joints[0]]), 2); }
      }
      // 7. Split
      if (a.split && a.split !== 'any') {
        if (t.split === a.split) { s += 16; why('A ' + SPLIT_NAME[a.split] + ' layout, like you asked'); }
        else if (t.split === 'mix') s += 4;
        else { s -= 4; }
      }
      // 8. Intensity
      if (a.push) {
        if (t.push === a.push) { s += 10; if (a.push === 'hard') why('Goes to failure with intensity techniques', 4); else if (a.push === 'easy') why('Stops well short of failure', 4); }
        else if ((a.push === 'easy' && t.push === 'hard') || (a.push === 'hard' && t.push === 'easy')) { s -= 10; cautions.push(a.push === 'easy' ? 'Pushes sets to failure' : 'Deliberately easy sets'); }
      }
      // 9. Focus
      if (focus.length) {
        if (focus.includes('arms') && t.arms) { s += 10; why('Extra arm work', 2); }
        if (focus.includes('legs') && (t.split === 'ul' || t.split === 'ppl' || t.split === 'bro')) { s += 5; why('Dedicated leg days', 2); }
        if ((focus.includes('chest') || focus.includes('back') || focus.includes('shoulders')) && (t.split === 'ppl' || t.split === 'bro' || t.split === 'mix')) { s += 5; why('Whole sessions for the upper body', 2); }
        if (focus.length >= 3 && t.split === 'fb') { s += 4; }
      }
      // 10. Style
      if (a.style === 'simple' && t.simple) { s += 10; why('Few exercises, repeated and progressed', 2); }
      if (a.style === 'variety' && t.variety) { s += 10; why('Different exercises and rep ranges across the week', 2); }
      if (a.style === 'fast') { if (t.ss) { s += 14; why('Supersets and short rests', 2); } else if (t.time === 'long') s -= 4; }
      if (a.style === 'heavy') { if (t.gear === 'barbell') { s += 10; why('The big barbell lifts lead every session', 2); } else if (t.gear === 'machine') s -= 8; }
      // 11. Schedule
      if (a.schedule === 'moves') { if (t.flex) { s += 8; why('Days can move around the week', 4); } else if (p.days >= 5) { s -= 4; cautions.push('Works best on fixed days'); } }
      return { id: p.id, score: s, reasons: uniq(reasons.sort((x, y) => x[0] - y[0]).map(x => x[1])).slice(0, 6), cautions: uniq(cautions).slice(0, 3), program: p };
    });
    out.sort((x, y) => y.score - x.score || x.program.days - y.program.days);
    const top = out.length ? out[0].score : 0, floor = Math.min(0, out.length ? out[out.length - 1].score : 0);
    out.forEach(r => { r.pct = Math.max(5, Math.min(99, Math.round(60 + 39 * ((r.score - floor) / Math.max(1, top - floor)) - (top <= 0 ? 20 : 0)))); });
    return out;
  }
  const uniq = arr => arr.filter((x, i) => arr.indexOf(x) === i);

  // ---------- art ----------
  const svgWrap = inner => '<svg class="gs-art" viewBox="0 0 240 150" aria-hidden="true"><ellipse class="blob" cx="120" cy="84" rx="104" ry="56"/>' + inner + '</svg>';
  const g = (d, inner, cls) => '<g class="p ' + (cls || '') + '" style="--d:' + d + '">' + inner + '</g>';
  // A simple lifter: head, torso, arms holding a bar. x,y = centre of the chest.
  const lifter = (x, y, barY, barW) => '<circle class="ink" cx="' + x + '" cy="' + (y - 26) + '" r="9"/><rect class="ink" x="' + (x - 11) + '" y="' + (y - 14) + '" width="22" height="34" rx="9"/>'
    + '<line class="ink" x1="' + (x - 8) + '" y1="' + (y - 8) + '" x2="' + (x - 26) + '" y2="' + barY + '" stroke-width="6" stroke-linecap="round"/><line class="ink" x1="' + (x + 8) + '" y1="' + (y - 8) + '" x2="' + (x + 26) + '" y2="' + barY + '" stroke-width="6" stroke-linecap="round"/>'
    + '<line class="ink" x1="' + (x - 6) + '" y1="' + (y + 18) + '" x2="' + (x - 10) + '" y2="' + (y + 48) + '" stroke-width="7" stroke-linecap="round"/><line class="ink" x1="' + (x + 6) + '" y1="' + (y + 18) + '" x2="' + (x + 10) + '" y2="' + (y + 48) + '" stroke-width="7" stroke-linecap="round"/>'
    + '<rect class="ink" x="' + (x - barW / 2) + '" y="' + (barY - 3) + '" width="' + barW + '" height="6" rx="3"/><rect class="acc" x="' + (x - barW / 2 - 4) + '" y="' + (barY - 14) + '" width="12" height="28" rx="4"/><rect class="acc" x="' + (x + barW / 2 - 8) + '" y="' + (barY - 14) + '" width="12" height="28" rx="4"/>';
  const calendar = (picked, total) => { let s = ''; for (let i = 0; i < 7; i++) { const on = i < picked; s += '<rect class="' + (on ? 'acc' : 'bg') + '" x="' + (52 + i * 20) + '" y="70" width="16" height="16" rx="4"' + (on ? '' : ' opacity=".9"') + '/>'; if (on) s += '<path class="bg" d="M' + (56 + i * 20) + ' 78 l3 3 l6 -6" stroke-width="2" fill="none" stroke-linecap="round"/>'; } return s; };
  const ART = {
    situation: a => svgWrap(
      g(0, '<ellipse class="ink" cx="120" cy="136" rx="70" ry="5" opacity=".14"/>' + lifter(120, 84, 56, 70))
      + g(1, a.situation === 'injury' ? '<rect class="warn" x="150" y="40" width="40" height="40" rx="10"/><rect class="bg" x="166" y="48" width="8" height="24" rx="2"/><rect class="bg" x="158" y="56" width="24" height="8" rx="2"/>' : a.situation === 'break' || a.situation === 'restart' ? '<rect class="s3" x="150" y="40" width="44" height="40" rx="8"/><rect class="acc" x="150" y="40" width="44" height="10" rx="4"/><line class="ink" x1="158" y1="60" x2="186" y2="60" stroke-width="2" opacity=".5"/><line class="ink" x1="158" y1="70" x2="178" y2="70" stroke-width="2" opacity=".5"/>' : a.situation === 'new' ? '<path class="acc" d="M172 36 l6 14 l15 2 l-11 10 l3 15 l-13 -7 l-13 7 l3 -15 l-11 -10 l15 -2 z"/>' : '<path class="good" d="M150 80 l12 -14 l10 10 l16 -24" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle class="good" cx="188" cy="52" r="4"/>', 'pop')
      + g(2, '<circle class="acc2" cx="40" cy="44" r="4"/><circle class="good" cx="52" cy="112" r="3"/><circle class="acc2" cx="210" cy="112" r="3"/>', 'confetti')),
    away: a => svgWrap(
      g(0, '<circle class="s3" cx="120" cy="84" r="40"/><circle class="bg" cx="120" cy="84" r="32"/><circle class="ink" cx="120" cy="84" r="27" fill="none" stroke-width="2" stroke-dasharray="1.5 6.2" opacity=".4"/>')
      + g(1, '<path class="accs" d="M120 84 L120 54 A30 30 0 ' + (a.away === 'long' ? '1 1 92 72' : a.away === 'medium' ? '0 1 150 84' : '0 1 136 60') + ' Z" fill="var(--accent)" opacity=".35" stroke-width="0"/>')
      + g(2, '<g class="hand"><line class="accs" x1="120" y1="84" x2="120" y2="60" stroke-width="4" stroke-linecap="round"/></g><circle class="ink" cx="120" cy="84" r="4"/>')
      + g(3, '<rect class="acc" x="176" y="56" width="36" height="12" rx="6"/><rect class="acc" x="176" y="74" width="26" height="12" rx="6" opacity=".6"/><rect class="acc" x="176" y="92" width="16" height="12" rx="6" opacity=".35"/>')),
    joints: a => { const j = a.joints || []; const dot = (x, y, id) => '<circle class="' + (j.includes(id) ? 'warn' : 'acc') + '" cx="' + x + '" cy="' + y + '" r="' + (j.includes(id) ? 8 : 5) + '"' + (j.includes(id) ? ' class="warn"' : ' opacity=".55"') + '/>'; return svgWrap(
      g(0, '<ellipse class="ink" cx="120" cy="140" rx="40" ry="4" opacity=".14"/><circle class="ink" cx="120" cy="30" r="11"/><path class="ink" d="M104 46 h32 l6 44 h-44 z"/><line class="ink" x1="106" y1="50" x2="88" y2="92" stroke-width="9" stroke-linecap="round"/><line class="ink" x1="134" y1="50" x2="152" y2="92" stroke-width="9" stroke-linecap="round"/><line class="ink" x1="110" y1="90" x2="106" y2="136" stroke-width="11" stroke-linecap="round"/><line class="ink" x1="130" y1="90" x2="134" y2="136" stroke-width="11" stroke-linecap="round"/>')
      + g(1, dot(106, 52, 'shoulder') + dot(134, 52, 'shoulder') + dot(120, 84, 'back') + dot(107, 114, 'knee') + dot(133, 114, 'knee') + dot(92, 78, 'elbow') + dot(148, 78, 'elbow'), 'pop')); },
    level: a => svgWrap(
      g(0, '<ellipse class="ink" cx="120" cy="138" rx="80" ry="5" opacity=".14"/><rect class="s3" x="52" y="104" width="44" height="30" rx="6"/><rect class="s3" x="98" y="80" width="44" height="54" rx="6"/><rect class="s3" x="144" y="52" width="44" height="82" rx="6"/>')
      + g(1, '<rect class="' + (a.level ? 'acc' : 'accl') + '" x="52" y="104" width="44" height="30" rx="6"' + (a.level ? '' : '') + '/>' + (a.level === 'middle' || a.level === 'advanced' ? '<rect class="acc" x="98" y="80" width="44" height="54" rx="6"/>' : '') + (a.level === 'advanced' ? '<rect class="acc" x="144" y="52" width="44" height="82" rx="6"/>' : ''))
      + g(2, '<circle class="ink" cx="' + (a.level === 'advanced' ? 166 : a.level === 'middle' ? 120 : 74) + '" cy="' + (a.level === 'advanced' ? 30 : a.level === 'middle' ? 58 : 82) + '" r="8"/><rect class="ink" x="' + ((a.level === 'advanced' ? 166 : a.level === 'middle' ? 120 : 74) - 7) + '" y="' + ((a.level === 'advanced' ? 30 : a.level === 'middle' ? 58 : 82) + 10) + '" width="14" height="14" rx="5"/>', 'marker')
      + g(3, '<path class="acc" d="M200 40 l4 9 l10 1 l-7 7 l2 10 l-9 -5 l-9 5 l2 -10 l-7 -7 l10 -1 z"/>', 'spark')),
    goal: a => svgWrap(
      g(0, '<circle class="s3" cx="120" cy="84" r="46"/><circle class="bg" cx="120" cy="84" r="34"/><circle class="acc" cx="120" cy="84" r="22"/><circle class="bg" cx="120" cy="84" r="10"/>')
      + g(1, '<line class="ink" x1="150" y1="54" x2="124" y2="80" stroke-width="4" stroke-linecap="round"/><path class="acc" d="M150 54 l12 -4 l-4 12 z"/><path class="acc" d="M150 54 l-2 -12 l12 4 z" opacity=".7"/>', 'arrow')
      + g(2, a.goal === 'strength' || a.goal === 'both' ? '<rect class="ink" x="178" y="100" width="40" height="6" rx="3"/><rect class="acc" x="174" y="92" width="8" height="22" rx="3"/><rect class="acc" x="214" y="92" width="8" height="22" rx="3"/>' : a.goal === 'lean' ? '<path class="good" d="M184 118 q-16 -20 0 -38 q6 10 10 2 q12 16 -10 36 z"/>' : a.goal === 'fitness' ? '<path class="good" d="M176 116 h10 l6 -12 l8 24 l8 -18 l6 6 h12" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' : '<path class="acc" d="M186 108 c-14 0 -14 -22 0 -22 c4 -8 18 -8 22 0 c14 0 14 22 0 22 z"/>', 'pop')),
    days: a => svgWrap(
      g(0, '<rect class="s3" x="44" y="40" width="152" height="72" rx="12"/><rect class="acc" x="44" y="40" width="152" height="18" rx="9"/><rect class="acc" x="44" y="49" width="152" height="9"/>' + ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => '<text x="' + (60 + i * 20) + '" y="53" font-size="9" font-weight="700" text-anchor="middle" fill="var(--accent-ink,#fff)">' + d + '</text>').join(''))
      + g(1, calendar(+a.days || 0, 7), 'pop')
      + g(2, '<rect class="bg" x="52" y="92" width="136" height="10" rx="5" opacity=".9"/><rect class="acc" x="52" y="92" width="' + (136 * ((+a.days || 0) / 7)) + '" height="10" rx="5"/>')),
    time: a => { const arc = { short: 'M120 84 L120 50 A34 34 0 0 1 149 67 Z', medium: 'M120 84 L120 50 A34 34 0 0 1 154 84 Z', long: 'M120 84 L120 50 A34 34 0 0 1 144 112 Z', xl: 'M120 84 L120 50 A34 34 0 1 1 96 112 Z' }[a.time] || ''; return svgWrap(
      g(0, '<circle class="s3" cx="120" cy="84" r="46"/><circle class="bg" cx="120" cy="84" r="38"/><circle class="ink" cx="120" cy="84" r="32" fill="none" stroke-width="2" stroke-dasharray="1.5 7" opacity=".4"/>')
      + (arc ? g(1, '<path class="acc" d="' + arc + '" opacity=".45"/>', 'pop') : '')
      + g(2, '<g class="hand"><line class="accs" x1="120" y1="84" x2="120" y2="56" stroke-width="4" stroke-linecap="round"/></g><line class="ink" x1="120" y1="84" x2="138" y2="84" stroke-width="3" stroke-linecap="round"/><circle class="ink" cx="120" cy="84" r="4"/>')
      + g(3, '<rect class="ink" x="112" y="30" width="16" height="6" rx="3"/><rect class="ink" x="158" y="40" width="10" height="6" rx="3" transform="rotate(45 163 43)"/>')); },
    gear: a => svgWrap(
      g(0, '<ellipse class="ink" cx="120" cy="138" rx="86" ry="5" opacity=".14"/><rect class="ink" x="62" y="40" width="7" height="96" rx="3"/><rect class="ink" x="150" y="40" width="7" height="96" rx="3"/><rect class="ink" x="62" y="40" width="95" height="7" rx="3"/><rect class="s3" x="58" y="70" width="14" height="6" rx="2"/><rect class="s3" x="147" y="70" width="14" height="6" rx="2"/>')
      + g(1, a.gear === 'machine' ? '<rect class="s3" x="80" y="56" width="60" height="72" rx="10"/><rect class="acc" x="88" y="64" width="44" height="12" rx="4"/><circle class="acc" cx="110" cy="102" r="12"/><rect class="bg" x="106" y="84" width="8" height="18" rx="3"/>' : a.gear === 'home' ? '<rect class="acc" x="84" y="92" width="18" height="30" rx="5"/><rect class="acc" x="118" y="92" width="18" height="30" rx="5"/><rect class="ink" x="100" y="104" width="20" height="6" rx="3"/><path class="accs" d="M84 70 q36 -24 72 0" stroke-width="4" fill="none" stroke-linecap="round"/>' : '<rect class="ink" x="44" y="70" width="132" height="6" rx="3"/><rect class="acc" x="52" y="56" width="12" height="34" rx="4"/><rect class="acc" x="66" y="60" width="9" height="26" rx="3" opacity=".7"/><rect class="acc" x="156" y="56" width="12" height="34" rx="4"/><rect class="acc" x="145" y="60" width="9" height="26" rx="3" opacity=".7"/>', 'pop')
      + g(2, '<rect class="acc2" x="186" y="112" width="34" height="8" rx="4"/><rect class="ink" x="182" y="106" width="8" height="20" rx="3"/><rect class="ink" x="216" y="106" width="8" height="20" rx="3"/>')),
    split: a => { const half = (x, cls) => '<rect class="' + cls + '" x="' + x + '" y="36" width="28" height="48" rx="8"/><rect class="' + cls + '" x="' + (x + 4) + '" y="86" width="20" height="48" rx="7"/>'; const body = (x, up, low) => '<circle class="ink" cx="' + (x + 14) + '" cy="24" r="9"/>' + '<rect class="' + up + '" x="' + x + '" y="36" width="28" height="48" rx="8"/><rect class="' + low + '" x="' + (x + 4) + '" y="86" width="20" height="48" rx="7"/>'; const s = a.split; return svgWrap(
      g(0, body(40, s === 'ul' || s === 'ppl' || s === 'bro' ? 'acc' : 'acc', s === 'ul' || s === 'ppl' || s === 'bro' ? 's3' : 'acc'))
      + g(1, body(106, s === 'ppl' ? 'acc2' : s === 'ul' ? 's3' : s === 'bro' ? 's3' : 'acc', s === 'ul' ? 'acc' : s === 'ppl' || s === 'bro' ? 's3' : 'acc'))
      + g(2, body(172, s === 'ppl' || s === 'bro' ? 's3' : 'acc', s === 'ppl' || s === 'bro' ? 'acc' : 'acc')) + (half ? '' : '')); },
    push: a => svgWrap(
      g(0, '<path class="s3" d="M70 118 A50 50 0 0 1 170 118" stroke-width="16" fill="none" stroke-linecap="round"/>')
      + g(1, '<path class="' + (a.push === 'hard' ? 'bad' : a.push === 'steady' ? 'warn' : 'good') + '" d="M70 118 A50 50 0 0 1 ' + (a.push === 'hard' ? '170 118' : a.push === 'steady' ? '120 68' : '85 83') + '" stroke-width="16" fill="none" stroke-linecap="round"/>', 'pop')
      + g(2, '<g class="needle" style="transform-origin:120px 118px;transform:rotate(' + (a.push === 'hard' ? 80 : a.push === 'steady' ? 0 : -60) + 'deg)"><line class="ink" x1="120" y1="118" x2="120" y2="78" stroke-width="5" stroke-linecap="round"/></g><circle class="ink" cx="120" cy="118" r="7"/><circle class="bg" cx="120" cy="118" r="3"/>')
      + g(3, a.push === 'hard' ? '<path class="bad" d="M196 70 q-14 -18 -2 -36 q4 10 10 4 q10 14 -8 32 z"/>' : '', 'spark')),
    focus: a => { const f = a.focus || []; const m = (id, d) => '<path class="' + (f.includes(id) ? 'acc' : 'accl') + '" d="' + d + '"/>'; return svgWrap(
      g(0, '<circle class="ink" cx="120" cy="24" r="10"/><path class="s3" d="M98 38 h44 l8 56 h-60 z"/><line class="s3" x1="98" y1="42" x2="78" y2="92" stroke-width="11" stroke-linecap="round"/><line class="s3" x1="142" y1="42" x2="162" y2="92" stroke-width="11" stroke-linecap="round"/><line class="s3" x1="108" y1="94" x2="104" y2="140" stroke-width="13" stroke-linecap="round"/><line class="s3" x1="132" y1="94" x2="136" y2="140" stroke-width="13" stroke-linecap="round"/>')
      + g(1, m('chest', 'M102 42 h36 v16 q-18 8 -36 0 z') + m('shoulders', 'M92 38 a9 9 0 1 1 0 .1 z M148 38 a9 9 0 1 1 0 .1 z') + m('arms', 'M86 58 a8 8 0 1 1 0 .1 z M154 58 a8 8 0 1 1 0 .1 z') + m('back', 'M104 62 h32 v26 h-32 z') + m('legs', 'M100 96 h16 v38 h-16 z M124 96 h16 v38 h-16 z'), 'pop')); },
    style: a => svgWrap(
      g(0, '<rect class="s3" x="46" y="44" width="60" height="80" rx="10" transform="rotate(-8 76 84)"/><rect class="bg" x="90" y="40" width="60" height="80" rx="10"/><rect class="s3" x="134" y="44" width="60" height="80" rx="10" transform="rotate(8 164 84)"/>')
      + g(1, a.style === 'fast' ? '<path class="acc" d="M120 54 l-14 30 h12 l-6 28 l22 -36 h-12 l8 -22 z"/>' : a.style === 'heavy' ? '<rect class="ink" x="96" y="78" width="48" height="5" rx="2.5"/><rect class="acc" x="94" y="68" width="8" height="25" rx="3"/><rect class="acc" x="138" y="68" width="8" height="25" rx="3"/>' : a.style === 'variety' ? '<circle class="acc" cx="108" cy="66" r="7"/><rect class="acc2" x="122" y="59" width="14" height="14" rx="3"/><path class="good" d="M108 98 l7 -12 l7 12 z"/><rect class="warn" x="122" y="88" width="14" height="14" rx="7"/>' : '<rect class="acc" x="100" y="60" width="40" height="8" rx="4"/><rect class="acc" x="100" y="76" width="40" height="8" rx="4" opacity=".7"/><rect class="acc" x="100" y="92" width="40" height="8" rx="4" opacity=".45"/>', 'pop')),
    schedule: a => svgWrap(
      g(0, '<rect class="s3" x="44" y="40" width="152" height="72" rx="12"/><rect class="acc" x="44" y="40" width="152" height="18" rx="9"/><rect class="acc" x="44" y="49" width="152" height="9"/>')
      + g(1, a.schedule === 'moves' ? '<rect class="acc" x="52" y="70" width="16" height="16" rx="4" opacity=".35"/><rect class="acc" x="92" y="70" width="16" height="16" rx="4"/><rect class="acc" x="132" y="70" width="16" height="16" rx="4" opacity=".35"/><rect class="acc" x="172" y="70" width="16" height="16" rx="4"/><path class="accs" d="M60 96 q36 20 72 0" stroke-width="3" fill="none" stroke-linecap="round" stroke-dasharray="4 4"/>' : '<rect class="acc" x="52" y="70" width="16" height="16" rx="4"/><rect class="acc" x="92" y="70" width="16" height="16" rx="4"/><rect class="acc" x="132" y="70" width="16" height="16" rx="4"/>', 'pop')),
    result: () => svgWrap(
      g(0, '<ellipse class="ink" cx="120" cy="138" rx="60" ry="5" opacity=".14"/><rect class="ink" x="100" y="118" width="40" height="8" rx="3"/><rect class="ink" x="112" y="100" width="16" height="20" rx="3"/>')
      + g(1, '<path class="acc" d="M86 36 h68 v22 c0 22 -14 36 -34 40 c-20 -4 -34 -18 -34 -40 z"/><path class="accs" d="M86 46 h-14 c0 20 10 26 18 28 M154 46 h14 c0 20 -10 26 -18 28" stroke-width="6" fill="none" stroke-linecap="round"/>', 'pop')
      + g(2, '<path class="bg" d="M120 48 l5 11 l12 1 l-9 8 l3 12 l-11 -6 l-11 6 l3 -12 l-9 -8 l12 -1 z"/>', 'spark')
      + g(3, '<circle class="acc2" cx="40" cy="44" r="4"/><circle class="good" cx="52" cy="112" r="3"/><rect class="warn" x="196" y="40" width="7" height="7" rx="2" transform="rotate(25 199 43)"/><circle class="acc2" cx="206" cy="110" r="3"/>', 'confetti'))
  };

  // ---------- html ----------
  function questionHtml(q, a) {
    const picked = q.multi ? (a[q.id] || []) : a[q.id];
    return '<h2>' + esc(q.title) + '</h2>' + (q.sub ? '<p class="gs-sub">' + esc(q.sub) + '</p>' : '') + '<div class="gs-opts">'
      + q.options.map(o => { const on = q.multi ? picked.includes(o.id) : picked === o.id; return '<button type="button" class="gs-opt" data-pc="pick" data-k="' + q.id + '" data-v="' + esc(o.id) + '" aria-pressed="' + String(on) + '"><span class="gs-radio' + (q.multi ? ' pc-box' : '') + '"></span><span><b>' + esc(o.label) + '</b>' + (o.sub ? '<small>' + esc(o.sub) + '</small>' : '') + '</span></button>'; }).join('') + '</div>';
  }
  function resultHtml(recs, a, added) {
    const top = recs.slice(0, 3);
    if (!top.length) return '<h2>No programs to choose from</h2>';
    const best = top[0];
    return '<h2>' + (best.pct >= 85 ? 'Found your match' : best.pct >= 70 ? 'Your best fit' : 'The closest fit') + '</h2><p class="gs-sub">' + esc(summary(a)) + '</p>'
      + top.map((r, i) => { const p = r.program, isAdded = added && added(p.id); return '<div class="pc-card' + (i === 0 ? ' best' : '') + '"><div class="pc-top"><span class="pc-rank">' + (i === 0 ? 'Best match' : i === 1 ? 'Runner-up' : 'Also fits') + '</span><span class="pc-pct">' + r.pct + '% match</span></div>'
        + '<b class="pc-name">' + esc(p.name.replace(/^.*· /, '')) + '</b><small class="pc-meta">' + esc(p.name.split(' · ')[0]) + ' · ' + esc(p.level) + ' · ' + p.days + ' days · ' + esc(p.time) + '</small>'
        + (r.reasons.length ? '<ul class="pc-why">' + r.reasons.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '')
        + (r.cautions.length ? '<ul class="pc-but">' + r.cautions.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '')
        + '<div class="pc-row"><button type="button" class="btn' + (i === 0 ? '' : ' ghost') + '" data-pc="add" data-id="' + esc(p.id) + '">' + (isAdded ? 'Add again' : 'Add to my templates') + '</button><button type="button" class="btn ghost" data-pc="preview" data-id="' + esc(p.id) + '">See the days</button></div></div>'; }).join('');
  }
  function summary(a) {
    const bits = [];
    if (a.situation === 'injury') bits.push('back from an injury'); else if (a.situation === 'break' || a.situation === 'restart') bits.push('back after time off'); else if (a.situation === 'new') bits.push('just starting');
    if (a.days) bits.push(a.days + ' days a week');
    if (a.time) bits.push(({ short: 'short sessions', medium: '45 to 60 minutes', long: '60 to 90 minutes', xl: 'long sessions' })[a.time]);
    if (a.goal) bits.push(({ muscle: 'muscle first', strength: 'strength first', both: 'strength and size', lean: 'fat loss', fitness: 'back in shape' })[a.goal]);
    if (a.gear === 'machine') bits.push('machines'); else if (a.gear === 'home') bits.push('home gym');
    return bits.length ? 'Based on: ' + bits.join(', ') + '.' : 'Based on your answers.';
  }

  const css = `
.gs-wrap.pc-wrap{z-index:1200}
.pc-wrap .gs-dots{flex-wrap:wrap;gap:5px}
.pc-wrap .gs-dots i{width:7px;height:7px}
.pc-wrap .gs-dots i.on{width:20px}
.pc-wrap .gs-dots i.done{background:var(--accent);opacity:.45}
.pc-box{border-radius:6px!important}
.gs-opt[aria-pressed="true"] .pc-box::after{border-radius:2px!important}
.pc-card{background:var(--surface);border:1px solid var(--card-line,var(--line));border-radius:16px;padding:14px;display:flex;flex-direction:column;gap:6px;box-shadow:var(--shadow-card,none)}
.pc-card.best{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent) inset}
.pc-top{display:flex;justify-content:space-between;align-items:center;gap:8px}
.pc-rank{font-size:.72rem;letter-spacing:.1em;text-transform:uppercase;font-weight:700;color:var(--muted)}
.pc-card.best .pc-rank{color:var(--accent)}
.pc-pct{font-weight:800;font-size:1.1rem;font-variant-numeric:tabular-nums}
.pc-card.best .pc-pct{color:var(--accent)}
.pc-name{font-size:1.15rem;line-height:1.2}
.pc-meta{color:var(--muted);font-size:.84rem}
.pc-why,.pc-but{margin:4px 0 0;padding-left:18px;font-size:.9rem;display:flex;flex-direction:column;gap:3px}
.pc-why li::marker{content:"✓  ";color:var(--good)}
.pc-but{color:var(--muted)}
.pc-but li::marker{content:"!  ";color:var(--warn)}
.pc-row{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px}
.pc-row .btn{padding:11px 10px;font-size:.95rem;border-radius:12px}
.gs-foot .btn[disabled]{opacity:.45}
.pc-count{color:var(--muted);font-size:.8rem;text-align:center;margin:-8px 0 0}
`;

  // ---------- the screen ----------
  function open(opts) {
    opts = opts || {};
    const doc = opts.document || (typeof document !== 'undefined' ? document : null);
    if (!doc) throw new Error('ProgramChooser.open needs a document');
    const programs = opts.programs || [];
    const a = Object.assign({}, opts.answers || {});
    let step = 0, dirCls = '', recs = null, unBack = null, closed = false, autoT = null;
    const el = doc.createElement('div'); el.className = 'gs-wrap pc-wrap'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Help me choose a program');
    const steps = () => stepsFor(a).concat([{ id: 'result' }]);
    const cur = () => steps()[step];
    const answered = q => q.multi ? !!(a[q.id] && a[q.id].length) : a[q.id] != null;
    const dots = () => { const st = steps(); return '<div class="gs-dots" aria-hidden="true">' + st.map((s, i) => '<i class="' + (i === step ? 'on' : i < step ? 'done' : '') + '"></i>').join('') + '</div>'; };
    function body() {
      const q = cur();
      if (q.id === 'result') { recs = recommend(a, programs); return resultHtml(recs, a, opts.added); }
      return questionHtml(q, a) + '<p class="pc-count">Question ' + (step + 1) + ' of ' + (steps().length - 1) + '</p>';
    }
    function foot() {
      const q = cur();
      if (q.id === 'result') return '<button type="button" class="btn ghost" data-pc="back">Change my answers</button><button type="button" class="gs-skip" data-pc="close">See all programs instead</button>';
      return '<button type="button" class="btn" data-pc="next"' + (answered(q) ? '' : ' disabled') + '>' + (steps()[step + 1].id === 'result' ? 'Show my match' : 'Next') + '</button>' + (step === 0 ? '<button type="button" class="gs-skip" data-pc="close">I will pick myself</button>' : '');
    }
    function paint() {
      const q = cur(), art = ART[q.id];
      el.innerHTML = '<div class="gs-head">' + (step > 0 ? '<button type="button" class="gs-back" data-pc="back" aria-label="Back">‹</button>' : '<span></span>') + dots() + '<button type="button" class="gs-x" data-pc="close" aria-label="Close">×</button></div>'
        + '<div class="gs-body ' + (dirCls || '') + '">' + (art ? art(a) : '') + body() + '</div><div class="gs-foot">' + foot() + '</div>';
      el.querySelectorAll('.gs-opt, .pc-card').forEach((n, i) => { n.classList.add('gs-rise'); n.style.setProperty('--i', String(Math.min(i, 8))); });
      const b = el.querySelector('.gs-body'); if (b) b.scrollTop = 0;
    }
    function repaintArt() { const q = cur(), art = ART[q.id]; const old = el.querySelector('.gs-art'); if (old && art) { const tmp = doc.createElement('div'); tmp.innerHTML = art(a); old.replaceWith(tmp.firstChild); } const n = el.querySelector('[data-pc="next"]'); if (n) n.disabled = !answered(q); }
    function close(reason) {
      if (closed) return; closed = true; clearTimeout(autoT);
      if (unBack) { try { unBack(); } catch (e) { } }
      if (el.parentNode) el.parentNode.removeChild(el);
      if (opts.onClose) opts.onClose(reason, Object.assign({}, a));
    }
    el.addEventListener('click', e => {
      const t = e.target.closest('[data-pc]'); if (!t) return;
      const act = t.dataset.pc;
      if (act === 'pick') {
        const q = cur(), k = t.dataset.k, v = t.dataset.v;
        if (q.multi) {
          let list = (a[k] || []).slice();
          if (v === q.none) list = [v]; else { list = list.filter(x => x !== q.none); list = list.includes(v) ? list.filter(x => x !== v) : list.concat([v]); }
          a[k] = list;
          el.querySelectorAll('[data-pc="pick"][data-k="' + k + '"]').forEach(b => b.setAttribute('aria-pressed', String(list.includes(b.dataset.v))));
          repaintArt();
        } else {
          a[k] = v;
          // Answers that no longer apply go when the situation changes (the away step only shows for a comeback).
          if (k === 'situation' && !['break', 'injury', 'restart'].includes(v)) delete a.away;
          el.querySelectorAll('[data-pc="pick"][data-k="' + k + '"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
          repaintArt();
          clearTimeout(autoT); autoT = setTimeout(() => { const n = el.querySelector('[data-pc="next"]'); if (n && !n.disabled) n.click(); }, 320);
        }
        return;
      }
      clearTimeout(autoT);
      if (act === 'next') { if (!answered(cur())) return; step = Math.min(step + 1, steps().length - 1); dirCls = 'gs-in-r'; paint(); return; }
      if (act === 'back') { step = Math.max(0, step - 1); dirCls = 'gs-in-l'; paint(); return; }
      if (act === 'close') { close('close'); return; }
      if (act === 'add') { const id = t.dataset.id; if (opts.onPick) opts.onPick(id, Object.assign({}, a)); close('pick'); return; }
      if (act === 'preview') { const id = t.dataset.id; if (opts.onPreview) { close('preview'); opts.onPreview(id, Object.assign({}, a)); } return; }
    });
    paint();
    (opts.mount || doc.body).appendChild(el);
    if (opts.onBack) { try { unBack = opts.onBack(() => { if (closed) return false; if (step > 0) { const b = el.querySelector('[data-pc="back"]'); if (b) b.click(); } else close('close'); return true; }); } catch (e) { } }
    return { el, close: () => close('close'), state: () => Object.assign({ step }, a) };
  }

  return { QUESTIONS, TAGS, stepsFor, recommend, questionHtml, resultHtml, summary, open, css };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = ProgramChooser;
