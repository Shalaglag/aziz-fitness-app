/* MusicControl: a small remote for the YouTube Music app (or whatever is playing) inside Mizan.
 *
 * It never plays audio itself. On Android it sends media key presses through the MediaKeys plugin
 * (android/MediaKeysPlugin.kt): play/pause, previous, next; opens the saved workout playlist in YouTube Music;
 * opens the app. Outside the Android app the buttons only show a toast and links open in a new tab.
 * Song name, artist, cover and play state are shown only when the user turns on "Show song and cover" and grants
 * Android's notification access (the MediaKeys plugin reads the active media session; nothing else).
 *
 *   MusicControl.init({ get, set, toast })      get() -> saved settings, set(obj) saves them (the host's prefs)
 *   MusicControl.settings() / setSettings(patch) { on: true, look: 'strip'|'icon'|'workout', playlist: '', meta: false }
 *   MusicControl.enableMeta(on)               meta = show song name, artist, cover and play state; needs Android's
 *                                              notification access (opens that settings page when missing), opt-in
 *   MusicControl.nowPlaying()                 last read { title, artist, art, playing } or null
 *   MusicControl.LOOKS                         [[key, label], …] for the Settings picker (B strip is the default)
 *   MusicControl.validPlaylist(url)            a normalised YouTube / YouTube Music link, or null
 *   MusicControl.mountHeader(iconSlot, stripSlot)  the host calls this on every render (main header)
 *   MusicControl.mountWorkout(liveEl)          the workout logger calls this after it paints its live header
 *   MusicControl.bind(root)                    one delegated click handler for every [data-mc] button
 *   MusicControl.press(key) / open(url)        the actions (promise; false when there is no plugin)
 *
 * Looks: icon = a note button in the header that opens a compact panel (draft A); strip = a slim strip under the
 * header, collapsed to a small tab (draft B, default); workout = a row above the rest timer on the live workout
 * screen only (draft C). Expanded/collapsed is remembered on this device (localStorage mz-music-open).
 */
