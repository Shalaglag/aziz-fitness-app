// Generic gym-kit pieces for the all-exercise recipes (adds to KIT from the recipes thread's gear.js).
// - hand-held pieces (kettlebell, d-handle, plate, ...) follow each grip: the piece's grip anchor sits on the solved grip
// - two-hand bars (ez-bar, trap-bar, dowel) follow the bar centre between the hands
// - everything else is a static station placed at e.at (rotY deg), dofs set from same-named recipe keys;
//   e.follow = {from, to} drives the piece's 'motion' dof from the hands' midpoint (levers move with the hands)
// Every body-contact anchor (seat, back, pad, chest...) gets an invisible box proxy tagged qaId '<id>.<anchor>' for the checker.
import * as THREE from '../../vendor/three-r160/three.module.min.js';
import * as GK from './gymkit.js';
import { KIT } from './gear.js';
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
// the engine reports a grip point for both hands even when a hand holds nothing; keep only the hands the recipe grips with
function held(out) {
  const rg = globalThis.__demo && globalThis.__demo.poser && globalThis.__demo.poser.grips, G = out.grips || {};
  if (!rg) return G; const o = {}; for (const s of ['L', 'R']) if (G[s] && rg[s] && rg[s].type !== 'none') o[s] = G[s]; return o;
}
const HIDE = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
const PER_HAND = new Set(['kettlebell', 'd-handle', 'plate', 'medicine-ball', 'backpack', 'band-tube', 'towel', 'ankle-strap']);
const TWO_HAND = new Set(['ab-wheel', 'ez-bar', 'trap-bar', 'dowel', 'straight-bar', 'lat-bar', 'wrist-roller']);
const PAD = { seat: [0.32, 0.34], back: [0.28, 0.55], head: [0.26, 0.2], chest: [0.3, 0.3], chestPad: [0.3, 0.3], pad: [0.3, 0.9], thighs: [0.4, 0.2], thighL: [0.12, 0.12], thighR: [0.12, 0.12],
  shin: [0.4, 0.12], ankle: [0.35, 0.1], knees: [0.4, 0.12], hip: [0.35, 0.2], hipPad: [0.35, 0.2], upperArms: [0.45, 0.3], forearms: [0.5, 0.2], surface: [0.6, 1.6], top: [0.5, 0.6] };
