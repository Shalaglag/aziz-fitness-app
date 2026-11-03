// Mizan gym kit: procedural detailed equipment (every piece 10,000+ triangles) for real-time exercise demos.
// three.js r160 ES module. No external assets; everything is built from primitives (licence: same as the app).
//
// Conventions
//   Units metres, +Y up. Each piece has its own local frame.
//   Bars and handles: long axis along local X.
//   Stations and machines: the user faces +Z, the user's left is +X (glTF convention).
//   Origin on the floor under the main contact (seat centre, standing spot, or the centre of a free weight's bar at its resting height 0).
//   Anchors are Object3D children named in camelCase, so they follow moving parts.
//     userData.anchor = { kind, ... }
//     kind 'grip':  local +X = handle axis, local +Y = direction the palm pushes into the handle.
//                   radius (m), length (usable, m), gripType ('cylinder'|'rope'|'knob'|'pad'|'strap'),
//                   orient (allowed hand orientations: 'overhand'|'underhand'|'neutral'|'any'), hand ('L'|'R'|'either').
//     kind 'foot':  local +Y = sole normal, local +X = toe direction (heel at the anchor's -X end, length 0.26).
//     kind 'body':  local +Y = surface normal pointing at the body. part = 'seat'|'back'|'chest'|'shin'|'thigh'|'knee'|'ankle'|'elbow'|'shoulder'|'hip'|'forearm'|'upperArm'.
//     kind 'attach': where something clips on (cableEnd, hookL/R, sleeve, pin).
//   dofs: [{ name, label, min, max, value, unit }]; set(name, v) moves the piece. 'motion' (0..1) is the rep path where a piece has one.
//
// build(id, opts) -> { id, name, object, anchors: {name: Object3D}, dofs, set(name, v), get(name), tris }

import * as THREE from '../../vendor/three-r160/three.module.min.js';

export const KIT_VERSION = '2.3.0';

// ---------------------------------------------------------------- textures (procedural, generated once in the browser)
const HAS_DOM = typeof document !== 'undefined';
function canvasTex(size, draw, repeat = 1, srgb = false) {
  if (!HAS_DOM) return null;
  const c = document.createElement('canvas'); c.width = c.height = size; const x = c.getContext('2d'); draw(x, size);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t;
}
// height field -> tangent-space normal map
function heightToNormal(x, s, hf, strength) {
  const img = x.createImageData(s, s), d = img.data;
  for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) {
    const h = (a, b) => hf[((b + s) % s) * s + ((a + s) % s)];
    const dx = (h(i + 1, j) - h(i - 1, j)) * strength, dy = (h(i, j + 1) - h(i, j - 1)) * strength;
    const l = Math.hypot(dx, dy, 1), k = (j * s + i) * 4;
    d[k] = (-dx / l * 0.5 + 0.5) * 255; d[k + 1] = (dy / l * 0.5 + 0.5) * 255; d[k + 2] = (1 / l * 0.5 + 0.5) * 255; d[k + 3] = 255;
  }
  x.putImageData(img, 0, 0);
}
function noiseField(s, cells, seed = 1) {
  // value noise with a few octaves, tileable
  let r = seed; const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
  const hf = new Float32Array(s * s);
  for (let o = 0, amp = 1, c = cells; o < 4; o++, amp *= 0.5, c *= 2) {
    const g = Array.from({ length: c * c }, rnd);
    for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) {
      const fx = i / s * c, fy = j / s * c, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const G = (a, b) => g[((b % c + c) % c) * c + ((a % c + c) % c)];
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      hf[j * s + i] += amp * ((G(x0, y0) * (1 - sx) + G(x0 + 1, y0) * sx) * (1 - sy) + (G(x0, y0 + 1) * (1 - sx) + G(x0 + 1, y0 + 1) * sx) * sy);
    }
  }
  return hf;
}
const TEX = {
  leather: canvasTex(256, (x, s) => { const hf = noiseField(s, 16, 7); for (let i = 0; i < hf.length; i++) hf[i] = Math.pow(hf[i] / 1.9, 3); heightToNormal(x, s, hf, 6); }, 6),
  powder: canvasTex(128, (x, s) => heightToNormal(x, s, noiseField(s, 32, 3), 1.2), 8),
  rubber: canvasTex(128, (x, s) => { const hf = noiseField(s, 40, 11); heightToNormal(x, s, hf, 2.5); }, 10),
  knurl: canvasTex(128, (x, s) => { const hf = new Float32Array(s * s); for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) { const a = Math.abs(((i + j) / s * 8) % 1 - 0.5), b = Math.abs(((i - j + s) / s * 8) % 1 - 0.5); hf[j * s + i] = Math.min(a, b); } heightToNormal(x, s, hf, 10); }, 1),
  plateText: null, // per weight, see plateFaceMat()
  dbLabel: canvasTex(128, (x, s) => { x.fillStyle = '#c8ccd0'; x.fillRect(0, 0, s, s); x.fillStyle = '#2b2f34'; x.font = 'bold 44px Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('20', s / 2, s / 2 - 8); x.font = 'bold 20px Arial, sans-serif'; x.fillText('KG', s / 2, s / 2 + 28); }, 1, true),
  kbLabel: canvasTex(128, (x, s) => { x.fillStyle = '#2e3237'; x.fillRect(0, 0, s, s); x.fillStyle = '#9aa0a6'; x.font = 'bold 56px Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('16', s / 2, s / 2); }, 1, true),
  console: canvasTex(256, (x, s) => { x.fillStyle = '#0e1114'; x.fillRect(0, 0, s, s); x.fillStyle = '#4fd1c5'; x.font = 'bold 34px Arial, sans-serif'; x.textAlign = 'center'; x.fillText('12:48', s / 2, 70); x.font = '20px Arial, sans-serif'; x.fillStyle = '#9aa4ae'; x.fillText('6.2 km/h   8 %', s / 2, 120); x.fillText('142 bpm', s / 2, 160); x.strokeStyle = '#2e353c'; x.lineWidth = 3; x.strokeRect(14, 190, s - 28, 40); }, 1, true),
};
// numbered stack-plate atlas: 16 rows
const STACK_LABELS = canvasTex(256, (x, s) => { x.fillStyle = '#e9ecef'; x.fillRect(0, 0, s, s); x.fillStyle = '#1d2329'; x.font = 'bold 13px Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  for (let i = 0; i < 16; i++) x.fillText(String((16 - i) * 5), s / 2, (i + 0.5) * s / 16); }, 1, true);
if (STACK_LABELS) STACK_LABELS.repeat.set(1, 1);

// ---------------------------------------------------------------- materials
const mat = (color, roughness, metalness = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
export const MAT = {
  frame: mat('#3a4047', 0.48, 0.35, { normalMap: TEX.powder, normalScale: new THREE.Vector2(0.25, 0.25) }),
  frameLight: mat('#6d757d', 0.45, 0.45),
  chrome: mat('#c8ccd0', 0.18, 1.0),
  knurl: mat('#a2a8ae', 0.42, 0.95, { normalMap: TEX.knurl, normalScale: new THREE.Vector2(0.6, 0.6) }),
  steel: mat('#8f969d', 0.35, 0.9),
  pad: new THREE.MeshPhysicalMaterial({ color: '#25292e', roughness: 0.55, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.5, normalMap: TEX.leather, normalScale: new THREE.Vector2(0.55, 0.55) }),
  piping: mat('#1a1d20', 0.6, 0),
  board: mat('#17191c', 0.8, 0),
  plate: mat('#2e3237', 0.62, 0.15, { normalMap: TEX.rubber, normalScale: new THREE.Vector2(0.3, 0.3) }),
  plateFace: null,
  rubber: mat('#212428', 0.85, 0, { normalMap: TEX.rubber, normalScale: new THREE.Vector2(0.5, 0.5) }),
  cap: mat('#151719', 0.55, 0),
  shroud: mat('#8a9198', 0.5, 0.2, { normalMap: TEX.powder, normalScale: new THREE.Vector2(0.15, 0.15) }),
  deck: mat('#1f2327', 0.85, 0, { normalMap: TEX.rubber, normalScale: new THREE.Vector2(0.4, 0.4) }),
  stack: mat('#4a5058', 0.45, 0.6),
  label: mat('#ffffff', 0.6, 0, { map: STACK_LABELS }),
  rope: mat('#3b3f44', 0.95, 0, { normalMap: TEX.rubber, normalScale: new THREE.Vector2(1, 1) }),
  cable: mat('#15181b', 0.35, 0.2),
  band: mat('#5b6168', 0.75, 0),
  ball: mat('#7d858d', 0.7, 0, { normalMap: TEX.leather, normalScale: new THREE.Vector2(0.4, 0.4) }),
  wood: mat('#a99d8c', 0.75, 0, { normalMap: TEX.powder, normalScale: new THREE.Vector2(0.3, 0.3) }),
  fabric: mat('#4b5157', 0.95, 0, { normalMap: TEX.rubber, normalScale: new THREE.Vector2(0.8, 0.8) }),
  screen: mat('#ffffff', 0.25, 0.1, { map: TEX.console, emissive: '#ffffff', emissiveMap: TEX.console, emissiveIntensity: 0.35 }),
  dbLabel: mat('#ffffff', 0.3, 0.6, { map: TEX.dbLabel }),
  kbLabel: mat('#ffffff', 0.6, 0.1, { map: TEX.kbLabel }),
  foam: mat('#2a2e33', 0.9, 0, { normalMap: TEX.rubber, normalScale: new THREE.Vector2(1.2, 1.2) }),
  strap: mat('#30353b', 0.85, 0, { normalMap: TEX.knurl, normalScale: new THREE.Vector2(0.3, 0.3) }),
};

// ---------------------------------------------------------------- tiny builders
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const AX = { x: V(1, 0, 0), y: V(0, 1, 0), z: V(0, 0, 1) };

function mesh(geo, m, parent, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z); o.castShadow = o.receiveShadow = true;
  parent.add(o); return o;
}
// rounded-rectangle shape (centred)
function rrShape(w, h, r, holes = []) {
  r = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4); const s = new THREE.Shape(), hw = w / 2, hh = h / 2;
  s.moveTo(-hw + r, -hh); s.lineTo(hw - r, -hh); s.absarc(hw - r, -hh + r, r, -Math.PI / 2, 0); s.lineTo(hw, hh - r); s.absarc(hw - r, hh - r, r, 0, Math.PI / 2);
  s.lineTo(-hw + r, hh); s.absarc(-hw + r, hh - r, r, Math.PI / 2, Math.PI); s.lineTo(-hw, -hh + r); s.absarc(-hw + r, -hh + r, r, Math.PI, Math.PI * 1.5);
  for (const h of holes) s.holes.push(h); return s;
}
// rounded box: w (x) h (y) d (z) with radius r on every edge
function rboxGeo(w, h, d, r = 0.006, seg = 3) {
  r = Math.min(r, w / 2.2, h / 2.2, d / 2.2); const b = Math.min(r, d / 2.2);
  const g = new THREE.ExtrudeGeometry(rrShape(w - 2 * b, h - 2 * b, Math.max(r - b, 0.0005)), { depth: d - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: seg, curveSegments: 4 });
  g.translate(0, 0, -(d - 2 * b) / 2); return g;
}
const box = (p, w, h, d, m, x, y, z, r) => mesh(rboxGeo(w, h, d, r ?? Math.min(0.008, Math.min(w, h, d) * 0.22)), m, p, x, y, z);

// cylinder along an axis 'x' | 'y' | 'z'
function cyl(p, r, len, m, x, y, z, axis = 'y', seg = 32, r2 = r) {
  const g = new THREE.CylinderGeometry(r2, r, len, Math.max(seg, r > 0.03 ? 48 : 28), 1);
  if (axis === 'x') g.rotateZ(-Math.PI / 2); else if (axis === 'z') g.rotateX(Math.PI / 2);
  return mesh(g, m, p, x, y, z);
}
// geometry knurl: diamond pattern cut into a cylinder (axis Y)
function knurlGeo(r, len, pitch = 0.0035, radial = 72) {
  const rows = Math.max(8, Math.round(len / pitch));
  const g = new THREE.CylinderGeometry(r, r, len, radial, rows, true); const P = g.attributes.position;
  for (let i = 0; i < P.count; i++) { const x = P.getX(i), y = P.getY(i), zz = P.getZ(i); const a = Math.atan2(zz, x); const u = a / (Math.PI * 2) * radial / 2, v = y / pitch;
    const k = Math.abs(((u + v) % 1 + 1) % 1 - 0.5) + Math.abs(((u - v) % 1 + 1) % 1 - 0.5); const rr = r - 0.0005 * Math.max(0, 0.6 - k);
    P.setX(i, Math.cos(a) * rr); P.setZ(i, Math.sin(a) * rr); }
  g.computeVertexNormals(); return g;
}
function knurl(p, r, len, x, y, z, axis = 'x', pitch = 0.0035, radial = 72) { const g = knurlGeo(r, len, pitch, radial); if (axis === 'x') g.rotateZ(-Math.PI / 2); else if (axis === 'z') g.rotateX(Math.PI / 2); return mesh(g, MAT.knurl, p, x, y, z); }
// ridged rubber handle (axis), with flanged ends
function hgrip(p, r, len, x, y, z, axis = 'x') {
  const pts = [V(r * 0.7, -len / 2)]; pts.push(V(r + 0.004, -len / 2), V(r + 0.004, -len / 2 + 0.006));
  const n = Math.round((len - 0.012) / 0.004);
  for (let i = 0; i <= n; i++) { const t = i / n; pts.push(V(r + 0.0009 * Math.cos(t * n * Math.PI), -len / 2 + 0.006 + t * (len - 0.012))); }
  pts.push(V(r + 0.004, len / 2 - 0.006), V(r + 0.004, len / 2), V(r * 0.7, len / 2));
  const g = new THREE.LatheGeometry(pts.map(q => new THREE.Vector2(q.x, q.y)), 64);
  if (axis === 'x') g.rotateZ(-Math.PI / 2); else if (axis === 'z') g.rotateX(Math.PI / 2);
  return mesh(g, MAT.rubber, p, x, y, z);
}
// hex bolt with washer, head facing +normal
function bolt(p, pos, normal, size = 0.008) {
  const g = new THREE.Group(); g.position.copy(pos); g.quaternion.setFromUnitVectors(UP, normal.clone().normalize()); p.add(g);
  cyl(g, size * 1.5, 0.002, MAT.steel, 0, 0.001, 0, 'y', 20); const h = mesh(new THREE.CylinderGeometry(size, size, size * 0.7, 6), MAT.steel, g, 0, 0.002 + size * 0.35, 0);
  mesh(new THREE.CylinderGeometry(size * 0.55, size * 0.75, size * 0.15, 12), MAT.steel, g, 0, 0.002 + size * 0.78, 0);
  return g;
}
// square tube between two points with rounded corners, end caps and bolts; round=true for round tube
function tube(p, a, b, s = 0.06, m = MAT.frame, round = false, opts = {}) {
  const A = a.isVector3 ? a : V(...a), B = b.isVector3 ? b : V(...b);
  const d = B.clone().sub(A), len = d.length(); if (len < 1e-4) return null;
  let g;
  if (round) g = new THREE.CylinderGeometry(s / 2, s / 2, len, s > 0.03 ? 32 : 20, 1);
  else { g = new THREE.ExtrudeGeometry(rrShape(s, s, s * 0.2), { depth: len, bevelEnabled: false, curveSegments: 5 }); g.translate(0, 0, -len / 2); g.rotateX(-Math.PI / 2); }
  const o = mesh(g, m, p);
  o.position.copy(A).addScaledVector(d, 0.5);
  const dir = d.clone().normalize(); o.quaternion.setFromUnitVectors(UP, dir);
  // end caps and bolts in the tube's local frame
  if (!round && s >= 0.035 && opts.caps !== false) {
    for (const k of [-1, 1]) {
      const c = new THREE.Mesh(rboxGeo(s * 0.92, 0.008, s * 0.92, 0.003, 2), MAT.cap); c.position.y = k * (len / 2 + 0.003); c.castShadow = true; o.add(c);
      if (len > 0.18 && opts.bolts !== false) for (const sz of [-1, 1]) bolt(o, V(s / 2, k * (len / 2 - 0.035), sz * s * 0.22), V(1, 0, 0), Math.min(0.007, s * 0.12));
    }
  } else if (round && s >= 0.02 && opts.caps !== false) {
    for (const k of [-1, 1]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.52, s * 0.5, 0.008, 24), MAT.cap); c.position.y = k * (len / 2 + 0.003); o.add(c); }
  }
  return o;
}
// curved round tube through points
function bent(p, pts, s = 0.05, m = MAT.frame) {
  const curve = new THREE.CatmullRomCurve3(pts.map(q => q.isVector3 ? q : V(...q)), false, 'centripetal');
  return mesh(new THREE.TubeGeometry(curve, Math.max(24, pts.length * 16), s / 2, 20, false), m, p);
}

// upholstered pad: w (x) by l (z) by t (thickness, y). Crowned cushion, piping seams, backing board.
function cushionGeo(w, t, l, crown, step = 0.012, rMax = 0.022) {
  const r = Math.min(rMax, t * 0.42, w / 4);
  const nx = Math.max(8, Math.ceil(w / step)), ny = Math.max(6, Math.ceil(t / 0.008)), nz = Math.max(8, Math.ceil(l / step));
  const g = new THREE.BoxGeometry(w, t, l, nx, ny, nz); const P = g.attributes.position, N = g.attributes.normal;
  const hw = w / 2, ht = t / 2, hl = l / 2, iw = hw - r, it = ht - r, il = hl - r;
  // remap coordinates so more rows sit in the rounded band
  const remap = (v, h) => { const u = v / h; return Math.sign(u) * Math.pow(Math.abs(u), 0.75) * h; };
  for (let i = 0; i < P.count; i++) {
    let x = remap(P.getX(i), hw), y = P.getY(i), z = remap(P.getZ(i), hl);
    const cx = Math.max(-iw, Math.min(iw, x)), cy = Math.max(-it, Math.min(it, y)), cz = Math.max(-il, Math.min(il, z));
    const n = V(x - cx, y - cy, z - cz); const L = n.length();
    let px = x, py = y, pz = z, nn;
    if (L > 1e-6) { n.multiplyScalar(1 / L); px = cx + n.x * r; py = cy + n.y * r; pz = cz + n.z * r; nn = n; } else nn = V(N.getX(i), N.getY(i), N.getZ(i));
    if (py > it * 0.2) { // crown on the upper half
      const fx = 1 - Math.pow(Math.min(1, Math.abs(px) / hw), 4), fz = 1 - Math.pow(Math.min(1, Math.abs(pz) / hl), 4), k = (py - it * 0.2) / (ht - it * 0.2);
      py += crown * fx * fz * k;
      const dfx = -4 * Math.pow(Math.abs(px) / hw, 3) / hw * Math.sign(px) * fz, dfz = -4 * Math.pow(Math.abs(pz) / hl, 3) / hl * Math.sign(pz) * fx;
      nn = V(nn.x - crown * dfx * k * 0.8, nn.y, nn.z - crown * dfz * k * 0.8).normalize();
    }
    P.setXYZ(i, px, py, pz); N.setXYZ(i, nn.x, nn.y, nn.z);
  }
  // uv in metres so the leather grain is even
  const U = g.attributes.uv; for (let i = 0; i < P.count; i++) { const nx2 = Math.abs(N.getX(i)), ny2 = Math.abs(N.getY(i)); U.setXY(i, (ny2 > 0.5 ? P.getX(i) : nx2 > 0.5 ? P.getZ(i) : P.getX(i)) * 3, (ny2 > 0.5 ? P.getZ(i) : P.getY(i)) * 3); }
  return g;
}
function piping(w, l, y, r = 0.0035, corner = 0.02) {
  const s = rrShape(w, l, corner); const pts = s.getSpacedPoints(160).map(q => V(q.x, y, q.y));
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 160, r, 6, true);
}
function pad(p, w, t, l, x, y, z, rot = [0, 0, 0], m = MAT.pad) {
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.set(...rot); p.add(g);
  const board = 0.014, ct = Math.max(t - board, 0.03), crown = Math.min(0.012, ct * 0.18);
  mesh(cushionGeo(w, ct, l, crown), m, g, 0, board / 2, 0);
  mesh(rboxGeo(w - 0.012, board, l - 0.012, 0.004, 2), MAT.board, g, 0, -ct / 2 + board / 2 - 0.004, 0);
  const pr = Math.min(0.022, ct * 0.42, w / 4);
  mesh(piping(w - 0.004, l - 0.004, board / 2 + ct / 2 - pr * 0.45, 0.0032, pr * 1.2), MAT.piping, g);
  mesh(piping(w - 0.002, l - 0.002, board / 2 - ct / 2 + pr * 0.3, 0.0028, pr * 1.2), MAT.piping, g);
  return g;
}

// foam roller pad along X: leather sleeve with end caps, on a chrome axle
function roller(p, len, x, y, z, r = 0.05) {
  const pts = []; const n = 28;
  for (let i = 0; i <= n; i++) { const t = i / n, u = t * 2 - 1; const e = Math.pow(Math.abs(u), 10); pts.push(new THREE.Vector2(r * (1 - 0.18 * e) + 0.002 * Math.sin(t * Math.PI), u * len / 2 * 0.98)); }
  pts.unshift(new THREE.Vector2(0.014, -len / 2 * 0.98)); pts.push(new THREE.Vector2(0.014, len / 2 * 0.98));
  const g = new THREE.LatheGeometry(pts, 48); g.rotateZ(-Math.PI / 2); mesh(g, MAT.pad, p, x, y, z);
  cyl(p, 0.012, len + 0.06, MAT.chrome, x, y, z, 'x', 20);
  for (const s of [-1, 1]) { cyl(p, 0.022, 0.012, MAT.cap, x + s * (len / 2 + 0.008), y, z, 'x', 24); cyl(p, 0.015, 0.01, MAT.chrome, x + s * (len / 2 + 0.03), y, z, 'x', 6); }
}

// olympic tri-grip plate facing X (rubber coated), radius by kg
function plateGeo(kg = 20) {
  const R0 = kg >= 15 ? 0.225 : kg >= 10 ? 0.165 : kg >= 5 ? 0.13 : 0.1, T = kg >= 20 ? 0.05 : kg >= 10 ? 0.038 : 0.026;
  const outer = new THREE.Shape(); outer.absarc(0, 0, R0 - 0.004, 0, Math.PI * 2, false);
  const hole = new THREE.Path(); hole.absarc(0, 0, 0.0255, 0, Math.PI * 2, true); outer.holes.push(hole);
  if (kg >= 10) for (let i = 0; i < 3; i++) { const a = i * Math.PI * 2 / 3 + Math.PI / 2, h = new THREE.Path(), rr = R0 * 0.72, hw = 0.38;
    h.absarc(Math.cos(a - hw) * rr, Math.sin(a - hw) * rr, 0.022, a - hw + Math.PI, a - hw, true); h.absarc(0, 0, rr + 0.022, a - hw, a + hw, false);
    h.absarc(Math.cos(a + hw) * rr, Math.sin(a + hw) * rr, 0.022, a + hw, a + hw + Math.PI, true); h.absarc(0, 0, rr - 0.022, a + hw, a - hw, true); outer.holes.push(h); }
  const g = new THREE.ExtrudeGeometry(outer, { depth: T - 0.008, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2, curveSegments: 30 });
  g.translate(0, 0, -(T - 0.008) / 2); g.rotateY(Math.PI / 2); g.userData = { R: R0, T }; return g;
}
const PLATE_CACHE = {};
const PLATE_FACE = {};
function plateFaceMat(kg) {
  if (PLATE_FACE[kg]) return PLATE_FACE[kg];
  const t = canvasTex(512, (x, s) => { x.fillStyle = '#2b2f34'; x.fillRect(0, 0, s, s); x.fillStyle = '#7d848b'; x.font = 'bold 40px Arial, sans-serif'; x.textAlign = 'center';
    const ring = (txt, rad, a0) => { for (let i = 0; i < txt.length; i++) { const a = a0 + i * 0.13; x.save(); x.translate(s / 2 + Math.cos(a) * rad, s / 2 + Math.sin(a) * rad); x.rotate(a + Math.PI / 2); x.fillText(txt[i], 0, 0); x.restore(); } };
    ring('MIZAN', s * 0.39, -2.0); ring(String(kg).replace('.', ',') + ' KG', s * 0.39, 0.85); }, 1, true);
  return (PLATE_FACE[kg] = mat('#ffffff', 0.62, 0.1, { map: t }));
}
function plate(p, kg, x, y, z, axis = 'x') {
  const G = PLATE_CACHE[kg] || (PLATE_CACHE[kg] = plateGeo(kg)); const { R: R0, T } = G.userData;
  const grp = new THREE.Group(); grp.position.set(x, y, z); p.add(grp);
  if (axis === 'z') grp.rotation.y = Math.PI / 2; else if (axis === 'y') grp.rotation.z = Math.PI / 2;
  mesh(G, MAT.plate, grp);
  // raised rim and lettered face rings, chrome hub
  for (const s of [-1, 1]) {
    const rim = new THREE.TorusGeometry(R0 - 0.012, 0.007, 8, 72); rim.rotateY(Math.PI / 2); mesh(rim, MAT.plate, grp, s * (T / 2 - 0.002), 0, 0);
    const face = new THREE.RingGeometry(R0 * 0.82, R0 - 0.02, 72, 1); face.rotateY(s * Math.PI / 2);
    const U = face.attributes.uv, P = face.attributes.position; for (let i = 0; i < P.count; i++) U.setXY(i, 0.5 + P.getZ(i) / (2 * R0) * s, 0.5 + P.getY(i) / (2 * R0));
    mesh(face, plateFaceMat(kg), grp, s * (T / 2 + 0.0006), 0, 0);
    const hub = new THREE.CylinderGeometry(0.04, 0.04, 0.006, 40, 1, true); hub.rotateZ(Math.PI / 2); mesh(hub, MAT.chrome, grp, s * (T / 2 - 0.001), 0, 0);
    const hr = new THREE.RingGeometry(0.0255, 0.04, 40); hr.rotateY(s * Math.PI / 2); mesh(hr, MAT.chrome, grp, s * (T / 2 + 0.002), 0, 0);
  }
  const bore = new THREE.CylinderGeometry(0.0256, 0.0256, T, 32, 1, true); bore.rotateZ(Math.PI / 2); mesh(bore, MAT.chrome, grp);
  return grp;
}

// ---------------------------------------------------------------- anchors
function anchor(parent, name, kind, pos, info = {}, xAxis = V(1, 0, 0), yAxis = V(0, 1, 0)) {
  const o = new THREE.Object3D(); o.name = name;
  o.position.copy(pos.isVector3 ? pos : V(...pos));
  const X = (xAxis.isVector3 ? xAxis : V(...xAxis)).clone().normalize();
  let Y = (yAxis.isVector3 ? yAxis : V(...yAxis)).clone();
  Y.addScaledVector(X, -Y.dot(X));
  if (Y.lengthSq() < 1e-8) Y = Math.abs(X.y) < 0.9 ? V(0, 1, 0).addScaledVector(X, -X.y) : V(1, 0, 0).addScaledVector(X, -X.x);
  Y.normalize();
  const Z = X.clone().cross(Y);
  o.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
  o.userData.anchor = { kind, ...info };
  parent.add(o); return o;
}
const grip = (p, name, pos, info, axis, palm) => anchor(p, name, 'grip', pos, { radius: 0.016, length: 0.12, gripType: 'cylinder', orient: ['any'], hand: 'either', ...info }, axis, palm);
const foot = (p, name, pos, toe = V(0, 0, 1), sole = V(0, 1, 0)) => anchor(p, name, 'foot', pos, {}, toe, sole);
const body = (p, name, part, pos, normal = V(0, 1, 0), along = V(1, 0, 0)) => anchor(p, name, 'body', pos, { part }, along, normal);
const attach = (p, name, pos, info = {}) => anchor(p, name, 'attach', pos, info);

// A handle that is always connected: a support tube runs from `from` to the near end of the grip;
// the rubber grip runs from that end along `axis` for `len`; the anchor sits on the free middle.
// axis: unit vector from the connected end toward the free end.
function handle(p, name, from, end, axis, len = 0.15, { r = 0.016, hand = 'either', orient = ['any'], palm = null, stem = 0.032, both = null, info = {} } = {}) {
  const E = end.isVector3 ? end : V(...end), A = (axis.isVector3 ? axis : V(...axis)).clone().normalize();
  if (from) tube(p, from.isVector3 ? from : V(...from), E, stem, MAT.frame, true);
  const C = E.clone().addScaledVector(A, len / 2 + 0.004);
  const g = hgrip(p, r, len, 0, 0, 0, 'y'); g.position.copy(C); g.quaternion.setFromUnitVectors(UP, A);
  if (both) tube(p, E.clone().addScaledVector(A, len + 0.008), both.isVector3 ? both : V(...both), stem, MAT.frame, true);
  else { const c = cyl(p, r * 0.9, 0.012, MAT.cap, 0, 0, 0, 'y', 24); c.position.copy(E.clone().addScaledVector(A, len + 0.01)); c.quaternion.setFromUnitVectors(UP, A); }
  const pm = palm || (Math.abs(A.y) > 0.7 ? V(0, 0, -1) : V(0, -1, 0));
  return grip(p, name, C, { radius: r, length: len - 0.02, hand, orient, ...info }, A, pm);
}
const handlePair = (p, names, fromFn, endFn, axisFn, len, o = {}) => [1, -1].map(s => handle(p, s > 0 ? names[0] : names[1], fromFn(s), endFn(s), axisFn(s), len, { hand: s > 0 ? 'L' : 'R', ...o }));

// rubber levelling foot under a base tube
function levelFoot(p, x, z, y = 0) { cyl(p, 0.03, 0.012, MAT.rubber, x, y + 0.006, z, 'y', 28); cyl(p, 0.008, 0.03, MAT.steel, x, y + 0.025, z, 'y', 12); cyl(p, 0.014, 0.008, MAT.steel, x, y + 0.016, z, 'y', 6); }
// base runner: tube on the floor with levelling feet at both ends
function baseRail(p, a, b, s = 0.08) {
  const A = V(...a), B = V(...b); A.y = B.y = 0.022 + s / 2; tube(p, A, B, s);
  for (const P of [A, B]) levelFoot(p, P.x, P.z);
}
// spring-loaded pop pin (adjustment knob) on a tube face, pointing along dir
function popPin(p, pos, dir) {
  const g = new THREE.Group(); g.position.copy(pos); g.quaternion.setFromUnitVectors(UP, dir.clone().normalize()); p.add(g);
  cyl(g, 0.016, 0.03, MAT.steel, 0, 0.015, 0, 'y', 24); cyl(g, 0.006, 0.03, MAT.chrome, 0, 0.04, 0, 'y', 12);
  mesh(new THREE.SphereGeometry(0.02, 24, 16), MAT.cap, g, 0, 0.065, 0).scale.set(1, 0.8, 1);
  return g;
}
// row of adjustment holes along a tube face
function holes(p, a, b, n, normal, r = 0.006) {
  const A = V(...a), B = V(...b);
  for (let i = 0; i < n; i++) { const P = A.clone().lerp(B, n > 1 ? i / (n - 1) : 0.5); const c = mesh(new THREE.CylinderGeometry(r, r, 0.004, 16), MAT.cap, p); c.position.copy(P); c.quaternion.setFromUnitVectors(UP, normal); }
}

// ---------------------------------------------------------------- shared assemblies
// Selectorised weight stack in a tower; stack sits on the floor at (x, z), plates along X, label faces +Z.
function weightStack(p, x, z, { plates = 16, h = 2.0, w = 0.36, d = 0.24, shroud = true, pin = 9 } = {}) {
  const g = new THREE.Group(); g.position.set(x, 0, z); p.add(g);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) tube(g, [sx * w / 2, 0.06, sz * d / 2], [sx * w / 2, h, sz * d / 2], 0.05);
  box(g, w + 0.08, 0.06, d + 0.08, MAT.frame, 0, h + 0.03, 0);
  box(g, w + 0.14, 0.04, d + 0.16, MAT.frame, 0, 0.04, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) levelFoot(g, sx * (w / 2 + 0.04), sz * (d / 2 + 0.05));
  const gx = w * 0.32;
  for (const sx of [-1, 1]) { cyl(g, 0.0095, h - 0.1, MAT.chrome, sx * gx, h / 2 + 0.03, 0, 'y', 20); cyl(g, 0.024, 0.04, MAT.rubber, sx * gx, 0.08, 0, 'y', 24); }
  const stack = new THREE.Group(); g.add(stack); const fixed = new THREE.Group(); g.add(fixed);
  const ph = 0.026, pw = w - 0.08, pd = d * 0.7;
  const hole = (cx, rr) => { const q = new THREE.Path(); q.absarc(cx, 0, rr, 0, Math.PI * 2, true); return q; };
  const pg = new THREE.ExtrudeGeometry(rrShape(pw, pd, 0.012, [hole(-gx, 0.011), hole(gx, 0.011), hole(0, 0.012)]), { depth: ph - 0.006, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 2, curveSegments: 10 });
  pg.rotateX(-Math.PI / 2); pg.translate(0, -(ph - 0.006) / 2, 0);
  const lab = new THREE.PlaneGeometry(0.05, 0.012);
  for (let i = 0; i < plates; i++) {
    const tgt = i >= pin ? stack : fixed, y = 0.11 + i * ph + ph / 2;
    mesh(pg, MAT.stack, tgt, 0, y, 0);
    const L = lab.clone(); const k = (plates - 1 - i) % 16; const U = L.attributes.uv; for (let j = 0; j < U.count; j++) U.setY(j, (16 - k - 1 + U.getY(j)) / 16);
    mesh(L, MAT.label, tgt, pw * 0.25, y, pd / 2 + 0.0025);
  }
  const top = 0.11 + plates * ph;
  box(stack, pw, 0.03, pd, MAT.frame, 0, top + 0.015, 0);
  cyl(stack, 0.009, plates * ph + 0.06, MAT.chrome, 0, 0.11 + plates * ph / 2 + 0.02, 0, 'y', 16); // selector rod through the stack
  cyl(stack, 0.02, 0.05, MAT.steel, 0, top + 0.055, 0, 'y', 24); bolt(stack, V(0, top + 0.08, 0), UP, 0.012);
  // selector pin in plate `pin`
  const py = 0.11 + pin * ph + ph / 2; cyl(stack, 0.005, pd * 0.5 + 0.06, MAT.chrome, 0, py, pd / 4 + 0.03, 'z', 12); // audit: the pin rides with the lifted plates
  mesh(new THREE.SphereGeometry(0.018, 24, 16), MAT.cap, stack, 0, py, pd / 2 + 0.07).scale.set(1, 1, 0.7);
  if (shroud) for (const sx of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(sx * (w / 2 + 0.035), h * 0.47, 0); g.add(sh);
    box(sh, 0.012, h * 0.76, d + 0.04, MAT.shroud, 0, 0, 0, 0.005);
    for (const k of [-1, 1]) box(sh, 0.016, 0.02, d + 0.03, MAT.frame, 0, k * h * 0.37, 0, 0.004);
    for (let i = 0; i < 6; i++) bolt(sh, V(sx * 0.007, -h * 0.3 + i * h * 0.12, -d / 2), V(sx, 0, 0), 0.005);
  }
  return { group: g, top: V(x, h, z), stackTop: () => V(x, top + 0.08 + stack.position.y, z), setLift: m => { stack.position.y = Math.max(0, m); } };
}

// pulley wheel at pos; axis of rotation; V-groove, cheek plates, bolt axle
const PULLEY_GEO = {};
function pulley(p, pos, axis = 'x', r = 0.045) {
  const g = new THREE.Group(); g.position.copy(pos); p.add(g);
  const k = r.toFixed(3);
  if (!PULLEY_GEO[k]) {
    const prof = [[0.012, -0.012], [r * 0.55, -0.012], [r * 0.6, -0.009], [r - 0.003, -0.011], [r, -0.011], [r - 0.008, -0.002], [r - 0.009, 0], [r - 0.008, 0.002], [r, 0.011], [r - 0.003, 0.011], [r * 0.6, 0.009], [r * 0.55, 0.012], [0.012, 0.012]];
    PULLEY_GEO[k] = new THREE.LatheGeometry(prof.map(([a, b]) => new THREE.Vector2(a, b)), 48);
  }
  const wheel = mesh(PULLEY_GEO[k], MAT.frameLight, g);
  const ax = AX[axis];
  wheel.quaternion.setFromUnitVectors(UP, ax);
  for (const s of [-1, 1]) {
    const ch = mesh(rboxGeo(r * 2.5, r * 2.5, 0.006, 0.01, 2), MAT.frame, g); ch.quaternion.setFromUnitVectors(V(0, 0, 1), ax); ch.position.copy(ax).multiplyScalar(s * 0.017);
    bolt(g, ax.clone().multiplyScalar(s * 0.02), ax.clone().multiplyScalar(s), 0.008);
    for (const t of [-1, 1]) { const off = (axis === 'y' ? V(t * r * 0.95, 0, 0) : axis === 'x' ? V(0, t * r * 0.95, 0) : V(t * r * 0.95, 0, 0)); bolt(g, off.clone().addScaledVector(ax, s * 0.02), ax.clone().multiplyScalar(s), 0.005); }
  }
  g.userData.wheel = wheel; return g;
}

// cable drawn through points (in parent space); call update(points)
const CABLE_SEG = new THREE.CylinderGeometry(0.0032, 0.0032, 1, 12, 1, true);
function cableLine(p, n = 4) {
  const segs = [];
  for (let i = 0; i < n; i++) { const o = mesh(CABLE_SEG, MAT.cable, p); o.castShadow = false; segs.push(o); }
  return {
    update(pts) {
      segs.forEach((s, i) => {
        const a = pts[i], b = pts[i + 1];
        if (!a || !b) { s.visible = false; s.scale.set(1e-4, 1e-4, 1e-4); s.position.copy(pts[pts.length - 1]); return; }
        const d = b.clone().sub(a), L = d.length();
        s.visible = L > 1e-4; s.position.copy(a).addScaledVector(d, 0.5);
        s.scale.set(1, Math.max(L, 1e-4), 1); if (L > 1e-4) s.quaternion.setFromUnitVectors(UP, d.normalize());
      });
    },
  };
}
// end hardware for a cable: ball stop, swaged ferrule and a snap hook; origin at the hook's lower end (the clip point), cable leaves along +Y
function cableEnd(p) {
  const g = new THREE.Group(); p.add(g);
  mesh(new THREE.SphereGeometry(0.022, 32, 20), MAT.rubber, g, 0, 0.115, 0);
  cyl(g, 0.006, 0.03, MAT.chrome, 0, 0.085, 0, 'y', 16); cyl(g, 0.0045, 0.03, MAT.chrome, 0, 0.14, 0, 'y', 16);
  const hook = new THREE.TorusGeometry(0.022, 0.0035, 12, 40, Math.PI * 1.6); hook.rotateZ(-Math.PI * 0.3);
  mesh(hook, MAT.chrome, g, 0, 0.045, 0); cyl(g, 0.0028, 0.04, MAT.steel, 0.014, 0.045, 0, 'y', 10).rotation.z = 0.35;
  mesh(new THREE.TorusGeometry(0.008, 0.003, 8, 20), MAT.chrome, g, 0, 0.072, 0);
  return g;
}

function pivot(p, pos, axis = 'x') { const g = new THREE.Group(); g.position.copy(pos.isVector3 ? pos : V(...pos)); g.userData.axis = axis; p.add(g); return g; }
const turn = (g, a) => { g.rotation.set(0, 0, 0); g.rotation[g.userData.axis] = a; };
// pivot hub: bearing housing with bolts
function hub(p, pos, axis = 'x', r = 0.045, w = 0.07) {
  cyl(p, r, w, MAT.frameLight, pos.x, pos.y, pos.z, axis, 48);
  const ax = AX[axis];
  for (const s of [-1, 1]) { cyl(p, r * 0.55, 0.008, MAT.cap, pos.x + ax.x * s * (w / 2 + 0.004), pos.y + ax.y * s * (w / 2 + 0.004), pos.z + ax.z * s * (w / 2 + 0.004), axis, 32); bolt(p, pos.clone().addScaledVector(ax, s * (w / 2 + 0.008)), ax.clone().multiplyScalar(s), 0.01); }
}

// standard seat assembly: seat pad top at seatH; back pad reclined by backTilt (rad), its frame tied into the spine at z = backZ - 0.12
function seatUnit(p, { seatH = 0.48, seatD = 0.38, backTilt = 0.18, backH = 0.62, backZ = -0.2, post = true, seatW = 0.4, spineZ = null } = {}) {
  pad(p, seatW, 0.08, seatD, 0, seatH - 0.04, 0);
  box(p, seatW * 0.6, 0.02, seatD * 0.7, MAT.frame, 0, seatH - 0.09, 0);
  if (post) {
    tube(p, [0, 0.06, 0], [0, seatH - 0.3, 0], 0.08); tube(p, [0, seatH - 0.36, 0], [0, seatH - 0.1, 0], 0.06, MAT.frameLight);
    holes(p, [0, seatH - 0.33, 0.031], [0, seatH - 0.12, 0.031], 6, V(0, 0, 1)); popPin(p, V(0.04, seatH - 0.3, 0), V(1, 0, 0));
    baseRail(p, [-0.28, 0, 0], [0.28, 0, 0], 0.07);
  }
  body(p, 'seat', 'seat', V(0, seatH, 0));
  if (backH > 0) {
    const b = new THREE.Group(); b.position.set(0, seatH + 0.02, backZ); b.rotation.x = -backTilt; p.add(b);
    pad(b, seatW, 0.08, backH, 0, backH / 2 + 0.03, -0.04, [Math.PI / 2, 0, 0]);
    body(b, 'back', 'back', V(0, backH / 2 + 0.03, 0), V(0, 0, 1), V(1, 0, 0));
    tube(b, [0, 0.0, -0.095], [0, backH * 0.85, -0.095], 0.05);
    box(b, seatW * 0.5, backH * 0.6, 0.02, MAT.frame, 0, backH * 0.45, -0.075);
    // brace down to the spine
    const foot = V(0, 0.07, backZ - 0.25);
    const top = V(0, seatH + 0.02, backZ).add(V(0, 0.05, -0.095).applyAxisAngle(V(1, 0, 0), -backTilt));
    tube(p, foot, top, 0.06); levelFoot(p, 0, backZ - 0.25);
    tube(p, [0, 0.07, backZ - 0.25], [0, 0.07, 0], 0.07);
  }
}

// floor foot plate marker pair at z, spacing
function feetOnFloor(p, z = 0.0, x = 0.13, y = 0, toe = V(0, 0, 1)) { foot(p, 'footL', V(x, y, z), toe); foot(p, 'footR', V(-x, y, z), toe); }
// textured foot plate (diamond tread) with feet anchors
function footPlate(p, w, l, pos, rotX = 0, names = ['footL', 'footR'], spread = 0.13, toe = V(0, 0, 1)) {
  const g = new THREE.Group(); g.position.copy(pos); g.rotation.x = rotX; p.add(g);
  box(g, w, 0.02, l, MAT.frame, 0, 0, 0, 0.006); box(g, w - 0.03, 0.004, l - 0.03, MAT.rubber, 0, 0.012, 0, 0.002);
  for (let i = 0; i < Math.floor(l / 0.03); i++) box(g, w - 0.05, 0.003, 0.008, MAT.rubber, 0, 0.0155, -l / 2 + 0.03 + i * 0.03, 0.001);
  foot(g, names[0], V(spread, 0.017, 0), toe); foot(g, names[1], V(-spread, 0.017, 0), toe);
  return g;
}

// ---------------------------------------------------------------- catalogue
const R = {};          // id -> builder(opts) -> {object, dofs, set}
export const CATALOG = []; // {id, name, category, priority, note}
function def(id, name, category, priority, note, fn) { R[id] = fn; CATALOG.push({ id, name, category, priority, note }); }

// helpers for builders
function piece() { const o = new THREE.Group(); return { o, dofs: [], setters: {} }; }
function dof(P, name, label, min, max, value, unit, fn) { P.dofs.push({ name, label, min, max, value, unit }); P.setters[name] = fn; }


// ================================================================= FREE WEIGHTS
// barbell sleeve: grooved chrome lathe along X, starting at x0 going outward (sign s)
function sleeve(p, s, x0, len = 0.415, r = 0.025) {
  const pts = [[r * 0.6, 0], [r, 0]];
  for (const gpos of [0.12, 0.125, 0.28, 0.285]) pts.push([r, gpos * len / 0.415 - 0.0001], [r - 0.0012, gpos * len / 0.415 + 0.0015]);
  pts.push([r, len - 0.004], [r - 0.003, len], [r * 0.5, len]);
  pts.sort((a, b) => a[1] - b[1]);
  const g = new THREE.LatheGeometry(pts.map(([a, b]) => new THREE.Vector2(a, b)), 48); g.rotateZ(-Math.PI / 2 * s);
  mesh(g, MAT.chrome, p, x0, 0, 0);
  bolt(p, V(x0 + s * len, 0, 0), V(s, 0, 0), 0.008);
}
function collar(p, x, r = 0.04, w = 0.03) { // bar collar with bevels
  const pts = [[0.0146, -w / 2], [r - 0.004, -w / 2], [r, -w / 2 + 0.004], [r, w / 2 - 0.004], [r - 0.004, w / 2], [0.0146, w / 2]];
  const g = new THREE.LatheGeometry(pts.map(([a, b]) => new THREE.Vector2(a, b)), 48); g.rotateZ(-Math.PI / 2); mesh(g, MAT.chrome, p, x, 0, 0);
}
function springClip(p, x) { // spring collar clip on a sleeve
  const g = new THREE.TorusGeometry(0.027, 0.003, 8, 40); g.rotateY(Math.PI / 2);
  for (let i = 0; i < 3; i++) mesh(g, MAT.chrome, p, x + i * 0.007, 0, 0);
  for (const s of [-1, 1]) { const h = new THREE.TorusGeometry(0.025, 0.003, 8, 20, Math.PI * 0.8); h.rotateY(Math.PI / 2); const m = mesh(h, MAT.chrome, p, x + 0.008, s * 0.03, 0.02); m.rotation.x = s * 0.4; }
}
def('barbell', 'Olympic barbell 20 kg', 'Free weights', 1, '2.20 m, 28.5 mm shaft with knurl bands and ring marks, grooved sleeves, 20 kg tri-grip plates with spring clips', (o = {}) => {
  const P = piece(); const g = P.o;
  cyl(g, 0.0142, 1.31, MAT.chrome, 0, 0, 0, 'x', 32); // smooth core under the knurl
  knurl(g, 0.0145, 0.16, 0, 0, 0, 'x');
  for (const s of [-1, 1]) { knurl(g, 0.0145, 0.19, s * 0.3, 0, 0, 'x'); knurl(g, 0.0145, 0.22, s * 0.52, 0, 0, 'x'); }
  for (const s of [-1, 1]) {
    collar(g, s * 0.67); cyl(g, 0.032, 0.01, MAT.chrome, s * 0.69, 0, 0, 'x', 40);
    sleeve(g, s, s * 0.695);
  }
  const kg = o.plates ?? [20];
  for (const s of [-1, 1]) { let x = 0.70; for (const k of kg) { const G = PLATE_CACHE[k] || (PLATE_CACHE[k] = plateGeo(k)); x += G.userData.T / 2; plate(g, k, s * x, 0, 0); x += G.userData.T / 2 + 0.002; } if (kg.length) springClip(g, s * (x + 0.004) - (s < 0 ? 0.02 : 0)); }
  const W = o.gripWidth ?? 0.81;
  grip(g, 'gripL', V(W / 2, 0, 0), { radius: 0.0145, length: 0.4, hand: 'L', orient: ['overhand', 'underhand', 'any'] }, V(1, 0, 0), V(0, -1, 0));
  grip(g, 'gripR', V(-W / 2, 0, 0), { radius: 0.0145, length: 0.4, hand: 'R', orient: ['overhand', 'underhand', 'any'] }, V(1, 0, 0), V(0, -1, 0));
  attach(g, 'centre', V()); attach(g, 'sleeveL', V(0.88, 0, 0)); attach(g, 'sleeveR', V(-0.88, 0, 0));
  return P;
});

def('ez-bar', 'EZ curl bar', 'Free weights', 1, '1.2 m cambered bar, knurled angled grips, collars, 10 kg plates', (o = {}) => {
  const P = piece(); const g = P.o;
  const pts = [[-0.33, 0], [-0.27, 0], [-0.21, -0.03], [-0.15, 0.0], [-0.09, -0.03], [-0.04, 0], [0.04, 0], [0.09, -0.03], [0.15, 0], [0.21, -0.03], [0.27, 0], [0.33, 0]].map(([x, z]) => V(x, 0, z));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.25);
  mesh(new THREE.TubeGeometry(curve, 220, 0.0145, 36), MAT.knurl, g);
  for (const s of [-1, 1]) { collar(g, s * 0.345); sleeve(g, s, s * 0.36, 0.23); plate(g, 10, s * 0.4, 0, 0); springClip(g, s * 0.43 - (s < 0 ? 0.02 : 0)); }
  // anchors exactly on the curve (sampled), axis = tangent
  const at = x => { let best = 0, bd = 9; for (let i = 0; i <= 400; i++) { const q = curve.getPointAt(i / 400); const dd = Math.abs(q.x - x); if (dd < bd) { bd = dd; best = i / 400; } } return { pt: curve.getPointAt(best), tan: curve.getTangentAt(best) }; };
  for (const [nm, x, hand] of [['gripL', 0.12, 'L'], ['gripR', -0.12, 'R'], ['gripWideL', 0.24, 'L'], ['gripWideR', -0.24, 'R']]) { const a = at(x); grip(g, nm, a.pt, { radius: 0.0145, length: 0.06, hand, orient: ['underhand', 'overhand'] }, a.tan, V(0, -1, 0)); }
  attach(g, 'centre', V());
  return P;
});

def('trap-bar', 'Trap (hex) bar', 'Free weights', 3, 'hexagonal frame with raised knurled neutral handles, sleeves and plates', () => {
  const P = piece(); const g = P.o;
  const hx = [[0.33, 0.0], [0.17, 0.30], [-0.17, 0.30], [-0.33, 0.0], [-0.17, -0.30], [0.17, -0.30]];
  for (let i = 0; i < 6; i++) { const a = hx[i], b = hx[(i + 1) % 6]; tube(g, [a[0], 0, a[1]], [b[0], 0, b[1]], 0.032, MAT.frame, true, { caps: false }); mesh(new THREE.SphereGeometry(0.019, 24, 16), MAT.frame, g, a[0], 0, a[1]); }
  for (const s of [-1, 1]) {
    collar(g, s * 0.35); sleeve(g, s, s * 0.365, 0.33); plate(g, 20, s * 0.42, 0, 0); springClip(g, s * 0.455 - (s < 0 ? 0.02 : 0));
    for (const k of [-1, 1]) tube(g, [s * 0.24, 0, k * 0.2], [s * 0.24, 0.07, k * 0.12], 0.026, MAT.frame, true);
    knurl(g, 0.0165, 0.24, s * 0.24, 0.07, 0, 'z');
    grip(g, s > 0 ? 'gripL' : 'gripR', V(s * 0.24, 0.07, 0), { radius: 0.0165, length: 0.13, hand: s > 0 ? 'L' : 'R', orient: ['neutral'] }, V(0, 0, 1), V(0, -1, 0));
    for (const k of [-1, 1]) tube(g, [s * 0.24, 0, k * 0.2], [s * 0.3, 0, k * 0.1], 0.026, MAT.frame, true);
  }
  tube(g, [-0.24, 0, -0.2], [-0.17, 0, -0.3], 0.026, MAT.frame, true); tube(g, [0.24, 0, -0.2], [0.17, 0, -0.3], 0.026, MAT.frame, true);
  tube(g, [-0.24, 0, 0.2], [-0.17, 0, 0.3], 0.026, MAT.frame, true); tube(g, [0.24, 0, 0.2], [0.17, 0, 0.3], 0.026, MAT.frame, true);
  attach(g, 'centre', V());
  return P;
});

def('dumbbell', 'Hex dumbbell', 'Free weights', 1, 'rubber hex heads, chrome end caps with weight, knurled contoured handle (opts.kg, default 20)', (o = {}) => {
  const P = piece(); const g = P.o; const kg = o.kg ?? 20;
  const r = 0.055 + Math.cbrt(kg) * 0.012, w = 0.035 + kg * 0.0028;
  // handle: knurl in the middle, smooth chrome shoulders
  knurl(g, 0.016, 0.105, 0, 0, 0, 'x', 0.0022, 120);
  for (const s of [-1, 1]) { const pts = [[0.016, 0], [0.0165, 0.004], [0.019, 0.012], [0.024, 0.016], [0.024, 0.022], [0.0, 0.022]]; const lg = new THREE.LatheGeometry(pts.map(([a, b]) => new THREE.Vector2(a, b)), 48); lg.rotateZ(-Math.PI / 2 * s); mesh(lg, MAT.chrome, g, s * 0.0505, 0, 0); }
  const hex = new THREE.Shape(); for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + Math.PI / 6; const q = [Math.cos(a) * (r - 0.008), Math.sin(a) * (r - 0.008)]; i ? hex.lineTo(...q) : hex.moveTo(...q); } hex.closePath();
  const hg = new THREE.ExtrudeGeometry(hex, { depth: w - 0.016, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 6, curveSegments: 4 }); hg.translate(0, 0, -(w - 0.016) / 2); hg.rotateY(Math.PI / 2);
  for (const s of [-1, 1]) {
    const hx = s * (0.0725 + w / 2);
    mesh(hg, MAT.rubber, g, hx, 0, 0);
    cyl(g, 0.03, 0.006, MAT.chrome, s * (0.0725 + w + 0.003), 0, 0, 'x', 48);
    const lab = new THREE.CircleGeometry(0.026, 48); lab.rotateY(s * Math.PI / 2); mesh(lab, MAT.dbLabel, g, s * (0.0725 + w + 0.0062), 0, 0);
    collar(g, s * 0.068, 0.026, 0.01);
  }
  grip(g, 'grip', V(), { radius: 0.016, length: 0.1, orient: ['any'] }, V(1, 0, 0), V(0, -1, 0));
  attach(g, 'headL', V(0.0725 + w, 0, 0)); attach(g, 'headR', V(-0.0725 - w, 0, 0));
  P.info = { headRadius: r, headWidth: w };
  return P;
});

def('kettlebell', 'Kettlebell 16 kg', 'Free weights', 2, 'cast bell, flat base, handle with horns; origin at handle centre', (o = {}) => {
  const P = piece(); const g = P.o; const s = Math.cbrt((o.kg ?? 16) / 16);
  const R0 = 0.105 * s, cy = -0.115 * s - R0 * 0.62;
  const prof = [new THREE.Vector2(0, -R0 * 0.9), new THREE.Vector2(R0 * 0.55, -R0 * 0.9), new THREE.Vector2(R0 * 0.6, -R0 * 0.88)];
  for (let i = 1; i <= 40; i++) { const a = -Math.PI / 2 + 0.45 + i / 40 * (Math.PI * 0.92); prof.push(new THREE.Vector2(Math.max(0.0, Math.cos(a) * R0), Math.sin(a) * R0)); }
  prof.push(new THREE.Vector2(0, R0 * 0.98));
  mesh(new THREE.LatheGeometry(prof, 96), MAT.plate, g, 0, cy, 0);
  // handle: one tube from the left horn root, up, across, down to the right horn root
  const hr = 0.017, top = 0.0, half = 0.07 * s;
  const curve = new THREE.CatmullRomCurve3([V(half * 0.85, cy + R0 * 0.72, 0), V(half * 1.05, cy + R0 * 1.05, 0), V(half * 1.05, top - 0.05 * s, 0), V(half * 0.7, top, 0), V(0, top, 0), V(-half * 0.7, top, 0), V(-half * 1.05, top - 0.05 * s, 0), V(-half * 1.05, cy + R0 * 1.05, 0), V(-half * 0.85, cy + R0 * 0.72, 0)], false, 'centripetal');
  mesh(new THREE.TubeGeometry(curve, 160, hr, 32), MAT.plate, g);
  const lab = new THREE.CircleGeometry(0.03, 40); mesh(lab, MAT.kbLabel, g, 0, cy, R0 * 0.98).rotation.y = 0;
  grip(g, 'grip', V(0, top, 0), { radius: hr, length: 0.1 * s, orient: ['any'] }, V(1, 0, 0), V(0, -1, 0));
  const hp = t => curve.getPointAt(t), ht = t => curve.getTangentAt(t);
  grip(g, 'hornL', hp(0.2), { radius: hr, length: 0.05, orient: ['neutral'], hand: 'L', note: 'goblet hold on the horn' }, ht(0.2), V(-1, 0, 0));
  grip(g, 'hornR', hp(0.8), { radius: hr, length: 0.05, orient: ['neutral'], hand: 'R', note: 'goblet hold on the horn' }, ht(0.8), V(1, 0, 0));
  return P;
});

def('plate', 'Weight plate 20 kg', 'Free weights', 2, 'tri-grip plate on its own: pinch, front raise, Svend press; grip slots are hand holds', (o = {}) => {
  const P = piece(); const g = P.o; const kg = o.kg ?? 20;
  plate(g, kg, 0, 0, 0, 'z');
  const G = PLATE_CACHE[kg]; const R0 = G.userData.R, T = G.userData.T;
  // hand holds through the tri-grip slots (bar of plate between slot and rim) and the rim
  for (const [nm, a, hand] of [['slotL', Math.PI / 2 + 2 * Math.PI / 3, 'L'], ['slotR', Math.PI / 2 - 2 * Math.PI / 3 + 2 * Math.PI, 'R']]) {
    const rr = R0 * 0.72 + 0.022 + (R0 - 0.004 - (R0 * 0.72 + 0.022)) / 2; const pos = V(Math.cos(a) * rr, Math.sin(a) * rr, 0);
    grip(g, nm, pos, { radius: Math.min(T / 2, 0.025), length: 0.08, gripType: 'pad', hand, orient: ['neutral'], note: 'fingers through the grip slot' }, V(-Math.sin(a), Math.cos(a), 0), V(-Math.cos(a), -Math.sin(a), 0));
  }
  grip(g, 'pinch', V(0, R0 - 0.01, 0), { radius: T / 2, length: 0.1, gripType: 'pad', orient: ['neutral'], note: 'pinch grip on the rim, thumb on one face' }, V(1, 0, 0), V(0, -1, 0));
  grip(g, 'rimL', V(R0 * 0.7, -R0 * 0.7, 0).normalize().multiplyScalar(R0 - 0.01).setX(R0 * 0.69), { radius: T / 2, length: 0.08, gripType: 'pad', hand: 'L', orient: ['neutral'], note: 'hands on the rim at 4 and 8 o\'clock (front raise)' }, V(0.7, 0.7, 0), V(-0.7, 0.7, 0));
  grip(g, 'rimR', V(-R0 * 0.69, -R0 * 0.7, 0), { radius: T / 2, length: 0.08, gripType: 'pad', hand: 'R', orient: ['neutral'] }, V(-0.7, 0.7, 0), V(0.7, 0.7, 0));
  return P;
});

def('medicine-ball', 'Medicine ball', 'Free weights', 4, 'r 0.17 m leather panels with seams; origin at centre', () => {
  const P = piece(); const g = P.o; mesh(new THREE.SphereGeometry(0.17, 96, 64), MAT.ball, g);
  for (const [rx, ry] of [[0, 0], [Math.PI / 2, 0], [0, Math.PI / 2]]) { const t = new THREE.TorusGeometry(0.1705, 0.0025, 8, 160); const m = mesh(t, MAT.piping, g); m.rotation.set(rx, ry, 0); }
  grip(g, 'palmL', V(0.17, 0, 0), { radius: 0.17, gripType: 'pad', hand: 'L' }, V(0, 1, 0), V(-1, 0, 0));
  grip(g, 'palmR', V(-0.17, 0, 0), { radius: 0.17, gripType: 'pad', hand: 'R' }, V(0, 1, 0), V(1, 0, 0));
  return P;
});

def('stability-ball', 'Stability ball 65 cm', 'Free weights', 4, 'origin on floor; ribbed grip texture and valve', () => {
  const P = piece(); const g = P.o; const sg = new THREE.SphereGeometry(0.325, 112, 72); const Pp = sg.attributes.position;
  for (let i = 0; i < Pp.count; i++) { const v = V(Pp.getX(i), Pp.getY(i), Pp.getZ(i)); const lat = Math.asin(v.y / 0.325); v.multiplyScalar(1 + 0.002 * Math.cos(lat * 60)); Pp.setXYZ(i, v.x, v.y, v.z); }
  sg.computeVertexNormals(); const b = mesh(sg, MAT.ball, g, 0, 0.325, 0); b.scale.set(1, 0.97, 1);
  cyl(g, 0.01, 0.006, MAT.cap, 0.325, 0.32, 0, 'x', 24);
  body(g, 'top', 'back', V(0, 0.64, 0)); return P;
});

def('foam-roller', 'Foam roller', 'Free weights', 5, '90 cm x 15 cm, grid-textured EVA foam', () => {
  const P = piece(); const g = P.o; const cg = new THREE.CylinderGeometry(0.075, 0.075, 0.9, 128, 90, false); const Pp = cg.attributes.position;
  for (let i = 0; i < Pp.count; i++) { const x = Pp.getX(i), y = Pp.getY(i), z = Pp.getZ(i); const rr = Math.hypot(x, z); if (rr < 0.07) continue; const a = Math.atan2(z, x); const bump = (Math.sin(a * 16) > 0.2 && Math.sin(y * 70) > 0.2) ? 0.004 : 0; Pp.setX(i, Math.cos(a) * (0.075 + bump)); Pp.setZ(i, Math.sin(a) * (0.075 + bump)); }
  cg.computeVertexNormals(); cg.rotateZ(-Math.PI / 2); mesh(cg, MAT.foam, g, 0, 0.079, 0);
  body(g, 'top', 'back', V(0, 0.155, 0)); return P;
});

def('dowel', 'Dowel / broomstick', 'Free weights', 5, '1.5 m wooden stick with rubber end caps', () => {
  const P = piece(); const g = P.o; const cg = new THREE.CylinderGeometry(0.014, 0.014, 1.5, 48, 120); const Pp = cg.attributes.position;
  for (let i = 0; i < Pp.count; i++) { const x = Pp.getX(i), y = Pp.getY(i), z = Pp.getZ(i); const a = Math.atan2(z, x); const rr = 0.014 + 0.0002 * Math.sin(a * 3 + y * 40); if (Math.hypot(x, z) > 0.001) { Pp.setX(i, Math.cos(a) * rr); Pp.setZ(i, Math.sin(a) * rr); } }
  cg.computeVertexNormals(); cg.rotateZ(-Math.PI / 2); mesh(cg, MAT.wood, g);
  for (const s of [-1, 1]) cyl(g, 0.0165, 0.03, MAT.rubber, s * 0.75, 0, 0, 'x', 32);
  grip(g, 'gripL', V(0.6, 0, 0), { radius: 0.014, length: 0.15, hand: 'L', orient: ['overhand'] }, V(1, 0, 0), V(0, -1, 0));
  grip(g, 'gripR', V(-0.6, 0, 0), { radius: 0.014, length: 0.15, hand: 'R', orient: ['overhand'] }, V(1, 0, 0), V(0, -1, 0));
  return P;
});

function flatBand(p, curve, w = 0.04, t = 0.004, segs = 300, closed = false, m = MAT.band) {
  const g = new THREE.TubeGeometry(curve, segs, 1, 24, closed); const P = g.attributes.position;
  // squash the round tube into a flat band: project each ring onto its binormal/normal frame
  const fr = curve.computeFrenetFrames(segs, closed);
  for (let i = 0; i <= segs; i++) { const c = curve.getPointAt(i / segs); const N = fr.normals[i % (closed ? segs : segs + 1)] || fr.normals[segs - 1], B = fr.binormals[i % (closed ? segs : segs + 1)] || fr.binormals[segs - 1];
    for (let j = 0; j <= 24; j++) { const k = i * 25 + j; const v = V(P.getX(k), P.getY(k), P.getZ(k)).sub(c); const a = v.dot(N), b = v.dot(B); const q = c.clone().addScaledVector(N, a * t / 2).addScaledVector(B, b * w / 2); P.setXYZ(k, q.x, q.y, q.z); } }
  g.computeVertexNormals(); return mesh(g, m, p);
}

def('band-loop', 'Resistance band loop', 'Bands & straps', 3, '1.04 m flat latex loop, 41 mm wide; dof stretch', () => {
  const P = piece(); const g = P.o; const holder = new THREE.Group(); g.add(holder);
  const eA = attach(g, 'endA', V(0.16, 0, 0)), eB = attach(g, 'endB', V(-0.16, 0, 0));
  const build = v => { holder.clear(); const pts = []; for (let i = 0; i < 64; i++) { const a = i / 64 * Math.PI * 2; pts.push(V(Math.cos(a) * 0.165 * v, 0, Math.sin(a) * 0.165 / v * 0.5)); }
    flatBand(holder, new THREE.CatmullRomCurve3(pts, true), 0.041, 0.0045, 300, true).rotation.x = 0; eA.position.x = 0.165 * v; eB.position.x = -0.165 * v; };
  dof(P, 'stretch', 'Stretch', 1, 2.2, 1, 'x', build); build(1); return P;
});

function tubeHandle(p, name, hand) { // nylon strap loop with a foam grip
  const h = new THREE.Group(); p.add(h);
  hgrip(h, 0.016, 0.13, 0, 0, 0, 'x');
  flatBand(h, new THREE.CatmullRomCurve3([V(-0.07, 0, 0), V(-0.075, 0.05, 0), V(-0.03, 0.1, 0), V(0, 0.11, 0), V(0.03, 0.1, 0), V(0.075, 0.05, 0), V(0.07, 0, 0)]), 0.025, 0.002, 80, false, MAT.strap);
  mesh(new THREE.TorusGeometry(0.012, 0.003, 8, 24), MAT.steel, h, 0, 0.115, 0);
  grip(h, name, V(), { radius: 0.016, length: 0.11, hand, gripType: 'cylinder' }, V(1, 0, 0), V(0, -1, 0));
  return h;
}
def('band-tube', 'Tube band with handles', 'Bands & straps', 3, 'latex tube through a door anchor; handles stretch with motion', () => {
  const P = piece(); const g = P.o;
  const anc = new THREE.Group(); g.add(anc); cyl(anc, 0.035, 0.09, MAT.foam, 0, 0, -0.04, 'x', 40); flatBand(anc, new THREE.CatmullRomCurve3([V(0, 0, -0.03), V(0, 0, 0.02), V(0, 0.01, 0.05)]), 0.025, 0.002, 30, false, MAT.strap);
  attach(g, 'anchor', V());
  const hL = tubeHandle(g, 'gripL', 'L'), hR = tubeHandle(g, 'gripR', 'R'); const tubes = new THREE.Group(); g.add(tubes);
  const setPull = v => { const d = 0.5 + v * 0.6; hL.position.set(0.25, 0, d); hR.position.set(-0.25, 0, d); hL.lookAt(0, 0, 0); hR.lookAt(0, 0, 0); hL.rotateX(Math.PI / 2); hR.rotateX(Math.PI / 2);
    tubes.clear(); for (const h of [hL, hR]) { const e = h.localToWorld(V(0, 0.115, 0)); g.worldToLocal(e); mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(0, 0, 0.02), V(e.x * 0.3, -0.01, e.z * 0.3 + 0.02), V(e.x * 0.7, -0.008, e.z * 0.7), e]), 120, 0.006, 12), MAT.band, tubes); } };
  dof(P, 'motion', 'Stretch', 0, 1, 0, '', setPull); g.updateMatrixWorld(true); setPull(0);
  return P;
});

def('jump-rope', 'Jump rope', 'Bands & straps', 4, 'bearing handles and coated cable; rope swings with motion', () => {
  const P = piece(); const g = P.o;
  const hs = [];
  for (const s of [-1, 1]) {
    const hg = new THREE.Group(); g.add(hg); hs.push(hg);
    const prof = [[0, -0.075], [0.013, -0.075], [0.0145, -0.07]]; for (let i = 0; i <= 24; i++) { const t = i / 24; prof.push([0.0145 + 0.0012 * Math.sin(t * Math.PI) + 0.0006 * Math.cos(t * 60), -0.07 + t * 0.13]); } prof.push([0.017, 0.062], [0.017, 0.075], [0.008, 0.08], [0, 0.08]);
    mesh(new THREE.LatheGeometry(prof.map(([a, b]) => new THREE.Vector2(a, b)), 48), MAT.rubber, hg, s * 0.25, 0, 0);
    cyl(hg, 0.006, 0.02, MAT.chrome, s * 0.25, 0.088, 0, 'y', 16);
    grip(hg, s > 0 ? 'gripL' : 'gripR', V(s * 0.25, 0, 0), { radius: 0.0155, length: 0.12, hand: s > 0 ? 'L' : 'R', orient: ['neutral'] }, V(0, 1, 0), V(-s, 0, 0));
  }
  const rope = new THREE.Group(); rope.position.y = 0.095; g.add(rope); const wrist = v => V(0, 0.035 * Math.sin(v * Math.PI * 2), 0.035 * Math.cos(v * Math.PI * 2) - 0.035);
  const curve = new THREE.CatmullRomCurve3([V(0.25, 0, 0), V(0.32, -0.6, 0), V(0, -1.12, 0), V(-0.32, -0.6, 0), V(-0.25, 0, 0)]);
  mesh(new THREE.TubeGeometry(curve, 300, 0.0025, 12), MAT.cable, rope);
  dof(P, 'motion', 'Swing', 0, 1, 0, '', v => { rope.rotation.x = v * Math.PI * 2; const w = wrist(v); hs.forEach(h => h.position.copy(w)); rope.position.set(0, 0.095, 0).add(w); });
  return P;
});

def('sliders', 'Core sliders (pair)', 'Bands & straps', 5, 'domed discs with fabric tops', () => {
  const P = piece(); const g = P.o;
  const prof = [[0, 0], [0.085, 0], [0.09, 0.003], [0.091, 0.008], [0.088, 0.012]]; for (let i = 0; i <= 12; i++) prof.push([0.085 * (1 - i / 12), 0.012 + 0.003 * Math.sin((1 - i / 12) * Math.PI / 2)]);
  const lg = new THREE.LatheGeometry(prof.map(([a, b]) => new THREE.Vector2(a, b)), 128);
  for (const s of [-1, 1]) { mesh(lg, MAT.shroud, g, s * 0.15, 0, 0); const top = new THREE.CircleGeometry(0.075, 96); top.rotateX(-Math.PI / 2); mesh(top, MAT.fabric, g, s * 0.15, 0.0152, 0); mesh(new THREE.TorusGeometry(0.076, 0.002, 6, 96), MAT.piping, g, s * 0.15, 0.0152, 0).rotation.x = Math.PI / 2;
    foot(g, s > 0 ? 'footL' : 'footR', V(s * 0.15, 0.016, -0.03)); }
  return P;
});

def('towel', 'Towel', 'Bands & straps', 5, 'gym towel; rolled ends act as two handles', () => {
  const P = piece(); const g = P.o;
  const pg = new THREE.PlaneGeometry(0.62, 0.3, 140, 60); const Pp = pg.attributes.position;
  for (let i = 0; i < Pp.count; i++) { const x = Pp.getX(i), y = Pp.getY(i); Pp.setZ(i, 0.004 * Math.sin(x * 40 + y * 9) + 0.002 * Math.sin(y * 60)); }
  pg.computeVertexNormals(); pg.rotateX(-Math.PI / 2); const m = mesh(pg, MAT.fabric, g); m.material = MAT.fabric; m.scale.set(1, 1, 0.4);
  for (const s of [-1, 1]) {
    const pts = []; for (let i = 0; i <= 80; i++) { const a = i / 80 * Math.PI * 6; const r = 0.008 + i / 80 * 0.012; pts.push(V(s * (0.31 + Math.cos(a) * r * 0.2), Math.sin(a) * r, -0.06 + i / 80 * 0.12)); }
    cyl(g, 0.02, 0.13, MAT.fabric, s * 0.35, 0, 0, 'z', 48);
    mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 200, 0.003, 6), MAT.fabric, g);
    grip(g, s > 0 ? 'gripL' : 'gripR', V(s * 0.35, 0, 0), { radius: 0.02, length: 0.12, gripType: 'rope', hand: s > 0 ? 'L' : 'R' }, V(0, 0, 1), V(0, -1, 0));
  }
  return P;
});

def('backpack', 'Loaded backpack', 'Free weights', 5, 'padded pack with straps; top haul loop is the grip', () => {
  const P = piece(); const g = P.o;
  mesh(cushionGeo(0.3, 0.17, 0.44, 0.02, 0.01), MAT.fabric, g, 0, 0.23, 0).rotation.x = Math.PI / 2;
  mesh(cushionGeo(0.24, 0.05, 0.2, 0.01, 0.01), MAT.fabric, g, 0, 0.17, 0.095).rotation.x = Math.PI / 2; // front pocket
  mesh(new THREE.TorusGeometry(0.13, 0.003, 6, 120, Math.PI), MAT.chrome, g, 0, 0.3, 0.087); // zip
  for (const s of [-1, 1]) flatBand(g, new THREE.CatmullRomCurve3([V(s * 0.08, 0.42, -0.08), V(s * 0.1, 0.38, -0.13), V(s * 0.11, 0.2, -0.13), V(s * 0.1, 0.05, -0.1), V(s * 0.09, 0.03, -0.08)]), 0.05, 0.01, 80, false, MAT.strap);
  flatBand(g, new THREE.CatmullRomCurve3([V(-0.04, 0.44, -0.02), V(-0.03, 0.49, -0.02), V(0, 0.5, -0.02), V(0.03, 0.49, -0.02), V(0.04, 0.44, -0.02)]), 0.025, 0.004, 60, false, MAT.strap);
  grip(g, 'grip', V(0, 0.495, -0.02), { radius: 0.008, length: 0.06, gripType: 'strap' }, V(1, 0, 0), V(0, -1, 0));
  return P;
});

def('wrist-roller', 'Wrist roller', 'Free weights', 5, 'knurled roller, cord winds up with motion, 5 kg plate', () => {
  const P = piece(); const g = P.o;
  knurl(g, 0.019, 0.17, 0.12, 0, 0, 'x'); knurl(g, 0.019, 0.17, -0.12, 0, 0, 'x'); cyl(g, 0.021, 0.07, MAT.chrome, 0, 0, 0, 'x', 40);
  for (const s of [-1, 1]) cyl(g, 0.024, 0.012, MAT.cap, s * 0.21, 0, 0, 'x', 32);
  grip(g, 'gripL', V(0.12, 0, 0), { radius: 0.019, length: 0.15, hand: 'L', orient: ['overhand'] }, V(1, 0, 0), V(0, -1, 0));
  grip(g, 'gripR', V(-0.12, 0, 0), { radius: 0.019, length: 0.15, hand: 'R', orient: ['overhand'] }, V(1, 0, 0), V(0, -1, 0));
  const ropeG = new THREE.Group(); g.add(ropeG); const pl = new THREE.Group(); g.add(pl); plate(pl, 5, 0, 0, 0, 'z'); cyl(pl, 0.012, 0.06, MAT.chrome, 0, 0, 0, 'z', 16);
  const set = v => { ropeG.clear(); const L = 0.9 * (1 - v) + 0.05; const turns = 2 + v * 14; const pts = [];
    for (let i = 0; i <= turns * 12; i++) { const a = i / 12 * Math.PI * 2; pts.push(V(-0.02 + i / (turns * 12) * 0.04, Math.cos(a) * 0.024, Math.sin(a) * 0.024)); }
    pts.push(V(0.02, -0.03, 0), V(0, -L / 2, 0), V(0, -L, 0));
    mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 400, 0.003, 8), MAT.rope, ropeG); pl.position.y = -L - 0.12; };
  dof(P, 'motion', 'Roll up', 0, 1, 0, '', set); set(0); return P;
});

def('battle-ropes', 'Battle ropes', 'Free weights', 4, '15 m rope looped round a floor anchor 7.5 m away; heat-shrink handle ends; motion makes waves', () => {
  const P = piece(); const g = P.o; const D = 7.5;
  box(g, 0.3, 0.02, 0.3, MAT.frame, 0, 0.01, -D); tube(g, [0, 0.02, -D], [0, 0.2, -D], 0.05, MAT.frame, true); mesh(new THREE.TorusGeometry(0.05, 0.012, 12, 40), MAT.steel, g, 0, 0.22, -D);
  attach(g, 'anchor', V(0, 0.2, -D));
  const ropes = [];
  for (const s of [-1, 1]) {
    const r = new THREE.Group(); g.add(r); const end = new THREE.Group(); g.add(end);
    cyl(end, 0.021, 0.22, MAT.rubber, 0, 0, 0, 'z', 40); cyl(end, 0.022, 0.02, MAT.cap, 0, 0, 0.11, 'z', 40);
    grip(end, s > 0 ? 'gripL' : 'gripR', V(0, 0, 0.0), { radius: 0.021, length: 0.18, gripType: 'rope', hand: s > 0 ? 'L' : 'R', orient: ['neutral', 'overhand'] }, V(0, 0, 1), V(-s, 0, 0));
    ropes.push([r, end, s]);
  }
  const build = ph => {
    for (const [r, end, s] of ropes) {
      r.clear(); const pts = []; const N = 60;
      for (let i = 0; i <= N; i++) { const t = i / N; const amp = 0.16 * (1 - t); pts.push(V(s * (0.22 * (1 - t) + 0.05 * t), 0.85 * Math.pow(1 - t, 3) + 0.04 + amp * Math.cos(t * 22 - ph * Math.PI * 2 - (s > 0 ? 0 : Math.PI)), -0.1 - (D - 0.15) * t)); }
      pts[N].set(s * 0.05, 0.22, -D);
      const c = new THREE.CatmullRomCurve3(pts); mesh(new THREE.TubeGeometry(c, 360, 0.019, 12), MAT.rope, r);
      end.position.copy(pts[0]).add(V(0, 0, 0.1)); const tng = c.getTangentAt(0).negate(); end.quaternion.setFromUnitVectors(V(0, 0, 1), tng);
    }
  };
  dof(P, 'motion', 'Wave', 0, 1, 0, '', build); build(0); return P;
});

def('trx', 'Suspension trainer (TRX)', 'Bands & straps', 4, 'anchor 2.4 m high, webbing straps, cam buckles, handles with foot cradles; length dof', () => {
  const P = piece(); const g = P.o;
  attach(g, 'anchor', V(0, 2.4, 0)); mesh(new THREE.TorusGeometry(0.03, 0.006, 12, 40), MAT.steel, g, 0, 2.42, 0);
  const strapG = new THREE.Group(); g.add(strapG);
  const hs = [];
  for (const s of [-1, 1]) {
    const h = new THREE.Group(); g.add(h); hs.push([h, s]);
    hgrip(h, 0.016, 0.13, 0, 0, 0, 'x');
    flatBand(h, new THREE.CatmullRomCurve3([V(-0.07, 0, 0), V(-0.06, 0.07, 0), V(0, 0.12, 0), V(0.06, 0.07, 0), V(0.07, 0, 0)]), 0.025, 0.002, 60, false, MAT.strap);
    flatBand(h, new THREE.CatmullRomCurve3([V(-0.06, -0.01, 0), V(-0.05, -0.1, 0.02), V(0, -0.14, 0.03), V(0.05, -0.1, 0.02), V(0.06, -0.01, 0)]), 0.035, 0.003, 60, false, MAT.foam);
    grip(h, s > 0 ? 'gripL' : 'gripR', V(), { radius: 0.016, length: 0.11, hand: s > 0 ? 'L' : 'R' }, V(1, 0, 0), V(0, -1, 0));
    foot(h, s > 0 ? 'cradleL' : 'cradleR', V(0, -0.14, 0.03), V(0, 0, 1), V(0, 1, 0));
  }
  const set = v => {
    const y = 2.4 - (1.3 + v * 0.7); strapG.clear();
    hs[0][0].position.set(0.12, y, 0.25); hs[1][0].position.set(-0.12, y, 0.25);
    const mid = V(0, y + 0.7, 0.12);
    flatBand(strapG, new THREE.CatmullRomCurve3([V(0, 2.4, 0), V(0, (2.4 + mid.y) / 2, 0.06), mid]), 0.038, 0.003, 120, false, MAT.strap);
    box(strapG, 0.05, 0.08, 0.02, MAT.cap, 0, mid.y + 0.25, 0.08);
    for (const [h, s] of hs) { flatBand(strapG, new THREE.CatmullRomCurve3([mid, mid.clone().lerp(h.position, 0.5).add(V(s * 0.01, 0, 0)), h.position.clone().add(V(0, 0.12, 0))]), 0.03, 0.003, 80, false, MAT.strap); box(strapG, 0.045, 0.07, 0.018, MAT.cap, ...mid.clone().lerp(h.position, 0.45).toArray()); }
  };
  dof(P, 'length', 'Strap length', 0, 1, 0.5, '', set); set(0.5); return P;
});

def('sled', 'Push/pull sled', 'Free weights', 4, 'skids, plate post, tall push posts with handles, pull strap; travel dof', () => {
  const P = piece(); const g = P.o; const s = new THREE.Group(); g.add(s);
  for (const k of [-1, 1]) { bent(s, [V(k * 0.3, 0.032, -0.55), V(k * 0.3, 0.032, 0.4), V(k * 0.3, 0.05, 0.55), V(k * 0.3, 0.12, 0.62)], 0.05); }
  box(s, 0.66, 0.012, 0.95, MAT.frame, 0, 0.06, -0.05, 0.004);
  for (const z of [-0.45, 0.0, 0.4]) tube(s, [-0.3, 0.045, z], [0.3, 0.045, z], 0.04);
  tube(s, [0, 0.07, -0.2], [0, 0.4, -0.2], 0.05, MAT.chrome, true); plate(s, 20, 0, 0.1, -0.2, 'y'); plate(s, 20, 0, 0.155, -0.2, 'y');
  for (const k of [-1, 1]) {
    tube(s, [k * 0.25, 0.06, 0.3], [k * 0.25, 1.15, 0.48], 0.045, MAT.frame, true);
    tube(s, [k * 0.25, 0.06, 0.05], [k * 0.25, 0.7, 0.36], 0.035, MAT.frame, true);
    const ax = V(0, 1.09, 0.18).normalize();
    hgrip(s, 0.022, 0.3, k * 0.25, 0.98, 0.4519, 'y').quaternion.setFromUnitVectors(UP, ax);
    grip(s, k > 0 ? 'gripL' : 'gripR', V(k * 0.25, 0.98, 0.4519), { radius: 0.022, length: 0.26, hand: k > 0 ? 'L' : 'R', orient: ['neutral'] }, ax, V(0, 0, -1));
  }
  box(s, 0.05, 0.1, 0.012, MAT.frame, 0, 0.1, -0.548, 0.003); bolt(s, V(0, 0.08, -0.554), V(0, 0, -1), 0.006);
  mesh(new THREE.TorusGeometry(0.03, 0.008, 10, 30), MAT.steel, s, 0, 0.12, -0.56);
  attach(s, 'strap', V(0, 0.12, -0.58));
  dof(P, 'motion', 'Travel', 0, 1, 0, '', v => { s.position.z = -v * 1.5; });
  return P;
});

def('floor-mat', 'Exercise mat', 'Benches & stations', 2, 'bodyweight work; 1.8 x 0.6 m, 15 mm foam', () => {
  const P = piece(); const g = P.o; mesh(cushionGeo(0.6, 0.015, 1.8, 0.0, 0.012, 0.006), MAT.foam, g, 0, 0.0075, 0);
  body(g, 'surface', 'back', V(0, 0.015, 0)); feetOnFloor(g, 0.6, 0.13, 0.015);
  return P;
});

def('plyo-box', 'Plyo box (soft)', 'Benches & stations', 3, '50/60/75 cm foam box with vinyl cover and grippy top (opts.h)', (o = {}) => {
  const P = piece(); const g = P.o; const h = o.h ?? 0.6;
  mesh(cushionGeo(0.6, h, 0.5, 0.0, 0.015, 0.03), MAT.pad, g, 0, h / 2, 0);
  mesh(cushionGeo(0.56, 0.006, 0.46, 0, 0.02, 0.003), MAT.rubber, g, 0, h + 0.002, 0);
  for (const k of [-1, 1]) { const pgeo = piping(0.598, 0.498, 0, 0.003, 0.03); mesh(pgeo, MAT.piping, g, 0, h / 2 + k * (h / 2 - 0.02), 0); }
  feetOnFloor(g, 0, 0.13, h + 0.008); body(g, 'top', 'seat', V(0, h + 0.008, 0));
  return P;
});

// ================================================================= BENCHES & STATIONS
function flatBenchInto(g, len = 1.2, top = 0.43) {
  pad(g, 0.29, 0.075, len, 0, top - 0.0375, 0);
  tube(g, [0, top - 0.095, -len / 2 + 0.08], [0, top - 0.095, len / 2 - 0.08], 0.05);
  box(g, 0.2, 0.012, len - 0.1, MAT.frame, 0, top - 0.069, 0, 0.004);
  for (const z of [-len / 2 + 0.12, len / 2 - 0.12]) {
    tube(g, [0, 0.07, z], [0, top - 0.12, z], 0.07);
    baseRail(g, [-0.22, 0, z], [0.22, 0, z], 0.07);
    box(g, 0.12, 0.012, 0.12, MAT.frame, 0, top - 0.115, z, 0.003);
    for (const x of [-0.04, 0.04]) for (const zz of [-0.04, 0.04]) bolt(g, V(x, top - 0.108, z + zz), UP, 0.006);
  }
  tube(g, [0, 0.12, -len / 2 + 0.12], [0, 0.12, len / 2 - 0.12], 0.06);
  // transport wheels and handle
  for (const s of [-1, 1]) cyl(g, 0.04, 0.03, MAT.rubber, s * 0.25, 0.04, len / 2 - 0.12 + 0.07, 'x', 40);
  tube(g, [0, top - 0.12, -len / 2 + 0.12], [0, top - 0.02, -len / 2 - 0.06], 0.035, MAT.frame, true);
  hgrip(g, 0.016, 0.14, 0, top - 0.02, -len / 2 - 0.06, 'x');
}

def('flat-bench', 'Flat bench', 'Benches & stations', 1, 'stitched vinyl pad, top 0.43 m, length along Z (head at -Z), wheels and handle', () => {
  const P = piece(); const g = P.o; flatBenchInto(g);
  body(g, 'pad', 'back', V(0, 0.43, 0)); body(g, 'seat', 'seat', V(0, 0.43, 0.35)); body(g, 'head', 'back', V(0, 0.43, -0.45));
  feetOnFloor(g, 0.55, 0.3);
  return P;
});

def('adjustable-bench', 'Adjustable bench (FID)', 'Benches & stations', 1, 'back angle -20 to 85 deg on a ladder, adjustable seat; seat at +Z, back pivots at z=0', () => {
  const P = piece(); const g = P.o; const top = 0.45;
  tube(g, [0, 0.07, -0.62], [0, 0.07, 0.55], 0.08); baseRail(g, [-0.23, 0, -0.62], [0.23, 0, -0.62], 0.07); baseRail(g, [-0.23, 0, 0.55], [0.23, 0, 0.55], 0.07);
  tube(g, [0, 0.07, 0.02], [0, top - 0.1, 0.02], 0.08); tube(g, [0, 0.07, 0.38], [0, top - 0.11, 0.28], 0.06);
  hub(g, V(0, top - 0.06, 0.0), 'x', 0.03, 0.1);
  // ladder adjuster on the spine
  for (let i = 0; i < 7; i++) box(g, 0.1, 0.03, 0.02, MAT.frame, 0, 0.11, -0.52 + i * 0.06, 0.004);
  tube(g, [-0.05, 0.11, -0.56], [-0.05, 0.11, -0.12], 0.02, MAT.frame); tube(g, [0.05, 0.11, -0.56], [0.05, 0.11, -0.12], 0.02, MAT.frame);
  for (const s of [-1, 1]) cyl(g, 0.045, 0.03, MAT.rubber, s * 0.27, 0.045, 0.62, 'x', 40);
  tube(g, [0, 0.07, -0.62], [0, 0.25, -0.75], 0.04, MAT.frame, true); hgrip(g, 0.017, 0.2, 0, 0.25, -0.75, 'x');
  const seat = pivot(g, V(0, top - 0.04, 0.02), 'x');
  pad(seat, 0.3, 0.075, 0.36, 0, 0.0, 0.2); box(seat, 0.18, 0.02, 0.3, MAT.frame, 0, -0.045, 0.2); body(seat, 'seat', 'seat', V(0, 0.04, 0.18));
  const back = pivot(g, V(0, top - 0.04, 0.0), 'x');
  pad(back, 0.29, 0.075, 0.82, 0, 0, -0.43); tube(back, [0, -0.06, -0.02], [0, -0.06, -0.8], 0.05); box(back, 0.2, 0.012, 0.76, MAT.frame, 0, -0.044, -0.43, 0.004);
  body(back, 'back', 'back', V(0, 0.04, -0.4)); body(back, 'head', 'back', V(0, 0.04, -0.72));
  const strut = new THREE.Group(); g.add(strut); tube(strut, [0, 0, 0], [0, 1, 0], 0.045, MAT.frameLight, false, { bolts: false }); cyl(strut, 0.012, 0.09, MAT.chrome, 0, 1, 0, 'x', 16);
  feetOnFloor(g, 0.6, 0.28);
  const set = deg => {
    const a = THREE.MathUtils.degToRad(deg); turn(back, a);
    turn(seat, deg > 10 ? -THREE.MathUtils.degToRad(Math.min(15, deg / 4)) : 0);
    const tip = V(0, -0.06, -0.45).applyAxisAngle(V(1, 0, 0), a).add(back.position);
    const A = V(0, 0.11, -0.52 + Math.round(Math.max(0, Math.min(6, (deg + 20) / 105 * 6))) * 0.06), d = tip.clone().sub(A);
    strut.position.copy(A); strut.scale.set(1, d.length(), 1); strut.quaternion.setFromUnitVectors(UP, d.normalize());
  };
  dof(P, 'angle', 'Back angle', -20, 85, 30, 'deg', set); set(30);
  return P;
});

def('decline-bench', 'Decline / sit-up bench', 'Benches & stations', 2, 'fixed -20 deg pad, knee pad and ankle rollers at +Z', () => {
  const P = piece(); const g = P.o;
  const b = new THREE.Group(); b.position.set(0, 0.62, 0.15); b.rotation.x = THREE.MathUtils.degToRad(-20); g.add(b);
  pad(b, 0.3, 0.075, 1.3, 0, 0, -0.55); tube(b, [0, -0.07, -1.1], [0, -0.07, -0.02], 0.05); body(b, 'back', 'back', V(0, 0.04, -0.6)); body(b, 'seat', 'seat', V(0, 0.04, -0.1));
  tube(g, [0, 0.07, -0.95], [0, 0.07, 0.62], 0.08); baseRail(g, [-0.24, 0, -0.95], [0.24, 0, -0.95], 0.07); baseRail(g, [-0.24, 0, 0.62], [0.24, 0, 0.62], 0.07);
  tube(g, [0, 0.07, -0.72], [0, 0.32, -0.72], 0.06); tube(g, [0, 0.07, 0.15], [0, 0.56, 0.15], 0.08);
  tube(g, [0, 0.56, 0.15], [0, 0.76, 0.5], 0.06); holes(g, [0, 0.62, 0.27], [0, 0.72, 0.44], 4, V(1, 0, 0)); popPin(g, V(0.035, 0.66, 0.34), V(1, 0, 0));
  roller(g, 0.38, 0, 0.8, 0.47); roller(g, 0.38, 0, 0.66, 0.58);
  body(g, 'ankle', 'ankle', V(0, 0.75, 0.47), V(0, 0, -1)); body(g, 'shin', 'shin', V(0, 0.71, 0.58), V(0, 0, -1));
  return P;
});

def('preacher-bench', 'Preacher curl bench', 'Benches & stations', 2, 'adjustable seat, 45 deg arm pad, J-hook bar rests', () => {
  const P = piece(); const g = P.o;
  seatUnit(g, { seatH: 0.6, backH: 0, seatD: 0.32 });
  tube(g, [0, 0.07, 0.0], [0, 0.07, 0.42], 0.08); baseRail(g, [-0.32, 0, 0.42], [0.32, 0, 0.42], 0.07);
  tube(g, [0, 0.07, 0.42], [0, 0.07, 0.30], 0.08); tube(g, [0, 0.07, 0.30], [0, 0.78, 0.30], 0.08); // audit: post sits under the pad, clear of the forearms
  const p2 = new THREE.Group(); p2.position.set(0, 0.889, 0.288); p2.rotation.x = Math.PI / 4; g.add(p2); // audit: slopes DOWN away from the lifter (armpits on the top edge, elbows at the low end)
  pad(p2, 0.52, 0.075, 0.28, 0, 0, 0.0); box(p2, 0.3, 0.02, 0.25, MAT.frame, 0, -0.045, 0.02);
  body(p2, 'arms', 'upperArm', V(0, 0.04, 0), V(0, 1, 0));
  body(p2, 'elbowL', 'elbow', V(0.14, 0.04, 0.13)); body(p2, 'elbowR', 'elbow', V(-0.14, 0.04, 0.13));
  tube(g, [0, 0.78, 0.30], [0, 0.84, 0.29], 0.08);
  // bar rests: arms from the post out and forward to J-hooks
  tube(g, [-0.3, 0.5, 0.48], [0.3, 0.5, 0.48], 0.05);
  tube(g, [0, 0.5, 0.30], [0, 0.5, 0.48], 0.05);
  for (const x of [-0.3, 0.3]) { tube(g, [x, 0.5, 0.48], [x, 0.62, 0.6], 0.04); box(g, 0.05, 0.06, 0.04, MAT.frame, x, 0.64, 0.62, 0.006); box(g, 0.04, 0.012, 0.035, MAT.rubber, x, 0.67, 0.62, 0.003); }
  attach(g, 'barRest', V(0, 0.68, 0.62)); feetOnFloor(g, 0.25);
  return P;
});

def('roman-chair', '45-degree back extension (Roman chair)', 'Benches & stations', 2, 'split hip pads, tread foot plate, ankle rollers, side handles', () => {
  const P = piece(); const g = P.o;
  tube(g, [0, 0.07, -0.55], [0, 0.07, 0.78], 0.08); baseRail(g, [-0.3, 0, -0.55], [0.3, 0, -0.55], 0.07); baseRail(g, [-0.3, 0, 0.78], [0.3, 0, 0.78], 0.07);
  tube(g, [0, 0.07, -0.4], [0, 0.95, 0.1], 0.08);
  const hp = new THREE.Group(); hp.position.set(0, 0.99, 0.12); hp.rotation.x = Math.PI / 4; g.add(hp);
  pad(hp, 0.19, 0.075, 0.3, 0.11, 0, 0); pad(hp, 0.19, 0.075, 0.3, -0.11, 0, 0); box(hp, 0.4, 0.02, 0.2, MAT.frame, 0, -0.048, 0);
  body(hp, 'hip', 'hip', V(0, 0.04, -0.05), V(0, 1, 0));
  footPlate(g, 0.5, 0.32, V(0, 0.27, 0.62), Math.PI / 4, ['footL', 'footR'], 0.11, V(0, 0, -1));
  tube(g, [0, 0.07, 0.68], [0, 0.22, 0.6], 0.06);
  tube(g, [0, 0.27, 0.62], [0, 0.46, 0.44], 0.06); roller(g, 0.42, 0, 0.5, 0.42);
  body(g, 'ankle', 'ankle', V(0, 0.5, 0.42), V(0, -0.7, 0.7));
  // side handles: tube from the column, horizontal grip pointing out, anchor on the free part
  handlePair(g, ['gripL', 'gripR'], s => V(0, 0.8, -0.02), s => V(s * 0.24, 0.86, -0.02), s => V(s, 0, 0), 0.13, { orient: ['neutral', 'overhand'], palm: V(0, -1, 0) });
  return P;
});

def('power-tower', 'Power tower (pull-up, dip, knee raise)', 'Benches & stations', 1, 'pull-up bar 2.25 m with neutral handles, dip handles 1.25 m, back pad and elbow pads', () => {
  const P = piece(); const g = P.o;
  for (const x of [-0.55, 0.55]) { tube(g, [x, 0.07, -0.35], [x, 2.3, -0.35], 0.08); baseRail(g, [x, 0, -0.8], [x, 0, 0.6], 0.08); tube(g, [x, 0.07, 0.4], [x, 0.9, -0.33], 0.05); }
  tube(g, [-0.55, 2.3, -0.35], [0.55, 2.3, -0.35], 0.07); tube(g, [-0.55, 0.3, -0.35], [0.55, 0.3, -0.35], 0.06);
  for (const x of [-0.55, 0.55]) tube(g, [x, 2.3, -0.35], [x, 2.25, 0.08], 0.06);
  knurl(g, 0.016, 1.04, 0, 2.25, 0.08, 'x', 0.006);
  grip(g, 'pullupL', V(0.3, 2.25, 0.08), { radius: 0.016, length: 0.4, hand: 'L', orient: ['overhand', 'underhand'] }, V(1, 0, 0), V(0, -1, 0));
  grip(g, 'pullupR', V(-0.3, 2.25, 0.08), { radius: 0.016, length: 0.4, hand: 'R', orient: ['overhand', 'underhand'] }, V(1, 0, 0), V(0, -1, 0));
  // neutral handles hang below the front of the bar
  handlePair(g, ['neutralL', 'neutralR'], s => V(s * 0.5, 2.25, 0.08), s => V(s * 0.3, 2.14, 0.08), s => V(0, 0, 1), 0.15, { orient: ['neutral'], palm: V(0, -1, 0), both: null });
  for (const s of [-1, 1]) {
    // dip arms: frame -> forward, grips along Z, free ends
    tube(g, [s * 0.55, 1.22, -0.35], [s * 0.27, 1.22, -0.15], 0.06);
    handle(g, s > 0 ? 'dipL' : 'dipR', null, V(s * 0.27, 1.22, -0.12), V(0, 0, 1), 0.32, { r: 0.017, hand: s > 0 ? 'L' : 'R', orient: ['neutral'], palm: V(0, 1, 0) });
    // elbow pads on brackets for knee raises
    tube(g, [s * 0.55, 1.3, -0.35], [s * 0.27, 1.3, -0.3], 0.05);
    box(g, 0.08, 0.04, 0.28, MAT.frame, s * 0.27, 1.32, -0.18, 0.006);
    pad(g, 0.11, 0.06, 0.32, s * 0.27, 1.37, -0.18); body(g, s > 0 ? 'forearmL' : 'forearmR', 'forearm', V(s * 0.27, 1.4, -0.16));
  }
  tube(g, [0, 0.3, -0.35], [0, 1.25, -0.42], 0.06);
  pad(g, 0.34, 0.075, 0.62, 0, 0.95, -0.38, [Math.PI / 2, 0, 0]); body(g, 'back', 'back', V(0, 0.95, -0.34), V(0, 0, 1));
  for (const s of [-1, 1]) { tube(g, [s * 0.55, 0.42, -0.25], [s * 0.2, 0.42, -0.25], 0.04); box(g, 0.16, 0.025, 0.2, MAT.frame, s * 0.2, 0.43, -0.25, 0.005); box(g, 0.15, 0.004, 0.19, MAT.rubber, s * 0.2, 0.444, -0.25, 0.002); }
  foot(g, 'stepL', V(0.2, 0.446, -0.25)); foot(g, 'stepR', V(-0.2, 0.446, -0.25));
  return P;
});

// ================================================================= RACKS & RIGS
def('landmine', 'Landmine with barbell', 'Racks & rigs', 2, 'swivel sleeve on a floor plate; motion lifts the bar end', () => {
  const P = piece(); const g = P.o; const Z = -1.9;
  box(g, 0.5, 0.015, 0.5, MAT.frame, 0, 0.0075, Z, 0.004); for (const x of [-0.2, 0.2]) for (const z of [-0.2, 0.2]) bolt(g, V(x, 0.015, Z + z), UP, 0.008);
  cyl(g, 0.05, 0.08, MAT.frame, 0, 0.055, Z, 'y', 40); cyl(g, 0.03, 0.04, MAT.chrome, 0, 0.11, Z, 'y', 32);
  const arm = pivot(g, V(0, 0.11, Z), 'x');
  cyl(arm, 0.033, 0.3, MAT.frame, 0, 0, 0.12, 'z', 40); hub(arm, V(0, 0, 0), 'x', 0.04, 0.09);
  cyl(arm, 0.0142, 1.31, MAT.chrome, 0, 0, 0.27 + 0.655, 'z', 32); knurl(arm, 0.0145, 0.4, 0, 0, 1.25, 'z');
  collar(arm, 0); arm.children[arm.children.length - 1].rotation.y = Math.PI / 2; arm.children[arm.children.length - 1].position.z = 1.59;
  const sl = new THREE.Group(); sl.rotation.y = -Math.PI / 2; sl.position.z = 1.6; arm.add(sl); sleeve(sl, 1, 0.0);
  plate(arm, 20, 0, 0, 1.66, 'z'); springClip(sl, 0.1);
  grip(arm, 'end', V(0, 0, 1.92), { radius: 0.025, length: 0.12, orient: ['neutral', 'any'], note: 'one or both hands cupping the sleeve end' }, V(0, 0, 1), V(0, 0, -1));
  grip(arm, 'shaft', V(0, 0, 1.4), { radius: 0.0145, length: 0.25, hand: 'either' }, V(0, 0, 1), V(0, -1, 0));
  attach(arm, 'tbarHandle', V(0, 0, 1.5));
  dof(P, 'motion', 'Bar angle', 0, 1, 0.3, '', v => turn(arm, -THREE.MathUtils.degToRad(5 + v * 45)));
  turn(arm, -THREE.MathUtils.degToRad(5 + 0.3 * 45)); return P;
});

def('power-rack', 'Power rack', 'Racks & rigs', 1, 'numbered uprights, J-hooks with liners, spotter arms, knurled pull-up bar; hook height dof', (o = {}) => {
  const P = piece(); const g = P.o; const H = 2.3, W = 1.2, D = 1.2;
  for (const x of [-W / 2, W / 2]) for (const z of [-D / 2, D / 2]) {
    tube(g, [x, 0.02, z], [x, H, z], 0.075);
    holes(g, [x, 0.4, z + Math.sign(z) * 0.0385], [x, 2.05, z + Math.sign(z) * 0.0385], 26, V(0, 0, Math.sign(z)), 0.009);
    holes(g, [x - Math.sign(x) * 0.0385, 0.4, z], [x - Math.sign(x) * 0.0385, 2.05, z], 26, V(-Math.sign(x), 0, 0), 0.009);
    box(g, 0.14, 0.012, 0.14, MAT.frame, x, 0.006, z, 0.003); for (const a of [-0.05, 0.05]) for (const b of [-0.05, 0.05]) bolt(g, V(x + a, 0.012, z + b), UP, 0.006);
  }
  for (const x of [-W / 2, W / 2]) { tube(g, [x, 0.05, -D / 2 - 0.15], [x, 0.05, D / 2 + 0.15], 0.075); tube(g, [x, H, -D / 2], [x, H, D / 2], 0.06); }
  for (const z of [-D / 2, D / 2]) tube(g, [-W / 2, H, z], [W / 2, H, z], 0.06);
  tube(g, [-W / 2, 0.05, -D / 2], [W / 2, 0.05, -D / 2], 0.06);
  // pull-up bar on forward brackets, clear of the frame
  for (const s of [-1, 1]) tube(g, [s * W / 2, H, D / 2], [s * W / 2, H + 0.04, D / 2 + 0.16], 0.05);
  knurl(g, 0.016, W + 0.06, 0, H + 0.04, D / 2 + 0.16, 'x', 0.006);
  grip(g, 'pullupL', V(0.3, H + 0.04, D / 2 + 0.16), { radius: 0.016, length: 0.4, hand: 'L', orient: ['overhand', 'underhand'] }, V(1, 0, 0), V(0, -1, 0));
  grip(g, 'pullupR', V(-0.3, H + 0.04, D / 2 + 0.16), { radius: 0.016, length: 0.4, hand: 'R', orient: ['overhand', 'underhand'] }, V(1, 0, 0), V(0, -1, 0));
  const hooks = new THREE.Group(); g.add(hooks); const safeties = new THREE.Group(); g.add(safeties);
  for (const s of [-1, 1]) {
    const j = new THREE.Group(); j.position.set(s * W / 2, 0, D / 2); hooks.add(j);
    box(j, 0.095, 0.16, 0.095, MAT.frame, 0, 0, 0, 0.006); box(j, 0.06, 0.025, 0.11, MAT.frame, -s * 0.0, 0.0, -0.1, 0.005);
    box(j, 0.06, 0.06, 0.02, MAT.frame, 0, 0.035, -0.16, 0.005); box(j, 0.055, 0.01, 0.07, MAT.rubber, 0, 0.018, -0.11, 0.003);
    cyl(j, 0.008, 0.06, MAT.chrome, 0, -0.05, 0.05, 'z', 12); mesh(new THREE.SphereGeometry(0.013, 20, 14), MAT.cap, j, 0, -0.05, 0.085);
    attach(hooks, s > 0 ? 'hookL' : 'hookR', V(s * W / 2, 0.035, D / 2 - 0.11));
    const sf = new THREE.Group(); sf.position.set(s * W / 2, 0, 0); safeties.add(sf);
    box(sf, 0.05, 0.07, D + 0.3, MAT.frame, 0, 0, 0, 0.006); box(sf, 0.052, 0.012, D + 0.28, MAT.rubber, 0, 0.04, 0, 0.003);
    for (const z of [-D / 2, D / 2]) { cyl(sf, 0.01, 0.12, MAT.chrome, -s * 0.0, 0, z, 'x', 12); }
  }
  const bar = new THREE.Group(); g.add(bar); const B = R.barbell({}); bar.add(B.o);
  const set = y => { hooks.position.y = y; bar.position.set(0, y + 0.05, D / 2 - 0.11); };
  dof(P, 'hookHeight', 'J-hook height', 0.5, 1.7, 1.38, 'm', set); set(1.38);
  dof(P, 'safetyHeight', 'Safety height', 0.3, 1.2, 0.75, 'm', y => { safeties.position.y = y; }); safeties.position.y = 0.75;
  dof(P, 'showBar', 'Barbell on hooks', 0, 1, 1, '', v => { bar.visible = v > 0.5; });
  feetOnFloor(g, 0.0, 0.2);
  box(g, W - 0.08, 0.02, D - 0.08, MAT.deck, 0, 0.01, 0, 0.004);
  return P;
});

def('smith-machine', 'Smith machine', 'Racks & rigs', 1, 'bar on guide rods with linear bearings and safety hooks, plate horns; motion = bar height', (o = {}) => { // audit: o.plates = kg list loaded on the carriage sleeves
  const P = piece(); const g = P.o; const H = 2.2, W = 1.6, z0 = 0.1;
  for (const x of [-W / 2, W / 2]) for (const z of [-0.55, 0.55]) tube(g, [x, 0.05, z], [x, H, z], 0.075);
  for (const x of [-W / 2, W / 2]) { tube(g, [x, 0.05, -0.75], [x, 0.05, 0.75], 0.09); tube(g, [x, H, -0.55], [x, H, 0.55], 0.06); for (const z of [-0.75, 0.75]) levelFoot(g, x, z);
    const rx = x - Math.sign(x) * 0.11; cyl(g, 0.019, H - 0.15, MAT.chrome, rx, H / 2 + 0.05, z0, 'y', 32); box(g, 0.08, 0.04, 0.6, MAT.frame, x - Math.sign(x) * 0.06, H - 0.04, z0 - 0.2, 0.006); box(g, 0.08, 0.04, 0.6, MAT.frame, x - Math.sign(x) * 0.06, 0.12, z0 - 0.2, 0.006);
    tube(g, [x, 0.12, z0], [rx, 0.12, z0], 0.04); tube(g, [x, H - 0.04, z0], [rx, H - 0.04, z0], 0.04);
    // hook ladder (safety catches)
    for (let i = 0; i < 18; i++) box(g, 0.02, 0.012, 0.03, MAT.chrome, x - Math.sign(x) * 0.04, 0.3 + i * 0.09, z0 + 0.06, 0.003);
    tube(g, [x - Math.sign(x) * 0.04, 0.12, z0 + 0.06], [x - Math.sign(x) * 0.04, H - 0.05, z0 + 0.06], 0.025);
  }
  for (const z of [-0.55, 0.55]) tube(g, [-W / 2, H, z], [W / 2, H, z], 0.06);
  box(g, 1.3, 0.012, 1.2, MAT.deck, 0, 0.006, 0, 0.004);
  const car = new THREE.Group(); g.add(car);
  cyl(car, 0.015, W - 0.3, MAT.chrome, 0, 0, 0, 'x', 40); knurl(car, 0.0153, 0.3, 0.4, 0, 0, 'x'); knurl(car, 0.0153, 0.3, -0.4, 0, 0, 'x'); knurl(car, 0.0153, 0.12, 0, 0, 0, 'x');
  for (const x of [-0.56, -0.24, 0.24, 0.56]) mesh(new THREE.TorusGeometry(0.0155, 0.0012, 8, 40), MAT.steel, car, x, 0, 0).rotation.y = Math.PI / 2;
  for (const s of [-1, 1]) {
    const rx = s * (W / 2 - 0.11);
    cyl(car, 0.035, 0.16, MAT.frameLight, rx, 0, 0, 'y', 40); box(car, 0.1, 0.06, 0.07, MAT.frame, rx - s * 0.03, 0, 0, 0.008);
    // rotating hook with handle
    box(car, 0.025, 0.07, 0.02, MAT.chrome, rx - s * 0.07, -0.02, 0.045, 0.004); cyl(car, 0.008, 0.06, MAT.chrome, rx - s * 0.07, 0.03, 0.03, 'z', 12);
    collar(car, rx + s * 0.05, 0.035, 0.02); sleeve(car, s, rx + s * 0.06, 0.22, 0.022);
    if (o.plates && o.plates.length) { let x = Math.abs(rx) + 0.075; for (const k of o.plates) { const G = PLATE_CACHE[k] || (PLATE_CACHE[k] = plateGeo(k)); x += G.userData.T / 2; plate(car, k, s * x, 0, 0); x += G.userData.T / 2 + 0.002; } }
  }
  car.position.z = z0;
  grip(car, 'gripL', V(0.4, 0, 0), { radius: 0.0153, length: 0.28, hand: 'L', orient: ['overhand', 'underhand'] }, V(1, 0, 0), V(0, -1, 0));
  grip(car, 'gripR', V(-0.4, 0, 0), { radius: 0.0153, length: 0.28, hand: 'R', orient: ['overhand', 'underhand'] }, V(1, 0, 0), V(0, -1, 0));
  attach(car, 'barCentre', V(0, 0, 0));
  dof(P, 'motion', 'Bar height (0 = 0.3 m stops, 1 = 1.9 m)', 0, 1, 0.6875, '', m => { car.position.y = 0.3 + 1.6 * Math.min(1, Math.max(0, m)); }); car.position.y = 1.4;
  feetOnFloor(g, 0.0, 0.18, 0.012);
  return P;
});

// ================================================================= CABLE ATTACHMENTS
// Attachments hang from their clip ring at the origin; the handle sits below (-Y).
function clipRing(g) { mesh(new THREE.TorusGeometry(0.018, 0.0045, 12, 40), MAT.chrome, g, 0, 0, 0); cyl(g, 0.012, 0.03, MAT.chrome, 0, -0.03, 0, 'y', 24); mesh(new THREE.SphereGeometry(0.014, 24, 16), MAT.chrome, g, 0, -0.045, 0); }
def('straight-bar', 'Straight cable bar', 'Cable attachments', 1, '0.5 m knurled chrome bar on a swivel', () => {
  const P = piece(); const g = P.o; clipRing(g);
  cyl(g, 0.02, 0.05, MAT.steel, 0, -0.07, 0, 'y', 32); cyl(g, 0.022, 0.03, MAT.chrome, 0, -0.08, 0, 'x', 32);
  cyl(g, 0.0142, 0.5, MAT.chrome, 0, -0.08, 0, 'x', 32); knurl(g, 0.0145, 0.18, 0.14, -0.08, 0, 'x'); knurl(g, 0.0145, 0.18, -0.14, -0.08, 0, 'x');
  for (const s of [-1, 1]) cyl(g, 0.019, 0.018, MAT.rubber, s * 0.255, -0.08, 0, 'x', 32);
  grip(g, 'gripL', V(0.14, -0.08, 0), { radius: 0.0145, length: 0.18, hand: 'L', orient: ['overhand', 'underhand'] }, V(1, 0, 0), V(0, 1, 0));
  grip(g, 'gripR', V(-0.14, -0.08, 0), { radius: 0.0145, length: 0.18, hand: 'R', orient: ['overhand', 'underhand'] }, V(1, 0, 0), V(0, 1, 0));
  attach(g, 'clip', V()); return P;
});
def('lat-bar', 'Wide lat bar', 'Cable attachments', 1, '1.2 m bar with angled knurled ends and rubber stops', () => {
  const P = piece(); const g = P.o; clipRing(g);
  cyl(g, 0.02, 0.04, MAT.steel, 0, -0.065, 0, 'y', 32);
  const curve = new THREE.CatmullRomCurve3([V(-0.6, -0.15, 0), V(-0.45, -0.105, 0), V(-0.3, -0.08, 0), V(0, -0.075, 0), V(0.3, -0.08, 0), V(0.45, -0.105, 0), V(0.6, -0.15, 0)], false, 'centripetal');
  mesh(new THREE.TubeGeometry(curve, 240, 0.0145, 36), MAT.knurl, g);
  for (const s of [-1, 1]) { const e = curve.getPointAt(s > 0 ? 1 : 0); cyl(g, 0.02, 0.02, MAT.rubber, e.x, e.y, 0, 'x', 32).rotation.z = Math.PI / 2 + s * 0.3; }
  for (const [nm, t, hand] of [['gripL', 0.86, 'L'], ['gripR', 0.14, 'R'], ['gripMidL', 0.62, 'L'], ['gripMidR', 0.38, 'R']]) {
    const pt = curve.getPointAt(t), tan = curve.getTangentAt(t); if (hand === 'R') tan.negate();
    grip(g, nm, pt, { radius: 0.0145, length: nm.includes('Mid') ? 0.15 : 0.2, hand, orient: ['overhand', 'underhand'] }, tan.multiplyScalar(hand === 'L' ? 1 : -1), V(0, 1, 0));
  }
  attach(g, 'clip', V()); return P;
});
def('v-handle', 'V-handle (close neutral grip)', 'Cable attachments', 1, 'parallel rubber handles 0.15 m apart on a chrome V', () => {
  const P = piece(); const g = P.o; clipRing(g);
  for (const s of [-1, 1]) { bent(g, [V(0, -0.05, 0), V(s * 0.04, -0.12, 0), V(s * 0.075, -0.19, 0)], 0.024, MAT.chrome); }
  tube(g, [-0.075, -0.19, 0], [0.075, -0.19, 0], 0.024, MAT.chrome, true, { caps: false }); tube(g, [-0.075, -0.36, 0], [0.075, -0.36, 0], 0.024, MAT.chrome, true, { caps: false });
  for (const s of [-1, 1]) { hgrip(g, 0.015, 0.15, s * 0.075, -0.275, 0, 'y'); for (const y of [-0.19, -0.36]) mesh(new THREE.SphereGeometry(0.013, 24, 16), MAT.chrome, g, s * 0.075, y, 0);
    grip(g, s > 0 ? 'gripL' : 'gripR', V(s * 0.075, -0.275, 0), { radius: 0.015, length: 0.13, hand: s > 0 ? 'L' : 'R', orient: ['neutral'] }, V(0, -1, 0), V(-s, 0, 0)); }
  attach(g, 'clip', V()); return P;
});
def('rope', 'Triceps rope', 'Cable attachments', 1, '0.7 m braided rope, 28 mm, with rubber end knobs', () => {
  const P = piece(); const g = P.o; clipRing(g); cyl(g, 0.026, 0.06, MAT.rubber, 0, -0.08, 0, 'y', 40);
  const strands = [[new THREE.Group(), 1], [new THREE.Group(), -1]]; strands.forEach(([r]) => g.add(r));
  const build = spread => {
    for (const [r, s] of strands) {
      r.clear(); const end = V(s * (0.05 + spread * 0.2), -0.34, 0);
      const curve = new THREE.QuadraticBezierCurve3(V(s * 0.006, -0.1, 0), V(s * 0.012, -0.22, 0), end);
      const tg = new THREE.TubeGeometry(curve, 80, 0.014, 24); const Pp = tg.attributes.position;
      for (let i = 0; i < Pp.count; i++) { const ring = Math.floor(i / 25), j = i % 25; const c = curve.getPointAt(ring / 80); const v = V(Pp.getX(i), Pp.getY(i), Pp.getZ(i)).sub(c); v.multiplyScalar(1 + 0.08 * Math.sin(j / 24 * Math.PI * 6 + ring * 0.9)); Pp.setXYZ(i, c.x + v.x, c.y + v.y, c.z + v.z); }
      tg.computeVertexNormals(); mesh(tg, MAT.rope, r);
      const tan = curve.getTangentAt(1); const k = mesh(new THREE.SphereGeometry(0.028, 32, 20), MAT.rubber, r); k.position.copy(end).addScaledVector(tan, 0.022); k.scale.set(1, 1.1, 1);
      const t = 0.72; grip(r, s > 0 ? 'gripL' : 'gripR', curve.getPointAt(t), { radius: 0.014, length: 0.1, gripType: 'rope', hand: s > 0 ? 'L' : 'R', orient: ['neutral'], note: 'little finger rests against the knob' }, curve.getTangentAt(t), V(-s, 0, 0));
    }
  };
  dof(P, 'spread', 'Rope spread', 0, 1, 0.2, '', build); build(0.2); attach(g, 'clip', V()); return P;
});
def('d-handle', 'D-handle', 'Cable attachments', 1, 'single-hand stirrup with a rotating rubber grip', () => {
  const P = piece(); const g = P.o; clipRing(g);
  const curve = new THREE.CatmullRomCurve3([V(-0.068, -0.13, 0), V(-0.06, -0.07, 0), V(0, -0.05, 0), V(0.06, -0.07, 0), V(0.068, -0.13, 0)]);
  mesh(new THREE.TubeGeometry(curve, 120, 0.0075, 20), MAT.chrome, g);
  for (const s of [-1, 1]) { cyl(g, 0.012, 0.012, MAT.chrome, s * 0.068, -0.13, 0, 'x', 24); }
  hgrip(g, 0.016, 0.12, 0, -0.13, 0, 'x');
  grip(g, 'grip', V(0, -0.13, 0), { radius: 0.016, length: 0.1, orient: ['any'] }, V(1, 0, 0), V(0, 1, 0));
  attach(g, 'clip', V()); return P;
});
def('ankle-strap', 'Ankle strap', 'Cable attachments', 2, 'padded neoprene cuff with velcro and a D-ring', () => {
  const P = piece(); const g = P.o; clipRing(g);
  const dr = new THREE.TorusGeometry(0.025, 0.004, 10, 40, Math.PI); mesh(dr, MAT.chrome, g, 0, -0.06, 0).rotation.z = Math.PI; cyl(g, 0.004, 0.05, MAT.chrome, 0, -0.06, 0, 'x', 12);
  flatBand(g, new THREE.CatmullRomCurve3([V(-0.02, -0.06, 0), V(-0.015, -0.085, 0.01), V(0, -0.095, 0.03)]), 0.03, 0.003, 30, false, MAT.strap);
  const cuffPts = []; for (let i = 0; i < 48; i++) { const a = i / 48 * Math.PI * 2; cuffPts.push(V(Math.cos(a) * 0.052, -0.13 + 0.004 * Math.sin(a * 3), Math.sin(a) * 0.045 + 0.04)); }
  flatBand(g, new THREE.CatmullRomCurve3(cuffPts, true), 0.08, 0.012, 200, true, MAT.foam);
  flatBand(g, new THREE.CatmullRomCurve3(cuffPts.map(p => p.clone().multiplyScalar(1.0)).map(p => p.setY(p.y - 0.0)).map(p => p.multiply(V(1.13, 1, 1.13))), true), 0.05, 0.003, 200, true, MAT.strap);
  body(g, 'ankle', 'ankle', V(0, -0.13, 0.04), V(0, 1, 0)); grip(g, 'cuff', V(0, -0.13, 0.04), { radius: 0.045, gripType: 'strap', note: 'worn on the ankle, not held' }, V(1, 0, 0), V(0, 1, 0));
  attach(g, 'clip', V()); return P;
});

// ================================================================= CABLE STATIONS
function attachEnd(g, id) { const endG = new THREE.Group(); g.add(endG); attach(endG, 'cableEnd', V()); cableEnd(endG); const A = R[id]({}); A.o.userData.rigid = true; A.o.name = 'attachment'; endG.add(A.o); return { endG, A }; }

def('cable-tower', 'Adjustable cable column', 'Cable', 1, 'one stack, pulley carriage 0.1-2.1 m with pop pin, any attachment', (o = {}) => {
  const P = piece(); const g = P.o; const z = -0.6;
  baseRail(g, [-0.3, 0, z - 0.25], [0.3, 0, z - 0.25], 0.08); baseRail(g, [-0.3, 0, z + 0.2], [0.3, 0, z + 0.2], 0.08); tube(g, [0, 0.06, z - 0.25], [0, 0.06, z + 0.2], 0.08);
  for (const x of [-0.12, 0.12]) { tube(g, [x, 0.06, z + 0.12], [x, 2.25, z + 0.12], 0.06); holes(g, [x, 0.2, z + 0.152], [x, 2.05, z + 0.152], 20, V(0, 0, 1), 0.007); }
  box(g, 0.34, 0.06, 0.1, MAT.frame, 0, 2.26, z + 0.12); tube(g, [0, 2.26, z + 0.12], [0, 2.26, z - 0.12], 0.06);
  const carriage = new THREE.Group(); g.add(carriage);
  box(carriage, 0.34, 0.14, 0.09, MAT.frame, 0, 0, z + 0.165, 0.008); popPin(carriage, V(0.12, -0.05, z + 0.21), V(0, 0, 1));
  const swivel = new THREE.Group(); swivel.position.set(0, 0, z + 0.24); carriage.add(swivel); cyl(swivel, 0.025, 0.05, MAT.steel, 0, 0, -0.02, 'z', 32);
  pulley(swivel, V(0, 0, 0.04), 'x', 0.05);
  const st = weightStack(g, 0, z - 0.12, { h: 2.1, d: 0.2 });
  for (const yy of [2.2]) pulley(g, V(0, yy, z - 0.12), 'x', 0.045), pulley(g, V(0, yy, z + 0.12), 'x', 0.045);
  const line = cableLine(g, 6); const { endG } = attachEnd(g, o.attachment ?? 'd-handle');
  let pullH = 1.9, pull = 0.15;
  const upd = () => {
    carriage.position.y = pullH; const pp = V(0, pullH, z + 0.28);
    const dir = V(0, pullH > 1.1 ? -0.5 : 0.5, 1).normalize();
    const end = pp.clone().addScaledVector(dir, 0.2 + pull * 1.3);
    endG.position.copy(end).addScaledVector(dir, -0.16); endG.quaternion.setFromUnitVectors(V(0, -1, 0), dir.clone().multiplyScalar(1));
    endG.position.copy(end); endG.quaternion.setFromUnitVectors(V(0, 1, 0), pp.clone().sub(end).normalize());
    st.setLift(pull * 0.65);
    line.update([st.stackTop(), V(0, 2.2 + 0.045, z - 0.12), V(0, 2.2 + 0.045, z + 0.12), V(0, pullH + 0.06, z + 0.17), pp, end.clone().add(pp.clone().sub(end).normalize().multiplyScalar(0.155))]);
  };
  dof(P, 'pulleyHeight', 'Pulley height', 0.1, 2.1, 1.9, 'm', v => { pullH = v; upd(); });
  dof(P, 'motion', 'Cable pull', 0, 1, 0.15, '', v => { pull = v; upd(); }); upd();
  feetOnFloor(g, 0.3, 0.15);
  P.attachment = o.attachment ?? 'd-handle'; return P;
});

def('cable-crossover', 'Cable crossover (dual pulley)', 'Cable', 1, 'two columns joined by a top beam with a pull-up bar, pulley height dof, D-handles', () => {
  const P = piece(); const g = P.o; const X = 1.5, H = 2.35;
  const sides = [];
  for (const s of [-1, 1]) {
    const x = s * X;
    for (const z of [-0.15, 0.15]) { tube(g, [x, 0.06, z], [x, H, z], 0.07); holes(g, [x - s * 0.036, 0.25, z], [x - s * 0.036, 2.1, z], 20, V(-s, 0, 0), 0.007); }
    box(g, 0.14, 0.08, 0.42, MAT.frame, x, H + 0.04, 0, 0.008);
    baseRail(g, [x, 0, -0.45], [x, 0, 0.45], 0.08); baseRail(g, [x + s * 0.55, 0, -0.45], [x + s * 0.55, 0, 0.45], 0.08);
    for (const z of [-0.45, 0.45]) tube(g, [x, 0.06, z], [x + s * 0.55, 0.06, z], 0.07);
    const st = weightStack(g, x + s * 0.32, 0, { h: 2.15, w: 0.3, d: 0.2 });
    pulley(g, V(x + s * 0.32, H - 0.02, 0), 'z', 0.045); pulley(g, V(x, H - 0.02, 0), 'z', 0.045);
    const car = new THREE.Group(); g.add(car); box(car, 0.09, 0.14, 0.36, MAT.frame, x - s * 0.05, 0, 0, 0.008); popPin(car, V(x - s * 0.095, -0.04, 0.1), V(-s, 0, 0));
    const pg = pulley(car, V(x - s * 0.13, 0, 0), 'z', 0.05);
    const line = cableLine(g, 6); const { endG, A } = attachEnd(g, 'd-handle');
    A.o.traverse(c => { if (c.name === 'grip') { c.name = s > 0 ? 'gripL' : 'gripR'; c.userData.anchor.hand = s > 0 ? 'L' : 'R'; } });
    sides.push({ s, x, st, car, line, endG });
  }
  tube(g, [-X, H + 0.06, 0], [X, H + 0.06, 0], 0.08);
  for (const s of [-1, 1]) tube(g, [s * 0.5, H + 0.06, 0], [s * 0.5, H + 0.02, 0.2], 0.05);
  knurl(g, 0.016, 1.1, 0, H + 0.02, 0.2, 'x');
  grip(g, 'pullupL', V(0.25, H + 0.02, 0.2), { radius: 0.016, length: 0.4, hand: 'L' }, V(1, 0, 0), V(0, -1, 0)); grip(g, 'pullupR', V(-0.25, H + 0.02, 0.2), { radius: 0.016, length: 0.4, hand: 'R' }, V(1, 0, 0), V(0, -1, 0));
  let h = 2.0, m = 0;
  const upd = () => {
    for (const S of sides) {
      S.car.position.y = h; const pp = V(S.x - S.s * 0.13, h, 0);
      const rest = pp.clone().add(V(-S.s * 0.3, h > 1.2 ? -0.32 : 0.32, 0.12));
      const full = V(S.s * 0.08, 1.2, 0.55);
      const end = rest.clone().lerp(full, m);
      S.endG.position.copy(end); S.endG.quaternion.setFromUnitVectors(V(0, 1, 0), pp.clone().sub(end).normalize());
      S.st.setLift(end.distanceTo(pp) * 0.5 - 0.15);
      S.line.update([S.st.stackTop(), V(S.x + S.s * 0.32, H + 0.025, 0), V(S.x, H + 0.025, 0), V(S.x - S.s * 0.08, h + 0.06, 0), pp.clone().add(V(0, h > 1.2 ? -0.05 : 0.05, 0)), end.clone().add(pp.clone().sub(end).normalize().multiplyScalar(0.155))]);
    }
  };
  dof(P, 'pulleyHeight', 'Pulley height', 0.1, 2.1, 2.0, 'm', v => { h = v; upd(); });
  dof(P, 'motion', 'Fly', 0, 1, 0, '', v => { m = v; upd(); }); upd();
  feetOnFloor(g, 0.15, 0.17);
  return P;
});

def('lat-pulldown-station', 'Lat pulldown station', 'Cable', 1, 'seat, adjustable thigh rollers, high pulley, wide bar (attachment opt)', (o = {}) => {
  // faceStack (default true, Aziz's ask): the user faces the weight stack, as in most gyms. Built facing -Z inside an
  // inner group turned 180 deg, so the piece still follows the kit convention (user faces +Z; stack in front of them).
  const P = piece(); const f = o.faceStack === false ? 1 : -1; const g = new THREE.Group(); P.o.add(g); if (f < 0) g.rotation.y = Math.PI;
  seatUnit(g, { seatH: 0.5, backH: 0, seatD: 0.36 });
  tube(g, [0, 0.06, -1.0], [0, 0.06, 0.6], 0.09); baseRail(g, [-0.38, 0, 0.6], [0.38, 0, 0.6], 0.08); baseRail(g, [-0.38, 0, -1.0], [0.38, 0, -1.0], 0.08);
  tube(g, [0, 0.06, -0.55], [0, 2.45, -0.55], 0.1); tube(g, [0, 2.45, -0.55], [0, 2.5, 0.12 * f], 0.08); tube(g, [0, 1.6, -0.55], [0, 2.4, -0.2], 0.06);
  const tp = new THREE.Group(); g.add(tp);
  tube(g, [0, 0.06, 0.32 * f], [0, 0.6, 0.32 * f], 0.08); holes(g, [0, 0.38, 0.361 * f], [0, 0.58, 0.361 * f], 5, V(0, 0, f)); popPin(g, V(0.042, 0.5, 0.32 * f), V(1, 0, 0));
  tube(tp, [0, -0.12, 0.14 * f], [0, 0, 0.14 * f], 0.065, MAT.frameLight); tube(tp, [0, 0, 0.14 * f], [0, 0, 0.0], 0.05); roller(tp, 0.42, 0, 0.0, 0.0, 0.055);
  body(tp, 'thighL', 'thigh', V(0.1 * f, -0.055, 0), V(0, -1, 0)); body(tp, 'thighR', 'thigh', V(-0.1 * f, -0.055, 0), V(0, -1, 0));
  const st = weightStack(g, 0, -0.85, { h: 2.1 });
  const pp = V(0, 2.42, 0.12 * f); pulley(g, pp, 'x', 0.05); pulley(g, V(0, 2.42, -0.55), 'x', 0.05); pulley(g, V(0, 2.2, -0.85), 'x', 0.045);
  const line = cableLine(g, 6); const { endG } = attachEnd(g, o.attachment ?? 'lat-bar');
  feetOnFloor(g, 0.42 * f, 0.15 * f, 0, V(0, 0, f));
  dof(P, 'thighPad', 'Thigh pad height', 0.62, 0.8, 0.7, 'm', v => tp.position.set(0, v, 0.18 * f)); tp.position.set(0, 0.7, 0.18 * f);
  const set = v => { const y = 2.05 - v * 0.95, z = (0.12 - v * 0.02) * f; endG.position.set(0, y, z); endG.quaternion.identity(); if (f < 0) endG.rotation.y = Math.PI; st.setLift((2.05 - y)); line.update([st.stackTop(), V(0, 2.245, -0.85), V(0, 2.47, -0.55), V(0, 2.47, 0.12 * f), V(0, y + 0.155, z)]); };
  dof(P, 'motion', 'Bar height', 0, 1, 0, '', set); set(0); P.attachment = o.attachment ?? 'lat-bar';
  return P;
});

def('seated-row-station', 'Seated cable row', 'Cable', 1, 'long padded bench, tread foot plate, low pulley, V-handle', (o = {}) => {
  const P = piece(); const g = P.o;
  pad(g, 0.32, 0.075, 1.0, 0, 0.42, -0.25); tube(g, [0, 0.33, -0.7], [0, 0.33, 0.2], 0.06);
  tube(g, [0, 0.06, -0.85], [0, 0.06, 1.3], 0.09); for (const z of [-0.6, 0.15]) tube(g, [0, 0.06, z], [0, 0.33, z], 0.07);
  baseRail(g, [-0.3, 0, -0.85], [0.3, 0, -0.85], 0.08);
  body(g, 'seat', 'seat', V(0, 0.46, -0.15));
  tube(g, [0, 0.06, 0.62], [0, 0.42, 0.66], 0.07);
  footPlate(g, 0.5, 0.3, V(0, 0.27, 0.56), -1.1, ['footL', 'footR'], 0.11, V(0, 0, 1));
  const st = weightStack(g, 0, 1.15, { h: 1.6 });
  const pp = V(0, 0.48, 0.7); pulley(g, pp, 'x', 0.05); pulley(g, V(0, 0.14, 0.82), 'x', 0.045); pulley(g, V(0, 1.68, 1.15), 'x', 0.045);
  tube(g, [0, 0.42, 0.66], [0, 0.42, 0.72], 0.05);
  const line = cableLine(g, 6); const { endG } = attachEnd(g, o.attachment ?? 'v-handle');
  const set = v => { const z = 0.42 - v * 0.55; endG.position.set(0, 0.6, z); endG.quaternion.setFromUnitVectors(V(0, 1, 0), pp.clone().sub(endG.position).normalize()); st.setLift(v * 0.55);
    line.update([st.stackTop(), V(0, 1.725, 1.15), V(0, 1.725, 0.82), V(0, 0.095, 0.82), V(0, 0.43, 0.7), endG.position.clone().add(pp.clone().sub(endG.position).normalize().multiplyScalar(0.155))]); };
  dof(P, 'motion', 'Row', 0, 1, 0, '', set); set(0); P.attachment = o.attachment ?? 'v-handle';
  return P;
});

// ================================================================= SELECTORISED & PLATE-LOADED MACHINES
// common base: spine along Z on the floor from z0 to z1 with cross rails at both ends
function spine(g, z0, z1, w = 0.8) { tube(g, [0, 0.065, z0], [0, 0.065, z1], 0.09); baseRail(g, [-w / 2, 0, z0], [w / 2, 0, z0], 0.08); baseRail(g, [-w / 2, 0, z1], [w / 2, 0, z1], 0.08); }
// plate horn on a moving part: sleeve pointing along dir from base, with plates
function horn(p, base, dir, kgs = [20]) {
  const B = base.isVector3 ? base : V(...base), D = dir.clone().normalize();
  const h = new THREE.Group(); h.position.copy(B); h.quaternion.setFromUnitVectors(V(1, 0, 0), D); p.add(h);
  collar(h, 0.01, 0.035, 0.02); sleeve(h, 1, 0.02, 0.26, 0.025);
  let x = 0.03; for (const k of kgs) { const G = PLATE_CACHE[k] || (PLATE_CACHE[k] = plateGeo(k)); x += G.userData.T / 2; plate(h, k, x, 0, 0); x += G.userData.T / 2 + 0.002; }
  return h;
}
// cable from a stack to a lever cam: returns updater
function stackCable(g, st, pts) { const L = cableLine(g, pts.length + 1); return () => L.update([st.stackTop(), ...pts]); }

function chestPressInto(P, g, v, plates) {
  const tilt = { flat: 0.22, incline: 0.45, decline: 0.12, vertical: 0.12 }[v];
  seatUnit(g, { seatH: 0.5, backTilt: tilt, backH: 0.75, backZ: -0.15 });
  spine(g, -1.05, 0.55, 0.9);
  tube(g, [0, 0.06, -0.62], [0, 1.95, -0.62], 0.1); tube(g, [0, 1.95, -0.62], [0, 1.95, -0.22], 0.09); tube(g, [0, 1.2, -0.62], [0, 1.9, -0.3], 0.06);
  const st = plates ? null : weightStack(g, 0, -1.05, { h: 1.8 });
  const pivY = 1.9, pivZ = -0.22, hy = { flat: 1.08, incline: 1.25, decline: 0.95, vertical: 1.1 }[v], hz = 0.3;
  const arms = [];
  for (const s of [-1, 1]) {
    const a = pivot(g, V(s * 0.1, pivY, pivZ), 'x'); arms.push(a); hub(a, V(0, 0, 0), 'x', 0.05, 0.09);
    const E = V(s * 0.22, hy - pivY, hz - pivZ);
    bent(a, [V(s * 0.03, -0.03, 0.03), V(s * 0.1, (hy - pivY) * 0.45, (hz - pivZ) * 0.3), V(s * 0.2, (hy - pivY) * 0.9, (hz - pivZ) * 0.8), E], 0.055);
    handle(a, s > 0 ? 'gripL' : 'gripR', null, E.clone().add(V(s * 0.03, 0, 0)), V(s, 0, 0), 0.15, { hand: s > 0 ? 'L' : 'R', orient: ['overhand'], palm: V(0, 0, 1) });
    handle(a, s > 0 ? 'neutralL' : 'neutralR', E, E.clone().add(V(s * 0.05, 0.03, -0.04)), V(0, 1, 0), 0.14, { hand: s > 0 ? 'L' : 'R', orient: ['neutral'], palm: V(0, 0, 1) });
    if (plates) { bent(a, [V(s * 0.03, 0, 0), V(s * 0.12, -0.25, -0.22), V(s * 0.24, -0.55, -0.34)], 0.06); horn(a, V(s * 0.26, -0.55, -0.34), V(s, 0, 0), [20, 10]); } // audit (Aziz batch 1 + run3 #28): horns behind the seat back at ~1.35 m carry plates in view (they sat 1.95 m up, out of frame)
  }
  // foot assist bar on a support
  tube(g, [0, 0.065, 0.42], [0, 0.14, 0.45], 0.05); cyl(g, 0.02, 0.5, MAT.chrome, 0, 0.14, 0.45, 'x', 24); for (const s of [-1, 1]) { pad(g, 0.12, 0.04, 0.08, s * 0.16, 0.17, 0.45); }
  foot(g, 'footBarL', V(0.16, 0.19, 0.45)); foot(g, 'footBarR', V(-0.16, 0.19, 0.45)); feetOnFloor(g, 0.42, 0.15);
  const cab = st ? stackCable(g, st, [V(0, 1.95, -1.05), V(0, 1.95, pivZ)]) : null;
  const set = m => { arms.forEach(x => turn(x, -m * 0.5)); if (st) { st.setLift(m * 0.45); cab(); } };
  dof(P, 'motion', 'Press', 0, 1, 0, '', set); set(0);
}
def('chest-press-machine', 'Chest press machine (seated)', 'Machines: upper body', 1, 'converging arms with horizontal and vertical grips; variant flat|incline|decline|vertical (Gundam); stack', (o = {}) => { const P = piece(); chestPressInto(P, P.o, o.variant ?? 'flat', false); return P; });
def('iso-chest-press', 'Iso-lateral chest press (plate-loaded)', 'Machines: upper body', 2, 'independent arms with plate horns', (o = {}) => { const P = piece(); chestPressInto(P, P.o, o.variant ?? 'flat', true); return P; });

def('shoulder-press-machine', 'Shoulder press machine', 'Machines: upper body', 1, 'upright back; arms pivot behind and press up from shoulder height; opts.plates for plate-loaded', (o = {}) => {
  const P = piece(); const g = P.o;
  seatUnit(g, { seatH: 0.48, backTilt: 0.1, backH: 0.78, backZ: -0.15 });
  spine(g, -1.05, 0.45, 0.85);
  tube(g, [0, 0.06, -0.5], [0, 1.5, -0.5], 0.1); tube(g, [-0.28, 1.5, -0.5], [0.28, 1.5, -0.5], 0.08);
  const st = o.plates ? null : weightStack(g, 0, -1.05, { h: 1.8 });
  const arms = [];
  for (const s of [-1, 1]) {
    tube(g, [s * 0.28, 1.5, -0.5], [s * 0.28, 1.42, -0.5], 0.06);
    const a = pivot(g, V(s * 0.28, 1.42, -0.5), 'x'); arms.push(a); hub(a, V(0, 0, 0), 'x', 0.05, 0.08);
    const E = V(s * 0.0, -0.3, 0.5);
    bent(a, [V(0, 0, 0.03), V(0, 0.02, 0.25), V(s * 0.0, -0.12, 0.42), E], 0.055);
    handle(a, s > 0 ? 'gripL' : 'gripR', null, E.clone(), V(-s, 0, 0), 0.14, { hand: s > 0 ? 'L' : 'R', orient: ['overhand'], palm: V(0, 1, 0) });
    handle(a, s > 0 ? 'neutralL' : 'neutralR', E, E.clone().add(V(s * 0.03, 0, 0.04)), V(0, 0, 1), 0.13, { hand: s > 0 ? 'L' : 'R', orient: ['neutral'], palm: V(0, 1, 0) });
    if (o.plates) horn(a, V(s * 0.04, 0.0, -0.3), V(s, 0, 0), [20, 10]); /* audit: loaded */ else tube(a, [0, 0, 0], [0, 0.0, -0.25], 0.05);
  }
  feetOnFloor(g, 0.4, 0.15);
  const cab = st ? stackCable(g, st, [V(0, 1.95, -1.05), V(0, 1.95, -0.75), V(0, 1.42, -0.75)]) : null;
  const set = m => { arms.forEach(a => turn(a, -m * 0.75)); if (st) { st.setLift(m * 0.4); cab(); } };
  dof(P, 'motion', 'Press', 0, 1, 0, '', set); set(0);
  return P;
});def('plate-loaded-shoulder-press', 'Plate-loaded shoulder press', 'Machines: upper body', 1, 'audit: shoulder press machine with loaded plate horns, no stack (same as shoulder-press-machine {plates:true})', () => R['shoulder-press-machine']({ plates: true }));


def('pec-deck', 'Pec deck / rear delt fly', 'Machines: upper body', 1, 'arms swing on vertical pivots; front handles and arm pads for the fly, rear handles for the reverse fly', (o = {}) => {
  const P = piece(); const g = P.o; const sH = o.seatH ?? 0.5;   // audit (Aziz Nov 2 18:21): adjustable seat height so the handles sit at chest/shoulder height
  seatUnit(g, { seatH: sH, backTilt: 0.05, backH: 0.8, backZ: -0.15 });
  body(g, 'chestPad', 'chest', V(0, 1.05 + sH - 0.5, -0.17), V(0, 0, 1));
  spine(g, -1.05, 0.45, 0.85); tube(g, [0, 0.06, -0.5], [0, 2.0, -0.5], 0.1); tube(g, [0, 2.0, -0.5], [0, 2.0, -0.2], 0.09);
  tube(g, [-0.28, 1.98, -0.2], [0.28, 1.98, -0.2], 0.08);
  const st = weightStack(g, 0, -1.05, { h: 1.95 });
  const arms = [];
  for (const s of [-1, 1]) {
    const a = pivot(g, V(s * 0.26, 1.92, -0.2), 'y'); arms.push([a, s]); hub(a, V(0, 0, 0), 'y', 0.045, 0.08);
    tube(a, [0, -0.02, 0], [s * 0.4, -0.02, 0.02], 0.05); tube(a, [s * 0.4, -0.02, 0.02], [s * 0.4, -0.95, 0.02], 0.05);  // audit: handles at shoulder height
    // arm pad for the classic pec deck
    tube(a, [s * 0.4, -0.38, 0.02], [s * 0.4, -0.38, 0.06], 0.04); pad(a, 0.08, 0.06, 0.32, s * 0.4, -0.38, 0.1, [Math.PI / 2, 0, Math.PI / 2]);
    body(a, s > 0 ? 'forearmL' : 'forearmR', 'forearm', V(s * 0.4, -0.38, 0.13), V(-s, 0, 0.3).normalize(), V(0, 1, 0));
    handle(a, s > 0 ? 'gripL' : 'gripR', V(s * 0.4, -0.9, 0.02), V(s * 0.4, -0.9, 0.13), V(0, 1, 0), 0.16, { r: 0.017, hand: s > 0 ? 'L' : 'R', orient: ['neutral'], palm: V(-s, 0, 0) });
    handle(a, s > 0 ? 'rearL' : 'rearR', V(s * 0.4, -0.66, 0.02), V(s * 0.4, -0.66, -0.09), V(0, -1, 0), 0.15, { r: 0.017, hand: s > 0 ? 'L' : 'R', orient: ['neutral', 'overhand'], palm: V(s, 0, 0), info: { note: 'reverse fly' } });
  }
  feetOnFloor(g, 0.42, 0.15);
  const cab = stackCable(g, st, [V(0, 2.02, -1.05), V(0, 2.02, -0.2)]);
  const set = m => { for (const [a, s] of arms) turn(a, s * -(0.28 + m * 1.5)); st.setLift(m * 0.4); cab(); };  // audit: wider fly sweep (stretch behind shoulders -> hands meet in front)
  dof(P, 'motion', 'Fly', -1.05, 1, 0, '', set); set(0);   // audit (Aziz Nov 2 18:21): below 0 the arms swing forward for the rear-delt fly (rear handles in front of a lifter facing the pad; -1.03 = handles in front)
  return P;
});

// audit (QA r4): standing lateral raise pivots at 1.49 m (shoulder height on the 0.097 m foot plate); shrug-machine carriage starts at 0.82 m (hanging-hand height on the platform)
def('lateral-raise-machine', 'Lateral raise machine (seated)', 'Machines: upper body', 2, 'arm pads swing out about axes at shoulder height; chest pad', (o = {}) => {
  const P = piece(); const g = P.o; const standing = !!o.standing; const sh = standing ? 1.49 : 1.05;
  if (!standing) seatUnit(g, { seatH: 0.48, backH: 0 });
  spine(g, -0.95, 0.45, 0.75); tube(g, [0, 0.06, -0.38], [0, sh + 0.2, -0.38], 0.1);
  tube(g, [0, sh - 0.25, -0.38], [0, sh - 0.25, -0.28], 0.06); box(g, 0.24, 0.3, 0.02, MAT.frame, 0, sh - 0.25, -0.27, 0.005);
  pad(g, 0.32, 0.07, 0.5, 0, sh - 0.25, -0.225, [Math.PI / 2, 0, 0]); body(g, 'chest', 'chest', V(0, sh - 0.25, -0.19), V(0, 0, 1));
  tube(g, [-0.24, sh + 0.05, -0.38], [0.24, sh + 0.05, -0.38], 0.07);
  const st = weightStack(g, 0, -0.95, { h: 1.75 });
  const arms = [];
  for (const s of [-1, 1]) {
    tube(g, [s * 0.22, sh + 0.05, -0.38], [s * 0.22, sh, -0.1], 0.06);
    const a = pivot(g, V(s * 0.22, sh, -0.05), 'z'); arms.push([a, s]); hub(a, V(0, 0, -0.04), 'z', 0.045, 0.08);
    tube(a, [0, 0, 0], [s * 0.06, -0.58, 0.02], 0.05);
    pad(a, 0.08, 0.06, 0.24, s * 0.1, -0.4, 0.05, [0, 0, Math.PI / 2]); tube(a, [s * 0.04, -0.4, 0.02], [s * 0.07, -0.4, 0.05], 0.04);
    body(a, s > 0 ? 'upperArmL' : 'upperArmR', 'upperArm', V(s * 0.065, -0.4, 0.05), V(-s, 0, 0), V(0, 1, 0));
    handle(a, s > 0 ? 'gripL' : 'gripR', V(s * 0.06, -0.58, 0.02), V(s * 0.06, -0.58, 0.06), V(0, 0, 1), 0.12, { hand: s > 0 ? 'L' : 'R', orient: ['neutral'], palm: V(-s, 0, 0), info: { note: 'light hold; the arm pad does the work' } });
  }
  if (standing) { footPlate(g, 0.6, 0.45, V(0, 0.08, 0.15), 0, ['footL', 'footR'], 0.15); tube(g, [0, 0.065, 0.15], [0, 0.07, 0.15], 0.04); }
  else feetOnFloor(g, 0.4, 0.15);
  const cab = stackCable(g, st, [V(0, 1.8, -0.95), V(0, 1.8, -0.4), V(0, sh, -0.4)]);
  const set = m => { for (const [a, s] of arms) turn(a, s * (m * 1.35)); st.setLift(m * 0.35); cab(); };
  dof(P, 'motion', 'Raise', 0, 1, 0, '', set); set(0);
  return P;
});
def('standing-lateral-raise-machine', 'Lateral raise machine (standing)', 'Machines: upper body', 2, 'standing version with chest pad and tread platform', () => R['lateral-raise-machine']({ standing: true }));

function curlLeverMachine(P, g, { kind = 'curl' } = {}) {
  seatUnit(g, { seatH: 0.70, backH: 0, seatD: 0.34 }); // audit: high enough that the armpits reach the pad (was 0.55: shoulders sat below the elbows)
  spine(g, -0.4, 1.3, 0.75);
  tube(g, [0, 0.06, 0.55], [0, 0.92, 0.45], 0.09);
  const padG = new THREE.Group(); padG.position.set(0, 1.045, 0.336); padG.rotation.x = 0.34; g.add(padG); // audit: pad sits under the upper arms, sloping down to the elbow at the pivot (it sloped the wrong way)
  pad(padG, 0.5, 0.075, 0.34, 0, 0, 0); box(padG, 0.3, 0.02, 0.26, MAT.frame, 0, -0.048, 0); tube(padG, [0, -0.06, 0.05], [0, -0.12, 0.12], 0.06);
  body(padG, 'upperArms', 'upperArm', V(0, 0.04, 0), V(0, 1, 0));
  const st = weightStack(g, 0, 1.2, { h: 1.6 });
  for (const s of [-1, 1]) { tube(g, [0, 0.9, 0.45], [s * 0.33, 1.06, 0.53], 0.06); }
  const lever = pivot(g, V(0, 1.08, 0.53), 'x');
  for (const s of [-1, 1]) { hub(lever, V(s * 0.33, 0, 0), 'x', 0.05, 0.06); tube(lever, [s * 0.33, 0, 0], [s * 0.33, 0.0, -0.3], 0.045); }
  tube(lever, [-0.33, 0, -0.3], [0.33, 0, -0.3], 0.03, MAT.chrome, true, { caps: false });
  for (const s of [-1, 1]) {
    hgrip(lever, 0.016, 0.13, s * 0.17, 0, -0.3, 'x');
    grip(lever, s > 0 ? 'gripL' : 'gripR', V(s * 0.17, 0, -0.3), { radius: 0.016, length: 0.11, hand: s > 0 ? 'L' : 'R', orient: [kind === 'curl' ? 'underhand' : 'neutral'] }, V(1, 0, 0), kind === 'curl' ? V(0, 1, 0) : V(0, -1, 0));
  }
  body(g, 'elbowL', 'elbow', V(0.15, 1.08, 0.5)); body(g, 'elbowR', 'elbow', V(-0.15, 1.08, 0.5));
  feetOnFloor(g, 0.35, 0.15);
  const cab = stackCable(g, st, [V(0, 1.7, 1.2), V(0, 1.7, 0.6), V(0, 1.12, 0.6)]);
  return { st, lever, cab };
}
def('preacher-curl-machine', 'Preacher curl machine', 'Machines: upper body', 2, 'arm pad, lever pivots at the elbow, curl bar with two grips', () => {
  const P = piece(); const g = P.o; const { st, lever, cab } = curlLeverMachine(P, g, { kind: 'curl' });
  const set = m => { turn(lever, 3.75 - m * 2.44); st.setLift(m * 0.3); cab(); }; // audit: forearm from 35 deg below horizontal (pointing away) up past vertical; curling lifts the stack
  dof(P, 'motion', 'Curl', 0, 1, 0, '', set); set(0); return P;
});
def('triceps-extension-machine', 'Triceps extension machine', 'Machines: upper body', 2, 'arm pad, lever pushes down and out', () => {
  const P = piece(); const g = P.o; const { st, lever, cab } = curlLeverMachine(P, g, { kind: 'triceps' });
  const set = m => { turn(lever, 1.31 + m * 2.44); st.setLift(m * 0.3); cab(); }; // audit: from fully bent (hands by the head) to straight arms pointing away and down; extending lifts the stack
  dof(P, 'motion', 'Extend', 0, 1, 0, '', set); set(0); return P;
});

// audit (Nov 2, Aziz picked a real seated dip machine): sit with the back on the pad, neutral handles beside the chest
// on lever arms pivoting behind the hips; pressing down sweeps the handles down and slightly back to beside the hips.
def('seated-dip-machine', 'Seated dip machine', 'Machines: upper body', 2, 'seat and back pad; neutral handles on lever arms press down beside the hips', () => {
  const P = piece(); const g = P.o;
  seatUnit(g, { seatH: 0.47, backTilt: 0.1, backH: 0.72, backZ: -0.2 });
  spine(g, -0.95, 0.47, 0.75);
  const st = weightStack(g, 0, -0.95, { h: 1.75 });
  for (const s of [-1, 1]) { tube(g, [s * 0.42, 0.06, -0.48], [s * 0.42, 0.86, -0.48], 0.08); hub(g, V(s * 0.42, 0.8, -0.48), 'x', 0.06, 0.08); }
  tube(g, [-0.42, 0.45, -0.48], [0.42, 0.45, -0.48], 0.06); baseRail(g, [-0.42, 0, -0.48], [0.42, 0, -0.48], 0.07);
  const lever = pivot(g, V(0, 0.8, -0.48), 'x'); tube(lever, [-0.42, 0, 0], [0.42, 0, 0], 0.05, MAT.frame);
  for (const s of [-1, 1]) {
    bent(lever, [V(s * 0.38, 0, 0), V(s * 0.39, 0.02, 0.25), V(s * 0.37, 0.02, 0.44)], 0.045);
    hgrip(lever, 0.016, 0.13, s * 0.37, 0.02, 0.51, 'z'); cyl(lever, 0.0145, 0.012, MAT.cap, s * 0.37, 0.02, 0.582, 'z', 32); // ridged rubber grip with end cap
    grip(lever, s > 0 ? 'gripL' : 'gripR', V(s * 0.37, 0.02, 0.51), { radius: 0.016, length: 0.12, hand: s > 0 ? 'L' : 'R', orient: ['neutral'] }, V(0, 0, 1), V(0, 1, 0));
    box(lever, 0.05, 0.05, 0.03, MAT.frame, s * 0.37, 0.02, 0.43, 0.006);
  }
  feetOnFloor(g, 0.45, 0.2);
  const cab = stackCable(g, st, [V(0, 1.8, -0.95), V(0, 1.8, -0.55), V(0, 0.9, -0.55)]);
  const set = m => { turn(lever, -0.3 + m * 0.64); st.setLift(m * 0.3); cab(); }; // 0 = handles at chest height (elbows ~90 deg), 1 = pressed down, arms locked
  dof(P, 'motion', 'Press down', 0, 1, 0, '', set); set(0); return P;
});

def('pullover-machine', 'Pullover machine', 'Machines: upper body', 3, 'overhead lever with elbow pads and a bar', () => {
  const P = piece(); const g = P.o;
  seatUnit(g, { seatH: 0.45, backTilt: 0.15, backH: 0.8, backZ: -0.12 });
  spine(g, -1.0, 0.45, 0.95);
  for (const s of [-1, 1]) tube(g, [s * 0.44, 0.06, -0.32], [s * 0.44, 1.08, -0.32], 0.08);
  tube(g, [-0.44, 0.7, -0.32], [0.44, 0.7, -0.32], 0.06); tube(g, [0, 0.065, -0.32], [0, 0.7, -0.32], 0.07);
  const st = weightStack(g, 0, -1.0, { h: 1.7 });
  for (const s of [-1, 1]) tube(g, [s * 0.44, 1.0, -0.32], [s * 0.44, 1.0, -0.16], 0.06);
  const lever = pivot(g, V(0, 1.0, -0.16), 'x'); // audit: the cam axis sits on the lifter's shoulder joint, as on a real pullover machine
  for (const s of [-1, 1]) { hub(lever, V(s * 0.4, 0, 0), 'x', 0.055, 0.07); bent(lever, [V(s * 0.4, 0, 0), V(s * 0.38, 0.3, 0.07), V(s * 0.3, 0.55, 0.17)], 0.05);
    box(lever, 0.06, 0.02, 0.16, MAT.frame, s * 0.3, 0.27, 0.07, 0.004); pad(lever, 0.1, 0.06, 0.18, s * 0.27, 0.27, 0.11, [Math.PI / 2, 0, 0]); body(lever, s > 0 ? 'elbowL' : 'elbowR', 'elbow', V(s * 0.27, 0.27, 0.15), V(0, 0, 1)); tube(lever, [s * 0.37, 0.27, 0.06], [s * 0.3, 0.27, 0.07], 0.03); }
  // audit (round 3): bar 0.58 m from the shoulder axis (inside arm reach) so it sweeps clear over the head
  tube(lever, [-0.3, 0.55, 0.17], [0.3, 0.55, 0.17], 0.03, MAT.chrome, true, { caps: false });
  for (const s of [-1, 1]) { knurl(lever, 0.016, 0.14, s * 0.15, 0.55, 0.17, 'x'); grip(lever, s > 0 ? 'gripL' : 'gripR', V(s * 0.15, 0.55, 0.17), { radius: 0.016, length: 0.12, hand: s > 0 ? 'L' : 'R', orient: ['overhand'] }, V(1, 0, 0), V(0, 0, -1)); }
  feetOnFloor(g, 0.38, 0.15);
  const cab = stackCable(g, st, [V(0, 1.75, -1.0), V(0, 1.75, -0.35), V(0, 1.1, -0.35)]);
  const set = m => { turn(lever, -0.6 + m * 2.8); // 0 = arms up and back behind the head (stretch), 1 = bar at the stomach
    st.setLift(m * 0.4); cab(); }; dof(P, 'motion', 'Pullover', 0, 1, 0, '', set); set(0); return P;
});

def('shrug-machine', 'Shrug machine', 'Machines: upper body', 3, 'carriages ride on guide rods either side of a tread platform; neutral handles; plate horns', () => {
  const P = piece(); const g = P.o;
  footPlate(g, 0.75, 0.6, V(0, 0.08, 0), 0, ['footL', 'footR'], 0.15);
  for (const s of [-1, 1]) {
    const x = s * 0.5;
    baseRail(g, [x, 0, -0.45], [x, 0, 0.45], 0.08);
    for (const z of [-0.35, 0.35]) tube(g, [x, 0.06, z], [x, 1.45, z], 0.07);
    tube(g, [x, 1.45, -0.35], [x, 1.45, 0.35], 0.07); tube(g, [x, 0.06, -0.35], [x, 0.06, 0.35], 0.07);
    for (const z of [-0.12, 0.12]) cyl(g, 0.015, 1.36, MAT.chrome, x, 0.75, z, 'y', 24);
  }
  tube(g, [-0.5, 1.45, -0.35], [0.5, 1.45, -0.35], 0.07); tube(g, [-0.5, 0.06, -0.35], [0.5, 0.06, -0.35], 0.07);
  for (const s of [-1, 1]) tube(g, [s * 0.5, 0.06, 0], [s * 0.37, 0.06, 0], 0.06);
  const car = new THREE.Group(); g.add(car);
  for (const s of [-1, 1]) {
    const x = s * 0.5;
    for (const z of [-0.12, 0.12]) cyl(car, 0.03, 0.12, MAT.frameLight, x, 0, z, 'y', 32);
    box(car, 0.06, 0.08, 0.3, MAT.frame, x, 0, 0, 0.008);
    handle(car, s > 0 ? 'gripL' : 'gripR', V(x, 0, -0.04), V(s * 0.31, 0, -0.07), V(0, 0, 1), 0.16, { r: 0.017, hand: s > 0 ? 'L' : 'R', orient: ['neutral'], palm: V(0, -1, 0) });
    horn(car, V(x + s * 0.035, 0, 0), V(s, 0, 0));
  }
  const set = m => { car.position.y = 0.82 + m * 0.1; }; dof(P, 'motion', 'Shrug', 0, 1, 0, '', set); set(0); return P;
});

function rowMachine(P, g, { plates = true, high = false, low = false } = {}) {
  pad(g, 0.36, 0.075, 0.34, 0, 0.545, -0.05); tube(g, [0, 0.06, -0.05], [0, 0.38, -0.05], 0.08); tube(g, [0, 0.34, -0.05], [0, 0.5, -0.05], 0.06, MAT.frameLight); popPin(g, V(0.04, 0.38, -0.05), V(1, 0, 0)); body(g, 'seat', 'seat', V(0, 0.585, -0.05)); // audit: seat 8 cm higher so the chest meets the pad
  spine(g, -0.6, 1.25, 1.0);
  tube(g, [0, 0.06, 0.42], [0, 0.95, 0.42], 0.08); tube(g, [0, 0.95, 0.42], [0, 1.02, 0.36], 0.06);
  pad(g, 0.34, 0.08, 0.42, 0, 1.07, 0.3, [Math.PI / 2 + 0.15, 0, 0]); body(g, 'chest', 'chest', V(0, 1.07, 0.26), V(0, 0, -1));
  footPlate(g, 0.6, 0.22, V(0, 0.09, 0.5), 0, ['footL', 'footR'], 0.16);
  const arms = [];
  // high row (QA): neutral handles from (0.22, 1.6, 0.7) down and back to (0.22, 1.18, 0.3) beside the chest; pivot on the bisector, above the head
  const H0 = V(0, 1.6, 0.7), H1 = V(0, 1.18, 0.3), mid = H0.clone().add(H1).multiplyScalar(0.5), dd = H1.clone().sub(H0), bis = V(0, -dd.z, dd.y).normalize();
  if (bis.y < 0) bis.negate();
  const hp = mid.clone().addScaledVector(bis, 0.8);
  const pY = high ? hp.y : 1.75, pZ = high ? hp.z : 0.4;
  for (const s of [-1, 1]) { tube(g, [s * 0.32, 0.06, 1.1], [s * 0.32, pY + 0.05, 1.1], 0.09); baseRail(g, [s * 0.32, 0, 0.9], [s * 0.32, 0, 1.25], 0.08); tube(g, [s * 0.32, pY + 0.05, 1.1], [s * 0.32, pY + 0.05, pZ], 0.08); }
  tube(g, [-0.32, pY + 0.05, 1.1], [0.32, pY + 0.05, 1.1], 0.08);
  for (const s of [-1, 1]) {
    const a = pivot(g, V(s * 0.32, pY, pZ), 'x'); arms.push(a); hub(a, V(0, 0, 0), 'x', 0.055, 0.08);
    const hy = (high ? H0.y : low ? 0.88 : 1.02) - pY, hz = (high ? H0.z : low ? 0.8 : 0.75) - pZ; // low row: handles below the chest pad, pulled to the hips (0.88: clear above the thighs, audit QA)
    const E = V(-s * 0.1, hy, hz);
    // the arm ends on a vertical bar beside the neutral grip; brackets top and bottom hold the rubber grip clear (QA: grip was hidden inside the arm tube)
    const Q = E.clone().add(V(s * 0.06, 0, 0.0));
    bent(a, [V(0, -0.03, 0.02), V(s * 0.0, hy * 0.5, hz * 0.5), Q], 0.06);
    tube(a, Q.clone().add(V(0, -0.095, 0)), Q.clone().add(V(0, 0.095, 0)), 0.05);
    for (const dy of [-0.095, 0.095]) tube(a, Q.clone().add(V(0, dy, 0)), E.clone().add(V(0, dy, 0)), 0.04);
    handle(a, s > 0 ? 'neutralL' : 'neutralR', null, E.clone().add(V(0, -0.08, 0)), V(0, 1, 0), 0.15, { hand: s > 0 ? 'L' : 'R', orient: ['neutral'], palm: V(0, 0, -1) });
    handle(a, s > 0 ? 'gripL' : 'gripR', E.clone().add(V(0, 0.095, 0)), E.clone().add(V(s * 0.04, 0.12, -0.02)), V(s, 0, 0), 0.14, { hand: s > 0 ? 'L' : 'R', orient: ['overhand'], palm: V(0, 0, -1) });
    // plate horn on a short arm above and behind the pivot: rowing lifts the plates, and they stay clear of the lifter's head
    if (plates) { tube(a, [0, 0, 0], [s * 0.03, 0.2, -0.26], 0.06); horn(a, V(s * 0.04, 0.2, -0.28), V(s, 0, 0)); }
  }
  arms.ang = high ? -angX(H0.clone().sub(V(0, pY, pZ)), H1.clone().sub(V(0, pY, pZ))) : 0.75;
  return arms;
}
def('iso-row', 'Iso-lateral row (plate-loaded, chest-supported)', 'Machines: upper body', 1, 'chest pad, two independent arms with neutral and pronated grips; opts.high for high row', (o = {}) => {
  const P = piece(); const g = P.o; const arms = rowMachine(P, g, { plates: true, high: !!o.high });
  const set = m => arms.forEach(a => turn(a, m * arms.ang)); dof(P, 'motion', 'Row', 0, 1, 0, '', set); set(0); return P;
});
def('iso-high-row', 'Iso-lateral high row (plate-loaded)', 'Machines: upper body', 1, 'handles high in front, arms swing down and back to the shoulders', () => {
  const P = piece(); const g = P.o; const arms = rowMachine(P, g, { plates: true, high: true });
  const set = m => arms.forEach(a => turn(a, m * arms.ang)); dof(P, 'motion', 'Row', 0, 1, 0, '', set); set(0); return P;
});
def('iso-low-row', 'Iso-lateral low row (plate-loaded)', 'Machines: upper body', 1, 'handles low in front, pulled back toward the hips', () => {
  const P = piece(); const g = P.o; const arms = rowMachine(P, g, { plates: true, low: true });
  const set = m => arms.forEach(a => turn(a, m * 0.75)); dof(P, 'motion', 'Row', 0, 1, 0, '', set); set(0); return P;
});
def('seated-row-machine', 'Seated row machine (selectorised)', 'Machines: upper body', 2, 'same layout with a weight stack', () => {
  const P = piece(); const g = P.o; const arms = rowMachine(P, g, { plates: false }); const st = weightStack(g, 0, 1.45, { h: 1.75 });
  const cab = stackCable(g, st, [V(0, 1.8, 1.45), V(0, 1.8, 0.4)]);
  const set = m => { arms.forEach(a => turn(a, m * 0.75)); st.setLift(m * 0.4); cab(); }; dof(P, 'motion', 'Row', 0, 1, 0, '', set); set(0); return P;
});

def('pulldown-machine', 'Iso-lateral pulldown machine', 'Machines: upper body', 2, 'two arms swing down from an overhead frame; thigh roller; plate horns behind the pivots', () => {
  const P = piece(); const g = P.o;
  seatUnit(g, { seatH: 0.48, backH: 0, seatD: 0.36 });
  tube(g, [0, 0.06, 0.32], [0, 0.6, 0.32], 0.08); tube(g, [0, 0.6, 0.32], [0, 0.72, 0.2], 0.06); roller(g, 0.42, 0, 0.72, 0.18, 0.055);
  body(g, 'thighL', 'thigh', V(0.1, 0.665, 0.18), V(0, -1, 0)); body(g, 'thighR', 'thigh', V(-0.1, 0.665, 0.18), V(0, -1, 0));
  spine(g, -0.9, 0.6, 1.1);
  for (const s of [-1, 1]) { tube(g, [s * 0.5, 0.06, -0.65], [s * 0.5, 2.45, -0.65], 0.09); baseRail(g, [s * 0.5, 0, -0.9], [s * 0.5, 0, -0.4], 0.08); tube(g, [s * 0.5, 2.45, -0.65], [s * 0.5, 2.45, -0.25], 0.08); }
  tube(g, [-0.5, 2.45, -0.65], [0.5, 2.45, -0.65], 0.08); tube(g, [-0.5, 0.065, -0.65], [0.5, 0.065, -0.65], 0.07);
  const arms = [];
  for (const s of [-1, 1]) {
    const a = pivot(g, V(s * 0.5, 2.38, -0.28), 'x'); arms.push(a); hub(a, V(0, 0, 0), 'x', 0.055, 0.08);
    const E = V(-s * 0.08, -0.32, 0.55);
    bent(a, [V(-s * 0.04, 0, 0.02), V(-s * 0.06, -0.08, 0.3), E], 0.06);
    handle(a, s > 0 ? 'gripL' : 'gripR', null, E.clone(), V(-s, -0.25, 0).normalize(), 0.15, { hand: s > 0 ? 'L' : 'R', orient: ['overhand', 'neutral'], palm: V(0, -1, 0) });
    tube(a, [0, 0, 0], [-s * 0.02, 0.12, -0.3], 0.06); horn(a, V(-s * 0.02, 0.12, -0.32), V(s, 0, 0));
  }
  feetOnFloor(g, 0.42, 0.15);
  const set = m => arms.forEach(a => turn(a, m * 0.85)); dof(P, 'motion', 'Pull', 0, 1, 0, '', set); set(0); return P;
});

def('t-bar-row', 'Chest-supported T-bar row', 'Machines: upper body', 2, 'inclined chest pad, tread platform, lever with wide and neutral handles, plate post', () => {
  const P = piece(); const g = P.o;
  spine(g, -1.45, 0.6, 0.7);
  footPlate(g, 0.55, 0.3, V(0, 0.32, -0.45), 0, ['footL', 'footR'], 0.12); tube(g, [0, 0.065, -0.45], [0, 0.3, -0.45], 0.07);
  const cp = new THREE.Group(); cp.position.set(0, 1.0, 0.0); cp.rotation.x = -0.75; g.add(cp);
  pad(cp, 0.34, 0.08, 0.6, 0, 0, 0); box(cp, 0.2, 0.02, 0.4, MAT.frame, 0, -0.05, 0); body(cp, 'chest', 'chest', V(0, 0.045, 0), V(0, 1, 0));
  for (const s of [-1, 1]) tube(g, [s * 0.14, 0.065, 0.25], [s * 0.14, 0.95, 0.05], 0.07); // audit: two pad posts so the lever passes between them
  const lever = pivot(g, V(0, 0.22, -1.4), 'x'); tube(g, [0, 0.065, -1.4], [0, 0.22, -1.4], 0.08); hub(lever, V(0, 0, 0), 'x', 0.05, 0.12);
  tube(lever, [0, 0, 0.04], [0, 0.0, 1.85], 0.07);
  // audit: plates hang on side horns just past the handles, beside the arms and below the chest pad (they used to rise above the head)
  tube(lever, [-0.38, 0, 1.75], [0.38, 0, 1.75], 0.05); for (const s of [-1, 1]) horn(lever, V(s * 0.38, 0, 1.75), V(s, 0, 0), [10, 10]);
  tube(lever, [-0.28, 0, 1.6], [0.28, 0, 1.6], 0.05);
  for (const s of [-1, 1]) {
    handle(lever, s > 0 ? 'gripL' : 'gripR', V(s * 0.28, 0, 1.6), V(s * 0.28, -0.1, 1.6), V(s, -0.2, 0).normalize(), 0.15, { hand: s > 0 ? 'L' : 'R', orient: ['overhand'], palm: V(0, -1, 0) });
    handle(lever, s > 0 ? 'neutralL' : 'neutralR', V(s * 0.03, 0, 1.45), V(s * 0.11, -0.13, 1.42), V(0, 0, 1), 0.14, { hand: s > 0 ? 'L' : 'R', orient: ['neutral'], palm: V(0, -1, 0) });
  }
  const set = m => turn(lever, -0.05 - m * 0.5); dof(P, 'motion', 'Row', 0, 1, 0, '', set); set(0); return P;
});

def('assisted-pullup-dip', 'Assisted pull-up / dip machine', 'Machines: upper body', 2, 'knee platform on a lever lifts the body; pull-up, neutral and dip handles; steps', () => {
  const P = piece(); const g = P.o;
  for (const s of [-1, 1]) { tube(g, [s * 0.5, 0.06, -0.5], [s * 0.5, 2.38, -0.5], 0.09); baseRail(g, [s * 0.5, 0, -1.0], [s * 0.5, 0, 0.5], 0.09); tube(g, [s * 0.5, 2.38, -0.5], [s * 0.5, 2.32, 0.05], 0.07); tube(g, [s * 0.5, 0.06, 0.4], [s * 0.5, 0.6, -0.48], 0.05); }
  tube(g, [-0.5, 2.38, -0.5], [0.5, 2.38, -0.5], 0.08);
  const st = weightStack(g, 0, -0.78, { h: 2.05 });
  knurl(g, 0.016, 0.94, 0, 2.32, 0.05, 'x');
  grip(g, 'pullupL', V(0.3, 2.32, 0.05), { radius: 0.016, length: 0.3, hand: 'L', orient: ['overhand', 'underhand'] }, V(1, 0, 0), V(0, -1, 0)); grip(g, 'pullupR', V(-0.3, 2.32, 0.05), { radius: 0.016, length: 0.3, hand: 'R', orient: ['overhand', 'underhand'] }, V(1, 0, 0), V(0, -1, 0));
  handlePair(g, ['neutralL', 'neutralR'], s => V(s * 0.45, 2.32, 0.05), s => V(s * 0.26, 2.2, 0.08), s => V(0, 0, 1), 0.15, { orient: ['neutral'], palm: V(0, -1, 0) });
  for (const s of [-1, 1]) {
    tube(g, [s * 0.5, 1.3, -0.5], [s * 0.27, 1.3, -0.18], 0.06);
    handle(g, s > 0 ? 'dipL' : 'dipR', null, V(s * 0.27, 1.3, -0.15), V(0, 0, 1), 0.32, { r: 0.017, hand: s > 0 ? 'L' : 'R', orient: ['neutral'], palm: V(0, 1, 0) });
    tube(g, [s * 0.5, 0.55, -0.15], [s * 0.2, 0.55, -0.15], 0.04); box(g, 0.16, 0.025, 0.2, MAT.frame, s * 0.2, 0.56, -0.15, 0.005); box(g, 0.15, 0.004, 0.19, MAT.rubber, s * 0.2, 0.574, -0.15, 0.002);
    foot(g, s > 0 ? 'stepL' : 'stepR', V(s * 0.2, 0.576, -0.15));
  }
  // audit (Aziz 17:31): full machine lever - twin side arms hinge on the main uprights, a cross tube carries a wide kneeling pad;
  // the pad tracks the kneeling knees almost straight up (0.80 -> 1.26 m); the stack rises as the pad drops (it is the counterweight)
  for (const s of [-1, 1]) { hub(g, V(s * 0.5, 1.04, -0.55), 'x', 0.06, 0.1); box(g, 0.05, 0.16, 0.1, MAT.frame, s * 0.5, 1.04, -0.52, 0.006); }
  tube(g, [-0.5, 1.04, -0.55], [0.5, 1.04, -0.55], 0.05);
  const lever = pivot(g, V(0, 1.04, -0.55), 'x');
  for (const s of [-1, 1]) { hub(lever, V(s * 0.44, 0, 0), 'x', 0.05, 0.08); bent(lever, [V(s * 0.44, 0, 0), V(s * 0.42, -0.02, 0.3), V(s * 0.3, -0.03, 0.6)], 0.06); }
  tube(lever, [-0.3, -0.03, 0.6], [0.3, -0.03, 0.6], 0.06); tube(lever, [-0.44, 0, 0.05], [0.44, 0, 0.05], 0.05);
  tube(lever, [0, -0.03, 0.6], [0, 0.0, 0.6], 0.07); box(lever, 0.46, 0.02, 0.34, MAT.frame, 0, 0.022, 0.6, 0.006);
  pad(lever, 0.52, 0.085, 0.36, 0, 0.075, 0.6);
  for (const s of [-1, 1]) cyl(lever, 0.03, 0.03, MAT.rubber, s * 0.42, -0.02, 0.32, 'y', 16); // bumper
  body(lever, 'kneeL', 'knee', V(0.09, 0.11, 0.6)); body(lever, 'kneeR', 'knee', V(-0.09, 0.11, 0.6));
  const cab = stackCable(g, st, [V(0, 2.12, -0.78), V(0, 2.12, -0.55), V(0, 1.1, -0.55)]);
  const set = m => { turn(lever, 0.58 - m * 0.77); st.setLift((1 - m) * 0.35); cab(); }; dof(P, 'motion', 'Platform', 0, 1, 0, '', set); set(0); return P; // 0 = pad low (arms straight), 1 = pad high (chin over the bar)
});

def('ab-crunch-machine', 'Ab crunch machine', 'Machines: core', 2, 'chest pad and overhead handles on a lever, foot rollers', () => {
  const P = piece(); const g = P.o;
  seatUnit(g, { seatH: 0.5, backTilt: 0.1, backH: 0.6, backZ: -0.15 });
  spine(g, -1.0, 0.65, 0.85); roller(g, 0.38, 0, 0.2, 0.42); roller(g, 0.38, 0, 0.2, 0.56); tube(g, [0, 0.065, 0.49], [0, 0.2, 0.49], 0.06);
  foot(g, 'footL', V(0.1, 0.14, 0.49), V(0, 0, 1)); foot(g, 'footR', V(-0.1, 0.14, 0.49), V(0, 0, 1));
  for (const s of [-1, 1]) tube(g, [s * 0.38, 0.06, -0.32], [s * 0.38, 1.05, -0.32], 0.08);
  tube(g, [-0.38, 0.065, -0.32], [0.38, 0.065, -0.32], 0.07);
  const st = weightStack(g, 0, -1.0, { h: 1.7 });
  // audit (Aziz Nov 2 18:21): the lever pivots at low-back height beside the hips, so the chest pad travels forward and down
  // with the lifter's upper chest as he curls (it used to swing about a point behind the shoulders and pass through the chest)
  const LY = 0.62, lever = pivot(g, V(0, LY, -0.15), 'x');
  for (const s of [-1, 1]) { hub(g, V(s * 0.38, LY, -0.32), 'x', 0.045, 0.07); tube(g, [s * 0.38, LY, -0.32], [s * 0.36, LY, -0.15], 0.05);
    hub(lever, V(s * 0.36, 0, 0), 'x', 0.04, 0.06); bent(lever, [V(s * 0.36, 0, 0), V(s * 0.35, 0.3, 0.1), V(s * 0.22, 0.52, 0.19)], 0.045);
    handle(lever, s > 0 ? 'gripL' : 'gripR', null, V(s * 0.2, 0.56, 0.2), V(0, -0.3, 1).normalize(), 0.13, { hand: s > 0 ? 'L' : 'R', orient: ['neutral'], palm: V(-s, 0, 0) }); }   // audit: handles point forward beside the head (wrists straight)
  tube(lever, [-0.35, 0.32, 0.14], [0.35, 0.32, 0.14], 0.04); box(lever, 0.24, 0.16, 0.06, MAT.frame, 0, 0.34, 0.19, 0.005);
  pad(lever, 0.36, 0.07, 0.24, 0, 0.34, 0.255, [Math.PI / 2, 0, 0]); body(lever, 'chest', 'chest', V(0, 0.34, 0.29), V(0, 0, -1));
  const cab = stackCable(g, st, [V(0, 1.75, -1.0), V(0, 1.75, -0.32), V(0, LY, -0.32)]);
  const set = m => { turn(lever, m * 0.7); st.setLift(m * 0.3); cab(); }; dof(P, 'motion', 'Crunch', 0, 1, 0, '', set); set(0); return P;
});

def('torso-rotation-machine', 'Torso rotation machine', 'Machines: core', 3, 'fixed seat with knee pads; the chest pad and handles rotate with the torso', () => {
  const P = piece(); const g = P.o;
  spine(g, -0.95, 0.55, 0.75);
  pad(g, 0.4, 0.075, 0.38, 0, 0.46, 0); tube(g, [0, 0.065, 0], [0, 0.41, 0], 0.08); body(g, 'seat', 'seat', V(0, 0.5, 0));
  for (const s of [-1, 1]) { tube(g, [0, 0.3, 0.05], [s * 0.15, 0.48, 0.28], 0.04); pad(g, 0.11, 0.06, 0.11, s * 0.15, 0.53, 0.3, [Math.PI / 2, 0, 0]); body(g, s > 0 ? 'kneeL' : 'kneeR', 'knee', V(s * 0.15, 0.53, 0.27), V(0, 0, -1)); }
  footPlate(g, 0.45, 0.18, V(0, 0.09, 0.4), 0, ['footL', 'footR'], 0.12); tube(g, [0, 0.065, 0.4], [0, 0.08, 0.4], 0.05);
  tube(g, [0, 0.06, -0.45], [0, 1.55, -0.45], 0.1); tube(g, [0, 1.55, -0.45], [0, 1.55, -0.1], 0.08);
  const top = pivot(g, V(0, 1.5, -0.05), 'y'); hub(top, V(0, 0.04, 0), 'y', 0.06, 0.08);
  tube(top, [0, 0, 0], [0, -0.15, -0.25], 0.06); tube(top, [0, -0.15, -0.25], [0, -0.55, -0.3], 0.06); box(top, 0.26, 0.4, 0.02, MAT.frame, 0, -0.45, -0.28, 0.005);
  pad(top, 0.4, 0.07, 0.5, 0, -0.45, -0.235, [Math.PI / 2, 0, 0]); body(top, 'back', 'back', V(0, -0.45, -0.2), V(0, 0, 1));
  for (const s of [-1, 1]) { tube(top, [0, -0.1, -0.25], [s * 0.3, -0.25, 0.0], 0.04);
    handle(top, s > 0 ? 'gripL' : 'gripR', null, V(s * 0.3, -0.25, 0.0), V(0, -1, 0.15).normalize(), 0.14, { hand: s > 0 ? 'L' : 'R', orient: ['neutral'], palm: V(-s, 0, 0) }); }
  const st = weightStack(g, 0, -0.95, { h: 1.6 });
  const cab = stackCable(g, st, [V(0, 1.65, -0.95), V(0, 1.65, -0.45)]);
  const set = m => { turn(top, (m - 0.5) * 1.2); st.setLift(Math.abs(m - 0.5) * 0.4); cab(); }; dof(P, 'motion', 'Rotate', 0, 1, 0.5, '', set); set(0.5); return P;
});

def('back-extension-machine', 'Back extension machine (seated)', 'Machines: core', 3, 'back pad on a lever, tread foot plate, thigh roller', () => {
  const P = piece(); const g = P.o;
  pad(g, 0.4, 0.075, 0.38, 0, 0.46, 0); tube(g, [0, 0.065, 0], [0, 0.41, 0], 0.08); body(g, 'seat', 'seat', V(0, 0.5, 0));
  spine(g, -0.95, 0.65, 0.8);
  footPlate(g, 0.45, 0.28, V(0, 0.3, 0.47), -1.2, ['footL', 'footR'], 0.1, V(0, 0, 1)); tube(g, [0, 0.065, 0.55], [0, 0.25, 0.5], 0.06);
  tube(g, [0, 0.065, 0.32], [0, 0.6, 0.32], 0.07); tube(g, [0, 0.6, 0.32], [0, 0.63, 0.2], 0.05); roller(g, 0.42, 0, 0.63, 0.2, 0.05); body(g, 'thighs', 'thigh', V(0, 0.58, 0.2), V(0, -1, 0));
  tube(g, [0, 0.065, -0.35], [0, 0.55, -0.35], 0.09);
  const lever = pivot(g, V(0, 0.55, -0.15), 'x'); hub(g, V(0, 0.55, -0.15), 'x', 0.05, 0.12); tube(g, [0, 0.55, -0.35], [0, 0.55, -0.2], 0.07);
  pad(lever, 0.36, 0.075, 0.3, 0, 0.55, -0.075, [Math.PI / 2, 0, 0]); box(lever, 0.24, 0.24, 0.02, MAT.frame, 0, 0.55, -0.125, 0.005); tube(lever, [0, 0, -0.15], [0, 0.55, -0.15], 0.06);
  body(lever, 'back', 'back', V(0, 0.55, -0.035), V(0, 0, 1));
  for (const s of [-1, 1]) { tube(g, [0, 0.35, 0.0], [s * 0.26, 0.4, 0.05], 0.04); handle(g, s > 0 ? 'gripL' : 'gripR', null, V(s * 0.26, 0.4, 0.05), V(0, 0, 1), 0.13, { hand: s > 0 ? 'L' : 'R', orient: ['neutral'], palm: V(0, -1, 0) }); }
  const st = weightStack(g, 0, -0.95, { h: 1.6 });
  const cab = stackCable(g, st, [V(0, 1.65, -0.95), V(0, 1.65, -0.35), V(0, 0.6, -0.3)]);
  const set = m => { turn(lever, 0.5 - m * 0.75); st.setLift(m * 0.3); cab(); }; dof(P, 'motion', 'Extend', 0, 1, 0, '', set); set(0); return P;
});

// ================================================================= LEG MACHINES
const along = (A, d, t) => A.clone().addScaledVector(d, t);
// linear bearing block riding a rail (local frame: rail along Y)
function bearing(p, pos, q) { const g = new THREE.Group(); g.position.copy(pos); if (q) g.quaternion.copy(q); p.add(g); box(g, 0.1, 0.16, 0.1, MAT.frameLight, 0, 0, 0, 0.01); for (const k of [-1, 1]) { cyl(g, 0.012, 0.11, MAT.steel, k * 0.035, 0, 0.052, 'y', 16); for (const j of [-1, 1]) bolt(g, V(k * 0.032, j * 0.06, 0.05), V(0, 0, 1), 0.006); } return g; }
// chain of links between two points, updater
function chainLine(p, n = 18) {
  const geo = new THREE.TorusGeometry(0.012, 0.0032, 8, 18); geo.scale(1, 1.6, 1);
  const L = []; for (let i = 0; i < n; i++) L.push(mesh(geo, MAT.steel, p));
  return { update(a, b) { const d = b.clone().sub(a); const q = new THREE.Quaternion().setFromUnitVectors(UP, d.clone().normalize()); const len = d.length(), step = 0.03;
    L.forEach((o, i) => { const t = i * step; o.visible = t < len; o.position.copy(a).addScaledVector(d, Math.min(1, t / len)); o.quaternion.copy(q); o.rotateY(i % 2 ? Math.PI / 2 : 0); }); } };
}
// side-mounted cam plate on a lever pivot (round plate with lightening holes)
function cam(p, r = 0.09, w = 0.02, axis = 'x') {
  const holesP = [0, 1, 2].map(i => { const q = new THREE.Path(); const a = i * Math.PI * 2 / 3; q.absarc(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55, r * 0.18, 0, Math.PI * 2, true); return q; });
  const s = new THREE.Shape(); s.absarc(0, 0, r, 0, Math.PI * 2, false); s.holes.push(...holesP);
  const g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 2, curveSegments: 48 }); g.translate(0, 0, -w / 2);
  if (axis === 'x') g.rotateY(Math.PI / 2); else if (axis === 'y') g.rotateX(Math.PI / 2);
  return mesh(g, MAT.frameLight, p);
}
// seat-side handles fixed to the seat frame (pointing forward)
function seatHandles(g, y, z, x = 0.27, axis = V(0, 0, 1), names = ['gripL', 'gripR']) {
  for (const s of [-1, 1]) { tube(g, [0, y - 0.06, z - 0.06], [s * (x - 0.02), y - 0.06, z - 0.06], 0.04); handle(g, s > 0 ? names[0] : names[1], V(s * x, y - 0.06, z - 0.06), V(s * x, y, z), axis, 0.13, { hand: s > 0 ? 'L' : 'R', orient: ['neutral'], palm: V(-s, 0, 0) }); }
}

def('leg-press', '45-degree leg press', 'Machines: legs', 1, 'reclined seat; sled with linear bearings on 45 deg rails; two plate horns per side; safety handles; motion = sled travel', () => {
  const P = piece(); const g = P.o; const ang = Math.PI / 4;
  const dir = V(0, Math.sin(ang), Math.cos(ang)), ndown = V(0, -Math.cos(ang), Math.sin(ang));
  const H = V(0, 0.48, 0.0), R0 = along(H, ndown, 0.3);
  // base frame
  for (const s of [-1, 1]) baseRail(g, [s * 0.36, 0, -0.95], [s * 0.36, 0, 1.5], 0.09);
  for (const z of [-0.95, 0.15, 1.5]) tube(g, [-0.36, 0.07, z], [0.36, 0.07, z], 0.08);
  // inclined rails with guide rods and safety stops
  const r1 = along(R0, dir, 0.05), r2 = along(R0, dir, 1.6);
  for (const s of [-1, 1]) {
    const A = r1.clone().setX(s * 0.3), B = r2.clone().setX(s * 0.3);
    tube(g, A, B, 0.09); bent(g, [along(A, ndown, -0.06), along(B, ndown, -0.06)], 0.028, MAT.chrome);
    holes(g, along(A, dir, 0.3).addScaledVector(V(s, 0, 0), 0.046).toArray(), along(A, dir, 1.3).addScaledVector(V(s, 0, 0), 0.046).toArray(), 12, V(s, 0, 0), 0.008);
    tube(g, [s * 0.3, 0.07, A.z], A, 0.08); tube(g, [s * 0.3, 0.07, B.z], B, 0.09); tube(g, [s * 0.3, 0.07, (A.z + B.z) / 2], along(A, dir, 0.775), 0.07);
    tube(g, [s * 0.36, 0.07, B.z], [s * 0.3, 0.07, B.z], 0.08);
  }
  tube(g, r2.clone().setX(-0.3), r2.clone().setX(0.3), 0.08); tube(g, r1.clone().setX(-0.3), r1.clone().setX(0.3), 0.08);
  // bumper stops at the bottom
  for (const s of [-1, 1]) cyl(g, 0.03, 0.05, MAT.rubber, s * 0.3, along(r1, dir, 0.04).y + 0.045, along(r1, dir, 0.04).z - 0.045, 'z', 24);
  // seat and reclined back on a cradle
  pad(g, 0.5, 0.08, 0.4, 0, 0.42, -0.02, [-0.18, 0, 0]); body(g, 'seat', 'seat', V(0, 0.47, -0.02));
  const bk = new THREE.Group(); bk.position.set(0, 0.46, -0.24); bk.rotation.x = -1.0; g.add(bk);
  pad(bk, 0.5, 0.08, 0.8, 0, 0.42, -0.04, [Math.PI / 2, 0, 0]); body(bk, 'back', 'back', V(0, 0.42, 0.0), V(0, 0, 1));
  pad(bk, 0.26, 0.07, 0.14, 0, 0.9, 0.0, [Math.PI / 2 + 0.2, 0, 0]); body(bk, 'head', 'head', V(0, 0.9, 0.04), V(0, 0, 1));
  tube(bk, [0, 0.0, -0.1], [0, 0.85, -0.1], 0.07); box(bk, 0.28, 0.6, 0.02, MAT.frame, 0, 0.45, -0.085);
  tube(g, [0, 0.07, -0.95], along(V(0, 0.46, -0.24), V(0, Math.cos(1.0), -Math.sin(1.0)), 0.7).add(V(0, 0, -0.08)), 0.08);
  tube(g, [0, 0.07, -0.02], [0, 0.36, -0.02], 0.09); box(g, 0.3, 0.02, 0.3, MAT.frame, 0, 0.37, -0.02);
  tube(g, [0, 0.07, -0.6], [0, 0.07, 0.15], 0.09);
  seatHandles(g, 0.5, 0.05, 0.31);
  // sled: local +Z up the rails, -Z faces the user, local -Y toward the rails
  const sled = new THREE.Group(); sled.rotation.x = -ang; g.add(sled);
  box(sled, 0.8, 0.62, 0.03, MAT.frame, 0, 0.0, 0.0, 0.01); box(sled, 0.76, 0.58, 0.006, MAT.rubber, 0, 0, -0.018, 0.003);
  for (let i = 0; i < 18; i++) box(sled, 0.72, 0.008, 0.004, MAT.rubber, 0, -0.27 + i * 0.032, -0.022, 0.001);
  foot(sled, 'footL', V(0.15, 0.02, -0.025), V(0, 1, 0), V(0, 0, -1)); foot(sled, 'footR', V(-0.15, 0.02, -0.025), V(0, 1, 0), V(0, 0, -1));
  for (const s of [-1, 1]) {
    tube(sled, [s * 0.3, -0.3, 0.04], [s * 0.3, 0.3, 0.04], 0.06); tube(sled, [s * 0.3, -0.3, 0.04], [s * 0.3, -0.3, 0.45], 0.06);
    bearing(sled, V(s * 0.3, -0.3, 0.3), new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), Math.PI / 2));
    tube(sled, [s * 0.3, 0.3, 0.04], [s * 0.3, -0.25, 0.42], 0.05);
    horn(sled, V(s * 0.33, -0.12, 0.25), V(s, 0, 0), [20, 20]);
    // safety catch lever on the sled side
    handle(sled, s > 0 ? 'stopL' : 'stopR', V(s * 0.3, -0.2, 0.0), V(s * 0.43, -0.2, -0.05), V(0, 1, 0), 0.12, { hand: s > 0 ? 'L' : 'R', orient: ['neutral'], palm: V(0, 0, 1), info: { note: 'safety stop release' } });
  }
  tube(sled, [-0.3, -0.3, 0.3], [0.3, -0.3, 0.3], 0.06); tube(sled, [-0.3, 0.0, 0.05], [0.3, 0.0, 0.05], 0.05);
  const set = m => { sled.position.copy(along(H, dir, 0.5 + 0.42 * m)); };
  dof(P, 'motion', 'Press (0 = knees bent)', 0, 1, 1, '', set); set(1); return P;
});

function hackSquatFrame(g, ang) {
  const dir = V(0, Math.sin(ang), -Math.cos(ang)), n = V(0, Math.cos(ang), Math.sin(ang));
  const Rb = V(0, 0.25, 0.08).addScaledVector(n, -0.24);
  for (const s of [-1, 1]) baseRail(g, [s * 0.4, 0, -1.45], [s * 0.4, 0, 0.5], 0.09);
  for (const z of [-1.45, -0.5, 0.5]) tube(g, [-0.4, 0.07, z], [0.4, 0.07, z], 0.08);
  const A = along(Rb, dir, 0.3), B = along(Rb, dir, 2.0);
  for (const s of [-1, 1]) {
    const a = A.clone().setX(s * 0.2), b = B.clone().setX(s * 0.2);
    tube(g, a, b, 0.08); bent(g, [along(a, n, 0.055), along(b, n, 0.055)], 0.03, MAT.chrome);
    tube(g, [s * 0.2, 0.07, a.z], a, 0.08); tube(g, [s * 0.4, 0.07, b.z], [s * 0.4, b.y + 0.05, b.z], 0.09); tube(g, [s * 0.4, b.y, b.z], b, 0.08);
    holes(g, along(a, dir, 0.25).add(V(s * 0.041, 0, 0)).toArray(), along(a, dir, 1.4).add(V(s * 0.041, 0, 0)).toArray(), 10, V(s, 0, 0), 0.008);
    tube(g, [s * 0.4, 0.07, (a.z + b.z) / 2], along(a, dir, 0.85), 0.07);
    cyl(g, 0.03, 0.05, MAT.rubber, s * 0.2, along(a, n, 0.08).y + 0.03, along(a, n, 0.08).z, 'y', 24);
  }
  tube(g, A.clone().setX(-0.2), A.clone().setX(0.2), 0.08); tube(g, [-0.4, B.y + 0.05, B.z], [0.4, B.y + 0.05, B.z], 0.09);
  // angled foot platform on a welded frame
  const fp = footPlate(g, 0.82, 0.6, V(0, 0.25, 0.12), -0.3, ['footL', 'footR'], 0.15);
  tube(g, [-0.38, 0.07, -0.15], [-0.38, 0.17, -0.12], 0.06); tube(g, [0.38, 0.07, -0.15], [0.38, 0.17, -0.12], 0.06);
  tube(g, [-0.38, 0.07, 0.45], [-0.38, 0.33, 0.36], 0.06); tube(g, [0.38, 0.07, 0.45], [0.38, 0.33, 0.36], 0.06);
  return { dir, n, Rb, fp };
}
// back pad + shoulder pads + handles on a sled (local +Y up the rails, +Z toward the user)
function hackSled(q) {
  pad(q, 0.38, 0.08, 0.8, 0, 0, 0, [Math.PI / 2, 0, 0]); body(q, 'back', 'back', V(0, 0, 0.045), V(0, 0, 1));
  box(q, 0.3, 0.7, 0.02, MAT.frame, 0, 0, -0.05); for (const s of [-1, 1]) tube(q, [s * 0.2, -0.4, -0.09], [s * 0.2, 0.45, -0.09], 0.07);
  tube(q, [-0.2, 0.45, -0.09], [0.2, 0.45, -0.09], 0.07); tube(q, [-0.2, -0.35, -0.09], [0.2, -0.35, -0.09], 0.07);
  for (const s of [-1, 1]) {
    tube(q, [s * 0.14, 0.45, -0.09], [s * 0.14, 0.47, 0.05], 0.05);
    pad(q, 0.11, 0.08, 0.24, s * 0.13, 0.47, 0.13, [0.15, 0, 0]); body(q, s > 0 ? 'shoulderL' : 'shoulderR', 'shoulder', V(s * 0.13, 0.43, 0.14), V(0, -1, 0));
    handle(q, s > 0 ? 'gripL' : 'gripR', V(s * 0.2, 0.42, -0.09), V(s * 0.27, 0.4, 0.2), V(0, 0.2, 1).normalize(), 0.13, { hand: s > 0 ? 'L' : 'R', orient: ['neutral'], palm: V(0, -1, 0) });
    bearing(q, V(s * 0.2, 0.25, -0.17)); bearing(q, V(s * 0.2, -0.25, -0.17));
  }
}

def('hack-squat', 'Hack squat', 'Machines: legs', 1, 'back and shoulder pads on a sled with linear bearings; angled tread platform; plate horns', () => {
  const P = piece(); const g = P.o; const ang = 0.82; // audit (Aziz: more inclined): rail ~47 deg (was 55)
  const { dir, n, Rb } = hackSquatFrame(g, ang);
  const sled = new THREE.Group(); g.add(sled); const q = new THREE.Group(); q.rotation.x = -(Math.PI / 2 - ang); sled.add(q);
  hackSled(q);
  for (const s of [-1, 1]) horn(q, V(s * 0.24, -0.3, -0.12), V(s, 0, 0), [20, 20]);
  const set = m => sled.position.copy(along(Rb, dir, 0.82 + m * 0.5).addScaledVector(n, 0.31));
  dof(P, 'motion', 'Stand (0 = bottom)', 0, 1, 1, '', set); set(1); return P;
});

def('pendulum-squat', 'Pendulum squat', 'Machines: legs', 1, 'tall rear A-frame with the pivot above and behind the head; a wide yoke swings from it carrying the back pad, shoulder pads and handles; plate horns on the yoke sides beside the shoulders; raised angled foot platform; the pads swing down and back in an arc; motion 0 = bottom, 1 = standing', () => {
  const P = piece(); const g = P.o;
  for (const s of [-1, 1]) baseRail(g, [s * 0.5, 0, -1.0], [s * 0.5, 0, 0.75], 0.09);
  for (const z of [-1.0, 0.75]) tube(g, [-0.5, 0.07, z], [0.5, 0.07, z], 0.08);
  // raised, angled tread platform under the feet
  box(g, 0.86, 0.05, 0.62, MAT.frame, 0, 0.2, 0.22, 0.01);
  for (const s of [-1, 1]) for (const z of [-0.05, 0.5]) tube(g, [s * 0.4, 0.07, z], [s * 0.4, 0.18, z], 0.06);
  footPlate(g, 0.8, 0.58, V(0, 0.26, 0.22), -0.2, ['footL', 'footR'], 0.15);
  // rear A-frame with the pivot above and behind the head
  const PV = V(0, 2.2, -0.7);
  for (const s of [-1, 1]) {
    tube(g, [s * 0.5, 0.07, -1.0], [s * 0.5, PV.y + 0.05, PV.z], 0.1); tube(g, [s * 0.5, 0.07, -0.3], [s * 0.5, PV.y - 0.1, PV.z + 0.02], 0.09);
    tube(g, [s * 0.5, 0.9, -0.85], [s * 0.5, 0.9, -0.41], 0.06);
    cyl(g, 0.03, 0.05, MAT.rubber, s * 0.5, 1.35, -0.42, 'z', 24); // bottom stop bumper
    horn(g, V(s * 0.55, 0.5, -0.92), V(s, 0, 0), []); horn(g, V(s * 0.55, 0.95, -0.92), V(s, 0, 0), s > 0 ? [20] : []); // storage pegs
  }
  tube(g, [-0.5, PV.y + 0.05, PV.z], [0.5, PV.y + 0.05, PV.z], 0.09);
  const arm = pivot(g, PV, 'x'); hub(arm, V(0, 0, 0), 'x', 0.065, 0.86);
  // arm-local points at rest (standing): back pad centre (0,-0.92,0.52), shoulder pads above it
  const q = new THREE.Group(); q.position.set(0, -0.92, 0.52); q.rotation.x = -0.12; arm.add(q); hackSled(q);
  for (const s of [-1, 1]) {
    bent(arm, [V(s * 0.42, 0, 0), V(s * 0.44, -0.3, 0.12), V(s * 0.38, -0.7, 0.36), V(s * 0.24, -0.85, 0.44)], 0.075, MAT.frame);
    tube(arm, [s * 0.38, -0.7, 0.36], [s * 0.36, -0.62, 0.2], 0.06);
    horn(arm, V(s * 0.4, -0.62, 0.2), V(s, 0, 0), [20, 20]);
  }
  tube(arm, [-0.24, -0.85, 0.44], [0.24, -0.85, 0.44], 0.06);
  const ang = 0.5 / 0.83;
  const set = m => turn(arm, ang * (1 - m)); dof(P, 'motion', 'Stand (0 = bottom)', 0, 1, 1, '', set); set(1); return P;
});

def('belt-squat', 'Belt squat', 'Machines: legs', 3, 'raised tread platform, lever arm with chain and padded dip belt, front handles on uprights, plate horn', () => {
  const P = piece(); const g = P.o;
  box(g, 0.9, 0.18, 1.1, MAT.frame, 0, 0.09, 0, 0.012); footPlate(g, 0.86, 1.05, V(0, 0.19, 0), 0, ['footL', 'footR'], 0.2);
  for (const s of [-1, 1]) for (const z of [-0.5, 0.5]) levelFoot(g, s * 0.4, z);
  // front uprights with handles
  for (const s of [-1, 1]) { tube(g, [s * 0.38, 0.2, 0.52], [s * 0.38, 1.05, 0.52], 0.07); tube(g, [s * 0.38, 0.6, 0.52], [s * 0.38, 0.2, 0.3], 0.05); }
  tube(g, [-0.38, 1.05, 0.52], [0.38, 1.05, 0.52], 0.06);
  handlePair(g, ['gripL', 'gripR'], s => V(s * 0.38, 1.05, 0.52), s => V(s * 0.3, 1.05, 0.4), () => V(0, 0, -1), 0.14, { orient: ['neutral'], palm: V(0, 0, 1) });
  // rear lever
  tube(g, [0, 0.07, -0.55], [0, 0.07, -1.25], 0.09); baseRail(g, [-0.3, 0, -1.25], [0.3, 0, -1.25], 0.08);
  for (const s of [-1, 1]) tube(g, [s * 0.08, 0.07, -1.2], [s * 0.08, 0.3, -1.2], 0.07);
  const lever = pivot(g, V(0, 0.3, -1.2), 'x'); hub(lever, V(0, 0, 0), 'x', 0.05, 0.14);
  tube(lever, [0, 0, 0], [0, 0, 1.2], 0.08); horn(lever, V(0.05, 0, 0.55), V(1, 0, 0), [20, 20]); horn(lever, V(-0.05, 0, 0.55), V(-1, 0, 0), [20, 20]);
  cyl(lever, 0.03, 0.12, MAT.steel, 0, -0.04, 1.2, 'x', 24);
  const chain = chainLine(g, 22);
  const belt = new THREE.Group(); g.add(belt);
  const ell = new THREE.EllipseCurve(0, 0.0, 0.235, 0.185); const pts = ell.getPoints(120).map(p => V(p.x, 0.1, p.y)); // audit (Aziz): a real hip belt sized for the body, round the waist above the hip joint
  flatBand(belt, new THREE.CatmullRomCurve3(pts, true), 0.012, 0.11, 240, true, MAT.pad); // audit: band stands upright round the waist (the Frenet normal of this level loop is vertical)
  for (const s of [-1, 1]) { mesh(new THREE.TorusGeometry(0.025, 0.005, 10, 24), MAT.steel, belt, s * 0.16, 0.05, 0.15); }
  mesh(new THREE.TorusGeometry(0.02, 0.005, 10, 24), MAT.steel, belt, 0, 0.04, -0.195);
  body(belt, 'hip', 'hip', V(0, 0, 0)); attach(belt, 'belt', V());
  const set = m => { turn(lever, -0.06 - m * 0.38); const end = V(0, 0.3, -1.2).add(V(0, -0.04, 1.2).applyAxisAngle(V(1, 0, 0), lever.rotation.x)); belt.position.set(0, 0.68 + m * 0.36, -0.09); chain.update(end, belt.position.clone().add(V(0, 0.02, -0.195))); };
  dof(P, 'motion', 'Stand (0 = bottom)', 0, 1, 1, '', set); set(1); return P;
});

// knee-pivot lever machines (extension / seated curl): pivot on the user's right side at knee height
function kneeLever(g, P, kind) {
  const seatD = 0.45;
  seatUnit(g, { seatH: 0.5, backTilt: kind === 'ext' ? 0.15 : 0.25, backH: 0.65, backZ: -0.27, seatD });
  spine(g, -1.05, 0.55, 0.8);
  seatHandles(g, 0.5, -0.02, 0.29);
  // pivot tower on the user's right
  tube(g, [-0.36, 0.07, 0.55], [-0.36, 0.07, 0.25], 0.08); tube(g, [-0.36, 0.07, 0.25], [-0.36, 0.5, 0.25], 0.08);
  tube(g, [0, 0.07, 0.25], [-0.36, 0.07, 0.25], 0.08);
  const lever = pivot(g, V(-0.36, 0.5, 0.25), 'x'); hub(lever, V(0, 0, 0), 'x', 0.05, 0.08); cam(lever, 0.1, 0.02).position.x = -0.06;
  // range-of-motion dial
  cyl(g, 0.06, 0.01, MAT.cap, -0.42, 0.5, 0.25, 'x', 40); popPin(g, V(-0.43, 0.56, 0.25), V(-1, 0, 0));
  const st = weightStack(g, 0, -1.05, { h: 1.6 });
  pulley(g, V(0, 1.68, -1.05), 'x', 0.05); pulley(g, V(0, 1.68, -1.25), 'x', 0.05); pulley(g, V(0, 0.18, -1.25), 'x', 0.05); pulley(g, V(-0.36, 0.18, 0.12), 'z', 0.05);
  tube(g, [0, 1.75, -1.05], [0, 1.75, -1.3], 0.06); tube(g, [0, 0.07, -1.3], [0, 1.75, -1.3], 0.07);
  const cab = cableLine(g, 6);
  return { lever, st, cable: () => cab.update([st.stackTop(), V(0, 1.73, -1.05), V(0, 1.73, -1.25), V(0, 0.23, -1.25), V(-0.36, 0.23, 0.12), V(-0.36, 0.42, 0.25).add(V(0, 0, -0.08).applyAxisAngle(V(1, 0, 0), lever.rotation.x))]) };
}

def('leg-extension', 'Leg extension', 'Machines: legs', 1, 'shin roller on a lever pivoting at the knee; thigh hold-down roller; cam and cable to the stack', () => {
  const P = piece(); const g = P.o;
  const { lever, st, cable } = kneeLever(g, P, 'ext');
  // thigh hold-down roller on a bracket
  tube(g, [0.33, 0.07, 0.3], [0.33, 0.7, 0.18], 0.06); tube(g, [0.33, 0.7, 0.18], [0.24, 0.62, 0.14], 0.05); roller(g, 0.42, 0, 0.62, 0.14, 0.045);
  body(g, 'thighs', 'thigh', V(0, 0.575, 0.14), V(0, -1, 0));
  tube(lever, [0, 0, 0], [0, -0.42, 0.04], 0.06); tube(lever, [0, -0.42, 0.04], [0.32, -0.42, 0.04], 0.05); roller(lever, 0.32, 0.18, -0.42, 0.08, 0.05);
  tube(lever, [0.02, -0.42, 0.04], [0.02, -0.42, 0.08], 0.03);
  body(lever, 'shin', 'ankle', V(0.18, -0.42, 0.135), V(0, 0, 1));
  feetOnFloor(g, 0.55, 0.12, 0.0);
  const set = m => { turn(lever, -m * 1.4); st.setLift(m * 0.35); cable(); }; dof(P, 'motion', 'Extend', 0, 1, 0, '', set); set(0); return P;
});

def('seated-leg-curl', 'Seated leg curl', 'Machines: legs', 1, 'thigh pad clamps over the knees, ankle roller curls under; cam and cable to the stack (opts.single: one-leg roller and thigh pad for the right leg)', (o = {}) => {
  const P = piece(); const g = P.o;
  const { lever, st, cable } = kneeLever(g, P, 'curl');
  if (o.single) {
    // one-leg version: thigh pad and roller over the user's right leg (x -0.1) only
    tube(g, [-0.3, 0.5, 0.18], [-0.3, 0.74, 0.18], 0.05); tube(g, [-0.3, 0.74, 0.18], [-0.2, 0.7, 0.18], 0.05);
    pad(g, 0.2, 0.08, 0.17, -0.1, 0.7, 0.18); body(g, 'thighs', 'thighR', V(-0.1, 0.655, 0.18), V(0, -1, 0));
    popPin(g, V(-0.3, 0.6, 0.23), V(0, 0, 1));
    tube(lever, [0, 0, 0], [0, 0.0, 0.42], 0.06); tube(lever, [0, 0, 0.42], [0.18, 0, 0.42], 0.05); roller(lever, 0.17, 0.26, 0.06, 0.42, 0.05);
    tube(lever, [0.02, 0, 0.42], [0.02, 0.04, 0.42], 0.03);
    body(lever, 'ankle', 'ankleR', V(0.26, 0.11, 0.42), V(0, 1, 0));
    // free left leg rests on a foot peg
    tube(g, [0.12, 0.07, 0.5], [0.12, 0.12, 0.5], 0.04); footPlate(g, 0.14, 0.24, V(0.12, 0.13, 0.5), 0, ['footL'], 0, V(0, 0, 1));
    P.info = { single: true, side: 'right' };
  } else {
  tube(g, [0.34, 0.07, 0.35], [0.34, 0.74, 0.18], 0.06); tube(g, [0.34, 0.74, 0.18], [0.22, 0.7, 0.18], 0.05);
  pad(g, 0.42, 0.08, 0.17, 0, 0.7, 0.18); body(g, 'thighs', 'thigh', V(0, 0.655, 0.18), V(0, -1, 0));
  popPin(g, V(0.34, 0.6, 0.23), V(0, 0, 1));
  tube(lever, [0, 0, 0], [0, 0.0, 0.42], 0.06); tube(lever, [0, 0, 0.42], [0.32, 0, 0.42], 0.05); roller(lever, 0.32, 0.18, 0.06, 0.42, 0.05);
  tube(lever, [0.02, 0, 0.42], [0.02, 0.04, 0.42], 0.03);
  body(lever, 'ankle', 'ankle', V(0.18, 0.11, 0.42), V(0, 1, 0));
  }
  const set = m => { turn(lever, 0.25 + m * 1.3); st.setLift(m * 0.35); cable(); }; dof(P, 'motion', 'Curl', 0, 1, 0, '', set); set(0); return P;
});

def('lying-leg-curl', 'Lying leg curl', 'Machines: legs', 1, 'angled body pad, elbow pad with handles, ankle roller on a lever, stack (opts.plates: plate-loaded, horn on the lever, no stack)', (o = {}) => {
  const P = piece(); const g = P.o;
  // user lies face down, head toward -Z; origin under the hips
  pad(g, 0.38, 0.08, 0.72, 0, 0.74, -0.47, [0.14, 0, 0]); pad(g, 0.38, 0.08, 0.55, 0, 0.68, 0.15, [-0.1, 0, 0]);
  body(g, 'chest', 'chest', V(0, 0.82, -0.6)); body(g, 'hip', 'hip', V(0, 0.73, 0.0)); body(g, 'thighs', 'thigh', V(0, 0.72, 0.28));
  spine(g, -1.1, 0.75, 0.75);
  for (const z of [-0.65, 0.25]) { tube(g, [0, 0.07, z], [0, 0.6, z], 0.08); box(g, 0.24, 0.02, 0.3, MAT.frame, 0, 0.62, z); }
  // handles from a front cross bar
  tube(g, [0, 0.07, -1.0], [0, 0.6, -0.98], 0.07); tube(g, [-0.28, 0.6, -0.98], [0.28, 0.6, -0.98], 0.05);
  handlePair(g, ['gripL', 'gripR'], s => V(s * 0.28, 0.6, -0.98), s => V(s * 0.28, 0.62, -0.98), () => V(0, 1, 0), 0.13, { orient: ['neutral'], palm: V(0, 0, 1) });
  // lever on the user's right
  tube(g, [-0.33, 0.07, 0.75], [-0.33, 0.7, 0.55], 0.08); tube(g, [0, 0.07, 0.75], [-0.33, 0.07, 0.75], 0.08);
  const lever = pivot(g, V(-0.33, 0.7, 0.55), 'x'); hub(lever, V(0, 0, 0), 'x', 0.05, 0.08); cam(lever, 0.1, 0.02).position.x = -0.06;
  tube(lever, [0, 0, 0], [0, 0.08, 0.42], 0.06); tube(lever, [0, 0.08, 0.42], [0.31, 0.08, 0.42], 0.05); roller(lever, 0.32, 0.17, 0.14, 0.42, 0.05);
  tube(lever, [0.02, 0.08, 0.42], [0.02, 0.12, 0.42], 0.03);
  body(lever, 'ankle', 'ankle', V(0.17, 0.19, 0.42), V(0, 1, 0));
  if (o.plates) {
    // plate-loaded: a drop arm below the pivot carries the horn; curling swings the plates up toward the feet end
    tube(lever, [0, 0, 0], [-0.04, -0.2, -0.12], 0.06); hub(lever, V(-0.04, -0.2, -0.12), 'x', 0.04, 0.07);
    horn(lever, V(-0.08, -0.2, -0.12), V(-1, 0, 0), [20, 10]);
    tube(g, [-0.2, 0.07, 0.55], [-0.2, 0.25, 0.55], 0.05); pad(g, 0.1, 0.04, 0.1, -0.2, 0.26, 0.55); // lever rest
    const set = m => { turn(lever, -m * 1.55); };
    dof(P, 'motion', 'Curl', 0, 1, 0, '', set); set(0); P.info = { plates: true }; return P;
  }
  const st = weightStack(g, 0, 1.15, { h: 1.4 });
  pulley(g, V(0, 1.48, 1.15), 'x', 0.05); pulley(g, V(-0.33, 0.2, 1.15), 'z', 0.05);
  const cab = cableLine(g, 5);
  const set = m => { turn(lever, -m * 1.55); st.setLift(m * 0.3); cab.update([st.stackTop(), V(0, 1.53, 1.15), V(0, 1.53, 1.0), V(-0.33, 0.25, 1.0), V(-0.33, 0.62, 0.55).add(V(0, 0, 0.08).applyAxisAngle(V(1, 0, 0), lever.rotation.x))]); };
  tube(g, [0, 1.55, 1.0], [0, 1.55, 1.15], 0.05); tube(g, [0, 0.07, 1.0], [0, 1.55, 1.0], 0.07);
  dof(P, 'motion', 'Curl', 0, 1, 0, '', set); set(0); return P;
});

def('plate-loaded-leg-curl', 'Plate-loaded lying leg curl', 'Machines: legs', 1, 'lying leg curl with a plate horn on the lever, no stack (same as lying-leg-curl {plates:true})', () => R['lying-leg-curl']({ plates: true }));
def('single-leg-curl', 'Seated single-leg curl', 'Machines: legs', 1, 'one-leg seated curl: right-leg roller and thigh pad, left foot on a peg (same as seated-leg-curl {single:true})', () => R['seated-leg-curl']({ single: true }));

def('hip-ab-adductor', 'Hip abductor / adductor', 'Machines: legs', 1, 'leg arms swing on vertical pivots; inner and outer knee pads; foot pegs; seat handles', () => {
  const P = piece(); const g = P.o;
  seatUnit(g, { seatH: 0.5, backTilt: 0.35, backH: 0.68, backZ: -0.22 });
  spine(g, -1.05, 0.75, 0.85);
  seatHandles(g, 0.5, -0.05, 0.3);
  tube(g, [0, 0.07, 0.25], [0, 0.42, 0.25], 0.09); box(g, 0.3, 0.06, 0.12, MAT.frame, 0, 0.44, 0.25);
  const arms = [];
  for (const s of [-1, 1]) {
    const a = pivot(g, V(s * 0.1, 0.44, 0.25), 'y'); arms.push([a, s]); hub(a, V(0, 0, 0), 'y', 0.04, 0.08);
    tube(a, [0, 0.03, 0], [s * 0.06, 0.08, 0.32], 0.05);
    tube(a, [s * 0.06, 0.08, 0.32], [s * 0.06, 0.18, 0.32], 0.04);
    pad(a, 0.06, 0.06, 0.26, s * 0.16, 0.2, 0.22, [0, 0, Math.PI / 2]); tube(a, [s * 0.06, 0.18, 0.32], [s * 0.13, 0.2, 0.32], 0.035);
    body(a, s > 0 ? 'outerKneeL' : 'outerKneeR', 'knee', V(s * 0.13, 0.2, 0.22), V(-s, 0, 0), V(0, 0, 1));
    pad(a, 0.06, 0.06, 0.26, s * 0.02, 0.2, 0.22, [0, 0, Math.PI / 2]);
    body(a, s > 0 ? 'innerKneeL' : 'innerKneeR', 'knee', V(s * 0.05, 0.2, 0.22), V(s, 0, 0), V(0, 0, 1));
    tube(a, [s * 0.06, 0.08, 0.32], [s * 0.1, -0.2, 0.52], 0.04); { const fp = footPlate(a, 0.14, 0.2, V(s * 0.1, -0.22, 0.52), 0, [s > 0 ? 'footL' : 'footR', 'x'], 0.0); fp.getObjectByName('x').removeFromParent(); }
  }
  const st = weightStack(g, 0, -1.05, { h: 1.55 });
  pulley(g, V(0, 1.62, -1.05), 'x'); pulley(g, V(0, 0.2, -0.8), 'x');
  const cab = cableLine(g, 5);
  const set = m => { for (const [a, s] of arms) turn(a, s * (0.05 + m * 0.6)); st.setLift(m * 0.3); cab.update([st.stackTop(), V(0, 1.66, -1.05), V(0, 1.66, -0.8), V(0, 0.25, -0.8), V(0, 0.38, 0.25)]); };
  tube(g, [0, 1.68, -0.8], [0, 1.68, -1.05], 0.05); tube(g, [0, 0.07, -0.8], [0, 1.68, -0.8], 0.06);
  dof(P, 'motion', 'Legs apart', 0, 1, 0, '', set); set(0); return P;
});

def('standing-calf-raise', 'Standing calf raise', 'Machines: legs', 1, 'shoulder pads on a carriage riding two chrome guide rods; tread toe block; stack', () => {
  const P = piece(); const g = P.o;
  box(g, 0.8, 0.04, 0.7, MAT.frame, 0, 0.02, -0.05, 0.01); footPlate(g, 0.76, 0.66, V(0, 0.045, -0.05), 0, ['floorL', 'floorR'], 0.15);
  box(g, 0.62, 0.08, 0.2, MAT.frame, 0, 0.1, 0.06, 0.012); footPlate(g, 0.6, 0.18, V(0, 0.145, 0.06), 0.08, ['footL', 'footR'], 0.12);
  P.o.getObjectByName('floorL').removeFromParent(); P.o.getObjectByName('floorR').removeFromParent();
  for (const s of [-1, 1]) { tube(g, [s * 0.42, 0.04, -0.38], [s * 0.42, 2.15, -0.38], 0.09); cyl(g, 0.016, 1.6, MAT.chrome, s * 0.32, 1.3, -0.38, 'y', 24); box(g, 0.14, 0.04, 0.06, MAT.frame, s * 0.37, 0.5, -0.38); box(g, 0.14, 0.04, 0.06, MAT.frame, s * 0.37, 2.1, -0.38); }
  tube(g, [-0.42, 2.15, -0.38], [0.42, 2.15, -0.38], 0.09);
  const st = weightStack(g, 0, -0.72, { h: 2.0 });
  tube(g, [0, 2.0, -0.72], [0, 2.15, -0.38], 0.06);
  const car = new THREE.Group(); g.add(car);
  tube(car, [-0.36, 0, -0.38], [0.36, 0, -0.38], 0.08);
  for (const s of [-1, 1]) {
    bearing(car, V(s * 0.32, 0, -0.38));
    tube(car, [s * 0.2, 0, -0.38], [s * 0.14, 0.02, -0.08], 0.06);
    pad(car, 0.12, 0.08, 0.24, s * 0.13, -0.02, -0.02, [0, 0, 0]);
    body(car, s > 0 ? 'shoulderL' : 'shoulderR', 'shoulder', V(s * 0.13, -0.065, -0.02), V(0, -1, 0));
    handle(car, s > 0 ? 'gripL' : 'gripR', V(s * 0.14, 0.02, -0.08), V(s * 0.26, 0.04, 0.1), V(0, 1, 0), 0.13, { hand: s > 0 ? 'L' : 'R', orient: ['neutral'], palm: V(0, 0, -1) });
  }
  pulley(g, V(0, 2.2, -0.72), 'x'); pulley(g, V(0, 2.2, -0.45), 'x');
  const cab = cableLine(g, 4);
  const set = m => { car.position.y = 1.45 + m * 0.1; st.setLift(m * 0.1); cab.update([st.stackTop(), V(0, 2.245, -0.72), V(0, 2.245, -0.45), V(0, car.position.y + 0.04, -0.4)]); };
  dof(P, 'motion', 'Raise', 0, 1, 0, '', set); set(0); return P;
});

def('seated-calf-raise', 'Seated calf raise', 'Machines: legs', 2, 'knee pad on a plate-loaded lever with start lever; tread toe block; seat on a post', () => {
  const P = piece(); const g = P.o;
  spine(g, -0.6, 0.95, 0.7);
  pad(g, 0.38, 0.08, 0.38, 0, 0.47, -0.1); tube(g, [0, 0.07, -0.1], [0, 0.42, -0.1], 0.08); box(g, 0.24, 0.02, 0.28, MAT.frame, 0, 0.425, -0.1); body(g, 'seat', 'seat', V(0, 0.51, -0.1));
  holes(g, [0, 0.15, -0.059], [0, 0.38, -0.059], 5, V(0, 0, 1)); popPin(g, V(0.041, 0.25, -0.1), V(1, 0, 0));
  box(g, 0.48, 0.1, 0.16, MAT.frame, 0, 0.12, 0.38, 0.01); footPlate(g, 0.46, 0.14, V(0, 0.175, 0.38), 0.1, ['footL', 'footR'], 0.1);
  tube(g, [0, 0.07, 0.95], [0, 0.6, 0.95], 0.09); tube(g, [-0.1, 0.07, 0.75], [0, 0.45, 0.95], 0.06);
  const lever = pivot(g, V(0, 0.62, 0.95), 'x'); hub(lever, V(0, 0, 0), 'x', 0.05, 0.12);
  tube(lever, [0, 0, 0], [0, 0, -0.68], 0.07); tube(lever, [-0.2, 0, -0.55], [0.2, 0, -0.55], 0.05);
  pad(lever, 0.42, 0.08, 0.15, 0, -0.06, -0.55); body(lever, 'knees', 'thigh', V(0, -0.105, -0.55), V(0, -1, 0));
  handlePair(lever, ['gripL', 'gripR'], s => V(s * 0.2, 0, -0.55), s => V(s * 0.22, 0.03, -0.55), s => V(s, 0, 0), 0.13, { orient: ['overhand'], palm: V(0, -1, 0) });
  horn(lever, V(0.04, 0.09, -0.18), V(1, 0, 0), [20, 20]); horn(lever, V(-0.04, 0.09, -0.18), V(-1, 0, 0), [20, 20]); tube(lever, [0, 0, -0.18], [0, 0.09, -0.18], 0.06);
  // start/stop lever
  const stop = pivot(g, V(0.06, 0.45, 0.6), 'x'); handle(stop, 'startLever', V(0.0, 0, 0), V(0.18, 0.12, -0.15), V(0, 0.4, -1).normalize(), 0.12, { hand: 'L', orient: ['neutral'], info: { note: 'start/stop lever' } }); tube(g, [0.06, 0.07, 0.6], [0.06, 0.45, 0.6], 0.05);
  const set = m => turn(lever, -0.02 - m * 0.12); dof(P, 'motion', 'Raise', 0, 1, 0, '', set); set(0); return P;
});

def('hip-thrust-machine', 'Hip thrust machine', 'Machines: legs', 2, 'reclined back pad, padded hip roller on a lever, tread foot platform, plate horns', () => {
  const P = piece(); const g = P.o;
  spine(g, -0.95, 0.9, 0.8);
  const bk = new THREE.Group(); bk.position.set(0, 0.42, -0.45); bk.rotation.x = -0.3; g.add(bk);
  pad(bk, 0.42, 0.08, 0.42, 0, 0, 0, [Math.PI / 2, 0, 0]); body(bk, 'back', 'back', V(0, 0, 0.045), V(0, 0, 1)); box(bk, 0.3, 0.36, 0.02, MAT.frame, 0, 0, -0.05);
  tube(g, [0, 0.07, -0.7], [0, 0.4, -0.52], 0.08);
  footPlate(g, 0.8, 0.6, V(0, 0.09, 0.5), 0, ['footL', 'footR'], 0.16); box(g, 0.8, 0.07, 0.6, MAT.frame, 0, 0.045, 0.5, 0.01);
  const lever = pivot(g, V(0, 0.36, -0.68), 'x');
  for (const s of [-1, 1]) {
    tube(g, [s * 0.37, 0.07, -0.68], [s * 0.37, 0.36, -0.68], 0.08); tube(g, [s * 0.37, 0.07, -0.95], [s * 0.37, 0.07, -0.68], 0.08);
    hub(lever, V(s * 0.37, 0, 0), 'x', 0.05, 0.08);
    bent(lever, [V(s * 0.33, 0, 0), V(s * 0.33, 0.12, 0.3), V(s * 0.3, 0.12, 0.62)], 0.06);
    handle(lever, s > 0 ? 'gripL' : 'gripR', V(s * 0.3, 0.12, 0.62), V(s * 0.3, 0.16, 0.62), V(0, 1, 0), 0.12, { hand: s > 0 ? 'L' : 'R', orient: ['neutral'], palm: V(-s, 0, 0) });
    horn(lever, V(s * 0.33, 0.06, 0.3), V(s, 0, 0), [20]);
  }
  tube(lever, [-0.3, 0.12, 0.62], [0.3, 0.12, 0.62], 0.05);
  roller(lever, 0.5, 0, 0.12, 0.62, 0.07); body(lever, 'hip', 'hip', V(0, 0.05, 0.62), V(0, -1, 0));
  const set = m => turn(lever, 0.12 - m * 0.42); dof(P, 'motion', 'Thrust', 0, 1, 0, '', set); set(0); return P;
});

def('glute-kickback-machine', 'Glute kickback machine', 'Machines: legs', 2, 'forearm and knee pads, handles, foot plate on a cam lever to the stack', () => {
  const P = piece(); const g = P.o;
  spine(g, -1.15, 0.85, 0.8);
  tube(g, [0, 0.07, 0.62], [0, 0.95, 0.5], 0.08); pad(g, 0.42, 0.08, 0.3, 0, 1.0, 0.48); box(g, 0.3, 0.02, 0.24, MAT.frame, 0, 0.955, 0.48); body(g, 'forearms', 'forearm', V(0, 1.045, 0.48));
  tube(g, [-0.2, 0.96, 0.65], [0.2, 0.96, 0.65], 0.05); tube(g, [0, 0.96, 0.52], [0, 0.96, 0.65], 0.05);
  handlePair(g, ['gripL', 'gripR'], s => V(s * 0.2, 0.96, 0.65), s => V(s * 0.2, 0.98, 0.65), () => V(0, 1, 0), 0.13, { orient: ['neutral'], palm: V(0, 0, -1) });
  tube(g, [0, 0.07, 0.0], [0, 0.5, 0.0], 0.08); pad(g, 0.38, 0.08, 0.26, 0, 0.55, 0.0); box(g, 0.28, 0.02, 0.2, MAT.frame, 0, 0.505, 0); body(g, 'knees', 'knee', V(0, 0.595, 0.0));
  body(g, 'hipPad', 'hip', V(0, 0.95, 0.2), V(0, 0, 1));
  tube(g, [0.3, 0.07, -0.15], [0.3, 0.75, -0.15], 0.08); tube(g, [0, 0.07, -0.15], [0.3, 0.07, -0.15], 0.08);
  const lever = pivot(g, V(0.3, 0.75, -0.15), 'x'); hub(lever, V(0, 0, 0), 'x', 0.05, 0.08); cam(lever, 0.1, 0.02).position.x = 0.06;
  tube(lever, [0, 0, 0], [0, -0.12, -0.32], 0.05); tube(lever, [0, -0.12, -0.32], [-0.3, -0.12, -0.36], 0.04);
  const fpl = new THREE.Group(); fpl.position.set(-0.3, -0.12, -0.38); fpl.rotation.x = Math.PI / 2; lever.add(fpl);
  footPlate(fpl, 0.24, 0.28, V(0, 0, 0), 0, ['footR', 'footL'], 0.0, V(0, 0, -1));
  const st = weightStack(g, 0, -1.15, { h: 1.6 });
  pulley(g, V(0, 1.68, -1.15), 'x'); pulley(g, V(0.3, 1.68, -0.5), 'x');
  const cab = cableLine(g, 4);
  const set = m => { turn(lever, m * 1.1); st.setLift(m * 0.35); cab.update([st.stackTop(), V(0, 1.725, -1.15), V(0.3, 1.725, -0.5), V(0.36, 0.85, -0.15).add(V(0, 0, -0.1).applyAxisAngle(V(1, 0, 0), lever.rotation.x))]); };
  tube(g, [0, 1.75, -1.15], [0.3, 1.75, -0.5], 0.05); tube(g, [0.3, 0.07, -0.5], [0.3, 1.75, -0.5], 0.06);
  dof(P, 'motion', 'Kick', 0, 1, 0, '', set); set(0); return P;
});

def('reverse-hyper', 'Reverse hyper', 'Machines: legs', 3, 'hip pad on a tall frame, front handles, pendulum with ankle roller and strap, plate horn', () => {
  const P = piece(); const g = P.o;
  spine(g, -0.95, 0.75, 0.9);
  for (const s of [-1, 1]) { tube(g, [s * 0.3, 0.07, -0.45], [s * 0.3, 0.98, -0.3], 0.08); tube(g, [s * 0.3, 0.07, 0.6], [s * 0.3, 0.98, 0.2], 0.08); tube(g, [s * 0.3, 0.98, -0.45], [s * 0.3, 0.98, 0.2], 0.08); }
  for (const z of [-0.45, 0.2]) tube(g, [-0.3, 0.98, z], [0.3, 0.98, z], 0.07);
  pad(g, 0.42, 0.09, 0.58, 0, 1.06, -0.2); body(g, 'hip', 'hip', V(0, 1.105, -0.02)); body(g, 'chest', 'chest', V(0, 1.105, -0.38));
  tube(g, [-0.3, 0.98, -0.45], [-0.25, 1.05, -0.62], 0.05); tube(g, [0.3, 0.98, -0.45], [0.25, 1.05, -0.62], 0.05);
  handlePair(g, ['gripL', 'gripR'], s => V(s * 0.25, 1.05, -0.62), s => V(s * 0.25, 1.06, -0.62), () => V(0, 1, 0), 0.13, { orient: ['neutral'], palm: V(0, 0, 1) });
  const lever = pivot(g, V(0, 0.92, 0.32), 'x'); hub(lever, V(0, 0, 0), 'x', 0.05, 0.6);
  for (const s of [-1, 1]) tube(g, [s * 0.3, 0.98, 0.2], [s * 0.3, 0.92, 0.32], 0.06);
  tube(lever, [0, 0, 0], [0, -0.78, 0], 0.06); tube(lever, [-0.18, -0.72, 0], [0.18, -0.72, 0], 0.05); roller(lever, 0.36, 0, -0.72, -0.07, 0.05);
  const strap = new THREE.Group(); strap.position.set(0, -0.72, -0.07); lever.add(strap);
  flatBand(strap, new THREE.CatmullRomCurve3(new THREE.EllipseCurve(0, 0, 0.09, 0.07).getPoints(60).map(p => V(0, p.y, p.x)), true), 0.06, 0.006, 120, true, MAT.strap);
  body(lever, 'ankle', 'ankle', V(0, -0.72, -0.13), V(0, 0, -1));
  horn(lever, V(0.04, -0.5, 0.05), V(1, 0, 0), [20]); horn(lever, V(-0.04, -0.5, 0.05), V(-1, 0, 0), [20]); tube(lever, [0, -0.5, 0], [0, -0.5, 0.05], 0.05);
  const set = m => turn(lever, -m * 1.15); dof(P, 'motion', 'Swing', 0, 1, 0, '', set); set(0); return P;   // audit (Aziz Nov 3): the pendulum swings back and up behind the user (head at the handles, -Z)
});

// ================================================================= CARDIO
// lathe disc along X (flywheel, fan housing): profile [[radius, x]]
function disc(p, prof, x, y, z, m = MAT.shroud, seg = 72) { const g = new THREE.LatheGeometry(prof.map(([r, t]) => new THREE.Vector2(r, t)), seg); g.rotateZ(-Math.PI / 2); return mesh(g, m, p, x, y, z); }
function flywheel(p, r, w, x, y, z) {
  const g = new THREE.Group(); g.position.set(x, y, z); p.add(g);
  disc(g, [[0.02, -w / 2], [r - 0.01, -w / 2], [r, -w / 2 + 0.01], [r, w / 2 - 0.01], [r - 0.01, w / 2], [0.02, w / 2]], 0, 0, 0, MAT.chrome);
  for (const s of [-1, 1]) { disc(g, [[0.02, 0], [r * 0.8, 0], [r * 0.8, 0.004], [0.02, 0.004]], s * (w / 2 + 0.002), 0, 0, MAT.frame); for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; bolt(g, V(s * (w / 2 + 0.006), Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5), V(s, 0, 0), 0.006); } }
  return g;
}
// cycling pedal with cage, origin at the spindle end
function pedal(p) {
  const g = new THREE.Group(); p.add(g);
  cyl(g, 0.008, 0.1, MAT.steel, 0.05, 0, 0, 'x', 16);
  box(g, 0.1, 0.022, 0.11, MAT.cap, 0.06, 0, 0, 0.006);
  for (const s of [-1, 1]) { box(g, 0.11, 0.012, 0.012, MAT.frameLight, 0.06, 0.012, s * 0.05, 0.004); for (let i = 0; i < 4; i++) cyl(g, 0.0025, 0.006, MAT.steel, 0.025 + i * 0.024, 0.02, s * 0.05, 'y', 8); }
  const st = new THREE.Group(); st.position.set(0.06, 0.012, 0.05); g.add(st); bent(st, [V(-0.045, 0, 0), V(-0.045, 0.04, 0.03), V(0.045, 0.04, 0.03), V(0.045, 0, 0)], 0.008, MAT.cap);
  return g;
}
function crank2(p, pos, r = 0.17, w = 0.3) {
  const c = pivot(p, pos, 'x'); cyl(c, 0.022, w - 0.06, MAT.steel, 0, 0, 0, 'x', 32);
  disc(c, [[0.02, -0.003], [0.1, -0.003], [0.1, 0.003], [0.02, 0.003]], w / 2 - 0.05, 0, 0, MAT.frameLight, 96);
  const pedals = [];
  for (const s of [-1, 1]) {
    const arm = new THREE.ExtrudeGeometry(rrShape(0.035, r + 0.05, 0.016), { depth: 0.014, bevelEnabled: true, bevelSize: 0.003, bevelThickness: 0.003, bevelSegments: 3, curveSegments: 8 });
    arm.translate(0, -(r) / 2 * s, -0.007); arm.rotateY(Math.PI / 2); mesh(arm, MAT.chrome, c, s * (w / 2 - 0.01), 0, 0);
    bolt(c, V(s * (w / 2), 0, 0), V(s, 0, 0), 0.01);
    const pd = new THREE.Group(); pd.position.set(s * (w / 2 + 0.005), s * -r, 0); c.add(pd); const pg = pedal(pd); if (s < 0) pg.scale.x = -1;
    pedals.push([pd, s]);
    foot(pd, s > 0 ? 'footL' : 'footR', V(s * 0.06, 0.03, 0), V(0, 0, 1));
  }
  return { c, pedals, set: a => { turn(c, a); pedals.forEach(([pd]) => pd.rotation.x = -a); } };
}
// shaped saddle (narrow nose toward +Z)
function saddle(p, x, y, z) {
  const g = new THREE.Group(); g.position.set(x, y, z); p.add(g);
  const geo = cushionGeo(0.2, 0.06, 0.27, 0.01, 0.008, 0.025); const P = geo.attributes.position;
  for (let i = 0; i < P.count; i++) { const zz = P.getZ(i); const k = zz > 0 ? 1 - 0.68 * Math.pow(zz / 0.135, 1.3) : 1; P.setX(i, P.getX(i) * k); P.setY(i, P.getY(i) + (zz > 0 ? 0.01 * zz / 0.135 : 0) - Math.pow(P.getX(i) / 0.1, 2) * 0.004); }
  geo.computeVertexNormals(); mesh(geo, MAT.pad, g);
  box(g, 0.06, 0.02, 0.16, MAT.cap, 0, -0.04, 0); for (const s of [-1, 1]) cyl(g, 0.0035, 0.2, MAT.steel, s * 0.02, -0.05, 0, 'z', 12);
  return g;
}

def('treadmill', 'Treadmill', 'Cardio', 1, 'incline dof 0-15 %, tread belt moves with motion; motor hood, console, side rails and handrails; origin under the runner', () => {
  const P = piece(); const g = P.o;
  const deck = pivot(g, V(0, 0.12, -0.95), 'x');
  // frame: aluminium side rails with foot strips
  for (const s of [-1, 1]) {
    box(deck, 0.1, 0.11, 1.85, MAT.shroud, s * 0.38, 0, 0.92, 0.02); box(deck, 0.09, 0.006, 1.8, MAT.rubber, s * 0.38, 0.058, 0.92, 0.002);
    for (let i = 0; i < 30; i++) box(deck, 0.08, 0.003, 0.006, MAT.cap, s * 0.38, 0.062, 0.05 + i * 0.06, 0.001);
  }
  box(deck, 0.66, 0.05, 1.8, MAT.frame, 0, -0.02, 0.92, 0.01);
  for (const z of [0.0, 1.85]) { cyl(deck, 0.045, 0.62, MAT.frameLight, 0, 0.0, z, 'x', 40); for (const s of [-1, 1]) { cyl(deck, 0.02, 0.02, MAT.chrome, s * 0.32, 0, z, 'x', 24); bolt(deck, V(s * 0.335, 0, z), V(s, 0, 0), 0.008); } }
  // belt: closed loop around the rollers with moving tread slats
  box(deck, 0.6, 0.006, 1.85, MAT.deck, 0, 0.047, 0.925, 0.002); box(deck, 0.6, 0.006, 1.85, MAT.deck, 0, -0.047, 0.925, 0.002);
  const slats = new THREE.Group(); deck.add(slats); const slatGeo = rboxGeo(0.58, 0.003, 0.01, 0.001, 1);
  for (let i = 0; i < 74; i++) mesh(slatGeo, MAT.cap, slats, 0, 0.051, 0.03 + i * 0.025);
  foot(deck, 'footL', V(0.12, 0.052, 0.95)); foot(deck, 'footR', V(-0.12, 0.052, 0.95));
  // rear end cap, levelling feet
  box(deck, 0.86, 0.08, 0.06, MAT.cap, 0, -0.02, -0.05, 0.02); for (const s of [-1, 1]) { levelFoot(g, s * 0.38, -0.95); levelFoot(g, s * 0.38, 0.95); }
  // front: motor hood and incline lift
  const top = new THREE.Group(); deck.add(top);
  const hood = cushionGeo(0.86, 0.22, 0.36, 0.03, 0.02, 0.06); mesh(hood, MAT.shroud, top, 0, 0.06, 2.06);
  box(top, 0.6, 0.004, 0.1, MAT.cap, 0, 0.18, 2.0, 0.002);
  tube(g, [0, 0.05, 1.2], [0, 0.05, 1.0], 0.08);
  // uprights, console and handrails
  for (const s of [-1, 1]) {
    bent(top, [V(s * 0.4, 0.05, 2.08), V(s * 0.4, 0.6, 2.06), V(s * 0.38, 1.15, 1.98)], 0.075, MAT.frame);
    const railC = new THREE.CatmullRomCurve3([V(s * 0.39, 1.05, 2.0), V(s * 0.39, 1.02, 1.75), V(s * 0.38, 0.99, 1.25), V(s * 0.37, 0.96, 1.18)], false, 'centripetal');
    mesh(new THREE.TubeGeometry(railC, 64, 0.02, 20, false), MAT.frameLight, top);
    const rp = railC.getPoint(0.55), rt = railC.getTangent(0.55).negate();
    grip(top, s > 0 ? 'railL' : 'railR', rp, { radius: 0.02, length: 0.45, hand: s > 0 ? 'L' : 'R', orient: ['neutral', 'overhand'] }, rt, V(-s, 0, 0));
    // heart-rate sensor grips on the console stems
    handle(top, s > 0 ? 'hrL' : 'hrR', V(s * 0.2, 1.1, 1.93), V(s * 0.2, 1.06, 1.82), V(0, -0.2, -1).normalize(), 0.12, { r: 0.018, hand: s > 0 ? 'L' : 'R', orient: ['neutral'], palm: V(-s, 0, 0), info: { note: 'pulse grips' } });
  }
  const con = new THREE.Group(); con.position.set(0, 1.25, 1.98); con.rotation.x = -0.45; top.add(con);
  mesh(cushionGeo(0.86, 0.06, 0.32, 0.01, 0.02, 0.03), MAT.shroud, con, 0, 0, 0);
  const scr = mesh(new THREE.PlaneGeometry(0.3, 0.18), MAT.screen, con, 0, 0.032, 0.0); scr.rotation.x = -Math.PI / 2;
  for (let i = 0; i < 10; i++) cyl(con, 0.012, 0.008, i < 5 ? MAT.cap : MAT.steel, -0.38 + (i % 5) * 0.035 + (i < 5 ? 0 : 0.58), 0.034, 0.08, 'y', 24);
  box(con, 0.25, 0.01, 0.06, MAT.cap, 0, 0.032, -0.13, 0.004);
  mesh(new THREE.TorusGeometry(0.035, 0.008, 12, 32), MAT.cap, con, 0.33, 0.04, -0.1).rotation.x = Math.PI / 2;
  let inc = 0, run = 0;
  const upd = () => { turn(deck, -Math.atan(inc / 100)); top.rotation.x = Math.atan(inc / 100) * 0.9; slats.position.z = -((run * 1.75) % 0.025); };
  dof(P, 'incline', 'Incline', 0, 15, 8, '%', v => { inc = v; upd(); });
  dof(P, 'motion', 'Belt', 0, 1, 0, '', v => { run = v; upd(); }); inc = 8; upd();
  return P;
});

def('bike', 'Upright / spin bike', 'Cardio', 1, 'crank dof (motion = one revolution); chromed flywheel, shaped saddle, drop bars, caged pedals', () => {
  const P = piece(); const g = P.o;
  for (const z of [-0.55, 0.62]) { tube(g, [-0.27, 0.05, z], [0.27, 0.05, z], 0.07, MAT.frame, true); for (const s of [-1, 1]) levelFoot(g, s * 0.25, z); }
  tube(g, [0, 0.05, -0.55], [0, 0.05, 0.62], 0.08);
  bent(g, [V(0, 0.08, -0.45), V(0, 0.2, -0.25), V(0, 0.36, 0.0)], 0.07);
  tube(g, [0, 0.36, 0], [0, 0.82, -0.2], 0.07); tube(g, [0, 0.62, -0.11], [0, 0.95, -0.25], 0.045, MAT.frameLight); holes(g, [0, 0.65, -0.088], [0, 0.8, -0.15], 6, V(0, 0.4, 1).normalize());
  popPin(g, V(0.04, 0.72, -0.15), V(1, 0, 0));
  bent(g, [V(0, 0.36, 0), V(0, 0.7, 0.3), V(0, 0.95, 0.42)], 0.07); tube(g, [0, 0.05, 0.55], [0, 0.42, 0.45], 0.07);
  tube(g, [0, 0.88, 0.4], [0, 1.08, 0.46], 0.045, MAT.frameLight); popPin(g, V(0.04, 0.95, 0.42), V(1, 0, 0));
  // flywheel with guard
  flywheel(g, 0.24, 0.045, 0, 0.42, 0.45);
  const guard = mesh(new THREE.TorusGeometry(0.245, 0.03, 16, 64, Math.PI * 0.9), MAT.shroud, g, 0, 0.42, 0.45); guard.rotation.y = Math.PI / 2; guard.rotation.x = -0.4;
  // brake knob
  cyl(g, 0.006, 0.12, MAT.chrome, 0, 0.98, 0.5, 'y', 12); cyl(g, 0.025, 0.035, MAT.rubber, 0, 1.04, 0.5, 'y', 24);
  // belt guard between crank and flywheel
  const bg = new THREE.Group(); bg.position.set(0.06, 0.39, 0.22); g.add(bg); mesh(new THREE.CapsuleGeometry(0.07, 0.36, 12, 32), MAT.shroud, bg).rotation.x = Math.PI / 2 - 0.12; bg.scale.set(0.25, 1, 1);
  saddle(g, 0, 0.98, -0.26); body(g, 'seat', 'seat', V(0, 1.01, -0.28));
  // handlebar: centre bar + bull horns
  const hb = new THREE.Group(); hb.position.set(0, 1.1, 0.48); g.add(hb);
  cyl(hb, 0.018, 0.08, MAT.frameLight, 0, -0.02, 0, 'y', 24); tube(hb, [-0.09, 0, 0.02], [0.09, 0, 0.02], 0.026, MAT.frameLight, true); for (const s of [-1, 1]) tube(hb, [s * 0.23, 0, 0.02], [s * 0.25, 0, 0.02], 0.026, MAT.frameLight, true);
  for (const s of [-1, 1]) {
    hgrip(hb, 0.016, 0.14, s * 0.16, 0, 0.02, 'x'); cyl(hb, 0.017, 0.012, MAT.cap, s * 0.14, 0.03, 0.22, 'x', 24);
    grip(hb, s > 0 ? 'gripL' : 'gripR', V(s * 0.16, 0, 0.02), { radius: 0.016, length: 0.12, hand: s > 0 ? 'L' : 'R', orient: ['overhand'] }, V(1, 0, 0), V(0, -1, 0));
    const hornCurve = new THREE.CatmullRomCurve3([V(s * 0.25, 0, 0.02), V(s * 0.28, 0.0, 0.08), V(s * 0.24, 0.02, 0.18), V(s * 0.14, 0.03, 0.22)]);
    const hp = hornCurve.getPoint(0.55), ht = hornCurve.getTangent(0.55);
    mesh(new THREE.TubeGeometry(hornCurve, 40, 0.017, 16, false), MAT.rubber, hb);
    grip(hb, s > 0 ? 'hornL' : 'hornR', hp, { radius: 0.017, length: 0.12, hand: s > 0 ? 'L' : 'R', orient: ['neutral'] }, ht, V(0, -1, 0));
  }
  const cs = new THREE.Group(); cs.position.set(0, 0.06, 0.23); cs.rotation.x = -0.5; hb.add(cs); box(cs, 0.16, 0.1, 0.03, MAT.shroud, 0, 0, 0, 0.01); mesh(new THREE.PlaneGeometry(0.12, 0.07), MAT.screen, cs, 0, 0, 0.016);
  const C = crank2(g, V(0, 0.36, 0.0));
  dof(P, 'motion', 'Pedal', 0, 1, 0, '', v => C.set(v * Math.PI * 2)); C.set(0); return P;
});

def('air-bike', 'Air bike (fan)', 'Cardio', 2, 'moving arms linked to the crank; bladed fan in a wire cage; foot pegs', () => {
  const P = piece(); const g = P.o;
  for (const z of [-0.55, 0.8]) { tube(g, [-0.3, 0.05, z], [0.3, 0.05, z], 0.07, MAT.frame, true); for (const s of [-1, 1]) levelFoot(g, s * 0.28, z); }
  tube(g, [0, 0.05, -0.55], [0, 0.05, 0.8], 0.08);
  bent(g, [V(0, 0.08, -0.45), V(0, 0.25, -0.2), V(0, 0.4, 0.0)], 0.07);
  tube(g, [0, 0.4, 0], [0, 0.82, -0.15], 0.07); tube(g, [0, 0.66, -0.1], [0, 0.94, -0.19], 0.045, MAT.frameLight); popPin(g, V(0.04, 0.75, -0.13), V(1, 0, 0));
  bent(g, [V(0, 0.4, 0), V(0, 0.6, 0.3), V(0, 0.75, 0.42)], 0.07); tube(g, [0, 0.05, 0.75], [0, 0.6, 0.6], 0.07);
  // fan: blades on a hub inside a wire cage
  const fan = pivot(g, V(0, 0.6, 0.62), 'x');
  cyl(fan, 0.05, 0.14, MAT.frameLight, 0, 0, 0, 'x', 32);
  for (let i = 0; i < 10; i++) { const b = new THREE.Group(); b.rotation.x = i * Math.PI / 5; fan.add(b); const bl = box(b, 0.12, 0.004, 0.06, MAT.frameLight, 0, 0.19, 0, 0.002); bl.scale.set(1, 1, 1); bl.rotation.y = 0.5; bl.geometry = rboxGeo(0.13, 0.26, 0.004, 0.002, 1); bl.rotation.set(0.0, 0.45, 0); }
  const cage = new THREE.Group(); cage.position.set(0, 0.6, 0.62); g.add(cage);
  for (const s of [-1, 1]) for (const r of [0.08, 0.16, 0.24, 0.33]) { const t = mesh(new THREE.TorusGeometry(r, 0.003, 6, 72), MAT.steel, cage, s * 0.1, 0, 0); t.rotation.y = Math.PI / 2; }
  mesh(new THREE.CylinderGeometry(0.335, 0.335, 0.2, 72, 1, true), MAT.steel, cage).rotation.z = Math.PI / 2;
  for (const s of [-1, 1]) for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; cyl(cage, 0.0025, 0.3, MAT.steel, s * 0.1, Math.cos(a) * 0.18, Math.sin(a) * 0.18, 'y', 6).rotation.x = a; }
  const sh = mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.03, 72, 1, false, 0, Math.PI), MAT.shroud, cage, 0, 0, 0); sh.rotation.z = Math.PI / 2;
  saddle(g, 0, 0.97, -0.2); body(g, 'seat', 'seat', V(0, 1.0, -0.22));
  // foot pegs on the fork
  for (const s of [-1, 1]) { cyl(g, 0.012, 0.12, MAT.steel, s * 0.1, 0.62, 0.36, 'x', 20); cyl(g, 0.02, 0.07, MAT.rubber, s * 0.14, 0.62, 0.36, 'x', 24); }
  const C = crank2(g, V(0, 0.38, 0.05));
  const arms = [];
  for (const s of [-1, 1]) {
    cyl(g, 0.02, 0.06, MAT.steel, s * 0.17, 0.82, 0.38, 'x', 24); tube(g, [0, 0.72, 0.38], [s * 0.15, 0.82, 0.38], 0.05);
    const a = pivot(g, V(s * 0.2, 0.82, 0.38), 'x'); arms.push([a, s]); hub(a, V(0, 0, 0), 'x', 0.035, 0.05);
    tube(a, [0, -0.35, 0], [0, 0.0, 0], 0.04, MAT.frame, true);
    handle(a, s > 0 ? 'gripL' : 'gripR', V(0, 0, 0), V(0, 0.35, -0.05), V(0, 1, 0), 0.17, { hand: s > 0 ? 'L' : 'R', orient: ['neutral'], palm: V(0, 0, 1) });
    // connecting link to the crank
    tube(a, [0, -0.35, 0], [0, -0.35, -0.12], 0.03, MAT.frameLight, true);
  }
  dof(P, 'motion', 'Pedal', 0, 1, 0, '', v => { const a = v * Math.PI * 2; C.set(a); fan.rotation.x = a * 3; arms.forEach(([arm, s]) => turn(arm, Math.cos(a) * 0.35 * s)); }); C.set(0); return P;
});

def('elliptical', 'Elliptical / arc trainer', 'Cardio', 2, 'foot pedals on rails linked to the flywheel and handles; moving and fixed handles', () => {
  const P = piece(); const g = P.o;
  tube(g, [0, 0.05, -0.95], [0, 0.05, 0.85], 0.1); for (const z of [-0.95, 0.85]) { tube(g, [-0.32, 0.05, z], [0.32, 0.05, z], 0.07, MAT.frame, true); for (const s of [-1, 1]) levelFoot(g, s * 0.3, z); }
  // rear drive housing
  const hous = mesh(cushionGeo(0.2, 0.55, 0.55, 0.02, 0.02, 0.08), MAT.shroud, g, 0, 0.33, -0.78); hous.rotation.z = Math.PI / 2; hous.scale.set(1, 1, 1);
  flywheel(g, 0.2, 0.04, 0, 0.32, -0.78).visible = true;
  // front upright and console
  bent(g, [V(0, 0.08, 0.8), V(0, 0.8, 0.72), V(0, 1.4, 0.6)], 0.09);
  const con = new THREE.Group(); con.position.set(0, 1.45, 0.58); con.rotation.x = -0.5; g.add(con); mesh(cushionGeo(0.4, 0.05, 0.24, 0.01, 0.02, 0.025), MAT.shroud, con); const sc = mesh(new THREE.PlaneGeometry(0.22, 0.13), MAT.screen, con, 0, 0.027, 0); sc.rotation.x = -Math.PI / 2;
  // fixed pulse handles
  for (const s of [-1, 1]) handle(g, s > 0 ? 'fixedL' : 'fixedR', V(0, 1.2, 0.66), V(s * 0.1, 1.22, 0.6), V(s * 0.3, 0.2, -1).normalize(), 0.13, { hand: s > 0 ? 'L' : 'R', orient: ['neutral'], palm: V(-s, 0, 0), info: { note: 'pulse grips' } });
  tube(g, [-0.24, 1.05, 0.66], [0.24, 1.05, 0.66], 0.05);
  const parts = [];
  for (const s of [-1, 1]) {
    const ped = new THREE.Group(); g.add(ped);
    footPlate(ped, 0.15, 0.38, V(0, 0.0, 0), 0, [s > 0 ? 'footL' : 'footR', 'x'], 0.0).getObjectByName('x').removeFromParent();
    box(ped, 0.04, 0.03, 0.42, MAT.frameLight, -s * 0.09, 0.01, 0, 0.01);
    const rail = tube(g, [0, 0, 0], [0, 0, 1], 0.05, MAT.frameLight, true);
    const arm = pivot(g, V(s * 0.24, 1.05, 0.66), 'x'); hub(arm, V(0, 0, 0), 'x', 0.035, 0.06);
    tube(arm, [0, -0.7, 0], [0, 0.0, 0], 0.045, MAT.frame, true);
    handle(arm, s > 0 ? 'gripL' : 'gripR', V(0, 0, 0), V(0, 0.05, -0.04), V(0, 1, -0.1).normalize(), 0.2, { hand: s > 0 ? 'L' : 'R', orient: ['neutral'], palm: V(0, 0, 1) });
    parts.push({ ped, rail, arm, s });
  }
  const set = v => { for (const p of parts) { const a = v * Math.PI * 2 + (p.s > 0 ? 0 : Math.PI); const x = p.s * 0.12, y = 0.33 + Math.sin(a) * 0.08, z = 0.05 + Math.cos(a) * 0.22; p.ped.position.set(x, y, z);
    const A = V(p.s * 0.12, 0.32 + Math.sin(a) * 0.12, -0.78 + 0.12 * Math.cos(a)), B = V(p.s * 0.24, 0.35, 0.66); const d = B.clone().sub(A); p.rail.position.copy(A).addScaledVector(d, 0.5); p.rail.scale.y = d.length(); p.rail.quaternion.setFromUnitVectors(UP, d.normalize());
    turn(p.arm, -Math.cos(a) * 0.3); } };
  dof(P, 'motion', 'Stride', 0, 1, 0, '', set); set(0); return P;
});

def('rower', 'Rowing machine', 'Cardio', 1, 'seat slides on an aluminium monorail; handle on a chain; fan flywheel; strapped footplates; motion = catch to finish', () => {
  const P = piece(); const g = P.o;
  // monorail
  const rail = new THREE.Group(); g.add(rail);
  const rA = V(0, 0.33, -1.45), rB = V(0, 0.45, 0.75); tube(rail, rA, rB, 0.075, MAT.shroud); bent(rail, [rA.clone().add(V(0, 0.04, 0)), rB.clone().add(V(0, 0.04, 0))], 0.012, MAT.chrome);
  tube(g, [-0.28, 0.05, -1.4], [0.28, 0.05, -1.4], 0.06, MAT.frame, true); tube(g, [0, 0.05, -1.4], [0, 0.3, -1.42], 0.06); for (const s of [-1, 1]) levelFoot(g, s * 0.26, -1.4);
  // front: fan cage and monitor
  for (const s of [-1, 1]) { tube(g, [s * 0.25, 0.05, 1.0], [0, 0.4, 0.75], 0.07); levelFoot(g, s * 0.25, 1.0); }
  tube(g, [-0.27, 0.05, 1.0], [0.27, 0.05, 1.0], 0.06, MAT.frame, true);
  const fanG = new THREE.Group(); fanG.position.set(0, 0.5, 0.98); g.add(fanG);
  disc(fanG, [[0.04, -0.09], [0.27, -0.09], [0.29, -0.07], [0.29, 0.07], [0.27, 0.09], [0.04, 0.09]], 0, 0, 0, MAT.shroud, 96);
  for (const s of [-1, 1]) for (let i = 0; i < 24; i++) { const a = i * Math.PI / 12; box(fanG, 0.004, 0.012, 0.16, MAT.cap, s * 0.092, Math.cos(a) * 0.18, Math.sin(a) * 0.18, 0.002).rotation.x = -a; }
  cyl(fanG, 0.05, 0.2, MAT.frameLight, 0, 0, 0, 'x', 32);
  bent(g, [V(0, 0.6, 0.82), V(0, 0.95, 0.6), V(0, 1.05, 0.45)], 0.03, MAT.frameLight);
  const mon = new THREE.Group(); mon.position.set(0, 1.07, 0.42); mon.rotation.x = 0.35; g.add(mon); box(mon, 0.22, 0.17, 0.04, MAT.cap, 0, 0, 0, 0.012); mesh(new THREE.PlaneGeometry(0.17, 0.12), MAT.screen, mon, 0, 0, -0.021).rotation.y = Math.PI;
  // foot stretchers with heel cups and straps
  const fp = new THREE.Group(); fp.position.set(0, 0.42, 0.55); fp.rotation.x = -0.75; g.add(fp);
  for (const s of [-1, 1]) {
    box(fp, 0.13, 0.015, 0.32, MAT.frameLight, s * 0.1, 0, 0, 0.006); box(fp, 0.12, 0.006, 0.3, MAT.rubber, s * 0.1, 0.01, 0, 0.002);
    box(fp, 0.13, 0.06, 0.02, MAT.cap, s * 0.1, 0.03, -0.15, 0.008);
    flatBand(fp, new THREE.CatmullRomCurve3([V(s * 0.035, 0.0, 0.04), V(s * 0.05, 0.06, 0.05), V(s * 0.1, 0.085, 0.05), V(s * 0.15, 0.06, 0.05), V(s * 0.165, 0.0, 0.04)]), 0.04, 0.004, 60, false, MAT.strap);
    foot(fp, s > 0 ? 'footL' : 'footR', V(s * 0.1, 0.016, -0.03));
  }
  // seat carriage with rollers
  const seat = new THREE.Group(); g.add(seat);
  const sg = cushionGeo(0.3, 0.06, 0.28, 0.008); const sp = sg.attributes.position; for (let i = 0; i < sp.count; i++) { const x = sp.getX(i), y = sp.getY(i); if (y > 0) sp.setY(i, y - 0.012 * Math.exp(-Math.pow((Math.abs(x) - 0.07) / 0.04, 2))); } sg.computeVertexNormals();
  mesh(sg, MAT.pad, seat, 0, 0.04, 0); box(seat, 0.2, 0.02, 0.2, MAT.frameLight, 0, 0.0, 0, 0.006);
  for (const s of [-1, 1]) for (const z of [-0.08, 0.08]) { cyl(seat, 0.018, 0.02, MAT.cap, s * 0.05, -0.02, z, 'x', 24); }
  body(seat, 'seat', 'seat', V(0, 0.07, 0));
  // handle
  const hd = new THREE.Group(); g.add(hd);
  cyl(hd, 0.011, 0.19, MAT.frameLight, 0, 0, 0, 'x', 24); for (const s of [-1, 1]) bent(hd, [V(s * 0.245, 0, 0), V(s * 0.262, 0, 0.008), V(s * 0.272, 0, 0.03)], 0.022, MAT.frameLight);
  for (const s of [-1, 1]) { hgrip(hd, 0.017, 0.15, s * 0.17, 0, 0, 'x'); grip(hd, s > 0 ? 'gripL' : 'gripR', V(s * 0.17, 0, 0), { radius: 0.017, length: 0.14, hand: s > 0 ? 'L' : 'R', orient: ['overhand'] }, V(1, 0, 0), V(0, 0, 1)); }
  cyl(hd, 0.012, 0.03, MAT.steel, 0, 0, 0.02, 'z', 16);
  const chain = chainLine(g, 48);
  // audit (Aziz batch 1: chain ran under the thighs): real stroke order - legs drive the seat back first (v 0..0.6), then the arms pull the handle to the ribs (0.6..1), handle rising over the flattened knees
  const ez = x => x * x * (3 - 2 * x);
  const set = v => { const ks = ez(Math.min(1, v / 0.6)), ka = v <= 0.6 ? 0 : ez((v - 0.6) / 0.4); const sz = 0.15 - ks * 0.65; const t = (sz - rA.z) / (rB.z - rA.z); seat.position.set(0, rA.y + (rB.y - rA.y) * t + 0.06, sz); hd.position.set(0, 0.62 + ks * 0.06 + ka * 0.1, 0.6 - ks * 0.72 - ka * 0.33); chain.update(V(0, 0.52, 0.86), hd.position.clone().add(V(0, 0, 0.03))); };
  dof(P, 'motion', 'Stroke', 0, 1, 0, '', set); set(0); return P;
});

def('stair-climber', 'Stair climber (stepmill)', 'Cardio', 2, 'revolving tread steps descend with motion; side panels, handrails, console', () => {
  const P = piece(); const g = P.o;
  box(g, 0.95, 0.12, 1.2, MAT.shroud, 0, 0.06, 0.05, 0.02); for (const s of [-1, 1]) for (const z of [-0.5, 0.6]) levelFoot(g, s * 0.44, z);
  const side = new THREE.Shape(); side.moveTo(-0.5, 0.1); side.lineTo(0.66, 0.1); side.lineTo(0.66, 0.86); side.lineTo(-0.5, 0.18); side.lineTo(-0.5, 0.1);
  const sideG = new THREE.ExtrudeGeometry(side, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 4, curveSegments: 8 }); sideG.rotateY(-Math.PI / 2);
  for (const s of [-1, 1]) {
    mesh(sideG, MAT.frame, g, s * 0.45 + 0.02, 0, 0);
    for (let i = 0; i < 8; i++) bolt(g, V(s * 0.482, 0.16, -0.42 + i * 0.14), V(s, 0, 0), 0.005);
    tube(g, [s * 0.45, 1.48, 0.6], [s * 0.4, 1.54, 0.6], 0.05); tube(g, [s * 0.45, 0.12, -0.45], [s * 0.4, 1.52, -0.42], 0.05); tube(g, [s * 0.45, 0.86, 0.66], [s * 0.45, 1.48, 0.6], 0.05); // audit: rails at waist height of someone on the steps (were 1.14, below reach)
    bent(g, [V(s * 0.4, 1.52, -0.42), V(s * 0.38, 1.54, 0.0), V(s * 0.38, 1.54, 0.6)], 0.038, MAT.frameLight);
    grip(g, s > 0 ? 'railL' : 'railR', V(s * 0.38, 1.54, 0.15), { radius: 0.019, length: 0.6, hand: s > 0 ? 'L' : 'R', orient: ['neutral', 'overhand'] }, V(0, 0, 1), V(-s, 0, 0));
  }
  // front tower and console
  mesh(cushionGeo(0.95, 0.14, 0.75, 0.01, 0.03, 0.04), MAT.frame, g, 0, 0.42, 0.74).rotation.x = Math.PI / 2;
  mesh(cushionGeo(0.5, 0.14, 0.75, 0.01, 0.03, 0.04), MAT.shroud, g, 0, 1.12, 0.74).rotation.x = Math.PI / 2;
  for (let i = 0; i < 6; i++) box(g, 0.4, 0.012, 0.006, MAT.cap, 0, 0.92 + i * 0.07, 0.668, 0.002);
  const con = new THREE.Group(); con.position.set(0, 1.45, 0.62); con.rotation.x = -0.6; g.add(con); mesh(cushionGeo(0.6, 0.05, 0.28, 0.01, 0.02, 0.025), MAT.shroud, con); const sc = mesh(new THREE.PlaneGeometry(0.26, 0.16), MAT.screen, con, 0, 0.027, 0); sc.rotation.x = -Math.PI / 2;
  // steps: tread plates on a chain
  const stepAt = t => V(0, 0.2 + t * 0.2, -0.32 + t * 0.22);
  const steps = new THREE.Group(); g.add(steps);
  for (let i = 0; i < 5; i++) { const st = new THREE.Group(); steps.add(st); box(st, 0.72, 0.035, 0.26, MAT.frameLight, 0, 0, 0, 0.006); for (let j = 0; j < 11; j++) box(st, 0.7, 0.006, 0.01, MAT.rubber, 0, 0.02, -0.11 + j * 0.022, 0.002); box(st, 0.72, 0.012, 0.02, MAT.cap, 0, 0.012, 0.125, 0.004); box(st, 0.72, 0.18, 0.02, MAT.frame, 0, -0.1, -0.12, 0.004); }
  // chain sprockets at the bottom and top of the stair run
  for (const t of [0, 4]) for (const s of [-1, 1]) { const c = stepAt(t); disc(g, [[0.01, -0.012], [0.11, -0.012], [0.12, 0], [0.11, 0.012], [0.01, 0.012]], s * 0.38, Math.max(c.y - 0.06, 0.14), c.z, MAT.frameLight, 40); }
  const fl = foot(g, 'footL', V(0.13, 0, 0)), fr = foot(g, 'footR', V(-0.13, 0, 0));
  const set = v => { steps.children.forEach((s, i) => { const t = ((i - v) % 5 + 5) % 5; s.position.copy(stepAt(t)); s.visible = t < 4.05; }); fl.position.copy(stepAt(2 - v)).add(V(0.13, 0.024, 0)); fr.position.copy(stepAt(1 - v)).add(V(-0.13, 0.024, 0)); };
  dof(P, 'motion', 'Step', 0, 1, 0, '', set); set(0); return P;
});

def('ski-erg', 'Ski erg', 'Cardio', 3, 'two handles on cords pull down from 2 m arms; fan housing; floor platform; motion 0 = arms up, 1 = pulled down', () => {
  const P = piece(); const g = P.o;
  footPlate(g, 0.75, 0.85, V(0, 0.03, 0.1), 0, ['footL', 'footR'], 0.15); box(g, 0.75, 0.03, 0.85, MAT.frame, 0, 0.015, 0.1, 0.008);
  tube(g, [0, 0.03, -0.32], [0, 2.1, -0.32], 0.12); tube(g, [0, 0.045, -0.32], [0, 0.045, -0.6], 0.08);
  const fanG = new THREE.Group(); fanG.position.set(0, 1.72, -0.24); fanG.rotation.y = Math.PI / 2; g.add(fanG);
  disc(fanG, [[0.04, -0.07], [0.2, -0.07], [0.22, -0.05], [0.22, 0.05], [0.2, 0.07], [0.04, 0.07]], 0, 0, 0, MAT.shroud, 96);
  for (const s of [-1, 1]) for (let i = 0; i < 20; i++) { const a = i * Math.PI / 10; box(fanG, 0.004, 0.01, 0.12, MAT.cap, s * 0.072, Math.cos(a) * 0.13, Math.sin(a) * 0.13, 0.002).rotation.x = -a; }
  box(g, 0.3, 0.06, 0.12, MAT.frame, 0, 2.1, -0.28, 0.01);
  for (const s of [-1, 1]) { tube(g, [0, 2.06, -0.25], [s * 0.15, 2.06, -0.2], 0.04); pulley(g, V(s * 0.15, 2.06, -0.17), 'x', 0.03); }
  const mon = new THREE.Group(); mon.position.set(0, 1.42, -0.24); g.add(mon); box(mon, 0.18, 0.14, 0.04, MAT.cap, 0, 0, 0, 0.012); mesh(new THREE.PlaneGeometry(0.14, 0.1), MAT.screen, mon, 0, 0, 0.021);
  const hs = [], cords = [];
  for (const s of [-1, 1]) {
    const h = new THREE.Group(); g.add(h); hgrip(h, 0.018, 0.15, 0, 0, 0, 'y'); cyl(h, 0.022, 0.012, MAT.cap, 0, 0.08, 0, 'y', 24); cyl(h, 0.022, 0.012, MAT.cap, 0, -0.08, 0, 'y', 24); mesh(new THREE.TorusGeometry(0.012, 0.003, 8, 20), MAT.steel, h, 0, 0.095, 0);
    grip(h, s > 0 ? 'gripL' : 'gripR', V(), { radius: 0.018, length: 0.14, hand: s > 0 ? 'L' : 'R', orient: ['neutral'] }, V(0, 1, 0), V(0, 0, -1)); hs.push([h, s]); cords.push(cableLine(g, 1));
  }
  const set = v => { const k = (1 - Math.cos(v * Math.PI)) / 2; hs.forEach(([h, s], i) => { h.position.set(s * 0.25, 1.85 - k * 1.0, -0.12 + k * 0.38); cords[i].update([V(s * 0.15, 2.06, -0.14), h.position.clone().add(V(0, 0.1, 0))]); }); };
  dof(P, 'motion', 'Pull', 0, 1, 0, '', set); set(0); return P;
});

// ================================================================= BATCH 1 REVIEW MACHINES (Nov 2 2026)
// rotation (about X) that takes vector a to vector b, both in the YZ plane
const angX = (a, b) => Math.atan2(a.y * b.z - a.z * b.y, a.y * b.y + a.z * b.z) * -1;

def('horizontal-leg-press', 'Horizontal (seated) leg press', 'Machines: legs', 1, 'fixed seat with the back reclined about 20 deg; vertical tread footplate on linear bearings moves forward; weight stack behind the seat; motion 0 = knees ~90 deg, 1 = legs extended', () => {
  const P = piece(); const g = P.o;
  seatUnit(g, { seatH: 0.48, backTilt: 0.35, backH: 0.78, backZ: -0.24, seatW: 0.46 });
  spine(g, -1.15, 1.35, 0.9);
  seatHandles(g, 0.62, 0.06, 0.31); // audit: handles up at hand height of a seated user (were 0.5, out of reach)
  // guide rods and the footplate carriage
  for (const s of [-1, 1]) {
    tube(g, [s * 0.3, 0.07, 0.4], [s * 0.3, 0.22, 0.4], 0.07); tube(g, [s * 0.3, 0.07, 1.3], [s * 0.3, 0.22, 1.3], 0.07);
    cyl(g, 0.016, 0.92, MAT.chrome, s * 0.3, 0.25, 0.85, 'z', 32);
    for (const z of [0.4, 1.3]) box(g, 0.08, 0.07, 0.06, MAT.frame, s * 0.3, 0.25, z, 0.008);
    tube(g, [s * 0.3, 0.07, 1.3], [s * 0.42, 0.07, 1.3], 0.07);
  }
  tube(g, [-0.42, 0.07, 1.3], [0.42, 0.07, 1.3], 0.08); tube(g, [-0.3, 0.07, 0.4], [0.3, 0.07, 0.4], 0.08);
  for (const s of [-1, 1]) cyl(g, 0.028, 0.05, MAT.rubber, s * 0.3, 0.25, 0.46, 'z', 24); // bumpers
  const car = new THREE.Group(); g.add(car);
  for (const s of [-1, 1]) { bearing(car, V(s * 0.3, 0.25, 0.05), new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), Math.PI / 2)); tube(car, [s * 0.3, 0.3, 0.05], [s * 0.26, 0.9, 0.04], 0.06); }
  tube(car, [-0.3, 0.25, 0.05], [0.3, 0.25, 0.05], 0.07); tube(car, [-0.27, 0.9, 0.04], [0.27, 0.9, 0.04], 0.06);
  const fp = new THREE.Group(); fp.position.set(0, 0.6, 0.0); fp.rotation.x = -Math.PI / 2; car.add(fp);
  footPlate(fp, 0.66, 0.62, V(0, 0, 0), 0, ['footL', 'footR'], 0.14, V(0, 0, -1));
  // foot anchors: sole faces the user (-Z), toes up
  fp.getObjectByName('footL').removeFromParent(); fp.getObjectByName('footR').removeFromParent();
  foot(car, 'footL', V(0.14, 0.58, -0.03), V(0, 1, 0), V(0, 0, -1)); foot(car, 'footR', V(-0.14, 0.58, -0.03), V(0, 1, 0), V(0, 0, -1));
  // stack behind the seat; the cable runs under the seat to the carriage
  const st = weightStack(g, 0, -1.15, { h: 1.55 });
  pulley(g, V(0, 1.63, -1.15), 'x', 0.05); pulley(g, V(0, 1.63, -0.9), 'x', 0.05); pulley(g, V(0, 0.16, -0.9), 'x', 0.05); pulley(g, V(0, 0.16, 0.35), 'x', 0.05);
  tube(g, [0, 1.7, -1.15], [0, 1.7, -0.9], 0.06); tube(g, [0, 0.07, -0.9], [0, 1.7, -0.9], 0.07);
  const cab = cableLine(g, 6);
  const set = m => { const z = 0.6 + 0.45 * m; car.position.z = z; st.setLift(m * 0.45); cab.update([st.stackTop(), V(0, 1.68, -1.15), V(0, 1.68, -0.9), V(0, 0.21, -0.9), V(0, 0.21, 0.35), V(0, 0.25, z)]); };
  dof(P, 'motion', 'Press (0 = knees ~90 deg)', 0, 1, 0, '', set); set(0); return P;
});

def('standing-leg-curl', 'Standing leg curl', 'Machines: legs', 1, 'stand on the tread platform, chest on the pad, hold the handles; knee pad above the working (left) knee, ankle roller on a lever pivoting at the knee; motion 0 = leg straight, 1 = curled ~110 deg', () => {
  const P = piece(); const g = P.o;
  spine(g, -0.45, 1.05, 0.8);
  box(g, 0.7, 0.1, 0.55, MAT.frame, 0, 0.07, -0.05, 0.01); footPlate(g, 0.68, 0.52, V(0, 0.13, -0.05), 0, ['footL', 'footR'], 0.11);
  // chest pad post and handles
  tube(g, [0, 0.07, 0.62], [0, 1.15, 0.42], 0.08); tube(g, [0, 1.15, 0.42], [0, 1.24, 0.36], 0.06);
  const cp = new THREE.Group(); cp.position.set(0, 1.3, 0.3); cp.rotation.x = Math.PI / 2 - 0.12; g.add(cp);
  pad(cp, 0.36, 0.08, 0.32, 0, 0, 0); body(g, 'chest', 'chest', V(0, 1.3, 0.255), V(0, 0, -1));
  tube(g, [-0.22, 1.12, 0.42], [0.22, 1.12, 0.42], 0.05);
  handlePair(g, ['gripL', 'gripR'], s => V(s * 0.22, 1.12, 0.42), s => V(s * 0.24, 1.12, 0.4), () => V(0, 0, -1), 0.13, { orient: ['neutral'], palm: V(0, 0, 1) });
  // column on the user's left carrying the knee pad and the lever pivot
  tube(g, [0.36, 0.07, 0.62], [0.36, 1.0, 0.62], 0.08); tube(g, [0, 0.07, 0.62], [0.36, 0.07, 0.62], 0.08);
  tube(g, [0.36, 0.62, 0.62], [0.36, 0.62, 0.2], 0.07); tube(g, [0.36, 0.62, 0.2], [0.18, 0.62, 0.2], 0.05);
  const kp = new THREE.Group(); kp.position.set(0.1, 0.62, 0.16); kp.rotation.x = Math.PI / 2; g.add(kp); pad(kp, 0.16, 0.07, 0.2, 0, 0, 0);
  body(g, 'kneeL', 'knee', V(0.1, 0.62, 0.115), V(0, 0, -1));
  tube(g, [0.36, 0.5, 0.62], [0.36, 0.5, 0.0], 0.07); popPin(g, V(0.36, 0.56, 0.3), V(0, 1, 0));
  const lever = pivot(g, V(0.36, 0.5, 0.0), 'x'); hub(lever, V(0, 0, 0), 'x', 0.05, 0.08); cam(lever, 0.1, 0.02).position.x = 0.06;
  tube(lever, [0, 0, 0], [0, -0.38, -0.08], 0.05); tube(lever, [0, -0.38, -0.08], [-0.2, -0.38, -0.08], 0.04);
  roller(lever, 0.2, -0.24, -0.38, -0.08, 0.045);
  body(lever, 'ankleL', 'ankle', V(-0.24, -0.38, -0.03), V(0, 0, 1));
  const st = weightStack(g, 0, 1.05, { h: 1.55 });
  pulley(g, V(0.36, 1.05, 0.62), 'x', 0.045); pulley(g, V(0.0, 1.63, 1.05), 'x', 0.05);
  tube(g, [0.36, 1.0, 0.62], [0.36, 1.7, 0.85], 0.06); tube(g, [0.36, 1.7, 0.85], [0, 1.7, 1.05], 0.06);
  const cab = cableLine(g, 4);
  const set = m => { turn(lever, m * 1.92); st.setLift(m * 0.3); const camPt = V(0.42, 0.5, 0).add(V(0, 0.1, 0).applyAxisAngle(V(1, 0, 0), lever.rotation.x)); cab.update([st.stackTop(), V(0, 1.68, 1.05), V(0.36, 1.1, 0.62), camPt]); };
  dof(P, 'motion', 'Curl (0 = leg straight)', 0, 1, 0, '', set); set(0); return P;
});

// press machine with arms whose handle path follows a chosen direction (incline/decline): plate-loaded, iso-lateral
function directionalPress(P, g, { backTilt, hy, hz, dir, L, above, travel = 0.42 }) {
  seatUnit(g, { seatH: 0.48, backTilt, backH: 0.8, backZ: -0.16 });
  spine(g, -1.1, 0.6, 0.95);
  const t = V(0, Math.sin(dir), Math.cos(dir)); // handle travel direction
  let n = V(0, t.z, -t.y); if ((n.y > 0) !== above) n.negate();
  const arms = [];
  for (const s of [-1, 1]) {
    const H = V(s * 0.23, hy, hz), Pv = H.clone().addScaledVector(n, L).setX(s * 0.46);
    // tower to the pivot
    tube(g, [s * 0.5, 0.07, Pv.z], [s * 0.5, Pv.y, Pv.z], 0.09); tube(g, [s * 0.5, 0.07, Pv.z], [0, 0.07, Pv.z], 0.08);
    if (Pv.z > -1.1 && Pv.z < 0.6) {} else tube(g, [0, 0.07, Pv.z], [0, 0.07, -1.1], 0.08);
    tube(g, [s * 0.5, Pv.y * 0.5, Pv.z], [s * 0.2, 0.07, -0.5], 0.06);
    const a = pivot(g, Pv, 'x'); arms.push([a, s]); hub(a, V(s * 0.04, 0, 0), 'x', 0.055, 0.1);
    const E = H.clone().sub(Pv);
    bent(a, [V(0, 0, 0), V(-s * 0.04, E.y * 0.35, E.z * 0.35), V(-s * 0.15, E.y * 0.8, E.z * 0.8), E], 0.06);
    handle(a, s > 0 ? 'gripL' : 'gripR', null, E.clone().add(V(s * 0.03, 0, 0)), V(s, 0, 0), 0.15, { hand: s > 0 ? 'L' : 'R', orient: ['overhand'], palm: t.clone() });
    handle(a, s > 0 ? 'neutralL' : 'neutralR', E, E.clone().add(V(s * 0.05, above ? -0.03 : 0.03, -0.04)), V(0, above ? -1 : 1, 0), 0.14, { hand: s > 0 ? 'L' : 'R', orient: ['neutral'], palm: t.clone() });
    // plate horn on a short arm on the far side of the pivot so pressing lifts the plates
    const hornBase = above ? n.clone().multiplyScalar(0.28).add(V(s * 0.06, 0, 0)) : V(s * 0.06, 0.04, -0.3); // low pivot: rear stub rises as the handle goes forward
    tube(a, [0, 0, 0], hornBase, 0.06); horn(a, hornBase.clone().add(V(s * 0.02, 0, 0)), V(s, 0, 0), [20]);
    // safety stop
    cyl(g, 0.03, 0.05, MAT.rubber, s * 0.5, Pv.y - 0.12, Pv.z + 0.05, 'z', 24);
  }
  tube(g, [-0.5, arms[0][0].position.y, arms[0][0].position.z], [0.5, arms[0][0].position.y, arms[0][0].position.z], 0.08);
  // signed rotation that moves the handle along +t
  const r = V(0, hy, hz).sub(V(0, arms[0][0].position.y, arms[0][0].position.z));
  const sgn = Math.sign(-r.z * t.y + r.y * t.z) || 1, ang = travel / L;
  footPlate(g, 0.6, 0.22, V(0, 0.09, 0.52), -0.3, ['footL', 'footR'], 0.15); tube(g, [0, 0.07, 0.6], [0, 0.07, 0.4], 0.08);
  const set = m => arms.forEach(([a]) => turn(a, sgn * ang * m));
  dof(P, 'motion', 'Press (0 = handles at the chest)', 0, 1, 0, '', set); set(0);
}
def('incline-chest-press-machine', 'Incline chest press machine', 'Machines: upper body', 1, 'plate-loaded iso-lateral; back reclined ~35 deg; arms pivot high behind so the handles travel up and forward along the incline', () => {
  const P = piece(); directionalPress(P, P.o, { backTilt: 0.61, hy: 1.1, hz: -0.1, dir: 0.61, L: 0.95, above: true }) /* audit: handles start at the chest of a seated user */; return P;
});
def('decline-chest-press-machine', 'Decline chest press machine', 'Machines: upper body', 1, 'plate-loaded iso-lateral; upright seat; arms pivot low behind so the handles travel forward and down ~20 deg', () => {
  const P = piece(); directionalPress(P, P.o, { backTilt: 0.12, hy: 1.02, hz: 0.18, dir: -0.35, L: 0.78, above: false }); return P;
});

def('lever-pulldown', 'Lever pulldown (plate-loaded, iso-lateral)', 'Machines: upper body', 1, 'seat with thigh pads; two levers on high pivots behind the seat; opts.grip "wide" (default) or "narrow"; motion 0 = arms up, 1 = handles at the shoulders', (o = {}) => {
  const P = piece(); const g = P.o; const hx = o.grip === 'narrow' ? 0.2 : 0.42;
  seatUnit(g, { seatH: 0.48, backH: 0, seatD: 0.38 });
  spine(g, -1.0, 0.65, 0.95);
  // thigh roller
  tube(g, [0, 0.07, 0.4], [0, 0.6, 0.36], 0.08); holes(g, [0, 0.4, 0.42], [0, 0.58, 0.4], 5, V(0, 0, 1)); popPin(g, V(0.042, 0.5, 0.38), V(1, 0, 0));
  tube(g, [0, 0.6, 0.36], [0, 0.7, 0.22], 0.06); roller(g, 0.44, 0, 0.7, 0.2, 0.055);
  body(g, 'thighL', 'thigh', V(0.1, 0.645, 0.2), V(0, -1, 0)); body(g, 'thighR', 'thigh', V(-0.1, 0.645, 0.2), V(0, -1, 0));
  feetOnFloor(g, 0.45, 0.17);
  // rear towers
  const Pv = V(0, 1.45, -0.72); // audit: pivots lower so the handles come down to the shoulders of a seated user (was 1.72: stopped 0.4 m above them)
  for (const s of [-1, 1]) { tube(g, [s * 0.58, 0.07, -0.72], [s * 0.58, 1.95, -0.72], 0.1); tube(g, [s * 0.58, 0.07, -1.0], [s * 0.58, 0.07, 0.0], 0.08); tube(g, [s * 0.58, 1.0, -0.72], [s * 0.58, 0.07, -0.2], 0.06); }
  tube(g, [-0.58, 1.95, -0.72], [0.58, 1.95, -0.72], 0.09); tube(g, [-0.58, 0.07, -1.0], [0.58, 0.07, -1.0], 0.08);
  const H0 = V(0, 1.6, 0.1), H1 = V(0, 1.0, 0.0);
  const r0 = H0.clone().sub(Pv), r1 = H1.clone().sub(Pv), ang = angX(r0, r1);
  const arms = [];
  for (const s of [-1, 1]) {
    const a = pivot(g, V(s * 0.5, Pv.y, Pv.z), 'x'); arms.push(a); hub(a, V(0, 0, 0), 'x', 0.055, 0.1);
    const E = V(s * (hx - 0.5) + s * 0.08, r0.y, r0.z);
    bent(a, [V(0, 0, 0), V(s * 0.0, r0.y * 0.4 + 0.08, r0.z * 0.4), V(s * (hx - 0.5) * 0.6 + s * 0.08, r0.y * 0.85, r0.z * 0.85), E], 0.06);
    handle(a, s > 0 ? 'gripL' : 'gripR', null, E.clone(), V(-s, 0, 0), 0.15, { hand: s > 0 ? 'L' : 'R', orient: ['overhand', 'neutral'], palm: V(0, 1, 0) });
    // plate horn behind the pivot (pulling down lifts it)
    tube(a, [0, 0, 0], [s * 0.04, -0.12, -0.32], 0.06); horn(a, V(s * 0.06, -0.12, -0.34), V(s, 0, 0), [20]);
    cyl(g, 0.03, 0.05, MAT.rubber, s * 0.58, 1.6, -0.6, 'z', 24);
  }
  const set = m => arms.forEach(a => turn(a, -ang * m));
  dof(P, 'motion', 'Pull (0 = arms up)', 0, 1, 0, '', set); set(0); P.info = { grip: o.grip === 'narrow' ? 'narrow' : 'wide' }; return P;
});

def('lever-pulldown-narrow', 'Lever pulldown, narrow grip', 'Machines: upper body', 1, 'audit: lever pulldown with the narrow handles (same as lever-pulldown {grip:"narrow"})', () => R['lever-pulldown']({ grip: 'narrow' }));
def('chest-supported-t-bar', 'Chest-supported T-bar row', 'Machines: upper body', 1, 'stand on the raised tread platform, chest on the 45 deg pad, pull the lever handles up from below the pad; plate horn on the lever; motion 0 = arms long, 1 = handles at the chest', () => {
  const P = piece(); const g = P.o;
  spine(g, -0.6, 1.95, 0.85);
  box(g, 0.72, 0.18, 0.55, MAT.frame, 0, 0.11, -0.3, 0.012); footPlate(g, 0.7, 0.53, V(0, 0.21, -0.3), 0, ['footL', 'footR'], 0.14);
  for (const s of [-1, 1]) levelFoot(g, s * 0.33, -0.55);
  // chest pad on a braced post
  // audit (Aziz 04:22 "he is inside the machine"): the pad faces UP AND BACK toward the platform (chest lies on it, leaning forward),
  // its high end toward the lever; held by two side posts outside the legs and the arms' path, clear of the lever and handles
  const PC = V(0, 1.083, 0.413), PA = -Math.PI / 4;
  const cp = new THREE.Group(); cp.position.copy(PC); cp.rotation.x = PA; g.add(cp);
  pad(cp, 0.4, 0.08, 0.6, 0, 0, 0); box(cp, 0.5, 0.03, 0.06, MAT.frame, 0, -0.055, -0.12, 0.006); box(cp, 0.5, 0.03, 0.06, MAT.frame, 0, -0.055, 0.12, 0.006);
  for (const s of [-1, 1]) { tube(g, [s * 0.26, 0.07, -0.02], [s * 0.26, 1.0, 0.42], 0.06); tube(g, [s * 0.26, 0.07, -0.02], [s * 0.33, 0.07, -0.3], 0.06); }
  body(g, 'chest', 'chest', PC.clone().add(V(0, 0.045, 0).applyAxisAngle(V(1, 0, 0), PA)), V(0, 1, 0).applyAxisAngle(V(1, 0, 0), PA));
  // lever pivoting low at the front
  // audit (Aziz Nov 3 'still wrong', MoveKit: handles row back past the torso): pivot moved far forward and low so the lever is long and
  // shallow and the handles rise nearly straight up under the chest (the short 45 deg lever swung them forward, away from the body)
  const Pv = V(0, 0.22, 1.85); tube(g, [0, 0.07, 1.95], [0, 0.22, 1.85], 0.08); for (const s of [-1, 1]) tube(g, [s * 0.12, 0.07, 1.85], [s * 0.12, 0.22, 1.85], 0.06);
  const lever = pivot(g, Pv, 'x'); hub(lever, V(0, 0, 0), 'x', 0.05, 0.22);
  const Hc = V(0, 0.80, 0.36).sub(Pv);   // audit (reviewer 08:30, MoveKit steps): handles start in reach of straight arms under the pad
  tube(lever, [0, 0, 0], Hc, 0.07);
  horn(lever, Hc.clone().multiplyScalar(0.5).add(V(0.04, 0.04, 0)), V(1, 0, 0), [20]); horn(lever, Hc.clone().multiplyScalar(0.5).add(V(-0.04, 0.04, 0)), V(-1, 0, 0), [20]);
  tube(lever, Hc.clone().multiplyScalar(0.5), Hc.clone().multiplyScalar(0.5).add(V(0, 0.04, 0)), 0.05);
  // handle yoke: wide overhand grips and neutral grips
  tube(lever, Hc.clone().add(V(-0.3, 0, 0)), Hc.clone().add(V(0.3, 0, 0)), 0.05);
  for (const s of [-1, 1]) {
    handle(lever, s > 0 ? 'gripL' : 'gripR', Hc.clone().add(V(s * 0.3, 0, 0)), Hc.clone().add(V(s * 0.3, -0.02, -0.04)), V(s * 0.5, 0, -1).normalize(), 0.14, { hand: s > 0 ? 'L' : 'R', orient: ['overhand'], palm: V(0, -1, 0) });
    handle(lever, s > 0 ? 'neutralL' : 'neutralR', Hc.clone().add(V(s * 0.12, 0, 0)), Hc.clone().add(V(s * 0.12, -0.04, 0)), V(0, -1, 0), 0.13, { hand: s > 0 ? 'L' : 'R', orient: ['neutral'], palm: V(-s, 0, 0) });
  }
  cyl(g, 0.03, 0.06, MAT.rubber, 0, 0.12, 0.42, 'y', 24); tube(g, [0, 0.07, 0.42], [0, 0.09, 0.42], 0.05);
  // audit (Aziz 20:06 reference video): handles travel about 0.5 m, up to just under the front of the pad (was 0.33 m)
  const r = Hc.clone(), ang = 0.36 / r.length(), sgn = Math.sign(-r.z) || 1;   // ~0.36 m arc (Nov 3: long lever): up to elbows bent past 90 deg
  const set = m => turn(lever, sgn * ang * m);
  dof(P, 'motion', 'Row (0 = arms long)', 0, 1, 0, '', set); set(0); return P;
});

def('iso-chest-press-incline', 'Iso-lateral incline chest press (plate-loaded)', 'Machines: upper body', 1, 'generic machine after Aziz\'s reference photo ("Gundam" chest press): inclined back pad, rear arch frame with plate storage pegs, two levers pivoting high on tall front uprights, handles beside the chest press forward and slightly down on converging paths, plate horns on the levers, tread foot platform; motion 0 = handles at the chest, 1 = arms extended', () => {
  const P = piece(); const g = P.o;
  seatUnit(g, { seatH: 0.48, backTilt: 0.45, backH: 0.82, backZ: -0.2, seatW: 0.42 });
  spine(g, -1.0, 0.95, 1.0);
  // front tread deck
  box(g, 1.16, 0.06, 0.62, MAT.frame, 0, 0.1, 0.62, 0.012); footPlate(g, 0.62, 0.36, V(0, 0.135, 0.66), 0, ['footL', 'footR'], 0.15);
  for (const x of [-0.55, 0.55]) for (const z of [0.34, 0.9]) levelFoot(g, x, z);
  // rear arch frame behind the seat, with plate storage pegs
  for (const s of [-1, 1]) {
    tube(g, [s * 0.45, 0.07, -0.78], [s * 0.45, 1.5, -0.78], 0.08);
    tube(g, [s * 0.45, 0.07, -0.78], [s * 0.45, 0.07, 0.05], 0.08);
    for (const y of [0.42, 1.12]) horn(g, V(s * 0.49, y, -0.78), V(s, 0, 0), y < 1 ? [20] : []);
    tube(g, [s * 0.45, 0.62, -0.78], [s * 0.2, 0.07, -0.35], 0.06);
  }
  bent(g, [V(-0.45, 1.5, -0.78), V(-0.36, 1.66, -0.78), V(0.36, 1.66, -0.78), V(0.45, 1.5, -0.78)], 0.08);
  tube(g, [-0.45, 0.07, -0.78], [0.45, 0.07, -0.78], 0.08); tube(g, [-0.45, 0.9, -0.78], [0.45, 0.9, -0.78], 0.06);
  // tall front uprights carrying the lever pivots, braced back to the arch
  const PY = 1.9, PZ = 0.45, PX = 0.54;
  const arms = [];
  g.updateMatrixWorld(true);
  for (const s of [-1, 1]) {
    tube(g, [s * PX, 0.07, PZ], [s * PX, PY + 0.06, PZ], 0.1); cyl(g, 0.055, 0.012, MAT.cap, s * PX, PY + 0.115, PZ, 'y', 40);
    tube(g, [s * PX, 0.07, PZ], [s * 0.45, 0.07, -0.1], 0.08); tube(g, [s * PX, 1.35, PZ], [s * 0.45, 1.4, -0.78], 0.07);
    tube(g, [s * PX, 0.07, PZ], [s * PX, 0.07, 0.92], 0.08);
    cyl(g, 0.03, 0.05, MAT.rubber, s * PX, PY - 0.2, PZ + 0.07, 'z', 24); // lever rest bumper
    // lever: parent tilted about Y so the two handle paths converge
    const par = new THREE.Group(); par.position.set(s * (PX + 0.1), PY, PZ); par.rotation.y = -s * 0.1; g.add(par);
    const a = pivot(par, V(0, 0, 0), 'x'); arms.push(a); hub(a, V(0, 0, 0), 'x', 0.06, 0.12);
    g.updateMatrixWorld(true);
    const E = a.worldToLocal(V(s * 0.33, 1.16, 0.02)), F = a.worldToLocal(V(s * 0.44, 1.2, 0.08));
    bent(a, [V(0, 0, 0), V(0, -0.25, -0.06), V(F.x * 0.5, F.y * 0.75, F.z * 0.8), F], 0.065);
    tube(a, F, E, 0.05);
    const ax = V(-s * 0.2, -1, 0.15).normalize();
    const T = V(0, -0.37, 0.93).normalize();
    handle(a, s > 0 ? 'gripL' : 'gripR', null, E, ax, 0.15, { hand: s > 0 ? 'L' : 'R', orient: ['neutral'], palm: T });
    // plate horn on a stub in front of the pivot: pressing swings it up
    const hb = V(0.06 * s * 0, -0.12, 0.3);
    bent(a, [V(0, 0, 0), V(0, -0.02, 0.15), hb], 0.06); horn(a, hb.clone().add(V(0.04 * s, 0, 0)), a.worldToLocal(par.localToWorld(V(s, 0, 0))).sub(a.worldToLocal(par.localToWorld(V(0, 0, 0)))), [20]);
  }
  tube(g, [-PX, PY + 0.06, PZ], [PX, PY + 0.06, PZ], 0.08);
  // seat height adjustment
  popPin(g, V(0.05, 0.3, 0.05), V(1, 0, 0));
  const ang = 0.45 / 0.92;
  const set = m => arms.forEach(a => turn(a, -ang * m));
  dof(P, 'motion', 'Press (0 = handles at the chest)', 0, 1, 0, '', set); set(0);
  P.info = { reference: 'gundam-chest-press', converging: true }; return P;
});

// ================= Nov 2 round 2: v-squat, single-leg press, vertical climber
def('v-squat', 'V-squat machine', 'Machines: legs', 1, 'V-squat style squat machine: long lever pivoting low at the FRONT by the angled foot platform; back and shoulder pads ride its middle, plates load at the rear; the pads swing down and back; motion 0 = bottom, 1 = standing', () => {
  const P = piece(); const g = P.o;
  for (const s of [-1, 1]) baseRail(g, [s * 0.42, 0, -1.45], [s * 0.42, 0, 0.85], 0.09);
  for (const z of [-1.45, 0.85]) tube(g, [-0.42, 0.07, z], [0.42, 0.07, z], 0.08);
  footPlate(g, 0.82, 0.6, V(0, 0.28, 0.15), -0.35, ['footL', 'footR'], 0.15);
  for (const s of [-1, 1]) { tube(g, [s * 0.38, 0.07, 0.42], [s * 0.38, 0.33, 0.35], 0.06); tube(g, [s * 0.38, 0.07, -0.1], [s * 0.38, 0.2, -0.05], 0.06);
    tube(g, [s * 0.42, 0.07, 0.62], [s * 0.42, 0.62, 0.62], 0.1); tube(g, [s * 0.42, 0.07, 0.85], [s * 0.42, 0.55, 0.64], 0.07);   // front pivot towers
    tube(g, [s * 0.42, 0.07, -0.95], [s * 0.42, 0.42, -0.95], 0.07); box(g, 0.1, 0.05, 0.12, MAT.rubber, s * 0.42, 0.45, -0.95, 0.01); } // rear stop with bumper
  tube(g, [0, 0.07, -1.45], [0, 0.07, 0.85], 0.09);
  const arm = pivot(g, V(0, 0.55, 0.62), 'x'); hub(arm, V(0, 0, 0), 'x', 0.07, 0.9);
  // arm-local points (arm at rest = standing): sled (back pad centre) at (0, 0.88, -0.65), rear plate horns at (0, 0.45, -1.22)
  for (const s of [-1, 1]) {
    bent(arm, [V(s * 0.42, 0, 0), V(s * 0.36, 0.55, -0.3), V(s * 0.27, 0.86, -0.62)], 0.07, MAT.frame);   // front arm up to the sled
    bent(arm, [V(s * 0.27, 0.8, -0.75), V(s * 0.3, 0.6, -1.0), V(s * 0.3, 0.45, -1.22)], 0.07, MAT.frame); // back down to the horns
    horn(arm, V(s * 0.3, 0.45, -1.22), V(s, 0, 0), [20, 20]);
  }
  tube(arm, [-0.3, 0.45, -1.22], [0.3, 0.45, -1.22], 0.07);
  const q = new THREE.Group(); q.position.set(0, 0.88, -0.65); q.rotation.x = -0.15; arm.add(q);
  hackSled(q);
  for (const s of [-1, 1]) tube(arm, [s * 0.27, 0.86, -0.62], [s * 0.2, 0.88, -0.72], 0.06);
  const set = m => turn(arm, -0.53 * (1 - m)); dof(P, 'motion', 'Stand (0 = bottom)', 0, 1, 1, '', set); set(1); return P;
});

def('single-leg-press', 'Iso-lateral leg press (single-leg)', 'Machines: legs', 1, 'reclined seat; two independent foot plates, each on its own lever pivoting low in front, each with its own plate horn; dofs motionL / motionR (one leg each) and motion (both); for single-leg press drive motionR or motionL; 0 = knees bent, 1 = leg extended', () => {
  const P = piece(); const g = P.o;
  seatUnit(g, { seatH: 0.45, backTilt: 0.75, backH: 0.85, backZ: -0.24, seatW: 0.46 });
  spine(g, -1.0, 1.35, 0.95);
  seatHandles(g, 0.62, 0.06, 0.31); // audit: handles in reach of the seated user
  const L = 0.62, ang = 0.42 / L, levers = {};
  for (const s of [-1, 1]) {
    const F = V(s * 0.16, 0.85, 0.52);                    // foot plate centre at rest (audit: was z 0.9, out of reach of a seated user)
    const Pv = V(s * 0.27, F.y - 0.96 * L, F.z + 0.29 * L); // pivot below and slightly in front, so the plate moves up-forward along the leg line
    tube(g, [s * 0.36, 0.07, Pv.z], [s * 0.36, Pv.y, Pv.z], 0.09); tube(g, [s * 0.36, 0.07, Pv.z - 0.3], [s * 0.36, 0.07, Pv.z + 0.15], 0.08);
    tube(g, [s * 0.36, Pv.y * 0.6, Pv.z], [s * 0.12, 0.07, Pv.z - 0.35], 0.06);
    const a = pivot(g, Pv, 'x'); hub(a, V(s * 0.05, 0, 0), 'x', 0.055, 0.14);
    const E = F.clone().sub(Pv);
    bent(a, [V(0, 0, 0), V(-s * 0.03, E.y * 0.5, E.z * 0.5), V(-s * 0.08, E.y * 0.88, E.z * 0.88), V(-s * 0.11, E.y, E.z + 0.06)], 0.065);
    const fp = new THREE.Group(); fp.position.copy(E).add(V(0, 0, 0)); a.add(fp);
    footPlate(fp, 0.24, 0.36, V(0, 0, 0), -1.885, [s > 0 ? 'footL' : 'footR'], 0, V(0, 0, 1));
    // plate horn on a rear stub: pushing swings it up
    const hb = V(s * 0.06, 0.04, -0.3); tube(a, [0, 0, 0], hb, 0.06); horn(a, hb.clone().add(V(s * 0.02, 0, 0)), V(s, 0, 0), [20]);
    cyl(g, 0.03, 0.05, MAT.rubber, s * 0.36, Pv.y + 0.1, Pv.z - 0.07, 'z', 24);
    levers[s > 0 ? 'L' : 'R'] = a;
  }
  tube(g, [-0.36, 0.07, levers.L.position.z + 0.15], [0.36, 0.07, levers.L.position.z + 0.15], 0.08);
  const v = { L: 0, R: 0 };
  const upd = () => { turn(levers.L, v.L * ang); turn(levers.R, v.R * ang); };
  dof(P, 'motion', 'Press both (0 = knees bent)', 0, 1, 0, '', m => { v.L = v.R = m; upd(); });
  dof(P, 'motionL', 'Left leg', 0, 1, 0, '', m => { v.L = m; upd(); });
  dof(P, 'motionR', 'Right leg', 0, 1, 0, '', m => { v.R = m; upd(); });
  upd(); P.info = { iso: true }; return P;
});

def('vertical-climber', 'Vertical climber (VersaClimber style)', 'Cardio', 1, 'tall mast leaning slightly away from the user; pedal carriages slide on the lower mast and handle carriages on the upper mast; same-side hand and foot move together (opts.pattern "cross" links opposite sides); motion 0 = left hand and foot high, 1 = right high', (o = {}) => {
  const P = piece(); const g = P.o; const cross = o.pattern === 'cross';
  // base: long floor frame
  for (const s of [-1, 1]) baseRail(g, [s * 0.3, 0, -0.35], [s * 0.3, 0, 0.75], 0.08);
  tube(g, [-0.3, 0.07, -0.35], [0.3, 0.07, -0.35], 0.07); tube(g, [-0.3, 0.07, 0.55], [0.3, 0.07, 0.55], 0.08);
  const B = V(0, 0.1, 0.36), T = V(0, 2.45, 0.62), d = T.clone().sub(B).normalize(), len = B.distanceTo(T);
  const at = t => B.clone().addScaledVector(d, t);
  // mast: main beam with two chrome guide rails per side
  tube(g, B, T, 0.11);
  for (const s of [-1, 1]) {
    cyl(g, 0.014, len - 0.1, MAT.chrome, 0, 0, 0, 'y', 28).position.copy(at(len / 2).add(V(s * 0.085, 0, -0.04)));
    g.children[g.children.length - 1].quaternion.setFromUnitVectors(V(0, 1, 0), d);
    tube(g, [s * 0.3, 0.07, 0.55], at(0.55).add(V(s * 0.05, 0, 0.04)), 0.06); // rear braces
  }
  box(g, 0.3, 0.2, 0.08, MAT.frame, T.x, T.y + 0.02, T.z, 0.01); // top cap
  const con = new THREE.Group(); con.position.copy(at(len - 0.55)).add(V(0, 0, 0.09)); con.rotation.x = -0.35; g.add(con);
  box(con, 0.24, 0.16, 0.04, MAT.frame, 0, 0, 0, 0.01); box(con, 0.2, 0.12, 0.004, MAT.screen, 0, 0, -0.021, 0.002);
  // belt line inside the mast (decor)
  for (const s of [-1, 1]) pulley(g, at(0.12).add(V(s * 0.04, 0, 0.05)), 'x', 0.05), pulley(g, at(len - 0.2).add(V(s * 0.04, 0, 0.05)), 'x', 0.05);
  const cars = {};
  for (const s of [-1, 1]) {
    const side = s > 0 ? 'L' : 'R';
    // pedal carriage
    const pc = new THREE.Group(); pc.quaternion.setFromUnitVectors(V(0, 1, 0), d); g.add(pc);
    box(pc, 0.07, 0.16, 0.08, MAT.frameLight, s * 0.085, 0, -0.04, 0.01);
    for (const y of [-0.06, 0.06]) bearing(pc, V(s * 0.085, y, -0.04));
    const pq = new THREE.Group(); pq.position.set(s * 0.13, -0.04, -0.18); pq.quaternion.copy(pc.quaternion).invert(); pc.add(pq);
    tube(pc, [s * 0.1, 0, -0.06], [s * 0.13, -0.04, -0.14], 0.04);
    footPlate(pq, 0.13, 0.28, V(0, 0, 0), 0, ['foot' + side], 0, V(0, 0, 1));
    for (const z of [-0.06, 0.06]) { const st = cyl(pq, 0.006, 0.15, MAT.fabric, 0, 0.04, z, 'x', 12); } // toe straps
    box(pq, 0.15, 0.05, 0.02, MAT.fabric, 0, 0.045, 0.06, 0.005);
    // hand carriage with a vertical handle
    const hc = new THREE.Group(); hc.quaternion.setFromUnitVectors(V(0, 1, 0), d); g.add(hc);
    box(hc, 0.07, 0.18, 0.08, MAT.frameLight, s * 0.085, 0, -0.04, 0.01);
    for (const y of [-0.07, 0.07]) bearing(hc, V(s * 0.085, y, -0.04));
    handle(hc, 'grip' + side, V(s * 0.12, 0, -0.06), V(s * 0.2, -0.1, -0.16), V(0, 1, 0), 0.22, { hand: side, orient: ['neutral'], palm: V(0, 0, 1), r: 0.016 });
    cars[side] = { pc, hc };
  }
  const set = m => {
    const ph = { L: 1 - m, R: m };
    for (const side of ['L', 'R']) {
      const fpPh = ph[side], hPh = cross ? ph[side === 'L' ? 'R' : 'L'] : ph[side];
      cars[side].pc.position.copy(at(0.3 + 0.42 * fpPh)).add(V(0, 0, 0));
      cars[side].hc.position.copy(at(1.35 + 0.6 * hPh));
    }
  };
  dof(P, 'motion', 'Climb (0 = left high)', 0, 1, 0, '', set); set(0); P.info = { pattern: cross ? 'cross' : 'same' }; return P;
});

// road bicycle on a rear-wheel trainer stand (for "Cycling (Outdoor)")
function spokedWheel(p, pos) {
  const w = new THREE.Group(); w.position.copy(pos); w.userData.axis = 'x'; p.add(w);
  const tire = mesh(new THREE.TorusGeometry(0.322, 0.0135, 20, 180), MAT.rubber, w); tire.rotation.y = Math.PI / 2;
  const rimPts = [[0.288, -0.009], [0.3, -0.011], [0.31, -0.01], [0.31, 0.01], [0.3, 0.011], [0.288, 0.009]].map(([a, b]) => new THREE.Vector2(a, b));
  const rim = new THREE.LatheGeometry(rimPts, 160); rim.rotateZ(Math.PI / 2); mesh(rim, MAT.steel, w);
  cyl(w, 0.018, 0.1, MAT.frameLight, 0, 0, 0, 'x', 32);
  for (const s of [-1, 1]) cyl(w, 0.026, 0.004, MAT.steel, s * 0.035, 0, 0, 'x', 32);
  for (let i = 0; i < 28; i++) {
    const a = i / 28 * Math.PI * 2, s = i % 2 ? 1 : -1, t = a + s * 0.12;
    const A = V(s * 0.035, Math.sin(t) * 0.024, Math.cos(t) * 0.024), B = V(0, Math.sin(a) * 0.29, Math.cos(a) * 0.29);
    const sp = cyl(w, 0.001, A.distanceTo(B), MAT.chrome, 0, 0, 0, 'y', 6); sp.position.copy(A).add(B).multiplyScalar(0.5); sp.quaternion.setFromUnitVectors(V(0, 1, 0), B.clone().sub(A).normalize());
    cyl(w, 0.0025, 0.012, MAT.chrome, 0, 0, 0, 'y', 8).position.copy(B.clone().multiplyScalar(0.985));
  }
  return w;
}
def('road-bike', 'Road bike on a trainer stand', 'Cardio', 1, 'diamond frame road bicycle with two spoked wheels, drop bars, saddle, crank and pedals; rear axle clamped in a trainer stand with a roller, front wheel on a riser block; motion 0..1 = one crank revolution (wheels turn with it); anchors seat, gripL/R (hoods), dropL/R, footL/R', () => {
  const P = piece(); const g = P.o; const Fm = MAT.frame;
  const AY = 0.37, RA = V(0, AY, -0.5), FA = V(0, AY, 0.5), BB = V(0, AY - 0.07, -0.1);
  const stDir = V(0, 0.959, -0.284), ST = BB.clone().addScaledVector(stDir, 0.54);
  const htDir = V(0, 0.956, -0.292), crown = FA.clone().addScaledVector(htDir, 0.37), HT = crown.clone().addScaledVector(htDir, 0.15);
  // frame
  tube(g, BB, ST, 0.032, Fm); tube(g, ST.clone().addScaledVector(stDir, -0.02), HT.clone().addScaledVector(htDir, -0.02), 0.03, Fm);
  tube(g, BB, crown.clone().addScaledVector(htDir, 0.03), 0.04, Fm); tube(g, crown, HT.clone().addScaledVector(htDir, 0.02), 0.042, Fm);
  for (const s of [-1, 1]) {
    tube(g, BB.clone().add(V(s * 0.03, 0, 0)), RA.clone().add(V(s * 0.065, 0, 0)), 0.02, Fm);
    tube(g, ST.clone().addScaledVector(stDir, -0.03).add(V(s * 0.015, 0, 0)), RA.clone().add(V(s * 0.065, 0, 0)), 0.017, Fm);
    bent(g, [crown.clone().add(V(s * 0.03, 0, 0)), crown.clone().addScaledVector(htDir, -0.2).add(V(s * 0.045, 0, 0.01)), FA.clone().add(V(s * 0.05, 0, 0.03))], 0.022, Fm);
    cyl(g, 0.008, 0.012, MAT.steel, s * 0.06, RA.y, RA.z, 'x', 16); cyl(g, 0.008, 0.012, MAT.steel, s * 0.055, FA.y, FA.z, 'x', 16);
  }
  cyl(g, 0.024, 0.08, MAT.frameLight, 0, BB.y, BB.z, 'x', 32);
  // seatpost and saddle
  const SP = ST.clone().addScaledVector(stDir, 0.2); tube(g, ST, SP, 0.0135, MAT.chrome);
  saddle(g, 0, SP.y + 0.03, SP.z - 0.01); body(g, 'seat', 'seat', V(0, SP.y + 0.065, SP.z - 0.03));
  // stem and drop handlebar
  const stem = HT.clone().addScaledVector(htDir, 0.04), BAR = stem.clone().add(V(0, 0.02, 0.1)); tube(g, HT, stem, 0.018, Fm); tube(g, stem, BAR, 0.018, Fm);
  tube(g, BAR.clone().add(V(-0.2, 0, 0)), BAR.clone().add(V(0.2, 0, 0)), 0.0125, MAT.frameLight, true);
  for (const s of [-1, 1]) {
    const c = new THREE.CatmullRomCurve3([BAR.clone().add(V(s * 0.2, 0, 0)), BAR.clone().add(V(s * 0.21, 0, 0.07)), BAR.clone().add(V(s * 0.21, -0.07, 0.11)), BAR.clone().add(V(s * 0.21, -0.14, 0.06)), BAR.clone().add(V(s * 0.21, -0.14, -0.06))]);
    mesh(new THREE.TubeGeometry(c, 60, 0.0135, 16, false), MAT.rubber, g);
    // brake hood + lever
    const hood = BAR.clone().add(V(s * 0.21, 0.025, 0.09));
    const hg = new THREE.Group(); hg.position.copy(hood); g.add(hg); mesh(new THREE.CapsuleGeometry(0.017, 0.07, 10, 24), MAT.rubber, hg).rotation.x = Math.PI / 2 - 0.25;
    bent(g, [hood.clone().add(V(0, 0, 0.04)), hood.clone().add(V(0, -0.06, 0.05)), hood.clone().add(V(0, -0.12, 0.03))], 0.006, MAT.steel);
    grip(g, s > 0 ? 'gripL' : 'gripR', hood, { radius: 0.017, length: 0.07, hand: s > 0 ? 'L' : 'R', orient: ['neutral'] }, V(0, 0.25, 1).normalize(), V(0, -1, 0));
    grip(g, s > 0 ? 'dropL' : 'dropR', BAR.clone().add(V(s * 0.21, -0.14, -0.03)), { radius: 0.0135, length: 0.1, hand: s > 0 ? 'L' : 'R', orient: ['neutral'] }, V(0, 0, 1), V(0, -1, 0));
  }
  // wheels
  const rw = spokedWheel(g, RA), fw = spokedWheel(g, FA);
  for (let i = 0; i < 9; i++) cyl(rw, 0.022 + i * 0.0035, 0.002, MAT.chrome, -0.02 - i * 0.004, 0, 0, 'x', 32); // cassette
  // drivetrain: crank, chain runs
  const C = crank2(g, BB, 0.17, 0.3);
  for (const [y0, y1] of [[0.1, 0.03], [-0.1, -0.03]]) tube(g, BB.clone().add(V(-0.1, y0, 0)), RA.clone().add(V(-0.1 + 0.07, y1, 0)), 0.004, MAT.steel);
  // trainer stand: A-frame clamping the rear axle, resistance roller on the tyre
  for (const s of [-1, 1]) {
    tube(g, RA.clone().add(V(s * 0.08, 0, 0)), V(s * 0.38, 0.06, -0.75), 0.03, Fm); tube(g, RA.clone().add(V(s * 0.08, 0, 0)), V(s * 0.38, 0.06, -0.2), 0.03, Fm);
    tube(g, V(s * 0.38, 0.05, -0.8), V(s * 0.38, 0.05, -0.15), 0.035, Fm); levelFoot(g, s * 0.38, -0.8); levelFoot(g, s * 0.38, -0.15);
    cyl(g, 0.022, 0.03, MAT.frameLight, s * 0.085, RA.y, RA.z, 'x', 24);
  }
  tube(g, V(-0.38, 0.05, -0.2), V(0.38, 0.05, -0.2), 0.03, Fm);
  cyl(g, 0.03, 0.06, MAT.steel, 0, AY - 0.05, -0.86, 'x', 32); flywheel(g, 0.08, 0.03, 0.07, AY - 0.05, -0.86); // resistance roller on the back of the tyre
  for (const s of [-1, 1]) tube(g, V(s * 0.05, AY - 0.05, -0.86), V(s * 0.3, 0.06, -0.78), 0.025, Fm);
  // front riser block
  box(g, 0.14, 0.035, 0.36, MAT.rubber, 0, 0.0175, 0.5, 0.01);
  const set = v => { const a = v * Math.PI * 2; C.set(a); turn(rw, a * 2.9); turn(fw, a * 2.9); };
  dof(P, 'motion', 'Pedal (one crank revolution)', 0, 1, 0, '', set); set(0); return P;
});

// ================= Nov 2 round 3: donkey calf raise, GHD, ab wheel
def('donkey-calf-raise-machine', 'Donkey calf raise machine', 'Machines: legs', 2, 'tread toe block; padded lever rests across the lower back and hips of a user bent forward ~80 deg; front handles at ~0.95 m to lean on; plate horns at the pad end; motion 0 = heels low, 1 = heels high (pad rises ~0.09 m)', () => {
  const P = piece(); const g = P.o;
  spine(g, -0.45, 1.15, 0.8);
  // toe block (heels hang off the back edge)
  box(g, 0.56, 0.12, 0.2, MAT.frame, 0, 0.1, 0.05, 0.012); footPlate(g, 0.52, 0.17, V(0, 0.165, 0.06), 0, ['footL', 'footR'], 0.11);
  box(g, 0.6, 0.02, 0.55, MAT.deck, 0, 0.05, -0.15, 0.005);
  // front tower: lever pivot and lean-on handles
  const PZ = 0.98, PY = 1.15;
  for (const s of [-1, 1]) { tube(g, [s * 0.22, 0.07, PZ], [s * 0.22, PY + 0.05, PZ], 0.09); tube(g, [s * 0.22, 0.07, PZ + 0.15], [s * 0.22, 0.75, PZ], 0.06); }
  tube(g, [-0.22, PY + 0.05, PZ], [0.22, PY + 0.05, PZ], 0.08); tube(g, [-0.22, 0.07, PZ], [0.22, 0.07, PZ], 0.08);
  for (const s of [-1, 1]) {
    tube(g, [s * 0.22, 0.95, PZ], [s * 0.22, 0.95, 0.78], 0.05);
    handle(g, s > 0 ? 'gripL' : 'gripR', null, V(s * 0.22, 0.95, 0.78), V(-s, 0, 0), 0.14, { hand: s > 0 ? 'L' : 'R', orient: ['neutral', 'overhand'], palm: V(0, -1, 0), both: V(0, 0.95, 0.78) });
  }
  // lever from the front pivot back over the hips
  const lever = pivot(g, V(0, PY, PZ), 'x'); hub(lever, V(0, 0, 0), 'x', 0.05, 0.36);
  tube(lever, [0, 0, 0], [0, 0, -0.98], 0.08); tube(lever, [0, 0, -0.62], [0, -0.03, -0.62], 0.05);
  for (const s of [-1, 1]) tube(lever, [0, 0, -0.98], [s * 0.2, -0.02, -0.98], 0.05);
  pad(lever, 0.46, 0.09, 0.24, 0, -0.1, -0.98); body(lever, 'hipPad', 'hip', V(0, -0.105, -0.98), V(0, -1, 0));
  for (const s of [-1, 1]) horn(lever, V(s * 0.26, 0.02, -0.9), V(s, 0, 0), [20]);
  cyl(g, 0.035, 0.06, MAT.rubber, 0.13, PY - 0.08, PZ - 0.2, 'y', 24); tube(g, [0.13, 0.07, PZ - 0.2], [0.13, PY - 0.11, PZ - 0.2], 0.05); // lever rest
  const ang = 0.09 / 0.98;
  const set = m => turn(lever, ang * m); dof(P, 'motion', 'Raise (0 = heels low)', 0, 1, 0, '', set); set(0); return P;
});

def('glute-ham-developer', 'Glute-ham developer (GHD)', 'Benches & stations', 2, 'angled frame; twin round thigh pads (top ~1.0 m, hips just over the front edge); vertical foot plate with ankle rollers behind; user lies face down with the head toward +Z; grab handles beside the pad; static', () => {
  const P = piece(); const g = P.o;
  // base and spine
  for (const s of [-1, 1]) baseRail(g, [s * 0.3, 0, -1.05], [s * 0.3, 0, -0.75], 0.08), baseRail(g, [s * 0.32, 0, 0.35], [s * 0.32, 0, 0.6], 0.08);
  tube(g, [-0.3, 0.07, -0.9], [0.3, 0.07, -0.9], 0.08); tube(g, [-0.32, 0.07, 0.5], [0.32, 0.07, 0.5], 0.08);
  tube(g, [0, 0.07, 0.5], [0, 0.55, -0.95], 0.09); // angled main beam
  // thigh pad column with adjustment holes
  tube(g, [0, 0.07, 0.5], [0, 0.78, 0.0], 0.09); holes(g, [0, 0.45, 0.24], [0, 0.7, 0.06], 5, V(0, 0.6, 0.8).normalize()); popPin(g, V(0.05, 0.6, 0.15), V(1, 0, 0));
  box(g, 0.3, 0.03, 0.18, MAT.frame, 0, 0.8, 0.0, 0.006);
  for (const s of [-1, 1]) { roller(g, 0.2, s * 0.11, 0.895, 0.0, 0.105); }
  body(g, 'thighs', 'thigh', V(0, 1.0, -0.02), V(0, 1, 0)); body(g, 'hip', 'hip', V(0, 1.0, 0.1), V(0, 1, 0));
  for (const s of [-1, 1]) handle(g, s > 0 ? 'gripL' : 'gripR', V(s * 0.24, 0.8, 0.0), V(s * 0.32, 0.8, 0.12), V(0, 0, 1), 0.13, { hand: s > 0 ? 'L' : 'R', orient: ['neutral'], palm: V(0, -1, 0) });
  // rear foot carriage: vertical foot plate, ankle rollers above and below the ankles
  tube(g, [0, 0.55, -0.95], [0, 0.98, -0.95], 0.08); holes(g, [0, 0.4, -0.906], [0, 0.52, -0.906], 3, V(0, 0, 1));
  tube(g, [-0.2, 0.62, -0.95], [0.2, 0.62, -0.95], 0.06);
  footPlate(g, 0.42, 0.28, V(0, 0.8, -0.92), Math.PI / 2, ['footL', 'footR'], 0.1);
  for (const s of [-1, 1]) {
    tube(g, [s * 0.04, 0.98, -0.95], [s * 0.04, 1.0, -0.8], 0.04); tube(g, [s * 0.04, 0.88, -0.95], [s * 0.04, 0.87, -0.8], 0.04);
    roller(g, 0.16, s * 0.13, 1.0, -0.8, 0.045); roller(g, 0.16, s * 0.13, 0.87, -0.8, 0.045);
    body(g, s > 0 ? 'ankleL' : 'ankleR', 'ankle', V(s * 0.12, 0.955, -0.8), V(0, -1, 0));
  }
  tube(g, [-0.04, 1.0, -0.8], [0.04, 1.0, -0.8], 0.04); tube(g, [-0.04, 0.87, -0.8], [0.04, 0.87, -0.8], 0.04);
  P.info = { headToward: '+Z', static: true }; return P;
});

def('ab-wheel', 'Ab wheel', 'Free weights', 2, 'double wheel 0.18 m with treaded tyres and a through-axle; knurled rubber handle on each side; origin at the axle centre; contact = wheel bottom; motion 0..1 = one wheel revolution', () => {
  const P = piece(); const g = P.o;
  const w = new THREE.Group(); w.userData.axis = 'x'; g.add(w);
  for (const s of [-1, 1]) {
    const x = s * 0.032;
    const pts = [[0.02, -0.024], [0.07, -0.024], [0.084, -0.02], [0.09, -0.012], [0.09, 0.012], [0.084, 0.02], [0.07, 0.024], [0.02, 0.024]].map(([a, b]) => new THREE.Vector2(a, b));
    const t = new THREE.LatheGeometry(pts, 96); t.rotateZ(Math.PI / 2); mesh(t, MAT.rubber, w, x, 0, 0);
    for (let i = 0; i < 48; i++) { const a = i / 48 * Math.PI * 2; const b = box(w, 0.036, 0.009, 0.004, MAT.rubber, x, Math.sin(a) * 0.0905, Math.cos(a) * 0.0905, 0.0012); b.rotation.x = -a; }
    disc(w, [[0.012, -0.026], [0.06, -0.026], [0.06, 0.026], [0.012, 0.026]], x, 0, 0, MAT.frameLight, 64);
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; cyl(w, 0.006, 0.054, MAT.steel, x, Math.sin(a) * 0.04, Math.cos(a) * 0.04, 'x', 16); }
  }
  cyl(g, 0.009, 0.36, MAT.steel, 0, 0, 0, 'x', 24);
  for (const s of [-1, 1]) {
    cyl(g, 0.016, 0.012, MAT.cap, s * 0.07, 0, 0, 'x', 32);
    hgrip(g, 0.017, 0.11, s * 0.13, 0, 0, 'x'); cyl(g, 0.019, 0.01, MAT.cap, s * 0.19, 0, 0, 'x', 32);
    grip(g, s > 0 ? 'gripL' : 'gripR', V(s * 0.13, 0, 0), { radius: 0.017, length: 0.1, hand: s > 0 ? 'L' : 'R', orient: ['overhand'] }, V(s, 0, 0), V(0, -1, 0));
  }
  attach(g, 'contact', V(0, -0.09, 0), { note: 'wheel bottom on the floor' });
  const set = m => turn(w, -m * Math.PI * 2); dof(P, 'motion', 'Roll (one revolution)', 0, 1, 0, '', set); set(0); return P;
});

// ================= Nov 3: calf block
def('calf-block', 'Calf raise block', 'Benches & stations', 2, '0.12 m step, 0.6 x 0.3 m: wooden core with steel end plates, rubber tread wrapping a rounded rear edge; stand facing +Z with the balls of the feet on the rear (-Z) edge so the heels hang off behind; origin on the floor under the block centre', () => {
  const P = piece(); const g = P.o;
  const H = 0.12, D = 0.3, W = 0.56, R = 0.035, T = 0.006;
  // profile in (u = -z, y); extruded along X
  const prof = (r0, h0, t) => {
    const s = new THREE.Shape(); const zb = D / 2; // rear edge sits at u = +zb (world z = -zb)
    if (t) { // rubber skin: top strip plus the rounded rear edge
      s.moveTo(-zb + 0.01, h0); s.lineTo(zb - r0, h0); s.absarc(zb - r0, h0 - r0, r0, Math.PI / 2, 0, true); s.lineTo(zb, h0 - r0 - 0.02);
      s.lineTo(zb + t, h0 - r0 - 0.02); s.lineTo(zb + t, h0 - r0); s.absarc(zb - r0, h0 - r0, r0 + t, 0, Math.PI / 2, false); s.lineTo(-zb + 0.01, h0 + t); s.closePath();
    } else {
      s.moveTo(-zb, 0.004); s.lineTo(zb, 0.004); s.lineTo(zb, h0 - r0); s.absarc(zb - r0, h0 - r0, r0, 0, Math.PI / 2, false); s.lineTo(-zb + 0.008, h0); s.absarc(-zb + 0.008, h0 - 0.008, 0.008, Math.PI / 2, Math.PI, false); s.closePath();
    }
    return s;
  };
  const ext = (shape, depth, m, x, curve = 48) => { const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: 0.002, bevelThickness: 0.002, bevelSegments: 3, curveSegments: curve }); geo.rotateY(Math.PI / 2); geo.translate(x, 0, 0); return mesh(geo, m, g); };
  ext(prof(R, H - T), W - 0.01, MAT.wood, -W / 2 + 0.005);
  ext(prof(R, H - T, T), W - 0.03, MAT.rubber, -W / 2 + 0.015);
  // tread ribs across the top
  for (let i = 0; i < 13; i++) box(g, W - 0.05, 0.003, 0.008, MAT.rubber, 0, H + 0.0015, -D / 2 + 0.05 + i * 0.019, 0.0012);
  // steel end plates with bolts and carry slots
  for (const s of [-1, 1]) {
    ext(prof(R + 0.004, H + 0.004), 0.008, MAT.frame, s > 0 ? W / 2 : -W / 2 - 0.008, 24);
    for (const [y, z] of [[0.03, -0.1], [0.03, 0.1], [0.085, -0.1], [0.085, 0.1]]) bolt(g, V(s * (W / 2 + 0.008), y, z), V(s, 0, 0), 0.007);
    box(g, 0.004, 0.022, 0.1, MAT.cap, s * (W / 2 + 0.009), 0.06, 0.0, 0.004);
  }
  for (const x of [-0.24, 0.24]) for (const z of [-0.11, 0.11]) cyl(g, 0.018, 0.006, MAT.rubber, x, 0.003, z, 'y', 32);
  // feet: balls of the feet on the rear edge, toes toward +Z
  for (const s of [-1, 1]) anchor(g, s > 0 ? 'footL' : 'footR', 'foot', V(s * 0.12, H + T, -D / 2 + 0.03), { note: 'ball of the foot on the rear edge, heel hangs off toward -Z' }, V(0, 0, 1), V(0, 1, 0));
  body(g, 'top', 'foot', V(0, H + T, 0), V(0, 1, 0));
  return P;
});

// ================================================================= API
export const ALIASES = { ezbar: 'ez-bar', bench: 'adjustable-bench', rack: 'power-rack', cable: 'cable-tower', pulldown: 'lat-pulldown-station', floor: 'floor-mat',
  'squat-machine': 'v-squat', versaclimber: 'vertical-climber', 'iso-leg-press': 'single-leg-press', bicycle: 'road-bike', 'outdoor-bike': 'road-bike', 'gundam-chest-press': 'iso-chest-press-incline', 'reverse-fly-machine': 'pec-deck' };

export function triCount(obj) { let n = 0; obj.traverse(o => { if (o.isMesh && o.visible) { const g = o.geometry; n += (g.index ? g.index.count : g.attributes.position.count) / 3; } }); return Math.round(n); }


// ---------------------------------------------------------------- static merge (draw calls)
// Finds the nodes the dofs move (by trying each dof across its range), then merges every other mesh into one mesh per
// material under its nearest moving ancestor (or the root). Moving parts, cables and anchors stay separate objects.
function snapshotNodes(root) { const m = new Map(); root.traverse(o => m.set(o, o.matrix.elements.join(',') + '|' + o.visible + '|' + o.children.length + '|' + (o.geometry ? o.geometry.uuid : ''))); return m; }
function findDynamic(root, P) {
  const dyn = new Set(), vol = new Set();
  root.traverse(o => o.updateMatrix());
  const base = snapshotNodes(root);
  const tries = [];
  for (const d of P.dofs) for (const k of [0, 0.25, 0.5, 0.75, 1]) tries.push([d, d.min + (d.max - d.min) * k]);
  for (const [d, v] of tries) {
    P.setters[d.name](v); root.traverse(o => o.updateMatrix());
    root.traverse(o => { const b = base.get(o); if (b === undefined) { vol.add(o.parent); return; } const c = o.matrix.elements.join(',') + '|' + o.visible + '|' + o.children.length + '|' + (o.geometry ? o.geometry.uuid : ''); if (c !== b) { dyn.add(o); if (c.split('|')[2] !== b.split('|')[2]) vol.add(o); } });
  }
  for (const d of P.dofs) P.setters[d.name](d.value);
  root.traverse(o => o.updateMatrix());
  return { dyn, vol };
}
function mergeStatic(root, P) {
  const { dyn, vol } = findDynamic(root, P);
  const buckets = new Map(); // rigid root -> material -> [mesh, matrix]
  const visit = (o, rigid, rel) => {
    for (const c of [...o.children]) {
      if (vol.has(c)) continue; // children rebuilt at runtime (battle ropes): leave alone
      const M = rel.clone().multiply(c.matrix);
      if (dyn.has(c) || c.userData.rigid) { if (!c.isMesh) visit(c, c, new THREE.Matrix4()); continue; }
      if (c.isMesh && c.visible && !c.userData.noMerge && !c.isSkinnedMesh) {
        if (!buckets.has(rigid)) buckets.set(rigid, new Map());
        const mb = buckets.get(rigid); if (!mb.has(c.material)) mb.set(c.material, []); mb.get(c.material).push([c, M]);
      }
      if (!vol.has(c)) visit(c, rigid, M);
    }
  };
  root.updateMatrix(); visit(root, root, new THREE.Matrix4());
  const removed = new Set();
  for (const [rigid, mb] of buckets) for (const [mtl, list] of mb) {
    if (list.length < 2) continue;
    let nv = 0, ni = 0; for (const [m] of list) { const g = m.geometry; nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2); const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let vo = 0, io = 0; const v = new THREE.Vector3(), nm = new THREE.Matrix3();
    let cast = false;
    for (const [m, M] of list) {
      const g = m.geometry, P0 = g.attributes.position, N0 = g.attributes.normal, U0 = g.attributes.uv; nm.getNormalMatrix(M); const flip = M.determinant() < 0;
      for (let i = 0; i < P0.count; i++) {
        v.fromBufferAttribute(P0, i).applyMatrix4(M); pos.set([v.x, v.y, v.z], (vo + i) * 3);
        if (N0) { v.fromBufferAttribute(N0, i).applyMatrix3(nm).normalize(); nor.set([v.x, v.y, v.z], (vo + i) * 3); }
        if (U0) uv.set([U0.getX(i), U0.getY(i)], (vo + i) * 2);
      }
      const n = g.index ? g.index.count : P0.count;
      for (let k = 0; k < n; k += 3) { const a = g.index ? g.index.getX(k) : k, b = g.index ? g.index.getX(k + 1) : k + 1, c = g.index ? g.index.getX(k + 2) : k + 2; idx[io++] = vo + a; idx[io++] = vo + (flip ? c : b); idx[io++] = vo + (flip ? b : c); }
      vo += P0.count; cast = cast || m.castShadow; removed.add(m);
    }
    const G = new THREE.BufferGeometry(); G.setAttribute('position', new THREE.BufferAttribute(pos, 3)); G.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); G.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); G.setIndex(new THREE.BufferAttribute(idx, 1));
    G.computeBoundingSphere(); G.computeBoundingBox();
    const out = new THREE.Mesh(G, mtl); out.name = 'merged'; out.castShadow = cast; out.receiveShadow = true; rigid.add(out);
  }
  // drop merged meshes; a mesh that still carries non-merged children becomes a plain Object3D in place
  for (const m of removed) {
    const keep = m.children.filter(c => !removed.has(c) && (c.children.length || !c.isMesh || !removed.has(c)));
    const parent = m.parent; if (!parent) continue;
    let needs = false; m.traverse(o => { if (o !== m && !removed.has(o) && (!o.isMesh || o.visible)) needs = true; });
    if (needs) { const h = new THREE.Object3D(); h.name = m.name; h.position.copy(m.position); h.quaternion.copy(m.quaternion); h.scale.copy(m.scale); for (const c of [...m.children]) h.add(c); parent.add(h); }
    parent.remove(m);
  }
}
export function drawCalls(obj) { let n = 0; obj.traverse(o => { if (o.isMesh && o.visible) n++; }); return n; }

export function build(id, opts = {}) {
  id = ALIASES[id] || id;
  const fn = R[id]; if (!fn) throw new Error('gymkit: unknown piece ' + id);
  const P = fn(opts); const meta = CATALOG.find(c => c.id === id);
  P.o.name = id;
  if (opts.merge !== false) mergeStatic(P.o, P);
  const anchors = {}; P.o.traverse(o => { if (o.userData.anchor) anchors[o.name] = o; });
  const values = Object.fromEntries(P.dofs.map(d => [d.name, d.value]));
  return {
    id, name: meta.name, category: meta.category, object: P.o, anchors, dofs: P.dofs, info: P.info || {}, attachment: P.attachment || null,
    set(name, v) { const f = P.setters[name]; if (!f) return; values[name] = v; f(v); },
    get: name => values[name],
    tris: triCount(P.o), drawCalls: drawCalls(P.o),
  };
}

// world-space grip frame for an IK solver: position, handle axis, palm direction, radius, length
export function gripFrame(anchorObj) {
  anchorObj.updateWorldMatrix(true, false);
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  anchorObj.matrixWorld.decompose(p, q, s);
  const a = anchorObj.userData.anchor;
  return { position: p, axis: V(1, 0, 0).applyQuaternion(q), palm: V(0, 1, 0).applyQuaternion(q), normal: V(0, 1, 0).applyQuaternion(q), ...a };
}

export const IDS = () => CATALOG.map(c => c.id);
