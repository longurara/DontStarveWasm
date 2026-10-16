"""Read the isolated oracle's Sim resource-manager vtables, never write memory."""
import hashlib
import json
from pathlib import Path
import re
import struct
import zipfile
from native_memory import ReferenceProcess

def capture(pid,executable,trace):
    data=trace.read_bytes()
    if not data.startswith(b'KLEI     1 '):raise ValueError('Expected plain asset trace envelope')
    oracle=json.loads(data[11:])
    match=re.fullmatch(r'(?:userdata: |Sim \()(?:0x)?([0-9a-fA-F]+)\)?',oracle['simPointer'])
    if not match:raise ValueError('Unknown native Sim pointer format: '+oracle['simPointer'])
    userdata=int(match[1],16)
    with ReferenceProcess(pid,executable) as process:
        # Lua Sim wrapper LoadPrefabs dereferences a Sim handle, then +0xe0
        # prefab registry. Each record in registry+0x110 has an owner at +0x90.
        holders=[userdata,process.u64(userdata),process.u64(userdata+8)]
        candidates=holders[:]
        for holder in holders:
            try:candidates.append(process.u64(holder))
            except (ValueError,OSError):pass
        sim=None;registry=None
        for candidate in candidates:
            try:
                prefabs=process.u64(candidate+0xe0)
                begin,end=process.u64(prefabs+0x110),process.u64(prefabs+0x118)
                if end<=begin or (end-begin)%8 or end-begin>50000*8:continue
                record=process.u64(begin)
                if process.u64(record+0x90)==prefabs:sim=candidate;registry=prefabs;break
            except (ValueError,OSError):pass
        if sim is None:raise ValueError('Cannot resolve validated native Sim context')
        managers={}
        for name,offset in [('animation',0x70),('file',0x78),('atlas',0x80)]:
            manager=process.u64(registry+offset)
            if not manager:continue
            vtable=process.u64(manager)
            methods={str(i):hex(process.u64(vtable+i*8)-process.base+process.image_base) for i in range(8)}
            if not process.image_base<=int(methods['7'],16)<process.image_base+0x800000:
                raise ValueError('Resource manager load vtable outside verified image: '+name+' '+str(methods))
            managers[name]=dict(pointer=hex(manager),vtable=hex(vtable-process.base+process.image_base),methods=methods)
        core=process.u64(registry+0x48)
        for name,offset in [('shader',0x1c0),('font',0x918)]:
            manager=process.u64(core+offset)
            if not manager:continue
            vtable=process.u64(manager)
            methods={str(i):hex(process.u64(vtable+i*8)-process.base+process.image_base) for i in range(8)}
            if not process.image_base<=int(methods['7'],16)<process.image_base+0x800000:
                raise ValueError('Renderer resource manager load outside verified image: '+name)
            managers[name]=dict(pointer=hex(manager),vtable=hex(vtable-process.base+process.image_base),methods=methods)
        def string_at(address):
            raw=process.read(address,40);size,capacity=struct.unpack_from('<QQ',raw,24)
            if size>capacity or size>65536:raise ValueError('Invalid resource string')
            return (process.read(struct.unpack_from('<Q',raw,8)[0],size) if capacity>=16 else raw[8:8+size]).decode('utf8')
        prefab_assets=[]
        first,last=process.u64(registry+0x110),process.u64(registry+0x118)
        for slot in range(first,last,8):
            prefab=process.u64(slot);name=string_at(prefab)
            if name not in ['web_native_asset_kinds','web_native_ignored_asset_kinds']:continue
            if process.u64(prefab+0x90)!=registry:raise ValueError('Asset-kind prefab owner mismatch')
            begin,end=process.u64(prefab+0x70),process.u64(prefab+0x78)
            if end<begin or (end-begin)%56 or end-begin>100*56:raise ValueError('Invalid native prefab asset vector')
            rows=[dict(kind=process.u32(item),file=string_at(item+8),param=struct.unpack('<f',process.read(item+0x30,4))[0]) for item in range(begin,end,56)]
            prefab_assets.append(dict(name=name,assets=rows))
        if len(prefab_assets)!=2:raise ValueError('Asset-kind prefabs not retained')
        animation_manager=int(managers['animation']['pointer'],16)
        begin,end=process.u64(animation_manager+0x38),process.u64(animation_manager+0x40)
        if end<begin or (end-begin)%64 or end-begin>50000*64:raise ValueError('Invalid native ANIM record array')
        dynamic_animations=[]
        for slot in range(begin,end,64):
            if not process.u32(slot):continue
            path=string_at(slot+0x10)
            if path!='anim/dynamic/box_shared_spiral.zip':continue
            animation=process.u64(slot+8);build=process.u64(animation+0x50)
            if not build or process.u64(build)!=animation:raise ValueError('Dynamic BILD owner mismatch')
            first,last=process.u64(build+0x38),process.u64(build+0x40)
            if last<first or (last-first)%40 or last-first>256*40:raise ValueError('Invalid dynamic atlas names')
            names=[string_at(item) for item in range(first,last,40)]
            first,last=process.u64(build+0x58),process.u64(build+0x60)
            if last<first or (last-first)%4 or last-first>256*4:raise ValueError('Invalid dynamic texture handles')
            handles=[struct.unpack('<i',process.read(item,4))[0] for item in range(first,last,4)]
            archive=Path(executable).resolve().parents[1]/'data/databundles/anim_dynamic.zip'
            with zipfile.ZipFile(archive) as bundle:source=bundle.read(path)
            dynamic_animations.append(dict(path=path,build=string_at(build+8),clips=process.u32(animation+0x40),frames=process.u32(animation+0x44),elements=process.u32(animation+0x48),atlases=names,textureHandles=handles,textureLoaded=bool(process.read(build+0xa8,1)[0]),sha256=hashlib.sha256(source).hexdigest(),archiveSha256=hashlib.sha256(archive.read_bytes()).hexdigest()))
        if not dynamic_animations:raise ValueError('Dynamic animation fixture is not retained')
        file_manager=int(managers['file']['pointer'],16)
        begin,end=process.u64(file_manager+0x38),process.u64(file_manager+0x40)
        if end<begin or (end-begin)%64 or end-begin>50000*64:raise ValueError('Invalid native FILE record array')
        raw_file=None
        for slot in range(begin,end,64):
            raw=process.read(slot,64)
            references=struct.unpack_from('<I',raw)[0]
            if not references:continue
            size,capacity=struct.unpack_from('<QQ',raw,0x28)
            if size>capacity or size>4096:raise ValueError('Invalid native FILE path')
            path=(process.read(struct.unpack_from('<Q',raw,0x18)[0],size) if capacity>=16 else raw[0x18:0x18+size]).decode('utf8')
            if path!='klump/strings/unused.txt':continue
            archive=Path(executable).resolve().parents[1]/'data/databundles/klump.zip'
            with zipfile.ZipFile(archive) as bundle:source=bundle.read(path)
            # Native allocation size is source length + 1 (0x14000f760).
            buffer=process.read(struct.unpack_from('<Q',raw,8)[0],len(source)+1)
            raw_file=dict(path=path,bytes=len(source),sha256=hashlib.sha256(buffer[:-1]).hexdigest(),terminated=buffer[-1]==0,
                matchesSource=buffer[:-1]==source,nativeReferenceField=references,sourceArchiveSha256=hashlib.sha256(archive.read_bytes()).hexdigest())
            break
        if raw_file is None:raise ValueError('Native FILE fixture is not retained by global prefab')
        atlas_manager=int(managers['atlas']['pointer'],16)
        begin,end=process.u64(atlas_manager+0x38),process.u64(atlas_manager+0x40)
        if end<begin or (end-begin)%64 or end-begin>50000*64:raise ValueError('Invalid native ATLAS record array')
        atlases=[]
        for slot in range(begin,end,64):
            raw=process.read(slot,64)
            if not struct.unpack_from('<I',raw)[0]:continue
            size,capacity=struct.unpack_from('<QQ',raw,0x28)
            if size>capacity or size>4096:raise ValueError('Invalid native ATLAS path')
            path=(process.read(struct.unpack_from('<Q',raw,0x18)[0],size) if capacity>=16 else raw[0x18:0x18+size]).decode('utf8')
            if path not in ['images/global.xml','images/hud.xml','images/map_icons.xml','images/fepanels.xml','levels/tiles/forest.xml','levels/tiles/grass.xml','levels/tiles/grass2.xml','levels/tiles/grass3.xml','levels/tiles/meteor.xml']:continue
            atlas=struct.unpack_from('<Q',raw,8)[0]
            first,last=process.u64(atlas+0x38),process.u64(atlas+0x40)
            if last<first or (last-first)%32 or last-first>100000*32:raise ValueError('Invalid native atlas entry array')
            entries=[]
            for entry in range(first,last,32):
                row=process.read(entry,32);u1,v1,u2,v2=struct.unpack_from('<4f',row,16)
                entries.append(dict(id=struct.unpack_from('<I',row)[0],u1=u1,v1=v1,u2=u2,v2=v2))
            atlases.append(dict(path=path,textureHandle=struct.unpack('<i',process.read(atlas+0x28,4))[0],textureLoaded=bool(process.read(atlas+0x78,1)[0]),entries=entries))
        if not atlases:raise ValueError('Native ATLAS fixture is not retained')
        shader_manager=int(managers['shader']['pointer'],16)
        begin,end=process.u64(shader_manager+0x38),process.u64(shader_manager+0x40)
        if end<begin or (end-begin)%64 or end-begin>50000*64:raise ValueError('Invalid native SHADER record array')
        shaders=[]
        for slot in range(begin,end,64):
            if not process.u32(slot):continue
            path=string_at(slot+0x10)
            if path not in ['shaders/anim_bloom.ksh','shaders/anim.ksh','shaders/anim_skinned.ksh']:continue
            shader=process.u64(slot+8);values,values_end=process.u64(shader+0x160),process.u64(shader+0x168)
            names,names_end=process.u64(shader+0x180),process.u64(shader+0x188)
            if values_end<values or (values_end-values)%72 or names_end<names or (names_end-names)%88:raise ValueError('Invalid native shader uniform arrays')
            count=(values_end-values)//72
            if count>4096 or (names_end-names)//88!=count:raise ValueError('Native shader uniform/name count mismatch')
            uniforms=[]
            for index in range(count):
                value=values+index*72;array_begin,array_end=process.u64(value+0x10),process.u64(value+0x18)
                if array_end<array_begin or array_end-array_begin>65536:raise ValueError('Invalid native shader value array')
                uniforms.append(dict(name=string_at(names+index*88),alias=string_at(names+index*88+40),kind=process.u32(value),arrayStorageBytes=array_end-array_begin))
            row=dict(path=path,name=string_at(shader+0x198),vertexFile=string_at(shader+0x18),fragmentFile=string_at(shader+0x70),uniforms=uniforms)
            # Null renderer queues initialization without draining GPU work;
            # constructor retains exact KSH bytes. Do not read the raw pointer
            # after Load has parsed/freed it (non-empty uniform/name tables).
            if not uniforms and not row['name']:
                size=process.u32(shader+0xe8)
                if not 0<size<=1024*1024:raise ValueError('Invalid deferred shader source length')
                raw=process.read(process.u64(shader+0xb8),size)
                row.update(deferred=True,sourceBytes=size,sourceSha256=hashlib.sha256(raw).hexdigest())
            shaders.append(row)
        if not shaders:raise ValueError('Native SHADER fixture is not retained')
        font_manager=int(managers['font']['pointer'],16)
        begin,end=process.u64(font_manager+0x38),process.u64(font_manager+0x40)
        if end<begin or (end-begin)%64 or end-begin>1000*64:raise ValueError('Invalid native FONT record array')
        fonts=[]
        font_paths={}
        def array_bytes(first,last,stride,limit):
            if last<first or (last-first)%stride or (last-first)//stride>limit:raise ValueError('Invalid FONT array range')
            return b''.join(process.read(at,min(1024*1024,last-at)) for at in range(first,last,1024*1024))
        for slot in range(begin,end,64):
            if not process.u32(slot):continue
            path=string_at(slot+0x10)
            font_paths[(slot-begin)//64]=path
            if path not in ['fonts/talkingfont.zip','fonts/bellefair50.zip','fonts/fallback_full_packed.zip']:continue
            font=process.u64(slot+8)
            glyphs=array_bytes(process.u64(font+0x50),process.u64(font+0x58),36,100000)
            kernings=array_bytes(process.u64(font+0x70),process.u64(font+0x78),12,200000)
            normalized=b''.join(glyphs[i:i+34] for i in range(0,len(glyphs),36))
            line,base=struct.unpack('<HH',process.read(font+0x28,4))
            outline,width,height,advance=struct.unpack('<4f',process.read(font+0x2c,16))
            fallback_bytes=array_bytes(process.u64(font+0x98),process.u64(font+0xa0),16,4096)
            fallbacks=[struct.unpack_from('<I',fallback_bytes,i)[0] for i in range(0,len(fallback_bytes),16)]
            fonts.append(dict(path=path,lineHeight=line,base=base,outline=outline,width=width,height=height,advance=advance,colourEnabled=bool(process.read(font+0x3c,1)[0]),nativeReferenceField=process.u32(slot),fallbackIds=fallbacks,material=process.u32(font+0x40),textureHandle=struct.unpack('<i',process.read(font+0x88,4))[0],glyphs=len(glyphs)//36,kernings=len(kernings)//12,glyphSha256=hashlib.sha256(normalized).hexdigest(),kerningSha256=hashlib.sha256(kernings).hexdigest()))
        if len(fonts)!=3:raise ValueError('Native FONT fixtures not retained')
        for font in fonts:
            font['fallbacks']=[font_paths.get(identifier,'missing:'+str(identifier)) for identifier in font.pop('fallbackIds')]
        alias_head=process.u64(font_manager+0xb8);alias_count=process.u64(font_manager+0xc0)
        if alias_count>8192:raise ValueError('Invalid FONT alias count')
        font_aliases=[]
        def walk_aliases(node,depth=0):
            if node==alias_head:return
            if depth>64:raise ValueError('FONT alias tree depth exceeded')
            raw=process.read(node,56)
            if raw[0x31]:return
            walk_aliases(struct.unpack_from('<Q',raw,0)[0],depth+1)
            identifier=struct.unpack_from('<I',raw,0x18)[0];resource=struct.unpack_from('<i',raw,0x28)[0]
            font_aliases.append(dict(id=identifier,resolved=resource!=-1,path=font_paths.get(resource) if resource!=-1 else None))
            walk_aliases(struct.unpack_from('<Q',raw,0x10)[0],depth+1)
        walk_aliases(process.u64(alias_head+8))
        if len(font_aliases)!=alias_count:raise ValueError('FONT alias tree count mismatch')
        return dict(gameBuild='756039',executableSha256=process.sha256,traceSha256=hashlib.sha256(data).hexdigest(),sim=hex(sim),prefabRegistry=hex(registry),managers=managers,file=raw_file,atlases=atlases,shaders=shaders,dynamicAnimations=dynamic_animations,prefabAssets=prefab_assets,
            fonts=fonts,
            fontAliases=font_aliases,
            evidence='Read-only own reference child; Sim/registry/record owner back-reference validated; vtable targets relocated into hash-verified image')
