// Equipment for the recipe viewer. What you see is the detailed gym kit (gymkit.js, 10k+ triangles a piece).
// Under it sit simple collision shapes (invisible, userData.qaId = "<piece>.<part>") matched to the kit's
// contact surfaces: bar and handle cylinders, pads, seats, foot plates. The automatic checker tests the body
// against those shapes. Rope strands and the V-handle follow the hands and are drawn directly.
import * as THREE from '../../vendor/three-r160/three.module.min.js';
import * as GK from './gymkit.js';
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const M = {
  steel: new THREE.MeshStandardMaterial({ color: '#3a4047', roughness: 0.45, metalness: 0.6 }),
  chrome: new THREE.MeshStandardMaterial({ color: '#c8ccd0', roughness: 0.22, metalness: 1.0 }),
  knurl: new THREE.MeshStandardMaterial({ color: '#9aa0a6', roughness: 0.55, metalness: 0.9 }),
  vinyl: new THREE.MeshStandardMaterial({ color: '#2b3138', roughness: 0.7 }),
  plate: new THREE.MeshStandardMaterial({ color: '#30353b', roughness: 0.6, metalness: 0.35 }),
  rubber: new THREE.MeshStandardMaterial({ color: '#24282d', roughness: 0.9 }),
  rope: new THREE.MeshStandardMaterial({ color: '#2a2d31', roughness: 0.95 }),
  cable: new THREE.MeshStandardMaterial({ color: '#15181b', roughness: 0.5, metalness: 0.4 }),
};
const HIDE = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
// turn the qaId meshes of a group into invisible collision shapes
function proxify(g) { g.traverse(o => { if (o.isMesh && o.userData.qaId && !o.userData.keep) { o.material = HIDE; o.castShadow = o.receiveShadow = false; } }); }
function visual(id, dofs = {}, opts = {}) { const P = GK.build(id, opts); for (const [k, v] of Object.entries(dofs)) P.set(k, v);
  P.object.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; }); P.object.updateMatrixWorld(true); return P; }
const hideAttachment = (P, a) => { const o = P.object.getObjectByName('attachment'); if (o) (o.parent && o.parent !== P.object ? o.parent : o).visible = false; else if (a && a.parent) a.parent.visible = false; }; // the kit's own handle/bar with its hook and ball stop (our handle replaces them)
// kit cable: the segments of the kit's own cable line, in path order (stack -> pulleys -> its handle)
const kitCableSegs = P => { const a = []; P.object.traverse(o => { const q = o.isMesh && o.geometry.parameters; if (q && o.geometry.type === 'CylinderGeometry' && q.height === 1 && Math.abs(q.radiusTop - 0.0032) < 1e-6) a.push(o); }); return a; };
// a weight stack driven by the real cable: lift = how much longer the cable from the last pulley to the handle is than at its
// shortest point in the rep (1:1 cable), mapped to the kit's 'motion' dof (k = metres of lift per unit of motion).
// The kit's last cable segment (to its own hidden handle) is hidden; our wire runs from that pulley to our handle.
function stackDriver(P, k) {
  // the last segment is the one that ends at the kit's own (hidden) handle; the static merge may fold fixed segments
  // together, so find it by position rather than by index
  const segs = kitCableSegs(P); P.object.updateMatrixWorld(true);
  const hA = P.anchors.grip || P.anchors.gripL || P.anchors.cableEnd, hp = hA ? hA.getWorldPosition(V3()) : V3();
  let lastIdx = -1, best = Infinity; segs.forEach((sg, i) => { if (!sg.visible || sg.scale.y < 1e-3) return; const e = sg.localToWorld(V3(0, 0.5, 0)), dd = e.distanceTo(hp); if (dd < best) { best = dd; lastIdx = i; } });
  const d = { Lmin: null,
    pulleyPt() { P.object.updateMatrixWorld(true); const sg = segs[lastIdx]; return sg ? sg.localToWorld(V3(0, -0.5, 0)) : null; },
    drive(L) { if (d.Lmin === null) return; P.set('motion', clamp((L - d.Lmin) / k, 0, 1)); P.object.updateMatrixWorld(true); if (segs[lastIdx]) segs[lastIdx].visible = false; } };
  if (segs[lastIdx]) segs[lastIdx].visible = false; return d;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function mesh(geo, mat, qaId, parent, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; m.userData.qaId = qaId; parent.add(m); return m; }
function roundedBox(w, h, d, r, seg = 5) {
  const s = new THREE.Shape(), x = -w / 2, y = -d / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(s, { depth: h - 0.024, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: seg, curveSegments: seg * 2 });
  g.rotateX(-Math.PI / 2); g.computeBoundingBox(); const bb = g.boundingBox; g.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -(bb.min.z + bb.max.z) / 2);
  return g;
}
function plateGeo(R, T, hub) {
  const p = [[0.026, -T / 2], [hub, -T / 2], [hub, -T * 0.32], [R * 0.82, -T * 0.32], [R * 0.86, -T / 2], [R, -T / 2 + 0.004], [R, T / 2 - 0.004], [R * 0.86, T / 2], [R * 0.82, T * 0.32], [hub, T * 0.32], [hub, T / 2], [0.026, T / 2]];
  const g = new THREE.LatheGeometry(p.map(([r, y]) => new THREE.Vector2(r, y)), 48); g.rotateZ(Math.PI / 2); return g;
}
const cylX = (r, len, seg = 32) => { const g = new THREE.CylinderGeometry(r, r, len, seg); g.rotateZ(Math.PI / 2); return g; };