function build(e) {
  const P = GK.build(e.kit, e.opts || {});   // audit: per-recipe build options (e.g. pec-deck seatH)
  for (const d of P.dofs) if (e[d.name] !== undefined) P.set(d.name, e[d.name]);
  P.object.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  return P;
}
function proxies(P, id, g) {
  P.object.updateMatrixWorld(true);
  for (const [name, a] of Object.entries(P.anchors)) {
    const an = a.userData.anchor; if (!an) continue;
    const dims = an.kind === 'foot' ? [0.3, 0.16] : an.kind === 'body' ? PAD[name] : null; if (!dims) continue; // foot plates: sole contacts
    const [w, l] = dims, t = an.kind === 'foot' ? 0.12 : 0.05; // thick foot proxy so a deep sole reads its true depth (box depth caps at t/2)
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, t, l), HIDE); m.position.set(0, -t / 2 - 0.004, 0); m.userData.qaId = `${id}.${name}`;
    a.add(m);
  }
}
const gripAnchor = P => P.anchors.grip || P.anchors.gripL || P.anchors.handle || Object.values(P.anchors).find(a => a.userData.anchor && a.userData.anchor.kind === 'grip');
for (const id of GK.IDS()) {
  if (KIT[id]) continue;
  KIT[id] = (e) => {
    const qid = e.id || id;
    if (PER_HAND.has(id)) {
      const make = () => { const P = build(e); const a = gripAnchor(P); const g = new THREE.Group(); g.add(P.object);
        if (a) { P.object.updateMatrixWorld(true); const inv = a.matrixWorld.clone().invert(); P.object.applyMatrix4(inv); }
        return g; };
      const sides = e.sides || 'LR', G = new THREE.Group(), H = {};
      for (const s of sides) { H[s] = make(); G.add(H[s]); }
      const m = new THREE.Matrix4(), x = V3(), y = V3(), z = V3();
      return { group: G, update(out) { const HG = held(out); for (const s of sides) { const gr = HG[s]; if (!gr) { H[s].visible = false; continue; } H[s].visible = true;
        // recipe grip.bell (kettlebell): 'down' = bell hangs under the handle (gravity), 'fingers' = along the fingers (swing),
        // 'back' = resting on the back of the forearm (racked / pressing); default: toward the palm (horns held from below)
        const rb = globalThis.__demo && globalThis.__demo.poser && globalThis.__demo.poser.grips && globalThis.__demo.poser.grips[s], bm = rb && rb.bell;
        const yd = bm === 'down' ? V3(0, -1, 0) : bm === 'fingers' && gr.fingers ? gr.fingers : bm === 'back' && gr.fingers ? gr.palm.clone().negate().addScaledVector(gr.fingers, -0.6) : gr.palm;
        x.copy(gr.axis).normalize(); y.copy(yd).addScaledVector(x, -yd.dot(x));
        if (y.lengthSq() < 1e-4) y.copy(gr.palm).addScaledVector(x, -gr.palm.dot(x)); y.normalize(); z.crossVectors(x, y);
        m.makeBasis(x, y, z); H[s].quaternion.setFromRotationMatrix(m); H[s].position.copy(gr.center || gr.p); } } };
    }
    if (TWO_HAND.has(id)) {
      const P = build(e), g = new THREE.Group(); g.add(P.object); const c = P.anchors.centre; if (c) { P.object.updateMatrixWorld(true); P.object.position.sub(c.getWorldPosition(V3())); }
      const q = new THREE.Quaternion();
      return { group: g, update(out) { const L = out.grips.L, R = out.grips.R; if (!L || !R) return; const a = L.center || L.p, b = R.center || R.p;
        g.position.copy(out.bar || a.clone().add(b).multiplyScalar(0.5)); q.setFromUnitVectors(V3(1, 0, 0), a.clone().sub(b).normalize()); g.quaternion.copy(q); } };
    }
    const P = build(e), g = new THREE.Group(); g.add(P.object); proxies(P, qid, g);
    if (e.at) g.position.fromArray(e.at); if (e.rotY) g.rotation.y = e.rotY * Math.PI / 180;
    // e.follow = {from, to, by?}: motion = projection onto from->to of the hands' grip midpoint, or of the midpoint of the
    // bones named in by (world joint positions out.P, e.g. ['foot.L','foot.R']); e.belt = belt speed m/s (slats move 1.75 m per unit);
    // e.motionKeys = {poseName: motion} (+ e.cyclic) follows out.seg. Priority belt > motionKeys > follow
    const DN = e.dof || 'motion';   // audit: e.dof drives another dof (single-leg-press motionL/motionR)
    const hasMotion = P.dofs.some(d => d.name === DN);
    const f = e.follow && hasMotion ? { a: V3(...e.follow.from), b: V3(...e.follow.to), by: e.follow.by } : null;
    const belt = hasMotion && e.belt ? +e.belt : 0;
    const mk = hasMotion && e.motionKeys ? e.motionKeys : null, cyc = !!e.cyclic;
    return { group: g, piece: P, update(out) {
      if (belt && out.t != null) { const v = (out.t * belt) / 1.75; P.set(DN, v - Math.floor(v)); return; }
      if (mk && out.seg) { // keyed motion: same pose blend as the body (out.seg = {from, to, via, k})
        const { from, to, via, k } = out.seg, A = mk[from], B = mk[to], M = via != null ? mk[via] : undefined;
        if (A === undefined || B === undefined || (via != null && M === undefined)) return;
        let a0 = A, m0 = M, b0 = B;
        if (cyc) { if (m0 !== undefined && m0 < a0) m0 += 1; if (b0 < (m0 ?? a0)) b0 += 1; }
        const lp = (x, y, t) => x + (y - x) * t;
        let v = m0 !== undefined ? lp(lp(a0, m0, k), lp(m0, b0, k), k) : lp(a0, b0, k);
        if (cyc) v -= Math.floor(v); else { const D = P.dofs.find(d => d.name === DN); v = Math.max(Math.min(0, D.min), Math.min(Math.max(1, D.max), v)); }   // audit: a dof may run below 0 (pec-deck rear-delt fly)
        P.set(DN, v); return;
      }
      if (!f) return; let m = null;
      if (f.by && f.by.length) { const pts = f.by.map(n => out.P && out.P[n]).filter(Boolean); if (!pts.length) return;
        m = V3(); for (const q of pts) m.add(q); m.multiplyScalar(1 / pts.length); }
      else { const G = held(out), L = G.L || out.grips.L, R = G.R || L; if (!L) return; m = (L.center || L.p).clone().add(R.center || R.p).multiplyScalar(0.5); }
      const ab = f.b.clone().sub(f.a);
      P.set(DN, Math.max(0, Math.min(1, m.sub(f.a).dot(ab) / ab.lengthSq()))); } };
  };
}
export { KIT };

