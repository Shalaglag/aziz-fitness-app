#!/usr/bin/env node
/* Rebuilds build/shell.html from a hand-edited app/index.html.
 *
 *   node build/extract-shell.js
 *
 * Use it when a change landed directly in app/index.html (an older PR, or a module's apply-patch
 * script): it copies everything except the module <script> blocks into build/shell.html and
 * reports any module whose inlined copy no longer matches what build/build.js would produce.
 * The module file always wins on the next build, so port such a change to modules/<name>/.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { moduleBody } = require("./build.js");

const ROOT = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "app/index.html"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "build/modules.json"), "utf8")).modules;

const re = /<script>\n([\s\S]*?)<\/script>\n?/g;
const blocks = [...html.matchAll(re)];
if (blocks.length !== manifest.length + 1) {
  console.error(`app/index.html has ${blocks.length} <script> blocks; the manifest lists ${manifest.length} modules plus one shell block.`);
  console.error("Add or remove the module in build/modules.json so the counts match, then run again.");
  process.exit(1);
}
let drift = 0;
manifest.forEach((entry, i) => {
  if (blocks[i][1] !== moduleBody(entry)) {
    drift++;
    console.warn(`drift: the app copy of ${entry.file} differs from the module; the module wins on the next build`);
  }
});
const first = blocks[0], last = blocks[manifest.length - 1];
const shell = html.slice(0, first.index) + "<!-- @modules -->\n" + html.slice(last.index + last[0].length);
fs.writeFileSync(path.join(ROOT, "build/shell.html"), shell);
console.log(`wrote build/shell.html (${(shell.length / 1024).toFixed(0)} KB)` + (drift ? `, ${drift} module(s) drifted` : ""));
