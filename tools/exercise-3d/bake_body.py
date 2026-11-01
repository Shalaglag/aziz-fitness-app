"""Turn the body-model v2 glb (body-model/out200/body_<build>.glb, 200k tris, CC0 MakeHuman) into the app body:
- one skinned primitive (eyes merged in), muscle ids baked per vertex from regions.png into _MUSCLE
  (r = vocabulary index + 1, 0 = none; g = membership 0..255; b = 255 for eyes; a = 255 for the body's left side),
- normals and tangents as normalized int8, UV as normalized uint16 (KHR_mesh_quantization), for the look-A normal map.
Usage: python3 bake_body.py in.glb body_meta.json regions.png out.glb out_meta.json"""
import json, struct, sys, numpy as np
from PIL import Image
inp, metap, regp, outp, outmeta = sys.argv[1:6]
b = open(inp, 'rb').read()
L = struct.unpack('<I', b[12:16])[0]; js = json.loads(b[20:20 + L])
blob = b[20 + L + 8:]
CT = {5126: np.float32, 5121: np.uint8, 5123: np.uint16, 5125: np.uint32}; NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
def acc(i):
    a = js['accessors'][i]; v = js['bufferViews'][a['bufferView']]
    return np.frombuffer(blob, CT[a['componentType']], a['count'] * NC[a['type']], v.get('byteOffset', 0) + a.get('byteOffset', 0)).reshape(a['count'], NC[a['type']]).copy()
prims = js['meshes'][0]['primitives']
body, eyes = prims[0], (prims[1] if len(prims) > 1 else None)
P = acc(body['attributes']['POSITION']); N = acc(body['attributes']['NORMAL']); J = acc(body['attributes']['JOINTS_0']); W = acc(body['attributes']['WEIGHTS_0'])
UV = acc(body['attributes']['TEXCOORD_0']); TG = acc(body['attributes']['TANGENT']); I = acc(body['indices']).ravel().astype(np.uint32)
# muscle ids from the region map (nearest texel), membership = share of nearby texels with the same id
img = np.array(Image.open(regp).convert('RGB'))[:, :, 0].astype(np.int32); S = img.shape[0]
rid = lambda u, v: img[np.clip((v * S).astype(int), 0, S - 1), np.clip((u * S).astype(int), 0, S - 1)] // 3
u, v = UV[:, 0], UV[:, 1]   # glTF UV: v down, same as image rows
c = rid(u, v); same = np.zeros(len(u))
for du, dv in [(-1.5, 0), (1.5, 0), (0, -1.5), (0, 1.5)]: same += rid(u + du / S, v + dv / S) == c
memb = np.where(c > 0, (1 + same) / 5, 0)
vidx = np.where(c > 0, (c - 1) // 2 + 1, 0); left = np.where(c > 0, (c - 1) % 2 == 0, P[:, 0] >= 0)
M = np.stack([vidx, np.round(memb * 255), np.zeros(len(u)), np.where(left, 255, 0)], 1).astype(np.uint8)
if eyes is not None:
    Pe = acc(eyes['attributes']['POSITION']); Ne = acc(eyes['attributes']['NORMAL']); Je = acc(eyes['attributes']['JOINTS_0']); We = acc(eyes['attributes']['WEIGHTS_0']); Ie = acc(eyes['indices']).ravel().astype(np.uint32)
    Me = np.zeros((len(Pe), 4), np.uint8); Me[:, 2] = 255; Me[:, 3] = np.where(Pe[:, 0] >= 0, 255, 0)
    UVe = np.zeros((len(Pe), 2)); TGe = np.tile([1.0, 0, 0, 1], (len(Pe), 1))
    UV = np.concatenate([UV, UVe]); TG = np.concatenate([TG, TGe])
    I = np.concatenate([I, Ie + len(P)]); P = np.concatenate([P, Pe]); N = np.concatenate([N, Ne]); J = np.concatenate([J, Je]); W = np.concatenate([W, We]); M = np.concatenate([M, Me])
Nq = np.round(np.clip(N / np.maximum(1e-9, np.linalg.norm(N, axis=1, keepdims=True)), -1, 1) * 127).astype(np.int8)
Nq = np.concatenate([Nq, np.zeros((len(Nq), 1), np.int8)], 1)   # pad to 4 bytes per vertex
# rebuild buffer: keep skin inverse bind matrices, new mesh attributes
ibm = acc(js['skins'][0]['inverseBindMatrices'])
parts, views, accs = [], [], []
def add(arr, ctype, typ, target=None, normalized=False, minmax=False, count=None):
    off = sum(len(p) for p in parts); data = arr.tobytes(); pad = (-len(data)) % 4
    parts.append(data + b'\0' * pad); vw = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data)}
    if target: vw['target'] = target
    views.append(vw); a = {'bufferView': len(views) - 1, 'componentType': ctype, 'count': count or len(arr), 'type': typ}
    if normalized: a['normalized'] = True
    if minmax: a['min'] = arr.min(0).tolist(); a['max'] = arr.max(0).tolist()
    accs.append(a); return len(accs) - 1
