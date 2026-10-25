// Inlines SavedMeals into the app and wires the "Saved meals" card on the Food tab.
// Usage: node modules/saved-meals/apply-patch.js <app.html> [out.html]
// Each step is an exact-text replacement; it stops with an error if the app has drifted.
const fs = require('fs');
const path = require('path');
const [src, out = src] = process.argv.slice(2);
let html = fs.readFileSync(src, 'utf8');
const mod = fs.readFileSync(path.join(__dirname, 'saved-meals.js'), 'utf8');

function swap(oldStr, newStr, label) {
  const n = html.split(oldStr).length - 1;
  if (n !== 1) throw new Error(label + ': expected 1 match, found ' + n);
  html = html.replace(oldStr, () => newStr);
}

if (html.includes('root.SavedMeals = factory()')) throw new Error('SavedMeals is already inlined');

// 1. Inline the module just before the app's main script.
swap('<script>\n/* ===================== Plan data', '<script>\n' + mod + '</script>\n<script>\n/* ===================== Plan data', 'inline module');

// 2. Sync the new `meals` collection like the others.
swap('const COLS = ["days","weights","workouts","prefs"];', 'const COLS = ["days","weights","workouts","prefs","meals"];', 'COLS');
swap('const S = {docs:{days:{},weights:{},workouts:{},prefs:{}}', 'const S = {docs:{days:{},weights:{},workouts:{},prefs:{},meals:{}}', 'S.docs');

// 3. The card, right under the add form so it is the first thing on the Food tab.
swap('  </section>\n  ${pickerCard(d, training)}', '  </section>\n  ${window.SavedMeals?SavedMeals.cardHTML(S.docs.meals,{day}):""}\n  ${pickerCard(d, training)}', 'Food card');

// 4. Taps: one-tap add, delete with confirm.
swap('  else if(a==="delfood"){',
  '  else if(a==="meal-add"){ const m=S.docs.meals[el.dataset.id]; if(!m) return; const r=SavedMeals.applyToDay(getDay(d),m,{uid}); put("meals",m.id,SavedMeals.markUsed(m),{quiet:true}); if(r.added.length){ saveDay(r.day); toast("Added "+m.name+(r.skipped.length?" ("+r.skipped.length+" already on the day)":"")+". Tick items as you eat them."); } else toast("Everything in "+m.name+" is already on this day"); }\n' +
  '  else if(a==="meal-del"){ if(el.dataset.confirm){ remove("meals",el.dataset.id); } else { el.dataset.confirm="1"; el.textContent="Delete?"; el.classList.add("confirm"); } }\n' +
  '  else if(a==="delfood"){', 'click handlers');

// 5. Save the selected day's food as a combo.
swap('  else if(f==="dislike"){',
  '  else if(f==="meal-save"){ const nm=document.getElementById("mealName").value; const m=SavedMeals.fromItems(getDay(d).food,{name:nm,existing:S.docs.meals}); if(!m) return; document.activeElement.blur(); put("meals",m.id,m); toast("Saved "+m.name+". Add it to any day with one tap."); }\n' +
  '  else if(f==="dislike"){', 'submit handler');

fs.writeFileSync(out, html);
console.log('Patched ' + src + ' -> ' + out);
