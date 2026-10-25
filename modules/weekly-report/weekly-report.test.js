// Run: node weekly-report.test.js  (loads the browser-style module into a sandbox)
const assert = require("assert");
const fs = require("fs"), vm = require("vm");
const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + "/weekly-report.js", "utf8") + "\nthis.WR = WeeklyReport;", ctx);
const WR = ctx.WR;
let n = 0; const t = (name, fn) => { fn(); n++; console.log("ok", name); };

const eat = (kcal, p) => ({ food: [{ name: "x", kcal, p, eaten: true }] });
const docs = { days: {}, weights: {} };
for (let i = 0; i < 7; i++) { const d = "2026-10-" + (25 + i); docs.days[d] = eat(2000, 165); docs.weights[d] = { kg: 91.5 - i * 0.1 }; }

t("plan defaults unchanged", () => {
  const r = WR.build(docs, { today: "2026-10-31", week: 0 });
  assert.strictEqual(r.s.proHit, 7);
  assert.ok(WR.html(docs, { today: "2026-10-31", week: 0 }).includes("Target 2,000 kcal and 160–170 g protein"));
  assert.ok(r.verdict.some(v => /Keep 2,000 kcal\. The calorie review comes after Nov 7/.test(v[2])));
});

t("targets option changes protein hits, labels and review date", () => {
  const tg = { kcal: 2200, kcalLo: 2050, kcalHi: 2350, proteinMin: 170, proteinMax: 180, goalKg: 78, start: "2026-10-25", reviewDate: "2026-11-07" };
  const r = WR.build(docs, { today: "2026-10-31", week: 0, targets: tg });
  assert.strictEqual(r.s.proHit, 0, "165 g is below 170");
  assert.strictEqual(r.s.onTarget, 0, "2,000 is below 2,050");
  const h = WR.html(docs, { today: "2026-10-31", week: 0, targets: tg });
  assert.ok(h.includes("Target 2,200 kcal and 170–180 g protein") && h.includes("Protein ≥ 170 g"));
});

t("start date moves week 0 and the review", () => {
  WR.setTargets({ start: "2026-10-28" });
  assert.strictEqual(WR.weekOf("2026-10-28"), 0);
  assert.strictEqual(WR.START, "2026-10-28");
  const r = WR.build(docs, { today: "2026-10-31" });
  assert.ok(r.verdict.some(v => /after Nov 10/.test(v[2])));
  WR.setTargets(null);
  assert.strictEqual(WR.START, "2026-10-25");
});

console.log(n + " tests passed");
