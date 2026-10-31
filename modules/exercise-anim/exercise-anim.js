/* ExerciseAnim: built-in 3D animated exercise demos. An original mannequin rig (two-bone IK
   for arms and legs) drawn on a canvas with depth-sorted, shaded shapes. No images, no
   libraries, no network, so it works offline. Each exercise is authored on its own: key
   poses, equipment and the muscles to highlight. An exercise with no definition gets no
   animation; nothing is guessed from a similar name.
   Usage: const anim = ExerciseAnim.create(); anim.has(id); anim.cardHtml(id); anim.attach(document);
          anim.open(id) shows it full screen. */
(function (root) {
  'use strict';

  // ---------- vectors ----------
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = a => Math.hypot(a[0], a[1], a[2]);
  const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const mid = (a, b) => mul(add(a, b), 0.5);
  const rotX = (v, r) => [v[0], v[1] * Math.cos(r) - v[2] * Math.sin(r), v[1] * Math.sin(r) + v[2] * Math.cos(r)];
  const deg = d => d * Math.PI / 180;

  // ---------- body (metres) ----------
  const B = { hipW: 0.09, shW: 0.19, spine: 0.52, upper: 0.29, fore: 0.27, hand: 0.08, thigh: 0.44, shin: 0.43, foot: 0.17 };

  // Two-bone IK: root S, target T, bone lengths a and b, pole = direction the middle joint bends toward.
  function ik(S, T, a, b, pole) {
    const d = sub(T, S), dist = len(d), dir = norm(d);
    const reach = a + b - 1e-4, dd = Math.max(Math.min(dist, reach), Math.abs(a - b) + 1e-3);
    const cosA = Math.min(1, Math.max(-1, (a * a + dd * dd - b * b) / (2 * a * dd)));
    let p = sub(pole, mul(dir, dot(pole, dir)));
    if (len(p) < 1e-4) p = Math.abs(dir[1]) < 0.9 ? cross(dir, [0, 1, 0]) : cross(dir, [1, 0, 0]);
    p = norm(p);
    const m = add(add(S, mul(dir, a * cosA)), mul(p, a * Math.sqrt(1 - cosA * cosA)));
    return { mid: m, end: add(S, mul(dir, dd)), err: Math.max(0, dist - reach) };
  }

  // ---------- poses ----------
  const BASE = { pelvis: [0, 0.99, 0], up: [0, 1, 0], fwd: [0, 0, 1], shrug: 0,
    hands: { L: [0.23, 0.93, 0.04] }, elbows: { L: [0.2, -0.3, -1] }, feet: { L: [0.12, 0.08, 0] }, knees: { L: [0.15, 0, 1] }, footDir: null, handDir: null };
  const mirror = v => Array.isArray(v) ? [-v[0], v[1], v[2]] : (v && v.t ? { t: [-v.t[0], v.t[1], v.t[2]] } : v);
  function full(p) {
    const o = Object.assign({}, BASE, p);
    ['hands', 'elbows', 'feet', 'knees', 'footDir', 'handDir'].forEach(k => {
      const v = p[k] || BASE[k];
      if (!v) { o[k] = null; return; }
      o[k] = Object.assign({}, v);
      if (!o[k].R && o[k].L) o[k].R = mirror(o[k].L);
    });
    return o;
  }
  function mix(a, b, t) {
    if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * t;
    if (Array.isArray(a) && Array.isArray(b)) return a.map((x, i) => x + (b[i] - x) * t);
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      const o = {};
      new Set(Object.keys(a).concat(Object.keys(b))).forEach(k => { o[k] = (k in a && k in b) ? mix(a[k], b[k], t) : (k in a ? a[k] : b[k]); });
      return o;
    }
    return t < 0.5 ? a : b;
  }
  // One rep: hold A, move to B (c of the cycle), hold B, return to A over the rest.
  function rep(A, B2, o) {
    o = o || {};
    const h0 = o.h0 == null ? 0.06 : o.h0, c = o.c == null ? 0.4 : o.c, h1 = o.h1 == null ? 0.08 : o.h1;
    return [{ at: 0, p: A }, { at: h0, p: A }, { at: h0 + c, p: B2 }, { at: h0 + c + h1, p: B2 }];
  }
  const smooth = t => t * t * (3 - 2 * t);

  function sample(def, t) {
    const k = def.keys, n = k.length;
    t = ((t % 1) + 1) % 1;
    let i = n - 1;
    for (let j = 0; j < n; j++) if (k[j].at <= t) i = j;
    const a = k[i], b = k[(i + 1) % n], end = i + 1 < n ? b.at : 1;
    const u = end > a.at ? (t - a.at) / (end - a.at) : 0;
    return mix(a.full, b.full, def.ease === 'linear' ? u : smooth(u));
  }

  function skeleton(p) {
    const up = norm(p.up);
    const f = norm(sub(p.fwd, mul(up, dot(p.fwd, up))));
    const side = cross(up, f), P = p.pelvis;
    const at = v => Array.isArray(v) ? v : add(add(add(P, mul(side, v.t[0])), mul(up, v.t[1])), mul(f, v.t[2]));
    const neckB = add(P, mul(up, B.spine));
    const sk = { P, up, f, side, neckB, chest: add(P, mul(up, B.spine * 0.55)), head: add(neckB, mul(up, 0.17)), err: 0,
      sh: {}, el: {}, wr: {}, hand: {}, grip: {}, hip: {}, kn: {}, an: {}, toe: {}, fd: {} };
    const flat = norm([f[0], 0, f[2]].every(x => Math.abs(x) < 1e-6) ? [0, 0, 1] : [f[0], 0, f[2]]);
    [['L', 1], ['R', -1]].forEach(([k, s]) => {
      const sh = add(add(neckB, mul(side, s * B.shW)), mul(up, -0.035 + (p.shrug || 0)));
      const arm = ik(sh, at(p.hands[k]), B.upper, B.fore, p.elbows[k]);
      const fdir = norm(sub(arm.end, arm.mid)), hdir = p.handDir && p.handDir[k] ? norm(p.handDir[k]) : fdir;
      sk.sh[k] = sh; sk.el[k] = arm.mid; sk.wr[k] = arm.end;
      sk.hand[k] = add(arm.end, mul(hdir, B.hand)); sk.grip[k] = add(arm.end, mul(hdir, 0.055));
      const hip = add(add(P, mul(side, s * B.hipW)), mul(up, -0.05));
      const leg = ik(hip, at(p.feet[k]), B.thigh, B.shin, p.knees[k]);
      const fd = norm(p.footDir && p.footDir[k] ? p.footDir[k] : flat);
      sk.hip[k] = hip; sk.kn[k] = leg.mid; sk.an[k] = leg.end; sk.fd[k] = fd; sk.toe[k] = add(leg.end, mul(fd, B.foot));
      sk.err = Math.max(sk.err, arm.err, leg.err);
    });
    return sk;
  }

  // ---------- shapes ----------
  const cap = (a, b, ra, rb, col) => ({ k: 'cap', a, b, ra, rb: rb == null ? ra : rb, col });
  const sph = (c, r, col) => ({ k: 'sph', c, r, col });
  const disc = (c, n, r, col) => ({ k: 'disc', c, n: norm(n), r, col });
  const line = (a, b, col) => ({ k: 'line', a, b, col: col || 'cable' });
  // Box from a centre, a size and an optional tilt (radians) about x.
  function box(c, size, col, tilt) {
    let ax = [[size[0] / 2, 0, 0], [0, size[1] / 2, 0], [0, 0, size[2] / 2]];
    if (tilt) ax = ax.map(v => rotX(v, tilt));
    return { k: 'box', c, ax, col };
  }
  const obox = (c, ax, col) => ({ k: 'box', c, ax, col });

  function bodyShapes(sk, hi) {
    const H = new Set(hi || []), c = t => H.has(t) ? 'hi' : 'body', out = [];
    const { P, up, neckB, head } = sk, waist = add(P, mul(up, 0.2));
    out.push(sph(P, 0.115, c('pelvis')));
    out.push(cap(P, waist, 0.115, 0.115, c('abs')));
    out.push(cap(waist, add(neckB, mul(up, -0.07)), 0.12, 0.14, c('torso')));
    out.push(cap(sk.sh.L, sk.sh.R, 0.06, 0.06, c('torso')));
    out.push(cap(neckB, add(neckB, mul(up, 0.08)), 0.045, 0.045, 'body'));
    out.push(sph(head, 0.1, 'body'));
    ['L', 'R'].forEach(k => {
      out.push(sph(sk.sh[k], 0.068, c('delts')));
      out.push(cap(sk.sh[k], sk.el[k], 0.055, 0.045, c('arms')));
      out.push(cap(sk.el[k], sk.wr[k], 0.044, 0.033, c('forearms')));
      out.push(cap(sk.wr[k], sk.hand[k], 0.033, 0.03, 'body'));
      out.push(cap(sk.hip[k], sk.kn[k], 0.082, 0.056, c('thighs')));
      out.push(cap(sk.kn[k], sk.an[k], 0.056, 0.04, c('calves')));
      out.push(cap(add(sk.an[k], mul(sk.fd[k], -0.04)), sk.toe[k], 0.04, 0.03, 'body'));
    });
    return out;
  }

  // ---------- equipment helpers ----------
  const E = {
    barbell(a, b, o) {
      o = o || {};
      const c = mid(a, b), d = norm(sub(b, a)), L = (o.len || 2.0) / 2, pl = o.plateAt || 0.82;
      const out = [cap(add(c, mul(d, -L)), add(c, mul(d, L)), 0.016, 0.016, 'metal')];
      if (o.plates !== false) [-1, 1].forEach(s => { out.push(disc(add(c, mul(d, s * pl)), d, o.r || 0.2, 'plate')); out.push(disc(add(c, mul(d, s * (pl + 0.04))), d, (o.r || 0.2) * 0.85, 'plate')); });
      return out;
    },
    bar: (a, b, ext) => { const d = norm(sub(b, a)), e = ext == null ? 0.08 : ext; return [cap(add(a, mul(d, -e)), add(b, mul(d, e)), 0.017, 0.017, 'metal')]; },
    dumbbell(c, axis) {
      const d = norm(axis);
      return [cap(add(c, mul(d, -0.1)), add(c, mul(d, 0.1)), 0.017, 0.017, 'metal'),
        cap(add(c, mul(d, -0.11)), add(c, mul(d, -0.17)), 0.06, 0.06, 'plate'), cap(add(c, mul(d, 0.11)), add(c, mul(d, 0.17)), 0.06, 0.06, 'plate')];
    },
    handle: (c, axis) => { const d = norm(axis); return [cap(add(c, mul(d, -0.07)), add(c, mul(d, 0.07)), 0.02, 0.02, 'metal')]; },
    pulley: (at, h) => [box([at[0], (h || 2.2) / 2, at[2]], [0.12, h || 2.2, 0.12], 'frame'), sph(at, 0.045, 'metal')],
    rope(anchor, a, b) { const k = add(mid(a, b), mul(norm(sub(anchor, mid(a, b))), 0.1)); return [line(anchor, k), line(k, a), line(k, b), sph(k, 0.02, 'metal')]; },
    seat: (y, z, w) => [box([0, y - 0.05, z || 0.05], [w || 0.4, 0.09, 0.45], 'pad'), box([0, (y - 0.1) / 2, z || 0.05], [0.07, y - 0.1, 0.07], 'frame')],
    back: (c, h, tilt) => [box(c, [0.38, h || 0.6, 0.07], 'pad', tilt || 0)],
    // A pad attached to the torso: offsets along side, up and forward.
    torsoPad: (sk, o, half, col) => [obox(add(add(add(sk.P, mul(sk.side, o[0])), mul(sk.up, o[1])), mul(sk.f, o[2])), [mul(sk.side, half[0]), mul(sk.up, half[1]), mul(sk.f, half[2])], col || 'pad')],
    // Roller pad across both shins, offset from the ankles by n (world vector).
    roller: (sk, n, r) => { const a = add(sk.an.L, n), b = add(sk.an.R, n), d = norm(sub(b, a)); return [cap(add(a, mul(d, -0.08)), add(b, mul(d, 0.08)), r || 0.05, r || 0.05, 'pad')]; },
    bench: (z0, z1, h, w) => [box([0, (h || 0.45) - 0.05, (z0 + z1) / 2], [w || 0.32, 0.1, z1 - z0], 'pad'),
      box([0, ((h || 0.45) - 0.1) / 2, z0 + 0.15], [0.26, (h || 0.45) - 0.1, 0.06], 'frame'), box([0, ((h || 0.45) - 0.1) / 2, z1 - 0.15], [0.26, (h || 0.45) - 0.1, 0.06], 'frame')],
    upright: (x, z, h) => [box([x, (h || 2) / 2, z], [0.08, h || 2, 0.08], 'frame')]
  };

  // ---------- exercise library ----------
  // ids are workout-logger exercise ids. eq is the logger's equipment category (checked in tests).
  const SEAT = { pelvis: [0, 0.58, 0], up: [0, 1, -0.05], feet: { L: [0.16, 0.08, 0.45] }, knees: { L: [0, 0.5, 1] } };
  const seated = o => Object.assign({}, SEAT, o);
  const DEFS = {
    'bench-press-barbell': { name: 'Bench Press (Barbell)', eq: 'Barbell', hi: ['torso'], cam: { yaw: 0.95, pitch: 0.3 },
      keys: rep({ pelvis: [0, 0.58, 0.1], up: [0, 0.08, -1], fwd: [0, 1, 0], hands: { L: [0.28, 1.14, -0.36] }, elbows: { L: [1, -0.8, 0.2] }, feet: { L: [0.3, 0.08, 0.55] }, knees: { L: [0.3, 1, 0] }, footDir: { L: [0.2, 0, 1] } },
        { pelvis: [0, 0.58, 0.1], up: [0, 0.08, -1], fwd: [0, 1, 0], hands: { L: [0.28, 0.8, -0.2] }, elbows: { L: [1, -0.8, 0.2] }, feet: { L: [0.3, 0.08, 0.55] }, knees: { L: [0.3, 1, 0] }, footDir: { L: [0.2, 0, 1] } }, { c: 0.45 }),
      props: sk => E.bench(-0.9, 0.45).concat(E.barbell(sk.grip.L, sk.grip.R)) },

    'incline-bench-press-dumbbell': { name: 'Incline Bench Press (Dumbbell)', eq: 'Dumbbell', hi: ['torso'], cam: { yaw: 0.9, pitch: 0.15 },
      keys: rep(
        { pelvis: [0, 0.6, 0.12], up: [0, 0.77, -0.64], fwd: [0, 0.64, 0.77], hands: { L: [0.12, 1.31, 0.21] }, elbows: { L: [1, -0.6, -0.3] }, feet: { L: [0.25, 0.08, 0.62] }, knees: { L: [0, 0.5, 1] } },
        { pelvis: [0, 0.6, 0.12], up: [0, 0.77, -0.64], fwd: [0, 0.64, 0.77], hands: { L: [0.34, 1.05, -0.1] }, elbows: { L: [1, -0.6, -0.3] }, feet: { L: [0.25, 0.08, 0.62] }, knees: { L: [0, 0.5, 1] } }, { c: 0.45 }),
      props: sk => E.seat(0.5, 0.12).concat(E.torsoPad(sk, [0, 0.33, -0.15], [0.19, 0.36, 0.035]), E.dumbbell(sk.grip.L, [1, 0, 0]), E.dumbbell(sk.grip.R, [1, 0, 0])) },

    'gundam-chest-press-machine': { name: 'Gundam Chest Press (Machine)', eq: 'Machine', hi: ['torso'], note: 'Generic seated chest press. Your machine may differ.',
      keys: rep(seated({ up: [0, 1, -0.06], hands: { L: [0.27, 1.0, 0.15] }, elbows: { L: [1, -0.5, -0.6] } }), seated({ up: [0, 1, -0.06], hands: { L: [0.17, 1.03, 0.52] }, elbows: { L: [1, -0.5, -0.6] } })),
      props: sk => E.seat(0.5, 0).concat(E.back([0, 0.95, -0.17], 0.6), E.upright(0.45, -0.2, 1.65), E.upright(-0.45, -0.2, 1.65),
        ['L', 'R'].flatMap(k => E.handle(sk.grip[k], [0, 1, 0]).concat([cap([k === 'L' ? 0.45 : -0.45, 1.6, -0.15], add(sk.grip[k], [0, 0.07, 0]), 0.02, 0.02, 'metal')]))) },

    'cable-crossover': { name: 'Cable Crossover', eq: 'Cable', hi: ['torso'], cam: { yaw: 0.6, pitch: 0.15 },
      keys: rep(
        { pelvis: [0, 0.97, 0], up: [0, 1, 0.18], hands: { L: [0.72, 1.42, -0.05] }, elbows: { L: [0, -0.5, -1] }, feet: { L: [0.14, 0.08, 0.22], R: [-0.14, 0.08, -0.22] }, knees: { L: [0.1, 0, 1], R: [-0.1, 0, 1] } },
        { pelvis: [0, 0.97, 0], up: [0, 1, 0.18], hands: { L: [0.07, 1.12, 0.47] }, elbows: { L: [0, -0.5, -1] }, feet: { L: [0.14, 0.08, 0.22], R: [-0.14, 0.08, -0.22] }, knees: { L: [0.1, 0, 1], R: [-0.1, 0, 1] } }),
      props: sk => [].concat(E.pulley([1.05, 1.95, -0.12]), E.pulley([-1.05, 1.95, -0.12]), [line([1.05, 1.95, -0.12], sk.grip.L), line([-1.05, 1.95, -0.12], sk.grip.R)], E.handle(sk.grip.L, [0, 1, 0]), E.handle(sk.grip.R, [0, 1, 0])) },

    'seated-overhead-press-dumbbell': { name: 'Seated Overhead Press (Dumbbell)', eq: 'Dumbbell', hi: ['delts'],
      keys: rep(seated({ up: [0, 1, -0.04], hands: { L: [0.3, 1.13, 0.05] }, elbows: { L: [1, -0.6, 0.1] } }), seated({ up: [0, 1, -0.04], hands: { L: [0.15, 1.6, 0] }, elbows: { L: [1, -0.6, 0.1] } })),
      props: sk => E.seat(0.5, 0).concat(E.back([0, 0.98, -0.17], 0.7), E.dumbbell(sk.grip.L, [1, 0, 0]), E.dumbbell(sk.grip.R, [1, 0, 0])) },

    'lateral-raise-cable': { name: 'Lateral Raise (Cable)', eq: 'Cable', hi: ['delts'], cam: { yaw: 0.35, pitch: 0.12 },
      keys: rep(
        { up: [0, 1, 0.03], hands: { L: [0, 0.98, 0.14], R: [-0.45, 1.2, 0.05] }, elbows: { L: [0, -0.3, -1], R: [-0.2, -1, 0] }, feet: { L: [0.14, 0.08, 0], R: [-0.14, 0.08, 0] } },
        { up: [0, 1, 0.03], hands: { L: [0.7, 1.42, 0.08], R: [-0.45, 1.2, 0.05] }, elbows: { L: [0, -0.3, -1], R: [-0.2, -1, 0] }, feet: { L: [0.14, 0.08, 0], R: [-0.14, 0.08, 0] } }),
      props: sk => E.pulley([-0.6, 0.15, 0.05]).concat([line([-0.6, 0.15, 0.05], sk.grip.L)], E.handle(sk.grip.L, [0, 0, 1])) },

    'lateral-raise-dumbbell': { name: 'Lateral Raise (Dumbbell)', eq: 'Dumbbell', hi: ['delts'], cam: { yaw: 0.35, pitch: 0.12 },
      keys: rep({ hands: { L: [0.25, 0.93, 0.05] }, elbows: { L: [0, -0.3, -1] } }, { hands: { L: [0.72, 1.42, 0.06] }, elbows: { L: [0, -0.3, -1] } }),
      props: sk => E.dumbbell(sk.grip.L, [0, 0, 1]).concat(E.dumbbell(sk.grip.R, [0, 0, 1])) },

    'standing-lateral-raise-machine': { name: 'Standing Lateral Raise (Machine)', eq: 'Machine', hi: ['delts'], cam: { yaw: 0.45, pitch: 0.15 },
      keys: rep({ hands: { L: [0.24, 1.05, 0.28] }, elbows: { L: [1, -0.8, -0.4] } }, { hands: { L: [0.48, 1.47, 0.27] }, elbows: { L: [1, 0, -0.6] } }),
      props: sk => E.upright(0, 0.4, 1.7).concat([box([0, 1.2, 0.24], [0.3, 0.42, 0.08], 'pad')],
        ['L', 'R'].flatMap(k => { const s = k === 'L' ? 1 : -1, pad = add(sk.el[k], [s * 0.05, 0, 0]); return [cap(pad, add(pad, mul(norm(sub(sk.wr[k], sk.el[k])), 0.12)), 0.045, 0.045, 'pad'), cap([s * 0.1, 1.5, 0.3], pad, 0.018, 0.018, 'metal')]; })) },

    'front-raise-dumbbell': { name: 'Front Raise (Dumbbell)', eq: 'Dumbbell', hi: ['delts'], cam: { yaw: 1.0, pitch: 0.12 },
      keys: rep({ hands: { L: [0.17, 0.93, 0.09] }, elbows: { L: [0.2, -0.6, -0.8] } }, { hands: { L: [0.17, 1.45, 0.54] }, elbows: { L: [0.2, -0.6, -0.8] } }),
      props: sk => E.dumbbell(sk.grip.L, [1, 0, 0]).concat(E.dumbbell(sk.grip.R, [1, 0, 0])) },

    'reverse-fly-machine': { name: 'Reverse Fly (Machine)', eq: 'Machine', hi: ['delts'], cam: { yaw: 2.4, pitch: 0.35 },
      keys: rep(seated({ up: [0, 1, 0.12], hands: { L: [0.1, 1.08, 0.6] }, elbows: { L: [0, -1, 0] } }), seated({ up: [0, 1, 0.12], hands: { L: [0.72, 1.08, 0.12] }, elbows: { L: [0, -1, 0] } })),
      props: sk => E.seat(0.5, 0).concat([box([0, 0.98, 0.25], [0.32, 0.42, 0.08], 'pad')], E.upright(0, 0.55, 1.7),
        ['L', 'R'].flatMap(k => E.handle(sk.grip[k], [0, 1, 0]).concat([cap([k === 'L' ? 0.08 : -0.08, 1.55, 0.5], add(sk.grip[k], [0, 0.07, 0]), 0.018, 0.018, 'metal')]))) },

    'triceps-extension-cable': { name: 'Triceps Extension (Cable)', eq: 'Cable', hi: ['arms'], cam: { yaw: 1.25, pitch: 0.12 }, note: 'Overhead extension facing away from the cable.',
      keys: rep(
        { pelvis: [0, 0.95, 0], up: [0, 1, 0.35], hands: { L: [0.05, 1.62, -0.05] }, elbows: { L: [0.2, 1, 0.6] }, feet: { L: [0.14, 0.08, 0.3], R: [-0.14, 0.08, -0.2] }, knees: { L: [0.1, 0, 1], R: [-0.1, 0, 1] } },
        { pelvis: [0, 0.95, 0], up: [0, 1, 0.35], hands: { L: [0.07, 1.7, 0.59] }, elbows: { L: [0.2, 1, 0.4] }, feet: { L: [0.14, 0.08, 0.3], R: [-0.14, 0.08, -0.2] }, knees: { L: [0.1, 0, 1], R: [-0.1, 0, 1] } }),
      props: sk => E.pulley([0, 1.7, -0.9]).concat(E.rope([0, 1.7, -0.9], sk.grip.L, sk.grip.R)) },

    'triceps-pushdown-straight-bar': { name: 'Triceps Pushdown (Straight Bar)', eq: 'Cable', hi: ['arms'], cam: { yaw: 0.9, pitch: 0.12 },
      keys: rep({ pelvis: [0, 0.98, 0], up: [0, 1, 0.12], hands: { L: [0.13, 1.18, 0.3] }, elbows: { L: [0, -0.3, -1] } }, { pelvis: [0, 0.98, 0], up: [0, 1, 0.12], hands: { L: [0.13, 0.93, 0.18] }, elbows: { L: [0, -0.3, -1] } }),
      props: sk => E.pulley([0, 2.1, 0.45]).concat(E.bar(sk.grip.L, sk.grip.R, 0.1), [line([0, 2.1, 0.45], mid(sk.grip.L, sk.grip.R))]) },

    'triceps-rope-pushdown-cable': { name: 'Triceps Rope Pushdown (Cable)', eq: 'Cable', hi: ['arms'], cam: { yaw: 0.9, pitch: 0.12 },
      keys: rep({ pelvis: [0, 0.98, 0], up: [0, 1, 0.12], hands: { L: [0.08, 1.18, 0.3] }, elbows: { L: [0, -0.3, -1] } }, { pelvis: [0, 0.98, 0], up: [0, 1, 0.12], hands: { L: [0.2, 0.95, 0.15] }, elbows: { L: [0, -0.3, -1] } }),
      props: sk => E.pulley([0, 2.1, 0.45]).concat(E.rope([0, 2.1, 0.45], sk.grip.L, sk.grip.R)) },

    'lat-pulldown-wide-grip-cable': { name: 'Lat Pulldown - Wide Grip (Cable)', eq: 'Cable', hi: ['torso'], cam: { yaw: 2.5, pitch: 0.15 },
      keys: rep(seated({ up: [0, 1, -0.12], hands: { L: [0.42, 1.56, 0] }, elbows: { L: [1, -0.3, -0.3] } }), seated({ up: [0, 1, -0.12], hands: { L: [0.38, 1.17, 0.12] }, elbows: { L: [0.8, -1, -0.5] } }), { c: 0.38 }),
      props: sk => E.seat(0.5, 0).concat([box([0, 0.76, 0.38], [0.42, 0.08, 0.1], 'pad')], E.upright(0, -0.35, 2.4), E.bar(sk.grip.L, sk.grip.R, 0.14), [line([0, 2.3, 0.03], mid(sk.grip.L, sk.grip.R)), sph([0, 2.3, 0.03], 0.045, 'metal')]) },

    'lat-pulldown-single-arm-cable': { name: 'Lat Pulldown - Single Arm (Cable)', eq: 'Cable', hi: ['torso'], cam: { yaw: 0.6, pitch: 0.15 },
      keys: rep(seated({ hands: { L: [0.25, 1.6, 0.05], R: [-0.15, 0.68, 0.32] }, elbows: { L: [1, -0.3, 0], R: [-0.3, 0, -1] } }),
        seated({ hands: { L: [0.27, 1.12, 0.05], R: [-0.15, 0.68, 0.32] }, elbows: { L: [0.4, -1, -0.6], R: [-0.3, 0, -1] } })),
      props: sk => E.seat(0.5, 0).concat([box([0, 0.76, 0.38], [0.42, 0.08, 0.1], 'pad')], E.upright(0.25, -0.35, 2.4), E.handle(sk.grip.L, [0, 0, 1]), [line([0.25, 2.3, 0.05], sk.grip.L), sph([0.25, 2.3, 0.05], 0.045, 'metal')]) },

    'seated-row-cable': { name: 'Seated Row (Cable)', eq: 'Cable', hi: ['torso'], cam: { yaw: 1.2, pitch: 0.2 },
      keys: rep(
        { pelvis: [0, 0.48, 0], up: [0, 1, 0.35], hands: { L: [0.07, 0.82, 0.68] }, elbows: { L: [0.3, -0.3, -1] }, feet: { L: [0.13, 0.28, 0.72] }, knees: { L: [0, 1, 0.2] }, footDir: { L: [0, 0.6, 0.8] } },
        { pelvis: [0, 0.48, 0], up: [0, 1, -0.08], hands: { L: [0.08, 0.86, 0.22] }, elbows: { L: [0.3, -0.3, -1] }, feet: { L: [0.13, 0.28, 0.72] }, knees: { L: [0, 1, 0.2] }, footDir: { L: [0, 0.6, 0.8] } }),
      props: sk => [box([0, 0.33, -0.05], [0.35, 0.1, 0.6], 'pad'), box([0, 0.14, 0.45], [0.12, 0.28, 1.6], 'frame'), box([0, 0.32, 0.86], [0.45, 0.04, 0.34], 'metal', deg(-40))]
        .concat(E.handle(mid(sk.grip.L, sk.grip.R), [1, 0, 0]), [line(mid(sk.grip.L, sk.grip.R), [0, 0.42, 1.3])], E.pulley([0, 0.42, 1.3], 0.9)) },

    'pullover-machine': { name: 'Pullover (Machine)', eq: 'Machine', hi: ['torso'], cam: { yaw: 1.2, pitch: 0.15 },
      keys: rep(seated({ up: [0, 1, -0.06], hands: { L: [0.22, 1.6, -0.12] }, elbows: { L: [1, 0, 0] } }), seated({ up: [0, 1, -0.06], hands: { L: [0.22, 0.94, 0.48] }, elbows: { L: [1, 0, 0] } }), { c: 0.42 }),
      props: sk => { const d = norm(sub(sk.grip.R, sk.grip.L)), a = add(sk.grip.L, mul(d, -0.2)), b = add(sk.grip.R, mul(d, 0.2));
        return E.seat(0.5, 0).concat(E.back([0, 0.98, -0.17], 0.7), [cap(a, b, 0.017, 0.017, 'metal'), cap([0.42, 1.08, -0.03], a, 0.02, 0.02, 'metal'), cap([-0.42, 1.08, -0.03], b, 0.02, 0.02, 'metal'), sph([0.42, 1.08, -0.03], 0.05, 'frame'), sph([-0.42, 1.08, -0.03], 0.05, 'frame')]); } },

    't-bar-row': { name: 'T-Bar Row', eq: 'Plate-loaded', hi: ['torso'], cam: { yaw: 1.3, pitch: 0.2 },
      keys: rep(
        { pelvis: [0, 0.85, -0.15], up: [0, 0.75, 0.66], hands: { L: [0.06, 0.69, 0.25] }, elbows: { L: [0.3, 0.3, -1] }, feet: { L: [0.2, 0.08, 0.05] }, knees: { L: [0.2, 0, 1] } },
        { pelvis: [0, 0.85, -0.15], up: [0, 0.75, 0.66], hands: { L: [0.06, 0.84, 0.2] }, elbows: { L: [0.3, 0.3, -1] }, feet: { L: [0.2, 0.08, 0.05] }, knees: { L: [0.2, 0, 1] } }),
      props: sk => { const H = mid(sk.grip.L, sk.grip.R), pv = [0, 0.05, -0.95], d = norm(sub(H, pv));
        return [cap(pv, add(H, mul(d, 0.25)), 0.022, 0.022, 'metal'), disc(add(H, mul(d, 0.13)), d, 0.17, 'plate'), sph(pv, 0.05, 'frame')].concat(E.handle(H, [1, 0, 0])); } },

    'iso-lateral-low-row-plate-loaded': { name: 'Iso-Lateral Low Row (Plate-loaded)', eq: 'Plate-loaded', hi: ['torso'], cam: { yaw: 1.1, pitch: 0.2 },
      keys: rep(seated({ up: [0, 1, 0.12], hands: { L: [0.2, 0.88, 0.57] }, elbows: { L: [0.3, -0.2, -1] } }), seated({ up: [0, 1, 0.12], hands: { L: [0.24, 0.92, 0.12] }, elbows: { L: [0.3, -0.2, -1] } })),
      props: sk => E.seat(0.5, 0).concat([box([0, 1.0, 0.27], [0.32, 0.42, 0.08], 'pad')], E.upright(0.3, 0.85, 1.75), E.upright(-0.3, 0.85, 1.75),
        ['L', 'R'].flatMap(k => { const s = k === 'L' ? 1 : -1, pv = [s * 0.25, 1.65, 0.8]; return E.handle(sk.grip[k], [0, 1, 0]).concat([cap(pv, add(sk.grip[k], [0, 0.07, 0]), 0.022, 0.022, 'metal'), disc(add(pv, [s * 0.1, -0.05, -0.05]), [1, 0, 0], 0.17, 'plate')]); })) },

    'shrug-machine': { name: 'Shrug (Machine)', eq: 'Machine', hi: ['torso'], cam: { yaw: 0.5, pitch: 0.1 },
      keys: rep({ hands: { L: [0.25, 0.93, 0.02] }, elbows: { L: [0, -0.3, -1] } }, { shrug: 0.07, hands: { L: [0.25, 1.0, 0.02] }, elbows: { L: [0, -0.3, -1] } }, { c: 0.3, h1: 0.14 }),
      props: sk => E.upright(0.45, -0.25, 1.6).concat(E.upright(-0.45, -0.25, 1.6), ['L', 'R'].flatMap(k => E.handle(sk.grip[k], [0, 0, 1]).concat([cap([k === 'L' ? 0.45 : -0.45, sk.grip[k][1], -0.25], add(sk.grip[k], [0, 0, -0.07]), 0.02, 0.02, 'metal')]))) },

    'bicep-curl-dumbbell': { name: 'Bicep Curl (Dumbbell)', eq: 'Dumbbell', hi: ['arms'], cam: { yaw: 0.8, pitch: 0.1 },
      keys: rep({ hands: { L: [0.22, 0.93, 0.06] }, elbows: { L: [0, -0.4, -1] } }, { hands: { L: [0.2, 1.3, 0.26] }, elbows: { L: [0, -0.4, -1] } }),
      props: sk => E.dumbbell(sk.grip.L, [1, 0, 0]).concat(E.dumbbell(sk.grip.R, [1, 0, 0])) },

    'seated-bicep-curl-machine': { name: 'Seated Bicep Curl (Machine)', eq: 'Machine', hi: ['arms'], cam: { yaw: 1.1, pitch: 0.2 },
      keys: rep(seated({ pelvis: [0, 0.6, 0], up: [0, 1, 0.1], hands: { L: [0.18, 0.92, 0.55] }, elbows: { L: [0, -1, 0.3] } }), seated({ pelvis: [0, 0.6, 0], up: [0, 1, 0.1], hands: { L: [0.17, 1.3, 0.33] }, elbows: { L: [0, -1, 0.3] } })),
      props: sk => E.seat(0.52, 0).concat([box([0, 0.88, 0.32], [0.5, 0.05, 0.34], 'pad', deg(20))], E.bar(sk.grip.L, sk.grip.R, 0.1),
        ['L', 'R'].map(k => cap([k === 'L' ? 0.32 : -0.32, 0.92, 0.33], add(sk.grip[k], [k === 'L' ? 0.1 : -0.1, 0, 0]), 0.02, 0.02, 'metal'))) },

    'standing-bicep-curl-cable': { name: 'Standing Bicep Curl (Cable)', eq: 'Cable', hi: ['arms'], cam: { yaw: 0.9, pitch: 0.1 },
      keys: rep({ hands: { L: [0.17, 0.95, 0.1] }, elbows: { L: [0, -0.4, -1] } }, { hands: { L: [0.17, 1.3, 0.27] }, elbows: { L: [0, -0.4, -1] } }),
      props: sk => E.pulley([0, 0.12, 0.6], 0.5).concat(E.bar(sk.grip.L, sk.grip.R, 0.1), [line([0, 0.12, 0.6], mid(sk.grip.L, sk.grip.R))]) },

    'hack-squat-machine': { name: 'Hack Squat (Machine)', eq: 'Machine', hi: ['thighs'], cam: { yaw: 1.3, pitch: 0.15 },
      keys: rep(
        { pelvis: [0, 0.93, -0.06], up: [0, 0.87, -0.5], fwd: [0, 0.5, 0.87], hands: { L: { t: [0.25, 0.42, 0.05] } }, elbows: { L: [1, -1, 0.3] }, feet: { L: [0.16, 0.12, 0.28] }, knees: { L: [0.15, 0.3, 1] }, footDir: { L: [0.15, 0.25, 1] } },
        { pelvis: [0, 0.5, -0.3], up: [0, 0.87, -0.5], fwd: [0, 0.5, 0.87], hands: { L: { t: [0.25, 0.42, 0.05] } }, elbows: { L: [1, -1, 0.3] }, feet: { L: [0.16, 0.12, 0.28] }, knees: { L: [0.15, 0.3, 1] }, footDir: { L: [0.15, 0.25, 1] } }, { c: 0.45 }),
      props: sk => E.torsoPad(sk, [0, 0.3, -0.14], [0.2, 0.36, 0.035]).concat(
        ['L', 'R'].flatMap(k => [sph(add(sk.sh[k], mul(sk.up, 0.07)), 0.06, 'pad'), cap([k === 'L' ? 0.38 : -0.38, 1.62, -0.23], [k === 'L' ? 0.38 : -0.38, 0.38, -0.92], 0.025, 0.025, 'frame')]),
        [box([0, 0.08, 0.32], [0.6, 0.05, 0.5], 'metal', deg(-20))]) },

    'squat-smith-machine': { name: 'Squat (Smith Machine)', eq: 'Smith machine', hi: ['thighs', 'pelvis'], cam: { yaw: 1.15, pitch: 0.15 },
      keys: rep(
        { pelvis: [0, 0.97, -0.02], up: [0, 1, 0.05], hands: { L: { t: [0.42, 0.5, -0.05] } }, elbows: { L: [0.3, -1, -0.5] }, feet: { L: [0.2, 0.08, 0.12] }, knees: { L: [0.3, 0, 1] }, footDir: { L: [0.25, 0, 1] } },
        { pelvis: [0, 0.58, -0.26], up: [0, 0.86, 0.51], hands: { L: { t: [0.42, 0.5, -0.05] } }, elbows: { L: [0.3, -1, -0.5] }, feet: { L: [0.2, 0.08, 0.12] }, knees: { L: [0.3, 0, 1] }, footDir: { L: [0.25, 0, 1] } }, { c: 0.45 }),
      props: sk => { const c = add(add(sk.P, mul(sk.up, 0.5)), mul(sk.f, -0.07));
        return E.barbell(add(c, [-0.3, 0, 0]), add(c, [0.3, 0, 0]), { len: 1.9, plateAt: 0.8, r: 0.18 }).concat(E.upright(0.66, -0.08, 2.1), E.upright(-0.66, -0.08, 2.1)); } },

    'leg-extension-machine': { name: 'Leg Extension (Machine)', eq: 'Machine', hi: ['thighs'], cam: { yaw: 1.25, pitch: 0.15 },
      keys: rep(
        { pelvis: [0, 0.62, 0], up: [0, 1, -0.1], hands: { L: [0.3, 0.58, 0.1] }, elbows: { L: [0.3, -0.2, -1] }, feet: { L: [0.11, 0.16, 0.5] }, knees: { L: [0, 1, 0.3] }, footDir: { L: [0, 0, 1] } },
        { pelvis: [0, 0.62, 0], up: [0, 1, -0.1], hands: { L: [0.3, 0.58, 0.1] }, elbows: { L: [0.3, -0.2, -1] }, feet: { L: [0.11, 0.62, 0.86] }, knees: { L: [0, 1, 0.3] }, footDir: { L: [0, 1, 0.1] } }),
      props: sk => { const sh = norm(sub(sk.an.L, sk.kn.L)), n = mul(norm(cross([1, 0, 0], sh)), -0.065);
        return E.seat(0.56, 0.17).concat(E.back([0, 0.95, -0.17], 0.6, deg(-6)), E.roller(sk, n), ['L', 'R'].map(k => cap([k === 'L' ? 0.3 : -0.3, sk.kn[k][1], sk.kn[k][2]], add(sk.an[k], add(n, [k === 'L' ? 0.2 : -0.2, 0, 0])), 0.02, 0.02, 'metal'))); } },

    'lying-leg-curl-machine': { name: 'Lying Leg Curl (Machine)', eq: 'Machine', hi: ['thighs'], cam: { yaw: 1.35, pitch: 0.3 },
      keys: rep(
        { pelvis: [0, 0.72, 0.05], up: [0, 0, -1], fwd: [0, -1, 0], hands: { L: [-0.22, 0.5, -0.72] }, elbows: { L: [-0.5, -1, 0] }, feet: { L: [-0.1, 0.68, 0.9] }, knees: { L: [0, -1, 0] }, footDir: { L: [0, -0.8, 0.6] } },
        { pelvis: [0, 0.72, 0.05], up: [0, 0, -1], fwd: [0, -1, 0], hands: { L: [-0.22, 0.5, -0.72] }, elbows: { L: [-0.5, -1, 0] }, feet: { L: [-0.1, 1.08, 0.55] }, knees: { L: [0, -1, 0] }, footDir: { L: [0, 0.3, 1] } }),
      props: sk => { const sh = norm(sub(sk.an.L, sk.kn.L)), n = mul(norm(cross(sh, [-1, 0, 0])), -0.065);
        return E.bench(-0.8, 0.62, 0.6, 0.36).concat(E.roller(sk, n), E.handle([0.22, 0.5, -0.76], [1, 0, 0]), E.handle([-0.22, 0.5, -0.76], [1, 0, 0])); } },

    'hip-adductor-machine': { name: 'Hip Adductor (Machine)', eq: 'Machine', hi: ['thighs'], cam: { yaw: 0.35, pitch: 0.35 },
      keys: rep(
        { pelvis: [0, 0.6, 0], up: [0, 1, -0.25], hands: { L: [0.3, 0.62, 0.08] }, elbows: { L: [0.3, -0.2, -1] }, feet: { L: [0.42, 0.3, 0.5] }, knees: { L: [0.4, 1, 0.4] }, footDir: { L: [0, 0.2, 1] } },
        { pelvis: [0, 0.6, 0], up: [0, 1, -0.25], hands: { L: [0.3, 0.62, 0.08] }, elbows: { L: [0.3, -0.2, -1] }, feet: { L: [0.12, 0.3, 0.55] }, knees: { L: [0.4, 1, 0.4] }, footDir: { L: [0, 0.2, 1] } }),
      props: sk => E.seat(0.52, 0).concat(E.back([0, 0.95, -0.2], 0.6, deg(-14)),
        ['L', 'R'].flatMap(k => { const s = k === 'L' ? 1 : -1, p = add(sk.kn[k], [-s * 0.08, 0, 0]); return [cap(add(p, [0, -0.07, 0]), add(p, [0, 0.07, 0]), 0.045, 0.045, 'pad'), cap([s * 0.1, 0.42, 0.25], p, 0.02, 0.02, 'metal')]; })) },

    'hip-abductor-machine': { name: 'Hip Abductor (Machine)', eq: 'Machine', hi: ['pelvis'], cam: { yaw: 0.35, pitch: 0.35 },
      keys: rep(
        { pelvis: [0, 0.6, 0], up: [0, 1, -0.25], hands: { L: [0.3, 0.62, 0.08] }, elbows: { L: [0.3, -0.2, -1] }, feet: { L: [0.12, 0.3, 0.55] }, knees: { L: [0.4, 1, 0.4] }, footDir: { L: [0, 0.2, 1] } },
        { pelvis: [0, 0.6, 0], up: [0, 1, -0.25], hands: { L: [0.3, 0.62, 0.08] }, elbows: { L: [0.3, -0.2, -1] }, feet: { L: [0.42, 0.3, 0.5] }, knees: { L: [0.4, 1, 0.4] }, footDir: { L: [0, 0.2, 1] } }),
      props: sk => E.seat(0.52, 0).concat(E.back([0, 0.95, -0.2], 0.6, deg(-14)),
        ['L', 'R'].flatMap(k => { const s = k === 'L' ? 1 : -1, p = add(sk.kn[k], [s * 0.08, 0, 0]); return [cap(add(p, [0, -0.07, 0]), add(p, [0, 0.07, 0]), 0.045, 0.045, 'pad'), cap([s * 0.1, 0.42, 0.25], p, 0.02, 0.02, 'metal')]; })) },

    'standing-calf-raise-machine': { name: 'Standing Calf Raise (Machine)', eq: 'Machine', hi: ['calves'], cam: { yaw: 1.2, pitch: 0.1 },
      keys: rep(
        { pelvis: [0, 1.07, 0], hands: { L: { t: [0.3, 0.45, 0.12] } }, elbows: { L: [0.3, -1, 0] }, feet: { L: [0.12, 0.17, 0] }, footDir: { L: [0, -0.25, 1] } },
        { pelvis: [0, 1.17, 0.02], hands: { L: { t: [0.3, 0.45, 0.12] } }, elbows: { L: [0.3, -1, 0] }, feet: { L: [0.12, 0.27, 0.04] }, footDir: { L: [0, -0.75, 0.66] } }, { c: 0.32, h1: 0.12 }),
      props: sk => [box([0, 0.06, 0.12], [0.6, 0.12, 0.3], 'metal')].concat(['L', 'R'].map(k => cap(add(sk.sh[k], mul(sk.up, 0.07)), add(add(sk.sh[k], mul(sk.up, 0.07)), mul(sk.f, 0.12)), 0.05, 0.05, 'pad')),
        E.torsoPad(sk, [0, 0.6, -0.16], [0.35, 0.04, 0.06], 'frame'), E.upright(0.5, -0.25, 2.1), E.upright(-0.5, -0.25, 2.1)) },

    'calf-press-leg-press': { name: 'Calf Press (Leg Press)', eq: 'Machine', hi: ['calves'], cam: { yaw: 1.3, pitch: 0.2 },
      keys: rep(
        { pelvis: [0, 0.5, 0], up: [0, 0.75, -0.66], fwd: [0, 0.66, 0.75], hands: { L: [0.28, 0.55, 0.05] }, elbows: { L: [0.3, -0.2, -1] }, feet: { L: [0.12, 0.86, 0.73] }, knees: { L: [0, 1, 0] }, footDir: { L: [0, 0.88, -0.47] } },
        { pelvis: [0, 0.5, 0], up: [0, 0.75, -0.66], fwd: [0, 0.66, 0.75], hands: { L: [0.28, 0.55, 0.05] }, elbows: { L: [0.3, -0.2, -1] }, feet: { L: [0.12, 0.86, 0.73] }, knees: { L: [0, 1, 0] }, footDir: { L: [0, 0.95, 0.3] } }, { c: 0.32, h1: 0.12 }),
      props: sk => { const leg = norm(sub(mid(sk.an.L, sk.an.R), mid(sk.hip.L, sk.hip.R))), fd = norm(mid(sk.fd.L, sk.fd.R)), c = add(mid(sk.toe.L, sk.toe.R), mul(leg, 0.03));
        return [obox(c, [[0.3, 0, 0], mul(fd, 0.25), mul(leg, 0.02)], 'metal'), box([0, 0.42, 0.05], [0.42, 0.08, 0.45], 'pad')].concat(E.torsoPad(sk, [0, 0.3, -0.14], [0.2, 0.36, 0.035]), E.handle([0.28, 0.55, 0.05], [0, 0, 1]), E.handle([-0.28, 0.55, 0.05], [0, 0, 1]), [box([0, 0.2, 0.2], [0.14, 0.4, 0.9], 'frame')]); } },

    'seated-abs-machine': { name: 'Seated Abs (Machine)', eq: 'Machine', hi: ['abs'], cam: { yaw: 1.2, pitch: 0.15 },
      keys: rep(seated({ up: [0, 1, -0.05], hands: { L: { t: [0.15, 0.5, 0.12] } }, elbows: { L: [0.2, -1, 0.4] }, feet: { L: [0.13, 0.12, 0.45] } }),
        seated({ up: [0, 0.62, 0.78], hands: { L: { t: [0.15, 0.5, 0.12] } }, elbows: { L: [0.2, -1, 0.4] }, feet: { L: [0.13, 0.12, 0.45] } }), { c: 0.32, h1: 0.12 }),
      props: sk => E.seat(0.5, 0).concat(E.back([0, 0.92, -0.2], 0.55), E.torsoPad(sk, [0, 0.42, 0.17], [0.2, 0.08, 0.03]), E.roller(sk, [0, 0.03, 0.07])) },

    'treadmill-incline-walk': { name: 'Treadmill (Incline Walk)', eq: 'Cardio', hi: ['thighs', 'calves'], cam: { yaw: 1.35, pitch: 0.15 }, dur: 1.15, ease: 'linear',
      keys: (() => {
        const k0 = { pelvis: [0, 1.01, 0], up: [0, 1, 0.04], feet: { L: [0.1, 0.17, 0.3], R: [-0.1, 0.21, -0.3] }, footDir: { L: [0, 0.25, 1], R: [0, -0.5, 0.85] }, knees: { L: [0, 0, 1], R: [0, 0, 1] }, hands: { L: [0.24, 0.98, -0.16], R: [-0.24, 1.0, 0.2] }, elbows: { L: [0, -0.3, -1], R: [0, -0.3, -1] } };
        const k1 = { pelvis: [0, 1.04, 0], up: [0, 1, 0.04], feet: { L: [0.1, 0.18, 0], R: [-0.1, 0.29, 0.02] }, footDir: { L: [0, 0, 1], R: [0, -0.3, 1] }, knees: { L: [0, 0, 1], R: [0, 0, 1] }, hands: { L: [0.22, 0.96, 0], R: [-0.22, 0.96, 0.02] }, elbows: { L: [0, -0.3, -1], R: [0, -0.3, -1] } };
        const swap = p => { const o = JSON.parse(JSON.stringify(p)); ['feet', 'footDir', 'knees', 'hands', 'elbows'].forEach(k => { const L = o[k].L, R = o[k].R; o[k] = { L: mirror(R), R: mirror(L) }; }); return o; };
        return [{ at: 0, p: k0 }, { at: 0.25, p: k1 }, { at: 0.5, p: swap(k0) }, { at: 0.75, p: swap(k1) }];
      })(),
      props: () => [box([0, 0.09, 0.05], [0.72, 0.06, 1.8], 'frame', deg(-3)), box([0, 0.125, 0.05], [0.5, 0.01, 1.6], 'pad', deg(-3)),
        cap([0.38, 0.15, 0.8], [0.38, 1.1, 0.8], 0.022, 0.022, 'metal'), cap([-0.38, 0.15, 0.8], [-0.38, 1.1, 0.8], 0.022, 0.022, 'metal'),
        cap([0.38, 1.05, 0.8], [0.38, 1.05, 0.35], 0.02, 0.02, 'metal'), cap([-0.38, 1.05, 0.8], [-0.38, 1.05, 0.35], 0.02, 0.02, 'metal'), box([0, 1.18, 0.82], [0.7, 0.2, 0.08], 'frame', deg(25))] }
  };

  // ---------- the rest of the library ----------
  const LIE = { pelvis: [0, 0.58, 0.1], up: [0, 0.08, -1], fwd: [0, 1, 0], feet: { L: [0.3, 0.08, 0.55] }, knees: { L: [0.3, 1, 0] }, footDir: { L: [0.2, 0, 1] } };
  const lying = o => Object.assign({}, LIE, o);
  const INC = { pelvis: [0, 0.6, 0.12], up: [0, 0.77, -0.64], fwd: [0, 0.64, 0.77], feet: { L: [0.25, 0.08, 0.62] }, knees: { L: [0, 0.5, 1] } };
  const incline = o => Object.assign({}, INC, o);
  const one = v => ({ L: v });
  const resolveKeys = id => { const d = DEFS[id]; if (typeof d.keys === 'function') d.keys = d.keys(); return d.keys; };
  const like = (id, f) => () => resolveKeys(id).map(k => ({ at: k.at, p: f ? f(JSON.parse(JSON.stringify(k.p))) : k.p }));
  const swapLR = p => { const o = JSON.parse(JSON.stringify(p)); ['feet', 'footDir', 'knees', 'hands', 'elbows', 'handDir'].forEach(k => { if (!o[k]) return; const L = o[k].L, R = o[k].R || mirror(L); o[k] = { L: mirror(R), R: mirror(L) }; }); return o; };
  const pairDB = (sk, ax) => E.dumbbell(sk.grip.L, ax || [1, 0, 0]).concat(E.dumbbell(sk.grip.R, ax || [1, 0, 0]));
  const hangBar = y => [cap([-0.62, y, 0], [0.62, y, 0], 0.02, 0.02, 'metal')].concat(E.upright(0.62, 0, y + 0.05), E.upright(-0.62, 0, y + 0.05));
  const inclineBench = sk => E.seat(0.5, 0.12).concat(E.torsoPad(sk, [0, 0.33, -0.15], [0.19, 0.36, 0.035]));
  const mat = () => [box([0, 0.005, 0.1], [0.7, 0.01, 1.9], 'pad')];
  const levers = (sk, from, ax) => ['L', 'R'].flatMap(k => { const s = k === 'L' ? 1 : -1; return E.handle(sk.grip[k], ax || [0, 1, 0]).concat([cap([s * from[0], from[1], from[2]], sk.grip[k], 0.02, 0.02, 'metal')]); });
  const cyc = (n, f) => Array.from({ length: n }, (_, i) => ({ at: i / n, p: f(2 * Math.PI * i / n) }));
  const ez = sk => E.barbell(sk.grip.L, sk.grip.R, { len: 1.25, plateAt: 0.45, r: 0.13 });
  function legPressProps(sk) {
    const leg = norm(sub(mid(sk.an.L, sk.an.R), mid(sk.hip.L, sk.hip.R))), fd = norm(mid(sk.fd.L, sk.fd.R)), c = add(mid(sk.toe.L, sk.toe.R), mul(leg, 0.03));
    return [obox(add(c, mul(fd, -0.08)), [[0.32, 0, 0], mul(fd, 0.3), mul(leg, 0.02)], 'metal'), box([0, 0.42, 0.05], [0.42, 0.08, 0.45], 'pad')].concat(E.torsoPad(sk, [0, 0.3, -0.14], [0.2, 0.36, 0.035]), E.handle([0.28, 0.55, 0.05], [0, 0, 1]), E.handle([-0.28, 0.55, 0.05], [0, 0, 1]), [box([0, 0.2, 0.2], [0.14, 0.4, 0.9], 'frame')]);
  }

  // Standing, lunge and squat poses reused below.
  const STAND_DB = { hands: { L: { t: [0.24, -0.05, 0.03] } }, elbows: { L: [0, -0.3, -1] }, footDir: { L: [0, 0, 1] } };
  const PUSH_UP = { fwd: [0, -1, 0], hands: { L: [0.27, 0.06, 0.5] }, elbows: { L: [0.6, 0.3, -1] }, feet: { L: [0.1, 0.18, -0.85] }, knees: { L: [0, -1, 0] }, footDir: { L: [0, -0.8, 0.6] } };
  const NORDIC_TOP = { pelvis: [0, 0.59, 0], up: [0, 1, 0], fwd: [0, 0, 1], hands: { L: { t: [0.2, 0.25, 0.2] } }, elbows: { L: [0.3, -1, -0.2] }, feet: { L: [0.1, 0.11, -0.42] }, knees: { L: [0, -1, 0.3] }, footDir: { L: [0, -0.3, -1] } };
  const shift = (p, dy) => { const o = JSON.parse(JSON.stringify(p)); o.pelvis[1] += dy; o.feet.L[1] += dy; return o; };
  const LUNGE = { pelvis: [0, 0.55, 0], up: [0, 1, 0.05], hands: STAND_DB.hands, elbows: STAND_DB.elbows, feet: { L: [0.12, 0.08, 0.42], R: [-0.12, 0.12, -0.45] }, knees: { L: [0, 0, 1], R: [0, -1, 0.2] }, footDir: { L: [0, 0, 1], R: [0, -0.5, 0.87] } };
  const ROW_A = { pelvis: [0, 0.85, -0.15], up: [0, 0.75, 0.66], hands: { L: [0.24, 0.69, 0.25] }, elbows: { L: [0.3, 0.3, -1] }, feet: { L: [0.2, 0.08, 0.05] }, knees: { L: [0.2, 0, 1] } };
  const RDL_TOP = { pelvis: [0, 0.99, 0], up: [0, 1, 0], hands: { L: [0.22, 0.94, 0.08] }, elbows: { L: [0, -0.3, -1] }, feet: { L: [0.12, 0.08, 0] }, knees: { L: [0, 0, 1] } };
  const RDL_BOT = Object.assign({}, RDL_TOP, { pelvis: [0, 0.92, -0.15], up: [0, 0.55, 0.835], hands: { L: [0.22, 0.66, 0.22] } });
  const RDL_MID = Object.assign({}, RDL_TOP, { pelvis: [0, 0.96, -0.08], up: [0, 0.88, 0.474], hands: { L: [0.22, 0.82, 0.12] } });
  const HANG = { pelvis: [0, 1.24, 0], hands: { L: [0.35, 2.25, 0] }, elbows: { L: [1, -0.3, 0] }, feet: { L: { t: [0.08, -0.85, -0.12] } }, knees: { L: [0, 0, 1] } };
  const HIP_THRUST_A = { pelvis: [0, 0.32, 0], up: [0, 0.536, -0.844], fwd: [0, 0.844, 0.536], hands: { L: { t: [0.3, 0.05, 0.18] } }, elbows: { L: [0.5, 1, 0] }, feet: { L: [0.17, 0.08, 0.55] }, knees: { L: [0.2, 1, 0.3] } };
  const HIP_THRUST_B = Object.assign({}, HIP_THRUST_A, { pelvis: [0, 0.6, 0.12], up: [0, -0.05, -1], fwd: [0, 1, -0.05] });
  const KICK_A = { pelvis: [0, 0.97, 0], up: [0, 1, 0.35], hands: { L: [0.22, 1.2, 0.45] }, elbows: { L: [0.3, -1, -0.3] }, feet: { L: [0.12, 0.12, 0.05], R: [-0.12, 0.08, 0.05] }, knees: { L: [0, -0.3, 1], R: [0, 0, 1] }, footDir: { L: [0, -0.3, 1], R: [0, 0, 1] } };
  const KICK_B = Object.assign({}, KICK_A, { feet: { L: [0.12, 0.45, -0.55], R: [-0.12, 0.08, 0.05] }, footDir: { L: [0, -0.9, -0.3], R: [0, 0, 1] } });

  Object.assign(DEFS, {
    // ----- chest -----
    'incline-bench-press-barbell': { name: 'Incline Bench Press (Barbell)', eq: 'Barbell', hi: ['torso', 'delts'], cam: { yaw: 0.9, pitch: 0.15 },
      keys: rep(incline({ hands: one([0.27, 1.33, 0.13]), elbows: one([1, -0.6, -0.3]) }), incline({ hands: one([0.3, 1.06, -0.04]), elbows: one([1, -0.6, -0.3]) }), { c: 0.45 }),
      props: sk => inclineBench(sk).concat(E.barbell(sk.grip.L, sk.grip.R)) },

    'decline-bench-press-barbell': { name: 'Decline Bench Press (Barbell)', eq: 'Barbell', hi: ['torso'], cam: { yaw: 1.1, pitch: 0.2 },
      keys: (() => { const D = { pelvis: [0, 0.68, 0.25], up: [0, -0.25, -0.97], fwd: [0, 0.97, -0.25], elbows: one([1, -0.8, 0]), feet: one([0.12, 0.36, 0.75]), knees: one([0, 1, 0.2]), footDir: one([0, -0.2, 1]) };
        return rep(Object.assign({}, D, { hands: one([0.25, 1.03, -0.2]) }), Object.assign({}, D, { hands: one([0.28, 0.76, -0.08]) }), { c: 0.45 }); })(),
      props: sk => E.torsoPad(sk, [0, 0.3, -0.15], [0.19, 0.42, 0.035]).concat([box([0, 0.27, 0.15], [0.12, 0.5, 0.12], 'frame'), cap([0.2, 0.42, 0.66], [-0.2, 0.42, 0.66], 0.05, 0.05, 'pad')], E.barbell(sk.grip.L, sk.grip.R)) },

    'close-grip-bench-press-barbell': { name: 'Close-Grip Bench Press (Barbell)', eq: 'Barbell', hi: ['arms', 'torso'], cam: { yaw: 0.95, pitch: 0.3 },
      keys: rep(lying({ hands: one([0.16, 1.14, -0.34]), elbows: one([0.3, -0.8, 0.6]) }), lying({ hands: one([0.16, 0.8, -0.16]), elbows: one([0.3, -0.8, 0.6]) }), { c: 0.45 }),
      props: sk => E.bench(-0.9, 0.45).concat(E.barbell(sk.grip.L, sk.grip.R)) },

    'bench-press-dumbbell': { name: 'Bench Press (Dumbbell)', eq: 'Dumbbell', hi: ['torso'], cam: { yaw: 0.95, pitch: 0.3 },
      keys: rep(lying({ hands: one([0.13, 1.13, -0.37]), elbows: one([1, -0.8, 0.2]) }), lying({ hands: one([0.33, 0.82, -0.33]), elbows: one([1, -0.8, 0.2]) }), { c: 0.45 }),
      props: sk => E.bench(-0.9, 0.45).concat(pairDB(sk)) },

    'bench-press-smith-machine': { name: 'Bench Press (Smith Machine)', eq: 'Smith machine', hi: ['torso'], cam: { yaw: 0.95, pitch: 0.3 },
      keys: like('bench-press-barbell'),
      props: sk => E.bench(-0.9, 0.45).concat(E.barbell(sk.grip.L, sk.grip.R), E.upright(0.78, -0.3, 2.1), E.upright(-0.78, -0.3, 2.1)) },

    'incline-bench-press-smith-machine': { name: 'Incline Bench Press (Smith Machine)', eq: 'Smith machine', hi: ['torso', 'delts'], cam: { yaw: 0.9, pitch: 0.15 },
      keys: like('incline-bench-press-barbell'),
      props: sk => inclineBench(sk).concat(E.barbell(sk.grip.L, sk.grip.R), E.upright(0.78, 0.05, 2.1), E.upright(-0.78, 0.05, 2.1)) },

    'chest-press-machine': { name: 'Chest Press (Machine)', eq: 'Machine', hi: ['torso'],
      keys: like('gundam-chest-press-machine'),
      props: sk => E.seat(0.5, 0).concat(E.back([0, 0.95, -0.17], 0.6), E.upright(0.42, -0.25, 1.5), E.upright(-0.42, -0.25, 1.5), levers(sk, [0.42, 1.1, -0.2])) },

    'incline-chest-press-machine': { name: 'Incline Chest Press (Machine)', eq: 'Machine', hi: ['torso', 'delts'],
      keys: rep(seated({ up: [0, 1, -0.06], hands: one([0.25, 1.12, 0.12]), elbows: one([1, -0.5, -0.6]) }), seated({ up: [0, 1, -0.06], hands: one([0.17, 1.33, 0.44]), elbows: one([1, -0.5, -0.6]) })),
      props: sk => E.seat(0.5, 0).concat(E.back([0, 0.98, -0.17], 0.7), E.upright(0.42, -0.25, 1.8), E.upright(-0.42, -0.25, 1.8), levers(sk, [0.42, 1.75, -0.2])) },

    'chest-fly-dumbbell': { name: 'Chest Fly (Dumbbell)', eq: 'Dumbbell', hi: ['torso'], cam: { yaw: 0.4, pitch: 0.45 },
      keys: rep(lying({ hands: one([0.12, 1.1, -0.38]), elbows: one([1, -0.6, 0]) }), lying({ hands: one([0.6, 0.74, -0.37]), elbows: one([0.4, -1, 0]) }), { c: 0.45 }),
      props: sk => E.bench(-0.9, 0.45).concat(pairDB(sk, [0, 0, 1])) },

    'pec-deck-machine': { name: 'Pec Deck (Machine)', eq: 'Machine', hi: ['torso'], cam: { yaw: 0.5, pitch: 0.3 },
      keys: rep(seated({ up: [0, 1, -0.06], hands: one([0.62, 1.15, 0.12]), elbows: one([0, -0.4, -1]) }), seated({ up: [0, 1, -0.06], hands: one([0.09, 1.15, 0.42]), elbows: one([0, -0.4, -1]) })),
      props: sk => E.seat(0.5, 0).concat(E.back([0, 0.98, -0.17], 0.7), E.upright(0, -0.3, 1.8), levers(sk, [0.2, 1.75, -0.1])) },

    'low-to-high-cable-fly': { name: 'Low-to-High Cable Fly', eq: 'Cable', hi: ['torso'], cam: { yaw: 0.6, pitch: 0.15 },
      keys: (() => { const S = { pelvis: [0, 0.97, 0], up: [0, 1, 0.1], elbows: one([0, -0.6, -1]), feet: { L: [0.14, 0.08, 0.22], R: [-0.14, 0.08, -0.22] }, knees: { L: [0.1, 0, 1], R: [-0.1, 0, 1] } };
        return rep(Object.assign({}, S, { hands: one([0.36, 0.93, 0.1]) }), Object.assign({}, S, { hands: one([0.08, 1.3, 0.48]) })); })(),
      props: sk => [].concat(E.pulley([1.0, 0.15, -0.1]), E.pulley([-1.0, 0.15, -0.1]), [line([1.0, 0.15, -0.1], sk.grip.L), line([-1.0, 0.15, -0.1], sk.grip.R)], E.handle(sk.grip.L, [0, 1, 0]), E.handle(sk.grip.R, [0, 1, 0])) },

    'push-up': { name: 'Push Up', eq: 'Bodyweight', hi: ['torso', 'arms'], cam: { yaw: 1.3, pitch: 0.25 },
      keys: rep(Object.assign({}, PUSH_UP, { pelvis: [0, 0.437, 0.012], up: [0, 0.285, 0.958] }), Object.assign({}, PUSH_UP, { pelvis: [0, 0.225, 0.049], up: [0, 0.05, 0.999] }), { c: 0.42 }),
      props: mat },

    'chest-dip': { name: 'Chest Dip', eq: 'Bodyweight', hi: ['torso', 'arms'], cam: { yaw: 1.2, pitch: 0.15 },
      keys: (() => { const D = { hands: one([0.25, 1.2, 0.08]), elbows: one([0, 0, -1]), feet: one({ t: [0.1, -0.72, -0.3] }), knees: one([0, 0, 1]) };
        return rep(Object.assign({}, D, { pelvis: [0, 1.25, -0.05], up: [0, 1, 0.2] }), Object.assign({}, D, { pelvis: [0, 0.96, -0.1], up: [0, 1, 0.35] }), { c: 0.45 }); })(),
      props: () => [cap([0.27, 1.16, -0.35], [0.27, 1.16, 0.45], 0.022, 0.022, 'metal'), cap([-0.27, 1.16, -0.35], [-0.27, 1.16, 0.45], 0.022, 0.022, 'metal')]
        .concat(E.upright(0.27, 0.45, 1.16), E.upright(-0.27, 0.45, 1.16), E.upright(0.27, -0.35, 1.16), E.upright(-0.27, -0.35, 1.16)) },

    // ----- back -----
    'lat-pulldown-close-grip-cable': { name: 'Lat Pulldown - Close Grip (Cable)', eq: 'Cable', hi: ['torso'], cam: { yaw: 1.0, pitch: 0.15 },
      keys: rep(seated({ up: [0, 1, -0.12], hands: one([0.1, 1.58, 0.06]), elbows: one([0.5, -0.3, -0.3]) }), seated({ up: [0, 1, -0.12], hands: one([0.1, 1.17, 0.2]), elbows: one([0.3, -1, -0.6]) }), { c: 0.38 }),
      props: sk => E.seat(0.5, 0).concat([box([0, 0.76, 0.38], [0.42, 0.08, 0.1], 'pad')], E.upright(0, -0.35, 2.4), E.bar(sk.grip.L, sk.grip.R, 0.03), [line([0, 2.3, 0.05], mid(sk.grip.L, sk.grip.R)), sph([0, 2.3, 0.05], 0.045, 'metal')]) },

    'lat-pulldown-machine': { name: 'Lat Pulldown (Machine)', eq: 'Machine', hi: ['torso'], cam: { yaw: 2.5, pitch: 0.15 },
      keys: like('lat-pulldown-wide-grip-cable'),
      props: sk => E.seat(0.5, 0).concat([box([0, 0.76, 0.38], [0.42, 0.08, 0.1], 'pad')], E.upright(0, -0.35, 2.3), levers(sk, [0.15, 2.1, -0.3], [0, 0, 1])) },

    'pull-up': { name: 'Pull Up', eq: 'Bodyweight', hi: ['torso'], cam: { yaw: 0.6, pitch: 0.1 },
      keys: rep(HANG, Object.assign({}, HANG, { pelvis: [0, 1.5, 0.02] }), { c: 0.42 }),
      props: () => hangBar(2.3) },

    'chin-up': { name: 'Chin Up', eq: 'Bodyweight', hi: ['torso', 'arms'], cam: { yaw: 1.0, pitch: 0.1 },
      keys: rep(Object.assign({}, HANG, { hands: one([0.17, 2.25, 0]), elbows: one([0.2, -0.4, 1]) }), Object.assign({}, HANG, { pelvis: [0, 1.5, 0.02], hands: one([0.17, 2.25, 0]), elbows: one([0.2, -0.4, 1]) }), { c: 0.42 }),
      props: () => hangBar(2.3) },

    'assisted-pull-up-machine': { name: 'Assisted Pull Up (Machine)', eq: 'Assisted', hi: ['torso'], cam: { yaw: 1.0, pitch: 0.12 },
      keys: (() => { const A = { pelvis: [0, 1.04, 0], hands: one([0.35, 2.05, 0.05]), elbows: one([1, -0.3, 0]), feet: one({ t: [0.1, -0.45, -0.45] }), knees: one([0, -0.3, 1]) };
        return rep(A, Object.assign({}, A, { pelvis: [0, 1.3, 0.02] }), { c: 0.42 }); })(),
      props: sk => { const k = add(mid(sk.kn.L, sk.kn.R), [0, -0.08, -0.05]); return [box(k, [0.42, 0.06, 0.32], 'pad'), cap(add(k, [0, -0.03, -0.1]), [0, 0.15, -0.45], 0.025, 0.025, 'metal')].concat(hangBar(2.1)); } },

    'seated-row-machine': { name: 'Seated Row (Machine)', eq: 'Machine', hi: ['torso'], cam: { yaw: 1.1, pitch: 0.2 },
      keys: rep(seated({ up: [0, 1, 0.12], hands: one([0.2, 1.0, 0.56]), elbows: one([0.3, -0.2, -1]) }), seated({ up: [0, 1, 0.12], hands: one([0.24, 1.0, 0.2]), elbows: one([0.3, -0.2, -1]) })),
      props: sk => E.seat(0.5, 0).concat([box([0, 1.0, 0.27], [0.32, 0.42, 0.08], 'pad')], E.upright(0, 0.85, 1.75), levers(sk, [0.25, 1.6, 0.85])) },

    'iso-lateral-high-row-plate-loaded': { name: 'Iso-Lateral High Row (Plate-loaded)', eq: 'Plate-loaded', hi: ['torso'], cam: { yaw: 1.1, pitch: 0.2 },
      keys: rep(seated({ up: [0, 1, 0.08], hands: one([0.27, 1.48, 0.36]), elbows: one([1, -0.3, -0.3]) }), seated({ up: [0, 1, 0.08], hands: one([0.28, 1.15, 0.12]), elbows: one([0.6, -1, -0.6]) })),
      props: sk => E.seat(0.5, 0).concat([box([0, 1.0, 0.25], [0.32, 0.42, 0.08], 'pad'), box([0, 0.76, 0.38], [0.42, 0.08, 0.1], 'pad')], E.upright(0, -0.35, 2.1),
        ['L', 'R'].flatMap(k => { const s = k === 'L' ? 1 : -1, pv = [s * 0.3, 1.95, -0.15]; return E.handle(sk.grip[k], [0, 1, 0]).concat([cap(pv, sk.grip[k], 0.022, 0.022, 'metal'), disc(add(pv, [s * 0.1, 0, -0.05]), [1, 0, 0], 0.17, 'plate')]); })) },

    'bent-over-row-barbell': { name: 'Bent Over Row (Barbell)', eq: 'Barbell', hi: ['torso'], cam: { yaw: 1.3, pitch: 0.2 },
      keys: rep(ROW_A, Object.assign({}, ROW_A, { hands: one([0.24, 0.84, 0.2]) })),
      props: sk => E.barbell(sk.grip.L, sk.grip.R) },

    'one-arm-row-dumbbell': { name: 'One-Arm Row (Dumbbell)', eq: 'Dumbbell', hi: ['torso'], cam: { yaw: 1.2, pitch: 0.2 },
      keys: (() => { const A = { pelvis: [0.05, 0.85, -0.25], up: [0, 0.29, 0.96], fwd: [0, -0.96, 0.29], hands: { L: [0.24, 0.47, 0.28], R: [-0.15, 0.5, 0.3] }, elbows: { L: [0, 0.3, -1], R: [-0.3, 0, -1] },
        feet: { L: [0.22, 0.08, -0.05], R: [-0.15, 0.08, -0.5] }, knees: { L: [0.2, 0, 1], R: [-0.1, 0, 1] } };
        return rep(A, Object.assign({}, A, { hands: { L: [0.25, 0.83, 0.02], R: [-0.15, 0.5, 0.3] }, elbows: { L: [0.2, 1, -0.6], R: [-0.3, 0, -1] } })); })(),
      props: sk => [box([-0.17, 0.21, 0.5], [0.35, 0.42, 0.9], 'pad')].concat(E.dumbbell(sk.grip.L, [0, 0, 1])) },

    'chest-supported-row-machine': { name: 'Chest-Supported Row (Machine)', eq: 'Machine', hi: ['torso'], cam: { yaw: 1.2, pitch: 0.2 },
      keys: rep(seated({ up: [0, 1, 0.35], hands: one([0.2, 0.86, 0.58]), elbows: one([0.3, 0.2, -1]) }), seated({ up: [0, 1, 0.35], hands: one([0.25, 0.98, 0.0]), elbows: one([0.3, 0.4, -1]) })),
      props: sk => E.seat(0.5, 0).concat(E.torsoPad(sk, [0, 0.3, 0.18], [0.18, 0.25, 0.035]), E.upright(0, 0.85, 1.75), levers(sk, [0.25, 1.7, 0.7])) },

    'straight-arm-pulldown-cable': { name: 'Straight-Arm Pulldown (Cable)', eq: 'Cable', hi: ['torso'], cam: { yaw: 1.25, pitch: 0.12 },
      keys: (() => { const S = { pelvis: [0, 0.95, -0.05], up: [0, 1, 0.3], elbows: one([0, 1, -0.2]), feet: one([0.14, 0.08, 0]) };
        return rep(Object.assign({}, S, { hands: one([0.22, 1.7, 0.55]) }), Object.assign({}, S, { hands: one([0.22, 0.95, 0.25]) })); })(),
      props: sk => E.pulley([0, 2.1, 0.95]).concat(E.bar(sk.grip.L, sk.grip.R, 0.1), [line([0, 2.1, 0.95], mid(sk.grip.L, sk.grip.R))]) },

    'shrug-dumbbell': { name: 'Shrug (Dumbbell)', eq: 'Dumbbell', hi: ['torso'], cam: { yaw: 0.5, pitch: 0.1 },
      keys: like('shrug-machine'), props: sk => pairDB(sk, [0, 0, 1]) },

    'shrug-barbell': { name: 'Shrug (Barbell)', eq: 'Barbell', hi: ['torso'], cam: { yaw: 0.9, pitch: 0.1 },
      keys: rep({ hands: one([0.24, 0.94, 0.1]), elbows: one([0, -0.3, -1]) }, { shrug: 0.07, hands: one([0.24, 1.01, 0.1]), elbows: one([0, -0.3, -1]) }, { c: 0.3, h1: 0.14 }),
      props: sk => E.barbell(sk.grip.L, sk.grip.R) },

    'deadlift-barbell': { name: 'Deadlift (Barbell)', eq: 'Barbell', hi: ['pelvis', 'thighs', 'torso'], cam: { yaw: 1.25, pitch: 0.12 },
      keys: (() => { const F = { feet: one([0.16, 0.08, 0.02]), knees: one([0.2, 0, 1]) }, A = Object.assign({ pelvis: [0, 0.62, -0.3], up: [0, 0.45, 0.89], hands: one([0.24, 0.3, 0.15]), elbows: one([0, 0, -1]) }, F),
          M = Object.assign({ pelvis: [0, 0.8, -0.1], up: [0, 0.8, 0.6], hands: one([0.22, 0.68, 0.15]), elbows: one([0, -0.2, -1]) }, F), T = Object.assign({ pelvis: [0, 0.99, 0], up: [0, 1, 0], hands: one([0.22, 0.94, 0.08]), elbows: one([0, -0.3, -1]) }, F);
        return [{ at: 0, p: A }, { at: 0.06, p: A }, { at: 0.26, p: M }, { at: 0.46, p: T }, { at: 0.56, p: T }, { at: 0.78, p: M }]; })(),
      props: sk => E.barbell(sk.grip.L, sk.grip.R, { r: 0.21 }) },

    'romanian-deadlift-barbell': { name: 'Romanian Deadlift (Barbell)', eq: 'Barbell', hi: ['pelvis', 'thighs'], cam: { yaw: 1.3, pitch: 0.12 },
      keys: [{ at: 0, p: RDL_TOP }, { at: 0.06, p: RDL_TOP }, { at: 0.26, p: RDL_MID }, { at: 0.46, p: RDL_BOT }, { at: 0.54, p: RDL_BOT }, { at: 0.77, p: RDL_MID }], props: sk => E.barbell(sk.grip.L, sk.grip.R) },

    'romanian-deadlift-dumbbell': { name: 'Romanian Deadlift (Dumbbell)', eq: 'Dumbbell', hi: ['pelvis', 'thighs'], cam: { yaw: 1.3, pitch: 0.12 },
      keys: like('romanian-deadlift-barbell'), props: sk => pairDB(sk) },

    'back-extension': { name: 'Back Extension', eq: 'Bodyweight', hi: ['torso', 'pelvis'], cam: { yaw: 1.4, pitch: 0.15 },
      keys: (() => { const A = { pelvis: [0, 0.95, -0.1], up: [0, 0.814, 0.581], fwd: [0, -0.581, 0.814], hands: one({ t: [0.08, 0.36, 0.16] }), elbows: one([1, 0, 0]), feet: one([0.12, 0.25, -0.6]), knees: one([0, -1, 0.3]), footDir: one([0, -0.6, 0.8]) };
        return rep(A, Object.assign({}, A, { up: [0, -0.5, 0.866], fwd: [0, -0.866, -0.5] }), { h0: 0.1, c: 0.4, h1: 0.06 }); })(),
      props: () => { const u = [0, 0.814, 0.581], f = [0, -0.581, 0.814];
        return [obox([0, 0.84, 0.055], [[0.2, 0, 0], mul(u, 0.14), mul(f, 0.045)], 'pad'), obox([0, 0.2, -0.62], [[0.22, 0, 0], [0, 0.07, 0.1], [0, 0.015, -0.01]], 'metal'),
          cap([0, 0.1, -0.75], [0, 0.78, -0.02], 0.03, 0.03, 'frame'), cap([0, 0.05, -0.85], [0, 0.05, 0.4], 0.03, 0.03, 'frame')]; } },

    // ----- shoulders -----
    'overhead-press-barbell': { name: 'Overhead Press (Barbell)', eq: 'Barbell', hi: ['delts'], cam: { yaw: 1.1, pitch: 0.12 },
      keys: rep({ hands: one([0.25, 1.47, 0.16]), elbows: one([0.3, -1, 0.6]) }, { hands: one([0.22, 1.98, 0.03]), elbows: one([1, -0.3, 0.1]) }, { c: 0.4 }),
      props: sk => E.barbell(sk.grip.L, sk.grip.R, { len: 1.9, plateAt: 0.78 }) },

    'shoulder-press-machine': { name: 'Shoulder Press (Machine)', eq: 'Machine', hi: ['delts'],
      keys: like('seated-overhead-press-dumbbell'),
      props: sk => E.seat(0.5, 0).concat(E.back([0, 0.98, -0.17], 0.7), levers(sk, [0.38, 1.05, -0.3], [0, 0, 1])) },

    'arnold-press-dumbbell': { name: 'Arnold Press (Dumbbell)', eq: 'Dumbbell', hi: ['delts'], cam: { yaw: 0.7, pitch: 0.1 },
      keys: rep(seated({ up: [0, 1, -0.04], hands: one([0.12, 1.3, 0.17]), elbows: one([0.2, -0.6, 1]) }), seated({ up: [0, 1, -0.04], hands: one([0.15, 1.6, 0]), elbows: one([1, -0.6, 0.1]) })),
      props: sk => E.seat(0.5, 0).concat(E.back([0, 0.98, -0.17], 0.7), pairDB(sk)) },

    'lateral-raise-machine': { name: 'Lateral Raise (Machine)', eq: 'Machine', hi: ['delts'], cam: { yaw: 0.45, pitch: 0.15 },
      keys: rep(seated({ hands: one([0.24, 0.66, 0.27]), elbows: one([1, -0.8, -0.4]) }), seated({ hands: one([0.48, 1.07, 0.26]), elbows: one([1, 0, -0.6]) })),
      props: sk => E.seat(0.5, 0).concat([box([0, 0.98, 0.24], [0.3, 0.42, 0.08], 'pad')], E.upright(0, 0.4, 1.5),
        ['L', 'R'].flatMap(k => { const s = k === 'L' ? 1 : -1, pad = add(sk.el[k], [s * 0.05, 0, 0]); return [cap(pad, add(pad, mul(norm(sub(sk.wr[k], sk.el[k])), 0.12)), 0.045, 0.045, 'pad'), cap([s * 0.1, 1.12, 0.3], pad, 0.018, 0.018, 'metal')]; })) },

    'front-raise-cable': { name: 'Front Raise (Cable)', eq: 'Cable', hi: ['delts'], cam: { yaw: 1.0, pitch: 0.12 },
      keys: like('front-raise-dumbbell'),
      props: sk => E.pulley([0, 0.15, -0.45], 0.5).concat(E.bar(sk.grip.L, sk.grip.R, 0.06), [line([0, 0.15, -0.45], mid(sk.grip.L, sk.grip.R))]) },

    'reverse-fly-dumbbell': { name: 'Reverse Fly (Dumbbell)', eq: 'Dumbbell', hi: ['delts'], cam: { yaw: 0.5, pitch: 0.35 },
      keys: (() => { const A = { pelvis: [0, 0.9, -0.15], up: [0, 0.5, 0.866], hands: one([0.17, 0.62, 0.32]), elbows: one([0.5, 0.3, -1]), feet: one([0.14, 0.08, 0]), knees: one([0.1, 0, 1]) };
        return rep(A, Object.assign({}, A, { hands: one([0.7, 1.0, 0.3]), elbows: one([0, 0.6, -1]) })); })(),
      props: sk => pairDB(sk, [0, 0, 1]) },

    'face-pull-cable': { name: 'Face Pull (Cable)', eq: 'Cable', hi: ['delts'], cam: { yaw: 0.8, pitch: 0.2 },
      keys: (() => { const S = { pelvis: [0, 0.99, -0.02], up: [0, 1, -0.05], feet: { L: [0.14, 0.08, 0.15], R: [-0.14, 0.08, -0.2] }, knees: { L: [0.1, 0, 1], R: [-0.1, 0, 1] } };
        return rep(Object.assign({}, S, { hands: one([0.08, 1.48, 0.47]), elbows: one([1, 0, -0.3]) }), Object.assign({}, S, { hands: one([0.3, 1.6, 0.08]), elbows: one([1, 0.4, -0.4]) })); })(),
      props: sk => E.pulley([0, 1.75, 0.95]).concat(E.rope([0, 1.75, 0.95], sk.grip.L, sk.grip.R)) },

    'upright-row-cable': { name: 'Upright Row (Cable)', eq: 'Cable', hi: ['delts'], cam: { yaw: 0.8, pitch: 0.1 },
      keys: rep({ hands: one([0.1, 0.95, 0.12]), elbows: one([1, 0, -0.2]) }, { hands: one([0.12, 1.42, 0.15]), elbows: one([1, 0.6, -0.2]) }),
      props: sk => E.pulley([0, 0.12, 0.5], 0.5).concat(E.bar(sk.grip.L, sk.grip.R, 0.08), [line([0, 0.12, 0.5], mid(sk.grip.L, sk.grip.R))]) },

    // ----- arms -----
    'bicep-curl-barbell': { name: 'Bicep Curl (Barbell)', eq: 'Barbell', hi: ['arms'], cam: { yaw: 0.9, pitch: 0.1 },
      keys: rep({ hands: one([0.2, 0.94, 0.08]), elbows: one([0, -0.4, -1]) }, { hands: one([0.2, 1.3, 0.27]), elbows: one([0, -0.4, -1]) }),
      props: sk => E.barbell(sk.grip.L, sk.grip.R, { len: 1.5, plateAt: 0.6, r: 0.16 }) },

    'hammer-curl-dumbbell': { name: 'Hammer Curl (Dumbbell)', eq: 'Dumbbell', hi: ['arms', 'forearms'], cam: { yaw: 0.8, pitch: 0.1 },
      keys: like('bicep-curl-dumbbell'),
      props: sk => ['L', 'R'].flatMap(k => E.dumbbell(sk.grip[k], cross(norm(sub(sk.wr[k], sk.el[k])), [1, 0, 0]))) },

    'incline-curl-dumbbell': { name: 'Incline Curl (Dumbbell)', eq: 'Dumbbell', hi: ['arms'], cam: { yaw: 1.2, pitch: 0.15 },
      keys: (() => { const A = { pelvis: [0, 0.6, 0.12], up: [0, 0.866, -0.5], fwd: [0, 0.5, 0.866], elbows: one([0, -1, -0.4]), feet: one([0.25, 0.08, 0.62]), knees: one([0, 0.5, 1]) };
        return rep(Object.assign({}, A, { hands: one([0.2, 0.48, -0.1]) }), Object.assign({}, A, { hands: one([0.2, 0.82, 0.1]) })); })(),
      props: sk => inclineBench(sk).concat(pairDB(sk)) },

    'preacher-curl-machine': { name: 'Preacher Curl (Machine)', eq: 'Machine', hi: ['arms'], cam: { yaw: 1.2, pitch: 0.15 },
      keys: rep(seated({ up: [0, 1, 0.1], hands: one([0.18, 0.82, 0.45]), elbows: one([0, -1, 0.5]) }), seated({ up: [0, 1, 0.1], hands: one([0.17, 1.22, 0.3]), elbows: one([0, -1, 0.5]) })),
      props: sk => E.seat(0.5, 0).concat([obox(add(mid(sk.el.L, sk.el.R), [0, -0.07, -0.03]), [[0.3, 0, 0], [0, -0.09, 0.13], [0, 0.03, 0.02]], 'pad')], E.bar(sk.grip.L, sk.grip.R, 0.08),
        ['L', 'R'].map(k => cap([k === 'L' ? 0.32 : -0.32, 0.82, 0.3], add(sk.grip[k], [k === 'L' ? 0.08 : -0.08, 0, 0]), 0.02, 0.02, 'metal'))) },

    'preacher-curl-ez-bar': { name: 'Preacher Curl (EZ Bar)', eq: 'Barbell', hi: ['arms'], cam: { yaw: 1.2, pitch: 0.15 },
      keys: like('preacher-curl-machine'),
      props: sk => E.seat(0.5, 0).concat([obox(add(mid(sk.el.L, sk.el.R), [0, -0.07, -0.03]), [[0.3, 0, 0], [0, -0.09, 0.13], [0, 0.03, 0.02]], 'pad'), box([0, 0.4, 0.3], [0.08, 0.8, 0.08], 'frame')], ez(sk)) },

    'bayesian-curl-cable': { name: 'Bayesian Curl (Cable)', eq: 'Cable', hi: ['arms'], cam: { yaw: 1.4, pitch: 0.12 },
      keys: (() => { const S = { up: [0, 1, 0.08], elbows: { L: [0, -1, -0.4], R: [0, -0.3, -1] }, feet: { L: [0.14, 0.08, 0.2], R: [-0.14, 0.08, -0.2] }, knees: { L: [0.1, 0, 1], R: [-0.1, 0, 1] } };
        return rep(Object.assign({}, S, { hands: { L: [0.22, 1.02, -0.23], R: [-0.22, 0.95, 0.05] } }), Object.assign({}, S, { hands: { L: [0.2, 1.35, 0.14], R: [-0.22, 0.95, 0.05] } })); })(),
      props: sk => E.pulley([0.25, 0.15, -0.8], 0.5).concat(E.handle(sk.grip.L, [1, 0, 0]), [line([0.25, 0.15, -0.8], sk.grip.L)]) },

    'concentration-curl-dumbbell': { name: 'Concentration Curl (Dumbbell)', eq: 'Dumbbell', hi: ['arms'], cam: { yaw: 0.5, pitch: 0.25 },
      keys: (() => { const A = { pelvis: [0, 0.5, 0], up: [0, 0.8, 0.6], elbows: { L: [-0.3, -1, 0.3], R: [-0.5, -0.3, -0.5] }, feet: one([0.35, 0.08, 0.45]), knees: one([0.5, 1, 0.5]) };
        return rep(Object.assign({}, A, { hands: { L: [0.15, 0.45, 0.5], R: [-0.3, 0.55, 0.4] } }), Object.assign({}, A, { hands: { L: [0.08, 0.85, 0.45], R: [-0.3, 0.55, 0.4] } })); })(),
      props: sk => [box([0, 0.2, -0.05], [1.0, 0.4, 0.35], 'pad')].concat(E.dumbbell(sk.grip.L, [1, 0, 0])) },

    'single-arm-pushdown-cable': { name: 'Single-Arm Pushdown (Cable)', eq: 'Cable', hi: ['arms'], cam: { yaw: 0.9, pitch: 0.12 },
      keys: (() => { const S = { pelvis: [0, 0.98, 0], up: [0, 1, 0.12], elbows: { L: [0, -0.3, -1], R: [-1, 0, -0.5] } };
        return rep(Object.assign({}, S, { hands: { L: [0.13, 1.18, 0.3], R: { t: [-0.2, 0.05, 0.05] } } }), Object.assign({}, S, { hands: { L: [0.15, 0.93, 0.18], R: { t: [-0.2, 0.05, 0.05] } } })); })(),
      props: sk => E.pulley([0.13, 2.1, 0.45]).concat(E.handle(sk.grip.L, [1, 0, 0]), [line([0.13, 2.1, 0.45], sk.grip.L)]) },

    'skull-crusher-ez-bar': { name: 'Skull Crusher (EZ Bar)', eq: 'Barbell', hi: ['arms'], cam: { yaw: 1.15, pitch: 0.25 },
      keys: rep(lying({ hands: one([0.15, 1.14, -0.36]), elbows: one([0, 1, 0.3]) }), lying({ hands: one([0.15, 0.82, -0.63]), elbows: one([0, 1, 0.3]) }), { c: 0.45 }),
      props: sk => E.bench(-0.9, 0.45).concat(ez(sk)) },

    'overhead-triceps-extension-dumbbell': { name: 'Overhead Triceps Extension (Dumbbell)', eq: 'Dumbbell', hi: ['arms'], cam: { yaw: 1.25, pitch: 0.1 },
      keys: rep({ hands: one([0.04, 1.98, 0.02]), elbows: one([0.3, 1, 0.2]) }, { hands: one([0.04, 1.43, -0.2]), elbows: one([0.3, 1, 0.2]) }),
      props: sk => E.dumbbell(add(mid(sk.grip.L, sk.grip.R), mul(norm(add(sub(sk.wr.L, sk.el.L), sub(sk.wr.R, sk.el.R))), 0.06)), add(sub(sk.wr.L, sk.el.L), sub(sk.wr.R, sk.el.R))) },

    'triceps-dip-machine': { name: 'Triceps Dip (Machine)', eq: 'Machine', hi: ['arms'], cam: { yaw: 1.1, pitch: 0.12 },
      keys: rep(seated({ hands: one([0.25, 0.85, 0.05]), elbows: one([0, 0, -1]) }), seated({ hands: one([0.25, 0.56, 0.0]), elbows: one([0, 0, -1]) })),
      props: sk => E.seat(0.5, 0).concat(E.back([0, 0.98, -0.17], 0.7), levers(sk, [0.32, 0.95, -0.35], [0, 0, 1])) },

    'wrist-curl-dumbbell': { name: 'Wrist Curl (Dumbbell)', eq: 'Dumbbell', hi: ['forearms'], cam: { yaw: 1.2, pitch: 0.3 },
      keys: (() => { const A = { pelvis: [0, 0.5, 0], up: [0, 0.85, 0.5], hands: one([0.13, 0.55, 0.55]), elbows: one([0, -1, -0.3]), feet: one([0.15, 0.08, 0.5]), knees: one([0, 1, 0.6]) };
        return rep(Object.assign({}, A, { handDir: one([0, -0.7, 0.7]) }), Object.assign({}, A, { handDir: one([0, 0.7, 0.7]) }), { c: 0.3, h1: 0.1 }); })(),
      props: sk => [box([0, 0.2, -0.05], [0.5, 0.4, 0.5], 'pad')].concat(pairDB(sk)) },

    'reverse-curl-ez-bar': { name: 'Reverse Curl (EZ Bar)', eq: 'Barbell', hi: ['forearms', 'arms'], cam: { yaw: 0.9, pitch: 0.1 },
      keys: like('bicep-curl-barbell'), props: ez },

    // ----- legs -----
    'squat-barbell': { name: 'Squat (Barbell)', eq: 'Barbell', hi: ['thighs', 'pelvis'], cam: { yaw: 1.15, pitch: 0.15 },
      keys: like('squat-smith-machine'),
      props: sk => { const c = add(add(sk.P, mul(sk.up, 0.5)), mul(sk.f, -0.07)); return E.barbell(add(c, [-0.3, 0, 0]), add(c, [0.3, 0, 0]), { len: 1.9, plateAt: 0.8, r: 0.2 }); } },

    'front-squat-barbell': { name: 'Front Squat (Barbell)', eq: 'Barbell', hi: ['thighs'], cam: { yaw: 1.15, pitch: 0.15 },
      keys: (() => { const S = { hands: one({ t: [0.2, 0.47, 0.2] }), elbows: one([0.2, 0.3, 1]), feet: one([0.2, 0.08, 0.12]), knees: one([0.3, 0, 1]), footDir: one([0.25, 0, 1]) };
        return rep(Object.assign({}, S, { pelvis: [0, 0.97, -0.02], up: [0, 1, 0.03] }), Object.assign({}, S, { pelvis: [0, 0.56, -0.2], up: [0, 0.94, 0.34] }), { c: 0.45 }); })(),
      props: sk => { const c = add(add(sk.P, mul(sk.up, 0.5)), mul(sk.f, 0.15)); return E.barbell(add(c, [-0.3, 0, 0]), add(c, [0.3, 0, 0]), { len: 1.9, plateAt: 0.8, r: 0.2 }); } },

    'pendulum-squat-machine': { name: 'Pendulum Squat (Machine)', eq: 'Machine', hi: ['thighs'], cam: { yaw: 1.3, pitch: 0.15 },
      keys: like('hack-squat-machine'),
      props: sk => E.torsoPad(sk, [0, 0.3, -0.14], [0.2, 0.36, 0.035]).concat(['L', 'R'].map(k => sph(add(sk.sh[k], mul(sk.up, 0.07)), 0.06, 'pad')),
        [cap(add(sk.P, mul(sk.up, 0.3)), [0, 1.9, -1.0], 0.035, 0.035, 'frame'), sph([0, 1.9, -1.0], 0.06, 'metal'), box([0, 0.95, -1.05], [0.12, 1.9, 0.12], 'frame'), box([0, 0.08, 0.32], [0.6, 0.05, 0.5], 'metal', deg(-20))]) },

    'leg-press-machine': { name: 'Leg Press (Machine)', eq: 'Machine', hi: ['thighs', 'pelvis'], cam: { yaw: 1.3, pitch: 0.2 },
      keys: (() => { const A = { pelvis: [0, 0.5, 0], up: [0, 0.75, -0.66], fwd: [0, 0.66, 0.75], hands: one([0.28, 0.55, 0.05]), elbows: one([0.3, -0.2, -1]), knees: one([0.2, 1, 0]), footDir: one([0, 0.88, -0.47]) };
        return rep(Object.assign({}, A, { feet: one([0.14, 0.86, 0.73]) }), Object.assign({}, A, { feet: one([0.14, 0.66, 0.39]) }), { c: 0.45 }); })(),
      props: legPressProps },

    'bulgarian-split-squat-dumbbell': { name: 'Bulgarian Split Squat (Dumbbell)', eq: 'Dumbbell', hi: ['thighs', 'pelvis'], cam: { yaw: 1.3, pitch: 0.12 },
      keys: (() => { const A = Object.assign({}, STAND_DB, { feet: { L: [0.12, 0.08, 0.25], R: [-0.12, 0.5, -0.65] }, knees: { L: [0, 0, 1], R: [0, -1, 0.3] }, footDir: { L: [0, 0, 1], R: [0, -0.3, -1] } });
        return rep(Object.assign({}, A, { pelvis: [0, 0.9, -0.05], up: [0, 1, 0.05] }), Object.assign({}, A, { pelvis: [0, 0.55, -0.1], up: [0, 1, 0.15] }), { c: 0.45 }); })(),
      props: sk => [box([0, 0.21, -0.75], [0.4, 0.42, 0.4], 'pad')].concat(pairDB(sk, [0, 0, 1])) },

    'walking-lunge-dumbbell': { name: 'Walking Lunge (Dumbbell)', eq: 'Dumbbell', hi: ['thighs', 'pelvis'], cam: { yaw: 1.3, pitch: 0.12 }, dur: 4.2,
      keys: (() => { const S = Object.assign({}, STAND_DB, { feet: { L: [0.12, 0.08, 0] }, knees: { L: [0.1, 0, 1] } }), R = swapLR(LUNGE);
        return [{ at: 0, p: S }, { at: 0.05, p: S }, { at: 0.25, p: LUNGE }, { at: 0.3, p: LUNGE }, { at: 0.5, p: S }, { at: 0.55, p: S }, { at: 0.75, p: R }, { at: 0.8, p: R }]; })(),
      props: sk => pairDB(sk, [0, 0, 1]) },

    'goblet-squat-dumbbell': { name: 'Goblet Squat (Dumbbell)', eq: 'Dumbbell', hi: ['thighs', 'pelvis'], cam: { yaw: 1.15, pitch: 0.15 },
      keys: like('squat-smith-machine', p => Object.assign(p, { hands: one({ t: [0.07, 0.38, 0.2] }), elbows: one([0.3, -1, 0.3]) })),
      props: sk => E.dumbbell(add(mid(sk.grip.L, sk.grip.R), mul(sk.up, -0.04)), sk.up) },

    'seated-leg-curl-machine': { name: 'Seated Leg Curl (Machine)', eq: 'Machine', hi: ['thighs'], cam: { yaw: 1.25, pitch: 0.15 },
      keys: (() => { const A = { pelvis: [0, 0.62, 0], up: [0, 1, -0.1], hands: one([0.3, 0.58, 0.1]), elbows: one([0.3, -0.2, -1]), knees: one([0, 1, 0.3]) };
        return rep(Object.assign({}, A, { feet: one([0.11, 0.6, 0.85]), footDir: one([0, 1, 0.1]) }), Object.assign({}, A, { feet: one([0.11, 0.22, 0.38]), footDir: one([0, 0.3, 1]) })); })(),
      props: sk => { const sh = norm(sub(sk.an.L, sk.kn.L)), n = mul(norm(cross([1, 0, 0], sh)), 0.065);
        return E.seat(0.56, 0.17).concat(E.back([0, 0.95, -0.17], 0.6, deg(-6)), E.roller(sk, n), [box(add(mid(sk.kn.L, sk.kn.R), [0, 0.1, -0.1]), [0.42, 0.06, 0.16], 'pad')]); } },

    'standing-leg-curl-machine': { name: 'Standing Leg Curl (Machine)', eq: 'Machine', hi: ['thighs'], cam: { yaw: 1.35, pitch: 0.12 },
      keys: (() => { const A = { up: [0, 1, 0.15], hands: one({ t: [0.25, 0.35, 0.25] }), elbows: one([0.3, -1, -0.3]), knees: { L: [0, 0, 1], R: [0, 0, 1] } };
        return rep(Object.assign({}, A, { feet: { L: [0.12, 0.08, 0], R: [-0.12, 0.08, 0] }, footDir: { L: [0, 0, 1], R: [0, 0, 1] } }), Object.assign({}, A, { feet: { L: [0.12, 0.5, -0.38], R: [-0.12, 0.08, 0] }, footDir: { L: [0, -0.6, -0.8], R: [0, 0, 1] } })); })(),
      props: sk => [cap(add(sk.an.L, [0.12, 0.02, -0.06]), add(sk.an.L, [-0.08, 0.02, -0.06]), 0.045, 0.045, 'pad'), box([0, 0.85, 0.2], [0.35, 0.3, 0.08], 'pad'), box([0, 0.65, 0.35], [0.12, 1.3, 0.12], 'frame')] },

    'nordic-curl': { name: 'Nordic Curl', eq: 'Reps only', hi: ['thighs'], cam: { yaw: 1.4, pitch: 0.15 },
      keys: rep(NORDIC_TOP, Object.assign({}, NORDIC_TOP, { pelvis: [0, 0.38, 0.4], up: [0, 0.57, 0.82], fwd: [0, -0.82, 0.57] }), { c: 0.5, h1: 0.04 }),
      props: sk => [box([0, 0.03, -0.1], [0.5, 0.06, 0.6], 'pad')].concat(E.roller(sk, [0, 0.07, 0])) },

    'glute-ham-raise': { name: 'Glute-Ham Raise', eq: 'Bodyweight', hi: ['thighs', 'pelvis'], cam: { yaw: 1.4, pitch: 0.15 },
      keys: rep(shift(NORDIC_TOP, 0.5), Object.assign(shift(NORDIC_TOP, 0.5), { pelvis: [0, 0.67, 0.485], up: [0, 0.15, 0.99], fwd: [0, -0.99, 0.15] }), { c: 0.45 }),
      props: sk => [box([0, 0.52, 0.12], [0.42, 0.1, 0.32], 'pad'), box([0, 0.6, -0.5], [0.4, 0.3, 0.04], 'metal'), box([0, 0.25, -0.1], [0.12, 0.5, 0.9], 'frame')].concat(E.roller(sk, [0, 0.07, 0])) },

    'hip-thrust-barbell': { name: 'Hip Thrust (Barbell)', eq: 'Barbell', hi: ['pelvis'], cam: { yaw: 1.3, pitch: 0.15 },
      keys: rep(HIP_THRUST_A, HIP_THRUST_B, { c: 0.38, h1: 0.12 }),
      props: sk => [box([0, 0.21, -0.55], [1.2, 0.42, 0.4], 'pad')].concat(E.barbell(sk.grip.L, sk.grip.R, { r: 0.22 })) },

    'hip-thrust-machine': { name: 'Hip Thrust (Machine)', eq: 'Machine', hi: ['pelvis'], cam: { yaw: 1.3, pitch: 0.15 },
      keys: like('hip-thrust-barbell'),
      props: sk => [box([0, 0.21, -0.55], [0.7, 0.42, 0.4], 'pad')].concat(E.torsoPad(sk, [0, 0.02, 0.17], [0.26, 0.07, 0.03]),
        ['L', 'R'].map(k => cap([k === 'L' ? 0.32 : -0.32, 0.3, -0.5], add(sk.P, add(mul(sk.f, 0.17), mul(sk.side, k === 'L' ? 0.26 : -0.26))), 0.025, 0.025, 'metal')), E.upright(0.32, -0.5, 0.6), E.upright(-0.32, -0.5, 0.6)) },

    'reverse-hyper-machine': { name: 'Reverse Hyper (Machine)', eq: 'Machine', hi: ['pelvis'], cam: { yaw: 1.4, pitch: 0.2 },
      keys: (() => { const A = { pelvis: [0, 1.05, -0.05], up: [0, 0, 1], fwd: [0, -1, 0], hands: one([0.2, 0.85, 0.75]), elbows: one([0.5, 0, -0.5]), knees: one([0, -1, 0]) };
        return rep(Object.assign({}, A, { feet: one([0.12, 0.25, -0.2]), footDir: one([0, -0.5, 0.8]) }), Object.assign({}, A, { feet: one([0.12, 1.0, -0.85]), footDir: one([0, -0.9, -0.3]) }), { c: 0.38, h1: 0.1 }); })(),
      props: sk => [box([0, 0.9, 0.32], [0.4, 0.08, 0.75], 'pad'), box([0, 0.45, 0.35], [0.12, 0.9, 0.12], 'frame'), cap([0, 0.9, -0.05], add(mid(sk.an.L, sk.an.R), [0, 0, -0.06]), 0.025, 0.025, 'metal')]
        .concat(E.roller(sk, [0, 0, -0.06]), E.handle([0.2, 0.85, 0.78], [1, 0, 0]), E.handle([-0.2, 0.85, 0.78], [1, 0, 0])) },

    'cable-pull-through': { name: 'Cable Pull-Through', eq: 'Cable', hi: ['pelvis'], cam: { yaw: 1.3, pitch: 0.12 },
      keys: (() => { const S = { feet: one([0.2, 0.08, 0]), knees: one([0.3, 0, 1]) };
        return rep(Object.assign({}, S, { pelvis: [0, 0.97, 0], up: [0, 1, 0], hands: one([0.06, 0.97, 0.12]), elbows: one([0, -0.3, -1]) }), Object.assign({}, S, { pelvis: [0, 0.88, -0.12], up: [0, 0.55, 0.835], hands: one([0.06, 0.68, 0.12]), elbows: one([0, 0, -1]) }), { c: 0.45 }); })(),
      props: sk => E.pulley([0, 0.15, -0.9], 0.5).concat(E.rope([0, 0.15, -0.9], sk.grip.L, sk.grip.R)) },

    'glute-kickback-cable': { name: 'Glute Kickback (Cable)', eq: 'Cable', hi: ['pelvis'], cam: { yaw: 1.4, pitch: 0.15 },
      keys: rep(KICK_A, KICK_B, { c: 0.38, h1: 0.1 }),
      props: sk => E.pulley([0.12, 0.12, 0.65], 0.5).concat([line([0.12, 0.12, 0.65], sk.an.L), cap([0.3, 1.2, 0.5], [-0.3, 1.2, 0.5], 0.02, 0.02, 'metal')], E.upright(0.3, 0.55, 1.2), E.upright(-0.3, 0.55, 1.2)) },

    'glute-kickback-machine': { name: 'Glute Kickback (Machine)', eq: 'Machine', hi: ['pelvis'], cam: { yaw: 1.4, pitch: 0.15 },
      keys: like('glute-kickback-cable'),
      props: sk => E.torsoPad(sk, [0, 0.35, 0.18], [0.18, 0.18, 0.035]).concat([cap(add(sk.an.L, [0.1, 0, -0.07]), add(sk.an.L, [-0.06, 0, -0.07]), 0.045, 0.045, 'pad'), cap([0.25, 0.95, -0.02], add(sk.an.L, [0.1, 0, -0.07]), 0.022, 0.022, 'metal'),
        cap([0.3, 1.2, 0.5], [-0.3, 1.2, 0.5], 0.02, 0.02, 'metal')], E.upright(0.3, 0.55, 1.2), E.upright(-0.3, 0.55, 1.2)) },

    'seated-calf-raise-machine': { name: 'Seated Calf Raise (Machine)', eq: 'Machine', hi: ['calves'], cam: { yaw: 1.25, pitch: 0.15 },
      keys: rep(seated({ pelvis: [0, 0.55, 0], up: [0, 1, 0.15], hands: one([0.22, 0.68, 0.38]), elbows: one([0.3, -1, -0.3]), feet: one([0.12, 0.17, 0.45]), knees: one([0, 1, 0.3]), footDir: one([0, -0.25, 1]) }),
        seated({ pelvis: [0, 0.55, 0], up: [0, 1, 0.15], hands: one([0.22, 0.68, 0.38]), elbows: one([0.3, -1, -0.3]), feet: one([0.12, 0.26, 0.48]), knees: one([0, 1, 0.3]), footDir: one([0, -0.75, 0.66]) }), { c: 0.32, h1: 0.12 }),
      props: sk => E.seat(0.5, 0).concat([box([0, 0.06, 0.6], [0.5, 0.12, 0.2], 'metal'), box(add(mid(sk.kn.L, sk.kn.R), [0, 0.09, 0.02]), [0.45, 0.07, 0.18], 'pad'), cap(add(mid(sk.kn.L, sk.kn.R), [0, 0.09, 0.1]), [0, 0.15, 0.9], 0.025, 0.025, 'metal')]) },

    // ----- abs -----
    'cable-crunch': { name: 'Cable Crunch', eq: 'Cable', hi: ['abs'], cam: { yaw: 1.35, pitch: 0.15 },
      keys: (() => { const A = { hands: one({ t: [0.1, 0.55, 0.12] }), elbows: one([0.5, -1, 0.3]), feet: one([0.1, 0.11, -0.42]), knees: one([0, -1, 0.3]), footDir: one([0, -0.3, -1]) };
        return rep(Object.assign({}, A, { pelvis: [0, 0.6, 0], up: [0, 0.95, 0.3] }), Object.assign({}, A, { pelvis: [0, 0.58, 0.05], up: [0, 0.2, 1] }), { c: 0.35, h1: 0.1 }); })(),
      props: sk => E.pulley([0, 2.2, 0.25]).concat(E.rope([0, 2.2, 0.25], sk.grip.L, sk.grip.R), [box([0, 0.02, -0.1], [0.5, 0.04, 0.6], 'pad')]) },

    'decline-crunch': { name: 'Decline Crunch', eq: 'Reps only', hi: ['abs'], cam: { yaw: 1.35, pitch: 0.2 },
      keys: (() => { const A = { pelvis: [0, 0.7, 0.2], hands: one({ t: [0.12, 0.5, 0.1] }), elbows: one([1, 0, 0]), feet: one([0.12, 0.5, 0.7]), knees: one([0, 1, 0.2]), footDir: one([0, 0.3, 1]) };
        return rep(Object.assign({}, A, { up: [0, -0.3, -0.95], fwd: [0, 0.95, -0.3] }), Object.assign({}, A, { up: [0, 0.45, -0.89], fwd: [0, 0.89, 0.45] }), { c: 0.35, h1: 0.1 }); })(),
      props: () => { const u = norm([0, -0.3, -0.95]), f = norm([0, 0.95, -0.3]);
        return [obox(add(add([0, 0.7, 0.2], mul(f, -0.175)), mul(u, 0.25)), [[0.19, 0, 0], mul(u, 0.5), mul(f, 0.035)], 'pad'), cap([0.18, 0.44, 0.76], [-0.18, 0.44, 0.76], 0.045, 0.045, 'pad'), box([0, 0.25, 0.3], [0.1, 0.5, 0.1], 'frame')]; } },

    'hanging-leg-raise': { name: 'Hanging Leg Raise', eq: 'Reps only', hi: ['abs'], cam: { yaw: 1.2, pitch: 0.1 },
      keys: (() => { const A = { pelvis: [0, 1.24, 0], hands: one([0.3, 2.25, 0]), elbows: one([1, -0.3, 0]), knees: one([0, -1, 0.1]) };
        return rep(Object.assign({}, A, { feet: one([0.1, 0.38, 0.05]), footDir: one([0, -0.3, 1]) }), Object.assign({}, A, { up: [0, 1, -0.08], feet: one([0.1, 1.15, 0.8]), footDir: one([0, 1, 0.2]) }), { c: 0.4 }); })(),
      props: () => hangBar(2.3) },

    'ab-wheel-rollout': { name: 'Ab Wheel Rollout', eq: 'Reps only', hi: ['abs'], cam: { yaw: 1.35, pitch: 0.2 },
      keys: (() => { const A = { elbows: one([0.3, -0.2, -1]), feet: one([0.1, 0.11, -0.42]), knees: one([0, -1, 0.2]), footDir: one([0, -0.3, -1]) };
        return rep(Object.assign({}, A, { pelvis: [0, 0.55, 0.05], up: [0, 0.3, 0.95], fwd: [0, -0.95, 0.3], hands: one([0.13, 0.16, 0.58]) }), Object.assign({}, A, { pelvis: [0, 0.3, 0.35], up: [0, 0.08, 1], fwd: [0, -1, 0.08], hands: one([0.13, 0.16, 1.3]) }), { c: 0.45 }); })(),
      props: sk => { const m = mid(sk.grip.L, sk.grip.R), c = [m[0], 0.1, m[2]]; return [disc(c, [1, 0, 0], 0.1, 'plate'), cap(add(c, [0.16, 0, 0]), add(c, [-0.16, 0, 0]), 0.018, 0.018, 'metal'), box([0, 0.02, -0.25], [0.5, 0.04, 0.5], 'pad')]; } },

    'russian-twist': { name: 'Russian Twist', eq: 'Reps only', hi: ['abs'], cam: { yaw: 0.6, pitch: 0.35 }, dur: 2.6,
      keys: (() => { const A = { pelvis: [0, 0.17, 0], up: [0, 0.85, -0.5], hands: one({ t: [0.07, 0.3, 0.33] }), elbows: one([0.5, -1, 0]), feet: one([0.12, 0.3, 0.6]), knees: one([0, 1, 0]) };
        return rep(Object.assign({}, A, { fwd: [0.6, 0.35, 0.7] }), Object.assign({}, A, { fwd: [-0.6, 0.35, 0.7] }), { h0: 0.04, c: 0.42, h1: 0.04 }); })(),
      props: sk => [disc(mid(sk.grip.L, sk.grip.R), sk.f, 0.14, 'plate')].concat(mat()) },

    'plank': { name: 'Plank', eq: 'Duration', hi: ['abs'], cam: { yaw: 1.3, pitch: 0.25 }, still: true, note: 'Hold the position. The view turns slowly.',
      keys: [{ at: 0, p: { pelvis: [0, 0.3, 0.037], up: [0, 0.17, 0.985], fwd: [0, -1, 0], hands: one([0.15, 0.06, 0.78]), elbows: one([0, -1, -0.2]), feet: one([0.1, 0.15, -0.85]), knees: one([0, -1, 0]), footDir: one([0, -0.6, 0.8]) } }],
      props: mat },

    // ----- cardio -----
    'treadmill-run': { name: 'Treadmill Run', eq: 'Cardio', hi: ['thighs', 'calves'], cam: { yaw: 1.35, pitch: 0.15 }, dur: 0.75, ease: 'linear',
      keys: (() => {
        const k0 = { pelvis: [0, 0.97, 0], up: [0, 1, 0.08], feet: { L: [0.1, 0.15, 0.35], R: [-0.1, 0.35, -0.35] }, footDir: { L: [0, 0.2, 1], R: [0, -0.6, 0.8] }, knees: { L: [0, 0, 1], R: [0, 0, 1] }, hands: { L: [0.22, 1.05, -0.15], R: [-0.22, 1.2, 0.22] }, elbows: { L: [0, -1, -0.3], R: [0, -1, -0.3] } };
        const k1 = { pelvis: [0, 1.03, 0], up: [0, 1, 0.08], feet: { L: [0.1, 0.15, 0], R: [-0.1, 0.45, 0.1] }, footDir: { L: [0, 0, 1], R: [0, -0.3, 1] }, knees: { L: [0, 0, 1], R: [0, 0, 1] }, hands: { L: [0.22, 1.12, 0.03], R: [-0.22, 1.12, 0.03] }, elbows: { L: [0, -1, -0.3], R: [0, -1, -0.3] } };
        return [{ at: 0, p: k0 }, { at: 0.25, p: k1 }, { at: 0.5, p: swapLR(k0) }, { at: 0.75, p: swapLR(k1) }];
      })(),
      props: () => [box([0, 0.09, 0.05], [0.72, 0.06, 1.8], 'frame'), box([0, 0.125, 0.05], [0.5, 0.01, 1.6], 'pad'),
        cap([0.38, 0.15, 0.8], [0.38, 1.1, 0.8], 0.022, 0.022, 'metal'), cap([-0.38, 0.15, 0.8], [-0.38, 1.1, 0.8], 0.022, 0.022, 'metal'), box([0, 1.18, 0.82], [0.7, 0.2, 0.08], 'frame', deg(25))] },

    'stationary-bike': { name: 'Stationary Bike', eq: 'Cardio', hi: ['thighs'], cam: { yaw: 1.4, pitch: 0.15 }, dur: 1.2, ease: 'linear',
      keys: cyc(8, a => { const ped = b => [0.12, 0.38 + 0.16 * Math.sin(b), 0.2 + 0.16 * Math.cos(b)], r = ped(a + Math.PI);
        return { pelvis: [0, 0.95, -0.15], up: [0, 0.9, 0.45], hands: one([0.22, 1.05, 0.42]), elbows: one([0.3, -1, -0.3]), feet: { L: ped(a), R: [-r[0], r[1], r[2]] }, knees: one([0, 0.3, 1]), footDir: one([0, -0.2, 1]) }; }),
      props: sk => [box([0, 0.85, -0.17], [0.16, 0.06, 0.26], 'pad'), cap([0, 0.82, -0.15], [0, 0.38, 0.2], 0.035, 0.035, 'frame'), cap([0, 0.38, 0.2], [0, 1.0, 0.45], 0.035, 0.035, 'frame'),
        cap([0.24, 1.05, 0.46], [-0.24, 1.05, 0.46], 0.02, 0.02, 'metal'), disc([0, 0.38, 0.55], [1, 0, 0], 0.25, 'plate'), box([0, 0.03, 0.15], [0.5, 0.06, 1.0], 'frame'),
        line([0, 0.38, 0.2], sk.an.L, 'metal'), line([0, 0.38, 0.2], sk.an.R, 'metal')] },

    'elliptical': { name: 'Elliptical', eq: 'Cardio', hi: ['thighs', 'pelvis'], cam: { yaw: 1.3, pitch: 0.15 }, dur: 1.4, ease: 'linear',
      keys: cyc(8, a => ({ pelvis: [0, 1.12, 0], up: [0, 1, 0.05], knees: { L: [0, 0, 1], R: [0, 0, 1] }, footDir: { L: [0, 0, 1], R: [0, 0, 1] }, elbows: { L: [0, -1, -0.5], R: [0, -1, -0.5] },
        feet: { L: [0.12, 0.32 + 0.05 * Math.sin(a), 0.22 * Math.cos(a)], R: [-0.12, 0.32 - 0.05 * Math.sin(a), -0.22 * Math.cos(a)] },
        hands: { L: [0.25, 1.22, 0.2 - 0.15 * Math.cos(a)], R: [-0.25, 1.22, 0.2 + 0.15 * Math.cos(a)] } })),
      props: sk => ['L', 'R'].flatMap(k => [box(add(sk.an[k], [0, -0.06, 0.06]), [0.14, 0.03, 0.34], 'metal'), cap(sk.grip[k], [k === 'L' ? 0.28 : -0.28, 0.3, 0.6], 0.02, 0.02, 'metal')])
        .concat([box([0, 0.05, 0], [0.5, 0.1, 1.6], 'frame'), box([0, 0.6, 0.7], [0.12, 1.2, 0.12], 'frame'), box([0, 1.25, 0.72], [0.4, 0.18, 0.06], 'frame', deg(25))]) },

    'rowing-machine': { name: 'Rowing Machine', eq: 'Cardio', hi: ['torso', 'thighs'], cam: { yaw: 1.4, pitch: 0.2 }, dur: 2.6,
      keys: rep({ pelvis: [0, 0.35, 0.2], up: [0, 0.85, 0.5], hands: one([0.15, 0.62, 0.85]), elbows: one([0.5, -0.3, -1]), feet: one([0.12, 0.25, 0.72]), knees: one([0.15, 1, 0]), footDir: one([0, 0.6, 0.8]) },
        { pelvis: [0, 0.35, -0.1], up: [0, 0.94, -0.34], hands: one([0.12, 0.72, 0.0]), elbows: one([0.4, 0, -1]), feet: one([0.12, 0.25, 0.72]), knees: one([0.15, 1, 0]), footDir: one([0, 0.6, 0.8]) }, { h0: 0.03, c: 0.3, h1: 0.05 }),
      props: sk => [box([0, 0.15, 0.2], [0.14, 0.06, 2.0], 'frame'), box([sk.P[0], 0.21, sk.P[2]], [0.3, 0.05, 0.3], 'pad'), box([0, 0.25, 0.8], [0.4, 0.04, 0.22], 'metal', deg(-50)), box([0, 0.4, 1.15], [0.35, 0.5, 0.3], 'frame')]
        .concat(E.handle(mid(sk.grip.L, sk.grip.R), [1, 0, 0]), [line(mid(sk.grip.L, sk.grip.R), [0, 0.55, 1.0])]) },

    'stair-climber': { name: 'Stair Climber', eq: 'Cardio', hi: ['thighs', 'pelvis'], cam: { yaw: 1.35, pitch: 0.15 }, dur: 1.4,
      keys: (() => {
        const k0 = { pelvis: [0, 1.0, 0], up: [0, 1, 0.1], hands: { L: [0.25, 1.1, 0.25] }, elbows: { L: [0, -1, -0.4] }, feet: { L: [0.12, 0.4, 0.25], R: [-0.12, 0.12, 0] }, knees: { L: [0, 0, 1], R: [0, 0, 1] }, footDir: { L: [0, 0, 1], R: [0, 0, 1] } };
        const k1 = Object.assign({}, k0, { pelvis: [0, 1.05, 0.02], feet: { L: [0.12, 0.26, 0.12], R: [-0.12, 0.3, 0.1] } });
        return [{ at: 0, p: k0 }, { at: 0.25, p: k1 }, { at: 0.5, p: swapLR(k0) }, { at: 0.75, p: swapLR(k1) }];
      })(),
      props: sk => ['L', 'R'].map(k => box(add(sk.an[k], [0, -0.07, 0.06]), [0.3, 0.04, 0.3], 'metal'))
        .concat([box([0, 0.9, -0.3], [0.6, 1.8, 0.1], 'frame'), cap([0.3, 1.1, 0.4], [0.3, 1.1, -0.25], 0.02, 0.02, 'metal'), cap([-0.3, 1.1, 0.4], [-0.3, 1.1, -0.25], 0.02, 0.02, 'metal')]) }
  });

  Object.keys(DEFS).forEach(id => { const d = DEFS[id]; d.id = id; d.dur = d.dur || 3.4; resolveKeys(id).forEach(k => { k.full = full(k.p); }); });

  function frame(id, t) {
    const def = DEFS[id];
    if (!def) return null;
    const sk = skeleton(sample(def, t));
    return { sk, shapes: bodyShapes(sk, def.hi).concat(def.props ? def.props(sk) : []) };
  }

  // ---------- drawing ----------
  const PALETTE = { light: { body: '#d4d9e1', metal: '#7b828e', plate: '#3d434d', pad: '#3a4252', frame: '#a3aab5', cable: '#6b7280' },
    dark: { body: '#b8c0cc', metal: '#9aa3af', plate: '#2a2f38', pad: '#454e60', frame: '#5c6573', cable: '#9aa3af' } };
  const hex = h => { h = String(h || '').trim(); if (/^#[0-9a-f]{3}$/i.test(h)) h = '#' + h.slice(1).split('').map(x => x + x).join(''); const m = /^#([0-9a-f]{6})$/i.exec(h); if (m) { const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; } const r = /rgba?\(([^)]+)\)/.exec(h); return r ? r[1].split(',').slice(0, 3).map(Number) : [230, 120, 60]; };
  const shade = (rgb, k) => 'rgb(' + rgb.map(c => Math.round(k >= 0 ? c + (255 - c) * k : c * (1 + k))).join(',') + ')';

  function camera(def, st, w, h, fit) {
    const yaw = st.yaw, pitch = st.pitch, D = 5.5;
    const T = fit.c, cp = Math.cos(pitch);
    const pos = add(T, [D * Math.sin(yaw) * cp, D * Math.sin(pitch), D * Math.cos(yaw) * cp]);
    const f = norm(sub(T, pos)), right = norm(cross(f, [0, 1, 0])), up = cross(right, f);
    const F = Math.min(w, h) * 0.5 * D / (fit.r * 1.08);
    return { pos, f, right, up, F, cx: w / 2, cy: h / 2 };
  }
  const proj = (cam, p) => { const v = sub(p, cam.pos), z = Math.max(0.1, dot(v, cam.f)); return [cam.cx + dot(v, cam.right) * cam.F / z, cam.cy - dot(v, cam.up) * cam.F / z, z]; };

  // Bounding sphere over a cycle, so the camera never cuts the figure off at any angle.
  const fits = {};
  function fitFor(id) {
    if (fits[id]) return fits[id];
    const pts = [];
    for (let i = 0; i < 8; i++) frame(id, i / 8).shapes.forEach(s => { if (s.k === 'cap') pts.push(s.a, s.b); else if (s.k === 'box') pts.push(s.c); else if (s.k === 'line') pts.push(s.a, s.b); else pts.push(s.c); });
    const lo = [0, 1, 2].map(i => Math.min.apply(null, pts.map(p => p[i]))), hi = [0, 1, 2].map(i => Math.max.apply(null, pts.map(p => p[i])));
    const c = mid(lo, hi);
    return (fits[id] = { c, r: Math.max(0.6, Math.max.apply(null, pts.map(p => len(sub(p, c)))) + 0.12) });
  }

  function draw(ctx, w, h, id, st, colors) {
    const def = DEFS[id], fit = fitFor(id), cam = camera(def, st, w, h, fit), fr = frame(id, st.t);
    const L = norm([-0.5, 0.85, 0.6]), l2 = norm([dot(L, cam.right), -dot(L, cam.up)]);
    function norm2(v) { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; }
    ctx.clearRect(0, 0, w, h);
    // floor: soft shadow and a few grid lines
    const fc = [fit.c[0], 0, fit.c[2]], g = proj(cam, fc);
    const rx = Math.abs(proj(cam, add(fc, [0.9, 0, 0]))[0] - g[0]) + Math.abs(proj(cam, add(fc, [0, 0, 0.9]))[0] - g[0]);
    const ry = Math.abs(proj(cam, add(fc, [0, 0, 0.9]))[1] - g[1]) + Math.abs(proj(cam, add(fc, [0.9, 0, 0]))[1] - g[1]);
    ctx.save(); ctx.globalAlpha = 0.5; ctx.strokeStyle = colors.line; ctx.lineWidth = 1;
    for (let i = -3; i <= 3; i++) { const a = proj(cam, add(fc, [i * 0.4, 0, -1.2])), b = proj(cam, add(fc, [i * 0.4, 0, 1.2])), c = proj(cam, add(fc, [-1.2, 0, i * 0.4])), d = proj(cam, add(fc, [1.2, 0, i * 0.4])); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.moveTo(c[0], c[1]); ctx.lineTo(d[0], d[1]); ctx.stroke(); }
    ctx.restore();
    const grad = ctx.createRadialGradient(g[0], g[1], 0, g[0], g[1], Math.max(rx, ry, 1));
    grad.addColorStop(0, colors.shadow); grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad; ctx.beginPath(); ctx.ellipse(g[0], g[1], Math.max(rx, 1), Math.max(ry * 0.6, 1), 0, 0, Math.PI * 2); ctx.fill();

    // build draw list (box faces separately), sort far to near
    const items = [];
    fr.shapes.forEach(s => {
      if (s.k === 'box') {
        const [a, b, c] = s.ax;
        [[a, b, c], [mul(a, -1), b, c], [b, c, a], [mul(b, -1), c, a], [c, a, b], [mul(c, -1), a, b]].forEach(([n, u, v]) => {
          const fcn = add(s.c, n), nn = norm(n);
          if (dot(nn, sub(cam.pos, fcn)) <= 0) return;
          const q = [add(add(fcn, u), v), add(sub(fcn, u), v), sub(sub(fcn, u), v), sub(add(fcn, u), v)];
          items.push({ k: 'face', q, z: dot(sub(fcn, cam.pos), cam.f), light: Math.max(0, dot(nn, L)), col: s.col });
        });
      } else {
        const c = s.k === 'cap' || s.k === 'line' ? mid(s.a, s.b) : s.c;
        items.push(Object.assign({ z: dot(sub(c, cam.pos), cam.f) }, s));
      }
    });
    items.sort((a, b) => b.z - a.z);
    const rgbOf = col => col === 'hi' ? colors.hi : (colors[col] || colors.body);
    items.forEach(it => {
      const rgb = rgbOf(it.col);
      if (it.k === 'face') {
        ctx.fillStyle = shade(rgb, -0.32 + it.light * 0.42);
        ctx.beginPath(); it.q.map(p => proj(cam, p)).forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = shade(rgb, -0.45); ctx.lineWidth = 0.6; ctx.stroke();
      } else if (it.k === 'line') {
        const a = proj(cam, it.a), b = proj(cam, it.b);
        ctx.strokeStyle = shade(rgb, -0.1); ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      } else if (it.k === 'sph') {
        const p = proj(cam, it.c), r = it.r * cam.F / p[2];
        const gr = ctx.createRadialGradient(p[0] + l2[0] * r * 0.4, p[1] + l2[1] * r * 0.4, r * 0.1, p[0], p[1], r);
        gr.addColorStop(0, shade(rgb, 0.35)); gr.addColorStop(1, shade(rgb, -0.3));
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(p[0], p[1], Math.max(r, 0.5), 0, Math.PI * 2); ctx.fill();
      } else if (it.k === 'disc') {
        const u = norm(Math.abs(it.n[1]) < 0.9 ? cross(it.n, [0, 1, 0]) : cross(it.n, [1, 0, 0])), v = cross(it.n, u);
        const facing = Math.abs(dot(it.n, cam.f));
        ctx.fillStyle = shade(rgb, -0.15 + 0.3 * facing);
        ctx.beginPath();
        for (let i = 0; i <= 20; i++) { const a = i / 20 * Math.PI * 2, p = proj(cam, add(it.c, add(mul(u, Math.cos(a) * it.r), mul(v, Math.sin(a) * it.r)))); i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }
        ctx.fill(); ctx.strokeStyle = shade(rgb, 0.25); ctx.lineWidth = 0.8; ctx.stroke();
      } else if (it.k === 'cap') {
        const a = proj(cam, it.a), b = proj(cam, it.b), ra = Math.max(0.6, it.ra * cam.F / a[2]), rb = Math.max(0.6, it.rb * cam.F / b[2]);
        let d = [b[0] - a[0], b[1] - a[1]];
        if (Math.hypot(d[0], d[1]) < 0.5) d = [1, 0];
        d = norm2(d);
        const n = [-d[1], d[0]], ang = Math.atan2(n[1], n[0]), lit = n[0] * l2[0] + n[1] * l2[1] > 0 ? 1 : -1;
        const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], r = (ra + rb) / 2;
        const gr = ctx.createLinearGradient(m[0] + n[0] * r * lit, m[1] + n[1] * r * lit, m[0] - n[0] * r * lit, m[1] - n[1] * r * lit);
        gr.addColorStop(0, shade(rgb, 0.3)); gr.addColorStop(0.55, shade(rgb, 0)); gr.addColorStop(1, shade(rgb, -0.32));
        ctx.fillStyle = gr; ctx.beginPath();
        ctx.moveTo(a[0] + n[0] * ra, a[1] + n[1] * ra); ctx.lineTo(b[0] + n[0] * rb, b[1] + n[1] * rb);
        ctx.arc(b[0], b[1], rb, ang, ang + Math.PI, true); ctx.lineTo(a[0] - n[0] * ra, a[1] - n[1] * ra);
        ctx.arc(a[0], a[1], ra, ang + Math.PI, ang, true); ctx.closePath(); ctx.fill();
      }
    });
  }

  // ---------- cards in the page ----------
  const VIEWS = { '3d': d => (d.cam && d.cam.yaw != null ? d.cam.yaw : 0.7), front: d => (d.cam && d.cam.front != null ? d.cam.front : 0), side: d => (d.cam && d.cam.side != null ? d.cam.side : Math.PI / 2) };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  function create(opts) {
    opts = opts || {};
    const states = {}, cards = new Set();
    const reduce = () => { try { return root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
    const api = { info: opts.info || null };
    function state(id) {
      const d = DEFS[id];
      return states[id] || (states[id] = { t: 0, view: '3d', yaw: VIEWS['3d'](d), pitch: (d.cam && d.cam.pitch) || 0.15, playing: !reduce(), speed: 1 });
    }
    const has = id => !!DEFS[id];
    function cardHtml(id, cls) {
      if (!has(id)) return '';
      const st = state(id), d = DEFS[id];
      return '<div class="ea-card' + (cls ? ' ' + cls : '') + '" data-ea="' + esc(id) + '">' +
        '<canvas role="img" aria-label="Animated demo: ' + esc(d.name) + '"></canvas>' +
        '<span class="ea-tag">3D guide · drag to turn</span>' +
        '<div class="ea-ctl">' + ['3d', 'front', 'side'].map(v => '<button type="button" data-ea-view="' + v + '" aria-pressed="' + (st.view === v) + '">' + (v === '3d' ? '3D' : v[0].toUpperCase() + v.slice(1)) + '</button>').join('') +
        '<span class="ea-sp"></span><button type="button" data-ea-play aria-label="' + (st.playing ? 'Pause' : 'Play') + '">' + (st.playing ? '❚❚' : '▶') + '</button>' +
        '<button type="button" data-ea-speed aria-label="Speed">' + (st.speed === 1 ? '1×' : '½×') + '</button>' +
        (cls === 'ea-big' ? '' : '<button type="button" data-ea-full aria-label="Full screen">⤢</button>') + '</div></div>';
    }

    let raf = 0, last = 0;
    function colorsFor(el) {
      const cs = getComputedStyle(el), bg = hex(cs.getPropertyValue('--surface') || '#fff'), lum = (bg[0] * 0.3 + bg[1] * 0.59 + bg[2] * 0.11) / 255;
      const pal = PALETTE[lum < 0.45 ? 'dark' : 'light'], out = {};
      Object.keys(pal).forEach(k => { out[k] = hex(pal[k]); });
      out.hi = hex(cs.getPropertyValue('--accent') || '#e8672f');
      out.line = cs.getPropertyValue('--line').trim() || '#d0d4da';
      out.shadow = lum < 0.45 ? 'rgba(0,0,0,0.45)' : 'rgba(20,30,50,0.18)';
      return out;
    }
    function paint(el) {
      const cv = el.querySelector('canvas'); if (!cv) return;
      const dpr = Math.min(2, root.devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight;
      if (!w || !h) return;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(ctx, w, h, el.dataset.ea, state(el.dataset.ea), colorsFor(el));
    }
    function tick(now) {
      raf = 0;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0; last = now;
      const seen = new Set(); let moving = false;
      cards.forEach(el => {
        if (!el.isConnected) { cards.delete(el); return; }
        const id = el.dataset.ea, st = state(id);
        if (st.playing && !seen.has(id)) { st.t = (st.t + dt * st.speed / DEFS[id].dur) % 1; if (DEFS[id].still && st.view === '3d') st.yaw += dt * 0.35 * st.speed; seen.add(id); }
        if (el._eaVis !== false) paint(el);
        if (st.playing && el._eaVis !== false) moving = true;
      });
      if (moving) raf = root.requestAnimationFrame(tick); else last = 0;
    }
    const kick = () => { if (!raf && root.requestAnimationFrame) raf = root.requestAnimationFrame(tick); };
    let io = null;
    function mount(el) {
      if (el._eaBound || !has(el.dataset.ea)) return;
      el._eaBound = true; cards.add(el);
      if (root.IntersectionObserver) { io = io || new root.IntersectionObserver(es => { es.forEach(e => { e.target._eaVis = e.isIntersecting; }); kick(); }); io.observe(el); }
      kick();
    }
    function scan(node) { if (node && node.querySelectorAll) { if (node.matches && node.matches('.ea-card')) mount(node); node.querySelectorAll('.ea-card').forEach(mount); } }
    function rerenderControls(id) {
      document.querySelectorAll('.ea-card[data-ea="' + id + '"]').forEach(el => {
        const st = state(id);
        el.querySelectorAll('[data-ea-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.eaView === st.view)));
        const p = el.querySelector('[data-ea-play]'); if (p) { p.textContent = st.playing ? '❚❚' : '▶'; p.setAttribute('aria-label', st.playing ? 'Pause' : 'Play'); }
        const s = el.querySelector('[data-ea-speed]'); if (s) s.textContent = st.speed === 1 ? '1×' : '½×';
      });
    }
    let bound = false, drag = null;
    function attach(doc) {
      doc = doc || (typeof document !== 'undefined' ? document : null);
      if (!doc) return;
      scan(doc.body || doc);
      if (bound) return;
      bound = true;
      if (root.MutationObserver) new root.MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(scan))).observe(doc.body || doc, { childList: true, subtree: true });
      if (!doc.getElementById('ea-style')) { const s = doc.createElement('style'); s.id = 'ea-style'; s.textContent = css; doc.head.appendChild(s); }
      doc.addEventListener('click', ev => {
        const t = ev.target.closest && ev.target.closest('[data-ea-view],[data-ea-play],[data-ea-speed],[data-ea-full],[data-ea-open],[data-ea-close]');
        if (!t) return;
        if (t.hasAttribute('data-ea-open')) { ev.preventDefault(); open(t.getAttribute('data-ea-open')); return; }
        if (t.hasAttribute('data-ea-close')) { ev.preventDefault(); close(); return; }
        const card = t.closest('.ea-card'); if (!card) return;
        const id = card.dataset.ea, st = state(id), d = DEFS[id];
        ev.preventDefault(); ev.stopPropagation();
        if (t.hasAttribute('data-ea-view')) { st.view = t.dataset.eaView; st.yaw = VIEWS[st.view](d); st.pitch = st.view === '3d' ? ((d.cam && d.cam.pitch) || 0.15) : 0.08; }
        else if (t.hasAttribute('data-ea-play')) st.playing = !st.playing;
        else if (t.hasAttribute('data-ea-speed')) st.speed = st.speed === 1 ? 0.5 : 1;
        else if (t.hasAttribute('data-ea-full')) { open(id); return; }
        rerenderControls(id); kick();
      }, true);
      doc.addEventListener('pointerdown', ev => {
        const cv = ev.target.closest && ev.target.closest('.ea-card canvas'); if (!cv) return;
        const id = cv.parentNode.dataset.ea; drag = { id, x: ev.clientX, y: ev.clientY, pid: ev.pointerId };
        try { cv.setPointerCapture(ev.pointerId); } catch (e) { }
      });
      doc.addEventListener('pointermove', ev => {
        if (!drag || ev.pointerId !== drag.pid) return;
        const st = state(drag.id);
        st.yaw -= (ev.clientX - drag.x) * 0.012; st.pitch = Math.max(-0.1, Math.min(1.2, st.pitch + (ev.clientY - drag.y) * 0.008));
        drag.x = ev.clientX; drag.y = ev.clientY; st.view = 'free'; rerenderControls(drag.id); kick();
      });
      const end = () => { drag = null; };
      doc.addEventListener('pointerup', end); doc.addEventListener('pointercancel', end);
      doc.addEventListener('keydown', ev => { if (ev.key === 'Escape' && doc.querySelector('.ea-full')) close(); });
    }

    function open(id) {
      if (!has(id) || typeof document === 'undefined') return;
      close();
      const d = DEFS[id], info = (api.info && api.info(id)) || {};
      const steps = (info.steps || []).slice(0, 6), cues = (info.cues || []).slice(0, 4);
      const el = document.createElement('div');
      el.className = 'ea-full'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', d.name);
      el.innerHTML = '<div class="ea-full-head"><b>' + esc(info.title || d.name) + '</b><button type="button" class="ea-x" data-ea-close aria-label="Close">✕</button></div>' +
        cardHtml(id, 'ea-big') +
        '<div class="ea-full-body">' + (d.note ? '<p class="ea-note">' + esc(d.note) + '</p>' : '') +
        (cues.length ? '<p class="ea-lbl">Cues</p><ul>' + cues.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '') +
        (steps.length ? '<p class="ea-lbl">The rep</p><ol>' + steps.map(x => '<li>' + esc(x) + '</li>').join('') + '</ol>' : '') +
        (info.video ? '<a class="ea-link" href="' + esc(info.video.href) + '" target="_blank" rel="noopener noreferrer">' + esc(info.video.label || 'Watch a video ↗') + '</a>' : '') +
        '<p class="ea-muted">Animated guide drawn for this app. The highlighted area is the main muscle worked.</p></div>';
      document.body.appendChild(el);
      scan(el);
      const x = el.querySelector('.ea-x'); if (x) x.focus();
    }
    function close() { if (typeof document === 'undefined') return; document.querySelectorAll('.ea-full').forEach(n => n.remove()); }

    return Object.assign(api, { has, cardHtml, attach, open, close, ids: () => Object.keys(DEFS), css });
  }

  const css = [
    '.ea-card{position:relative;height:210px;border-radius:var(--r,12px);background:var(--sunk,#eef0f3);overflow:hidden;margin:.4rem 0 .6rem;border:1px solid var(--line,#dde1e6)}',
    '.ea-card canvas{display:block;width:100%;height:100%;touch-action:none;cursor:grab}',
    '.ea-tag{position:absolute;top:6px;left:8px;font-size:.68rem;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--muted,#6b7280);pointer-events:none}',
    '.ea-ctl{position:absolute;left:6px;right:6px;bottom:6px;display:flex;gap:4px;align-items:center}',
    '.ea-sp{flex:1}',
    '.ea-ctl button{font:inherit;font-size:.74rem;font-weight:600;min-width:34px;min-height:30px;padding:2px 8px;border-radius:999px;border:1px solid var(--line,#dde1e6);background:var(--surface,#fff);color:var(--ink,#111);cursor:pointer}',
    '.ea-ctl button[aria-pressed="true"]{background:var(--accent,#e8672f);border-color:var(--accent,#e8672f);color:var(--accent-ink,#fff)}',
    '.ea-ctl button:focus-visible{outline:2px solid var(--accent,#e8672f);outline-offset:1px}',
    '.ea-full{position:fixed;inset:0;z-index:2147483000;background:var(--bg,#f6f7f9);display:flex;flex-direction:column;padding:calc(env(safe-area-inset-top,0px) + 10px) max(14px,env(safe-area-inset-right,0px)) calc(env(safe-area-inset-bottom,0px) + 12px) max(14px,env(safe-area-inset-left,0px));overflow:auto}',
    '.ea-full-head{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:1.05rem}',
    '.ea-x{font:inherit;font-size:1rem;min-width:40px;min-height:40px;border-radius:999px;border:1px solid var(--line,#dde1e6);background:var(--surface,#fff);color:var(--ink,#111);cursor:pointer}',
    '.ea-card.ea-big{height:min(62vh,560px);flex:none}',
    '.ea-full-body{max-width:640px;font-size:.92rem;color:var(--ink,#111)}.ea-full-body ul,.ea-full-body ol{margin:.2rem 0 .6rem;padding-left:1.2rem}',
    '.ea-lbl{margin:.5rem 0 .1rem;font-size:.7rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--muted,#6b7280)}',
    '.ea-note{margin:.3rem 0;padding:.4rem .55rem;border-left:3px solid var(--warn,#b7791f);background:var(--surface,#fff);font-size:.85rem}',
    '.ea-link{display:inline-block;margin:.3rem 0;font-weight:600;color:var(--accent,#e8672f)}',
    '.ea-muted{color:var(--muted,#6b7280);font-size:.8rem}',
    '@media (prefers-reduced-motion: reduce){.ea-ctl button{transition:none}}'
  ].join('\n');

  const api = { create, has: id => !!DEFS[id], ids: () => Object.keys(DEFS), frame, sample, skeleton, ik, defs: DEFS, B, draw, css };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ExerciseAnim = api;
})(typeof window !== 'undefined' ? window : globalThis);
