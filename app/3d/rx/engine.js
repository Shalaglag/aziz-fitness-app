// Mizan recipe engine: poses the MakeHuman (CC0) rig from a JSON exercise recipe.
// World: metres, Y up. Standing character faces +Z, character's left is +X.
// A recipe = equipment + grips + named poses + tempo. Hands and feet are solved by
// 2-bone IK every frame; fingers are solved against the real handle (cylinder) or plane,
// so they wrap the bar instead of using a stiff preset.
import * as THREE from '../../vendor/three-r160/three.module.min.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const vec = a => Array.isArray(a) ? V3(a[0], a[1], a[2]) : a.clone();
const D2R = Math.PI / 180;
const tmpM = new THREE.Matrix4();
function frame(d, u) { const x = d.clone().normalize(); const z = u.clone().addScaledVector(x, -u.dot(x)).normalize(); const y = z.clone().cross(x); return new THREE.Quaternion().setFromRotationMatrix(tmpM.makeBasis(x, y, z)); }
const aim = (dRest, uRest, d, u) => frame(d, u).multiply(frame(dRest, uRest).invert());
const perp = (v, axis) => { const a = axis.clone().normalize(); return v.clone().addScaledVector(a, -v.dot(a)); };
const qAxis = (axis, ang) => new THREE.Quaternion().setFromAxisAngle(axis.clone().normalize(), ang);
const fromTo = (a, b) => new THREE.Quaternion().setFromUnitVectors(a.clone().normalize(), b.clone().normalize());
const X = V3(1, 0, 0), Y = V3(0, 1, 0), Z = V3(0, 0, 1);
function twistOf(q, axis) { const v = V3(q.x, q.y, q.z), p = axis.clone().multiplyScalar(v.dot(axis)); const t = new THREE.Quaternion(p.x, p.y, p.z, q.w); return t.lengthSq() < 1e-12 ? new THREE.Quaternion() : t.normalize(); }
export const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const sine = t => 0.5 - 0.5 * Math.cos(Math.PI * t);
function segLineDistFull(a, b, c, dir) { let best = 1e9; for (let i = 0; i <= 10; i++) { const p = a.clone().lerp(b, i / 10).sub(c); best = Math.min(best, perp(p, dir).length()); } return best; }
function segLineDist(a, b, c, dir) { // min distance between segment ab and infinite line (c, dir)
  let best = 1e9;
  for (let i = 3; i <= 10; i++) { const p = a.clone().lerp(b, i / 10); const r = p.sub(c); best = Math.min(best, perp(r, dir).length()); }
  return best;
}

