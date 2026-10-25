// Inlines DailyDashboard into the app: "Today at a glance" at the top of Today, the calendar under the daily score.
// Usage: node modules/daily-dashboard/apply-patch.js <app.html> [out.html]
// Each step is an exact-text replacement; it stops with an error if the app has drifted.
const fs = require('fs');
const path = require('path');
const [src, out = src] = process.argv.slice(2);
let html = fs.readFileSync(src, 'utf8');
const mod = fs.readFileSync(path.join(__dirname, 'daily-dashboard.js'), 'utf8');

function swap(oldStr, newStr, label) {
  const n = html.split(oldStr).length - 1;
  if (n !== 1) throw new Error(label + ': expected 1 match, found ' + n);
  html = html.replace(oldStr, () => newStr);
}

if (html.includes('const DailyDashboard = (() =>')) throw new Error('DailyDashboard is already inlined');

// 1. Inline the module just before the app's main script.
swap('<script>\n/* ===================== Plan data', '<script>\n' + mod + '</script>\n<script>\n/* ===================== Plan data', 'inline module');

// 2. Options built from the app's own targets and rotation.
swap('/* ---------- TODAY ---------- */\nfunction vToday(){',
  '/* ---------- TODAY ---------- */\n' +
  'function ddTargets(){ const plan={kcal:TARGET.kcal, proteinMin:TARGET.pMin, proteinMax:TARGET.pMax}; try{ return window.AppTargets ? AppTargets.resolve(S.docs.prefs.main?.profile||{}, plan) : plan; }catch(e){ return plan; } }\n' +
  'function ddOpts(){ return {today:TODAY, selected:view.date, targets:ddTargets(), kcalTarget:kcalTarget, waterGoal:(d,training)=>training?3500:3000, rotation:ROTATION, sessionFor:x=>sessionFor(x), exerciseCount:s=>(PROGRAM[s]||[]).length||null, lbWorkouts:S.docs.lb_workouts, readiness:window.RecoveryFatigue?(x=>RecoveryFatigue.readiness(S.docs,{date:x})):undefined}; }\n' +
  'function ddGlance(d){ try{ return window.DailyDashboard ? DailyDashboard.glanceHtml(S.docs, d, ddOpts()) : ""; }catch(e){ return ""; } }\n' +
  'function ddCalendar(d){ try{ return window.DailyDashboard ? DailyDashboard.calendarHtml(S.docs, view.calYm||d.slice(0,7), ddOpts()) : ""; }catch(e){ return ""; } }\n' +
  'function vToday(){', 'helpers');

// 3. Glance first on Today, calendar right after the daily score.
swap('  return `\n  <section class="grid">\n    <div class="card hero">\n      <div class="spread"><span class="label">${DAYTYPE_LABEL[type]}</span>', '  return `\n  ${ddGlance(d)}\n  <section class="grid">\n    <div class="card hero">\n      <div class="spread"><span class="label">${DAYTYPE_LABEL[type]}</span>', 'glance');
swap('  ${window.DailyScore?DailyScore.html(S.docs, d, {today:TODAY, sessionFor:x=>sessionFor(x)?.session}):""}\n',
  '  ${window.DailyScore?DailyScore.html(S.docs, d, {today:TODAY, sessionFor:x=>sessionFor(x)?.session}):""}\n  ${ddCalendar(d)}\n', 'calendar');

// 4. Taps: open a day, change month, jump to an input.
swap('  if(a==="gotrain"){ view.tab="train"; render(); window.scrollTo(0,0); }',
  '  if(a==="caldate"){ view.date=el.dataset.d; view.calYm=null; render(); window.scrollTo(0,0); return; }\n' +
  '  if(a==="calmonth"){ view.calYm=el.dataset.ym; render(); return; }\n' +
  '  if(a==="dd-focus"){ const t=document.getElementById(el.dataset.target); if(t){ t.scrollIntoView({behavior:"smooth",block:"center"}); t.focus({preventScroll:true}); } return; }\n' +
  '  if(a==="gotrain"){ view.tab="train"; render(); window.scrollTo(0,0); }', 'click handlers');

// 5. Styles.
swap('["BudgetRecovery","DailyScore","GoalDate","Ramadan","TrendTDEE","DietBreak"].forEach(',
  '["BudgetRecovery","DailyScore","GoalDate","Ramadan","TrendTDEE","DietBreak","DailyDashboard"].forEach(', 'css');

fs.writeFileSync(out, html);
console.log('Patched ' + src + ' -> ' + out);
