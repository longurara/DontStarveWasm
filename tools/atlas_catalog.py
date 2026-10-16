"""Independent ElementTree/float32 oracle for original, hash-verified atlases."""
from contextlib import ExitStack
import hashlib
import json
from pathlib import Path
import struct
import xml.etree.ElementTree as ET
import zipfile

ROOT=Path(__file__).resolve().parents[1]
def digest(data):return hashlib.sha256(data).hexdigest()
def string_id(text):
    value=0
    for byte in text.encode('utf8'):
        if not byte:break
        byte=byte+32 if 65<=byte<=90 else byte
        value=(value*65599+(byte if byte<128 else byte-256))&0xffffffff
    return value
def main():
    manifest=json.loads((ROOT/'public/generated/manifest.json').read_text())
    # prepare.py creates a script-only manifest before build.py finalizes it.
    # The packer's own verified reference is available at that stage already.
    reference=json.loads((ROOT/'public/generated/resources/index.json').read_text())
    if manifest['gameBuild']!=reference['gameBuild'] or reference['gameBuild']!='756039':raise ValueError('Atlas game build mismatch')
    raw=(ROOT/'public/generated'/reference['url']).read_bytes()
    if digest(raw)!=reference['sha256']:raise ValueError('Resource index fingerprint mismatch')
    index=json.loads(raw);output=ROOT/'output';inputs=output/'atlas-inputs';inputs.mkdir(exist_ok=True)
    cases=[];archives={};sources={};map_layers=[]
    with ExitStack() as stack:
        for path,file in sorted(index['files'].items()):
            if not path.endswith('.xml'):continue
            source=file['source']
            if ':' in source:
                archive,name=source.split(':',1)
                if archive not in archives:
                    payload=(ROOT.parent/archive).read_bytes();fingerprint=digest(payload)
                    if fingerprint!=index['sources'][archive]:raise ValueError('Original archive changed: '+archive)
                    sources[archive]=fingerprint
                    archives[archive]=stack.enter_context(zipfile.ZipFile(ROOT.parent/archive))
                xml=archives[archive].read(name)
            else:
                xml=(ROOT.parent/source).read_bytes()
            if digest(xml)!=file['sha256']:raise ValueError('XML source mismatch: '+path)
            try:root=ET.fromstring(xml)
            except ET.ParseError:continue
            if root.tag!='Atlas':continue
            texture=root.find('Texture').attrib['filename'];rows=[]
            for element in root.findall('Elements/Element'):
                attrs=element.attrib;row=dict(name=attrs['name'],id=string_id(attrs['name']))
                row.update({key:struct.unpack('<f',struct.pack('<f',float(attrs[key])))[0] for key in ['u1','v1','u2','v2']})
                rows.append(row)
            if path in ['levels/tiles/forest.xml','levels/tiles/grass.xml']:
                groups=[[] for _ in range(48)]
                for row in rows:
                    name=int(row['name'])
                    if name==17:continue
                    if name>16:name-=1
                    if not 1<=name<=48:raise ValueError('Invalid map atlas numeric element')
                    groups[name-1].append(row)
                uv=b''.join(struct.pack('<I',len(group))+b''.join(struct.pack('<4f',*(row[key] for key in ['u1','v1','u2','v2'])) for row in group) for group in groups)
                map_layers.append(dict(path=path,sourceSha256=file['sha256'],shapeCount=min(48,len(rows)),uvCounts=[len(group) for group in groups],uvSha256=digest(uv)))
            # Canonical content order for the independent parser. Native equal
            # ID ordering is a separate memory oracle, not Python's stable sort.
            rows.sort(key=lambda row:(row['id'],*(row[key] for key in ['u1','v1','u2','v2'])))
            transcript=b''.join(struct.pack('<I4f',row['id'],*(row[key] for key in ['u1','v1','u2','v2'])) for row in rows)
            filename='atlas-inputs/'+file['sha256']+'.xml';(output/filename).write_bytes(xml)
            cases.append(dict(path=path,source=source,sha256=file['sha256'],xml=filename,texture=str(Path(path).parent/texture).replace('\\','/'),elements=rows,canonicalUvSha256=digest(transcript)))
    report=dict(gameBuild='756039',resourceIndexSha256=reference['sha256'],generatorSha256=digest(Path(__file__).read_bytes()),sources=sources,cases=cases)
    (output/'atlas-catalog.json').write_text(json.dumps(report,separators=(',',':')),encoding='utf8')
    map_report=dict(gameBuild='756039',generatorSha256=report['generatorSha256'],resourceIndexSha256=reference['sha256'],nativeVerified=False,cases=map_layers)
    native_file=output/'native-reference/entity-flags.json'
    if native_file.exists():
        native_bytes=native_file.read_bytes();native=json.loads(native_bytes)
        if 'mapLayerManager' in native:
            attempt=json.loads((output/'native-reference/attempt.json').read_text())
            recorded=next((value for key,value in attempt['fixtureSha256'].items() if key.replace('\\','/')=='output/native-reference/entity-flags.json'),None)
            if not attempt['oracleComplete'] or attempt['entityCaptureError'] is not None or recorded!=digest(native_bytes):raise ValueError('Map layer native capture is not verified')
            layers=native['mapLayerManager']['state']['components'][0]['layers']
            for row in map_layers:
                if not any(all(row[key]==layer[key] for key in ['shapeCount','uvCounts','uvSha256']) for layer in layers):raise ValueError('Independent map UV decoder differs from native: '+row['path'])
            map_report.update(nativeVerified=True,nativeMemorySha256=digest(native_bytes),nativeTraceSha256=native['mapLayerManager']['traceSha256'])
    preview=ROOT/'public/generated/preview';preview.mkdir(parents=True,exist_ok=True)
    (preview/'map-layer-provenance.json').write_text(json.dumps(map_report,separators=(',',':')),encoding='utf8')
    print(json.dumps(dict(atlases=len(cases),elements=sum(len(case['elements']) for case in cases),output='output/atlas-catalog.json')))
if __name__=='__main__':main()
