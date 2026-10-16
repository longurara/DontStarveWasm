"""Prepare content-addressed original-script packs; never edit game files."""
import collections
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import sys
import zipfile

ROOT=Path(__file__).resolve().parents[1]
GAME=ROOT.parent
OUT=ROOT/'public/generated'

def digest(data): return hashlib.sha256(data).hexdigest()

def deterministic_zip(files):
    buffer=io.BytesIO()
    with zipfile.ZipFile(buffer,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
        for name,data in sorted(files.items()):
            info=zipfile.ZipInfo(name,(1980,1,1,0,0,0)); info.compress_type=zipfile.ZIP_DEFLATED
            z.writestr(info,data)
    return buffer.getvalue()

def main():
    assert (GAME/'version.txt').read_text().strip()=='756039','Unsupported game build'
    OUT.mkdir(parents=True,exist_ok=True)
    packs=OUT/'packs'; packs.mkdir(exist_ok=True)
    with zipfile.ZipFile(GAME/'data/databundles/scripts.zip') as z:
        scripts={i.filename:z.read(i) for i in z.infolist() if i.filename.endswith('.lua')}
    for name in scripts:
        path=PurePosixPath(name)
        assert not path.is_absolute() and '..' not in path.parts
    needed=set()
    def include(name):
        path='scripts/'+name+'.lua'
        if path in needed or path not in scripts: return
        needed.add(path)
        text=scripts[path].decode('utf8','replace')
        for module in re.findall(r'''\brequire\s*\(?\s*["']([^"']+)["']''',text): include(module)
    for name in ['class','util','vecutil','vector3','scheduler','entityscript','json','components/finiteuses','components/timer']:
        include(name)
    # Preserve the complete original file for browser lifecycle conformance.
    # The diagnostic probe executes only its two original callback definitions;
    # it does not require this module or bypass its full bootstrap dependencies.
    needed.add('scripts/mainfunctions.lua')
    boot={name:scripts[name] for name in needed}
    bindings=json.loads((GAME/'analysis/output/dontstarve_steam_x64.json').read_text())
    registry=['-- Generated known binding declarations; implementations throw until available.']
    for group in bindings['engine_binding_groups']:
        target={'Sim':'TheSim','NetworkProxy':'TheNet','InputProxy':'TheInputProxy','InventoryProxy':'TheInventory','SystemService':'TheSystemService','GameService':'TheGameService','HapticsLuaProxy':'TheHaptics'}.get(group['class_candidate'],group['class_candidate'])
        registry.append(f'{target} = {target} or {{}}')
        registry.append(f'do local methods = type({target}) == "userdata" and getmetatable({target}).__index or {target}')
        for method in group['methods']:
            name=method['name']; label=group['class_candidate']+'.'+name
            registry.append(f'if rawget(methods, {json.dumps(name)}) == nil then methods[{json.dumps(name)}] = function() error({json.dumps("UNIMPLEMENTED_NATIVE: "+label)}, 2) end end')
        registry.append('end')
    boot['compat/native_registry.lua']='\n'.join(registry).encode()
    for path in (ROOT/'compat').glob('*.lua'): boot['compat/'+path.name]=path.read_bytes()
    manifest=dict(gameBuild='756039',engineVersion='0.1.0',schemaVersion=1,
                  originalScriptsSha256=digest((GAME/'data/databundles/scripts.zip').read_bytes()),
                  packs=[],files={},coverage={})
    def pack(label,files):
        data=deterministic_zip(files); sha=digest(data); filename=sha+'.zip'
        (packs/filename).write_bytes(data)
        manifest['packs'].append(dict(label=label,sha256=sha,url='packs/'+filename,bytes=len(data),files=len(files)))
        for path,contents in files.items():
            manifest['files'][path]=dict(sha256=digest(contents),bytes=len(contents),pack=sha)
        return sha
    manifest['bootPack']=pack('boot',boot)
    buckets=collections.defaultdict(dict)
    for name,data in scripts.items():
        if name not in needed:
            bucket=name.split('/')[1] if name.count('/')>1 else 'root'
            buckets[bucket][name]=data
    for label,files in sorted(buckets.items()): pack(label,files)
    for category in ['prefabs','components','stategraphs','brains','map']:
        manifest['coverage'][category]=sorted(n for n in scripts if n.startswith('scripts/'+category+'/'))
    canonical=json.dumps(manifest,sort_keys=True,separators=(',',':')).encode()
    manifest['contentHash']=digest(canonical)
    (OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf8')
    (OUT/'bindings.json').write_text(json.dumps([dict(className=g['class_candidate'],methods=[m['name'] for m in g['methods']]) for g in bindings['engine_binding_groups']],indent=2))
    print('Prepared',len(scripts),'original Lua files;',len(boot),'boot files;',len(manifest['packs']),'packs')
    print('Content hash',manifest['contentHash'])

def finalize_engine():
    path=OUT/'manifest.json'
    if not path.exists(): raise SystemExit('Run tools/prepare.py before building')
    manifest=json.loads(path.read_text(encoding='utf8'))
    inputs=sorted(str(p.relative_to(ROOT)).replace('\\','/') for p in (ROOT/'engine').glob('*') if p.suffix in ['.c','.cpp','.hpp'])
    inputs+=['CMakeLists.txt','toolchain.lock.json']
    inputs+=sorted(str(p.relative_to(ROOT)).replace('\\','/') for p in (ROOT/'src').glob('*') if p.suffix in ['.ts','.mjs'])
    manifest['engineSourceHash']=digest(b''.join(name.encode()+b'\0'+(ROOT/name).read_bytes() for name in inputs))
    manifest['engineWasmSha256']=digest((OUT/'engine/engine.wasm').read_bytes())
    resource_reference=OUT/'resources/index.json'
    if resource_reference.exists():
        reference=json.loads(resource_reference.read_text(encoding='utf8'))
        if reference['gameBuild']!='756039' or reference['schemaVersion']!=1:raise ValueError('Incompatible resource index')
        if digest((OUT/reference['url']).read_bytes())!=reference['sha256']:raise ValueError('Resource index hash mismatch')
        manifest['resources']=reference
    # Bind converted bank metadata (and through it every FLAC/PCM hash) into
    # session compatibility. Conversion is resumable; incomplete banks are absent.
    audio_files=sorted((OUT/'audio/banks').glob('*.json')) if (OUT/'audio/banks').exists() else []
    catalog=OUT/'audio/native-catalog.json'
    sample_index=OUT/'audio/sample-index.json'
    manifest['audio']={
        'banks':{p.stem:dict(url='audio/banks/'+p.name,sha256=digest(p.read_bytes())) for p in audio_files},
        'catalogSha256':digest(catalog.read_bytes()) if catalog.exists() else None,
        'sampleIndexSha256':digest(sample_index.read_bytes()) if sample_index.exists() else None,
    }
    manifest.pop('contentHash',None)
    manifest['contentHash']=digest(json.dumps(manifest,sort_keys=True,separators=(',',':')).encode())
    path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf8')
    print('Final engine/content hash',manifest['contentHash'])

if __name__=='__main__': main()