// cable pieces: the recipes thread's cable-tower draws rope / bar / vbar attachments that follow the hands;
// D-handles (and the crossover's handles) are drawn here, one per gripping hand.
function dHandles(e) {
  return KIT['d-handle']({ ...e, kit: 'd-handle', id: (e.id || 'cable') + '.handle', sides: e.sides || 'LR' });
}
function hideWire(group, on) { group.traverse(o => { if (o.isMesh && /wire$/.test(o.userData.qaId || '')) o.visible = on; }); }
const towerOrig = KIT['cable-tower'];
// a tower whose wire and stack follow one hand (side), the only gripping hand, or both hands' midpoint.
// Its lowest cable length is also learned while playing (the page's calibration pass covers it too).
// D-handle: the wire clips to the top of the D, ~9 cm from the bar in the fist, toward the pulley (not through the fingers)
function apexGrip(gr, pulley) {
  const c = gr.center || gr.p, ax = gr.axis.clone().normalize(), d = pulley.clone().sub(c); d.addScaledVector(ax, -d.dot(ax));
  if (d.lengthSq() < 1e-6) return gr; return { ...gr, p: c.clone().addScaledVector(d.normalize(), 0.09), center: undefined };
}
function oneTower(e, side) {
  const t = towerOrig(e), dh = (e.attach || 'rope') === 'none';
  return { t, update(out) {
    const G = held(out); let L = G.L, R = G.R;
    if (side) { const gs = G[side]; hideWire(t.group, !!gs); if (!gs) return; L = R = gs; }
    else if (!(L && R)) { const gs = L || R; if (!gs) return; L = R = gs; }
    if (dh && t.pulley) { const same = L === R; L = apexGrip(L, t.pulley); R = same ? L : apexGrip(R, t.pulley); }
    t.update({ ...out, grips: { L, R } });
    const d = t.calib; if (d && d.last != null) d.Lmin = Math.min(d.Lmin ?? Infinity, d.last);
  }, get calib() { return t.calib; } };
}
// ankle strap: the wire runs from the low pulley to a cuff on the working ankle (the foot that travels further over the loop)
function ankleTower(e) {
  const t = towerOrig({ ...e, attach: 'none' }), g = new THREE.Group(); g.add(t.group);
  const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.016, 12, 32), new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 }));
  cuff.rotation.x = Math.PI / 2; g.add(cuff); // cuff wraps the ankle: not a collision target
  const box = { L: new THREE.Box3(), R: new THREE.Box3() };
  return { group: g, get calib() { return t.calib; }, update(out) {
    const so = out.soles || {}; if (!so.L || !so.R) return;
    box.L.expandByPoint(so.L); box.R.expandByPoint(so.R);
    const sz = b => b.getSize(V3()).length(), s = e.strapSide || (sz(box.L) >= sz(box.R) ? 'L' : 'R');
    // audit: the cuff sits on the ankle joint, ring square to the shin (also right when lying face down)
    const P = out.P || {}, ft = P['foot.' + s], kn = P['lowerleg01.' + s];
    const a = ft ? ft.clone() : so[s].clone().add(V3(0, 0.07, 0)); cuff.position.copy(a);
    if (ft && kn) cuff.quaternion.setFromUnitVectors(V3(0, 0, 1), ft.clone().sub(kn).normalize());
    const pl = t.pulley || a, d = pl.clone().sub(a); d.y = 0; const hk = d.lengthSq() > 1e-6 ? a.clone().addScaledVector(d.normalize(), 0.075) : a; // clip ring on the cuff's outside
    t.update({ ...out, grips: { L: { p: hk, axis: V3(1, 0, 0) }, R: { p: hk, axis: V3(1, 0, 0) } } });
  } };
}
// audit (Aziz Nov 2: Smith lifts must use the Smith bar itself, no second barbell): the carriage carries the recipe's plates
// (e.plates kg list) and rides to the bar height every frame; the frame stands so its bar line passes through the bar
// (e.at if given, else the bar position at the first update)
KIT['smith-machine'] = (e) => {
  const P = GK.build('smith-machine', { plates: e.plates || [] }), g = new THREE.Group(); g.add(P.object);
  P.object.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; }); proxies(P, e.id || 'smith', g);
  let placed = false; if (e.at) { g.position.fromArray(e.at); placed = true; }
  return { group: g, update(out) { const b = out.bar; if (!b) return;
    if (!placed) { g.position.set(0, 0, b.z - 0.1); placed = true; }
    P.set('motion', Math.min(1, Math.max(0, (b.y - 0.3) / 1.6))); } };
};
KIT['cable-tower'] = (e) => {
  if (e.attach === 'ankle-strap') return ankleTower(e);
  const dh = e.attach === 'd-handle', single = (e.sides || '').length === 1 ? e.sides : null;
  const T = oneTower({ ...e, attach: dh ? 'none' : e.attach }, single), g = new THREE.Group(); g.add(T.t.group);
  const h = dh ? dHandles(e) : null; if (h) g.add(h.group);
  return { group: g, pulley: T.t.pulley, get calib() { return T.calib; }, update(out) { T.update(out); h && h.update(out); } };
};
// crossover: two towers, one per hand, each with its own wire and moving stack, pulleys where the kit's crossover has them
KIT['cable-crossover'] = (e) => {
  const at = V3(...(e.at || [0, 0, 0])), ph = e.pulleyHeight ?? e.pulleyY ?? 2.0, py = Math.max(0.1, ph - 0.32);
  const g = new THREE.Group(), T = {};
  for (const [s, x] of [['L', 1], ['R', -1]]) {
    T[s] = oneTower({ ...e, attach: 'none', pulleyY: Math.min(2.1, py + 0.18), pulleyPt: V3(at.x + x * 1.07, py, at.z + 0.12) }, s);
    g.add(T[s].t.group);
  }
  const h = dHandles(e); g.add(h.group);
  return { group: g, towers: T, calib: { last: 0, Lmin: 0 }, update(out) { T.L.update(out); T.R.update(out); h.update(out); } };
};
// seated row / pulldown stations with other handles or one hand: keep the station (seat, column, moving stack),
// swap its default V-handle / lat bar for the recipe's attachment on a wire from the station's own pulley
function swapAttach(origName, kind) {
  const orig = KIT[origName];
  KIT[origName] = (e) => {
    const S = orig(e), att = e.attach, drv = S.calib, pp = drv && drv.pulleyPt(); if (!pp) return S;
    const own = [];
    S.group.traverse(o => { if (o.isMesh && /(wire|\.bar|vbar)$/.test(o.userData.qaId || '')) own.push(o);
      if (o.isGroup && o !== S.group && o.children.some(c => c.userData.qaId === 'pulldown.bar')) own.push(o); });
    const bar = att === 'straight-bar' || att === 'lat-bar', dh = !att || att === 'd-handle';
    const t = towerOrig({ at: [pp.x, 0, pp.z], pulleyY: pp.y, pulleyPt: pp, driver: drv, noColumn: true,
      attach: bar ? 'bar' : dh ? 'none' : att, barLen: att === 'lat-bar' ? 1.0 : 0.5 });
    const h = dh ? dHandles({ ...e, sides: e.sides || 'LR' }) : null;
    const ours = new THREE.Group(); ours.add(t.group); if (h) ours.add(h.group); S.group.add(ours);
    let mode = null;
    return { group: S.group, calib: drv, update(out) {
      const G = held(out), both = !!(G.L && G.R), m = both && (!att || att === kind) ? 'orig' : 'swap';
      if (m !== mode) { mode = m; own.forEach(o => o.visible = m === 'orig'); ours.visible = m === 'swap'; }
      if (m === 'orig') return S.update(out);
      const gs = G.L || G.R; if (!gs) return;
      let L = both ? G.L : gs, R = both ? G.R : gs; if (dh) { L = apexGrip(L, pp); R = both ? apexGrip(R, pp) : L; }
      t.update({ ...out, grips: { L, R } }); h && h.update(out);
    } };
  };
}
swapAttach('row-station', 'vbar'); swapAttach('pulldown-station', 'lat-bar');
KIT['seated-row-station'] = e => KIT['row-station'](e);
KIT['lat-pulldown-station'] = e => KIT['pulldown-station'](e);

