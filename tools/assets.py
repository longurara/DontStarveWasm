"""Bounded binary readers for observed KTEX/BILD6/ANIM4 asset formats.

Format references (not vendored code): nsimplex/ktools serializers and the
original local asset bytes. Only the currently observed versions are accepted.
"""
import hashlib
import json
from pathlib import Path
import struct
import zlib
import zipfile

ROOT=Path(__file__).resolve().parents[1]

class Reader:
    def __init__(self,data): self.data=data; self.pos=0
    def read(self,count):
        if count<0 or self.pos+count>len(self.data): raise ValueError('Truncated asset at '+str(self.pos))
        out=self.data[self.pos:self.pos+count];self.pos+=count;return out
    def unpack(self,fmt): return struct.unpack('<'+fmt,self.read(struct.calcsize('<'+fmt)))
    def u32(self): return self.unpack('I')[0]
    def string(self):
        size=self.u32()
        if size>1000000: raise ValueError('Oversized asset string')
        return self.read(size).decode('utf8')
    def end(self):
        if self.pos!=len(self.data): raise ValueError(f'Unconsumed bytes: {len(self.data)-self.pos}')

def build(data):
    r=Reader(data)
    if r.read(4)!=b'BILD' or r.u32()!=6: raise ValueError('Expected BILD version 6')
    count,total=r.unpack('II'); name=r.string(); atlas_count=r.u32()
    if count>100000 or total>1000000 or atlas_count>256: raise ValueError('Invalid BILD counts')
    atlases=[r.string() for _ in range(atlas_count)]
    symbols={}
    for _ in range(count):
        key=str(r.u32()); n=r.u32()
        if n>total: raise ValueError('Invalid frame count')
        frames=[]
        for _ in range(n):
            frame,duration=r.unpack('II'); bbox=r.unpack('ffff'); offset,size=r.unpack('II')
            frames.append(dict(frame=frame,duration=duration,bbox=bbox,offset=offset,count=size))
        symbols[key]=dict(frames=frames)
    vertices=r.u32()
    if vertices>10000000: raise ValueError('Oversized vertex buffer')
    mesh=[r.unpack('ffffff') for _ in range(vertices)]
    for _ in range(r.u32()):
        key=str(r.u32()); value=r.string()
        if key in symbols: symbols[key]['name']=value
    r.end()
    assert sum(len(s['frames']) for s in symbols.values())==total
    assert sum(f['count'] for s in symbols.values() for f in s['frames'])==vertices
    for s in symbols.values():
        for f in s['frames']:
            if f['offset']+f['count']>vertices: raise ValueError('BILD mesh outside buffer')
    return dict(name=name,atlases=atlases,symbols=symbols,vertices=mesh)

def animation(data):
    r=Reader(data)
    if r.read(4)!=b'ANIM' or r.u32()!=4: raise ValueError('Expected ANIM version 4')
    elements,frames,events,count=r.unpack('IIII')
    if max(elements,frames,events,count)>10000000: raise ValueError('Invalid ANIM counts')
    animations=[]; observed=[0,0,0]
    for _ in range(count):
        name=r.string(); facing=r.read(1)[0]; bank=r.u32(); rate=r.unpack('f')[0]; num=r.u32()
        if not 0<rate<=240 or num>100000: raise ValueError('Invalid animation duration')
        timeline=[]
        for _ in range(num):
            bbox=r.unpack('ffff'); evs=[r.u32() for _ in range(r.u32())]
            items=[]
            for _ in range(r.u32()):
                symbol,index,layer=r.unpack('III'); matrix=r.unpack('ffffff'); depth=r.unpack('f')[0]
                items.append(dict(symbol=str(symbol),frame=index,layer=str(layer),matrix=matrix,depth=depth))
            observed[0]+=len(items);observed[1]+=1;observed[2]+=len(evs)
            timeline.append(dict(bbox=bbox,events=evs,elements=items))
        animations.append(dict(name=name,facing=facing,bank=str(bank),rate=rate,frames=timeline))
    names={}
    for _ in range(r.u32()):
        key=str(r.u32());names[key]=r.string()
    r.end()
    if observed!=[elements,frames,events]: raise ValueError('ANIM count mismatch')
    return dict(animations=animations,names=names)

