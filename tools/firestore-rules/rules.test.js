// Firestore security rules check for the Friends collections, run against the local emulator.
// Proves that one person cannot read another person's data, shares are visible to accepted friends
// only, and challenge participants can only change their own membership.
//
//   cd tools/firestore-rules && npm install && npm test      (needs Java for the emulator)
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { initializeTestEnvironment, assertSucceeds, assertFails } = require("@firebase/rules-unit-testing");

let env;
const RULES = fs.readFileSync(path.join(__dirname, "../../firestore.rules"), "utf8");
test.before(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-mizan", firestore: { rules: RULES, host: process.env.FIRESTORE_EMULATOR_HOST.split(":")[0], port: +process.env.FIRESTORE_EMULATOR_HOST.split(":")[1] } });
});
test.after(async () => { await env.cleanup(); });
test.beforeEach(async () => { await env.clearFirestore(); });
const as = uid => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const admin = fn => env.withSecurityRulesDisabled(c => fn(c.firestore()));
const profile = (db, uid, name) => db.collection("profiles").doc(uid).set({ name, avatar: "initials", code: "AAA-" + uid.slice(0, 3).toUpperCase(), updatedAt: 1 });

test("own data stays private: another account cannot read or write users/{uid}", async () => {
  await assertSucceeds(as("aziz").collection("users").doc("aziz").collection("days").doc("2026-11-01").set({ water: 1 }));
  await assertFails(as("bro").collection("users").doc("aziz").collection("days").doc("2026-11-01").get());
  await assertFails(as("bro").collection("users").doc("aziz").collection("days").doc("2026-11-01").set({ water: 9 }));
  await assertFails(anon().collection("users").doc("aziz").collection("days").get());
});

test("profiles: owner writes, anyone signed in can get one, nobody can list them", async () => {
  await assertSucceeds(profile(as("aziz"), "aziz", "Aziz"));
  await assertFails(profile(as("bro"), "aziz", "Hacked"));
  await assertSucceeds(as("bro").collection("profiles").doc("aziz").get());
  await assertFails(anon().collection("profiles").doc("aziz").get());
  await assertFails(as("bro").collection("profiles").get());
  await assertFails(as("aziz").collection("profiles").doc("aziz").set({ name: "x", weightKg: 90 }));
});

test("invite codes: looked up one at a time, never listed, only for yourself", async () => {
  await assertSucceeds(as("aziz").collection("invites").doc("ABC-123").set({ uid: "aziz", name: "Aziz", avatar: "initials" }));
  await assertFails(as("bro").collection("invites").doc("XYZ-999").set({ uid: "aziz", name: "Aziz", avatar: "initials" }));
  await assertSucceeds(as("bro").collection("invites").doc("ABC-123").get());
  await assertFails(as("bro").collection("invites").get());
});

test("friend request → accept by the recipient only → shares visible → remove stops it", async () => {
  await assertSucceeds(as("aziz").collection("shares").doc("aziz").set({ name: "Aziz", cats: { steps: true }, steps: { goal: 10000, days: {} } }));
  // before any friendship: a stranger cannot read the share
  await assertFails(as("bro").collection("shares").doc("aziz").get());
  // request: only from yourself, with the right id, not to yourself
  await assertFails(as("bro").collection("requests").doc("aziz_bro").set({ from: "aziz", to: "bro", at: 1 }));
  await assertFails(as("bro").collection("requests").doc("bro_bro").set({ from: "bro", to: "bro", at: 1 }));
  await assertSucceeds(as("bro").collection("requests").doc("bro_aziz").set({ from: "bro", to: "aziz", fromName: "Bro", at: 1 }));
  // a third person cannot see it; both sides can
  await assertFails(as("eve").collection("requests").doc("bro_aziz").get());
  await assertSucceeds(as("aziz").collection("requests").where("to", "==", "aziz").get());
  await assertSucceeds(as("bro").collection("requests").where("from", "==", "bro").get());
  await assertFails(as("eve").collection("requests").where("to", "==", "aziz").get());
  // the sender cannot create the friendship themselves, nor can a third person
  await assertFails(as("bro").collection("friends").doc("aziz_bro").set({ users: ["aziz", "bro"], names: {}, since: 1 }));
  await assertFails(as("eve").collection("friends").doc("aziz_bro").set({ users: ["aziz", "bro"], names: {}, since: 1 }));
  // the recipient accepts
  await assertSucceeds(as("aziz").collection("friends").doc("aziz_bro").set({ users: ["aziz", "bro"], names: { aziz: "Aziz", bro: "Bro" }, since: 1 }));
  await assertSucceeds(as("aziz").collection("requests").doc("bro_aziz").delete());
  // now the friend can read the share, a stranger still cannot, and nobody else can write it
  await assertSucceeds(as("bro").collection("shares").doc("aziz").get());
  await assertFails(as("eve").collection("shares").doc("aziz").get());
  await assertFails(as("bro").collection("shares").doc("aziz").set({ name: "X" }));
  await assertSucceeds(as("bro").collection("friends").where("users", "array-contains", "bro").get());
  await assertFails(as("eve").collection("friends").where("users", "array-contains", "bro").get());
  // friendship can't be created without a request
  await assertFails(as("eve").collection("friends").doc("aziz_eve").set({ users: ["aziz", "eve"], names: {}, since: 1 }));
  // remove: either side; afterwards the share is private again
  await assertSucceeds(as("bro").collection("friends").doc("aziz_bro").delete());
  await assertFails(as("bro").collection("shares").doc("aziz").get());
});

