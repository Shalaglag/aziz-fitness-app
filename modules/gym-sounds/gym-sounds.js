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
 *
 * No DOM, no storage. Works in Node for tests (render/wav); play() needs Web Audio.
 */
(function (root) {
  // Partials: frequency ratio, loudness, how fast it fades (higher = shorter).
  const BELL = [[1, 1, 1], [2, 0.42, 1.6], [3.01, 0.2, 2.4], [4.2, 0.1, 3.4], [5.4, 0.05, 4.5]];
  const RING = [[1, 1, 1], [2.76, 0.5, 1.4], [5.4, 0.25, 2], [8.93, 0.1, 2.8]];          // boxing-ring bell, metallic
  const GONG = [[1, 1, 1], [1.48, 0.6, 1.3], [2.1, 0.45, 1.7], [2.9, 0.3, 2.2], [3.7, 0.2, 2.8]];
  const WOOD = [[1, 1, 1], [2.4, 0.4, 1.8], [4.1, 0.15, 2.6]];
  const SQUARE = [[1, 1], [3, 0.3], [5, 0.15]];                                            // held tones (beeps)
  const PARTIALS = { BELL, RING, GONG, WOOD };
  const strikes = (times, note) => times.map(t => Object.assign({ t }, note));
  // Struck notes: { t start s, f Hz, a loudness, d decay, p partial set }. Held tones: kind 'tone', hold s, vib [Hz, depth Hz], air (breath noise).
  const SOUNDS = {
    restDone: { len: 1.25, notes: [{ t: 0, f: 1568, a: 0.8, d: 9 }, { t: 0.17, f: 1568, a: 0.8, d: 9 }, { t: 0.34, f: 2093, a: 1, d: 3.6 }] },
    finish: { len: 1.6, notes: [{ t: 0, f: 1047, a: 0.75, d: 6 }, { t: 0.1, f: 1319, a: 0.75, d: 6 }, { t: 0.2, f: 1568, a: 0.8, d: 5 }, { t: 0.3, f: 2093, a: 1, d: 2.4 }, { t: 0.3, f: 523, a: 0.35, d: 2.2 }] },
    boxing: { len: 1.6, notes: strikes([0, 0.13, 0.26, 0.39], { f: 960, a: 1, d: 3.2, p: 'RING' }) },
    dingdong: { len: 1.7, notes: [{ t: 0, f: 1568, a: 1, d: 2.6 }, { t: 0.42, f: 1319, a: 0.95, d: 2.2 }] },
    beeps: { len: 1.0, notes: strikes([0, 0.2, 0.4], { kind: 'tone', f: 2000, a: 0.8, hold: 0.09 }).concat([{ t: 0.6, kind: 'tone', f: 2400, a: 1, hold: 0.3 }]) },
    whistle: { len: 1.0, notes: [{ t: 0, kind: 'tone', f: 2850, a: 0.9, hold: 0.14, vib: [32, 70], air: 0.06 }, { t: 0.24, kind: 'tone', f: 2850, a: 1, hold: 0.55, vib: [32, 70], air: 0.06 }] },
    gong: { len: 2.4, notes: [{ t: 0, f: 196, a: 1, d: 1.1, p: 'GONG' }, { t: 0, f: 392, a: 0.25, d: 1.6, p: 'BELL' }] },
    knock: { len: 0.8, notes: strikes([0, 0.16, 0.32], { f: 820, a: 1, d: 38, p: 'WOOD' }) }
  };
  const NAMES = Object.keys(SOUNDS);
  const REST_SOUNDS = [
    { id: 'restDone', label: 'Bell (Strong-style)' }, { id: 'boxing', label: 'Boxing bell' }, { id: 'dingdong', label: 'Ding-dong' },
    { id: 'beeps', label: 'Watch beeps' }, { id: 'whistle', label: 'Coach whistle' }, { id: 'gong', label: 'Gong' }, { id: 'knock', label: 'Wood knock' }
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
        const hold = Math.round(note.hold * sr), rel = Math.round(0.015 * sr), ta = Math.round(0.005 * sr);
        let ph = 0;
        for (let i = 0; i < hold + rel && start + i < n; i++) {
          const env = Math.min(1, i / ta) * (i < hold ? 1 : 1 - (i - hold) / rel);
          const f = note.f + (note.vib ? note.vib[1] * Math.sin(2 * Math.PI * note.vib[0] * i / sr) : 0);
          ph += 2 * Math.PI * f / sr;
          let v = 0;
          if (note.vib) v = Math.sin(ph);
          else for (const [ratio, amp] of SQUARE) if (note.f * ratio < sr / 2.2) v += amp * Math.sin(ph * ratio);
          out[start + i] += note.a * env * (v + (note.air ? note.air * noise() : 0));
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
  function play(name) {
    try {
      const c = context(); if (!c || !SOUNDS[name]) return false;
      if (!buffers[name]) { const x = render(name, c.sampleRate), buf = c.createBuffer(1, x.length, c.sampleRate); buf.getChannelData(0).set(x); buffers[name] = buf; }
      const src = c.createBufferSource(); src.buffer = buffers[name]; src.connect(c.destination); src.start();
      return true;
    } catch (e) { return false; }
  }

  const GymSounds = { NAMES, REST_SOUNDS, rawName, prime, play, render, wav };
  root.GymSounds = GymSounds;
  if (typeof module !== 'undefined' && module.exports) module.exports = GymSounds;
})(typeof window !== 'undefined' ? window : globalThis);