// ---------------- rig ----------------
export class Rig {
  constructor(gltf, meta) {
    this.meta = meta; this.gltf = gltf;
    const SAN = n => n.replace(/[\[\]\.:\/]/g, '');
    this.parentOf = {}; meta.bones.forEach((b, i) => this.parentOf[b] = meta.parents[i]);
    gltf.scene.traverse(o => { if (o.isSkinnedMesh && (!this.mesh || o.geometry.attributes.position.count > this.mesh.geometry.attributes.position.count)) this.mesh = o; });   // the body, not the eyes
    this.bones = {}; for (const b of meta.bones) this.bones[b] = gltf.scene.getObjectByName(SAN(b));
    this.head = n => V3(...meta.heads[n]); this.tail = n => V3(...meta.tails[n]);
    const pos = this.mesh.geometry.attributes.position;
    let ySole = 1e9; for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getX(i)) > 0.05 && pos.getY(i) < this.head('foot.L').y) ySole = Math.min(ySole, pos.getY(i));
    this.ySole = ySole; this.ankleH = this.head('foot.L').y - ySole;
    this.standY = this.head('root').y - ySole;
    const h = this.head;
    this.L = { ua: h('lowerarm01.L').distanceTo(h('upperarm01.L')), fa: h('wrist.L').distanceTo(h('lowerarm01.L')),
      th: h('lowerleg01.L').distanceTo(h('upperleg01.L')), sh: h('foot.L').distanceTo(h('lowerleg01.L')) };
    this.hand = {};
    for (const s of ['L', 'R']) {
      const w = h(`wrist.${s}`), k2 = h(`finger2-1.${s}`), k3 = h(`finger3-1.${s}`), k5 = h(`finger5-1.${s}`);
      const kMid = k2.clone().add(k3).multiplyScalar(0.5);
      const dir = kMid.clone().sub(w).normalize();
      const across = (s === 'L' ? k2.clone().sub(k5) : k5.clone().sub(k2)).normalize();
      const pn = dir.clone().cross(across).normalize();
      if (pn.dot(V3(s === 'L' ? -1 : 1, 0, 0)) < 0) pn.negate();
      const curlAxis = dir.clone().cross(pn).normalize();
      // knuckle line in the palm plane: a handle lies along it (little-finger end sits nearer the wrist)
      const kn = k2.clone().sub(k5); kn.addScaledVector(pn, -kn.dot(pn)).normalize(); if (kn.dot(curlAxis) < 0) kn.negate();
      this.hand[s] = { dir, pn, curlAxis, knAxis: kn,
        grip: w.clone().lerp(kMid, 0.64).addScaledVector(pn, 0.034),      // centre of a handle held in the fist
        palm: w.clone().lerp(kMid, 0.55).addScaledVector(pn, 0.018) };    // palm surface (open hand)
    }
    this.Q = {}; this.P = {};
    this.mesh.frustumCulled = false;
    // rest vertices that move with each hand bone (dominant weight), used to keep the real skin out of the handle
    const SI = this.mesh.geometry.attributes.skinIndex, SW = this.mesh.geometry.attributes.skinWeight;
    const bi = {}; meta.bones.forEach((b, i) => bi[i] = b);
    const lists = {};
    for (let i = 0; i < pos.count; i++) {
      let bw = 0, bb = -1; for (let k = 0; k < 4; k++) { const w = SW.getComponent(i, k); if (w > bw) { bw = w; bb = SI.getComponent(i, k); } }
      const name = bi[bb]; if (!name || !(name.startsWith('finger') || name.startsWith('wrist'))) continue;
      // blended skin (weights renormalised over hand bones) for the grip solve
      const js = [], ws = []; let wt = 0; for (let k = 0; k < 4; k++) { const w = SW.getComponent(i, k), n = bi[SI.getComponent(i, k)]; if (w > 0.01 && n && /^(finger|wrist)/.test(n)) { js.push(n); ws.push(w); wt += w; } }
      const B = (this.blend = this.blend || {})[name] || (this.blend[name] = []); B.push({ v: [pos.getX(i), pos.getY(i), pos.getZ(i)], j: js, w: ws.map(w => w / wt) });
      if (bw < 0.45) continue;
      (lists[name] = lists[name] || []).push(pos.getX(i), pos.getY(i), pos.getZ(i));
    }
    this.verts = {};
    for (const n in lists) { const a = lists[n], step = /^(wrist|finger)/.test(n) ? 1 : Math.max(1, Math.floor(a.length / 3 / 450)); const o = []; for (let i = 0; i < a.length / 3; i += step) o.push(a[3 * i], a[3 * i + 1], a[3 * i + 2]); this.verts[n] = new Float32Array(o); }
    for (const s of ['L', 'R']) {
      const hd = this.hand[s], w = h(`wrist.${s}`), k2 = h(`finger2-1.${s}`), k3 = h(`finger3-1.${s}`);
      const kMid = k2.clone().add(k3).multiplyScalar(0.5);
      const surf = (t, q) => { const base = w.clone().lerp(kMid, t); const ds = []; const a = this.verts[`wrist.${s}`] || [];
        for (let i = 0; i < a.length; i += 3) { const d = V3(a[i], a[i + 1], a[i + 2]).sub(base); if (Math.abs(d.dot(hd.dir)) < 0.02 && Math.abs(d.dot(hd.curlAxis)) < 0.035) ds.push(d.dot(hd.pn)); }
        ds.sort((x, y) => x - y); const best = ds.length ? ds[Math.min(ds.length - 1, Math.floor(ds.length * q))] : 0.018;
        return base.addScaledVector(hd.pn, best); };
      hd.surfAt = surf; hd.palmSurf = surf(0.62, 0.6); hd.palm = surf(0.5, 0.95);
    }
  }
  gripAnchor(s, r) { const hd = this.hand[s]; if (window.__anchorT) hd.palmSurf = hd.surfAt(window.__anchorT, window.__anchorQ || 0.6); return hd.palmSurf.clone().addScaledVector(hd.pn, r + 0.0015); }
  // Canonical closed grip for hand s around a handle of radius r: the handle lies along the knuckle line, pressed
  // into the palm skin; each finger segment turns until its skin touches the handle; the thumb wraps the other way.
  // Solved in the rest frame, so the finger rotations (relative to their parents) hold for any arm pose.
  gripModel(s, r, thumb) {
    const key = `${s}|${r.toFixed(4)}|${thumb}`; this._gm = this._gm || {};
    if (this._gm[key]) return this._gm[key];
    const T0 = performance.now();
    const hd = this.hand[s], h = b => this.head(b), w = `wrist.${s}`, so = s === 'L' ? 1 : -1;
    const fb = []; for (let f = 1; f <= 5; f++) for (let j = 1; j <= 3; j++) fb.push(`finger${f}-${j}.${s}`);
    const keep = {}; for (const b of [w, ...fb]) keep[b] = [this.Q[b] && this.Q[b].clone(), this.P[b] && this.P[b].clone()];
    this.Q[w] = new THREE.Quaternion(); this.P[w] = h(w); for (const b of fb) this.local(b);
    const wr = h(w), kMid = h(`finger2-1.${s}`).add(h(`finger3-1.${s}`)).multiplyScalar(0.5);
    let A = hd.knAxis.clone();
    const loc = (b, q) => this.local(b, q);
    const gap = (b, C) => this.skinLineDistB(b, C, A) - r;
    const maxCurl = (tryA, lo, hi) => { const N = 30, st = (hi - lo) / N; let a = hi;
      while (a > lo && tryA(a) < 0) a -= st;
      if (a <= lo) { tryA(lo); return lo; }
      let ok = a, bad = Math.min(hi, a + st);
      if (bad > ok) for (let i = 0; i < 14; i++) { const m = (ok + bad) / 2; if (tryA(m) >= 0) ok = m; else bad = m; }
      tryA(ok); return ok; };
    const anchorAt = t => { const base = wr.clone().lerp(kMid, t); let lo = 0, hi = 0.07;   // palm skin just touching
      for (let i = 0; i < 22; i++) { const m = (lo + hi) / 2; if (gap(w, base.clone().addScaledVector(hd.pn, m)) < 0.0015) lo = m; else hi = m; }
      return base.addScaledVector(hd.pn, hi); };
    const ang = b => { const q = this.Q[this.parentOf[b]].clone().invert().multiply(this.Q[b]); return 2 * Math.acos(Math.min(1, Math.abs(q.w))); };
    const flexAx = b => { const dc = h(b).sub(this.head(b)); const t = this.tail(b).sub(this.head(b)).normalize(); const pnp = hd.pn.clone().addScaledVector(t, -hd.pn.dot(t)).normalize();
      const ax = t.clone().cross(pnp).normalize(); return ax.dot(A) < 0 ? ax.negate() : ax; };
    const wrapFingers = C => { let cost = 0;
      for (let f = 2; f <= 5; f++) {
        const spread = (f - 3.5) * 0.02, lim = [1.75, 1.95, 1.6];
        loc(`finger${f}-1.${s}`, qAxis(flexAx(`finger${f}-1.${s}`), 0.3 + spread)); loc(`finger${f}-2.${s}`, qAxis(flexAx(`finger${f}-2.${s}`), 0.9)); loc(`finger${f}-3.${s}`, qAxis(flexAx(`finger${f}-3.${s}`), 0.6));
        for (let j = 1; j <= 3; j++) { const b = `finger${f}-${j}.${s}`, ax = flexAx(b);
          maxCurl(a => { loc(b, qAxis(ax, a)); return gap(b, C) - 0.0015; }, j === 2 ? 0.1 : 0.05, lim[j - 1]); }
        // blended skin: if any segment is still inside the handle, open the knuckle a little and re-close the rest
        { const bs = [1, 2, 3].map(j => `finger${f}-${j}.${s}`), ax = bs.map(flexAx);
          const angOf = b => 2 * Math.acos(Math.min(1, Math.abs(this.Q[this.parentOf[b]].clone().invert().multiply(this.Q[b]).w)));
          let a1 = angOf(bs[0]);
          for (let it = 0; it < 30 && Math.min(gap(bs[0], C), gap(bs[1], C), gap(bs[2], C)) < 0.0003 && a1 > 0.1; it++) {
            a1 -= 0.04; loc(bs[0], qAxis(ax[0], a1)); loc(bs[1], qAxis(ax[1], 0.9)); loc(bs[2], qAxis(ax[2], 0.6));
            for (const j of [1, 2]) maxCurl(a => { loc(bs[j], qAxis(ax[j], a)); return gap(bs[j], C) - 0.0015; }, j === 1 ? 0.1 : 0.05, lim[j]); } }
        const tg = gap(`finger${f}-3.${s}`, C), curl = ang(`finger${f}-1.${s}`) + ang(`finger${f}-2.${s}`) + ang(`finger${f}-3.${s}`);
        cost += Math.max(0, tg - 0.002) + Math.max(0, -tg - 0.0008) * 30 + Math.max(0, 1.45 - curl) * 0.03;   // tip on the handle, curl >= ~83 deg
      }
      return cost; };
    // where the automatic checker expects the handle: palm skin a little past mid-palm
    const gp = (() => { const base = wr.clone().lerp(kMid, 0.62), offs = [];
      for (const b in this.verts) { if (!/^(wrist|finger)/.test(b) || !b.endsWith(s)) continue; const a = this.verts[b];
        for (let i = 0; i < a.length; i += 3) { const v = V3(a[i], a[i + 1], a[i + 2]).sub(base), al = v.dot(hd.pn); if (al <= 0 || al > 0.06) continue; if (v.addScaledVector(hd.pn, -al).length() < 0.012) offs.push(al); } }
      offs.sort((x, y) => x - y); return base.addScaledVector(hd.pn, offs.length ? offs[offs.length >> 1] : 0.028); })();
    let best = null;
    for (const bl of [0, 0.35, 0.65, 1]) {
      A = hd.curlAxis.clone().multiplyScalar(1 - bl).addScaledVector(hd.knAxis, bl).normalize();
      for (let t = 0.6; t <= 0.9001; t += 0.015) { const C = anchorAt(t);
        const ge = Math.abs(perp(gp.clone().sub(C), A).length() - r);
        const c = wrapFingers(C) + Math.max(0, ge - 0.006) * 2.5 + bl * 0.0015;
        if (!best || c < best.c - 1e-6) best = { t, bl, C, A: A.clone(), c, ge }; }
    }
    A = best.A; const C = best.C; wrapFingers(C);
    // thumb: opposed and wrapped round the far side of the handle, beside (not through) the index finger
    const t1 = `finger1-1.${s}`, t2 = `finger1-2.${s}`, t3 = `finger1-3.${s}`;
    const closeTo = b => { // bend b toward the handle until its skin touches
      const d = this.tailW(b).sub(this.P[b]).normalize(), to = perp(C.clone().sub(this.P[b]), A); let ax = d.clone().cross(to);
      if (ax.lengthSq() < 1e-10) return; ax.normalize(); const q0 = this.Q[this.parentOf[b]].clone().invert().multiply(this.Q[b]);
      maxCurl(a => { this.local(b, qAxis(ax.clone().applyQuaternion(this.Q[this.parentOf[b]].clone().invert()), a).multiply(q0)); return gap(b, C) - 0.0015; }, 0, 1.4); };
    const segD = (a0, a1, b0, b1) => { let m = 1e9; for (let i = 0; i <= 6; i++) { const p = a0.clone().lerp(a1, i / 6); for (let j = 0; j <= 6; j++) m = Math.min(m, p.distanceTo(b0.clone().lerp(b1, j / 6))); } return m; };
    if (thumb === 'thumbless') {
      loc(t1, qAxis(hd.dir, so * 0.3).multiply(qAxis(hd.curlAxis, 0.1))); loc(t2, qAxis(hd.curlAxis, 0.1)); loc(t3, qAxis(hd.curlAxis, 0.1));
    } else {
      const ix = [`finger2-1.${s}`, `finger2-2.${s}`, `finger2-3.${s}`].map(b => [this.P[b].clone(), this.tailW(b)]);
      let tb = null;
      const tryT = (o, f, p) => { loc(t1, qAxis(hd.dir, so * o).multiply(qAxis(hd.curlAxis, f)).multiply(qAxis(hd.pn, so * p))); loc(t2); loc(t3);
        const c1 = gap(t1, C); closeTo(t2); closeTo(t3);
        const tg = gap(t3, C), g2 = gap(t2, C), c = Math.min(c1, g2);
        const tip = this.tailW(t3), u = perp(tip.clone().sub(C), A).normalize();
        let dIx = 1e9; for (const b of [t2, t3]) { const a0 = this.P[b], a1 = this.tailW(b); for (const [b0, b1] of ix) dIx = Math.min(dIx, segD(a0, a1, b0, b1)); }
        const lim = Math.max(0, ang(t1) - 1.8) + Math.max(0, ang(t2) - 1.8) + Math.max(0, ang(t3) - 1.8);
        return Math.abs(tg - 0.0015) + 6 * Math.max(0, -0.0008 - c) + lim + Math.max(0, g2 - 0.004) * 0.5
          + Math.max(0, 0.25 - u.dot(hd.pn)) * 0.01 + Math.max(0, 0.016 - dIx) * 2; };
      for (let o = 0; o <= 1.6001; o += 0.2) for (let f = -0.6; f <= 1.4001; f += 0.2) for (let p = -0.6; p <= 0.6001; p += 0.2) { const sc = tryT(o, f, p); if (!tb || sc < tb[3]) tb = [o, f, p, sc]; }
      for (const st of [0.08, 0.03]) { const [o0, f0, p0] = tb;
        for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) for (let k = -2; k <= 2; k++) { const sc = tryT(o0 + i * st, f0 + j * st, p0 + k * st); if (sc < tb[3]) tb = [o0 + i * st, f0 + j * st, p0 + k * st, sc]; } }
      tryT(tb[0], tb[1], tb[2]); this._thumbScore = tb[3];
    }
    const locals = {}; for (const b of fb) locals[b] = this.Q[this.parentOf[b]].clone().invert().multiply(this.Q[b]);
    let amin = 1e9, amax = -1e9; for (const b of [w, ...fb]) { const a = this.verts[b]; if (!a) continue; const q = this.Q[b], p = this.P[b], hb = this.head(b);
      for (let i = 0; i < a.length; i += 3) { const v = V3(a[i], a[i + 1], a[i + 2]).sub(hb).applyQuaternion(q).add(p).sub(C); const al = v.dot(A); if (perp(v, A).length() < r + 0.03) { amin = Math.min(amin, al); amax = Math.max(amax, al); } } }
    const tips = {}; for (let f = 1; f <= 5; f++) tips[f] = +(gap(`finger${f}-3.${s}`, C) * 1000).toFixed(1);
    for (const b in keep) { if (keep[b][0]) this.Q[b] = keep[b][0]; if (keep[b][1]) this.P[b] = keep[b][1]; }
    return (this._gm[key] = { anchor: C, axis: A, centre: (amin + amax) / 2, width: amax - amin, t: best.t, blend: best.bl, gripErr: best.ge, locals, order: fb, tips, ms: performance.now() - T0 });
  }
  // smallest distance from bone b's skin to the line (C, A), in metres
  // grip models to/from JSON (see gripcache.json)
  saveGripCache() { const o = {}; for (const [k, m] of Object.entries(this._gm || {})) o[k] = { ...m, anchor: m.anchor.toArray(), axis: m.axis.toArray(),
    locals: Object.fromEntries(Object.entries(m.locals).map(([b, q]) => [b, q.toArray().map(x => +x.toFixed(6))])) }; return o; }
  loadGripCache(models) { this._gm = this._gm || {}; for (const [k, m] of Object.entries(models)) this._gm[k] = { ...m, anchor: V3(...m.anchor), axis: V3(...m.axis),
    locals: Object.fromEntries(Object.entries(m.locals).map(([b, q]) => [b, new THREE.Quaternion(...q)])) }; }
  // same with the blended (linear-blend-skinned) positions: what the renderer actually draws
  skinLineDistB(b, C, A) {
    const L = this.blend && this.blend[b]; if (!L) return this.skinLineDist(b, C, A); let best = 1e9; const v = V3(), p = V3(), t = V3();
    for (const e of L) { p.set(0, 0, 0);
      for (let k = 0; k < e.j.length; k++) { const n = e.j[k], hd = this.meta.heads[n]; t.set(e.v[0] - hd[0], e.v[1] - hd[1], e.v[2] - hd[2]).applyQuaternion(this.Q[n]).add(this.P[n]); p.addScaledVector(t, e.w[k]); }
      v.copy(p).sub(C); const al = v.dot(A); v.addScaledVector(A, -al); const d = v.lengthSq(); if (d < best) best = d; }
    return Math.sqrt(best);
  }
  skinLineDist(b, C, A) {
    const a = this.verts[b]; if (!a) return 1e9;
    const q = this.Q[b], p = this.P[b], hd = this.meta.heads[b];
    const qx = q.x, qy = q.y, qz = q.z, qw = q.w; let best = 1e9;
    for (let i = 0; i < a.length; i += 3) {
      const vx = a[i] - hd[0], vy = a[i + 1] - hd[1], vz = a[i + 2] - hd[2];
      const ix = qw * vx + qy * vz - qz * vy, iy = qw * vy + qz * vx - qx * vz, iz = qw * vz + qx * vy - qy * vx, iw = -qx * vx - qy * vy - qz * vz;
      const x = ix * qw + iw * -qx + iy * -qz - iz * -qy + p.x - C.x, y = iy * qw + iw * -qy + iz * -qx - ix * -qz + p.y - C.y, z = iz * qw + iw * -qz + ix * -qy - iy * -qx + p.z - C.z;
      const t = x * A.x + y * A.y + z * A.z, dx = x - t * A.x, dy = y - t * A.y, dz = z - t * A.z;
      const d = dx * dx + dy * dy + dz * dz; if (d < best) best = d;
    }
    return Math.sqrt(best);
  }
  skinMinYB(b) { // lowest blended-skin point of the vertices dominated by bone b (matches the real skinned mesh)
    const L = this.blend && this.blend[b]; if (!L || L.some(e => e.j.some(n => !this.Q[n]))) return this.skinMinY(b); let best = 1e9; const t = V3();
    for (let i = 0; i < L.length; i += 3) { const e = L[i]; let y = 0;
      for (let k = 0; k < e.j.length; k++) { const n = e.j[k], hd = this.meta.heads[n]; t.set(e.v[0] - hd[0], e.v[1] - hd[1], e.v[2] - hd[2]).applyQuaternion(this.Q[n]); y += (t.y + this.P[n].y) * e.w[k]; }
      if (y < best) best = y; }
    return best;
  }
  skinMinY(b, step = 1) {
    const a = this.verts[b]; if (!a) return 1e9; const q = this.Q[b], p = this.P[b], hd = this.meta.heads[b]; let best = 1e9; const v = V3();
    for (let i = 0; i < a.length; i += 3 * step) { v.set(a[i] - hd[0], a[i + 1] - hd[1], a[i + 2] - hd[2]).applyQuaternion(q); best = Math.min(best, v.y + p.y); }
    return best;
  }
  place(b, q) { const p = this.parentOf[b]; this.Q[b] = q; this.P[b] = p ? this.P[p].clone().add(this.head(b).sub(this.head(p)).applyQuaternion(this.Q[p])) : this.P[b]; }
  jp(b) { const p = this.parentOf[b]; return this.P[p].clone().add(this.head(b).sub(this.head(p)).applyQuaternion(this.Q[p])); }
  local(b, ql) { this.place(b, this.Q[this.parentOf[b]].clone().multiply(ql || new THREE.Quaternion())); }
  tailW(b) { return this.P[b].clone().add(this.tail(b).sub(this.head(b)).applyQuaternion(this.Q[b])); }
  pointW(b, restPoint) { return this.P[b].clone().add(vec(restPoint).sub(this.head(b)).applyQuaternion(this.Q[b])); }
  apply() {
    for (const b of this.meta.bones) {
      const p = this.parentOf[b], bone = this.bones[b];
      if (!bone) continue;
      if (/^(toe|eye)/.test(b) || !this.Q[b]) this.local(b, (this.extraLocal || {})[b]);   // bones the solver does not drive
      if (!p) { bone.position.copy(this.P[b]); bone.quaternion.copy(this.Q[b]); }
      else bone.quaternion.copy(this.Q[p].clone().invert().multiply(this.Q[b]));
    }
    this.gltf.scene.updateMatrixWorld(true);
  }
}

