"""Independent BMFont XML/glyph/kerning oracle for all original font packs."""
import hashlib
import io
import json
from pathlib import Path
import struct
import xml.etree.ElementTree as E
import zipfile
from assets import texture as decode_texture
ROOT=Path(__file__).resolve().parents[1]
def sha(data):return hashlib.sha256(data).hexdigest()
def signed_byte(value):return (value&255) if (value&255)<128 else (value&255)-256
def main():
    source=ROOT.parent/'data/databundles/fonts.zip';cases=[];output=ROOT/'output/font-fixtures';output.mkdir(exist_ok=True)
    with zipfile.ZipFile(source) as archive:
        for path in sorted(archive.namelist()):
            data=archive.read(path)
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                xml=z.read('font.fnt');texture=z.read('font.tex');root=E.fromstring(xml)
            info=root.find('info').attrib;common=root.find('common').attrib;chars=root.find('chars');kernings=root.find('kernings')
            glyphs={}
            for char in chars:
                row=char.attrib;glyphs[int(row['id'])]=struct.pack('<I7fH',int(row['id']),*(float(row[field]) for field in ['x','y','width','height','xoffset','yoffset','xadvance']),int(row['chnl']))
            pairs={}
            if kernings is not None:
                for kerning in kernings:
                    row=kerning.attrib;key=(signed_byte(int(row['first']))&0xffffffff,signed_byte(int(row['second']))&0xffffffff);pairs[key]=float(row['amount'])
            glyph_sha=sha(b''.join(glyphs[key] for key in sorted(glyphs)))
            kerning_sha=sha(b''.join(struct.pack('<IIf',*key,pairs[key]) for key in sorted(pairs)))
            outline=float(info.get('outline',0));material=(3 if outline>0 else 2) if int(common['packed']) else int(common['redChnl']=='2')
            file=sha(data)+'.zip';(output/file).write_bytes(data)
            sample=min(glyphs,key=lambda key:abs(key-65));row=next(c.attrib for c in chars if int(c.attrib['id'])==sample)
            cases.append(dict(path=path,fixture='font-fixtures/'+file,sourceSha256=sha(data),xmlSha256=sha(xml),textureSha256=sha(texture),face=info['face'],lineHeight=int(common['lineHeight']),base=int(common['base']),width=float(common['scaleW']),height=float(common['scaleH']),outline=outline,material=material,glyphs=len(glyphs),kernings=len(pairs),glyphSha256=glyph_sha,kerningSha256=kerning_sha,sample={**{key:float(row[key]) for key in ['x','y','width','height','xoffset','yoffset','xadvance']},'id':sample,'channel':int(row['chnl'])}))
            if path in ['fonts/talkingfont.zip','fonts/bellefair50.zip','fonts/fallback_full_packed.zip']:
                width,height,rgba=decode_texture(texture);assert width==float(common['scaleW']) and height==float(common['scaleH'])
                cases[-1]['rgbaSha256']=sha(rgba)
    catalog=dict(gameBuild='756039',source='data/databundles/fonts.zip',archiveSha256=sha(source.read_bytes()),generatorSha256=sha(Path(__file__).read_bytes()),decoderSha256=sha((ROOT/'tools/assets.py').read_bytes()),cases=cases)
    (ROOT/'output/font-catalog.json').write_text(json.dumps(catalog,indent=2)+'\n')
    (ROOT/'public/generated/preview/font-provenance.json').write_text(json.dumps(catalog,indent=2)+'\n')
    print('Independent FONT oracle:',len(cases),'packs,',sum(row['glyphs'] for row in cases),'glyphs')
if __name__=='__main__':main()