attrs = {'POSITION': add(P.astype(np.float32), 5126, 'VEC3', 34962, minmax=True),
         'NORMAL': None, 'JOINTS_0': add(J.astype(np.uint8), 5121, 'VEC4', 34962), 'WEIGHTS_0': add(W.astype(np.uint8), 5121, 'VEC4', 34962, normalized=True),
         '_MUSCLE': add(M, 5121, 'VEC4', 34962, normalized=True)}
# int8 normals need VEC3 with byteStride 4: write as a strided view
off = sum(len(p) for p in parts); parts.append(Nq.tobytes()); views.append({'buffer': 0, 'byteOffset': off, 'byteLength': Nq.nbytes, 'byteStride': 4, 'target': 34962})
accs.append({'bufferView': len(views) - 1, 'componentType': 5120, 'normalized': True, 'count': len(Nq), 'type': 'VEC3'}); attrs['NORMAL'] = len(accs) - 1
attrs['TEXCOORD_0'] = add(np.round(np.clip(UV, 0, 1) * 65535).astype(np.uint16), 5123, 'VEC2', 34962, normalized=True)
attrs['TANGENT'] = add(np.round(np.clip(TG, -1, 1) * 127).astype(np.int8), 5120, 'VEC4', 34962, normalized=True)
ind = add(I, 5125, 'SCALAR', 34963)
ibmA = add(ibm.astype(np.float32), 5126, 'MAT4')
js['meshes'][0]['primitives'] = [{'attributes': attrs, 'indices': ind}]
js['skins'][0]['inverseBindMatrices'] = ibmA
for k in ('materials', 'textures', 'images', 'samplers'): js.pop(k, None)
js['extensionsUsed'] = ['KHR_mesh_quantization']; js['extensionsRequired'] = ['KHR_mesh_quantization']
js['accessors'] = accs; js['bufferViews'] = views
bin_ = b''.join(parts); js['buffers'] = [{'byteLength': len(bin_)}]
j = json.dumps(js, separators=(',', ':')).encode(); j += b' ' * ((-len(j)) % 4)
out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(j) + 8 + len(bin_)) + struct.pack('<I', len(j)) + b'JSON' + j + struct.pack('<I', len(bin_)) + b'BIN\0' + bin_
open(outp, 'wb').write(out)
meta = json.load(open(metap)); keep = {k: meta[k] for k in ('bones', 'parents', 'heads', 'tails', 'tris_body', 'tris_eyes', 'verts') if k in meta}
keep['verts'] = int(len(P)); import csv; keep['muscles'] = [r['id'] for r in csv.DictReader(open(sys.argv[6]))] if len(sys.argv) > 6 else [r['key'] for r in meta['regions'] if r['side'] == 'L']   # r - 1 indexes this list
keep['licence'] = 'MakeHuman base mesh, targets, rig and weights: CC0 (makehumancommunity/mpfb2).'
json.dump(keep, open(outmeta, 'w'), indent=1)
print('verts', len(P), 'tris', len(I) // 3, 'bytes', len(out), 'muscle verts', int((M[:, 0] > 0).sum()))