test("challenges: invited people read and join/leave themselves; outsiders see nothing; entries scoped", async () => {
  const ch = { id: "c1", name: "Walk-off", type: "steps_total", target: 0, start: "2026-11-02", end: "2026-11-08", creator: "aziz", invited: ["aziz", "bro"], members: ["aziz"], names: { aziz: "Aziz", bro: "Bro" }, createdAt: 1 };
  await assertFails(as("bro").collection("challenges").doc("c1").set(ch));                       // only the creator
  await assertFails(as("aziz").collection("challenges").doc("c1").set({ ...ch, members: ["aziz", "bro"] })); // can't force-join others
  await assertSucceeds(as("aziz").collection("challenges").doc("c1").set(ch));
  await assertSucceeds(as("bro").collection("challenges").where("invited", "array-contains", "bro").get());
  await assertFails(as("eve").collection("challenges").doc("c1").get());
  await assertFails(as("eve").collection("challenges").where("invited", "array-contains", "bro").get());
  // bro may add only himself; may not touch the target or add eve
  await assertFails(as("bro").collection("challenges").doc("c1").update({ target: 5 }));
  await assertFails(as("bro").collection("challenges").doc("c1").update({ members: ["aziz", "bro", "eve"] }));
  await assertFails(as("bro").collection("challenges").doc("c1").update({ members: ["bro"] }));   // can't remove the creator
  await assertSucceeds(as("bro").collection("challenges").doc("c1").update({ members: ["aziz", "bro"], names: { aziz: "Aziz", bro: "Brother" } }));
  // entries: own only, members only, readable by the invited
  await assertSucceeds(as("bro").collection("challenges").doc("c1").collection("entries").doc("bro").set({ name: "Bro", days: { "2026-11-02": { s: 5000, g: 10000 } }, updatedAt: 1 }));
  await assertFails(as("bro").collection("challenges").doc("c1").collection("entries").doc("aziz").set({ name: "Aziz", days: {}, updatedAt: 1 }));
  await assertFails(as("eve").collection("challenges").doc("c1").collection("entries").doc("eve").set({ name: "Eve", days: {}, updatedAt: 1 }));
  await assertSucceeds(as("aziz").collection("challenges").doc("c1").collection("entries").get());
  await assertFails(as("eve").collection("challenges").doc("c1").collection("entries").get());
  // leave: remove self from members and invited, delete own entry; the creator may delete the whole thing
  await assertSucceeds(as("bro").collection("challenges").doc("c1").collection("entries").doc("bro").delete());
  await assertSucceeds(as("bro").collection("challenges").doc("c1").update({ members: ["aziz"], invited: ["aziz"] }));
  await assertFails(as("bro").collection("challenges").doc("c1").get());
  await assertFails(as("bro").collection("challenges").doc("c1").delete());
  await assertSucceeds(as("aziz").collection("challenges").doc("c1").delete());
});
