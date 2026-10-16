"""Independent geometry oracle for deferred native DYNAMIC_ANIM bundles."""
import hashlib
import io
import json
from pathlib import Path
import struct
import zipfile
from assets import build,animation
ROOT=Path(__file__).resolve().parents[1]
def sha(data):return hashlib.sha256(data).hexdigest()
def main():
    source=ROOT.parent/'data/databundles/anim_dynamic.zip';archive_hash=sha(source.read_bytes())
    output=ROOT/'output/animation-fixtures';output.mkdir(exist_ok=True);cases=[]
    with zipfile.ZipFile(source) as archive:
        for name in ['box_shared_spiral','loading_wanda1','beefalo_horn_formal']:
            path='anim/dynamic/'+name+'.zip';data=archive.read(path)
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                model=build(z.read('build.bin')) if 'build.bin' in z.namelist() else dict(name='',atlases=[],symbols={},vertices=[])
                motion=animation(z.read('anim.bin')) if 'anim.bin' in z.namelist() else dict(animations=[])
            vertices=b''.join(struct.pack('<6f',*vertex) for vertex in model['vertices'])
            symbols=bytearray()
            for key,symbol in sorted(model['symbols'].items(),key=lambda item:int(item[0])):
                symbols+=struct.pack('<II',int(key),len(symbol['frames']))
                for frame in symbol['frames']:symbols+=struct.pack('<II4fII',frame['frame'],frame['duration'],*frame['bbox'],frame['offset'],frame['count'])
            clips=[];elements=bytearray();events=bytearray();frames=0;count=0
            for clip in motion['animations']:
                clips.append(dict(name=clip['name'],bank=int(clip['bank']),facing=clip['facing'],frames=len(clip['frames']),rate=clip['rate']))
                frames+=len(clip['frames'])
                for frame in clip['frames']:
                    events+=b''.join(struct.pack('<I',value) for value in frame['events'])
                    for element in frame['elements']:
                        elements+=struct.pack('<III7f',int(element['symbol']),element['frame'],int(element['layer']),*element['matrix'],element['depth']);count+=1
            file=sha(data)+'.zip';(output/file).write_bytes(data)
            cases.append(dict(path=path,fixture='animation-fixtures/'+file,sha256=sha(data),build=model['name'],declaredTextures=len(model['atlases']),symbols=len(model['symbols']),vertices=len(model['vertices']),frames=frames,elements=count,clips=clips,vertexSha256=sha(vertices),symbolFrameSha256=sha(symbols),elementSha256=sha(elements),eventSha256=sha(events)))
    catalog=dict(gameBuild='756039',source='data/databundles/anim_dynamic.zip',archiveSha256=archive_hash,generatorSha256=sha(Path(__file__).read_bytes()),decoderSha256=sha((ROOT/'tools/assets.py').read_bytes()),cases=cases)
    (ROOT/'output/animation-catalog.json').write_text(json.dumps(catalog,indent=2)+'\n')
    print('Deferred animation geometry oracle:',len(cases),'bundles')
if __name__=='__main__':main()
