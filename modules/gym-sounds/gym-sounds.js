/*
 * GymSounds: the logger's two cues, in the style of Strong. These are original sounds synthesised
 * here, not copies of Strong's audio files.
 *   restDone: a bright ding-ding-DING when the rest timer reaches 0
 *   finish:   a rising four-note chime when you press Finish
 *
 *   GymSounds.prime()          call from a tap (set tick, timer start) so Android lets audio play later
 *   GymSounds.play(name)       'restDone' | 'finish'; returns true if it played
 *   GymSounds.render(name, sr) Float32Array of samples (the same sound the app plays)
 *   GymSounds.wav(name, sr)    Uint8Array, a 16-bit mono WAV (used for the Android notification sound)
 *
 * No DOM, no storage. Works in Node for tests (render/wav); play() needs Web Audio.
 */
(function (root) {
  // Bell partials: frequency ratio, loudness, how fast it fades (higher = shorter).
  const BELL = [[1, 1, 1], [2, 0.42, 1.6], [3.01, 0.2, 2.4], [4.2, 0.1, 3.4], [5.4, 0.05, 4.5]];
  const SOUNDS = {
    restDone: { len: 1.25, notes: [{ t: 0, f: 1568, a: 0.8, d: 9 }, { t: 0.17, f: 1568, a: 0.8, d: 9 }, { t: 0.34, f: 2093, a: 1, d: 3.6 }] },
    finish: { len: 1.6, notes: [{ t: 0, f: 1047, a: 0.75, d: 6 }, { t: 0.1, f: 1319, a: 0.75, d: 6 }, { t: 0.2, f: 1568, a: 0.8, d: 5 }, { t: 0.3, f: 2093, a: 1, d: 2.4 }, { t: 0.3, f: 523, a: 0.35, d: 2.2 }] }
  };
  const NAMES = Object.keys(SOUNDS);

  function render(name, sr) {
    const s = SOUNDS[name]; if (!s) throw new Error('unknown sound ' + name);
    sr = sr || 44100;
    const n = Math.round(s.len * sr), out = new Float32Array(n), atk = 0.004 * sr;
    for (const note of s.notes) {
      const start = Math.round(note.t * sr);
      for (const [ratio, amp, fade] of BELL) {
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

  const GymSounds = { NAMES, prime, play, render, wav };
  root.GymSounds = GymSounds;
  if (typeof module !== 'undefined' && module.exports) module.exports = GymSounds;
})(typeof window !== 'undefined' ? window : globalThis);
