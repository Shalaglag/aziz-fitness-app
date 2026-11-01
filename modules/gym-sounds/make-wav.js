// Writes the Android notification copy of the "rest over" sound, so a locked phone rings the same ding.
// Run after changing gym-sounds.js: node modules/gym-sounds/make-wav.js
const fs = require("fs"), path = require("path");
const G = require("./gym-sounds.js");
const out = path.join(__dirname, "../../android/app/src/main/res/raw/rest_done.wav");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, G.wav("restDone", 22050));
console.log("wrote", path.relative(process.cwd(), out));