// pieces: each returns {group, update(out)} ; update moves followers from the solved pose
export const KIT = {
  'flat-bench'(o) { // kit bench: pad top 0.441, 1.2 m long, centred on (z0+z1)/2; o.incline keeps the old two-part pad
    const g = new THREE.Group(), top = o.top ?? 0.44, z0 = o.z0 ?? -0.66, z1 = o.z1 ?? 0.56, w = 0.29, t = 0.075, zc = (z0 + z1) / 2;
    const inc = (o.incline || 0) * Math.PI / 180, pivot = o.pivot ?? 0.12;
    if (!inc) {
      mesh(roundedBox(w, 0.072, 1.2, 0.035), M.vinyl, 'bench.pad', g, 0, top - 0.036, zc);
      proxify(g); const P = visual('flat-bench'); P.object.position.set(0, top - 0.441, zc); g.add(P.object);
    } else {
      mesh(roundedBox(w, t, z1 - pivot, 0.035), M.vinyl, 'bench.seat', g, 0, top - t / 2, (pivot + z1) / 2);
      const back = new THREE.Group(); back.position.set(0, top - t / 2, pivot); back.rotation.x = inc; g.add(back);
      mesh(roundedBox(w, t, pivot - z0, 0.035), M.vinyl, 'bench.pad', back, 0, 0, -(pivot - z0) / 2);
      mesh(new THREE.BoxGeometry(0.06, 0.06, (pivot - z0) * 0.8), M.steel, 'bench.frame', back, 0, -0.06, -(pivot - z0) * 0.45);
      mesh(new THREE.BoxGeometry(0.075, 0.075, (z1 - z0) - 0.1), M.steel, 'bench.frame', g, 0, top - 0.15, (z0 + z1) / 2);
    }
    g.position.fromArray(o.at || [0, 0, 0]); g.rotation.y = (o.rotY || 0) * Math.PI / 180;
    return { group: g };
  },
  'power-rack'(o) { // kit rack; J-hooks hold the bar centre at hookY, 0.06 in front of o.at (o.visualAt moves the rack itself)
    const g = new THREE.Group(), hy = o.hookY ?? 0.94, w = o.halfWidth ?? 0.6, at = V3(...(o.at || [0, 0, 0]));
    const P = visual('power-rack', { hookHeight: clamp(hy - 0.05, 0.5, 1.7), safetyHeight: clamp(o.safeties ?? 0.3, 0.3, 1.2), showBar: 0 });
    const va = o.visualAt ? V3(...o.visualAt).sub(at) : V3(0, 0, 0.06 - 0.49); P.object.position.copy(va); P.object.updateMatrixWorld(true);
    for (const k of ['hookL', 'hookR']) { const a = P.anchors[k].getWorldPosition(V3()); mesh(new THREE.BoxGeometry(0.07, 0.07, 0.11), M.steel, 'rack.hook', g, a.x, a.y - 0.05, a.z); }
    proxify(g); g.add(P.object);
    g.position.copy(at);
    return { group: g };
  },
  barbell(o) {
    const g = new THREE.Group();
    // plates: a kg list (e.g. [10] for curls) sizes the kit's real plates; a plain count keeps the default 20 kg plates
    const KG = Array.isArray(o.plates) ? o.plates : null, k0 = KG ? KG[0] : 20;
    const PR = KG && !KG.length ? 0 : k0 >= 15 ? 0.225 : k0 >= 10 ? 0.165 : k0 >= 5 ? 0.13 : 0.1;
    mesh(cylX(0.0145, 1.31, 40), M.knurl, 'barbell.bar', g);
    for (const s of [-1, 1]) {
      mesh(cylX(0.025, 0.415, 32), M.chrome, 'barbell.sleeve', g, s * (0.655 + 0.03 + 0.2075), 0, 0);
      mesh(cylX(0.04, 0.03, 32), M.chrome, 'barbell.collar', g, s * 0.67, 0, 0);
      if (PR) mesh(plateGeo(PR, 0.075, 0.06), M.plate, 'barbell.plate', g, s * 0.718, 0, 0);
    }
    proxify(g); g.add(visual('barbell', {}, KG ? { plates: KG } : {}).object);
    return { group: g, update(out) { if (out.bar) g.position.copy(out.bar); } };
  },
  dumbbell(o) { // one per hand; follows the solved grip (axis = fist's curl axis)
    const make = side => {
      const g = new THREE.Group();
      mesh(cylX(0.016, 0.106, 28), M.knurl, `dumbbell.${side}.handle`, g);
      const head = new THREE.CylinderGeometry(0.083, 0.083, 0.106, 6); head.rotateZ(Math.PI / 2); head.rotateX(Math.PI / 2);
      for (const s of [-1, 1]) mesh(head, M.plate, `dumbbell.${side}.head`, g, s * 0.11, 0, 0);
      proxify(g); g.add(visual('dumbbell').object);
      return g;
    };
    const g = new THREE.Group(), L = make('L'), R = make('R'); g.add(L, R);
    const q = new THREE.Quaternion();
    return { group: g, update(out) {
      for (const [s, d] of [['L', L], ['R', R]]) { const gr = out.grips[s], rg = globalThis.__demo && globalThis.__demo.poser && globalThis.__demo.poser.grips && globalThis.__demo.poser.grips[s];
        // audit (run3 #646): no dumbbell in a free hand (grip type none) or on a side the recipe leaves empty (e.sides)
        if (!gr || (o.sides && !o.sides.includes(s)) || (rg && rg.type === 'none')) { d.visible = false; continue; } d.visible = true; d.position.copy(gr.center || gr.p); q.setFromUnitVectors(V3(1, 0, 0), gr.axis.clone().normalize()); d.quaternion.copy(q); }
    } };
  },
  'cable-tower'(o) { // column at o.at, pulley at height o.pulleyY; attachment follows the hands
    const g = new THREE.Group(), at = V3(...(o.at || [0, 0, 1])), py = o.pulleyY ?? 2.0;
    let pulley = o.pulleyPt ? o.pulleyPt.clone() : V3(at.x, py, at.z), driver = o.driver || null;
    if (!o.noColumn) { // kit column turned to face the user; its own D-handle hidden, the cable runs to our attachment
      const P = visual('cable-tower', { pulleyHeight: clamp(py, 0.1, 2.1), motion: 0 }); hideAttachment(P, P.anchors.grip);
      P.object.rotation.y = Math.PI; P.object.updateMatrixWorld(true);
      const ce = P.anchors.cableEnd.getWorldPosition(V3()); P.object.position.copy(pulley.clone().sub(ce)); g.add(P.object);
      g.updateMatrixWorld(true); driver = stackDriver(P, 0.65); const pp = driver.pulleyPt(); if (pp) pulley = pp;
    }
    const line = mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 1, 10), M.cable, 'cable.wire', g);
    const att = new THREE.Group(); g.add(att);
    const kind = o.attach || 'rope';
    if (kind === 'rope') {
      for (const s of [-1, 1]) {
        const r = mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.3, 24, 12), M.rope, 'cable.rope', att, 0, 0, 0); r.userData.side = s;
        mesh(new THREE.SphereGeometry(0.026, 24, 16), M.rubber, 'cable.ropeKnob', att).userData.knob = s;
      }
    } else if (kind === 'bar') {
      mesh(cylX(0.0145, o.barLen ?? 0.5, 24), M.chrome, 'cable.bar', att);
    } else if (kind === 'vbar') {
      for (const s of [-1, 1]) mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.13, 20), M.chrome, 'cable.vbar', att, s * 0.06, 0, 0);
      mesh(new THREE.BoxGeometry(0.14, 0.02, 0.02), M.steel, 'cable.vbar', att, 0, 0, 0);
    }
    const tmp = new THREE.Vector3();
    return { group: g, pulley, update(out) {
      const gl = out.grips.L, gr = out.grips.R; if (!gl || !gr) return;
      const c = gl.p.clone().add(gr.p).multiplyScalar(0.5);
      let hookPt = c.clone();
      if (kind === 'rope') {
        // each strand: knob below the fist, through the fist along the fist's own axis, then up to the hook
        const hook = c.clone().add(pulley.clone().sub(c).normalize().multiplyScalar(0.12)); hookPt = hook;
        att.position.set(0, 0, 0); att.quaternion.identity();
        const strands = att.children.filter(ch => ch.userData.side !== undefined), knobs = att.children.filter(ch => ch.userData.knob !== undefined);
        const seg = (m, a, b) => { const len = a.distanceTo(b); m.scale.set(1, len / 0.3, 1); m.position.copy(a.clone().add(b).multiplyScalar(0.5)); m.quaternion.setFromUnitVectors(V3(0, 1, 0), b.clone().sub(a).normalize()); };
        if (!att.children.some(ch => ch.userData.side2 !== undefined)) { // add a second segment per strand once
          for (const st of strands) { const m2 = st.clone(); m2.userData = { qaId: 'cable.rope', side2: st.userData.side }; att.add(m2); }
        }
        const seconds = att.children.filter(ch => ch.userData.side2 !== undefined);
        [gl, gr].forEach((gp, i) => {
          let ax = gp.axis.clone().normalize(); if (ax.dot(hook.clone().sub(gp.p)) < 0) ax.negate();
          const cc = gp.center || gp.p, exit = cc.clone().addScaledVector(ax, Math.max(0.06, (gp.width || 0.1) / 2 + 0.02)), knob = cc.clone().addScaledVector(ax, -0.075);
          seg(strands[i], knob, exit); seg(seconds[i], exit, hook); knobs[i].position.copy(knob.clone().addScaledVector(ax, -0.012));
        });
      } else {
        att.position.copy(c);
        const ax = gl.p.clone().sub(gr.p).normalize();
        att.quaternion.setFromUnitVectors(V3(1, 0, 0), kind === 'vbar' ? V3(1, 0, 0) : ax);
        if (kind === 'vbar') { // handles parallel to each fist axis
          const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), gl.axis.clone().normalize()); att.quaternion.copy(q);
          att.children.forEach((ch, i) => { if (i < 2) ch.position.set(0, 0, 0); });
          att.children[0].position.copy(V3(0, 0, 0)); att.children[0].quaternion.identity();
          att.position.copy(c); att.quaternion.identity();
          att.children[0].position.copy(gl.p.clone().sub(c)); att.children[0].quaternion.setFromUnitVectors(V3(0, 1, 0), gl.axis.clone().normalize());
          att.children[1].position.copy(gr.p.clone().sub(c)); att.children[1].quaternion.setFromUnitVectors(V3(0, 1, 0), gr.axis.clone().normalize());
          const mid = gl.p.clone().add(gr.p).multiplyScalar(0.5).sub(c).add(pulley.clone().sub(c).normalize().multiplyScalar(0.12));
          att.children[2].position.copy(mid); att.children[2].scale.set(Math.max(0.3, gl.p.distanceTo(gr.p) / 0.14), 1, 1);
          att.children[2].quaternion.setFromUnitVectors(V3(1, 0, 0), gl.p.clone().sub(gr.p).normalize());
          hookPt = c.clone().add(mid);
        }
      }
      const len = pulley.distanceTo(hookPt); line.scale.set(1, len, 1);
      line.position.copy(pulley.clone().add(hookPt).multiplyScalar(0.5));
      line.quaternion.setFromUnitVectors(V3(0, 1, 0), hookPt.clone().sub(pulley).normalize());
      if (driver) { driver.last = len; driver.drive(len); }
    }, get calib() { return driver; } };
  },
  'lat-pulldown-station'(o) { return KIT['pulldown-station'](o); },
  'seated-row-station'(o) { return KIT['row-station'](o); },
  'pulldown-station'(o) { // kit station at o.at, user facing the weight stack: seat top 0.512, thigh pad at height padY (0.62-0.8) 0.18 in front;
    // the kit's own bar is hidden and a kit lat bar follows the solved bar (its clip = out.bar)
    const g = new THREE.Group(), at = V3(...(o.at || [0, 0, 0])), padY = clamp(o.padY ?? 0.7, 0.62, 0.8);
    mesh(roundedBox(0.4, 0.078, 0.36, 0.03), M.vinyl, 'pulldown.seat', g, at.x, 0.473, at.z);
    const pad = new THREE.CylinderGeometry(0.057, 0.057, 0.41, 32); pad.rotateZ(Math.PI / 2);
    mesh(pad, M.vinyl, 'pulldown.thighPad', g, at.x, padY, at.z + 0.18);
    const bar = new THREE.Group(); g.add(bar);
    const LB = visual('lat-bar');
    for (const k of ['gripL', 'gripR']) { const a = LB.anchors[k]; const c = new THREE.CylinderGeometry(0.0145, 0.0145, 0.2, 28); c.rotateZ(Math.PI / 2);
      const m = mesh(c, M.chrome, 'pulldown.bar', bar); m.position.copy(a.position); m.quaternion.copy(a.quaternion); }
    mesh(cylX(0.0145, 0.6, 28), M.chrome, 'pulldown.bar', bar, 0, -0.07, 0);
    proxify(g); bar.add(LB.object);
    { // audit (reviewer run3): the solved bar point is where the fists are - put the lat bar's grip sections there, not its centre
      LB.object.updateMatrixWorld(true); const ga = LB.anchors.gripL.getWorldPosition(V3()).add(LB.anchors.gripR.getWorldPosition(V3())).multiplyScalar(0.5);
      for (const c of bar.children) c.position.sub(V3(0, ga.y, ga.z)); }
    // the kit's default layout faces the weight stack (user faces +Z, stack and thigh-pad upright in front)
    const P = visual('lat-pulldown-station', { thighPad: padY, motion: 0 }); hideAttachment(P, P.anchors.gripL);
    P.object.position.copy(at); g.add(P.object); g.updateMatrixWorld(true);
    const driver = stackDriver(P, 0.95), pulley = driver.pulleyPt() || V3(at.x, 2.47, at.z + 0.12);
    const line = mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 1, 10), M.cable, 'pulldown.wire', g);
    return { group: g, calib: driver, update(out) {
      if (!out.bar) return; bar.position.copy(out.bar);
      const len = pulley.distanceTo(out.bar); line.scale.set(1, len, 1);
      line.position.copy(pulley.clone().add(out.bar).multiplyScalar(0.5));
      line.quaternion.setFromUnitVectors(V3(0, 1, 0), out.bar.clone().sub(pulley).normalize());
      driver.last = len; driver.drive(len);
    } };
  },
  'row-station'(o) { // kit seated row: seat top 0.468 (z -0.75..0.25), tilted foot plate (kit foot anchors), low pulley;
    // the kit's own V-handle is hidden; our V-handle follows the hands and the cable runs from the kit's pulley
    const g = new THREE.Group();
    mesh(roundedBox(0.32, 0.072, 1.0, 0.03), M.vinyl, 'row.seat', g, 0, 0.432, -0.25);
    const P = visual('seated-row-station', { motion: 0 }); hideAttachment(P, P.anchors.gripL);
    P.object.updateMatrixWorld(true); const fL = P.anchors.footL, fR = P.anchors.footR, qW = fL.getWorldQuaternion(new THREE.Quaternion()), n = V3(0, 1, 0).applyQuaternion(qW), toe = V3(0, 0, 1).applyQuaternion(qW);
    const plate = mesh(new THREE.BoxGeometry(0.4, 0.02, 0.34), M.steel, 'row.footPlate', g);
    plate.position.copy(fL.getWorldPosition(V3()).add(fR.getWorldPosition(V3())).multiplyScalar(0.5).addScaledVector(n, -0.01));
    plate.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(n.clone().cross(toe).normalize(), n, toe));
    proxify(g); g.add(P.object); g.updateMatrixWorld(true);
    const driver = stackDriver(P, 0.55), ce = driver.pulleyPt() || P.anchors.cableEnd.getWorldPosition(V3());
    const t = KIT['cable-tower']({ at: [ce.x, 0, ce.z], pulleyY: ce.y, pulleyPt: ce, driver, attach: 'vbar', noColumn: true });
    g.add(t.group);
    return { group: g, update: t.update, calib: driver };
  },
  'plyo-box'(o) { const g = new THREE.Group(); mesh(roundedBox(o.w ?? 0.5, o.h ?? 0.45, o.d ?? 0.6, 0.02), M.vinyl, 'box.top', g, 0, (o.h ?? 0.45) / 2, 0); g.position.fromArray(o.at || [0, 0, 0]); return { group: g }; },
};
export function buildGear(recipe, scene) {
  const pieces = [];
  for (const e of recipe.equipment || []) {
    const f = KIT[e.kit]; if (!f) { console.warn('no kit piece', e.kit); continue; }
    const p = f(e); p.id = e.id || e.kit; p.group.userData.qaId = p.id; scene.add(p.group); pieces.push(p);
  }
  return pieces;
}
