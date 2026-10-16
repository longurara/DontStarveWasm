"""Independent Python pixel oracle for native KTEX, retaining input provenance."""
import hashlib
import json
from pathlib import Path
import struct
import zipfile
from assets import texture

ROOT=Path(__file__).resolve().parents[1]
GAME=ROOT.parent
def sha(data):return hashlib.sha256(data).hexdigest()
def main():
    output=ROOT/'output/texture-fixtures';output.mkdir(exist_ok=True)
    sources=[('data/anim/wilson.zip','atlas-0.tex','anim/wilson.zip#atlas-0.tex'),
             ('data/databundles/images.zip','images/global.tex','images/global.tex'),
             ('data/databundles/images.zip','images/hud.tex','images/hud.tex')]
    cases=[]
    for archive,entry,path in sources:
        source=(GAME/archive).read_bytes()
        with zipfile.ZipFile(GAME/archive) as z:data=z.read(entry)
        flags=struct.unpack_from('<I',data,4)[0];count=(flags>>13)&31
        levels=[struct.unpack_from('<HHHI',data,8+i*10) for i in range(count)]
        offset=8+count*10;mips=[]
        for width,height,pitch,size in levels:
            # Existing Python decoder accepts one KTEX level. Re-envelope
            # each unchanged mip to exercise it independently of C++ parsing.
            single=b'KTEX'+struct.pack('<IHHHI',(flags&~(31<<13))|(1<<13),width,height,pitch,size)+data[offset:offset+size]
            w,h,rgba=texture(single);assert (w,h)==(width,height)
            mips.append(dict(width=width,height=height,pitch=pitch,bytes=size,rgbaSha256=sha(rgba)))
            offset+=size
        assert offset==len(data)
        file=sha(data)+'.tex';(output/file).write_bytes(data)
        cases.append(dict(path=path,source=archive,archiveSha256=sha(source),entry=entry,sha256=sha(data),fixture='texture-fixtures/'+file,codec=(flags>>4)&31,mips=mips))
    catalog=dict(gameBuild='756039',generatorSha256=sha(Path(__file__).read_bytes()),decoderSha256=sha((ROOT/'tools/assets.py').read_bytes()),cases=cases)
    text=json.dumps(catalog,indent=2)+'\n'
    (ROOT/'output/texture-catalog.json').write_text(text)
    (ROOT/'public/generated/preview/texture-provenance.json').write_text(text)
    print('KTEX independent pixel oracle:',len(cases),'files,',sum(len(c['mips']) for c in cases),'mips')
if __name__=='__main__':main()
