"""Package portable native asset bytes into bounded, content-addressed packs.

The logical paths match Klei's data filesystem, including databundle entries.
FSB banks are omitted: their browser representation comes from fmod_samples.py.
This is the resource transport format, not a claim that all asset decoders work.
"""
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import zipfile

ROOT=Path(__file__).resolve().parents[1]
GAME=ROOT.parent
CHUNK_BYTES=1024*1024
PACK_BYTES=8*1024*1024

def digest(data):return hashlib.sha256(data).hexdigest()

def valid_path(name):
    p=PurePosixPath(name)
    if not name or p.is_absolute() or any(part in ['', '.', '..'] for part in name.split('/')) or any(c in name for c in '\\:\t\r\n\0'):
        raise ValueError('Unsafe native resource path: '+repr(name))
    return name

class Packer:
    def __init__(self,output):
        self.output=output;self.pending={};self.pending_bytes=0
        self.index=dict(gameBuild='756039',schemaVersion=1,encoding='native-assets-v1',chunkBytes=CHUNK_BYTES,
                        packLimitBytes=PACK_BYTES,files={},chunks={},packs={},sources={})
        (output/'packs').mkdir(parents=True,exist_ok=True)
    def flush(self):
        if not self.pending:return
        out=io.BytesIO()
        # Stored chunks keep decode memory/work predictable. KTEX and nested
        # animation ZIP bytes are decoded by their own format adapters later.
        with zipfile.ZipFile(out,'w',compression=zipfile.ZIP_STORED) as z:
            for sha,data in sorted(self.pending.items()):
                entry=zipfile.ZipInfo(sha+'.bin',(1980,1,1,0,0,0))
                entry.compress_type=zipfile.ZIP_STORED;z.writestr(entry,data)
        payload=out.getvalue();sha=digest(payload);destination=self.output/'packs'/(sha+'.zip')
        if not destination.exists():
            temporary=destination.with_suffix('.pending');temporary.write_bytes(payload);temporary.replace(destination)
        elif digest(destination.read_bytes())!=sha:raise ValueError('Corrupt existing resource pack: '+sha)
        self.index['packs'][sha]=dict(url='resources/packs/'+destination.name,bytes=len(payload),expandedBytes=self.pending_bytes,entries=len(self.pending))
        for key,data in self.pending.items():self.index['chunks'][key]=dict(pack=sha,key=key+'.bin',bytes=len(data))
        self.pending={};self.pending_bytes=0
    def add(self,name,stream,source):
        valid_path(name);fingerprint=hashlib.sha256();chunks=[];size=0
        while True:
            data=stream.read(CHUNK_BYTES)
            if not data:break
            fingerprint.update(data);size+=len(data);sha=digest(data);chunks.append(sha)
            if sha in self.index['chunks'] or sha in self.pending:continue
            if self.pending_bytes+len(data)>PACK_BYTES:self.flush()
            self.pending[sha]=data;self.pending_bytes+=len(data)
        entry=dict(bytes=size,sha256=fingerprint.hexdigest(),chunks=chunks,source=source)
        previous=self.index['files'].get(name)
        if previous and (previous['sha256']!=entry['sha256'] or previous['bytes']!=size):
            raise ValueError('Conflicting resource sources: '+name)
        self.index['files'][name]=entry
    def finish(self):
        self.flush();self.index['totalBytes']=sum(f['bytes'] for f in self.index['files'].values())
        payload=json.dumps(self.index,sort_keys=True,separators=(',',':')).encode()
        sha=digest(payload);path=self.output/(sha+'.json')
        temporary=path.with_suffix('.pending');temporary.write_bytes(payload);temporary.replace(path)
        reference=dict(gameBuild='756039',schemaVersion=1,url='resources/'+path.name,sha256=sha,bytes=len(payload),
                       files=len(self.index['files']),packs=len(self.index['packs']),totalBytes=self.index['totalBytes'])
        temporary=self.output/'index.pending';temporary.write_text(json.dumps(reference,indent=2),encoding='utf8');temporary.replace(self.output/'index.json')
        return reference

def main():
    if (GAME/'version.txt').read_text().strip()!='756039':raise ValueError('Unsupported game build')
    packer=Packer(ROOT/'public/generated/resources');data_root=GAME/'data'
    for path in sorted(data_root.rglob('*')):
        if not path.is_file():continue
        name=path.relative_to(data_root).as_posix()
        if name.startswith('databundles/') or path.suffix.lower()=='.fsb':continue
        with path.open('rb') as stream:packer.add(name,stream,'data/'+name)
    for archive in sorted((data_root/'databundles').glob('*.zip')):
        packer.index['sources'][archive.relative_to(GAME).as_posix()]=digest(archive.read_bytes())
        with zipfile.ZipFile(archive) as z:
            for entry in sorted(z.infolist(),key=lambda item:item.filename):
                if entry.is_dir() or (archive.name=='scripts.zip' and entry.filename.endswith('.lua')):continue
                with z.open(entry) as stream:packer.add(entry.filename,stream,archive.relative_to(GAME).as_posix()+':'+entry.filename)
    print(json.dumps(packer.finish(),indent=2))

if __name__=='__main__':main()