function ik2(a, target, l1, l2, pole) {
  const d = target.clone().sub(a); let dist = d.length();
  const err = Math.max(0, dist - (l1 + l2) * 0.999);
  dist = Math.min(dist, (l1 + l2) * 0.999); d.normalize();
  const x = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist), h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const pp = perp(pole, d).normalize();
  return { mid: a.clone().addScaledVector(d, x).addScaledVector(pp, h), end: a.clone().addScaledVector(d, dist), err, pp };
}

// ---------------- pose maths ----------------
const MIRROR = { arms: ['armL', 'armR'], hands: ['handL', 'handR'], legs: ['legL', 'legR'], feet: ['footL', 'footR'] };
const mirrorVal = (v, key) => {
  if (Array.isArray(v) && v.length === 3 && typeof v[0] === 'number') return [-v[0], v[1], v[2]];
  if (key === 'w' && typeof v === 'number') return -v;
  if (v && typeof v === 'object' && !Array.isArray(v)) { const o = {}; for (const k in v) o[k] = mirrorVal(v[k], k); return o; }
  return v;
};
function deepMerge(a, b) {
  if (b === undefined) return structuredClone(a);
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const o = structuredClone(a); for (const k in b) o[k] = deepMerge(a[k], b[k]); return o;
  }
  return structuredClone(b);
}
export function expandPose(p) {
  const o = structuredClone(p);
  for (const k in MIRROR) if (o[k]) { const [l, r] = MIRROR[k]; o[l] = deepMerge(o[k], o[l]); o[r] = deepMerge(mirrorVal(o[k]), o[r]); delete o[k]; }
  return o;
}
function lerpDeep(a, b, t) {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * t;
  if (Array.isArray(a) && Array.isArray(b)) return a.map((v, i) => lerpDeep(v, b[i], t));
  if (a && b && typeof a === 'object' && typeof b === 'object') { const o = {}; for (const k in a) o[k] = k in b ? lerpDeep(a[k], b[k], t) : a[k]; for (const k in b) if (!(k in a)) o[k] = b[k]; return o; }
  return t < 0.5 ? a : b;
}

