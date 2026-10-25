// Inlines MenuImport into the app and swaps the Food tab's "Pick my meals" card for "Plan my day from a menu".
// Usage: node modules/menu-import/apply-to-app.js <app.html> [out.html]
// It also re-inlines tools/meal-picker/picker-engine.js when the app still has the old copy.
// Each step is an exact-text replacement; it stops with an error if the app has drifted.
const fs = require('fs');
const path = require('path');
const [src, out = src] = process.argv.slice(2);
if (!src) { console.error('usage: node apply-to-app.js <app.html> [out.html]'); process.exit(1); }
let html = fs.readFileSync(src, 'utf8');
const mod = fs.readFileSync(path.join(__dirname, 'menu-import.js'), 'utf8');

function swap(oldStr, newStr, label) {
  const n = html.split(oldStr).length - 1;
  if (n !== 1) throw new Error(label + ': expected 1 match, found ' + n);
  html = html.replace(oldStr, () => newStr);
}

if (html.includes('root.MenuImport = factory()')) throw new Error('MenuImport is already inlined');

// 0. Re-inline the picker engine (the card needs its `snacks` and `targets` options).
if (!html.includes('targetsFrom')) {
  const engine = fs.readFileSync(path.join(__dirname, '../../tools/meal-picker/picker-engine.js'), 'utf8');
  const start = html.indexOf('/*\n * Nutreeze daily meal picker engine.');
  const endMark = 'else root.NutreezePicker = factory();';
  const tail = html.indexOf('\n});\n', html.indexOf(endMark, start));
  const close = html.indexOf('</script>', start);
  if (start < 0 || tail < 0 || tail > close) throw new Error('picker engine: inlined copy not found');
  html = html.slice(0, start) + engine.replace(/\s*$/, '\n') + html.slice(tail + '\n});\n'.length);
  if (!html.includes('targetsFrom')) throw new Error('picker engine: re-inline failed');
}

// 1. The module, as its own script just before the app's main script.
swap('<script>\n/* ===================== Plan data', '<script>\n' + mod + '</script>\n<script>\n/* ===================== Plan data', 'inline module');

// 2. A synced `menus` collection: one Nutreeze-format record per date (docs/nutreeze-menu-format.md).
swap('const COLS = ["days",', 'const COLS = ["menus","days",', 'COLS');
swap('const S = {docs:{days:{},', 'const S = {docs:{menus:{},days:{},', 'S.docs');

// 3. The card replaces "Pick my meals" (it also takes pasted text, so nothing is lost).
swap('  ${pickerCard(d, training)}', '  ${window.MenuImport ? MenuImport.html(d) : pickerCard(d, training)}', 'Food card');

// 4. CSS + events once at boot. pdf.js loads from cdnjs only when a PDF is uploaded.
swap('initStore();\n</script>', `try{
  const st=document.createElement("style"); st.textContent=MenuImport.css; document.head.appendChild(st);
  const PDFJS="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
  const addScript=src=>new Promise((ok,bad)=>{ const s=document.createElement("script"); s.src=src; s.onload=ok; s.onerror=bad; document.head.appendChild(s); });
  let pdfP=null;
  const loadPdf=()=>pdfP||(pdfP=(async()=>{
    // The worker script runs on the page (cross-origin workers are blocked), so pdf.js uses it in-thread.
    await addScript(PDFJS+"pdf.min.js"); await addScript(PDFJS+"pdf.worker.min.js");
    window.pdfjsLib.GlobalWorkerOptions.workerSrc=PDFJS+"pdf.worker.min.js";
    return window.pdfjsLib;
  })().catch(()=>{ pdfP=null; return null; }));
  const menuTargets=d=>{
    const k=typeof kcalTarget==="function"?kcalTarget(d):null;
    // The shell's resolved targets (APPT, v16+) when present; otherwise resolve from the profile here.
    if(typeof APPT!=="undefined" && APPT && window.AppTargets) return k?AppTargets.forKcal(APPT,k):APPT;
    if(window.AppTargets && AppTargets.resolve){
      const E=NutreezePicker.TARGETS;
      const t=AppTargets.resolve((S.docs.prefs.main||{}).profile,{kcal:E.kcal,proteinMin:E.proteinMin,proteinMax:E.proteinMax,fatLo:E.fat[0],fatHi:E.fat[1],carbsLo:E.carbs[0],carbsHi:E.carbs[1]});
      return k?AppTargets.forKcal(t,k):t;
    }
    return k?{kcal:k}:null;
  };
  MenuImport.bind(document, {
    engine: NutreezePicker,
    getSample: () => window.claude && window.claude.use ? window.claude.use("sample").catch(()=>null) : Promise.resolve(null),
    loadPdf,
    getMenu: d => S.docs.menus[d] || null,
    saveMenu: (d, rec) => rec ? put("menus", d, rec, {quiet:true}) : remove("menus", d),
    dayType: pickerDayType,
    dislikes: () => (S.docs.prefs.main && S.docs.prefs.main.dislikes) || [],
    targets: menuTargets,
    date: () => view.date, render, toast,
    onUsePlan(d, plan, fixed){
      const unsure=new Set([plan.meal1,plan.meal2,...plan.snacks].filter(x=>x.needsCheck).map(x=>x.name));
      const items = NutreezePicker.toFoodItems(plan, fixed).map(it=>({...it, id:uid(), slot:SLOT_MAP[it.slot]||it.slot, eaten:false, est:it.est||unsure.has(it.name)}));
      const day=getDay(d);
      day.food = day.food.filter(x=>x.eaten).concat(items.filter(it=>!day.food.some(x=>x.eaten && x.name===it.name)));
      saveDay(day); toast("Planned. Tick items as you eat them; only ticked items count.");
    }
  });
}catch(e){}
initStore();
</script>`, 'boot');

fs.writeFileSync(out, html);
console.log('Patched ' + src + ' -> ' + out);
