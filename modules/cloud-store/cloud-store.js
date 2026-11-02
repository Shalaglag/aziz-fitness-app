/* CloudStore: sign-in and synced storage for the app when it runs on its own website.
 *
 * Inside Claude the app gets its database from window.claude.use("db"). On its own website that
 * doesn't exist, so CloudStore signs in with Firebase (email + password, or Google) and returns a database
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
  // Same files shipped inside the app (app/vendor), tried first so the Android app signs in and syncs
  // offline from the first launch; the CDN is the fallback for an older copy without the folder.
  const LOCAL_SDK = "vendor/firebase-10.14.1/";
  const PARTS = ["firebase-app-compat.js", "firebase-auth-compat.js", "firebase-firestore-compat.js"];
  const REQUIRED = ["apiKey", "authDomain", "projectId", "appId"];
  // Native Google sign-in plugin (android/.../GoogleSignInPlugin.kt): signIn({clientId}) -> {idToken}.
  const GOOGLE_PLUGIN = "GoogleSignIn";

  function validConfig(cfg) {
    return !!cfg && typeof cfg === "object" && REQUIRED.every(k => typeof cfg[k] === "string" && cfg[k].trim() !== "");
  }
  // Loads app/cloud-config.js next to the page (only off Claude, so the Artifact never requests it).
  // Resolves true when a valid config is present; a missing file just means "not configured".
  async function loadConfig() {
    if (configured()) return true;
    try { await loadScript("cloud-config.js"); } catch (e) { return false; }
    return configured();
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
      "auth/network-request-failed": "No internet. Connect once to sign in; after that it works offline.",
      "auth/account-exists-with-different-credential": "That email already has a password account. Sign in with the email and password.",
      "auth/popup-blocked": "Your browser blocked the Google window. Allow pop-ups and try again.",
      "auth/unauthorized-domain": "Google sign-in isn't allowed from this website address yet.",
      "auth/operation-not-allowed": "Google sign-in isn't switched on for this app yet. Use your email for now.",
      "google/not-set-up": "Google sign-in isn't switched on in this build yet. Use your email for now.",
      "google/no-account": "No Google account on this phone. Add one in Android Settings, or use your email.",
      "google/failed": "Google sign-in didn't work. Use your email for now."
    })[code] || "Couldn't sign in. Try again.";
  }
  // Tapping away from the Google chooser is not an error worth showing.
  function cancelled(code) { return code === "google/cancelled" || code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request"; }

  function isNative() {
    const c = typeof window !== "undefined" ? window.Capacitor : null;
    try { return !!(c && c.isNativePlatform && c.isNativePlatform()); } catch (e) { return false; }
  }
  function nativeGooglePlugin() {
    const c = typeof window !== "undefined" ? window.Capacitor : null;
    return c && c.Plugins && c.Plugins[GOOGLE_PLUGIN] ? c.Plugins[GOOGLE_PLUGIN] : null;
  }

  // Sign in with Google. In the Android app the Google chooser is native (Credential Manager through the
  // GoogleSignIn plugin, matched to the app by package name + signing-key SHA-1) and its ID token signs
  // the same Firebase account in, so Firestore and the rules see one uid whether a person used email or
  // Google. On the website Firebase's own Google pop-up does it. Errors carry a code authMessage() knows.
  //   deps: { auth, fb, native, plugin, clientId } (defaults come from the page; tests inject fakes)
  async function signInWithGoogle(deps) {
    const d = deps || {};
    const fb = d.fb || (typeof window !== "undefined" ? window.firebase : null);
    const auth = d.auth || (fb && fb.auth());
    const native = typeof d.native === "boolean" ? d.native : isNative();
    const fail = (code, msg) => { const e = new Error(msg || code); e.code = code; throw e; };
    if (!native) {
      const provider = new fb.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      const cred = await auth.signInWithPopup(provider);
      return cred.user;
    }
    const plugin = d.plugin || nativeGooglePlugin();
    const cfg = (typeof window !== "undefined" && window.FITNESS_CLOUD_CONFIG) || {};
    const clientId = typeof d.clientId === "string" ? d.clientId : (cfg.googleClientId || "");
    if (!plugin || !clientId.trim()) fail("google/not-set-up");
    let r;
    try { r = await plugin.signIn({ clientId: clientId.trim() }); }
    catch (e) { const c = e && e.code; fail("google/" + (c === "cancelled" || c === "no-account" || c === "not-set-up" ? c : "failed"), e && e.message); }
    if (!r || !r.idToken) fail("google/failed", "no idToken");
    const cred = await auth.signInWithCredential(fb.auth.GoogleAuthProvider.credential(r.idToken));
    return cred.user;
  }

  const GOOGLE_ICON = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.9 6.1C12.4 13.7 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.2z"/><path fill="#FBBC05" d="M10.5 28.6A14.5 14.5 0 0 1 9.7 24c0-1.6.3-3.2.8-4.6l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.3 0 11.7-2.1 15.6-5.7l-7.7-6c-2.1 1.4-4.8 2.3-7.9 2.3-6.3 0-11.6-4.2-13.5-9.9l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>';

  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("load " + src)); document.head.appendChild(s); });
  }
  async function loadSdk(load) {
    load = load || loadScript;
    const g = typeof window !== "undefined" ? window : globalThis;
    if (g.firebase && g.firebase.firestore) return g.firebase;
    let last;
    for (const base of [LOCAL_SDK, SDK]) {
      try { for (const p of PARTS) await load(base + p); return g.firebase; } catch (e) { last = e; }
    }
    throw last;
  }

  function signInForm(mount, auth) {
    return new Promise(resolve => {
      const box = document.createElement("div");
      box.className = "cs-overlay";
      box.innerHTML =
        '<form class="cs-card card" novalidate>' +
        '<h2>Sign in</h2><p class="muted">Your logs are saved to your account, so your phone and computer show the same thing.</p>' +
        '<button class="btn ghost cs-google" type="button" data-m="google">' + GOOGLE_ICON + '<span>Continue with Google</span></button>' +
        '<div class="cs-or">or use your email</div>' +
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
      const gBtn = box.querySelector('[data-m="google"]');
      gBtn.addEventListener("click", async () => {
        err.hidden = true; gBtn.disabled = true;
        try { const user = await signInWithGoogle({ auth }); box.remove(); resolve(user); }
        catch (x) { const code = x && x.code; if (!cancelled(code)) { err.textContent = authMessage(code); err.hidden = false; } }
        finally { gBtn.disabled = false; }
      });
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

  let state = { auth: null, user: null, fs: null };
  async function connect(opts) {
    if (!configured()) return null;
    const o = opts || {};
    const fb = await loadSdk();
    if (!fb.apps.length) fb.initializeApp(window.FITNESS_CLOUD_CONFIG);
    const fs = fb.firestore();
    const auth = fb.auth();
    // Test seam: FITNESS_CLOUD_CONFIG.emulator = {host, firestorePort, authPort} points both at the local
    // Firebase emulators (tests/friends-e2e.test.js). Never set in app/cloud-config.js.
    const em = window.FITNESS_CLOUD_CONFIG.emulator;
    if (em && em.host) { try { fs.useEmulator(em.host, em.firestorePort || 8080); auth.useEmulator("http://" + em.host + ":" + (em.authPort || 9099), { disableWarnings: true }); } catch (e) { /* already set */ } }
    try { await fs.enablePersistence({ synchronizeTabs: true }); } catch (e) { /* private window or another tab owns it: still syncs, just no offline cache */ }
    const user = await new Promise(res => { const off = auth.onAuthStateChanged(u => { off(); res(u); }); });
    const who = user || await signInForm(o.mount || document.body, auth);
    if (!who) return null;
    state = { auth, user: who, fs };
    return scoped(fs, who.uid);
  }
  function currentEmail() { return state.user ? state.user.email : null; }
  // Firebase ID token of the signed-in person (null when nobody is signed in), for any server call
  // that needs to know who is asking (none uses it since the AI coach was removed).
  function idToken() { return state.user && state.user.getIdToken ? state.user.getIdToken().catch(() => null) : Promise.resolve(null); }
  async function signOut() { if (state.auth) await state.auth.signOut(); state.user = null; }
  // The unscoped Firestore handle and uid, for the shared Friends collections (modules/friends), whose
  // access is enforced by firestore.rules. Null before sign-in.
  function raw() { return state.user && state.fs ? { fs: state.fs, uid: state.user.uid, email: state.user.email } : null; }

  return { validConfig, configured, loadConfig, connect, signOut, currentEmail, idToken, raw, authMessage, cancelled, signInWithGoogle, scoped, loadSdk, SDK, LOCAL_SDK, GOOGLE_PLUGIN };
})();

if (typeof module !== "undefined" && module.exports) module.exports = CloudStore;