const MusicControl = (function (global) {
  const PKG = 'com.google.android.apps.youtube.music';
  const APP_URL = 'https://music.youtube.com/';
  const LOOKS = [['strip', 'Strip under the header'], ['icon', 'Icon in the header'], ['workout', 'Workout screen only']];
  const DEF = { on: true, look: 'strip', playlist: '', meta: false };
  const OPEN_KEY = 'mz-music-open';
  let store = { get: () => null, set: () => { } }, toastFn = null;
  let opened = null;          // strip / workout row expanded (null = not read yet)
  let panel = null;           // the icon look's panel element while open
  let installed = null;       // YouTube Music on the phone? null = unknown (browser)
  let cssDone = false, bound = false;
  let liveHost = null, headSlot = null, stripSlot = null, restWatch = null;
  let np = null, access = null, pollT = null, resumeHooked = false; // now playing: last read, listener access, poll timer

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function settings() { let s = null; try { s = store.get(); } catch (e) { } return Object.assign({}, DEF, s && typeof s === 'object' ? s : {}); }
  function setSettings(patch) { const next = Object.assign(settings(), patch || {}); if (!LOOKS.some(l => l[0] === next.look)) next.look = DEF.look; store.set(next); render(); return next; }
  function toast(m) { if (toastFn) try { toastFn(m); } catch (e) { } }
  function isOpen() { if (opened == null) { try { opened = global.localStorage && global.localStorage.getItem(OPEN_KEY) === '1'; } catch (e) { opened = false; } } return !!opened; }
  function setOpen(v) { opened = !!v; try { global.localStorage && global.localStorage.setItem(OPEN_KEY, v ? '1' : '0'); } catch (e) { } }

  // Only YouTube / YouTube Music links are kept, so a typo can't send the user somewhere odd.
  function validPlaylist(url) {
    let u = String(url || '').trim(); if (!u) return null;
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    let p; try { p = new URL(u); } catch (e) { return null; }
    const host = p.hostname.toLowerCase().replace(/^www\.|^m\./, '');
    if (!['music.youtube.com', 'youtube.com', 'youtu.be'].includes(host)) return null;
    p.protocol = 'https:';
    return p.toString();
  }

  function plugin() {
    try { const sh = global.AndroidShell; if (!sh || !sh.isNative || !sh.isNative()) return null; const c = global.Capacitor; return (c && c.Plugins && c.Plugins.MediaKeys) || null; } catch (e) { return null; }
  }
  async function press(key) {
    const p = plugin();
    if (!p || !p.press) { toast('Music buttons work in the Android app'); return false; }
    try { await p.press({ key }); return true; } catch (e) { toast('Could not reach the music app'); return false; }
  }
  async function open(url) {
    const target = url || APP_URL, p = plugin();
    if (p && p.open) { try { await p.open({ url: target, pkg: PKG }); return true; } catch (e) { } }
    try { const w = global.open(target, '_blank', 'noopener'); return !!w; } catch (e) { return false; }
  }
  function checkInstalled() {
    const p = plugin(); if (!p || !p.isInstalled || installed != null) return;
    p.isInstalled({ pkg: PKG }).then(r => { installed = !!(r && r.installed); render(); }).catch(() => { });
  }

  /* ---- now playing (opt-in) ---- */
  function nowPlaying() { return np; }
  function npKey(x) { return x ? [x.access, x.session, x.title, x.artist, x.playing, (x.art || '').length].join('|') : ''; }
  async function poll() {
    const p = plugin(); if (!p || !p.nowPlaying || !settings().meta) return;
    try {
      const r = await p.nowPlaying({ art: true });
      const next = r && r.access ? (r.session ? { access: true, session: true, title: r.title || '', artist: r.artist || '', album: r.album || '', playing: !!r.playing, art: r.art || '', pkg: r.pkg || '' } : { access: true, session: false }) : { access: false };
      access = !!(r && r.access);
      if (npKey(next) !== npKey(np)) { np = next; render(); }
    } catch (e) { }
  }
  function startPoll() {
    if (!settings().meta || !plugin()) { stopPoll(); return; }
    if (!pollT) { pollT = setInterval(poll, 3000); poll(); }
    if (!resumeHooked) { resumeHooked = true; try { const app = global.Capacitor.Plugins.App; app && app.addListener && app.addListener('resume', () => poll()); } catch (e) { } }
  }
  function stopPoll() { if (pollT) { clearInterval(pollT); pollT = null; } }
  async function requestAccess() { const p = plugin(); if (!p || !p.requestAccess) { toast('Song names need the Android app'); return false; } try { await p.requestAccess(); return true; } catch (e) { return false; } }
  // Turning the switch on from Settings: save it, then send the user to Android's notification-access page once.
  async function enableMeta(on) {
    setSettings({ meta: !!on });
    if (!on) { stopPoll(); np = null; render(); return true; }
    const p = plugin(); if (!p) return false;
    let has = false; try { const r = await p.hasAccess(); has = !!(r && r.access); } catch (e) { }
    if (!has) { await requestAccess(); } else startPoll();
    return has;
  }

  /* ---- markup ---- */
  const NOTE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V6l11-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>';
  const PREV = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M6 5h2v14H6zM19 5v14L9 12z"/></svg>';
  const NEXT = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M16 5h2v14h-2zM5 5v14l10-7z"/></svg>';
  const PLAY = '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M7 4v16l13-8z"/></svg>';
  const PAUSE = '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
  const ppIcon = () => (np && np.session && np.playing ? PAUSE : PLAY);
  const ctl = big => '<button type="button" class="mc-btn' + (big ? ' mc-big' : '') + '" data-mc="prev" aria-label="Previous track">' + PREV + '</button><button type="button" class="mc-btn mc-pp' + (big ? ' mc-big' : '') + '" data-mc="pp" aria-label="' + (np && np.session && np.playing ? 'Pause' : 'Play') + '">' + ppIcon() + '</button><button type="button" class="mc-btn' + (big ? ' mc-big' : '') + '" data-mc="next" aria-label="Next track">' + NEXT + '</button>';
  const links = () => { const s = settings(); return (s.playlist ? '<button type="button" class="mc-link" data-mc="playlist">Workout playlist <span aria-hidden="true">›</span></button>' : '<button type="button" class="mc-link" data-mc="settings">Add a workout playlist <span aria-hidden="true">›</span></button>') + (installed === false ? '' : '<button type="button" class="mc-link" data-mc="open">Open YouTube Music <span aria-hidden="true">↗</span></button>'); };
  // What the left side says: the song (meta on + access), a nudge to allow access, or just the app name.
  function trackHtml(kind) {
    const s = settings();
    const cover = np && np.session && np.art ? '<img class="mc-art" src="' + esc(np.art) + '" alt="" width="36" height="36">' : '<span class="mc-dot" aria-hidden="true"></span>';
    if (!s.meta) return null;
    if (!plugin()) return { cover, main: 'YouTube Music', sub: 'Song names show in the Android app' };
    if (np && np.access === false) return { cover, main: '<button type="button" class="mc-plain" data-mc="access">Allow access ' + (kind === 'strip' ? '›' : '') + '</button>', sub: 'Notification access, for song names' };
    if (np && np.session) return { cover, main: esc(np.title || 'Playing'), sub: esc(np.artist || '') };
    return { cover, main: 'Nothing playing', sub: 'YouTube Music' };
  }
  function iconHtml(on) { return '<button type="button" class="mc-icon' + (on ? ' on' : '') + '" data-mc="toggle" aria-label="Music" aria-haspopup="dialog" aria-expanded="' + !!on + '">' + NOTE + '</button>'; }
  function panelHtml() {
    const t = trackHtml('panel');
    const track = t ? '<div class="mc-track">' + t.cover + '<span class="mc-tx"><b>' + t.main + '</b><small>' + t.sub + '</small></span></div>' : '';
    return '<div class="mc-panel" role="dialog" aria-label="Music"><div class="mc-t"><span class="mc-dot" aria-hidden="true"></span>YouTube Music<button type="button" class="mc-x" data-mc="close" aria-label="Close">✕</button></div>' + track + '<div class="mc-ctl">' + ctl(true) + '</div>' + links() + '<button type="button" class="mc-link mc-mute" data-mc="hide">Hide music controls</button></div>';
  }
  function stripHtml(open) {
    if (!open) return '<div class="mc-handle"><button type="button" data-mc="toggle" aria-expanded="false" aria-label="Show music controls">' + NOTE + ' Music</button></div>';
    const s = settings(), t = trackHtml('strip');
    if (t) return '<div class="mc-strip" role="region" aria-label="Music">' + t.cover + '<span class="mc-tx"><b>' + t.main + '</b><small>' + t.sub + '</small></span>' + ctl(false) + '<button type="button" class="mc-btn mc-tog" data-mc="toggle" aria-expanded="true" aria-label="Collapse music controls">⌃</button></div>';
    return '<div class="mc-strip" role="region" aria-label="Music"><span class="mc-dot" aria-hidden="true"></span><span class="mc-tx">' + (s.playlist ? '<button type="button" class="mc-plain" data-mc="playlist">Workout playlist <span aria-hidden="true">›</span></button>' : '<button type="button" class="mc-plain" data-mc="settings">Add a playlist <span aria-hidden="true">›</span></button>') + '<small>YouTube Music' + (installed === false ? '' : ' · <button type="button" class="mc-plain" data-mc="open">Open ↗</button>') + '</small></span>' + ctl(false) + '<button type="button" class="mc-btn mc-tog" data-mc="toggle" aria-expanded="true" aria-label="Collapse music controls">⌃</button></div>';
  }
  function workoutHtml(open) {
    if (!open) return '<button type="button" class="mc-fab" data-mc="toggle" aria-expanded="false" aria-label="Show music controls">' + NOTE + '</button>';
    const t = trackHtml('workout');
    const lbl = t ? t.cover + '<span class="mc-tx"><b>' + t.main + '</b><small>' + t.sub + '</small></span>' : '<span class="mc-dot" aria-hidden="true"></span>YouTube Music';
    return '<div class="mc-c" role="region" aria-label="Music"><div class="mc-row"><span class="mc-lbl">' + lbl + '</span><span class="mc-ctl">' + ctl(false) + '</span><button type="button" class="mc-btn mc-tog" data-mc="toggle" aria-expanded="true" aria-label="Collapse music controls">⌄</button></div><div class="mc-sub">' + links() + '<button type="button" class="mc-link mc-mute" data-mc="hide">Hide</button></div></div>';
  }

  const CSS = `
.mc-btn{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:50%;border:1px solid var(--lb-line,var(--line));background:var(--lb-sunk,var(--sunk));color:var(--lb-ink,var(--ink));padding:0;cursor:pointer;flex:none}
.mc-btn.mc-big{width:46px;height:46px}
.mc-btn.mc-pp{background:var(--lb-accent,var(--accent));border-color:var(--lb-accent,var(--accent));color:var(--lb-accent-ink,var(--accent-ink,#fff))}
.mc-btn.mc-tog{border:0;background:transparent;color:var(--lb-muted,var(--muted));width:30px}
.mc-icon{display:inline-grid;place-items:center;width:36px;height:36px;border-radius:50%;border:1px solid var(--lb-line,var(--line));background:var(--lb-sunk,var(--sunk));color:var(--lb-accent,var(--accent));padding:0;cursor:pointer;flex:none}
.mc-icon.mc-on{background:var(--lb-accent,var(--accent));border-color:var(--lb-accent,var(--accent));color:var(--lb-accent-ink,var(--accent-ink,#fff))}
.datepick .mc-icon{border-radius:8px}
.mc-art{width:36px;height:36px;border-radius:8px;object-fit:cover;flex:none;background:var(--lb-sunk,var(--sunk))}
.mc-tx b{display:block;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mc-tx small{display:block;color:var(--lb-muted,var(--muted));font-size:.72rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mc-track{display:flex;align-items:center;gap:10px;padding:2px 0 8px;min-width:0}
.mc-track .mc-tx{flex:1;min-width:0}
.mc-lbl .mc-tx{flex:1;min-width:0;font-weight:500}
.mc-dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--lb-accent,var(--accent));flex:none}
.mc-panel{position:fixed;z-index:60;width:min(240px,calc(100vw - 24px));background:var(--lb-surface,var(--surface));border:1px solid var(--lb-line,var(--line));border-radius:14px;box-shadow:0 10px 28px rgba(0,0,0,.18);padding:8px 12px 6px;display:flex;flex-direction:column;color:var(--lb-ink,var(--ink))}
.mc-t{display:flex;align-items:center;gap:8px;font-weight:600;font-size:.92rem;padding:2px 0 6px}
.mc-x{margin-left:auto;border:0;background:none;color:var(--lb-muted,var(--muted));font-size:1rem;width:32px;height:32px;cursor:pointer}
.mc-ctl{display:flex;align-items:center;justify-content:center;gap:14px;padding:4px 0 8px}
.mc-link{display:flex;align-items:center;justify-content:space-between;gap:6px;width:100%;padding:10px 2px;border:0;border-top:1px solid var(--lb-line,var(--line));background:none;color:var(--lb-ink,var(--ink));font:inherit;font-size:.9rem;text-align:left;cursor:pointer}
.mc-link span{color:var(--lb-muted,var(--muted))}
.mc-link.mc-mute{color:var(--lb-muted,var(--muted));font-size:.82rem}
.mc-plain{border:0;background:none;padding:0;font:inherit;color:inherit;cursor:pointer;text-align:left}
.mc-strip{display:flex;align-items:center;gap:8px;padding:5px 12px 5px 14px;background:var(--lb-sunk,var(--sunk));border-bottom:1px solid var(--lb-line,var(--line));font-size:.85rem;color:var(--lb-ink,var(--ink))}
.mc-strip .mc-tx{flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden;white-space:nowrap}
.mc-strip .mc-tx>*{overflow:hidden;text-overflow:ellipsis}
.mc-strip .mc-tx small{color:var(--lb-muted,var(--muted));font-size:.72rem}
.mc-strip .mc-art{width:34px;height:34px}
.mc-strip .mc-btn{width:32px;height:32px;border:0;background:transparent}
.mc-strip .mc-btn.mc-pp{background:var(--lb-accent,var(--accent))}
.mc-handle{display:flex;justify-content:center;padding:0;line-height:1}
.mc-handle button{display:inline-flex;align-items:center;gap:6px;background:var(--lb-sunk,var(--sunk));border:1px solid var(--lb-line,var(--line));border-top:0;color:var(--lb-muted,var(--muted));border-radius:0 0 10px 10px;padding:3px 14px;font:inherit;font-size:.72rem;font-weight:600;cursor:pointer;min-height:24px}
.mc-handle button svg{width:12px;height:12px}
.mc-c{position:absolute;left:0;right:0;bottom:0;z-index:5;background:var(--lb-surface,var(--surface));border-top:1px solid var(--lb-line,var(--line));padding:8px max(16px,env(safe-area-inset-right,0px)) 8px max(16px,env(safe-area-inset-left,0px));color:var(--lb-ink,var(--ink))}
.mc-c.mc-edge{padding-bottom:calc(10px + env(safe-area-inset-bottom,0px))}
.mc-row{display:flex;align-items:center;gap:8px}
.mc-lbl{display:flex;align-items:center;gap:8px;font-weight:600;font-size:.88rem;flex:1;min-width:0}
.mc-row .mc-ctl{padding:0;gap:8px}
.mc-row .mc-ctl .mc-btn{width:40px;height:40px}
.mc-sub{display:flex;gap:4px 14px;margin-top:2px;font-size:.8rem;flex-wrap:wrap}
.mc-sub .mc-link{width:auto;border:0;padding:6px 0;color:var(--lb-accent,var(--accent));font-weight:600}
.mc-sub .mc-link span{color:inherit}
.mc-sub .mc-link.mc-mute{margin-left:auto;color:var(--lb-muted,var(--muted));font-weight:500}
.mc-fab{position:absolute;left:14px;bottom:14px;z-index:6;width:42px;height:42px;border-radius:50%;background:var(--lb-surface,var(--surface));border:1px solid var(--lb-line,var(--line));color:var(--lb-accent,var(--accent));display:grid;place-items:center;box-shadow:0 4px 14px rgba(0,0,0,.14);cursor:pointer;padding:0}
.mc-fab.mc-edge{bottom:calc(14px + env(safe-area-inset-bottom,0px))}
.lb-live.mc-has-c .lb-live-body{padding-bottom:200px}
.lb-live .mc-head-slot{display:inline-flex;align-items:center}
`;
  function injectCss() { if (cssDone || !global.document) return; cssDone = true; const s = global.document.createElement('style'); s.textContent = CSS; global.document.head.appendChild(s); }

  /* ---- painting ---- */
  function closePanel() { if (panel) { panel.remove(); panel = null; } global.document && global.document.querySelectorAll('.mc-icon.mc-on').forEach(b => { b.classList.remove('mc-on'); b.setAttribute('aria-expanded', 'false'); }); }
  function openPanel(anchor) {
    closePanel(); const d = global.document; if (!d) return;
    const w = d.createElement('div'); w.innerHTML = panelHtml(); panel = w.firstElementChild;
    const r = anchor.getBoundingClientRect();
    const pw = Math.min(240, global.innerWidth - 24); // right-aligned to the button, but never past the screen edge
    panel.style.top = (r.bottom + 6) + 'px'; panel.style.right = Math.max(12, Math.min(global.innerWidth - r.right, global.innerWidth - pw - 12)) + 'px';
    (anchor.closest('.lb-live') || d.body).appendChild(panel); // inside the live workout (its overlay sits above the page)
    anchor.classList.add('mc-on'); anchor.setAttribute('aria-expanded', 'true');
    setTimeout(() => d.addEventListener('click', outside, { once: true }), 0);
  }
  function outside(e) { if (panel && !panel.contains(e.target) && !(e.target.closest && e.target.closest('[data-mc="toggle"]'))) closePanel(); else if (panel) setTimeout(() => global.document.addEventListener('click', outside, { once: true }), 0); }

  function paintSlot(slot, html) { if (!slot) return; if (slot.innerHTML !== html) slot.innerHTML = html; }
  function mountHeader(iconSlot, strip) {
    injectCss(); headSlot = iconSlot || headSlot; stripSlot = strip || stripSlot; checkInstalled();
    const s = settings();
    paintSlot(headSlot, s.on && s.look === 'icon' ? iconHtml(false) : '');
    paintSlot(stripSlot, s.on && s.look === 'strip' ? stripHtml(isOpen()) : '');
    if (s.on && s.meta) startPoll(); else stopPoll();
  }
  function placeC(live) {
    const el = live.querySelector('.mc-c, .mc-fab'); if (!el) return;
    const rest = live.querySelector('.lb-rest'), shown = rest && !rest.hidden && !rest.classList.contains('full');
    const h = shown ? rest.offsetHeight : 0;
    el.style.bottom = (h + (el.classList.contains('mc-fab') ? 14 : 0)) + 'px';
    el.classList.toggle('mc-edge', !shown);
  }
  function mountWorkout(live) {
    injectCss(); if (!live) return; liveHost = live; checkInstalled();
    const s = settings(), head = live.querySelector('.lb-live-head'), end = head && head.querySelector('.lb-headend');
    // icon: in the live header, left of the mic / Finish
    let slot = end && end.querySelector('.mc-head-slot');
    if (s.on && s.look === 'icon' && end) { if (!slot) { slot = global.document.createElement('span'); slot.className = 'mc-head-slot'; end.prepend(slot); } paintSlot(slot, iconHtml(false)); }
    else if (slot) slot.remove();
    // strip: right under the live header
    let st = live.querySelector(':scope > .mc-strip-host');
    if (s.on && s.look === 'strip' && head) { if (!st) { st = global.document.createElement('div'); st.className = 'mc-strip-host'; head.after(st); } paintSlot(st, stripHtml(isOpen())); }
    else if (st) st.remove();
    // workout-only: above the rest timer
    let c = live.querySelector(':scope > .mc-c, :scope > .mc-fab');
    if (s.on && s.look === 'workout') {
      const html = workoutHtml(isOpen());
      if (!c || c.outerHTML !== html) { if (c) c.remove(); const w = global.document.createElement('div'); w.innerHTML = html; c = w.firstElementChild; live.appendChild(c); }
      live.classList.toggle('mc-has-c', isOpen());
      placeC(live);
      const rest = live.querySelector('.lb-rest');
      if (rest && !restWatch && global.MutationObserver) { restWatch = new MutationObserver(() => placeC(live)); restWatch.observe(rest, { attributes: true, childList: true, subtree: true }); }
    } else { if (c) c.remove(); live.classList.remove('mc-has-c'); }
  }
  // The icon pop-up stays open across song changes and button presses: repaint it in place; only ✕, a tap
  // outside, Hide or a look change close it (Aziz, Nov 8).
  function refreshPanel() {
    if (!panel) return;
    const w = global.document.createElement('div'); w.innerHTML = panelHtml();
    const fresh = w.firstElementChild;
    if (panel.innerHTML !== fresh.innerHTML) panel.innerHTML = fresh.innerHTML;
  }
  function render() {
    const s = settings();
    if (panel && (!s.on || s.look !== 'icon')) closePanel(); else refreshPanel();
    if (headSlot || stripSlot) mountHeader(headSlot, stripSlot);
    if (liveHost && !liveHost.hidden) mountWorkout(liveHost);
  }

  function act(el) {
    const a = el.dataset.mc, s = settings();
    if (a === 'toggle') { if (el.classList.contains('mc-icon')) { if (panel) closePanel(); else openPanel(el); } else { setOpen(!isOpen()); render(); } return true; }
    if (a === 'close') { closePanel(); return true; }
    if (a === 'prev' || a === 'next') { press(a).then(() => setTimeout(poll, 700)); return true; }
    if (a === 'pp') { press('toggle').then(() => setTimeout(poll, 700)); return true; }
    if (a === 'access') { closePanel(); requestAccess(); return true; }
    if (a === 'playlist') { closePanel(); open(s.playlist || APP_URL); return true; }
    if (a === 'open') { closePanel(); open(APP_URL); return true; }
    if (a === 'hide') { closePanel(); setSettings({ on: false }); toast('Music controls are off. Turn them back on in Settings › Music.'); return true; }
    if (a === 'settings') { closePanel(); try { global.dispatchEvent(new CustomEvent('mc:settings')); } catch (e) { } return true; }
    return false;
  }
  function bind(root) { const r = root || global.document; if (!r || bound) return; bound = true; r.addEventListener('click', e => { const el = e.target.closest && e.target.closest('[data-mc]'); if (!el) return; e.preventDefault(); act(el); }); }
  function init(o) { o = o || {}; if (o.get) store.get = o.get; if (o.set) store.set = o.set; if (o.toast) toastFn = o.toast; injectCss(); }

  return { init, settings, setSettings, LOOKS, DEF, PKG, APP_URL, validPlaylist, press, open, bind, mountHeader, mountWorkout, render, nowPlaying, poll, enableMeta, requestAccess, _setNp(x) { np = x; }, html: { icon: iconHtml, panel: panelHtml, strip: stripHtml, workout: workoutHtml }, _act: act, _plugin: plugin };
})(typeof window !== 'undefined' ? window : globalThis);
if (typeof module !== 'undefined' && module.exports) module.exports = MusicControl;