// ---------------- the poser ----------------
export class Poser {
  constructor(rig, recipe) {
    this.rig = rig; this.r = recipe;
    this.poses = {};
    // defaults so every channel exists in every pose (a channel missing in one pose would snap, not blend)
    const DEF = { spine: [0, 0, 0], neck: [0, 0, 0], clav: [0, 0], toesL: [0], toesR: [0] };
    const all = Object.values(recipe.poses).map(v => expandPose(deepMerge(deepMerge(DEF, recipe.base || {}), v)));
    const union = {}; for (const p of all) for (const k in p) if (!(k in union)) union[k] = p[k];
    for (const [k, v] of Object.entries(recipe.poses)) {
      let p = expandPose(deepMerge(deepMerge(DEF, recipe.base || {}), v));
      for (const key in union) if (!(key in p)) p[key] = key.startsWith('clav') ? (p.clav || [0, 0]) : structuredClone(union[key]);
      // a foot 'up' given in one pose but not another would hold then snap: fill the engine default instead
      for (const f of ['footL', 'footR']) if (p[f] && !p[f].up && all.some(q => q[f] && q[f].up)) p[f].up = [0, 1, 0];
      this.poses[k] = p;
    }
    let t = 0; this.segs = [];
    let prev = recipe.tempo[recipe.tempo.length - 1][2];
    for (const [kind, dur, to, via] of recipe.tempo) { this.segs.push({ kind, t0: t, t1: t + dur, from: prev, to, via }); t += dur; prev = to; }
    this.period = t;
    this.grips = recipe.grips || {};
    this.out = {}; // last solve: grip points, contacts, errors
  }
  poseAt(time) {
    const tt = ((time % this.period) + this.period) % this.period;
    const s = this.segs.find(s => tt >= s.t0 && tt < s.t1) || this.segs[this.segs.length - 1];
    if (s.kind === 'hold') { this._seg = { from: s.to, to: s.to, via: null, k: 1 }; return { pose: this.poses[s.to], phase: s, k: 1 }; }
    const u = (tt - s.t0) / (s.t1 - s.t0), e = s.kind === 'lin' ? u : s.kind === 'swing' ? sine(u) : ease(u); // lin: constant speed (belts, pedals)
    const A = this.poses[s.from], B = this.poses[s.to]; this._seg = { from: s.from, to: s.to, via: s.via || null, k: e };
    if (!s.via) return { pose: lerpDeep(A, B, e), phase: s, k: e };
    const M = this.poses[s.via];
    return { pose: lerpDeep(lerpDeep(A, M, e), lerpDeep(M, B, e), e), phase: s, k: e };
  }
  solve(time) {
    const { pose } = this.poseAt(time);
    const R = this.rig, out = { grips: {}, soles: {}, err: {}, t: time, period: this.period, P: R.P, seg: this._seg }; // t, period: time-driven gear (treadmill belt)
    // --- trunk
    const rr = (pose.root && pose.root.r) || [0, 0, 0];
    const qRoot = qAxis(Y, rr[1] * D2R).multiply(qAxis(X, rr[0] * D2R)).multiply(qAxis(Z, rr[2] * D2R));
    R.P.root = vec(pose.root.p); R.place('root', qRoot);
    const sp = pose.spine || [0, 0, 0], nk = pose.neck || [0, 0, 0];
    const W = { spine05: .12, spine04: .2, spine03: .23, spine02: .23, spine01: .22 };
    for (const b in W) R.local(b, qAxis(X, sp[0] * W[b] * D2R).multiply(qAxis(Z, sp[1] * W[b] * D2R)).multiply(qAxis(Y, sp[2] * W[b] * D2R)));
    const NW = { neck01: .35, neck02: .2, neck03: .2, head: .25 };
    for (const b in NW) R.local(b, qAxis(X, nk[0] * NW[b] * D2R).multiply(qAxis(Z, nk[1] * NW[b] * D2R)).multiply(qAxis(Y, nk[2] * NW[b] * D2R)));
    for (const s of ['L', 'R']) {
      const sg = s === 'L' ? 1 : -1;
      const c = pose['clav' + s] || pose.clav || [0, 0];
      R.local(`clavicle.${s}`, qAxis(Z, sg * c[0] * D2R).multiply(qAxis(Y, -sg * c[1] * D2R)));
      R.local(`shoulder01.${s}`); R.local(`pelvis.${s}`);
    }
    // --- implement centre (bar) before arms, since grips may target it
    let bar = null;
    if (pose.bar && pose.bar !== 'hands') bar = Array.isArray(pose.bar) ? vec(pose.bar) : R.pointW(pose.bar.bone, R.head(pose.bar.bone).add(vec(pose.bar.off)));
    out.bar = bar;
    // --- legs
    for (const s of ['L', 'R']) this.leg(s, pose['leg' + s], pose['foot' + s], out);
    // --- arms + hands
    for (const s of ['L', 'R']) this.arm(s, pose['arm' + s], pose['hand' + s], bar, out);
    if (pose.bar === 'hands') out.bar = out.grips.L.p.clone().add(out.grips.R.p).multiplyScalar(0.5);
    // toes: toesL / toesR = [extension deg] (toes bent up toward the instep, e.g. push-up, lunge back foot)
    R.extraLocal = R.extraLocal || {};
    for (const s of ['L', 'R']) { const t = pose['toes' + s] || [0]; R.extraLocal[`toe1-1.${s}`] = qAxis(X, -t[0] * D2R); }
    R.apply();
    this.out = out;
    return out;
  }
  leg(s, L, F, out) {
    const R = this.rig, H = R.jp(`upperleg01.${s}`);
    const pole = vec(L.pole || [0, 0, 1]);
    let target;
    if (L.to) target = vec(L.to);
    else target = H.clone().addScaledVector(vec(L.th).normalize(), R.L.th).addScaledVector(vec(L.sh).normalize(), R.L.sh);
    const sol = ik2(H, target, R.L.th, R.L.sh, pole);
    out.err['ankle.' + s] = sol.err;
    const h = R.head;
    const thR = h(`lowerleg01.${s}`).sub(h(`upperleg01.${s}`)).normalize(), shR = h(`foot.${s}`).sub(h(`lowerleg01.${s}`)).normalize();
    const thW = sol.mid.clone().sub(H).normalize(), shW = sol.end.clone().sub(sol.mid).normalize();
    const Qth = aim(thR, Z, thW, perp(sol.pp, thW));
    R.place(`upperleg01.${s}`, Qth); R.local(`upperleg02.${s}`);
    const Qsh = fromTo(shR.clone().applyQuaternion(Qth), shW).multiply(Qth);
    R.place(`lowerleg01.${s}`, Qsh); R.local(`lowerleg02.${s}`);
    const fwd = vec((F && F.fwd) || [0, 0, 1]), up = vec((F && F.up) || [0, 1, 0]);
    // rest foot: forward +Z, sole normal +Y; keep pitch from the recipe (toes/heels raise)
    R.place(`foot.${s}`, aim(Z, Y, fwd, up));
    out.soles[s] = R.P[`foot.${s}`].clone();
  }
  arm(s, A, Hd, bar, out) {
    const R = this.rig, h = R.hand[s], S = R.jp(`upperarm01.${s}`);
    const grip = this.grips[s] || { type: 'none' };
    // hand orientation (world): fingers = wrist->knuckles, palm = direction the palm faces
    let dirW = vec((Hd && Hd.fingers) || (A && A.fa && !A.to ? A.fa : [0, -1, 0])), pnW = vec((Hd && Hd.palm) || [s === 'L' ? -1 : 1, 0, 0]);
    let Qh = aim(h.dir, h.pn, dirW, perp(pnW, dirW));
    // a two-handed bar: snap the hand's curl axis onto the bar axis so the fingers wrap it
    if ((A.to === 'bar' || grip.axis) && grip.type !== 'open') {
      const c = R.gripModel(s, grip.radius || 0.0145, grip.thumb || 'wrapped').axis.clone().applyQuaternion(Qh), axis = vec(grip.axis || [1, 0, 0]);
      Qh = fromTo(c, axis.multiplyScalar(Math.sign(c.dot(axis)) || 1)).multiply(Qh);
    }
    const anchorRest = grip.type === 'open' ? h.palm : R.gripModel(s, grip.radius || 0.0145, grip.thumb || 'wrapped').anchor;
    let target;
    if (A.to === 'bar') target = bar.clone().add(V3(A.w, A.dy || 0, A.dz || 0));
    else if (A.to) target = vec(A.to);
    else target = null;
    let Wp, E, err = 0, pp;
    const pole = vec(A.pole || [0, -1, -1]);
    const barAxis = (A.to === 'bar' || grip.axis) && grip.type !== 'open' ? vec(grip.axis || [1, 0, 0]).normalize() : null;
    const solveTo = () => {
      Wp = target.clone().sub(anchorRest.clone().sub(R.head(`wrist.${s}`)).applyQuaternion(Qh));
      const sol = ik2(S, Wp, R.L.ua, R.L.fa, pole); E = sol.mid; Wp = sol.end; err = sol.err; pp = sol.pp;
    };
    if (target) {
      solveTo();
      if (barAxis && grip.diagonal === true) {
        const fa = Wp.clone().sub(E).normalize(), pn = h.pn.clone().applyQuaternion(Qh).normalize(), d = h.dir.clone().applyQuaternion(Qh).normalize();
        const f = perp(fa, pn); if (f.lengthSq() > 1e-6) { f.normalize();
          const ang = Math.atan2(d.clone().cross(f).dot(pn), d.dot(f)), lim = 0.44, a = Math.max(-lim, Math.min(lim, ang)) * 0.85;
          Qh = qAxis(pn, a).multiply(Qh); solveTo(); }
      }
    } else {
      E = S.clone().addScaledVector(vec(A.ua).normalize(), R.L.ua);
      Wp = E.clone().addScaledVector(vec(A.fa).normalize(), R.L.fa);
      // hinge plane from the real forearm direction (falls back to the pole when the arm is straight)
      const faD = Wp.clone().sub(E).normalize(), uaD = E.clone().sub(S).normalize();
      const bend = perp(faD, uaD).negate().add(perp(pole, uaD).normalize().multiplyScalar(0.15));
      pp = bend.lengthSq() > 1e-8 ? bend.normalize() : perp(pole, Wp.clone().sub(S)).normalize();
    }
    out.err['grip.' + s] = err;
    const hd = R.head;
    const restS = hd(`upperarm01.${s}`), restE = hd(`lowerarm01.${s}`), restW = hd(`wrist.${s}`);
    const uaRest = restE.clone().sub(restS).normalize(), faRest = restW.clone().sub(restE).normalize();
    const uaW = E.clone().sub(S).normalize(), faW = Wp.clone().sub(E).normalize();
    const flexW = perp(pp.clone().negate(), uaW);
    const Qua = aim(uaRest, perp(faRest, uaRest), uaW, flexW.lengthSq() > 1e-8 ? flexW : perp(faW, uaW));
    R.place(`upperarm01.${s}`, Qua); R.local(`upperarm02.${s}`);
    const Qfa = fromTo(faRest.clone().applyQuaternion(Qua), faW).multiply(Qua);
    R.place(`lowerarm01.${s}`, Qfa);
    const tw = twistOf(Qfa.clone().invert().multiply(Qh), faRest);
    R.place(`lowerarm02.${s}`, Qfa.clone().multiply(new THREE.Quaternion().slerp(tw, 0.5)));
    // wrist sits at the IK end; orientation Qh
    R.place(`wrist.${s}`, Qh);
    const g = R.pointW(`wrist.${s}`, anchorRest);
    const ca = (grip.type === 'open' || grip.type === 'none' ? h.curlAxis : R.gripModel(s, grip.radius || 0.0145, grip.thumb || 'wrapped').axis).clone().applyQuaternion(Qh);
    const ax = barAxis ? barAxis.clone().multiplyScalar(Math.sign(barAxis.dot(ca)) || 1) : ca;
    out.grips[s] = { p: g, axis: ax, palm: h.pn.clone().applyQuaternion(Qh), fingers: h.dir.clone().applyQuaternion(Qh), target };
    this.fingers(s, grip, out.grips[s]);
    const G = out.grips[s], k2 = R.P[`finger2-1.${s}`], k5 = R.P[`finger5-1.${s}`], m = k2.clone().add(k5).multiplyScalar(0.5);
    G.center = G.p.clone().addScaledVector(G.axis, m.clone().sub(G.p).dot(G.axis));
    if (grip.type !== 'open' && grip.type !== 'none') { const M = R.gripModel(s, grip.radius || 0.0145, grip.thumb || 'wrapped');
      const aw = M.axis.clone().applyQuaternion(Qh); G.center = G.p.clone().addScaledVector(aw, M.centre); G.width = M.width; }
  }
  // Fingers: each phalanx turns until it touches the handle (cylinder of radius r around the grip axis)
  // or the support plane (open hand). No fixed preset, so the fist closes to the real handle size.
  fingers(s, grip, G) {
    const R = this.rig, h = R.hand[s];
    const type = grip.type || 'none';
    const so = s === 'L' ? 1 : -1;
    const qa = (ax, a) => qAxis(ax, a);
    if (type === 'open' || type === 'none') {
      const planeY = type === 'open' ? (grip.planeY ?? G.p.y - 0.018) : null;
      for (let f = 2; f <= 5; f++) {
        const spread = (f - 3.5) * (type === 'open' ? 0.09 : 0.05);
        // blended-skin correction per segment (creases sag below the rigid bone verts), measured once with the finger straight
        const bias = [0, 0, 0, 0];
        if (planeY !== null) { for (let j = 1; j <= 3; j++) R.local(`finger${f}-${j}.${s}`); for (let j = 1; j <= 3; j++) { const c = `finger${f}-${j}.${s}`; bias[j] = Math.min(0, R.skinMinYB(c) - R.skinMinY(c, 3)) - 0.0005; } }
        for (let j = 1; j <= 3; j++) {
          const b = `finger${f}-${j}.${s}`;
          if (planeY === null) { R.local(b, qa(h.curlAxis, [0.18, 0.28, 0.18][j - 1] * (grip.curl || 1) + (j === 1 ? spread * 0 : 0)).multiply(qa(h.pn, j === 1 ? so * spread : 0))); continue; }
          // bend so the tip lies on the plane (allows slight hyper-extension, as a hand pressed flat does)
          const tryA = a => { R.local(b, qa(h.curlAxis, a).multiply(qa(h.pn, j === 1 ? so * spread : 0))); let m = R.skinMinY(b, 3) + bias[j]; for (let jj = j + 1; jj <= 3; jj++) { const c = `finger${f}-${jj}.${s}`; R.local(c); m = Math.min(m, R.skinMinY(c, 3) + bias[jj]); } return m - (planeY + 0.0005); };
          // flat hand: keep the segment straight unless its skin would go through the plane; then the smallest bend that clears it
          if (tryA(0) >= 0) continue;
          let best = null, most = [0, tryA(0)];
          for (let k = 1; k <= 20 && best === null; k++) for (const a of [0.05 * k, -0.025 * k]) { if (a < -0.5) continue; const d = tryA(a); if (d >= 0) { best = a; break; } if (d > most[1]) most = [a, d]; }
          tryA(best ?? most[0]);
        }
      }
      // thumb: relaxed, abducted on the surface
      const th = o => { R.local(`finger1-1.${s}`, qa(h.dir, so * o[0]).multiply(qa(h.curlAxis, o[1])));
        R.local(`finger1-2.${s}`, qa(h.curlAxis, 0.1)); R.local(`finger1-3.${s}`, qa(h.curlAxis, 0.08)); };
      th([0.35, 0.15]);
      if (planeY !== null) { // keep the thumb on, not through, the surface: closest relaxed pose with its skin above the plane
        const lowest = () => Math.min(R.skinMinY(`finger1-1.${s}`, 2), R.skinMinY(`finger1-2.${s}`, 2), R.skinMinY(`finger1-3.${s}`, 2)) - planeY - 0.002;
        if (lowest() < 0) { let best = null;
          for (let a = -0.6; a <= 0.81; a += 0.1) for (let f = -0.6; f <= 0.61; f += 0.1) { th([a, f]); const d = lowest(); if (d >= 0) { const c = Math.abs(a - 0.35) + Math.abs(f - 0.15) + d * 20; if (!best || c < best[2]) best = [a, f, c]; } }
          th(best ? [best[0], best[1]] : [0.35, 0.15]); }
      }
      return;
    }
    // closed grip: the finger pose is solved once per hand + handle size (in the hand's own frame) and reused
    const M = R.gripModel(s, grip.radius || 0.0145, grip.thumb || 'wrapped');
    for (const b of M.order) R.local(b, M.locals[b]);
  }
  // world positions of named body points vs their equipment targets (for the automatic checker)
  contacts() {
    const o = this.out, R = this.rig, res = {};
    for (const s of ['L', 'R']) {
      const g = o.grips[s];
      if (g && g.target) res['grip.' + s] = { body: g.p.toArray(), target: g.target.toArray(), errMm: g.p.distanceTo(g.target) * 1000 };
      res['sole.' + s] = { body: R.pointW(`foot.${s}`, R.head(`foot.${s}`).add(V3(0, -R.ankleH, 0.03))).toArray() };
    }
    return res;
  }
}

