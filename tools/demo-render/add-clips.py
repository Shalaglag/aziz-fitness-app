#!/usr/bin/env python3
"""Adds reviewed Blender clips to the app: copies each MP4 into app/clips/ and writes its record into
modules/exercise-anim/clips.json (status 'preview'; only Aziz moves a clip to 'approved').
Usage: python3 tools/demo-render/add-clips.py <dir-with-mp4s> <spec.json> [notes.json]
notes.json: { "<exercise-id>": { "notes": "...", "primary": [...], "secondary": [...] } } overrides what was actually rendered."""
import hashlib, json, os, shutil, sys
src, spec_path = sys.argv[1], sys.argv[2]
notes = json.load(open(sys.argv[3])) if len(sys.argv) > 3 else {}
root = os.path.join(os.path.dirname(__file__), '..', '..')
clips_path = os.path.join(root, 'modules/exercise-anim/clips.json')
data = json.load(open(clips_path))
spec = {e['id']: e for e in json.load(open(spec_path))['exercises']}
for f in sorted(os.listdir(src)):
    if not f.endswith('.mp4'): continue
    i = f[:-4]
    if i not in spec: print('skip (not in spec):', i); continue
    shutil.copy(os.path.join(src, f), os.path.join(root, 'app/clips', f))
    b = open(os.path.join(root, 'app/clips', f), 'rb').read()
    s, n = spec[i], notes.get(i, {})
    rec = dict(file=f, bytes=len(b), sha256=hashlib.sha256(b).hexdigest(), revision='v4', status='preview', reviewedBy=None, reviewedAt=None,
               width=1080, height=1080, fps=30, seconds=6.8, reps=2,
               primary=n.get('primary', s['primary']), secondary=n.get('secondary', s['secondary']), camera=n.get('camera', s['camera']),
               source="Own Blender 4.5 render (3D mannequin, generated muscle shapes, props and motion taken from this app's exercise-anim keyframes)",
               licence='Own work. Body base mesh and assets from MPFB 2 (CC0); nothing third-party or paid')
    if n.get('notes'): rec['notes'] = n['notes']
    data['clips'][i] = rec
    print('added', i, len(b))
json.dump(data, open(clips_path, 'w'), indent=2); open(clips_path, 'a').write('\n')
