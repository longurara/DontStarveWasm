import hashlib
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
GAME=ROOT.parent
for name in ['dontstarve_steam_x64','dontstarve_dedicated_server_nullrenderer_x64','dontstarve_steam']:
    reference=json.loads((GAME/'analysis/output'/f'{name}.json').read_text(encoding='utf8'))
    current=hashlib.sha256((GAME/reference['file']).read_bytes()).hexdigest()
    if current!=reference['sha256']:raise SystemExit('Original binary changed: '+reference['file'])
manifest=ROOT/'public/generated/manifest.json'
if manifest.exists():
    reference=json.loads(manifest.read_text(encoding='utf8'))
    if hashlib.sha256((GAME/'data/databundles/scripts.zip').read_bytes()).hexdigest()!=reference['originalScriptsSha256']:
        raise SystemExit('Original scripts.zip changed')
print('Original executables and scripts archive match recorded hashes.')
