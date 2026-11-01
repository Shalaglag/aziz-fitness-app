"""Paint 37 named muscles (research vocabulary) onto the shared MakeHuman body.
Input body.glb (from bench-3d-demo/build_body.py) -> output body.glb with a _MUSCLE vertex attribute:
  r = muscle index (1..37, 0 = none), g = membership 0..1, b = eye flag, a = side (255 = body's left).
Usage: python3 paint.py in.glb body_meta.json vocabulary.csv out.glb out_muscles.json"""
import json, struct, sys, csv, numpy as np
inp, metap, vocp, outp, outm = sys.argv[1:6]
b = open(inp, 'rb').read()
L = struct.unpack('<I', b[12:16])[0]; js = json.loads(b[20:20 + L])
binoff = 20 + L + 8; blob = bytearray(b[binoff:binoff + struct.unpack('<I', b[20 + L:24 + L])[0]])
CT = {5126: np.float32, 5121: np.uint8, 5125: np.uint32}; NC = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
def acc(i):
    a = js['accessors'][i]; v = js['bufferViews'][a['bufferView']]
    arr = np.frombuffer(blob, CT[a['componentType']], a['count'] * NC[a['type']], v.get('byteOffset', 0) + a.get('byteOffset', 0))
    return arr.reshape(a['count'], NC[a['type']]).astype(np.float64 if a['componentType'] == 5126 else np.int64)
