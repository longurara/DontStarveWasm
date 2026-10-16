"""Extract native FMOD event metadata through the installed 4.44 C API.

This is an offline Windows conversion tool. Game DLLs are never shipped to the
browser. Unknown event graph internals are retained as source provenance rather
than flattened into invented playback definitions.
"""
import ctypes as C
import hashlib
import json
import os
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
GAME=ROOT.parent
PTR=C.c_void_p
INT=C.c_int
UINT=C.c_uint
FLOAT=C.c_float

class ReverbProperties(C.Structure):
    _fields_=[
        ('Instance',INT),('Environment',INT),('EnvDiffusion',FLOAT),
        ('Room',INT),('RoomHF',INT),('RoomLF',INT),('DecayTime',FLOAT),
        ('DecayHFRatio',FLOAT),('DecayLFRatio',FLOAT),('Reflections',INT),
        ('ReflectionsDelay',FLOAT),('Reverb',INT),('ReverbDelay',FLOAT),
        ('ModulationTime',FLOAT),('ModulationDepth',FLOAT),('HFReference',FLOAT),
        ('LFReference',FLOAT),('Diffusion',FLOAT),('Density',FLOAT),('Flags',UINT),
    ]

def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()

class Catalog:
    def __init__(self):
        self.directory=os.add_dll_directory(str(GAME/'bin64'))
        self.low=C.WinDLL(str(GAME/'bin64/fmodex64.dll'))
        self.event=C.WinDLL(str(GAME/'bin64/fmod_event64.dll'))
        self.system=PTR()
        self.bind(self.event,'FMOD_EventSystem_Create',[C.POINTER(PTR)])(C.byref(self.system))
        self.low_system=PTR()
        self.bind(self.event,'FMOD_EventSystem_GetSystemObject',[PTR,C.POINTER(PTR)])(self.system,C.byref(self.low_system))
        self.bind(self.low,'FMOD_System_SetOutput',[PTR,INT])(self.low_system,2)
        self.bind(self.event,'FMOD_EventSystem_Init',[PTR,INT,UINT,PTR,UINT])(self.system,64,0,None,0)
        self.bind(self.event,'FMOD_EventSystem_SetMediaPath',[PTR,C.c_char_p])(self.system,(GAME/'data/sound').as_posix().encode()+b'/')
        self.version=UINT()
        self.bind(self.low,'FMOD_System_GetVersion',[PTR,C.POINTER(UINT)])(self.low_system,C.byref(self.version))
        self.load=self.bind(self.event,'FMOD_EventSystem_Load',[PTR,C.c_char_p,PTR,C.POINTER(PTR)])
        self.num_groups={}
        self.group_by_index={}
        for kind in ['Project','Group']:
            self.num_groups[kind]=self.bind(self.event,'FMOD_Event'+kind+'_GetNumGroups',[PTR,C.POINTER(INT)])
            self.group_by_index[kind]=self.bind(self.event,'FMOD_Event'+kind+'_GetGroupByIndex',[PTR,INT,INT,C.POINTER(PTR)])
        self.group_info=self.bind(self.event,'FMOD_EventGroup_GetInfo',[PTR,C.POINTER(INT),C.POINTER(C.c_char_p)])
        self.num_events=self.bind(self.event,'FMOD_EventGroup_GetNumEvents',[PTR,C.POINTER(INT)])
        self.get_event=self.bind(self.event,'FMOD_EventGroup_GetEventByIndex',[PTR,INT,UINT,C.POINTER(PTR)])
        self.event_info=self.bind(self.event,'FMOD_Event_GetInfo',[PTR,C.POINTER(INT),C.POINTER(C.c_char_p),PTR])
        self.num_params=self.bind(self.event,'FMOD_Event_GetNumParameters',[PTR,C.POINTER(INT)])
        self.get_param=self.bind(self.event,'FMOD_Event_GetParameterByIndex',[PTR,INT,C.POINTER(PTR)])
        self.param_info=self.bind(self.event,'FMOD_EventParameter_GetInfo',[PTR,C.POINTER(INT),C.POINTER(C.c_char_p)])
        self.param_range=self.bind(self.event,'FMOD_EventParameter_GetRange',[PTR,C.POINTER(FLOAT),C.POINTER(FLOAT)])
        self.param_value=self.bind(self.event,'FMOD_EventParameter_GetValue',[PTR,C.POINTER(FLOAT)])
    def bind(self,library,name,args):
        fn=getattr(library,name);fn.argtypes=args;fn.restype=INT
        def checked(*values):
            result=fn(*values)
            if result:raise RuntimeError(name+' failed: '+str(result))
            return result
        return checked
    def groups(self,obj,kind,prefix,events):
        count=INT();self.num_groups[kind](obj,C.byref(count))
        for index in range(count.value):
            group=PTR();self.group_by_index[kind](obj,index,0,C.byref(group))
            number=INT();name=C.c_char_p();self.group_info(group,C.byref(number),C.byref(name))
            path=prefix+'/'+name.value.decode('utf8')
            size=INT();self.num_events(group,C.byref(size))
            for event_index in range(size.value):
                event=PTR()
                # FMOD_EVENT_INFOONLY: inspect properties without loading samples.
                self.get_event(group,event_index,0x4,C.byref(event))
                event_id=INT();event_name=C.c_char_p()
                self.event_info(event,C.byref(event_id),C.byref(event_name),None)
                params=[];num_params=INT();self.num_params(event,C.byref(num_params))
                for p in range(num_params.value):
                    param=PTR();self.get_param(event,p,C.byref(param))
                    pi=INT();pn=C.c_char_p();low=FLOAT();high=FLOAT();value=FLOAT()
                    self.param_info(param,C.byref(pi),C.byref(pn));self.param_range(param,C.byref(low),C.byref(high))
                    try:self.param_value(param,C.byref(value));default=value.value
                    except RuntimeError:default=None
                    params.append(dict(name=pn.value.decode('utf8'),index=pi.value,minimum=low.value,maximum=high.value,default=default))
                events.append(dict(path=path+'/'+event_name.value.decode('utf8'),id=event_id.value,parameters=params,graphDecoded=False))
            self.groups(group,'Group',path,events)
    def run(self):
        projects=[];errors=[]
        for path in sorted((GAME/'data/sound').glob('*.fev')):
            project=PTR()
            try:
                self.load(self.system,path.name.encode(),None,C.byref(project))
                events=[];self.groups(project,'Project',path.stem,events)
                projects.append(dict(name=path.stem,source=path.relative_to(GAME).as_posix(),sha256=sha(path),events=events))
            except RuntimeError as error:errors.append(dict(file=path.name,error=str(error)))
        presets=[];size=INT()
        self.bind(self.event,'FMOD_EventSystem_GetNumReverbPresets',[PTR,C.POINTER(INT)])(self.system,C.byref(size))
        get=self.bind(self.event,'FMOD_EventSystem_GetReverbPresetByIndex',[PTR,INT,C.POINTER(ReverbProperties),C.POINTER(C.c_char_p)])
        for i in range(size.value):
            props=ReverbProperties();name=C.c_char_p();get(self.system,i,C.byref(props),C.byref(name))
            presets.append(dict(name=name.value.decode('utf8'),properties={key:getattr(props,key) for key,_ in props._fields_}))
        return dict(gameBuild='756039',fmodVersion=hex(self.version.value),projects=projects,reverbPresets=presets,errors=errors,
                    completeGraphConversion=False)
    def close(self):
        self.bind(self.event,'FMOD_EventSystem_Release',[PTR])(self.system)
        self.directory.close()

def main():
    catalog=Catalog()
    try:result=catalog.run()
    finally:catalog.close()
    out=ROOT/'public/generated/audio';out.mkdir(parents=True,exist_ok=True)
    (out/'native-catalog.json').write_text(json.dumps(result,indent=2),encoding='utf8')
    print(json.dumps(dict(version=result['fmodVersion'],projects=len(result['projects']),events=sum(len(p['events']) for p in result['projects']),
                          presets=[p['name'] for p in result['reverbPresets']],errors=result['errors'][:5]),indent=2))

if __name__=='__main__':main()
