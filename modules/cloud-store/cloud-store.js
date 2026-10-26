/* CloudStore: sign-in and synced storage for the app when it runs on its own website.
 *
 * Inside Claude the app gets its database from window.claude.use("db"). On its own website that
 * doesn't exist, so CloudStore signs in with Firebase (email + password) and returns a database
 * with the same shape: db.collection(c).doc(id).set/update/delete/get, collection.onSnapshot,
 * collection.add/get. Each person's data lives under users/{uid}/{collection}/{id}.
 * Firestore's offline cache keeps logging working with no signal and syncs when back online.
 *
 * Config comes from window.FITNESS_CLOUD_CONFIG (app/cloud-config.js), the Firebase web config.
 *
 *   const db = await CloudStore.connect({ mount: document.body });  // null if not configured
 */
const CloudStore = (() => {
  const SDK = "https://www.gstatic.com/firebasejs/10.14.1/";
  const PARTS = ["firebase-app-compat.js", "firebase-auth-compat.js", "firebase-firestore-compat.js"];
  const REQUIRED = ["apiKey", "authDomain", "projectId", "appId"];

  function validConfig(cfg) {
    return !!cfg && typeof cfg === "object" && REQUIRED.every(k => typeof cfg[k] === "string" && cfg[k].trim() !== "");
  }
  function configured() { return typeof window !== "undefined" && validConfig(window.FITNESS_CLOUD_CONFIG); }

  // Firestore update() on a missing doc fails with "not-found"; the app's outbox expects the
  // Claude db's "invalid_argument" before it falls back to set().
  function wrapDoc(ref) {
    return {
      id: ref.id,
      set: d => ref.set(d),
      get: () => ref.get(),
      delete: () => ref.delete(),
      update: d => ref.update(d).catch(e => { if (e && e.code === "not-found") { const x = new Error(e.message); x.code = "invalid_argument"; throw x; } throw e; })
    };
  }
  function scoped(fs, uid) {
    return {
      collection(c) {
        const col = fs.collection("users").doc(uid).collection(c);
        return {
          doc: id => wrapDoc(col.doc(id)),
          add: d => col.add(d),
          get: () => col.get(),
          onSnapshot: (next, err) => col.onSnapshot(next, err)
        };
      }
    };
  }

  // Friendly text for the Firebase auth errors a person can actually hit.
  function authMessage(code) {
    return ({
      "auth/invalid-email": "That email doesn't look right.",
      "auth/missing-password": "Type your password.",
      "auth/weak-password": "Use at least 6 characters for the password.",
      "auth/email-already-in-use": "That email already has an account. Tap Sign in instead.",
      "auth/invalid-credential": "Email or password is wrong.",
      "auth/wrong-password": "Email or password is wrong.",
      "auth/user-not-found": "No account with that email. Tap Create account.",
      "auth/too-many-requests": "Too many tries. Wait a minute and try again.",
      "auth/network-request-failed": "No internet. Connect once to sign in; after that it works offline."
    })[code] || "Couldn't sign in. Try again.";
  }

  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("load " + src)); document.head.appendChild(s); });
  }
  async function loadSdk() {
    if (window.firebase && window.firebase.firestore) return window.firebase;
    for (const p of PARTS) await loadScript(SDK + p);
    return window.firebase;
  }

  function signInForm(mount, auth) {
    return new Promise(resolve => {
      const box = document.createElement("div");
      box.className = "cs-overlay";
      box.innerHTML =
        '<form class="cs-card card" novalidate>' +
        '<h2>Sign in</h2><p class="muted">Your logs are saved to your account, so your phone and computer show the same thing.</p>' +
        '<label class="field"><span class="label">Email</span><input type="email" name="email" autocomplete="username" required></label>' +
        '<label class="field"><span class="label">Password</span><input type="password" name="pw" autocomplete="current-password" required minlength="6"></label>' +
        '<p class="cs-err note" hidden></p>' +
        '<div class="row"><button class="btn" type="submit" data-m="in">Sign in</button><button class="btn ghost" type="submit" data-m="up">Create account</button></div>' +
        '<button class="btn ghost small" type="button" data-m="local">Use without an account (this device only)</button>' +
        '</form>';
      mount.appendChild(box);
      const f = box.querySelector("form"), err = box.querySelector(".cs-err");
      let mode = "in";
      f.querySelectorAll('button[type="submit"]').forEach(b => b.addEventListener("click", () => { mode = b.dataset.m; }));
      box.querySelector('[data-m="local"]').addEventListener("click", () => { box.remove(); resolve(null); });
      f.addEventListener("submit", async e => {
        e.preventDefault();
        err.hidden = true;
        const email = f.email.value.trim(), pw = f.pw.value;
        try {
          const cred = mode === "up" ? await auth.createUserWithEmailAndPassword(email, pw) : await auth.signInWithEmailAndPassword(email, pw);
          box.remove(); resolve(cred.user);
        } catch (x) { err.textContent = authMessage(x && x.code); err.hidden = false; }
      });
    });
  }

  let state = { auth: null, user: null };
  async function connect(opts) {
    if (!configured()) return null;
    const o = opts || {};
    const fb = await loadSdk();
    if (!fb.apps.length) fb.initializeApp(window.FITNESS_CLOUD_CONFIG);
    const fs = fb.firestore();
    try { await fs.enablePersistence({ synchronizeTabs: true }); } catch (e) { /* private window or another tab owns it: still syncs, just no offline cache */ }
    const auth = fb.auth();
    const user = await new Promise(res => { const off = auth.onAuthStateChanged(u => { off(); res(u); }); });
    const who = user || await signInForm(o.mount || document.body, auth);
    if (!who) return null;
    state = { auth, user: who };
    return scoped(fs, who.uid);
  }
  function currentEmail() { return state.user ? state.user.email : null; }
  async function signOut() { if (state.auth) await state.auth.signOut(); state.user = null; }

  return { validConfig, configured, connect, signOut, currentEmail, authMessage, scoped, SDK };
})();

if (typeof module !== "undefined" && module.exports) module.exports = CloudStore;
