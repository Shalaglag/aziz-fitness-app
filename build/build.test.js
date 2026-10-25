// node --test build/build.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { build, moduleBody } = require("./build.js");

const ROOT = path.resolve(__dirname, "..");

test("the committed app/index.html is exactly what the build produces", () => {
  const committed = fs.readFileSync(path.join(ROOT, "app/index.html"), "utf8");
  const { html, manifest } = build();
  assert.equal(html, committed, "run `node build/build.js` and commit app/index.html");
  assert.equal(manifest.length, (html.match(/<script>/g) || []).length - 1, "one <script> block per module plus the shell");
});

// moduleBody reads paths relative to the repo root, so fixtures go in a temp dir inside it.
function withFixture(name, text, fn) {
  const dir = fs.mkdtempSync(path.join(ROOT, "build", ".fixture-"));
  const rel = path.relative(ROOT, path.join(dir, name));
  try { fs.writeFileSync(path.join(ROOT, rel), text); return fn(rel); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test("expose rewrites a top-level const to window.*, or appends an assignment", () => {
  withFixture("a.js", "const Foo = (() => 1)();\n", rel =>
    assert.equal(moduleBody({ file: rel, expose: ["Foo"] }), "window.Foo = (() => 1)();\n"));
  withFixture("b.js", "function Bar(){}\n\n\n", rel =>
    assert.equal(moduleBody({ file: rel, expose: ["Bar"] }), "function Bar(){}\n\nwindow.Bar=Bar;\n"));
  withFixture("c.js", "const Rx = 'a$&b';\n", rel =>
    assert.equal(moduleBody({ file: rel, expose: ["Rx"] }), "window.Rx = 'a$&b';\n", "$& in source must survive"));
});

test("esm strips exports and returns them from an IIFE", () => {
  withFixture("m.js", "export const A = 1;\nexport function b() {}\nconst hidden = 2;\n", rel =>
    assert.equal(moduleBody({ file: rel, esm: "M" }),
      "window.M=(function(){\nconst A = 1;\nfunction b() {}\nconst hidden = 2;\n\nreturn {A,b};\n})();\n"));
});

test("json inlines a pretty-printed window global", () => {
  withFixture("d.json", '{"x":[1,2]}', rel =>
    assert.equal(moduleBody({ file: rel, json: "D" }), 'window.D={\n  "x": [\n    1,\n    2\n  ]\n};\n'));
});

test("a module containing </script> is refused", () => {
  withFixture("e.js", "const s = '</script>';\n", rel =>
    assert.throws(() => moduleBody({ file: rel }), /<\/script>/));
});
