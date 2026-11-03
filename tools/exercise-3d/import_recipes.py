#!/usr/bin/env python3
"""Copy the reviewed recipe demos into the app.
Usage: python3 tools/exercise-3d/import_recipes.py [viewer_dir] [--hold id,id,...]
viewer_dir (default /mnt/project-files/recipes/all/viewer) is the reviewed demo viewer: engine.js, gear.js, gear_all.js,
gymkit.js, recipes.json, gripcache.json, body.glb.b64.txt, body_meta.json.
Writes app/3d/rx/ (modules with their three.js import pointed at app/vendor/three-r160, body.glb, body_meta.json,
gripcache.json, recipes.json with only the app's exercises keyed by app id) and the `recipes` map {app id: loop seconds}
in modules/exercise-3d/exercises.json. Exercises in HOLD (being redone after review) are left out and keep their old view."""
import base64, hashlib, json, os, re, sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
args = [a for a in sys.argv[1:] if not a.startswith('--')]
SRC = args[0] if args else '/mnt/project-files/recipes/all/viewer'
HOLD = {'elliptical', 'chest-supported-t-bar-row-machine', 'chest-supported-row-machine', 'reverse-hyper-machine'}   # Aziz, Nov 3: redo before shipping
for a in sys.argv[1:]:
    if a.startswith('--hold='): HOLD = {x for x in a[7:].split(',') if x}
OUT = os.path.join(ROOT, 'app', '3d', 'rx'); os.makedirs(OUT, exist_ok=True)
THREE = "'../../vendor/three-r160/three.module.min.js'"

for f in ['engine.js', 'gear.js', 'gear_all.js', 'gymkit.js']:
    s = open(os.path.join(SRC, f), encoding='utf-8').read()
    s, n = re.subn(r"from 'three';", 'from ' + THREE + ';', s)
    assert n == 1, f + ': expected one three import'
    assert "from 'three/" not in s, f + ': addon imports are not vendored'
    open(os.path.join(OUT, f), 'w', encoding='utf-8').write(s)

with open(os.path.join(SRC, 'body.glb.b64.txt')) as fh: glb = base64.b64decode(fh.read().strip())
open(os.path.join(OUT, 'body.glb'), 'wb').write(glb)
for f in ['body_meta.json', 'gripcache.json']:
    open(os.path.join(OUT, f), 'w').write(json.dumps(json.load(open(os.path.join(SRC, f))), separators=(',', ':')))

recipes = json.load(open(os.path.join(SRC, 'recipes.json'), encoding='utf-8'))
app = {}
for r in recipes:
    if not r['key'].startswith('mz-'): continue   # MoveKit-list exercises are not in the app's library yet
    aid = r['key'][3:]
    if aid in HOLD: continue
    r = dict(r, id=aid); r.pop('check', None)
    app[aid] = r
open(os.path.join(OUT, 'recipes.json'), 'w', encoding='utf-8').write(json.dumps(app, ensure_ascii=False, separators=(',', ':')))

period = lambda r: round(sum(t[1] for t in r['tempo']), 3)
p = os.path.join(ROOT, 'modules', 'exercise-3d', 'exercises.json'); d = json.load(open(p, encoding='utf-8'))
d['recipes'] = {k: period(r) for k, r in sorted(app.items())}
d['recipesSource'] = {'recipes_md5': hashlib.md5(open(os.path.join(SRC, 'recipes.json'), 'rb').read()).hexdigest()[:8], 'held': sorted(HOLD)}
open(p, 'w', encoding='utf-8').write(json.dumps(d, indent=1, ensure_ascii=False) + '\n')
print(f'{len(app)} app exercises, held {sorted(HOLD)}, body {len(glb)/1e6:.1f} MB')
