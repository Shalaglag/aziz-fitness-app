/*
 * GymSounds: the logger's cues, in the style of Strong. These are original sounds synthesised
 * here, not copies of Strong's audio files.
 *   restDone: a bright ding-ding-DING when the rest timer reaches 0 (the default rest sound)
 *   finish:   a rising four-note chime when you press Finish
 *   REST_SOUNDS: every sound the rest timer can end with, [{ id, label }], picked in Settings
 *
 *   GymSounds.prime()          call from a tap (set tick, timer start) so Android lets audio play later
 *   GymSounds.play(name)       'restDone' | 'finish'; returns true if it played
 *   GymSounds.render(name, sr) Float32Array of samples (the same sound the app plays)
 *   GymSounds.wav(name, sr)    Uint8Array, a 16-bit mono WAV (used for the Android notification sound)
 *   GymSounds.rawName(id)      Android res/raw file for a rest sound ("rest_done.wav", "rest_boxing.wav", …)
 *   GymSounds.setCustom(file)  saves the user's own audio file (≤ 3 MB, kept on this device in IndexedDB);
 *                              resolves { name, seconds }. play('custom') plays it; clearCustom() removes it.
 *   GymSounds.customInfo()     { name, seconds } or null; loadCustom() reads it back after a restart.
 *
 * No DOM. Works in Node for tests (render/wav); play() needs Web Audio, the custom sound needs IndexedDB.
 */
