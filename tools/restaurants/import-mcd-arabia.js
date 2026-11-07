#!/usr/bin/env node
/* Fill the McDonald's Kuwait block of modules/food-library/restaurants.json from the official McDonald's Arabia
 * nutrition PDF (linked from https://www.mcdonalds.com/kw/en-kw/about-our-food/nutrition-calculator.html).
 *
 *   pdftotext -layout nutrition-info-jeddah-en-new.pdf mcd.txt
 *   node tools/restaurants/import-mcd-arabia.js mcd.txt [--cols name,serving_g,kcal,f,satfat,transfat,chol,sodium,c,fiber,sugar,p] [--dry]
 *
 * The parser takes every line that ends in a run of numbers and maps the numbers onto --cols (defaults to the
 * usual McDonald's table order: serving g, calories, fat, saturated fat, trans fat, cholesterol, sodium, carbs,
 * fibre, sugars, protein). Check the header line of the text first and pass --cols if the order differs.
 * Nothing is estimated: a cell that is "-" or missing stays null. Sections (Breakfast, Burgers, Meals…) come from
 * the nearest all-caps heading; "Meal" items get kind:"meal". Review the written items before committing.
 */
const fs = require("fs"), path = require("path");
const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith("--"));
if (!file) { console.error("usage: import-mcd-arabia.js <pdftotext output> [--cols a,b,c] [--dry]"); process.exit(1); }
const colsArg = (args.find(a => a.startsWith("--cols=")) || "").slice(7) || (args.includes("--cols") ? args[args.indexOf("--cols") + 1] : "");
const COLS = (colsArg || "serving_g,kcal,f,satfat,transfat,chol,sodium,c,fiber,sugar,p").split(",").map(s => s.trim());
const dry = args.includes("--dry");
const text = fs.readFileSync(file, "utf8");
const num = s => s === "-" || s === "–" || s === "" ? null : (isFinite(parseFloat(s.replace(",", "."))) ? parseFloat(s.replace(",", ".")) : null);
const items = []; let section = "";
for (const raw of text.split(/\r?\n/)) {
  const line = raw.replace(/\s+/g, " ").trim(); if (!line) continue;
  if (/^[A-Z][A-Z &'’\-]{3,}$/.test(line) && !/\d/.test(line)) { section = line; continue; }
  const m = /^(.*?[A-Za-z®™'’\)])\s+((?:(?:[\d.,]+|[-–])\s*){3,})$/.exec(line);
  if (!m) continue;
  const name = m[1].replace(/\s+/g, " ").trim(); const nums = m[2].trim().split(/\s+/);
  if (nums.length < 3 || /^(Item|Menu|Serving|Nutrition)/i.test(name)) continue;
  const row = { name, section };
  COLS.forEach((c, i) => { if (c && i < nums.length) row[c] = num(nums[i]); });
  if (row.kcal == null && row.p == null) continue;
  items.push(row);
}
if (!items.length) { console.error("No rows with numbers found. Check the text with `head -40` and pass --cols."); process.exit(2); }
const slug = s => s.toLowerCase().replace(/®|™/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const today = new Date().toISOString().slice(0, 10);
const out = items.map(r => {
  const isMeal = /\bmeal\b/i.test(r.name) || /meal/i.test(r.section);
  const o = { id: slug(r.name), name: r.name, category: r.section ? r.section.charAt(0) + r.section.slice(1).toLowerCase() : null, kind: isMeal ? "meal" : "item", unit: isMeal ? "meal" : (/drink|cola|juice|milk|coffee|latte|shake|tea|water|sprite|fanta/i.test(r.name) ? "drink" : "serving"),
    serving_g: r.serving_g != null ? r.serving_g : null, kcal: r.kcal, p: r.p != null ? r.p : null, c: r.c != null ? r.c : null, f: r.f != null ? r.f : null, fiber: r.fiber != null ? r.fiber : null, sugar: r.sugar != null ? r.sugar : null, sodium: r.sodium != null ? r.sodium : null,
    includes: isMeal ? ["See the menu: a meal is the sandwich with fries and a drink; sizes as printed in the table"] : [], retrievedAt: today };
  return o;
});
console.log(out.length + " items parsed" + (section ? "" : " (no section headings found)"));
console.table(out.slice(0, 8).map(o => ({ name: o.name, kind: o.kind, g: o.serving_g, kcal: o.kcal, p: o.p, c: o.c, f: o.f })));
if (dry) process.exit(0);
const target = path.join(__dirname, "../../modules/food-library/restaurants.json");
const data = JSON.parse(fs.readFileSync(target, "utf8"));
const block = data.restaurants.find(r => r.id === "mcd-kw");
block.items = out; block.source.retrievedAt = today; block.source.note = "McDonald's Arabia nutrition table (the Kuwait site's own nutrition page links it; it says the information is current as of 2017). Imported with tools/restaurants/import-mcd-arabia.js.";
fs.writeFileSync(target, JSON.stringify(data, null, 2) + "\n");
console.log("wrote " + target + "; now run node build/build.js");
