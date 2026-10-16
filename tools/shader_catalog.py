"""Read the observed KSH uniform/source/stage-map container independently."""
import hashlib
import json
from pathlib import Path
import struct
import zipfile

ROOT=Path(__file__).resolve().parents[1]
class Reader:
    def __init__(self,data):self.data=data;self.pos=0
    def read(self,size):
        if size<0 or self.pos+size>len(self.data):raise ValueError('Truncated KSH at '+str(self.pos))
        value=self.data[self.pos:self.pos+size];self.pos+=size;return value
    def u32(self):return struct.unpack('<I',self.read(4))[0]
    def text(self):
        size=self.u32()
        if size>2*1024*1024:raise ValueError('KSH text exceeds limit')
        return self.read(size).decode('utf8')
def decode(data):
    r=Reader(data);name=r.text();count=r.u32();uniforms=[]
    if count>4096:raise ValueError('KSH uniform count exceeds limit')
    for _ in range(count):
        item=dict(name=r.text(),alias=r.text(),kind=r.u32(),count=r.u32(),defaults=[])
        if item['kind']<42 or item['kind']>45:
            size=r.u32()
            if size>65536:raise ValueError('KSH defaults exceed limit')
            item['defaults']=list(struct.unpack('<'+str(size)+'f',r.read(size*4)))
        uniforms.append(item)
    stages=[]
    for kind in ['vertex','fragment']:stages.append(dict(kind=kind,file=r.text(),source=r.text()))
    for stage in stages:
        size=r.u32()
        if size>4096:raise ValueError('KSH stage binding count exceeds limit')
        stage['uniforms']=[r.u32() for _ in range(size)]
        if any(index>=count for index in stage['uniforms']):raise ValueError('KSH stage uniform index exceeds table')
    if r.pos!=len(data):raise ValueError('KSH trailing bytes: '+str(len(data)-r.pos))
    return dict(name=name,uniforms=uniforms,stages=stages)
def main():
    output=ROOT/'output';inputs=output/'shader-inputs';inputs.mkdir(exist_ok=True);cases=[]
    archive=ROOT.parent/'data/databundles/shaders.zip'
    with zipfile.ZipFile(archive) as bundle:
        for path in sorted(bundle.namelist()):
            if not path.endswith('.ksh'):continue
            raw=bundle.read(path)
            try:value=decode(raw)
            except (ValueError,UnicodeDecodeError) as error:raise ValueError(path+': '+str(error)) from error
            sha=hashlib.sha256(raw).hexdigest();filename='shader-inputs/'+sha+'.ksh';(output/filename).write_bytes(raw)
            cases.append(dict(path=path,sha256=sha,input=filename,**value))
    report=dict(gameBuild='756039',archiveSha256=hashlib.sha256(archive.read_bytes()).hexdigest(),generatorSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),cases=cases)
    (output/'shader-catalog.json').write_text(json.dumps(report,separators=(',',':')),encoding='utf8')
    print(json.dumps(dict(shaders=len(cases),kinds=sorted({u['kind'] for c in cases for u in c['uniforms']}),aliases=sorted({u['alias'] for c in cases for u in c['uniforms']}),output='output/shader-catalog.json')))
if __name__=='__main__':main()