at = js['meshes'][0]['primitives'][0]['attributes']
P = acc(at['POSITION']); N = acc(at['NORMAL']); J = acc(at['JOINTS_0']); Wt = acc(at['WEIGHTS_0']) / 255.0; C0 = acc(at['COLOR_0'])
meta = json.load(open(metap)); H = {k: np.array(v) for k, v in meta['heads'].items()}; bones = meta['bones']
voc = [r['id'] for r in csv.DictReader(open(vocp))]
n = len(P); x, y, z = P.T; ax = np.abs(x); side = (x >= 0)
Mp = P.copy(); Mp[:, 0] = ax                      # mirrored to the left side
Nm = N.copy(); Nm[:, 0] = np.where(side, N[:, 0], -N[:, 0])
nx, ny, nz = Nm.T
eye = C0[:, 2] > 127
def ss(e0, e1, v):
    t = np.clip((v - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)
def band(v, a, b, s=0.01): return ss(a - s, a + s, v) * (1 - ss(b - s, b + s, v))
def wsum(names):
    s = np.zeros(n)
    for nm in names:
        for k in (nm, nm + '.L', nm + '.R'):
            if k in bones: s += np.where(J == bones.index(k), Wt, 0).sum(1)
    return np.clip(s, 0, 1)
def limb(a, bb, front):
    A, B = H[a + '.L'], H[bb + '.L']; u = B - A; Ln = np.linalg.norm(u); u /= Ln
    t = (Mp - A) @ u / Ln; r = Mp - (A + np.outer(t * Ln, u))
    f = np.array(front, float); f -= u * (f @ u); f /= np.linalg.norm(f)
    l = np.cross(u, f); l = l if l[0] > 0 else -l       # outward (lateral)
    phi = np.degrees(np.arctan2(r @ l, r @ f))             # 0 front, +90 lateral, +-180 back, -90 medial
    return t, phi, np.linalg.norm(r, axis=1)
def arc(phi, a, b, s=12):   # phi window [a,b] in degrees, may wrap past 180
    if b > 180: return np.maximum(arc(phi, a, 180, s), arc(phi, -180, b - 360, s))
    if a < -180: return np.maximum(arc(phi, a + 360, 180, s), arc(phi, -180, b, s))
    return ss(a - s, a + s, phi) * (1 - ss(b - s, b + s, phi))
m = {}
# ---------- arms ----------
uaW = wsum(['upperarm01', 'upperarm02']); faW = wsum(['lowerarm01', 'lowerarm02']); shW = wsum(['shoulder01'])
t, phi, _ = limb('upperarm01', 'lowerarm01', [0, 0, 1])
arm = uaW * band(t, 0.18, 0.9, 0.04)
m['biceps_long'] = arm * arc(phi, 0, 62, 8)
m['biceps_short'] = arm * arc(phi, -62, 0, 8)
m['brachialis'] = uaW * band(t, 0.5, 0.92, 0.04) * arc(phi, 62, 105, 8)
m['triceps_lateral'] = uaW * band(t, 0.2, 0.9, 0.04) * arc(phi, 105, 185, 8)
m['triceps_long'] = uaW * band(t, 0.14, 0.82, 0.04) * arc(phi, 185, 298, 8)
# deltoid cap: shoulder region above the upper third of the arm, outside the torso
dz = (shW + wsum(['upperarm01'])) * ss(0.135, 0.16, ax) * (1 - ss(0.32, 0.42, t)) * ss(H['upperarm01.L'][1] - 0.2, H['upperarm01.L'][1] - 0.14, y)
m['delt_front'] = dz * arc(phi, -70, 38, 10) * ss(-0.02, 0.0, z - 0.0)
m['delt_side'] = dz * arc(phi, 38, 128, 10)
m['delt_rear'] = dz * arc(phi, 128, 250, 10) * ss(-0.0, 0.02, -z + 0.03)
t2, phi2, _ = limb('lowerarm01', 'wrist', [-1, 0, 0])     # front = palm side (inward in the rest pose)
fa = faW * band(t2, 0.04, 0.85, 0.04)
m['brachioradialis'] = fa * (1 - ss(0.5, 0.62, t2)) * arc(phi2, 20, 95, 10)  # thumb side, upper half
m['forearm_flexors'] = fa * arc(phi2, -100, 20, 10) * (1 - m['brachioradialis'])
m['forearm_extensors'] = fa * arc(phi2, 95, 260, 10) * (1 - m['brachioradialis'])
# ---------- torso ----------
torsoW = wsum(['spine01', 'spine02', 'spine03', 'spine04', 'spine05', 'clavicle', 'neck01', 'root', 'pelvis'])
clav = H['clavicle.L']; chest = H['spine01']; shj = H['upperarm01.L']
ytop = clav[1] - 0.012; ylow = (chest[1] - 0.115) + 0.5 * ax
pec = (ss(-0.05, 0.25, nz) * ss(ylow - 0.012, ylow + 0.02, y) * (1 - ss(ytop - 0.03, ytop, y))
       * (1 - ss(shj[0] * 0.86, shj[0] * 0.98, ax)) * ss(0.004, 0.016, ax)) * (z > chest[2] - 0.0)
pspan = (y - ylow) / np.maximum(ytop - ylow, 1e-3)
m['chest_upper'] = pec * ss(0.62, 0.68, pspan)
m['chest_lower'] = pec * (1 - ss(0.28, 0.34, pspan))
m['chest_mid'] = pec * ss(0.28, 0.34, pspan) * (1 - ss(0.62, 0.68, pspan))
front = ss(0.15, 0.45, nz); back = ss(0.15, 0.45, -nz); outw = ss(0.2, 0.5, nx)
m['abs_rectus'] = front * (1 - ss(0.07, 0.085, ax)) * band(y, 0.12, chest[1] - 0.12, 0.015) * (1 - pec)
m['obliques'] = torsoW * ss(0.075, 0.095, ax) * band(y, 0.14, 0.38, 0.02) * ss(-0.2, 0.2, nz + 0.6) * ss(-0.1, 0.25, nx + 0.3 * nz) * (1 - pec) * (z > -0.07)
m['serratus_anterior'] = torsoW * outw * band(y, 0.38, 0.5, 0.012) * band(z, -0.02, 0.09, 0.01) * (1 - pec) * ss(0.11, 0.13, ax)
m['hip_flexors'] = front * band(y, 0.02, 0.11, 0.012) * band(ax, 0.045, 0.125, 0.01) * (1 - m['abs_rectus'])
m['erector_spinae'] = back * (1 - ss(0.055, 0.07, ax)) * band(y, 0.11, 0.42, 0.02)
m['lats'] = back * band(y, 0.28, 0.5, 0.02) * band(ax, 0.06, 0.18, 0.012) * ss(0.0, 0.02, 0.08 + (y - 0.28) * 0.8 - ax + 0.04) * (1 - m['erector_spinae'])
m['lats'] = np.maximum(m['lats'], torsoW * outw * back * band(y, 0.36, 0.5, 0.02) * ss(0.12, 0.14, ax))
m['teres_major'] = back * band(y, 0.47, 0.53, 0.008) * band(ax, 0.105, 0.16, 0.008)
m['rotator_cuff'] = back * band(y, 0.5, 0.575, 0.008) * band(ax, 0.075, 0.135, 0.008)
m['rhomboids'] = back * band(y, 0.47, 0.565, 0.008) * band(ax, 0.022, 0.07, 0.006)
m['traps_lower'] = back * band(y, 0.38, 0.5, 0.01) * (1 - ss(-0.005, 0.005, ax - (0.015 + (y - 0.38) * 0.65)))
m['traps_mid'] = back * band(y, 0.5, 0.61, 0.008) * (1 - ss(0.125, 0.14, ax))
m['traps_upper'] = torsoW * ss(0.61, 0.625, y) * (1 - ss(0.68, 0.7, y)) * band(ax, 0.035, 0.165, 0.01) * ss(-0.2, 0.1, ny - nz * 0.6)
m['neck_back'] = back * band(y, 0.66, 0.78, 0.01) * (1 - ss(0.04, 0.05, ax))
m['neck_front'] = ss(0.1, 0.4, nz) * band(y, 0.63, 0.74, 0.01) * band(ax, 0.008, 0.05, 0.006)
# ---------- hips and legs ----------
thW = wsum(['upperleg01', 'upperleg02']); lgW = wsum(['lowerleg01', 'lowerleg02'])
m['glute_max'] = back * band(y, -0.09, 0.15, 0.02) * band(ax, 0.01, 0.17, 0.01) * (1 - ss(-0.09, -0.07, -y - 0.0 + 0.0) * 0)
m['glute_med'] = outw * band(y, 0.05, 0.19, 0.012) * ss(0.12, 0.14, ax) * (1 - ss(0.05, 0.25, -nz - 0.3)) * (1 - m['obliques'])
t, phi, _ = limb('upperleg01', 'lowerleg01', [0, 0, 1])
thigh = thW * band(t, 0.04, 0.96, 0.03) * (1 - m['glute_max'])
m['rectus_femoris'] = thigh * arc(phi, -16, 16, 6) * band(t, 0.08, 0.82, 0.04)
m['quads_vasti'] = thigh * np.maximum(arc(phi, 16, 110, 8), arc(phi, -78, -16, 8)) * band(t, 0.18, 0.96, 0.04)
m['quads_vasti'] = np.maximum(m['quads_vasti'], thigh * arc(phi, -16, 16, 6) * ss(0.8, 0.86, t) * (1 - ss(0.9, 0.95, t)))
m['adductors'] = thigh * arc(phi, -150, -78, 8) * (1 - ss(0.72, 0.8, t))
m['hamstrings'] = thigh * arc(phi, 110, 210, 10) * band(t, 0.08, 0.92, 0.04)
t, phi, _ = limb('lowerleg01', 'foot', [0, 0, 1])
shin = lgW * band(t, 0.02, 0.9, 0.03)
m['calves_gastrocnemius'] = shin * arc(phi, 112, 248, 10) * (1 - ss(0.5, 0.58, t))
m['calves_soleus'] = shin * arc(phi, 95, 265, 10) * ss(0.5, 0.58, t) * (1 - ss(0.78, 0.86, t))
m['tibialis_anterior'] = shin * arc(phi, 8, 72, 8) * band(t, 0.08, 0.78, 0.04)
assert set(m) == set(voc), set(voc) ^ set(m)
M = np.stack([m[k] for k in voc], 1); M[eye] = 0
ids = np.where(M.max(1) > 0.02, M.argmax(1) + 1, 0); w = np.clip(M.sum(1), 0, 1); w[ids == 0] = 0
out = np.stack([ids, np.round(w * 255), np.where(eye, 255, 0), np.where(side, 255, 0)], 1).astype(np.uint8)
# drop COLOR_0, add _MUSCLE
while len(blob) % 4: blob.append(0)
off = len(blob); blob.extend(out.tobytes())
js['bufferViews'].append({'buffer': 0, 'byteOffset': off, 'byteLength': out.nbytes, 'target': 34962})
js['accessors'].append({'bufferView': len(js['bufferViews']) - 1, 'componentType': 5121, 'normalized': True, 'count': n, 'type': 'VEC4'})
at['_MUSCLE'] = len(js['accessors']) - 1; del at['COLOR_0']
js['buffers'][0]['byteLength'] = len(blob)
js['asset']['generator'] = 'mizan paint.py (muscle ids from exercise-research/muscle-vocabulary.csv)'
jb = json.dumps(js, separators=(',', ':')).encode(); jb += b' ' * (-len(jb) % 4)
while len(blob) % 4: blob.append(0)
glb = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(jb) + 8 + len(blob)) + struct.pack('<II', len(jb), 0x4E4F534A) + jb + struct.pack('<II', len(blob), 0x004E4942) + bytes(blob)
open(outp, 'wb').write(glb)
cnt = {k: int((ids == i + 1).sum()) for i, k in enumerate(voc)}
json.dump({'muscles': voc, 'vertexCount': cnt}, open(outm, 'w'), indent=1)
print(len(glb), sorted(cnt.items(), key=lambda kv: kv[1])[:6], sum(v for v in cnt.values()), n)
