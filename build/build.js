#!/usr/bin/env node
/* Builds app/index.html from build/shell.html + the modules listed in build/modules.json.
 *
 *   node build/build.js          write app/index.html
 *   node build/build.js --check  exit 1 if the committed app/index.html differs from the build
 *
 * The shell holds everything that is not a module: <head>, CSS, markup and the last <script>
 * block (plan data, store, render, events). The line `<!-- @modules -->` in the shell marks
 * where the module <script> blocks go. Edit modules/* or build/shell.html, never app/index.html.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SHELL = path.join(ROOT, "build/shell.html");
const MANIFEST = path.join(ROOT, "build/modules.json");
const OUT = path.join(ROOT, "app/index.html");
const MARKER = "<!-- @modules -->";

function read(p) { return fs.readFileSync(path.join(ROOT, p), "utf8"); }

// Turns one manifest entry into the JS that sits between <script> and </script>.
function moduleBody(entry) {
  let src = read(entry.file);
  if (entry.json) {
    src = "window." + entry.json + "=" + JSON.stringify(JSON.parse(src), null, 2) + ";";
  } else if (entry.esm) {
    const names = [...src.matchAll(/^export (?:const|let|var|function|class|async function) (\w+)/gm)].map(m => m[1]);
    if (!names.length) throw new Error(entry.file + ": esm wrap found no exports");
    if (/^export (default|\{)/m.test(src)) throw new Error(entry.file + ": only named declaration exports are supported");
    src = "window." + entry.esm + "=(function(){\n" + src.replace(/^export /gm, "").replace(/\s+$/, "") +
      "\n\nreturn {" + names.join(",") + "};\n})();";
  } else if (entry.expose) {
    for (const name of entry.expose) {
      const decl = new RegExp("^const " + name + " =", "m");
      if (decl.test(src)) src = src.replace(decl, () => "window." + name + " =");
      else src = src.replace(/\s+$/, "") + "\n\nwindow." + name + "=" + name + ";";
    }
  }
  if (/<\/script/i.test(src)) throw new Error(entry.file + ": contains </script>, which would end the inline block early");
  return src.replace(/\s+$/, "") + "\n";
}

function build() {
  const shell = fs.readFileSync(SHELL, "utf8");
  if (shell.split(MARKER).length !== 2) throw new Error("build/shell.html must contain exactly one " + MARKER);
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8")).modules;
  const blocks = manifest.map(entry => "<script>\n" + moduleBody(entry) + "</script>");
  return { html: shell.replace(MARKER, () => blocks.join("\n")), manifest };
}

// Names the first module (or the shell) whose text differs, so the fix is one grep away.
function describeDiff(built, committed, manifest) {
  const re = /<script>\n([\s\S]*?)<\/script>/g;
  const a = [...built.matchAll(re)].map(m => m[1]);
  const b = [...committed.matchAll(re)].map(m => m[1]);
  if (a.length !== b.length) return `block count differs: build has ${a.length} <script> blocks, app/index.html has ${b.length}`;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      const name = i < manifest.length ? manifest[i].file : "the shell script block";
      const la = a[i].split("\n"), lb = b[i].split("\n");
      let l = 0; while (l < la.length && l < lb.length && la[l] === lb[l]) l++;
      return `${name} differs from the app copy (first difference at line ${l + 1} of the block)`;
    }
  }
  return "the markup/CSS outside the <script> blocks differs";
}

if (require.main === module) {
  const check = process.argv.includes("--check");
  const { html, manifest } = build();
  if (check) {
    const committed = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
    if (committed === html) { console.log("ok: app/index.html matches the build (" + manifest.length + " modules)"); process.exit(0); }
    console.error("app/index.html does not match the build: " + describeDiff(html, committed, manifest));
    console.error("If the modules or build/shell.html are right, run `node build/build.js` and commit.");
    console.error("If app/index.html was edited by hand, run `node build/extract-shell.js` first, then build.");
    process.exit(1);
  }
  fs.writeFileSync(OUT, html);
  console.log("wrote app/index.html (" + (html.length / 1024).toFixed(0) + " KB, " + manifest.length + " modules)");
}

module.exports = { build, moduleBody };
