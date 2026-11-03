/* Exercise3D: the shared real-time 3D body (Nov 2026, phase 1 preview).
   One rigged MakeHuman (CC0) body with 37 named muscles, posed every frame from the motions the app already has
   (ExerciseAnim.sample + ExerciseAnim.skeleton, re-solved for this body's proportions). Hands close around the
   handle they hold: palm, finger and thumb angles are solved once per handle size against the mesh itself.
   Equipment is drawn from the same shapes as the canvas demo, moved so it sits in the hands of this body.

   Pure part (works in Node with three.js): Exercise3D.core(THREE, gltf, meta, opts) -> engine.
   App part: Exercise3D.has(id), Exercise3D.paint(ctx, w, h, id, state) draws into a card's 2D canvas,
   loading three.js and the body on first use (vendor/three-r160, 3d/body.glb). One WebGL context for all cards.
   Only the exercises in EXERCISE_3D.exercises are offered, all as "preview" until Aziz reviews them. */
(function (root) {
  'use strict';

  const SAN = n => n.replace(/[\[\]\.:\/]/g, '');
  const SIDES = ['L', 'R'];
  const COLS = { metal: ['#b9bfc6', 0.25, 0.9], plate: ['#2f343a', 0.6, 0.35], pad: ['#2b3138', 0.75, 0], frame: ['#3a4047', 0.45, 0.6], cable: ['#4a5058', 0.5, 0.3] };

  function core(THREE, gltf, meta, opts) {
    opts = opts || {};
    const EA = opts.anim || root.ExerciseAnim;
    const DATA = opts.data || root.EXERCISE_3D || { exercises: {} };
    const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
    const A3 = a => new THREE.Vector3(a[0], a[1], a[2]);
    const tmpM = new THREE.Matrix4();
    const basisQ = (x, y, z) => new THREE.Quaternion().setFromRotationMatrix(tmpM.makeBasis(x, y, z));
    function frameQ(d, u) { const x = d.clone().normalize(), z = u.clone().addScaledVector(x, -u.dot(x)).normalize(), y = z.clone().cross(x); return basisQ(x, y, z); }
    const aim = (dRest, uRest, d, u) => frameQ(d, u).multiply(frameQ(dRest, uRest).invert());
    const perp = (v, axis) => v.clone().addScaledVector(axis, -v.dot(axis));
    const qAxis = (axis, ang) => new THREE.Quaternion().setFromAxisAngle(axis.clone().normalize(), ang);
    const fromTo = (a, b) => new THREE.Quaternion().setFromUnitVectors(a.clone().normalize(), b.clone().normalize());
    function twistOf(q, axis) { const v = V3(q.x, q.y, q.z), p = axis.clone().multiplyScalar(v.dot(axis)); const t = new THREE.Quaternion(p.x, p.y, p.z, q.w); return t.lengthSq() < 1e-12 ? new THREE.Quaternion() : t.normalize(); }
    function ik2(a, target, l1, l2, pole) {
      const d = target.clone().sub(a); let dist = d.length();
      const err = Math.max(0, dist - (l1 + l2) * 0.9995);
      dist = Math.max(Math.abs(l1 - l2) + 1e-3, Math.min(dist, (l1 + l2) * 0.9995)); d.normalize();
      const x = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist), h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
      let pp = perp(pole, d); if (pp.lengthSq() < 1e-8) pp = perp(V3(0, 0, 1), d); pp.normalize();
      return { mid: a.clone().addScaledVector(d, x).addScaledVector(pp, h), end: a.clone().addScaledVector(d, dist), err };
    }

    // ---------- body ----------
    const scene = new THREE.Group();
    let skinned = null; gltf.scene.traverse(o => { if (o.isSkinnedMesh) skinned = o; });
    skinned.frustumCulled = false; skinned.castShadow = true; skinned.receiveShadow = true;
    const bones = {}; meta.bones.forEach(b => { bones[b] = gltf.scene.getObjectByName(SAN(b)); });
    const parentOf = {}; meta.bones.forEach((b, i) => { parentOf[b] = meta.parents[i]; });
    const head = b => A3(meta.heads[b]), tail = b => A3(meta.tails[b]);
    scene.add(gltf.scene);
    const dist = (a, b) => head(a).distanceTo(head(b));
    const restLeg = dist('upperleg01.L', 'lowerleg01.L') + dist('lowerleg01.L', 'foot.L');
    const K = (EA.B.thigh + EA.B.shin) / restLeg;                 // uniform scale: legs as long as the canvas mannequin's
    gltf.scene.scale.setScalar(K);
    const hipMid = head('upperleg01.L').add(head('upperleg01.R')).multiplyScalar(0.5);
    const shMid = head('upperarm01.L').add(head('upperarm01.R')).multiplyScalar(0.5);
    const BODY = { hipW: head('upperleg01.L').x * K, shW: head('upperarm01.L').x * K, spine: hipMid.distanceTo(shMid) * K - 0.015,
      upper: dist('upperarm01.L', 'lowerarm01.L') * K, fore: dist('lowerarm01.L', 'wrist.L') * K, hand: 0.08,
      thigh: dist('upperleg01.L', 'lowerleg01.L') * K, shin: dist('lowerleg01.L', 'foot.L') * K, foot: 0.16 };
    const upR = shMid.clone().sub(hipMid).normalize(), sideR = V3(1, 0, 0), fR = sideR.clone().cross(upR).normalize();
    const QrestT = basisQ(sideR, upR.clone(), fR).invert();
    const Lr = { ua: dist('upperarm01.L', 'lowerarm01.L'), fa: dist('lowerarm01.L', 'wrist.L'), th: dist('upperleg01.L', 'lowerleg01.L'), sh: dist('lowerleg01.L', 'foot.L') };

    // muscle colours: per-vertex muscle id (vertex shader looks up a colour table, so ids never blend)
    const MUS = meta.muscles || DATA.muscles || [];
    const NM = 40, tint = new Float32Array(NM * 2 * 4), uTint = { value: [] };
    for (let i = 0; i < NM * 2; i++) uTint.value.push(new THREE.Vector4(0, 0, 0, 0));
    const RED = new THREE.Color(opts.primary || '#d9392c'), AMBER = new THREE.Color(opts.secondary || '#f0a030');
    const geo = skinned.geometry;
    if (!geo.attributes._muscle) geo.setAttribute('_muscle', new THREE.BufferAttribute(new Uint8Array(geo.attributes.position.count * 4), 4, true));
    // look A "Studio" (Aziz's pick, Nov 1): matte light grey, shallow muscle grooves from normal_A.png, soft room light
    const bodyMat = new THREE.MeshStandardMaterial({ color: opts.bodyColor || '#c9ccd0', roughness: 0.62, metalness: 0, envMapIntensity: 0.35 });
    if (opts.normalMap && geo.attributes.uv && geo.attributes.tangent) { bodyMat.normalMap = opts.normalMap; bodyMat.normalScale = new THREE.Vector2(1, 1); }
    bodyMat.onBeforeCompile = sh => {
      sh.uniforms.uTint = uTint;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 _muscle; uniform vec4 uTint[' + (NM * 2) + ']; varying vec4 vMus; varying float vEye;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n int mid = int(_muscle.r * 255.0 + 0.5); int ms = _muscle.a > 0.5 ? 0 : 1;\n vec4 tc = uTint[mid * 2 + ms]; vMus = vec4(tc.rgb, tc.a * _muscle.g); vEye = _muscle.b;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec4 vMus; varying float vEye;')
        .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb = mix(diffuseColor.rgb, vMus.rgb, smoothstep(0.02, 0.9, vMus.a));\n diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.57, 0.6), vEye);')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, 0.48, smoothstep(0.02, 0.9, vMus.a));');
    };
    bodyMat.customProgramCacheKey = () => 'ex3d-body';
    skinned.material = bodyMat;
    function setMuscles(primary, secondary) {
      uTint.value.forEach(v => v.set(0, 0, 0, 0));
      const put = (list, c) => (list || []).forEach(m => {
        const [id, side] = String(m).split('@'), i = MUS.indexOf(id) + 1; if (i <= 0) return;
        SIDES.forEach((s, si) => { if (!side || side === s) uTint.value[i * 2 + si].set(c.r, c.g, c.b, 1); });
      });
      put(secondary, AMBER); put(primary, RED);
      const mu = geo.attributes._muscle, n = mu.count, col = geo.attributes.color || geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3)).attributes.color;
      for (let i = 0; i < n; i++) { const id = Math.round(mu.getX(i) * 255), t = uTint.value[id * 2 + (mu.getW(i) > 0.5 ? 0 : 1)], w = mu.getY(i) * t.w; const red = t.w && t.y < 0.4; col.setXYZ(i, red ? w : 0, red ? 0 : w, 0); }
      col.needsUpdate = true;
    }

    // ---------- pose state: world rotations Q and joint positions P in body (rest) units ----------
    const Q = {}, P = {};
    const ID = new THREE.Quaternion();
    function place(b, q) { const p = parentOf[b]; Q[b] = q; if (p) P[b] = P[p].clone().add(head(b).sub(head(p)).applyQuaternion(Q[p])); }
    const jp = b => { const p = parentOf[b]; return P[p].clone().add(head(b).sub(head(p)).applyQuaternion(Q[p])); };
    const local = (b, ql) => place(b, Q[parentOf[b]].clone().multiply(ql || ID));
    function apply() {
      for (const b of meta.bones) {
        const p = parentOf[b], bone = bones[b];
        if (!p) { bone.position.copy(P[b]); bone.quaternion.copy(Q[b]); } else bone.quaternion.copy(Q[p].clone().invert().multiply(Q[b]));
      }
      gltf.scene.updateMatrixWorld(true);
    }
    function restPose() { P.root = head('root'); for (const b of meta.bones) { if (!parentOf[b]) Q[b] = ID.clone(); else place(b, ID.clone()); } }

    // ---------- hands ----------
    const hand = {};
    const domBone = new Int32Array(geo.attributes.position.count);
    { const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight; for (let i = 0; i < si.count; i++) { let bi = 0, bw = -1; for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; bi = si.getComponent(i, k); } } domBone[i] = bi; } }
    const boneIdx = {}; skinned.skeleton.bones.forEach((b, i) => { boneIdx[b.name] = i; });
    const vertsOf = (b, pred) => { const k = boneIdx[SAN(b)], out = []; for (let i = 0; i < domBone.length; i++) if (domBone[i] === k && (!pred || pred(i))) out.push(i); return out; };
    const restV = i => V3().fromBufferAttribute(geo.attributes.position, i);
    for (const s of SIDES) {
      const w = head('wrist.' + s), k2 = head('finger2-1.' + s), k3 = head('finger3-1.' + s), k5 = head('finger5-1.' + s);
      const kMid = k2.clone().add(k3).multiplyScalar(0.5), dir = kMid.clone().sub(w).normalize();
      const across = (s === 'L' ? k2.clone().sub(k5) : k5.clone().sub(k2)).normalize();
      const pn = dir.clone().cross(across).normalize(); if (pn.dot(V3(s === 'L' ? -1 : 1, 0, 0)) < 0) pn.negate();
      const palm = w.clone().lerp(kMid, 0.55);
      hand[s] = { w, dir, pn, curlAxis: dir.clone().cross(pn).normalize(), thumbSide: k2.clone().sub(k5).normalize(), palm, kMid, base: w.clone().lerp(kMid, opts.gripAt || 0.7), qaGrip: w.clone().lerp(kMid, 0.62).addScaledVector(pn, 0.026),
        palmSkin: vertsOf('wrist.' + s, i => restV(i).sub(palm).dot(pn) > 0 && restV(i).distanceTo(palm) < 0.05),
        seg: {} };
      for (let f = 1; f <= 5; f++) for (let j = 1; j <= 3; j++) hand[s].seg[f + '-' + j] = vertsOf(`finger${f}-${j}.${s}`);
      // power grip: the handle runs slightly diagonally across the palm, nearer the wrist on the little-finger side
      const hs = hand[s]; hs.ts = Math.sign(hs.thumbSide.dot(hs.curlAxis)) || 1;
    }
    const DIAG = opts.gripDiag == null ? 0.3 : opts.gripDiag, AT = opts.gripAt || 0.7; let curDiag = null;
    function setDiag(th, at) {   // exercises.json gripDiag / gripAt override the defaults (e.g. a back squat holds the bar straighter across the palm)
      if (th + '|' + at === curDiag) return; curDiag = th + '|' + at;
      for (const s of SIDES) { const hs = hand[s]; hs.gripAxis = hs.curlAxis.clone().multiplyScalar(hs.ts).addScaledVector(hs.dir, Math.tan(th)).normalize(); hs.base = hs.w.clone().lerp(hs.kMid, at); }
    }
    setDiag(DIAG, AT);
    const _v = V3();
    function skinPos(i) { _v.fromBufferAttribute(geo.attributes.position, i); skinned.applyBoneTransform(i, _v); return _v; }
    // signed distance (rest units) from the vertex set to a cylinder (centre c, unit axis a, radius r)
    function cylGap(idx, c, a, r) { let mn = 1e9; for (const i of idx) { const p = skinPos(i).sub(c); mn = Math.min(mn, Math.sqrt(Math.max(0, p.lengthSq() - p.dot(a) ** 2)) - r); } return mn; }
    const FINGER_W = [1, 1.1, 0.8];
    const RELAXED = { f: [[0.3, 0.35, 0.25], [0.32, 0.38, 0.27], [0.36, 0.42, 0.3], [0.4, 0.45, 0.32]], t: [0.5, 0.25, 0.15, 0.1] };
    function setFingers(s, F) {   // F: {f:[[a1,a2,a3] x4 for fingers 2..5], t:[opp, c1, c2, c3]}
      const h = hand[s], so = s === 'L' ? 1 : -1;
      for (let f = 2; f <= 5; f++) { const sp = (f - 3.5) * 0.02; for (let j = 1; j <= 3; j++) local(`finger${f}-${j}.${s}`, qAxis(h.curlAxis, F.f[f - 2][j - 1] + (j === 1 ? sp : 0))); }
      local(`finger1-1.${s}`, qAxis(h.dir, so * F.t[0]).multiply(qAxis(h.curlAxis, F.t[1])));
      local(`finger1-2.${s}`, qAxis(h.curlAxis, F.t[2])); local(`finger1-3.${s}`, qAxis(h.curlAxis, F.t[3]));
    }
    const gripCache = {};
    // Solve palm offset, finger and thumb curl for a cylinder of radius r (rest units) once, in the rest pose:
    // the cylinder runs along the hand's curl axis, so turning the hand about the handle never changes the fit.
    function solveGrip(s, r) {
      const key = s + Math.round(r * 2000) + '|' + curDiag; if (gripCache[key]) return gripCache[key];
      const h = hand[s], a = h.gripAxis;
      restPose(); apply();
      const C = d => h.base.clone().addScaledVector(h.pn, d);
      let lo = 0, hi = 0.08;      // palm offset: palm skin 0.8 mm off the surface
      for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (cylGap(h.palmSkin, C(m), a, r) < 0.003 / K) lo = m; else hi = m; }
      const c = C(hi), F = { f: [], t: [0, 0, 0, 0] };
      const touch = 0.0037 / K;
      const solveJoint = (set, setAngle, max) => {   // smallest angle where the segment touches; never through
        let prev = 0; setAngle(0); apply(); if (cylGap(set, c, a, r) <= touch) return 0;
        for (let ang = 0.05; ang <= max + 1e-9; ang += 0.05) {
          setAngle(ang); apply();
          if (cylGap(set, c, a, r) <= touch) { let l = prev, u = ang; for (let i = 0; i < 14; i++) { const m = (l + u) / 2; setAngle(m); apply(); if (cylGap(set, c, a, r) <= touch) u = m; else l = m; } setAngle(l); apply(); return l; }
          prev = ang;
        }
        return max;
      };
      // fingers: close all three joints together (MCP:PIP:DIP = 0.8:1:0.7) until the finger first touches,
      // then close PIP and DIP on their own until the middle and end segments touch too. Never through the handle.
      const RATIO = [0.8, 1, 0.7], MAXJ = [1.6, 1.9, 1.5];
      for (let f = 2; f <= 5; f++) {
        const sp = (f - 3.5) * 0.02, A = [0, 0, 0];
        const setAll = () => { for (let k = 1; k <= 3; k++) local(`finger${f}-${k}.${s}`, qAxis(h.curlAxis, A[k - 1] + (k === 1 ? sp : 0))); };
        const all = h.seg[f + '-1'].concat(h.seg[f + '-2'], h.seg[f + '-3']);
        const c = solveJoint(all, ang => { for (let k = 0; k < 3; k++) A[k] = Math.min(MAXJ[k], RATIO[k] * ang); setAll(); }, 2.2);
        for (let k = 0; k < 3; k++) A[k] = Math.min(MAXJ[k], RATIO[k] * c);
        for (let j = 2; j <= 3; j++) {
          const set = h.seg[f + '-' + j].concat(j === 2 ? h.seg[f + '-3'] : []), a0 = A[j - 1];
          const extra = solveJoint(set, ang => { A[j - 1] = a0 + ang; setAll(); }, Math.max(0, MAXJ[j - 1] - a0));
          A[j - 1] = a0 + extra; setAll();
        }
        F.f.push(A.slice());
      }
      // thumb: search opposition and base curl, then close the two outer joints onto the handle
      let best = null;
      for (let o = 0.3; o <= 1.91; o += 0.2) for (let c1 = 0; c1 <= 1.31; c1 += 0.2) {
        const T = [o, c1, 0, 0]; setFingers(s, { f: F.f, t: T }); apply();
        const g1 = cylGap(h.seg['1-1'], c, a, r), g2 = cylGap(h.seg['1-2'], c, a, r);
        if (g1 < -0.0005 / K || g2 < -0.0005 / K) continue;
        const setA = k => ang => { T[k] = ang; setFingers(s, { f: F.f, t: T }); };
        T[2] = solveJoint(h.seg['1-2'], setA(2), 1.2); setA(2)(T[2]);
        T[3] = solveJoint(h.seg['1-3'], setA(3), 1.2); setA(3)(T[3]); apply();
        const gt = cylGap(h.seg['1-3'], c, a, r);
        const score = Math.abs(gt - 0.001 / K) + 0.02 * (T[1] + T[2] + T[3]);
        if (gt > -0.0015 / K && (!best || score < best.score)) best = { score, T: T.slice(), gt };
      }
      if (best) { const b0 = best.T.slice(); for (let o = b0[0] - 0.15; o <= b0[0] + 0.151; o += 0.05) for (let c1 = Math.max(0, b0[1] - 0.15); c1 <= b0[1] + 0.151; c1 += 0.05) {
        const T = [o, c1, 0, 0]; setFingers(s, { f: F.f, t: T }); apply();
        if (cylGap(h.seg['1-1'], c, a, r) < -0.0005 / K || cylGap(h.seg['1-2'], c, a, r) < -0.0005 / K) continue;
        const setA = k => ang => { T[k] = ang; setFingers(s, { f: F.f, t: T }); };
        T[2] = solveJoint(h.seg['1-2'], setA(2), 1.2); setA(2)(T[2]); T[3] = solveJoint(h.seg['1-3'], setA(3), 1.2); setA(3)(T[3]); apply();
        const gt = cylGap(h.seg['1-3'], c, a, r), score = Math.abs(gt - 0.001 / K) + 0.02 * (T[1] + T[2] + T[3]);
        if (gt > -0.0015 / K && score < best.score) best = { score, T: T.slice(), gt }; } }
      F.t = best ? best.T : [1.1, 0.7, 0.7, 0.6];
      const res = { c: c.clone().sub(h.w), F, thumbGapMm: best ? best.gt * K * 1000 : null };
      gripCache[key] = res; return res;
    }

    // ---------- equipment ----------
    const gear = new THREE.Group(); scene.add(gear);
    const mats = {}; const matOf = col => mats[col] || (mats[col] = new THREE.MeshStandardMaterial({ color: (COLS[col] || COLS.frame)[0], roughness: (COLS[col] || COLS.frame)[1], metalness: (COLS[col] || COLS.frame)[2] }));
    const YAX = V3(0, 1, 0);
    function makeMesh(sh, qaId) {
      let g, k = sh.k;
      if (k === 'cap' || k === 'line') { const ra = k === 'line' ? 0.005 : sh.ra, rb = k === 'line' ? 0.005 : sh.rb; g = new THREE.CylinderGeometry(rb, ra, 1, k === 'line' ? 8 : 28, 1); }
      else if (k === 'sph') g = new THREE.SphereGeometry(sh.r, 20, 14);
      else if (k === 'disc') g = new THREE.CylinderGeometry(sh.r, sh.r, 0.03, 40);
      else if (k === 'box') g = new THREE.BoxGeometry(A3(sh.ax[0]).length() * 2, A3(sh.ax[1]).length() * 2, A3(sh.ax[2]).length() * 2);
      const m = new THREE.Mesh(g, matOf(k === 'line' ? 'cable' : sh.col)); m.castShadow = m.receiveShadow = true; m.userData.qaId = qaId;
      if (k === 'cap') { m.userData.ends = [new THREE.Mesh(new THREE.SphereGeometry(sh.ra, 18, 12), m.material), new THREE.Mesh(new THREE.SphereGeometry(sh.rb, 18, 12), m.material)]; m.userData.ends.forEach(e => { e.castShadow = true; e.userData.qaId = qaId; gear.add(e); }); }
      gear.add(m); return m;
    }
    function setMesh(m, sh) {
      const k = sh.k;
      if (k === 'cap' || k === 'line') {
        const a = A3(sh.a), b = A3(sh.b), d = b.clone().sub(a), L = Math.max(1e-4, d.length());
        m.position.copy(a).add(b).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(YAX, d.normalize()); m.scale.set(1, L, 1);
        if (m.userData.ends) { m.userData.ends[0].position.copy(a); m.userData.ends[1].position.copy(b); }
      } else if (k === 'sph') m.position.copy(A3(sh.c));
      else if (k === 'disc') { m.position.copy(A3(sh.c)); m.quaternion.setFromUnitVectors(YAX, A3(sh.n).normalize()); }
      else if (k === 'box') {
        const x = A3(sh.ax[0]).normalize(), y = A3(sh.ax[1]).normalize(), z = A3(sh.ax[2]).normalize();
        const M = new THREE.Matrix4().makeBasis(x, y, z); if (M.determinant() < 0) M.makeBasis(x, y, z.negate());
        m.quaternion.setFromRotationMatrix(M); m.position.copy(A3(sh.c));
      }
    }

    // ---------- the exercise ----------
    let cur = null;
    const W2B = v => A3(v).multiplyScalar(1 / K), B2W = v => v.clone().multiplyScalar(K);
    function scaledPose(p, lift) {   // torso-relative targets follow this body's shorter torso; lift = support offset
      const o = Object.assign({}, p), sy = BODY.spine / EA.B.spine, sx = BODY.shW / EA.B.shW;
      ['hands', 'feet'].forEach(k => { if (!p[k]) return; o[k] = {}; SIDES.forEach(s => { const v = p[k][s]; o[k][s] = v && v.t ? { t: [v.t[0] * sx, v.t[1] * sy, v.t[2]] } : v; }); });
      if (lift) o.pelvis = [p.pelvis[0] + lift[0], p.pelvis[1] + lift[1], p.pelvis[2] + lift[2]];
      return o;
    }
    // the handle a hand holds: the thin cylinder nearest its grip point
    function handleOf(shapes, g) {
      let best = null;
      shapes.forEach((sh, i) => {
        if (sh.k !== 'cap' || sh.ra > 0.03) return;
        const a = A3(sh.a), b = A3(sh.b), d = b.clone().sub(a), L = d.length(); if (L < 0.04) return; d.normalize();
        const t = Math.max(0, Math.min(L, A3(g).sub(a).dot(d))), p = a.clone().addScaledVector(d, t), e = p.distanceTo(A3(g));
        if (e < 0.12 && (!best || e < best.e)) best = { i, a: d, p, e, r: sh.ra, A: a, B: b };
      });
      return best;
    }
    function setExercise(id) {
      if (cur && cur.id === id) return cur;
      const def = EA.defs[id]; if (!def) return null;
      const info = (DATA.exercises || {})[id] || {};
      while (gear.children.length) { const m = gear.children.pop(); m.geometry && m.geometry.dispose(); }
      cur = { id, def, info, lift: [0, 0, 0], meshes: null }; setDiag(info.gripDiag == null ? DIAG : info.gripDiag, info.gripAt || AT);
      setMuscles(info.primary, info.secondary);
      // support pads: lift or lower the body so the back, seat or bench is touched (about 4 mm into the pad)
      const pads = []; cur.hasPads = false;
      const sk0 = EA.skeleton(EA.sample(def, 0));
      (def.props ? def.props(sk0) : []).forEach((sh, i) => { if (sh.k === 'box' && sh.col === 'pad') pads.push(i); });
      cur.hasPads = pads.length > 0;
      if (pads.length) {
        const torsoV = []; for (let i = 0; i < domBone.length; i += 3) { const b = skinned.skeleton.bones[domBone[i]].name; if (/^(root|spine0[1-5]|pelvis|upperleg01)/.test(b)) torsoV.push(i); }
        for (let pass = 0; pass < 2; pass++) {
          let deep = pads.map(() => -1e9);
          for (let fi = 0; fi < 10; fi++) {
            const t = fi / 10; posePure(t); const shapes = cur.shapes;
            pads.forEach((pi, n) => {
              const sh = shapes[pi], c = A3(sh.c), ax = sh.ax.map(A3), half = ax.map(v => v.length()), u = ax.map(v => v.clone().normalize());
              const toBody = B2W(P.root).sub(c); let k = 0, bestDot = -1; u.forEach((v, j) => { const d = Math.abs(v.dot(toBody)) / half[j]; if (d > bestDot) { bestDot = d; k = j; } });
              const nrm = u[k].clone().multiplyScalar(Math.sign(u[k].dot(toBody)) || 1); cur.padN = cur.padN || []; cur.padN[n] = nrm;
              for (const i of torsoV) {
                const p = skinned.localToWorld(skinPos(i).clone()).sub(c); let inside = true;
                for (let j = 0; j < 3; j++) if (j !== k && Math.abs(p.dot(u[j])) > half[j] - 0.01) inside = false;
                if (!inside) continue;
                deep[n] = Math.max(deep[n], half[k] - p.dot(nrm));
              }
            });
          }
          pads.forEach((pi, n) => { if (deep[n] > -0.3) { const d = deep[n] - 0.002; cur.lift = cur.lift.map((x, j) => x + cur.padN[n].getComponent(j) * d); } });
        }
      }
      cur.meshes = null; posePure(0);
      const qa = (pc, i) => pc.role || ('frame' + i + '.part');
      cur.meshes = cur.shapes.map((sh, i) => makeMesh(sh, qa(cur.roles[i] || {}, i)));
      cur.meshes.forEach((m, i) => setMesh(m, cur.shapes[i]));
      // camera framing over the whole loop
      const pts = []; for (let i = 0; i < 16; i++) { posePure(i / 16); ['wrist', 'foot', 'head', 'upperarm01', 'lowerleg01'].forEach(b => SIDES.forEach(s => { const n = bones[b + '.' + s] || bones[b]; if (n) pts.push(n.getWorldPosition(V3())); })); pts.push(bones.head.getWorldPosition(V3()).add(V3(0, 0.14, 0))); cur.shapes.forEach(sh => ['a', 'b', 'c'].forEach(k => { if (sh[k] && sh.k !== 'line') pts.push(A3(sh[k])); })); }
      const box = new THREE.Box3().setFromPoints(pts); cur.center = box.getCenter(V3()); cur.radius = pts.reduce((m, p) => Math.max(m, p.distanceTo(cur.center)), 0.3);
      return cur;
    }

    // pose the body and equipment at rep phase t in [0,1)
    function posePure(t) {
      const def = cur.def, info = cur.info, p = EA.sample(def, t);
      const skD = EA.skeleton(p);
      let lift = cur.lift.slice(), skO = EA.skeleton(scaledPose(p, lift), BODY);
      for (let it = 0; it < 3; it++) {   // feet that cannot reach their spot: lower the hips (shorter legs than the canvas mannequin)
        let over = 0; SIDES.forEach(s => { const d = A3(skO.hip[s]).distanceTo(A3(skO.an[s])) || 0; const tgt = A3(skO.an[s]); over = Math.max(over, A3(skO.hip[s]).distanceTo(tgt) - (BODY.thigh + BODY.shin) * 0.999); });
        const legErr = Math.max(0, ...SIDES.map(s => { const pp = p.feet && p.feet[s]; if (!pp || pp.t) return 0; return A3(skO.hip[s]).distanceTo(A3(pp)) - (BODY.thigh + BODY.shin) * 0.995; }));
        if (legErr <= 0.0005 || cur.hasPads) break; lift[1] -= legErr + 0.001; skO = EA.skeleton(scaledPose(p, lift), BODY);
      }
      const shapesD = def.props ? def.props(skD) : [];
      const roles = shapesD.map(() => ({}));
      // torso: rigid frame from the mannequin's torso, hips placed on its hips
      const Qt = basisQ(A3(skO.side), A3(skO.up), A3(skO.f)).multiply(QrestT);
      const hipW = W2B(skO.hip.L).add(W2B(skO.hip.R)).multiplyScalar(0.5);
      P.root = hipW.clone().sub(hipMid.clone().sub(head('root')).applyQuaternion(Qt));
      Q.root = Qt;
      for (const b of meta.bones) if (b !== 'root' && !/^(clavicle|shoulder01|upperarm|lowerarm|wrist|finger|upperleg|lowerleg|foot|toe)/.test(b)) local(b);
      const held = {}, hds = {};
      for (const s of SIDES) { hds[s] = handleOf(shapesD, skD.grip[s]); if (hds[s]) { if (info.handleRadius) hds[s].r = info.handleRadius; solveGrip(s, hds[s].r / K); } }   // may reset the pose: before posing
      P.root = hipW.clone().sub(hipMid.clone().sub(head('root')).applyQuaternion(Qt)); Q.root = Qt;
      for (const b of meta.bones) if (b !== 'root' && !/^(clavicle|shoulder01|upperarm|lowerarm|wrist|finger|upperleg|lowerleg|foot|toe)/.test(b)) local(b);
      for (const s of SIDES) {
        const sg = s === 'L' ? 1 : -1, h = hand[s];
        // shoulder: aim the clavicle so the shoulder joint lands where the motion puts it
        const clavP = jp('clavicle.' + s), v0 = head('upperarm01.' + s).sub(head('clavicle.' + s)).applyQuaternion(Qt);
        place('clavicle.' + s, fromTo(v0, W2B(skO.sh[s]).sub(clavP)).multiply(Qt)); local('shoulder01.' + s);
        const S = jp('upperarm01.' + s);
        const hdir = A3(skO.hand[s]).sub(A3(skO.wr[s])).normalize();
        const hd = hds[s];
        const restFa = head('wrist.' + s).sub(head('lowerarm01.' + s)).normalize(), restUa = head('lowerarm01.' + s).sub(head('upperarm01.' + s)).normalize();
        let Qh, W, gp = null, F = null;
        const poleW = A3(skO.el[s]).sub(A3(skO.sh[s]).lerp(A3(skO.wr[s]), 0.5));
        if (hd) {
          const g = solveGrip(s, hd.r / K); F = g.F;
          const a = hd.a.clone(), dirW = perp(hdir, a); if (dirW.lengthSq() < 1e-6) dirW.copy(perp(A3(skO.f), a)); dirW.normalize();
          const want = (info.grip && info.grip[s]) || info.gripType || 'overhand', med = A3(skO.side).multiplyScalar(-sg);
          // two ways to hold a handle: the hand's grip axis along +a or -a (overhand vs underhand on a bar);
          // the palm side is the one that keeps the fingers pointing the way the motion's hand points
          const cands = [1, -1].map(k => { const A = a.clone().multiplyScalar(k); let pn = A.clone().cross(dirW).normalize(), q = aim(h.gripAxis, h.pn, A, pn);
            if (h.dir.clone().applyQuaternion(q).dot(dirW) < 0) { pn.negate(); q = aim(h.gripAxis, h.pn, A, pn); }
            const th = h.thumbSide.clone().applyQuaternion(q), aMed = a.clone().multiplyScalar(Math.sign(a.dot(med)) || 1); return { q, pn, thumbMed: th.dot(aMed), palmMed: pn.dot(med) }; });
          const pick = want === 'underhand' ? (cands[0].thumbMed < cands[1].thumbMed ? 0 : 1) : want === 'neutral' ? (cands[0].palmMed > cands[1].palmMed ? 0 : 1) : (cands[0].thumbMed > cands[1].thumbMed ? 0 : 1);
          Qh = cands[pick].q;
          gp = W2B(skO.grip[s]);   // this body's grip point; the handle is moved into the hand below
          W = gp.clone().sub(g.c.clone().applyQuaternion(Qh));
        } else {
          W = W2B(skO.wr[s]);
        }
        let sol = ik2(S, W, Lr.ua, Lr.fa, poleW);
        { // keep the upper arm outside the chest (this torso is wider than the canvas mannequin's)
          const sideB = A3(skO.side).multiplyScalar(sg), upB = A3(skO.up), ctr = P.root.clone();
          const clear = e => { const r = e.clone().sub(ctr); const up = r.dot(upB); if (up < 0.05 || up > (BODY.spine - 0.02) / K) return 1; return r.dot(sideB) - 0.205 / K; };
          if (clear(sol.mid) < 0) {
            const ax = W.clone().sub(S).normalize(), base = perp(sol.mid.clone().sub(S), ax);
            let best = null;
            for (let k = 1; k <= 18; k++) for (const sgn of [1, -1]) { const q = qAxis(ax, sgn * k * 0.08), m = S.clone().add(sol.mid.clone().sub(S).applyQuaternion(q)); if (clear(m) >= 0 && !best) best = q; }
            if (best) { const m = S.clone().add(sol.mid.clone().sub(S).applyQuaternion(best)); sol = { mid: m, end: sol.end, err: sol.err }; }
          }
        }
        if (Qh) { // swivel the elbow about the shoulder-wrist line (humeral rotation) when the forearm would need an impossible twist
          const twAt = m => { const u = m.clone().sub(S).normalize(), fa = sol.end.clone().sub(m).normalize();
            const qu = aim(restUa, perp(restFa, restUa), u, perp(fa, u).add(perp(poleW, u).normalize().multiplyScalar(-0.03)));
            const qf = fromTo(restFa.clone().applyQuaternion(qu), fa).multiply(qu), t2 = twistOf(qf.clone().invert().multiply(Qh), restFa);
            return 2 * Math.acos(Math.min(1, Math.abs(t2.w))) * 180 / Math.PI; };
          const sideB = A3(skO.side).multiplyScalar(sg), ctr = P.root.clone(), clearOk = m => m.clone().sub(ctr).dot(sideB) >= 0.205 / K || m.clone().sub(ctr).dot(A3(skO.up)) < 0.05;
          const tw0 = twAt(sol.mid);
          if (tw0 > 75) {
            const ax = W.clone().sub(S).normalize(); let best = { c: tw0 - 75, m: sol.mid };
            for (let k = 1; k <= 160; k++) for (const sgn of [1, -1]) { const m = S.clone().add(sol.mid.clone().sub(S).applyQuaternion(qAxis(ax, sgn * k * 0.02)));
              if (!clearOk(m)) continue; const c = Math.max(0, twAt(m) - 75) + m.distanceTo(sol.mid) * K * 150; if (c < best.c) best = { c, m }; }
            sol = { mid: best.m, end: sol.end, err: sol.err };
          }
        }
        const uaW = sol.mid.clone().sub(S).normalize(), faW = sol.end.clone().sub(sol.mid).normalize();
        const ref = perp(faW, uaW).add(perp(poleW, uaW).normalize().multiplyScalar(-0.03));
        const Qua = aim(restUa, perp(restFa, restUa), uaW, ref);
        place('upperarm01.' + s, Qua); local('upperarm02.' + s);
        const Qfa = fromTo(restFa.clone().applyQuaternion(Qua), faW).multiply(Qua);
        place('lowerarm01.' + s, Qfa);
        if (!Qh) { const dirW = hdir.clone(), pnN = perp(h.pn.clone().applyQuaternion(Qfa), dirW).normalize(); Qh = aim(h.dir, h.pn, dirW, pnN); F = RELAXED; }
        let rot = null;
        if (hd && !(hds.L && hds.R && hds.L.i === hds.R.i)) {   // a one-hand handle (D-handle, dumbbell) turns with the hand: cap the forearm twist at 80 deg
          for (let it = 0; it < 2; it++) { const t0 = twistOf(Qfa.clone().invert().multiply(Qh), restFa), ang = 2 * Math.atan2(V3(t0.x, t0.y, t0.z).dot(restFa), t0.w), lim = 80 * Math.PI / 180;
            const a1 = Math.atan2(Math.sin(ang), Math.cos(ang)); if (Math.abs(a1) <= lim) break;
            const corr = qAxis(faW, -(a1 - Math.sign(a1) * lim)); Qh = corr.clone().multiply(Qh); rot = rot ? corr.multiply(rot) : corr; }
        }
        const tw = twistOf(Qfa.clone().invert().multiply(Qh), restFa);
        place('lowerarm02.' + s, Qfa.clone().multiply(new THREE.Quaternion().slerp(tw, 0.5)));
        place('wrist.' + s, Qh);
        setFingers(s, F);
        if (hd) {
          const gpA = B2W(jp('wrist.' + s).add(solveGrip(s, hd.r / K).c.clone().applyQuaternion(Qh)));
          held[s] = { hd, off: gpA.clone().sub(hd.p), gp: gpA, rot, a: rot ? hd.a.clone().applyQuaternion(rot) : hd.a.clone(), r: hd.r, pn: (Qh ? h.pn.clone().applyQuaternion(Qh) : null), q: Qh };
          roles[hd.i].role = held.L && held.R && held.L.hd.i === held.R.hd.i ? 'barbell.bar' : 'grip' + s + '.bar';
        }
        // legs
        const H = jp('upperleg01.' + s), An = W2B(skO.an[s]);
        const kpole = A3(skO.kn[s]).sub(A3(skO.hip[s]).lerp(A3(skO.an[s]), 0.5));
        const ls = ik2(H, An, Lr.th, Lr.sh, kpole);
        const thR = head('lowerleg01.' + s).sub(head('upperleg01.' + s)).normalize(), shR = head('foot.' + s).sub(head('lowerleg01.' + s)).normalize();
        const thW = ls.mid.clone().sub(H).normalize(), shW2 = ls.end.clone().sub(ls.mid).normalize();
        const front = perp(shW2, thW).negate().add(perp(kpole, thW).normalize().multiplyScalar(0.03));
        const Qth = aim(thR, V3(0, 0, 1), thW, front);
        place('upperleg01.' + s, Qth); local('upperleg02.' + s);
        place('lowerleg01.' + s, fromTo(shR.clone().applyQuaternion(Qth), shW2).multiply(Qth)); local('lowerleg02.' + s);
        const fd = A3(skO.fd[s]).normalize(); let upF = perp(V3(0, 1, 0), fd); if (upF.lengthSq() < 1e-4) upF = perp(A3(skO.up), fd); upF.normalize();
        place('foot.' + s, aim(V3(0, 0, 1), V3(0, 1, 0), fd, upF)); if (bones['toe1-1.' + s]) local('toe1-1.' + s);
        cur.reach = Math.max(cur.reach || 0, sol.err * K, ls.err * K);
      }
      apply();
      // equipment: shapes held in the hands move with them; cable and lever ends attach to the handle ends
      const both = held.L && held.R && held.L.hd.i === held.R.hd.i;
      const offAt = q => {
        if (both) { const a = held.L.hd.p, b = held.R.hd.p, d = b.clone().sub(a);
          if (d.lengthSq() < 1e-8) return a.distanceTo(q) > 0.3 ? null : held.L.off.clone().lerp(held.R.off, 0.5);   // both hands at one spot (goblet, landmine): move the implement with them
          const u0 = q.clone().sub(a).dot(d) / d.lengthSq(); if (a.clone().addScaledVector(d, u0).distanceTo(q) > 0.04) return null; const u = Math.max(0, Math.min(1, u0)); return held.L.off.clone().lerp(held.R.off, u); }   // only points on the bar's line (bar, sleeves, plates)
        for (const s of SIDES) if (held[s]) { const H2 = held[s].hd, d = H2.B.clone().sub(H2.A), L = d.length(); d.normalize(); const t2 = Math.max(-0.25, Math.min(L + 0.25, q.clone().sub(H2.A).dot(d))); if (H2.A.clone().addScaledVector(d, t2).distanceTo(q) < 0.04) { const hh = held[s]; if (!hh.rot) return hh.off; const p2 = q.clone().add(hh.off); return p2.sub(hh.gp).applyQuaternion(hh.rot).add(hh.gp).sub(q); } }
        return null;
      };
      const out = shapesD.map((sh, i) => {
        const o = Object.assign({}, sh);
        for (const s of SIDES) if (held[s] && held[s].hd.i === i) { o.ra = o.rb = held[s].r; }
        ['a', 'b', 'c'].forEach(k => { if (!sh[k]) return; const q = A3(sh[k]), off = offAt(q); if (off) o[k] = q.add(off).toArray(); });
        // a cable or lever ending at a handle centre: attach to the handle end (levers) or to a D-handle ring (cables)
        if ((sh.k === 'line' || sh.k === 'cap') && i !== (held.L && held.L.hd.i) && i !== (held.R && held.R.hd.i)) {
          for (const s of SIDES) { const hh = held[s]; if (!hh || both) continue;
            ['a', 'b'].forEach((k, ki) => { const q = A3(o[k]); if (q.distanceTo(hh.gp) > 0.05) return; const other = A3(o[ki ? 'a' : 'b']);
              if (sh.k === 'cap') { const ends = [hh.gp.clone().addScaledVector(hh.a, 0.075), hh.gp.clone().addScaledVector(hh.a, -0.075)]; o[k] = (ends[0].distanceTo(other) < ends[1].distanceTo(other) ? ends[0] : ends[1]).toArray(); }
              else { // the D-handle swivels: its ring points along the cable, never back through the palm
                let rd = perp(other.clone().sub(hh.gp), hh.a); rd = rd.lengthSq() > 1e-8 ? rd.normalize() : hh.pn.clone(); if (rd.dot(hh.pn) < 0.7) rd = perp(rd.addScaledVector(hh.pn, 1.2 * (0.7 - rd.dot(hh.pn))), hh.a).normalize();
                hh.ringDir = rd; o[k] = hh.gp.clone().addScaledVector(rd, 0.075).toArray(); roles[i].ring = s; }
            }); }
        }
        if (sh.k === 'box' && sh.col === 'pad') roles[i].role = roles[i].role || ('pad' + i + '.pad');
        if (sh.k === 'line' && sh.col === 'cable') roles[i].role = roles[i].role || ('cable.line' + i);
        return o;
      });
      // D-handle frames for cable handles
      SIDES.forEach(s => { const hh = held[s]; if (!hh || both || !roles.some(r => r.ring === s)) return; const ring = hh.gp.clone().addScaledVector(hh.ringDir || hh.pn, 0.075);
        [1, -1].forEach(k => { out.push({ k: 'cap', a: hh.gp.clone().addScaledVector(hh.a, k * 0.075).toArray(), b: ring.toArray(), ra: 0.007, rb: 0.007, col: 'metal' }); roles.push({ role: 'grip' + s + '.frame' }); }); });
      cur.shapes = out; cur.roles = roles; cur.held = held;
      if (cur.meshes) cur.meshes.forEach((m, i) => out[i] && setMesh(m, out[i]));
    }
    // targets for the quality checker (demo-qa page contract)
    function contacts() {
      const c = {}, h = cur.held || {};
      for (const s of SIDES) if (h[s]) {   // anchor = the point of the handle axis under the palm (where along the handle this hand holds it)
        const pw = B2W(P['wrist.' + s].clone().add(hand[s].qaGrip.clone().sub(hand[s].w).applyQuaternion(Q['wrist.' + s]))), a = h[s].a.clone().normalize();
        const pos = h[s].gp.clone().addScaledVector(a, pw.clone().sub(h[s].gp).dot(a));
        c[(h.L && h.R && h.L.hd.i === h.R.hd.i) ? 'barbell.grip' + s : 'grip' + s + '.grip'] = { shape: 'cylinder', pos: pos.toArray(), axis: a.toArray(), radius: h[s].r }; }
      c.floor = { shape: 'plane', pos: [0, 0, 0], normal: [0, 1, 0] };
      (cur.roles || []).forEach((r, i) => { if (r.role && /\.pad$/.test(r.role)) { const sh = cur.shapes[i], n = cur.padN && cur.padN[0] ? cur.padN : null; const u = sh.ax.map(A3); const toBody = B2W(P.root).sub(A3(sh.c)); let k = 0, bd = -1; u.forEach((v, j) => { const d = Math.abs(v.clone().normalize().dot(toBody)) / v.length(); if (d > bd) { bd = d; k = j; } }); const nr = u[k].clone().normalize().multiplyScalar(Math.sign(u[k].dot(toBody)) || 1); c[r.role.replace(/\.pad$/, '.surface')] = { shape: 'plane', pos: A3(sh.c).addScaledVector(nr, u[k].length()).toArray(), normal: nr.toArray() }; } });
      return c;
    }
    return { THREE, scene, gltf, skinned, meta, K, BODY, setExercise, pose: t => { posePure(t); }, contacts, get current() { return cur; }, solveGrip, setMuscles, hand };
  }

  // ---------- app part: the reviewed recipe demos (app/3d/rx), lazy loader and card painter ----------
  // Nov 3 2026: the Rotate view shows the recipe demos Aziz reviewed (the project's recipe viewer: engine.js, gear.js,
  // gear_all.js, gymkit.js, recipes.json, body.glb), copied in by tools/exercise-3d/import_recipes.py. EXERCISE_3D.recipes
  // lists them {app id: loop seconds}; exercises held back for a redo are not in it and keep the line mannequin.
  const DATA = () => root.EXERCISE_3D || { exercises: {} };
  const RX = () => DATA().recipes || {};
  const has = id => !!RX()[id] && !!(root.ExerciseAnim && root.ExerciseAnim.defs[id]);
  const VOCAB_TO_MASK = { chest_upper: 'chest', chest_mid: 'chest', chest_lower: 'chest', serratus_anterior: 'chest', delt_front: 'front_delt', delt_side: 'side_delt', delt_rear: 'rear_delt', rotator_cuff: 'rear_delt',
    traps_upper: 'upper_traps', traps_mid: 'mid_back', traps_lower: 'mid_back', rhomboids: 'mid_back', teres_major: 'lats', erector_spinae: 'lower_back', neck_front: 'neck', neck_back: 'neck',
    biceps_long: 'biceps', biceps_short: 'biceps', brachialis: 'biceps', brachioradialis: 'forearms', forearm_flexors: 'forearms', forearm_extensors: 'forearms', triceps_long: 'triceps', triceps_lateral: 'triceps',
    abs_rectus: 'abs', glute_max: 'glutes', quads_vasti: 'quads', rectus_femoris: 'quads', calves_gastrocnemius: 'calves', calves_soleus: 'calves', tibialis_anterior: 'tibialis' };
  let loading = null, gl = null, failed = false;
  const viewOff = {};
  function load() {
    if (loading) return loading;
    const base = DATA().base || './';   // relative to the page; import() needs the ./ prefix
    loading = (async () => {
      const THREE = await import(base + 'vendor/three-r160/three.module.min.js');
      const { GLTFLoader } = await import(base + 'vendor/three-r160/GLTFLoader.js');
      const E = await import(base + '3d/rx/engine.js'), G = await import(base + '3d/rx/gear.js'); await import(base + '3d/rx/gear_all.js');
      const get = (f, kind) => fetch(base + '3d/rx/' + f).then(r => { if (!r.ok) throw new Error(f + ' ' + r.status); return r[kind](); });
      const [buf, meta, recipes, cache] = await Promise.all([get('body.glb', 'arrayBuffer'), get('body_meta.json', 'json'), get('recipes.json', 'json'), get('gripcache.json', 'json').catch(() => null)]);
      const gltf = await new GLTFLoader().parseAsync(buf, base + '3d/rx/');
      const rig = new E.Rig(gltf, meta);
      if (cache && cache.verts === rig.mesh.geometry.attributes.position.count) rig.loadGripCache(cache.models);
      rig.mesh.castShadow = rig.mesh.receiveShadow = true;
      const RED = new THREE.Color('#d9392c'), AMBER = new THREE.Color('#f0a030');
      const bodyMat = new THREE.MeshStandardMaterial({ color: '#c9ccd0', roughness: 0.62, vertexColors: true });
      bodyMat.onBeforeCompile = sh => {
        sh.uniforms.uRed = { value: RED }; sh.uniforms.uAmber = { value: AMBER };
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uRed; uniform vec3 uAmber;')
          .replace('#include <color_fragment>', 'vec3 base = diffuseColor.rgb; base = mix(base, uRed, smoothstep(0.05,0.95,vColor.r)); base = mix(base, uAmber, smoothstep(0.05,0.95,vColor.g)); base = mix(base, vec3(0.62,0.64,0.67), vColor.b); diffuseColor.rgb = base;')
          .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.48, max(vColor.r, vColor.g));');
      };
      rig.mesh.material = bodyMat;
      const canvas = document.createElement('canvas');
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
      renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
      renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.setClearColor(0x000000, 0);
      const scene = new THREE.Scene(); scene.add(gltf.scene);
      scene.add(new THREE.HemisphereLight('#ffffff', '#9aa1a8', 1.15));
      const key = new THREE.DirectionalLight('#ffffff', 2.3); key.position.set(1.8, 3.8, 2.4); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
      Object.assign(key.shadow.camera, { left: -2, right: 2, top: 2.4, bottom: -1.2, near: 0.5, far: 10 }); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; scene.add(key);
      const rim = new THREE.DirectionalLight('#dfe8ff', 0.9); rim.position.set(-2.5, 2.2, -2.5); scene.add(rim);
      const floor = new THREE.Mesh(new THREE.CircleGeometry(7, 64), new THREE.ShadowMaterial({ opacity: 0.2 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
      const camera = new THREE.PerspectiveCamera(32, 1, 0.03, 40);
      gl = { THREE, E, G, rig, masks: E.muscleMasks(rig), recipes, renderer, scene, camera, canvas, cur: null, poser: null, gear: [] };
      return gl;
    })().catch(e => { failed = true; if (root.console) console.warn('Exercise3D: 3D demos unavailable', e); throw e; });
    return loading;
  }
  function setRecipe(id) {
    if (gl.cur && gl.cur.id === id) return gl.cur;
    const r = gl.recipes[id]; if (!r) return null;
    for (const p of gl.gear) gl.scene.remove(p.group);
    gl.cur = r; gl.poser = new gl.E.Poser(gl.rig, r); gl.gear = gl.G.buildGear(r, gl.scene);
    gl.gearBox = new gl.THREE.Box3(); for (const p of gl.gear) if (p.group) gl.gearBox.expandByObject(p.group);   // static frame; moving parts stay inside it
    // cable machines: sample the rep once so each weight stack knows the cable's shortest length (stack at rest)
    for (const p of gl.gear) if (p.calib) { let mn = Infinity; for (let i = 0; i < 36; i++) { p.update(gl.poser.solve(i / 36 * gl.poser.period)); mn = Math.min(mn, p.calib.last); } p.calib.Lmin = mn; }
    const toM = l => [...new Set((l || []).map(m => gl.masks[m] ? m : (VOCAB_TO_MASK[m] || m)))], pm = toM(r.muscles.primary);
    gl.E.paintMuscles(gl.rig, gl.masks, pm, toM(r.muscles.secondary).filter(m => !pm.includes(m)));
    return r;
  }
  // Draw one frame of exercise id into a 2D canvas context. Returns false while loading or when unavailable.
  // st.t is the loop phase (0..1); st.yaw / st.pitch (card drag, default 0.7 / 0.15) turn the recipe's own camera.
  function paint(ctx, w, h, id, st) {
    if (failed) return false;
    if (!gl) { load().catch(() => { }); return false; }
    const { THREE, renderer, scene, camera, canvas } = gl;
    const r = setRecipe(id); if (!r) return false;
    const out = gl.poser.solve((st.t || 0) * gl.poser.period);
    for (const p of gl.gear) p.update && p.update(out);
    const dpr = Math.min(2, root.devicePixelRatio || 1), W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (canvas.width !== W || canvas.height !== H) renderer.setSize(W, H, false);
    // card views: 3D = the recipe's own camera, Front / Side = straight views (as in the review viewer); a drag turns
    // from whichever view was showing, so the card's yaw / pitch are kept as offsets from that view
    const c = r.camera, tgt = new THREE.Vector3(...c.target), sy = st.yaw == null ? 0.7 : st.yaw, sp = st.pitch == null ? 0.15 : st.pitch;
    const pre = { '3d': c.dir, front: [0.12, 0.25, 1], side: [1, 0.25, 0.05] }[st.view || '3d'];
    const off = viewOff[id] || (viewOff[id] = {});
    if (pre || off.y == null) { const d = new THREE.Vector3(...(pre || c.dir)).normalize(); off.y = Math.atan2(d.x, d.z) - sy; off.p = Math.asin(d.y) - sp; }
    const yaw = sy + off.y, el = Math.max(-0.1, Math.min(1.35, sp + off.p));
    const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(el), Math.sin(el), Math.cos(yaw) * Math.cos(el));
    // keep the camera outside the equipment (turning used to fly it through frames and stacks): back it out of the
    // gear's box and narrow the lens by the same ratio, so the person stays the same size on screen
    let dist = c.dist; const box = gl.gearBox;
    if (box && !box.isEmpty()) { const ray = new THREE.Ray(tgt.clone().addScaledVector(dir, 40), dir.clone().negate()), hit = ray.intersectBox(box, new THREE.Vector3());
      if (hit) dist = Math.max(dist, Math.min(12, 40 - hit.distanceTo(ray.origin) + 0.35)); }
    const fov0 = 32 / Math.min(1, w / h) / (st.zoom || 1);
    camera.aspect = w / h; camera.fov = 2 * Math.atan(Math.tan(fov0 * Math.PI / 360) * c.dist / dist) * 180 / Math.PI; camera.far = dist + 20; camera.updateProjectionMatrix();
    camera.position.copy(tgt).addScaledVector(dir, dist); camera.lookAt(tgt);
    renderer.render(scene, camera);
    ctx.clearRect(0, 0, w, h);   // the 3D frame is transparent around the person: wipe the last frame first or turning leaves copies behind
    ctx.drawImage(canvas, 0, 0, w, h);
    return true;
  }
  const api = { core, has, load, paint, ids: () => Object.keys(RX()).filter(has), dur: id => RX()[id] || null, status: () => (failed ? 'failed' : gl ? 'ready' : loading ? 'loading' : 'idle'), info: id => (DATA().exercises || {})[id] || null };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Exercise3D = api;
})(typeof window !== 'undefined' ? window : globalThis);