(function (root) {
  // Partials: frequency ratio, loudness, how fast it fades (higher = shorter).
  const BELL = [[1, 1, 1], [2, 0.42, 1.6], [3.01, 0.2, 2.4], [4.2, 0.1, 3.4], [5.4, 0.05, 4.5]];
  const RING = [[1, 1, 1], [2.76, 0.5, 1.4], [5.4, 0.25, 2], [8.93, 0.1, 2.8]];          // boxing-ring bell, metallic
  const GONG = [[1, 1, 1], [1.48, 0.6, 1.3], [2.1, 0.45, 1.7], [2.9, 0.3, 2.2], [3.7, 0.2, 2.8]];
  const WOOD = [[1, 1, 1], [2.4, 0.4, 1.8], [4.1, 0.15, 2.6]];
  const SQUARE = [[1, 1], [3, 0.3], [5, 0.15]];                                            // held tones (beeps)
  const SAW = [[1, 1], [2, 0.5], [3, 0.33], [4, 0.25], [5, 0.2], [6, 0.16]];               // buzzy charge-ups
  const HUM = [[1, 1], [2, 0.6], [3, 0.35], [4, 0.2]];                                      // aura drone
  const HARMONICS = { SQUARE, SAW, HUM };
  // Measured from Aziz's recording (Nov 1, 2026): inharmonic partials over a 743 Hz base, two strikes 0.19 s apart.
  const DOUBLE = [[1, 0.6, 1], [1.754, 1, 0.9], [2.652, 0.4, 1.7], [3.565, 0.45, 1.4], [5.652, 0.35, 2.3], [8.06, 0.45, 3.4]];
  const PARTIALS = { BELL, RING, GONG, WOOD, DOUBLE };
  const strikes = (times, note) => times.map(t => Object.assign({ t }, note));
  // Struck notes: { t start s, f Hz, a loudness, d decay, p partial set }. Held tones: kind 'tone', hold s, vib [Hz, depth Hz], air (breath noise),
  // f1 (glide to this Hz), h (harmonic set), grow (swell: loudness rises as (i/hold)^grow), trem [Hz, depth 0-1].
  // Noise bursts: kind 'noise', d decay, lp (0-1, lower = darker), grow, hold (s before the decay starts).
  const SOUNDS = {
    restDone: { len: 1.25, notes: [{ t: 0, f: 1568, a: 0.8, d: 9 }, { t: 0.17, f: 1568, a: 0.8, d: 9 }, { t: 0.34, f: 2093, a: 1, d: 3.6 }] },
    finish: { len: 1.6, notes: [{ t: 0, f: 1047, a: 0.75, d: 6 }, { t: 0.1, f: 1319, a: 0.75, d: 6 }, { t: 0.2, f: 1568, a: 0.8, d: 5 }, { t: 0.3, f: 2093, a: 1, d: 2.4 }, { t: 0.3, f: 523, a: 0.35, d: 2.2 }] },
    boxing: { len: 1.6, notes: strikes([0, 0.13, 0.26, 0.39], { f: 960, a: 1, d: 3.2, p: 'RING' }) },
    dingdong: { len: 1.7, notes: [{ t: 0, f: 1568, a: 1, d: 2.6 }, { t: 0.42, f: 1319, a: 0.95, d: 2.2 }] },
    beeps: { len: 1.0, notes: strikes([0, 0.2, 0.4], { kind: 'tone', f: 2000, a: 0.8, hold: 0.09 }).concat([{ t: 0.6, kind: 'tone', f: 2400, a: 1, hold: 0.3 }]) },
    whistle: { len: 1.0, notes: [{ t: 0, kind: 'tone', f: 2850, a: 0.9, hold: 0.14, vib: [32, 70], air: 0.06 }, { t: 0.24, kind: 'tone', f: 2850, a: 1, hold: 0.55, vib: [32, 70], air: 0.06 }] },
    gong: { len: 2.4, notes: [{ t: 0, f: 196, a: 1, d: 1.1, p: 'GONG' }, { t: 0, f: 392, a: 0.25, d: 1.6, p: 'BELL' }] },
    doubleDing: { len: 1.0, notes: strikes([0, 0.19], { f: 743, a: 1, d: 4.4, p: 'DOUBLE' }) },
    knock: { len: 0.8, notes: strikes([0, 0.16, 0.32], { f: 820, a: 1, d: 38, p: 'WOOD' }) },
    // Anime-style pack: original effects, no voices or clips from any show.
    powerup: { len: 2.1, notes: [{ t: 0, kind: 'tone', f: 110, f1: 880, h: 'SAW', a: 0.7, hold: 1.3, grow: 2, trem: [18, 0.35] }, { t: 0, kind: 'noise', a: 0.35, lp: 0.08, hold: 1.25, grow: 2, d: 30 }, { t: 1.3, f: 1760, a: 1, d: 2.4 }, { t: 1.3, kind: 'noise', a: 0.5, lp: 0.25, d: 9 }] },
    blast: { len: 1.9, notes: [{ t: 0, kind: 'tone', f: 260, f1: 1400, h: 'SAW', a: 0.55, hold: 0.55, grow: 1.5 }, { t: 0.55, kind: 'noise', a: 1, lp: 0.35, d: 3.2 }, { t: 0.55, kind: 'tone', f: 140, f1: 38, a: 1, hold: 0.45 }, { t: 0.55, kind: 'noise', a: 0.6, lp: 0.04, d: 2.2 }] },
    aura: { len: 1.9, notes: [{ t: 0, kind: 'tone', f: 98, h: 'HUM', a: 0.9, hold: 1.6, grow: 0.6, trem: [9, 0.45] }, { t: 0, kind: 'tone', f: 147, h: 'HUM', a: 0.45, hold: 1.6, grow: 0.8, trem: [11, 0.5] }, { t: 0, kind: 'noise', a: 0.25, lp: 0.05, hold: 1.5, grow: 1, d: 25 }] },
    scouter: { len: 1.2, notes: [1800, 2000, 2200, 2400, 2600, 2800, 3000, 3200].map((f, i) => ({ t: i * 0.07, kind: 'tone', f, a: 0.55, hold: 0.04 })).concat([{ t: 0.6, kind: 'noise', a: 1, lp: 0.6, d: 22 }, { t: 0.6, f: 2600, a: 0.5, d: 14, p: 'RING' }]) },
    teleport: { len: 0.7, notes: [{ t: 0, kind: 'tone', f: 2600, f1: 500, a: 0.8, hold: 0.12, h: 'SQUARE' }, { t: 0.16, kind: 'tone', f: 500, f1: 2600, a: 0.8, hold: 0.12, h: 'SQUARE' }, { t: 0.16, kind: 'noise', a: 0.3, lp: 0.5, d: 30 }] },
    impact: { len: 1.6, notes: [{ t: 0, kind: 'tone', f: 170, f1: 42, a: 1, hold: 0.3 }, { t: 0, kind: 'noise', a: 0.9, lp: 0.2, d: 9 }, { t: 0.02, f: 420, a: 0.45, d: 2.4, p: 'RING' }] }
  };
  const NAMES = Object.keys(SOUNDS);
  const REST_SOUNDS = [
    { id: 'doubleDing', label: 'Double ding (yours)' }, { id: 'restDone', label: 'Bell (Strong-style)' }, { id: 'boxing', label: 'Boxing bell' }, { id: 'dingdong', label: 'Ding-dong' },
    { id: 'beeps', label: 'Watch beeps' }, { id: 'whistle', label: 'Coach whistle' }, { id: 'gong', label: 'Gong' }, { id: 'knock', label: 'Wood knock' },
    { id: 'powerup', label: 'Power-up', pack: 'anime' }, { id: 'blast', label: 'Energy blast', pack: 'anime' }, { id: 'aura', label: 'Aura charge', pack: 'anime' },
    { id: 'scouter', label: 'Scouter', pack: 'anime' }, { id: 'teleport', label: 'Teleport', pack: 'anime' }, { id: 'impact', label: 'Big hit', pack: 'anime' }
  ];
  const rawName = id => (id === 'restDone' ? 'rest_done' : 'rest_' + String(id).toLowerCase()) + '.wav';

  function render(name, sr) {
    const s = SOUNDS[name]; if (!s) throw new Error('unknown sound ' + name);
    sr = sr || 44100;
    const n = Math.round(s.len * sr), out = new Float32Array(n), atk = 0.004 * sr;
    let seed = 7; const noise = () => { seed = (seed * 16807) % 2147483647; return seed / 1073741823.5 - 1; };   // fixed noise: same samples every render
    for (const note of s.notes) {
      const start = Math.round(note.t * sr);
      if (note.kind === 'tone') {
        const hold = Math.round(note.hold * sr), rel = Math.round(0.015 * sr), ta = Math.round(0.005 * sr), harm = HARMONICS[note.h || 'SQUARE'];
        let ph = 0;
        for (let i = 0; i < hold + rel && start + i < n; i++) {
          const x = Math.min(1, i / hold);
          let env = Math.min(1, i / ta) * (i < hold ? 1 : 1 - (i - hold) / rel);
          if (note.grow) env *= 0.08 + 0.92 * Math.pow(x, note.grow);
          if (note.trem) env *= 1 - note.trem[1] * (0.5 + 0.5 * Math.sin(2 * Math.PI * note.trem[0] * i / sr));
          const base = note.f1 ? note.f * Math.pow(note.f1 / note.f, x) : note.f;
          const f = base + (note.vib ? note.vib[1] * Math.sin(2 * Math.PI * note.vib[0] * i / sr) : 0);
          ph += 2 * Math.PI * f / sr;
          let v = 0;
          if (note.vib) v = Math.sin(ph);
          else for (const [ratio, amp] of harm) if (f * ratio < sr / 2.2) v += amp * Math.sin(ph * ratio);
          out[start + i] += note.a * env * (v + (note.air ? note.air * noise() : 0));
        }
        continue;
      }
      if (note.kind === 'noise') {
        const hold = Math.round((note.hold || 0) * sr), k = note.d / sr, ta = Math.round(0.003 * sr);
        let y = 0;
        for (let i = 0; start + i < n; i++) {
          let env = Math.min(1, i / ta) * (i < hold ? 1 : Math.exp(-k * (i - hold)));
          if (note.grow && hold) env *= 0.05 + 0.95 * Math.pow(Math.min(1, i / hold), note.grow);
          if (env < 1e-4 && i > hold + ta) break;
          y += note.lp * (noise() - y);
          out[start + i] += note.a * env * y * 3;
        }
        continue;
      }
      for (const [ratio, amp, fade] of PARTIALS[note.p || 'BELL']) {
        const f = note.f * ratio; if (f > sr / 2.2) continue;     // stay under Nyquist
        const w = 2 * Math.PI * f / sr, k = note.d * fade / sr;
        for (let i = 0; start + i < n; i++) {
          const env = Math.min(1, i / atk) * Math.exp(-k * i);
          if (env < 1e-4 && i > atk) break;
          out[start + i] += note.a * amp * env * Math.sin(w * i);
        }
      }
    }
    let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
    const g = peak ? 0.85 / peak : 0, tail = Math.round(0.03 * sr);
    for (let i = 0; i < n; i++) out[i] *= g * Math.min(1, (n - 1 - i) / tail);   // short fade-out, no click
    return out;
  }

  function wav(name, sr) {
    sr = sr || 22050;
    const x = render(name, sr), b = new Uint8Array(44 + x.length * 2), v = new DataView(b.buffer);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) b[o + i] = s.charCodeAt(i); };
    str(0, 'RIFF'); v.setUint32(4, 36 + x.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true);
    v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, x.length * 2, true);
    for (let i = 0; i < x.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x[i])) * 32767, true);
    return b;
  }

  let ctx = null; const buffers = {};
  function context() {
    const AC = root.AudioContext || root.webkitAudioContext; if (!AC) return null;
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(() => {});
    return ctx;
  }
  function prime() { try { return !!context(); } catch (e) { return false; } }
  // ---- The user's own sound (IndexedDB, this device only; never synced or backed up) ----
  const DB = 'gym-sounds', STORE = 'custom', MAX_BYTES = 3 * 1024 * 1024, MAX_SECONDS = 20;
  let custom = null; // { name, seconds, bytes: ArrayBuffer }
  function idb() {
    return new Promise((ok, no) => {
      const IDB = root.indexedDB; if (!IDB) return no(new Error('This browser cannot store files.'));
      const r = IDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
    });
  }
  function tx(mode, fn) { return idb().then(db => new Promise((ok, no) => { const t = db.transaction(STORE, mode), q = fn(t.objectStore(STORE)); t.oncomplete = () => ok(q && q.result); t.onerror = () => no(t.error); })); }
  function decode(bytes) {
    const c = context(); if (!c) return Promise.reject(new Error('This phone cannot play sounds here.'));
    return new Promise((ok, no) => { const p = c.decodeAudioData(bytes.slice(0), ok, no); if (p && p.then) p.then(ok, no); });
  }
  function readFile(file) {
    if (file.arrayBuffer) return file.arrayBuffer();
    return new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = () => no(fr.error); fr.readAsArrayBuffer(file); });
  }
  function setCustom(file) {
    if (!file) return Promise.reject(new Error('No file chosen.'));
    if (file.size > MAX_BYTES) return Promise.reject(new Error('That file is over 3 MB. Pick a shorter clip.'));
    return readFile(file).then(bytes => decode(bytes).then(buf => {
      const rec = { name: String(file.name || 'My sound').slice(0, 60), seconds: Math.round(Math.min(buf.duration, MAX_SECONDS) * 10) / 10, bytes };
      buffers.custom = buf;
      return tx('readwrite', s => s.put(rec, 'rest')).then(() => { custom = rec; return customInfo(); });
    }, () => { throw new Error("That file isn't a sound this phone can play. Try an MP3, M4A or WAV."); }));
  }
  function loadCustom() {
    return tx('readonly', s => s.get('rest')).then(rec => {
      custom = rec || null; delete buffers.custom;
      if (!custom) return null;
      return decode(custom.bytes).then(buf => { buffers.custom = buf; return customInfo(); }, () => customInfo());
    }).catch(() => null);
  }
  function clearCustom() { custom = null; delete buffers.custom; return tx('readwrite', s => s.delete('rest')).catch(() => {}); }
  function customInfo() { return custom ? { name: custom.name, seconds: custom.seconds } : null; }

  function play(name) {
    try {
      if (name === 'custom') {
        const c = context(), b = buffers.custom; if (!c || !b) return false;
        const src = c.createBufferSource(); src.buffer = b; src.connect(c.destination); src.start(0, 0, Math.min(b.duration, MAX_SECONDS));
        return true;
      }
      const c = context(); if (!c || !SOUNDS[name]) return false;
      if (!buffers[name]) { const x = render(name, c.sampleRate), buf = c.createBuffer(1, x.length, c.sampleRate); buf.getChannelData(0).set(x); buffers[name] = buf; }
      const src = c.createBufferSource(); src.buffer = buffers[name]; src.connect(c.destination); src.start();
      return true;
    } catch (e) { return false; }
  }

  const GymSounds = { NAMES, REST_SOUNDS, rawName, prime, play, render, wav, setCustom, loadCustom, clearCustom, customInfo };
  if (root.indexedDB && (root.AudioContext || root.webkitAudioContext)) loadCustom();
  root.GymSounds = GymSounds;
  if (typeof module !== 'undefined' && module.exports) module.exports = GymSounds;
})(typeof window !== 'undefined' ? window : globalThis);