def rgb565(word):
    r=(word>>11)&31;g=(word>>5)&63;b=word&31
    return ((r<<3)|(r>>2),(g<<2)|(g>>4),(b<<3)|(b>>2))

def texture(data):
    r=Reader(data)
    if r.read(4)!=b'KTEX': raise ValueError('Expected KTEX')
    flags=r.u32();codec=(flags>>4)&31;mipcount=(flags>>13)&31
    if mipcount==0 or mipcount>20: raise ValueError('Invalid mip count')
    levels=[r.unpack('HHHI') for _ in range(mipcount)]
    width,height,pitch,size=levels[0]
    if not 0<width<=8192 or not 0<height<=8192: raise ValueError('Invalid dimensions')
    payload=r.read(size); rgba=bytearray(width*height*4)
    if codec in (4,5):
        channels=4 if codec==4 else 3
        if size!=width*height*channels: raise ValueError('Unexpected raw KTEX layout')
        for p in range(width*height): rgba[p*4:p*4+4]=payload[p*channels:p*channels+channels]+(b'\xff' if channels==3 else b'')
    elif codec in (0,1,2):
        blocksize=8 if codec==0 else 16
        expected=((width+3)//4)*((height+3)//4)*blocksize
        if size!=expected: raise ValueError('Invalid DXT payload length')
        cursor=0
        for by in range(0,height,4):
            for bx in range(0,width,4):
                block=payload[cursor:cursor+blocksize];cursor+=blocksize
                colors=block[-8:];c0,c1,bits=struct.unpack('<HHI',colors)
                a,b=rgb565(c0),rgb565(c1)
                if c0>c1 or codec!=0:
                    palette=[(*a,255),(*b,255),(*(int((2*a[k]+b[k])/3) for k in range(3)),255),(*(int((a[k]+2*b[k])/3) for k in range(3)),255)]
                else: palette=[(*a,255),(*b,255),(*(int((a[k]+b[k])/2) for k in range(3)),255),(0,0,0,0)]
                if codec==2:
                    a0,a1=block[:2];alpha_bits=int.from_bytes(block[2:8],'little')
                    alpha=[a0,a1]+([((7-i)*a0+i*a1)//7 for i in range(1,7)] if a0>a1 else [((5-i)*a0+i*a1)//5 for i in range(1,5)]+[0,255])
                for py in range(4):
                    for px in range(4):
                        x,y=bx+px,by+py;i=py*4+px
                        color=palette[(bits>>(2*i))&3]
                        opacity=alpha[(alpha_bits>>(3*i))&7] if codec==2 else (((int.from_bytes(block[:8],'little')>>(4*i))&15)*17 if codec==1 else color[3])
                        if x<width and y<height: rgba[(y*width+x)*4:(y*width+x+1)*4]=bytes((*color[:3],opacity))
    else: raise ValueError('Unsupported KTEX pixel format '+str(codec))
    return width,height,bytes(rgba)

def png(width,height,rgba):
    def chunk(tag,data): return struct.pack('>I',len(data))+tag+data+struct.pack('>I',zlib.crc32(tag+data)&0xffffffff)
    rows=b''.join(b'\0'+rgba[y*width*4:(y+1)*width*4] for y in range(height))
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',width,height,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(rows,6))+chunk(b'IEND',b'')

def main():
    output=ROOT/'public/generated/preview';output.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(ROOT.parent/'data/anim/wilson.zip') as z:
        model=build(z.read('build.bin'))
        for name in model['atlases']:
            w,h,pixels=texture(z.read(name));(output/(name+'.png')).write_bytes(png(w,h,pixels))
    with zipfile.ZipFile(ROOT.parent/'data/anim/player_basic.zip') as z: motion=animation(z.read('anim.bin'))
    (output/'wilson.json').write_text(json.dumps(model,separators=(',',':')))
    (output/'player_basic.json').write_text(json.dumps(motion,separators=(',',':')))
    provenance={str(p.relative_to(ROOT.parent)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [ROOT.parent/'data/anim/wilson.zip',ROOT.parent/'data/anim/player_basic.zip']}
    (output/'provenance.json').write_text(json.dumps(provenance,indent=2))
    print('Decoded',model['name'],len(model['symbols']),'symbols;',len(model['vertices']),'vertices')
    print('Animations:',[(a['name'],a['facing'],len(a['frames'])) for a in motion['animations']][:35])

if __name__=='__main__':main()
