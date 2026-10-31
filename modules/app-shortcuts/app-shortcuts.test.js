// Run: node --test modules/app-shortcuts/app-shortcuts.test.js
const test = require("node:test");
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const S = require("./app-shortcuts.js");

test("each shortcut hash maps to a tab", () => {
  assert.deepStrictEqual(S.parse("#log-weight"), { action: "log-weight", tab: "today", focus: "#wkg", label: "Log weight" });
  assert.strictEqual(S.parse("#add-water").tab, "today");
  assert.strictEqual(S.parse("#start-workout").tab, "train");
  assert.strictEqual(S.parse("#log-food").focus, "#fname");
});

test("unknown and plain tab hashes are ignored", () => {
  for (const h of ["", "#", "#food", "#today", "#nope", undefined, null]) assert.strictEqual(S.parse(h), null);
});

test("parse tolerates case and a missing #", () => {
  assert.strictEqual(S.parse("LOG-WEIGHT").action, "log-weight");
});

test("app/manifest.webmanifest lists exactly the handled shortcuts", () => {
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, "../../app/manifest.webmanifest"), "utf8"));
  assert.deepStrictEqual(m.shortcuts.map(s => ({ name: s.name, short_name: s.short_name, url: s.url })), S.manifestShortcuts());
  m.shortcuts.forEach(s => assert.ok(S.parse(s.url.split("#")[1]), s.url));
});

test("the focus targets exist in the shell markup", () => {
  const shell = fs.readFileSync(path.join(__dirname, "../../build/shell.html"), "utf8");
  assert.ok(shell.includes('id="wkg"'));
  assert.ok(shell.includes('id="fname"'));
  assert.ok(shell.includes('data-act="water" data-ml="250"'));
});
