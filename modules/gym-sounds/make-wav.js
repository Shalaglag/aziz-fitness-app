// Writes the Android notification copies of the rest-over sounds, so a locked phone rings the sound picked
// in Settings. Run after changing gym-sounds.js: node modules/gym-sounds/make-wav.js
const fs = require("fs"), path = require("path");
const G = require("./gym-sounds.js");
const dir = path.join(__dirname, "../../android/app/src/main/res/raw");
fs.mkdirSync(dir, { recursive: true });
for (const { id } of G.REST_SOUNDS) {
  const out = path.join(dir, G.rawName(id));
  fs.writeFileSync(out, G.wav(id, 22050));
  console.log("wrote", path.relative(process.cwd(), out));
}