// ---- hand-held soft gear drawn live from the grips (band tubes, jump rope, battle ropes) ----
function liveTube(parent, color, r, qaId) {
  const m = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ color, roughness: 0.7 })); m.castShadow = true; m.frustumCulled = false; void qaId; parent.add(m); // soft tube: no qaId, the checker reads non-primitive meshes as their bounding box
  return pts => { m.geometry.dispose(); m.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Math.max(8, pts.length * 2), r, 8, false); };
}
function handleMesh(parent, len, r, color, qaId) { // a handle along local X (aligned to the grip axis at update)
  const geo = new THREE.CylinderGeometry(r, r, len, 20); geo.rotateZ(Math.PI / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.6 })); m.castShadow = true; m.userData.qaId = qaId; parent.add(m); return m;
}
function placeHandle(h, gr) { const c = gr.center || gr.p; h.position.copy(c); h.quaternion.setFromUnitVectors(V3(1, 0, 0), gr.axis.clone().normalize()); h.visible = true; }
const handEnd = (gr, len, toward) => { const c = gr.center || gr.p, a = gr.axis.clone().normalize(); if (toward && a.dot(toward.clone().sub(c)) < 0) a.negate(); return c.clone().addScaledVector(a, len / 2); };
// band tube: anchor = e.anchor ('feet' default: under the soles' midpoint, or a world point [x,y,z]); tube stretches live to each gripping hand
KIT['band-tube'] = (e) => {
  const g = new THREE.Group(), H = {}, T = {};
  for (const s of 'LR') { H[s] = handleMesh(g, 0.13, 0.016, 0x1a1a1a, 'band-tube.' + s); H[s].visible = false; T[s] = liveTube(g, e.color ?? 0x2e7d32, 0.0065, 'band-tube.band'); }
  const tubes = g.children.filter(c => !(c.geometry instanceof THREE.CylinderGeometry));
  return { group: g, update(out) {
    const G = held(out); let A0 = null; const so = out.soles || {};
    if (Array.isArray(e.anchor)) A0 = V3(...e.anchor);
    else if (!so.L || !so.R) return;
    for (const s of 'LR') { const gr = G[s], tb = tubes['LR'.indexOf(s)];
      // audit: under the feet, each end runs from under its own foot (a band from the feet' midpoint cut through the body)
      const A = A0 ? A0 : (G.L && G.R ? so[s].clone() : so.L.clone().add(so.R).multiplyScalar(0.5)); if (!A0) A.y = 0.02;
      if (!gr) { H[s].visible = false; tb.visible = false; continue; }
      placeHandle(H[s], gr); tb.visible = true;
      const end = handEnd(gr, 0.13, A), mid = end.clone().lerp(A, 0.5);
      T[s]([end, end.clone().lerp(A, 0.15), mid, A.clone().lerp(end, 0.08), A]);
    } } };
};
// jump rope: a handle in each grip; the rope loop turns round the body once per loop period (e.turns per period, e.ropePhase in turns,
// 0 = rope under the feet at t=0). The loop bulges from the hands to just under the soles.
KIT['jump-rope'] = (e) => {
  const g = new THREE.Group(), H = { L: handleMesh(g, 0.16, 0.014, 0x202020, 'jump-rope.L'), R: handleMesh(g, 0.16, 0.014, 0x202020, 'jump-rope.R') }, rope = liveTube(g, 0x303030, 0.0035, 'jump-rope.rope');
  return { group: g, update(out) {
    const G = held(out); if (!G.L || !G.R) return; placeHandle(H.L, G.L); placeHandle(H.R, G.R);
    const per = out.period || (globalThis.__demo && globalThis.__demo.period) || 1, t = out.t ?? 0;
    const th = 2 * Math.PI * ((t / per) * (e.turns || 1) + (e.ropePhase || 0));
    const a = G.L.center || G.L.p, b = G.R.center || G.R.p, ea = a.clone().add(V3(0, -0.08, 0)), eb = b.clone().add(V3(0, -0.08, 0));
    const so = out.soles || {}, floorY = so.L && so.R ? Math.min(so.L.y, so.R.y) - 0.06 : 0.01;
    const mid = ea.clone().add(eb).multiplyScalar(0.5), r = Math.max(0.3, mid.y - floorY);
    const across = eb.clone().sub(ea); across.y = 0; const fwd = V3(0, 1, 0).cross(across.normalize()).normalize(); // body forward (+-)
    const dir = V3(0, -Math.cos(th), 0).addScaledVector(fwd, Math.sin(th));
    const pts = []; for (let i = 0; i <= 16; i++) { const u = i / 16, w = Math.sin(Math.PI * u); pts.push(ea.clone().lerp(eb, u).addScaledVector(dir, r * Math.pow(w, 0.6))); }
    rope(pts);
  } };
};
// default battle-rope anchor: 4 m ahead of the body (root -> hands, flattened), ropes 0.5 m apart
const fwdAnchor = (out, G, s) => {
  const r = out.P && out.P.root, L = G.L || G.R, R = G.R || G.L, m = (L.center || L.p).clone().add(R.center || R.p).multiplyScalar(0.5);
  const f = r ? m.clone().sub(r) : V3(0, 0, 1); f.y = 0; if (f.lengthSq() < 1e-4) f.set(0, 0, 1); f.normalize();
  const side = V3(0, 1, 0).cross(f), base = (r ? V3(r.x, 0.03, r.z) : V3(0, 0.03, 0)).addScaledVector(f, 4.0);
  return base.addScaledVector(side, s === 'L' ? 0.25 : -0.25);
};
// battle ropes: each handle end in its grip; the rope runs forward to a floor anchor (e.anchor, default 4 m ahead) and lies on the floor;
// waves travel from the hand down the rope, sized by how far the hand moves
KIT['battle-ropes'] = (e) => {
  const g = new THREE.Group(), H = { L: handleMesh(g, 0.2, 0.019, 0x111111, 'battle-ropes.L'), R: handleMesh(g, 0.2, 0.019, 0x111111, 'battle-ropes.R') }, R = { L: liveTube(g, 0x2b2f3a, 0.019, 'battle-ropes.rope'), R: liveTube(g, 0x2b2f3a, 0.019, 'battle-ropes.rope') };
  const ext = { L: [Infinity, -Infinity], R: [Infinity, -Infinity] };
  return { group: g, update(out) {
    const G = held(out), per = out.period || 1, t = out.t ?? 0;
    for (const s of 'LR') { const gr = G[s]; if (!gr) continue; placeHandle(H[s], gr);
      const c = gr.center || gr.p; ext[s][0] = Math.min(ext[s][0], c.y); ext[s][1] = Math.max(ext[s][1], c.y);
      const amp = Math.min(0.25, Math.max(0.03, (ext[s][1] - ext[s][0]) * 0.8));
      const anc = Array.isArray(e.anchor) ? V3(...e.anchor) : fwdAnchor(out, G, s), start = handEnd(gr, 0.2, anc);
      const pts = []; for (let i = 0; i <= 30; i++) { const u = i / 30, p = start.clone().lerp(anc, u);
        const base = start.y * Math.pow(1 - Math.min(1, u / 0.35), 2) + 0.025 * Math.min(1, u / 0.35); // drops to the floor in the first third
        const wave = amp * Math.pow(1 - u, 1.2) * Math.sin(2 * Math.PI * (t / per * (e.waves || 2) - u * 4)) * Math.min(1, u * 8);
        p.y = Math.max(0.02, base + wave); pts.push(p); }
      R[s](pts);
    } } };
};
// audit (Aziz Nov 2, lying leg curls off the machine): load carried by the feet.
// e.mode 'band': a cuff round each ankle, the band runs from the cuffs' midpoint to e.anchor (a world point on a post/upright).
// e.mode 'dumbbell': one dumbbell squeezed between the feet, handle along the shins, top head resting on the soles.
KIT['feet-load'] = (e) => {
  const g = new THREE.Group(), mode = e.mode || 'band';
  const cuffs = {}, mat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 });
  let band = null, db = null;
  const knees = e.on === 'knees';   // band-assisted pull-up: the loop sits under the knees
  if (mode === 'band') { const bm = new THREE.MeshStandardMaterial({ color: e.color ?? 0x2e7d32, roughness: 0.7 });
    for (const s of 'LR') { cuffs[s] = new THREE.Mesh(new THREE.TorusGeometry(knees ? 0.068 : 0.05, knees ? 0.01 : 0.014, 12, 40), knees ? bm : mat); g.add(cuffs[s]); } band = liveTube(g, e.color ?? 0x2e7d32, 0.009, 'feet-load.band'); }
  else { const P = GK.build('dumbbell', { kg: e.kg ?? 15 }); P.object.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; }); db = P.object; g.add(db); }
  return { group: g, update(out) {
    const P = out.P; if (!P || !P['foot.L'] || !P['foot.R']) return;
    const kL = P['lowerleg01.L'], kR = P['lowerleg01.R'];
    const sh = P['foot.L'].clone().sub(kL).add(P['foot.R'].clone().sub(kR)).normalize();   // knee -> ankle
    if (mode === 'band') {
      const mid = V3();
      for (const s of 'LR') { const a = knees ? P['lowerleg01.' + s].clone().lerp(P['foot.' + s], 0.12) : P['foot.' + s].clone().addScaledVector(sh, -0.04); cuffs[s].position.copy(a); cuffs[s].quaternion.setFromUnitVectors(V3(0, 0, 1), sh); mid.add(a); }
      mid.multiplyScalar(0.5); const A = V3(...e.anchor);
      band([mid, mid.clone().lerp(A, 0.3), mid.clone().lerp(A, 0.7), A]);
    } else {
      const mid = P['foot.L'].clone().add(P['foot.R']).multiplyScalar(0.5).addScaledVector(sh, 0.06);
      db.position.copy(mid); db.quaternion.setFromUnitVectors(V3(1, 0, 0), sh);
    }
  } };
};
// audit (reviewer run3 #108/#121): dip belt for weighted pull-ups / chin-ups / dips: padded belt round the hips, a chain
// from each side down to a plate hanging between the thighs (gravity: always straight down from the belt front).
KIT['dip-belt'] = (e) => {
  const g = new THREE.Group(), belt = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.026, 16, 96), new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.75 }));
  belt.scale.set(1.05, 0.8, 1); g.add(belt); belt.castShadow = true; const bm = new THREE.Matrix4();
  const PL = GK.build('plate', { kg: e.kg ?? 20 }); PL.object.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; }); g.add(PL.object);
  const chain = liveTube(g, 0xb0b0b0, 0.009, 'dip-belt.chain');
  return { group: g, update(out) {
    const P = out.P; if (!P || !P['upperleg01.L'] || !P['spine01']) return;
    const hip = P['upperleg01.L'].clone().add(P['upperleg01.R']).multiplyScalar(0.5), up = P['spine01'].clone().sub(hip).normalize();
    const c = hip.clone().addScaledVector(up, 0.06); belt.position.copy(c);
    const right = P['upperleg01.L'].clone().sub(P['upperleg01.R']).normalize(), fwd = V3().crossVectors(right, up).normalize();
    bm.makeBasis(right, fwd, up); belt.quaternion.setFromRotationMatrix(bm);
    // audit (QA run3): the plate hangs in front of the knees so the chain runs clear of the hips and thighs
    const fh = V3(fwd.x, 0, fwd.z).normalize(), kn = P['lowerleg01.L'] && P['lowerleg01.R'] ? P['lowerleg01.L'].clone().add(P['lowerleg01.R']).multiplyScalar(0.5) : c;
    const d = Math.max(0.24, kn.clone().sub(c).dot(fh) + 0.2), hook = c.clone().addScaledVector(fwd, 0.19);
    const top = c.clone().addScaledVector(fh, d).add(V3(0, -0.3, 0)), plate = top.clone().add(V3(0, -0.12, 0));
    PL.object.position.copy(plate); PL.object.quaternion.setFromUnitVectors(V3(0, 0, 1), fh);
    chain([c.clone().addScaledVector(right, 0.12).addScaledVector(fwd, 0.13), hook, top]);
  } };
};
// audit (Aziz Nov 2 19:16): T-bar row V-handle - hooked under the landmine bar, the two neutral grips hang 0.12 m below the hook, centred on the hands
KIT['tbar-vhandle'] = (e) => {
  // anchors come from the kit's v-handle (gripL/gripR at x +-0.075, y -0.275); the drawn handle is the T-bar style: a hook over the bar,
  // two chrome arms, and two rubber grips running along the bar (palms face each other, forearms hang straight down)
  const P = GK.build('v-handle'), g = new THREE.Group(); g.add(P.object); P.object.traverse(o => { if (o.isMesh) o.visible = false; });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xc8c8c8, metalness: 0.9, roughness: 0.25 }), rub = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.85 });
  const add = (geo, mat, f) => { const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = true; f && f(m); g.add(m); return m; };
  add(new THREE.TorusGeometry(0.032, 0.008, 16, 48, Math.PI), chrome, null);   // hook arc over the top of the bar
  const rod = (a, b, r, mat) => { const A = V3(...a), B = V3(...b), d = B.clone().sub(A), L = d.length();
    add(new THREE.CylinderGeometry(r, r, L, 20), mat, m => { m.position.copy(A).add(B).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(V3(0, 1, 0), d.normalize()); }); };
  const D = e.drop ?? 0.12;
  for (const s of [-1, 1]) {
    rod([s * 0.032, 0, 0], [s * 0.075, -D + 0.018, 0], 0.011, chrome);
    for (const z of [-0.07, 0.07]) rod([s * 0.075, -D + 0.018, 0], [s * 0.075, -D, z], 0.008, chrome);
    rod([s * 0.075, -D, -0.07], [s * 0.075, -D, 0.07], 0.016, rub);
  }
  P.object.position.y = 0.275 - D;
  return { group: g, piece: P, update(out) { const L = out.grips && out.grips.L, R = out.grips && out.grips.R; if (!L || !R) return;
    const m = (L.center || L.p).clone().add(R.center || R.p).multiplyScalar(0.5); g.position.copy(m).add(V3(0, D, 0)); } };
};
// audit (reviewer run3 #555/#565): a medicine ball held between both palms, centred on the recipe's bar point (out.bar)
KIT['ball-held'] = (e) => {
  const P = GK.build('medicine-ball'), g = new THREE.Group(); g.add(P.object); P.object.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  return { group: g, update(out) { if (out.bar) g.position.copy(out.bar); } };
};
// audit (run3 #555): a plain wall section with a round wall-ball target (centre e.target m high), facing the lifter (-Z)
KIT['wall-target'] = (e) => {
  const g = new THREE.Group(), W = e.w ?? 2.4, H = e.h ?? 3.6, T = 0.2;
  const wall = new THREE.Mesh(new THREE.BoxGeometry(W, H, T, 24, 36, 2), new THREE.MeshStandardMaterial({ color: 0xd9d4cc, roughness: 0.95 }));
  wall.position.set(0, H / 2, T / 2); wall.receiveShadow = true; g.add(wall);
  const ring = (r0, r1, c, z) => { const m = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 96, 2), new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, side: THREE.DoubleSide })); m.position.set(0, e.target ?? 3.0, -0.002 - z); g.add(m); };
  if (!e.noTarget) { ring(0.0, 0.28, 0x1d1d1d, 0); ring(0.28, 0.33, 0xd9392c, 0.001); }
  if (e.at) g.position.fromArray(e.at); if (e.rotY) g.rotation.y = e.rotY * Math.PI / 180; return { group: g, update() {} };
};
// audit (reviewer run3 MED: bands drawn only as a ring on the floor): a live latex loop on the body.
// e.on 'knees' (round both thighs just above the knees), 'ankles', 'neck-feet' (under both feet, up over the back of the neck),
// 'hands-anchor' (doubled band from a low post behind to the hands), 'ankle-anchor' (round the front ankle, pulled back to a post),
// 'feet-anchor' (round both forefeet, pulled forward to a post). Posts are fixed where the body starts.
function closedTube(parent, color, r, qaId) {
  const m = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ color, roughness: 0.7 })); m.castShadow = true; m.frustumCulled = false; void qaId; parent.add(m); // soft tube: no qaId, the checker reads non-primitive meshes as their bounding box
  return pts => { m.geometry.dispose(); m.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), Math.max(24, pts.length * 3), r, 8, true); };
}
function loopRound(A, B, rA, rB, n) { // hull of two circles (limb sections) in the plane normal to n
  const u = B.clone().sub(A); u.addScaledVector(n, -u.dot(n)); if (u.lengthSq() < 1e-6) u.set(1, 0, 0); u.normalize();
  const v = V3().crossVectors(n, u).normalize(), pts = [];
  for (let k = 0; k <= 8; k++) { const th = Math.PI / 2 + Math.PI * k / 8; pts.push(A.clone().addScaledVector(u, rA * Math.cos(th)).addScaledVector(v, rA * Math.sin(th))); }
  for (let k = 0; k <= 8; k++) { const th = -Math.PI / 2 + Math.PI * k / 8; pts.push(B.clone().addScaledVector(u, rB * Math.cos(th)).addScaledVector(v, rB * Math.sin(th))); }
  return pts;
}
KIT['band-on'] = (e) => {
  const g = new THREE.Group(), col = e.color ?? 0xc0392b, loop = closedTube(g, col, 0.008, 'band-on.band'), on = e.on || 'knees';
  let post = null, anchor = null;
  const mkPost = (p, h) => { post = new THREE.Group(); post.position.set(p.x, 0, p.z); g.add(post); const M = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.5, metalness: 0.4 });
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.07, h, 0.07), M); c.position.y = h / 2; post.add(c); const b = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.03, 0.45), M); b.position.y = 0.015; post.add(b);
    const hk = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.008, 8, 20), new THREE.MeshStandardMaterial({ color: 0xbbbbbb, metalness: 0.8, roughness: 0.3 })); hk.position.y = p.y; post.add(hk);
    post.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; }); };
  return { group: g, update(out) {
    const P = out.P; if (!P || !P['foot.L'] || !P['upperleg01.L']) return;
    const hip = P['upperleg01.L'].clone().add(P['upperleg01.R']).multiplyScalar(0.5), up = P['spine01'].clone().sub(hip).normalize();
    const right = P['upperleg01.L'].clone().sub(P['upperleg01.R']).normalize(), fwd = V3().crossVectors(right, up).normalize();
    const flat = V3(fwd.x, 0, fwd.z); if (flat.lengthSq() < 1e-4) flat.set(0, 0, 1); flat.normalize();
    const so = out.soles || {}, sole = s => (so[s] ? so[s].clone() : P['foot.' + s].clone()).setY(Math.max(0.012, (so[s] ? so[s].y : P['foot.' + s].y) - 0.05));
    if (on === 'knees' || on === 'ankles') {
      const pt = s => on === 'knees' ? P['lowerleg01.' + s].clone().lerp(P['upperleg01.' + s], 0.1) : P['foot.' + s].clone().lerp(P['lowerleg01.' + s], 0.12);
      const n = P['upperleg01.L'].clone().sub(P['lowerleg01.L']).add(P['upperleg01.R'].clone().sub(P['lowerleg01.R'])).normalize();
      loop(loopRound(pt('R'), pt('L'), on === 'knees' ? 0.088 : 0.056, on === 'knees' ? 0.088 : 0.056, n)); return;   // audit: radius clears the muscular thigh / ankle
    }
    if (on === 'neck-feet') {
      const back = fwd.clone().negate(), nk = P['neck01'].clone().addScaledVector(back, 0.06);
      const shL = P['shoulder01.L'].clone().addScaledVector(back, 0.05).add(V3(0, 0.05, 0)), shR = P['shoulder01.R'].clone().addScaledVector(back, 0.05).add(V3(0, 0.05, 0));
      const fL = sole('L'), fR = sole('R');
      loop([fR, fR.clone().lerp(shR, 0.5).addScaledVector(back, 0.05), shR, nk.clone().addScaledVector(right, -0.05), nk.clone().addScaledVector(right, 0.05), shL, fL.clone().lerp(shL, 0.5).addScaledVector(back, 0.05), fL, fL.clone().lerp(fR, 0.5).add(V3(0, -0.006, 0))]); return;
    }
    if (!anchor) { // fix the post where the body starts
      if (on === 'hands-anchor') anchor = V3(hip.x, 0.35, hip.z).addScaledVector(flat, -1.15);
      else if (on === 'ankle-anchor') { const s = e.side || 'L'; anchor = V3(P['foot.' + s].x, 0.12, P['foot.' + s].z).addScaledVector(flat, -0.9); }
      else anchor = V3((P['foot.L'].x + P['foot.R'].x) / 2, 0.15, (P['foot.L'].z + P['foot.R'].z) / 2).addScaledVector(flat, 0.85);
      if (Array.isArray(e.anchor)) anchor = V3(...e.anchor);
      mkPost(anchor, Math.max(0.5, anchor.y + 0.15)); post.rotation.y = Math.atan2(flat.x, flat.z);
    }
    const A = anchor, d = 0.025;
    if (on === 'hands-anchor') {
      const G = held(out), L = G.L ? (G.L.center || G.L.p) : P['wrist.L'], R = G.R ? (G.R.center || G.R.p) : P['wrist.R'];
      const m = L.clone().add(R).multiplyScalar(0.5);
      loop([A.clone().add(V3(0, d, 0)), L.clone().add(V3(0, 0.02, 0)), m.clone().add(V3(0, -0.035, 0)), R.clone().add(V3(0, 0.02, 0)), A.clone().add(V3(0, -d, 0))]); return;
    }
    if (on === 'ankle-anchor') {
      const s = e.side || 'L', a = P['foot.' + s].clone().lerp(P['lowerleg01.' + s], 0.1), n = P['lowerleg01.' + s].clone().sub(P['foot.' + s]).normalize();
      const u = A.clone().sub(a); u.addScaledVector(n, -u.dot(n)); u.normalize(); const v = V3().crossVectors(n, u).normalize(), far = [];
      for (let k = 0; k <= 8; k++) { const th = Math.PI / 2 + Math.PI * k / 8; far.push(a.clone().addScaledVector(u, 0.05 * Math.cos(th)).addScaledVector(v, 0.05 * Math.sin(th))); }
      loop([...far, A.clone().addScaledVector(v, -d), A.clone().addScaledVector(v, d)]); return;
    }
    // feet-anchor: round both forefeet
    const tL = P['toe1-1.L'] ? P['foot.L'].clone().lerp(P['toe1-1.L'], 0.6) : P['foot.L'], tR = P['toe1-1.R'] ? P['foot.R'].clone().lerp(P['toe1-1.R'], 0.6) : P['foot.R'];
    const m = tL.clone().add(tR).multiplyScalar(0.5), back = m.clone().sub(A).normalize(), wid = tL.clone().sub(tR).normalize();
    loop([A.clone().add(V3(0, d, 0)), tL.clone().addScaledVector(wid, 0.05).add(V3(0, 0.03, 0)), tL.clone().addScaledVector(back, 0.03).add(V3(0, 0.035, 0)), tR.clone().addScaledVector(back, 0.03).add(V3(0, 0.035, 0)), tR.clone().addScaledVector(wid, -0.05).add(V3(0, 0.03, 0)), A.clone().add(V3(0, -d, 0))]);
  } };
};
// audit (reviewer run3 #598-604): swims happen in a pool - translucent water from the floor up to e.level (default 0.96 m), lane ropes either side
KIT['pool-water'] = (e) => {
  const g = new THREE.Group(), lv = e.level ?? 0.96, S = 7;
  const water = new THREE.Mesh(new THREE.BoxGeometry(S, lv, S, 1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x2f8fc4, transparent: true, opacity: 0.32, roughness: 0.15, metalness: 0.0, depthWrite: false }));
  water.position.y = lv / 2; water.renderOrder = 2; g.add(water);
  const surf = new THREE.Mesh(new THREE.PlaneGeometry(S, S, 48, 48), new THREE.MeshStandardMaterial({ color: 0x8fd3f4, transparent: true, opacity: 0.35, roughness: 0.05, side: THREE.DoubleSide, depthWrite: false }));
  surf.rotation.x = -Math.PI / 2; surf.position.y = lv; surf.renderOrder = 3; g.add(surf);
  const tile = new THREE.Mesh(new THREE.PlaneGeometry(S, S), new THREE.MeshStandardMaterial({ color: 0x9fd0e6, roughness: 0.6 })); tile.rotation.x = -Math.PI / 2; tile.position.y = 0.003; tile.receiveShadow = true; g.add(tile);
  const ln = new THREE.Mesh(new THREE.PlaneGeometry(0.22, S), new THREE.MeshStandardMaterial({ color: 0x1d3f6e, roughness: 0.6 })); ln.rotation.x = -Math.PI / 2; ln.position.y = 0.005; g.add(ln);
  for (const x of [-1.25, 1.25]) for (let i = 0; i < 46; i++) { const f = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 12), new THREE.MeshStandardMaterial({ color: i % 2 ? 0xd9392c : 0xf4f4f4, roughness: 0.5 })); f.rotation.x = Math.PI / 2; f.position.set(x, lv, -S / 2 + 0.08 + i * 0.15); g.add(f); }
  const pos = surf.geometry.attributes.position, base = Float32Array.from(pos.array);
  return { group: g, update(out) { const t = out.t ?? 0; for (let i = 0; i < pos.count; i++) { const x = base[3 * i], y = base[3 * i + 1]; pos.setZ(i, 0.012 * Math.sin(2.3 * x + 3.1 * t) * Math.cos(1.7 * y - 2.2 * t)); } pos.needsUpdate = true; } };
};
// audit (reviewer: TRX handles hung beside the empty hands): suspension trainer drawn live - anchored overhead in front (e.anchor),
// one strap down to a buckle, then a strap to each handle, and each handle sits in its gripping hand
KIT['trx-live'] = (e) => {
  const g = new THREE.Group(), A = V3(...(e.anchor || [0, 2.4, 1.1])), blk = 0x161616;
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.12), new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.6, roughness: 0.4 })); plate.position.copy(A).add(V3(0, 0.05, 0)); g.add(plate);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 12, 40), new THREE.MeshStandardMaterial({ color: 0xbbbbbb, metalness: 0.8, roughness: 0.3 })); ring.position.copy(A).add(V3(0, 0.01, 0)); g.add(ring);
  const main = liveTube(g, blk, 0.014, 'trx.strap'), S = { L: liveTube(g, blk, 0.012, 'trx.strap'), R: liveTube(g, blk, 0.012, 'trx.strap') }, H = { L: handleMesh(g, 0.13, 0.016, 0x202020, 'trx.L'), R: handleMesh(g, 0.13, 0.016, 0x202020, 'trx.R') };
  const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.02), new THREE.MeshStandardMaterial({ color: 0xd9392c, roughness: 0.5 })); g.add(buckle);
  return { group: g, update(out) {
    const G = held(out); if (!G.L && !G.R) return;
    const c = s => (G[s].center || G[s].p).clone(), m = G.L && G.R ? c('L').add(c('R')).multiplyScalar(0.5) : c(G.L ? 'L' : 'R');
    const J = A.clone().lerp(m, 0.55); main([A, A.clone().lerp(J, 0.5), J]); buckle.position.copy(A.clone().lerp(J, 0.75)); buckle.lookAt(J.clone().add(J.clone().sub(A)));
    for (const s of 'LR') { if (!G[s]) { H[s].visible = false; continue; } placeHandle(H[s], G[s]); const top = c(s).add(V3(0, 0.03, 0)); S[s]([J, J.clone().lerp(top, 0.5), top]); }
  } };
};
