"""Inspect only the entity userdata created by native_entity_trace.lua."""
import json
import hashlib
from pathlib import Path
import re
import struct
from native_memory import ReferenceProcess

def capture(pid,executable,trace):
    data=trace.read_bytes()
    if not data.startswith(b'KLEI     1 '):raise ValueError('Expected plain entity trace envelope')
    oracle=json.loads(data[11:]);rows=oracle['cases'];result=[]
    with ReferenceProcess(pid,executable) as process:
        for row in rows:
            match=re.fullmatch(r'(?:userdata: |Entity \()(?:0x)?([0-9a-fA-F]+)\)?',row['pointer'])
            if not match:raise ValueError('Unknown native userdata pointer format: '+row['pointer'])
            userdata=int(match[1],16);raw=process.read(userdata,32)
            if row.get('retired'):
                result.append(dict(name=row['name'],guid=row['guid'],retired=True));continue
            candidates=[userdata]+list(struct.unpack('<4Q',raw));found=None
            if process.u32(userdata+8)==row['guid']:found=(userdata,userdata)
            for holder in candidates:
                if found:break
                try:
                    entity=process.u64(holder)
                    if process.u32(entity+8)==row['guid']:
                        found=(holder,entity);break
                except (OSError,ValueError):pass
            if not found:raise ValueError('Cannot resolve native entity holder GUID')
            holder,entity=found
            flags=process.read(entity+0x1b0,16)
            if row['events'] and bool(flags[4])==row['events'][-1]['awake']:
                raise ValueError('Entity memory and callback trace are from different simulation states: '+row['name'])
            begin,end=process.u64(entity+0xf0),process.u64(entity+0xf8)
            if end<begin or (end-begin)%8 or end-begin>1024:raise ValueError('Invalid native component array')
            components=[]
            for pointer in range(begin,end,8):
                component=process.u64(pointer);vtable=process.u64(component)
                functions={name:hex(process.u64(vtable+offset)-process.base+process.image_base)
                    for name,offset in [('type',0x30),('finalize',0x38),('sleep',0x60),('wake',0x68)]}
                components.append(functions)
            result.append(dict(name=row['name'],guid=row['guid'],userdata=hex(userdata),holder=hex(holder),entity=hex(entity),
                sleeping=bool(flags[4]),canSleep=bool(flags[6]),componentsAllowSleep=bool(flags[11]),rawFlags=flags.hex(),components=components))
        component_closures=[]
        for row in oracle.get('managers',{}).get('closures',[]):
            if row['kind']!='function':continue
            match=re.fullmatch(r'function: (?:0x)?([0-9a-fA-F]+)',row['pointer'])
            if not match:raise ValueError('Unknown component closure pointer format')
            pointer=int(match[1],16);raw=process.read(pointer,40)
            if raw[8]!=6:raise ValueError('Component closure is not a Lua function')
            if raw[10]!=1:continue
            target=struct.unpack_from('<Q',raw,32)[0]
            address=target-process.base+process.image_base
            if not process.image_base<=address<process.image_base+0x500000:raise ValueError('Component closure target outside verified native image')
            upvalues=[]
            for i in range(raw[11]):
                raw_value=process.read(pointer+40+i*16,16);kind=struct.unpack_from('<I',raw_value,8)[0]
                value=struct.unpack_from('<Q',raw_value)[0];item=dict(kind=kind,bits=hex(value))
                if kind==2:
                    try:item['memory']=process.read(value,64).hex()
                    except (OSError,ValueError):pass
                upvalues.append(item)
            component_closures.append(dict(name=row['name'],target=hex(address),upvalues=upvalues))
        shadow_trace=trace.parent/'wasm_shadow_component_trace';shadow_data=shadow_trace.read_bytes()
        if not shadow_data.startswith(b'KLEI     1 '):raise ValueError('Expected plain shadow trace')
        shadow=json.loads(shadow_data[11:]);shadow_components=[]
        for name in ['first','second']:
            match=re.fullmatch(r'ShadowManager \((?:0x)?([0-9a-fA-F]+)\)',shadow[name])
            if not match:raise ValueError('Unknown ShadowManager proxy format')
            proxy=int(match[1],16);component=process.u64(proxy+8);owner=process.u64(component+0x18)
            if process.u32(owner+8)!=shadow['guid']:raise ValueError('Shadow component owner GUID mismatch')
            vtable=process.u64(component);type_fn=process.u64(vtable+0x30);finalize=process.u64(vtable+0x38)
            renderer=process.u64(component+0x20);flags=process.read(owner+0x1b0,16)
            shadow_components.append(dict(proxy=name,sameComponent=not shadow_components or component==first_component,
                typeFunction=hex(type_fn-process.base+process.image_base),finalizeFunction=hex(finalize-process.base+process.image_base),
                textureHandle=struct.unpack('<i',process.read(renderer+0xd0,4))[0],staticHandle=struct.unpack('<i',process.read(component+0x30,4))[0],
                awake=not bool(flags[4]),canSleep=bool(flags[6]),componentsAllowSleep=bool(flags[11])))
            first_component=component
        road_data=(trace.parent/'wasm_road_component_trace').read_bytes()
        if not road_data.startswith(b'KLEI     1 '):raise ValueError('Expected plain road trace')
        road=json.loads(road_data[11:]);road_components=[]
        for row in road['cases']:
            addresses=[]
            for key in ['first','second']:
                match=re.fullmatch(r'RoadManager \((?:0x)?([0-9a-fA-F]+)\)',row[key])
                if not match:raise ValueError('Unknown RoadManager proxy format')
                addresses.append(process.u64(int(match[1],16)+8))
            component=addresses[0];owner=process.u64(component+0x18)
            if process.u32(owner+8)!=row['guid']:raise ValueError('Road component owner GUID mismatch')
            vtable=process.u64(component);flags=process.read(owner+0x1b0,16)
            begin,end=process.u64(component+0x100),process.u64(component+0x108)
            if end<begin or (end-begin)%8 or end-begin>1048576:raise ValueError('Invalid road control point vector')
            points=process.read(begin,end-begin) if end>begin else b''
            road_index=struct.unpack('<i',process.read(component+0x118,4))[0]
            if not -1<=road_index<32:raise ValueError('Unexpected road index')
            styles=process.u64(component+0x1a8);strips=[]
            for road_number in range(road_index+1):
                rows=[]
                for strip in range(4):
                    raw=process.read(styles+(road_number*4+strip)*44,44)
                    rows.append(dict(handles=list(struct.unpack_from('<4i',raw)),wrap=list(struct.unpack_from('<2i',raw,16)),
                        uvBits=raw[28:36].hex(),uv=list(struct.unpack_from('<2f',raw,28))))
                strips.append(rows)
            road_components.append(dict(name=row['name'],sameComponent=addresses[0]==addresses[1],typeFunction=hex(process.u64(vtable+0x30)-process.base+process.image_base),
                finalizeFunction=hex(process.u64(vtable+0x38)-process.base+process.image_base),roadIndex=road_index,
                pointBits=points.hex(),points=[list(pair) for pair in struct.iter_unpack('<2f',points)],strips=strips,
                hasQuadTree=bool(process.u64(component+0x170)),awake=not bool(flags[4]),canSleep=bool(flags[6]),componentsAllowSleep=bool(flags[11])))
        envelope_data=(trace.parent/'wasm_envelope_component_trace').read_bytes()
        if not envelope_data.startswith(b'KLEI     1 '):raise ValueError('Expected plain envelope component trace')
        envelope=json.loads(envelope_data[11:]);addresses=[]
        for key in ['first','second']:
            match=re.fullmatch(r'EnvelopeManager \((?:0x)?([0-9a-fA-F]+)\)',envelope[key])
            if not match:raise ValueError('Unknown EnvelopeManager proxy format')
            addresses.append(process.u64(int(match[1],16)+8))
        component=addresses[0];owner=process.u64(component+0x18)
        if process.u32(owner+8)!=envelope['guid']:raise ValueError('Envelope component owner GUID mismatch')
        vtable=process.u64(component);flags=process.read(owner+0x1b0,16)
        registry=process.u64(process.u64(process.u64(owner+0xe0)+0xe0)+0x90)
        begin,end=process.u64(component+0x28),process.u64(component+0x30)
        if end<begin or (end-begin)%4 or (end-begin)//4!=len(envelope['resources']):raise ValueError('Invalid envelope owner handles')
        resources=[]
        for index,row in enumerate(envelope['resources']):
            handle=process.u32(begin+index*4)
            if handle>1000000:raise ValueError('Invalid envelope handle')
            entry=process.u64(process.u64(registry+0x28)+handle*8)
            count=process.u32(entry+8);stride=12 if row['kind']=='AddVector2Envelope' else 8
            if count!=row['count'] or count>16384:raise ValueError('Envelope point count mismatch')
            points=process.read(process.u64(entry+0x10),count*stride) if count else b''
            resources.append(dict(name=row['name'],kind=row['kind'],count=count,stringId=process.u32(process.u64(registry+8)+handle*16),
                pointBits=points.hex(),vtable=hex(process.u64(entry)-process.base+process.image_base)))
        envelope_component=dict(sameComponent=addresses[0]==addresses[1],typeFunction=hex(process.u64(vtable+0x30)-process.base+process.image_base),
            finalizeFunction=hex(process.u64(vtable+0x38)-process.base+process.image_base),resources=resources,
            awake=not bool(flags[4]),canSleep=bool(flags[6]),componentsAllowSleep=bool(flags[11]))
        post_data=(trace.parent/'wasm_postprocessor_component_trace').read_bytes()
        if not post_data.startswith(b'KLEI     1 '):raise ValueError('Expected plain postprocessor trace')
        post=json.loads(post_data[11:]);post_components=[];backends=[];addresses=[]
        for key,guid in [('first',post['guid']),('second',post['guid']),('other',post['otherGuid'])]:
            match=re.fullmatch(r'PostProcessor \((?:0x)?([0-9a-fA-F]+)\)',post[key])
            if not match:raise ValueError('Unknown PostProcessor proxy format')
            component=process.u64(int(match[1],16)+8);addresses.append(component);owner=process.u64(component+0x18)
            if process.u32(owner+8)!=guid:raise ValueError('PostProcessor owner GUID mismatch')
            vtable=process.u64(component);flags=process.read(owner+0x1b0,16)
            backend=process.u64(process.u64(process.u64(owner+0xe0)+0xe0)+0x40);backends.append(backend)
            post_components.append(dict(proxy=key,destroyFunction=hex(process.u64(vtable)-process.base+process.image_base),typeFunction=hex(process.u64(vtable+0x30)-process.base+process.image_base),
                finalizeFunction=hex(process.u64(vtable+0x38)-process.base+process.image_base),awake=not bool(flags[4]),canSleep=bool(flags[6]),componentsAllowSleep=bool(flags[11])))
        if len(set(backends))!=1:raise ValueError('Expected shared PostProcessor backend')
        backend=backends[0];buckets=process.u64(backend+0x60);bucket_count=process.u32(backend+0x68)
        if not 1<=bucket_count<=1048576:raise ValueError('Invalid uniform bucket count')
        uniforms=[];seen=set();dims={0x1404b38f8:1,0x1404b3930:2,0x1404b3968:3,0x1404b39a0:4}
        for i in range(bucket_count):
            node=process.u64(buckets+i*8)
            while node:
                if node in seen or len(seen)>65536:raise ValueError('Invalid uniform node chain')
                seen.add(node);entry=process.u64(node+8);vtable=process.u64(entry)-process.base+process.image_base
                if vtable not in dims:raise ValueError('Unknown native uniform vtable '+hex(vtable))
                dimension=dims[vtable];name=process.u32(node)
                if process.u32(entry+8)!=name:raise ValueError('Uniform StringID mismatch')
                uniforms.append(dict(id=name,dimensions=dimension,valueBits=process.read(entry+12,dimension*4).hex(),
                    previousBits=process.read(entry+12+dimension*4,dimension*4).hex(),vtable=hex(vtable)))
                node=process.u64(node+0x10)
        if len(uniforms)!=process.u32(backend+0x6c):raise ValueError('Uniform map size mismatch')
        uniforms.sort(key=lambda row:row['id'])
        buckets=process.u64(backend+0xf0);bucket_count=process.u32(backend+0xf8)
        if not 1<=bucket_count<=1048576:raise ValueError('Invalid sampler bucket count')
        samplers=[];seen=set()
        for i in range(bucket_count):
            node=process.u64(buckets+i*8)
            while node:
                if node in seen or len(seen)>65536:raise ValueError('Invalid sampler node chain')
                seen.add(node);entry=process.u64(node+8)
                texture,previous,wrap,min_filter,mag_filter,mip_filter=struct.unpack('<6i',process.read(entry+0x10,24))
                samplers.append(dict(id=process.u32(node),textureHandle=texture,previousHandle=previous,wrap=wrap,minFilter=min_filter,
                    magFilter=mag_filter,mipFilter=mip_filter,vtable=hex(process.u64(entry)-process.base+process.image_base)))
                node=process.u64(node+0x10)
        if len(samplers)!=process.u32(backend+0xfc):raise ValueError('Sampler map size mismatch')
        samplers.sort(key=lambda row:row['id'])
        post_state=dict(sharedComponent=addresses[0]==addresses[1],otherComponent=addresses[0]!=addresses[2],sharedBackend=True,
            enabled=bool(process.read(backend+8,1)[0]),uniforms=uniforms,samplers=samplers,components=post_components)
        fm_data=(trace.parent/'wasm_font_manager_trace').read_bytes()
        if not fm_data.startswith(b'KLEI     1 '):raise ValueError('Expected plain FontManager trace')
        fm=json.loads(fm_data[11:]);fm_components=[];addresses=[];registries=[]
        for key,guid in [('first',fm['guid']),('second',fm['guid']),('other',fm['otherGuid'])]:
            match=re.fullmatch(r'FontManager \((?:0x)?([0-9a-fA-F]+)\)',fm[key])
            if not match:raise ValueError('Unknown FontManager proxy format')
            component=process.u64(int(match[1],16)+8);addresses.append(component);owner=process.u64(component+0x18)
            if process.u32(owner+8)!=guid:raise ValueError('FontManager owner GUID mismatch')
            vtable=process.u64(component);flags=process.read(owner+0x1b0,16)
            renderer=process.u64(process.u64(process.u64(owner+0xe0)+0xe0)+0x48);registries.append(process.u64(renderer+0x918))
            fm_components.append(dict(proxy=key,typeFunction=hex(process.u64(vtable+0x30)-process.base+process.image_base),
                destroyFunction=hex(process.u64(vtable)-process.base+process.image_base),finalizeFunction=hex(process.u64(vtable+0x38)-process.base+process.image_base),
                awake=not bool(flags[4]),canSleep=bool(flags[6]),componentsAllowSleep=bool(flags[11])))
        if len(set(registries))!=1:raise ValueError('Expected shared FONT registry')
        fm_state=dict(sharedComponent=addresses[0]==addresses[1],otherComponent=addresses[0]!=addresses[2],sharedRegistry=True,components=fm_components)
        ml_data=(trace.parent/'wasm_map_layer_component_trace').read_bytes()
        if not ml_data.startswith(b'KLEI     1 '):raise ValueError('Expected plain MapLayerManager trace')
        ml=json.loads(ml_data[11:]);ml_components=[];addresses=[]
        for key,guid in [('first',ml['guid']),('second',ml['guid']),('globalManager',ml['globalGuid'])]:
            match=re.fullmatch(r'MapLayerManager \((?:0x)?([0-9a-fA-F]+)\)',ml[key])
            if not match:raise ValueError('Unknown MapLayerManager proxy format')
            component=process.u64(int(match[1],16)+8);addresses.append(component);owner=process.u64(component+0x18)
            if process.u32(owner+8)!=guid:raise ValueError('MapLayerManager owner GUID mismatch')
            vtable=process.u64(component);flags=process.read(owner+0x1b0,16)
            begin,end=process.u64(component+0x58),process.u64(component+0x60)
            if end<begin or (end-begin)%64 or end-begin>65536*64:raise ValueError('Invalid map layer slot array')
            layers=[]
            for slot in range(begin,end,64):
                if not process.u32(slot):continue
                layer=process.u64(slot+8)
                groups=[];uv=bytearray()
                for i in range(48):
                    first,last=process.u64(layer+0x98+i*32),process.u64(layer+0xa0+i*32)
                    if last<first or (last-first)%16 or last-first>1048576:raise ValueError('Invalid map UV vector')
                    size=(last-first)//16;groups.append(size);uv.extend(struct.pack('<I',size))
                    if size:uv.extend(process.read(first,last-first))
                layers.append(dict(handle=(slot-begin)//64,tileId=struct.unpack('<H',process.read(layer,2))[0],sampleStyle=struct.unpack('<i',process.read(layer+4,4))[0],
                    textureHandle=struct.unpack('<i',process.read(layer+8,4))[0],noiseHandle=struct.unpack('<i',process.read(layer+12,4))[0],colourBits=process.read(layer+0x20,64).hex(),
                    shapeCount=process.u32(layer+0x690),uvCounts=groups,uvSha256=hashlib.sha256(uv).hexdigest()))
            ml_components.append(dict(proxy=key,typeFunction=hex(process.u64(vtable+0x30)-process.base+process.image_base),
                finalizeFunction=hex(process.u64(vtable+0x38)-process.base+process.image_base),destroyFunction=hex(process.u64(vtable)-process.base+process.image_base),
                sampleStyle=struct.unpack('<i',process.read(component+0x100,4))[0],resourcesBound=bool(process.u64(component+0xd0)) and bool(process.u64(component+0xd8)),
                layers=layers,awake=not bool(flags[4]),canSleep=bool(flags[6]),componentsAllowSleep=bool(flags[11])))
        ml_state=dict(sharedComponent=addresses[0]==addresses[1],components=ml_components)
        physics_data=(trace.parent/'wasm_physics_radius_trace').read_bytes()
        radius_bits=process.read(process.base+0x5f2d68,4)
        physics_state=dict(traceSha256=hashlib.sha256(physics_data).hexdigest(),maxPhysicsRadius=struct.unpack('<f',radius_bits)[0],bits=radius_bits.hex())
        launches_data=(trace.parent/'wasm_sim_launches_trace').read_bytes()
        if not launches_data.startswith(b'KLEI     1 '):raise ValueError('Expected plain Sim launch counter trace')
        launches_value=process.u32(process.base+0x5f30c4)
        if json.loads(launches_data[11:])['calls']!=[[launches_value]]*3:raise ValueError('Sim launch counter trace/memory mismatch')
        launches_state=dict(traceSha256=hashlib.sha256(launches_data).hexdigest(),count=launches_value)
        play_data=(trace.parent/'wasm_play_instance_trace').read_bytes()
        if not play_data.startswith(b'KLEI     1 '):raise ValueError('Expected plain play instance trace')
        # Entity +e0 -> Sim, Sim +e0 -> application. The +48 branch used by
        # FontManager above is its renderer, not another Sim/application.
        application=process.u64(process.u64(owner+0xe0)+0xe0)
        application_vtable=process.u64(application)-process.base+process.image_base
        if not process.image_base<=application_vtable<process.image_base+0x800000:raise ValueError('Sim application vtable outside verified image: '+hex(application_vtable))
        play_value=struct.unpack('<i',process.read(application+0x130,4))[0]
        if json.loads(play_data[11:])['initial']!=play_value:raise ValueError('Play instance trace/memory mismatch')
        play_state=dict(traceSha256=hashlib.sha256(play_data).hexdigest(),value=play_value,applicationVtable=hex(application_vtable))
        ui_data=(trace.parent/'wasm_ui_transform_trace').read_bytes()
        if not ui_data.startswith(b'KLEI     1 '):raise ValueError('Expected plain UITransform trace')
        ui_oracle=json.loads(ui_data[11:]);ui_components=[]
        for row in ui_oracle['objects']:
            proxies=[];component=None;owner=None
            for name in ['first','second']:
                match=re.fullmatch(r'UITransform \((?:0x)?([0-9a-fA-F]+)\)',row[name])
                if not match:raise ValueError('Unknown UITransform proxy format')
                current=process.u64(int(match[1],16)+8);proxies.append(current)
                if component is not None and component!=current:raise ValueError('UI wrappers do not share component')
                component=current;owner=process.u64(component+0x18)
                if process.u32(owner+8)!=row['guid']:raise ValueError('UITransform owner GUID mismatch')
            vtable=process.u64(component);flags=process.read(owner+0x1b0,16)
            def short_rect(offset):
                pointer=process.u64(component+offset)
                return list(struct.unpack('<4h',process.read(pointer,8))) if pointer else None
            ui_components.append(dict(name=row['name'],guid=row['guid'],sameComponent=True,typeFunction=hex(process.u64(vtable+0x30)-process.base+process.image_base),
                finalizeFunction=hex(process.u64(vtable+0x38)-process.base+process.image_base),destroyFunction=hex(process.u64(vtable)-process.base+process.image_base),
                hAnchor=process.u32(component+0x68),vAnchor=process.u32(component+0x6c),scaleMode=struct.unpack('<i',process.read(component+0x70,4))[0],
                localPosition=list(struct.unpack('<3f',process.read(component+0x74,12))),worldPosition=list(struct.unpack('<3f',process.read(component+0x80,12))),
                scale=list(struct.unpack('<3f',process.read(component+0x8c,12))),rotationBits=process.read(component+0x98,4).hex(),facing=struct.unpack('<i',process.read(component+0x9c,4))[0],
                maxPropUpscaleBits=process.read(component+0x1a0,4).hex(),localMatrixBits=process.read(component+0xa0,64).hex(),worldMatrixBits=process.read(component+0x120,64).hex(),
                scissor=short_rect(0x1a8),transformedScissor=short_rect(0x1b0),clearScissor=bool(process.read(component+0x1b8,1)[0]),
                awake=not bool(flags[4]),canSleep=bool(flags[6]),componentsAllowSleep=bool(flags[11])))
        ui_state=dict(traceSha256=hashlib.sha256(ui_data).hexdigest(),components=ui_components)
        if trace.read_bytes()!=data:raise ValueError('Entity trace changed during read-only memory capture')
        return dict(gameBuild='756039',executableSha256=process.sha256,cases=result,traceSha256=hashlib.sha256(data).hexdigest(),componentClosures=component_closures,
            shadow=dict(traceSha256=hashlib.sha256(shadow_data).hexdigest(),components=shadow_components),
            road=dict(traceSha256=hashlib.sha256(road_data).hexdigest(),components=road_components),
            envelope=dict(traceSha256=hashlib.sha256(envelope_data).hexdigest(),component=envelope_component),
            postprocessor=dict(traceSha256=hashlib.sha256(post_data).hexdigest(),state=post_state),
            fontManager=dict(traceSha256=hashlib.sha256(fm_data).hexdigest(),state=fm_state),
            mapLayerManager=dict(traceSha256=hashlib.sha256(ml_data).hexdigest(),state=ml_state),
            physicsWaker=physics_state,
            simLaunches=launches_state,
            playInstance=play_state,
            uiTransform=ui_state,
            evidence='Read-only exact child process; GUID verified against entity+8; flags from hash-verified native setter/IsAwake/finalizer disassembly')