// ---------------- muscle masks (rest pose, from mesh position, normal and skin weights) ----------------
export function muscleMasks(rig) {
  const g = rig.mesh.geometry, P = g.attributes.position, N = g.attributes.normal, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
  const n = P.count, bones = rig.meta.bones, bi = {}; bones.forEach((b, i) => bi[b] = i);
  const H = b => rig.head(b);
  const ss = (e0, e1, v) => { const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  const sh = H('upperarm01.L'), clav = H('clavicle.L'), elbow = H('lowerarm01.L'), wrist = H('wrist.L'), chest = H('spine01');
  const hip = H('upperleg01.L'), knee = H('lowerleg01.L'), ankle = H('foot.L'), root = H('root'), sp3 = H('spine03'), sp2 = H('spine02');
  const names = ['chest', 'front_delt', 'side_delt', 'rear_delt', 'biceps', 'triceps', 'forearms', 'upper_traps', 'mid_back', 'lats', 'lower_back', 'abs', 'obliques', 'glutes', 'glute_med', 'quads', 'hamstrings', 'adductors', 'calves', 'tibialis', 'hip_flexors', 'neck'];
  const M = {}; for (const k of names) M[k] = new Float32Array(n);
  const wOf = (i, list) => { let s = 0; for (let k = 0; k < 4; k++) { const b = bones[SI.getComponent(i, k)]; for (const l of list) if (b === l || b === l + '.L' || b === l + '.R') s += SW.getComponent(i, k); } return s; };
  const ua = elbow.clone().sub(sh), uaL = ua.length(), uan = ua.clone().normalize();
  const fa = wrist.clone().sub(elbow), faL = fa.length();
  const backUA = perp(V3(0, 0, -1), uan).normalize();
  const th = knee.clone().sub(hip), thL = th.length(), thn = th.clone().normalize();
  for (let i = 0; i < n; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i), ax = Math.abs(x);
    const nx = N.getX(i) * Math.sign(x || 1), ny = N.getY(i), nz = N.getZ(i); // nx>0 = lateral
    const torso = wOf(i, ['spine01', 'spine02', 'spine03', 'clavicle', 'neck01']);
    const lowTorso = wOf(i, ['spine03', 'spine04', 'spine05', 'root']);
    const deltw = wOf(i, ['shoulder01', 'upperarm01']);
    const armw = wOf(i, ['shoulder01', 'upperarm01', 'upperarm02']);
    const forew = wOf(i, ['lowerarm01', 'lowerarm02']);
    const thighw = wOf(i, ['upperleg01', 'upperleg02']);
    const shinw = wOf(i, ['lowerleg01', 'lowerleg02']);
    const pelw = wOf(i, ['pelvis', 'root', 'spine05']);
    // pectoralis major (ported from build_body.py)
    const ytop = clav.y - 0.012, ylow = (chest.y - 0.13) + 0.55 * ax;
    let pec = ss(-0.05, 0.25, nz) * ss(ylow - 0.01, ylow + 0.025, y) * (1 - ss(ytop - 0.03, ytop, y)) * (1 - ss(sh.x * 0.92, sh.x * 1.02, ax)) * ss(0.004, 0.018, ax) * ss(0.4, 0.75, torso + 0.6 * deltw);
    if (z < chest.z - 0.02) pec = 0;
    M.chest[i] = pec;
    // deltoid cap split by facing
    const capY = ss(sh.y - 0.14, sh.y - 0.08, y) * ss(sh.x * 0.78, sh.x * 0.93, ax) * ss(0.35, 0.65, deltw);
    M.front_delt[i] = capY * ss(0.15, 0.45, nz) * (1 - pec);
    M.rear_delt[i] = capY * ss(0.15, 0.45, -nz);
    M.side_delt[i] = capY * (1 - ss(0.25, 0.5, Math.abs(nz))) * ss(-0.2, 0.3, nx + ny);
    // upper arm: biceps front, triceps back
    const mx = V3(ax, y, z), t = mx.clone().sub(sh).dot(ua) / (uaL * uaL);
    const radial = mx.clone().sub(sh.clone().addScaledVector(ua, t)); const rl = Math.max(radial.length(), 1e-6);
    const rb = radial.dot(backUA) / rl;
    const along = ss(0.12, 0.28, t) * (1 - ss(0.86, 0.97, t)) * ss(0.3, 0.6, armw);
    M.triceps[i] = along * ss(-0.05, 0.35, rb);
    M.biceps[i] = ss(0.2, 0.35, t) * (1 - ss(0.82, 0.95, t)) * ss(0.3, 0.6, armw) * ss(0.1, 0.5, -rb);
    const tf = mx.clone().sub(elbow).dot(fa) / (faL * faL);
    M.forearms[i] = ss(0.4, 0.7, forew) * ss(0.02, 0.12, tf) * (1 - ss(0.55, 0.75, tf));
    // back
    const back = ss(0.05, 0.4, -nz);
    M.upper_traps[i] = ss(chest.y + 0.08, chest.y + 0.13, y) * (1 - ss(H('neck02').y, H('neck03').y + 0.02, y)) * (1 - ss(sh.x * 0.8, sh.x * 0.95, ax)) * ss(-0.2, 0.3, -nz + ny) * (1 - M.chest[i]) * (1 - capY);
    M.mid_back[i] = back * ss(sp2.y + 0.02, sp2.y + 0.07, y) * (1 - ss(chest.y + 0.08, chest.y + 0.12, y)) * (1 - ss(0.075, 0.105, ax)) * ss(0.4, 0.7, torso);
    M.lats[i] = ss(-0.3, 0.1, -nz) * ss(sp3.y - 0.02, sp3.y + 0.04, y) * (1 - ss(chest.y + 0.02, chest.y + 0.07, y)) * ss(0.075, 0.11, ax) * (1 - ss(sh.x * 0.82, sh.x * 0.95, ax)) * ss(0.4, 0.7, torso + lowTorso) * (1 - M.chest[i]);
    M.lower_back[i] = back * ss(root.y + 0.06, root.y + 0.1, y) * (1 - ss(sp2.y, sp2.y + 0.05, y)) * (1 - ss(0.055, 0.075, ax));
    // front torso
    const front = ss(0.2, 0.5, nz);
    M.abs[i] = front * ss(root.y + 0.0, root.y + 0.04, y) * (1 - ss(chest.y - 0.1, chest.y - 0.05, y)) * (1 - ss(0.07, 0.09, ax)) * ss(0.3, 0.6, torso + lowTorso + pelw);
    M.obliques[i] = ss(-0.1, 0.3, nz + 0.6 * nx) * ss(root.y + 0.03, root.y + 0.08, y) * (1 - ss(chest.y - 0.1, chest.y - 0.04, y)) * ss(0.08, 0.1, ax) * ss(0.4, 0.6, nx + 0.3) * ss(0.3, 0.6, torso + lowTorso + pelw) * (1 - M.lats[i]);
    // hips and legs
    M.glutes[i] = ss(0.0, 0.35, -nz) * ss(hip.y - 0.15, hip.y - 0.1, y) * (1 - ss(root.y + 0.06, root.y + 0.1, y)) * ss(0.015, 0.03, ax) * ss(0.3, 0.6, thighw + pelw);
    M.glute_med[i] = ss(0.4, 0.7, nx) * ss(hip.y - 0.02, hip.y + 0.03, y) * (1 - ss(root.y + 0.08, root.y + 0.12, y)) * ss(0.3, 0.6, pelw + thighw);
    const lt = V3(ax, y, z).sub(hip).dot(thn) / thL;
    const legT = ss(0.12, 0.25, lt) * (1 - ss(0.88, 0.98, lt)) * ss(0.4, 0.7, thighw);
    M.quads[i] = legT * ss(-0.05, 0.3, nz + 0.25 * nx);
    M.hamstrings[i] = legT * ss(0.1, 0.4, -nz) * ss(0.05, 0.2, lt - 0.12);
    M.adductors[i] = ss(0.08, 0.2, lt) * (1 - ss(0.6, 0.75, lt)) * ss(0.4, 0.7, thighw) * ss(0.35, 0.7, -nx) * (1 - M.hamstrings[i]);
    M.hip_flexors[i] = ss(-0.02, 0.1, lt) * (1 - ss(0.14, 0.22, lt)) * ss(0.3, 0.6, nz) * ss(0.3, 0.6, thighw + pelw);
    const lsh = (knee.y - y) / (knee.y - ankle.y);
    M.calves[i] = ss(0.4, 0.7, shinw) * ss(0.05, 0.15, lsh) * (1 - ss(0.65, 0.85, lsh)) * ss(0.0, 0.35, -nz);
    M.tibialis[i] = ss(0.4, 0.7, shinw) * ss(0.08, 0.18, lsh) * (1 - ss(0.75, 0.9, lsh)) * ss(0.2, 0.5, nz) * ss(0.0, 0.4, nx + 0.2);
    M.neck[i] = ss(0.4, 0.7, wOf(i, ['neck01', 'neck02', 'neck03'])) * (y < H('head').y ? 1 : 0);
  }
  // ---- derive the shared 38-id vocabulary (exercise-research/muscle-vocabulary.csv) ----
  const V = {}; const z0 = () => new Float32Array(n);
  for (const k of ['chest_upper','chest_mid','chest_lower','serratus_anterior','rotator_cuff','traps_mid','traps_lower','rhomboids','teres_major','neck_front','neck_back','biceps_long','biceps_short','brachialis','brachioradialis','triceps_long','triceps_lateral','forearm_flexors','forearm_extensors','quads_vasti','rectus_femoris','calves_gastrocnemius','calves_soleus']) V[k] = z0();
  const pnL = rig.hand.L.pn;
  for (let i = 0; i < n; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i), ax = Math.abs(x);
    const nxs = N.getX(i) * Math.sign(x || 1), ny = N.getY(i), nz = N.getZ(i);
    const c = M.chest[i], ylow = (chest.y - 0.13) + 0.55 * ax, ytop = clav.y - 0.012, u = (y - ylow) / Math.max(0.02, ytop - ylow);
    V.chest_upper[i] = c * ss(0.58, 0.68, u); V.chest_lower[i] = c * (1 - ss(0.22, 0.32, u)); V.chest_mid[i] = c * (1 - V.chest_upper[i] / Math.max(c, 1e-6)) * (1 - V.chest_lower[i] / Math.max(c, 1e-6));
    V.serratus_anterior[i] = ss(0.5, 0.8, nxs) * ss(chest.y - 0.16, chest.y - 0.12, y) * (1 - ss(chest.y - 0.02, chest.y + 0.02, y)) * ss(0.1, 0.12, ax) * (1 - M.lats[i]) * (1 - c);
    const mb = M.mid_back[i];
    V.rhomboids[i] = mb * (1 - ss(0.035, 0.06, ax));
    V.traps_mid[i] = mb * ss(chest.y - 0.02, chest.y + 0.02, y);
    V.traps_lower[i] = ss(0.1, 0.4, -nz) * ss(sp2.y - 0.04, sp2.y, y) * (1 - ss(chest.y - 0.04, chest.y, y)) * (1 - ss(0.04 + (y - sp2.y) * 0.5, 0.06 + (y - sp2.y) * 0.5, ax));
    V.rotator_cuff[i] = ss(0.2, 0.5, -nz) * ss(chest.y - 0.05, chest.y - 0.01, y) * (1 - ss(chest.y + 0.08, chest.y + 0.11, y)) * ss(0.07, 0.1, ax) * (1 - ss(sh.x * 0.8, sh.x * 0.9, ax));
    V.teres_major[i] = ss(0.0, 0.4, -nz + 0.5 * nxs) * ss(chest.y - 0.07, chest.y - 0.04, y) * (1 - ss(chest.y + 0.0, chest.y + 0.03, y)) * ss(0.1, 0.13, ax) * (1 - ss(sh.x * 0.85, sh.x * 0.95, ax));
    V.neck_back[i] = M.neck[i] * ss(0.0, 0.3, -nz); V.neck_front[i] = M.neck[i] * ss(0.0, 0.3, nz);
    // arms: biceps heads split by lateral/medial facing, brachialis = lower outer arm
    const b = M.biceps[i]; V.biceps_long[i] = b * ss(-0.1, 0.2, nxs); V.biceps_short[i] = b * (1 - ss(-0.1, 0.2, nxs));
    const mx = V3(ax, y, z), t = mx.clone().sub(sh).dot(ua) / (uaL * uaL);
    V.brachialis[i] = ss(0.55, 0.65, t) * (1 - ss(0.9, 0.98, t)) * ss(0.3, 0.6, nxs) * ss(0.3, 0.6, wOf(i, ['upperarm01', 'upperarm02'])) * (1 - M.triceps[i]);
    const tr = M.triceps[i]; V.triceps_long[i] = tr * (1 - ss(-0.1, 0.25, nxs)); V.triceps_lateral[i] = tr * ss(-0.1, 0.25, nxs);
    const fo = M.forearms[i], fn = V3(N.getX(i), ny, nz); if (x < 0) fn.x = -fn.x;
    const palmSide = fn.dot(pnL);
    V.forearm_flexors[i] = fo * ss(-0.1, 0.25, palmSide); V.forearm_extensors[i] = fo * (1 - ss(-0.1, 0.25, palmSide));
    const tf = mx.clone().sub(elbow).dot(fa) / (faL * faL);
    V.brachioradialis[i] = ss(0.4, 0.7, wOf(i, ['lowerarm01', 'lowerarm02', 'upperarm02'])) * ss(-0.08, 0.0, tf) * (1 - ss(0.35, 0.5, tf)) * ss(0.2, 0.6, nxs + 0.3 * nz);
    const q = M.quads[i]; const cen = 1 - ss(0.25, 0.5, Math.abs(nxs)); V.rectus_femoris[i] = q * cen * ss(0.3, 0.6, nz); V.quads_vasti[i] = q * (1 - V.rectus_femoris[i] / Math.max(q, 1e-6) * 0.85);
    const lsh = (knee.y - y) / (knee.y - ankle.y), cf = M.calves[i];
    V.calves_gastrocnemius[i] = cf * (1 - ss(0.45, 0.6, lsh)); V.calves_soleus[i] = ss(0.4, 0.7, wOf(i, ['lowerleg01', 'lowerleg02'])) * ss(0.4, 0.55, lsh) * (1 - ss(0.75, 0.85, lsh)) * ss(-0.2, 0.3, -nz + 0.4 * Math.abs(nxs));
  }
  Object.assign(V, { delt_front: M.front_delt, delt_side: M.side_delt, delt_rear: M.rear_delt, traps_upper: M.upper_traps, lats: M.lats, erector_spinae: M.lower_back,
    abs_rectus: M.abs, obliques: M.obliques, hip_flexors: M.hip_flexors, glute_max: M.glutes, glute_med: M.glute_med, adductors: M.adductors, hamstrings: M.hamstrings, tibialis_anterior: M.tibialis });
  return V;
}
export function paintMuscles(rig, masks, primary, secondary) {
  const g = rig.mesh.geometry;
  if (!g.attributes.color) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 4), 4)); // bodies exported without vertex colours
  const C = g.attributes.color, n = C.count;
  const nb = rig.meta.tris_body ? null : null;
  for (let i = 0; i < n; i++) {
    let r = 0, gg = 0;
    for (const m of primary) if (masks[m]) r = Math.max(r, masks[m][i]);
    for (const m of secondary) if (masks[m]) gg = Math.max(gg, masks[m][i]);
    const b = C.getZ(i) > 0.5 ? 1 : 0; // eyes flag kept
    C.setXYZW(i, b ? 0 : r, b ? 0 : gg * (1 - r), b, 1);
  }
  C.needsUpdate = true;
}
