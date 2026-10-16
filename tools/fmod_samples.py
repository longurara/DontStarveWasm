"""Offline FSB -> lossless FLAC conversion using the installed native decoder.

No game DLL is part of the web runtime. Every converted sample is decoded back
from FLAC and compared byte-for-byte with FMOD's PCM before publishing its hash.
Event graphs are a separate gate; this tool does not invent FEV routing.
"""
import argparse
import ctypes as C
import hashlib
import io
import json
import os
import subprocess
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[1]
GAME=ROOT.parent
sys.path.insert(0,str(Path.home()/'.cache/dst-wasm-tools/python-deps'))
import numpy as np
import soundfile as sf

PTR=C.c_void_p
INT=C.c_int
UINT=C.c_uint
FLOAT=C.c_float

def sha(path):
    result=hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):result.update(block)
    return result.hexdigest()

def flac_from_pcm(pcm,rate,channels):
    if not 1<=channels<=8 or rate<=0 or len(pcm)%(channels*2):raise ValueError('Invalid PCM16 layout')
    samples=np.frombuffer(pcm,dtype='<i2').reshape((-1,channels))
    output=io.BytesIO()
    sf.write(output,samples,rate,format='FLAC',subtype='PCM_16')
    payload=output.getvalue()
    restored,restored_rate=sf.read(io.BytesIO(payload),dtype='int16',always_2d=True)
    if restored_rate!=rate or restored.shape!=samples.shape or restored.astype('<i2').tobytes()!=pcm:
        raise ValueError('Lossless FLAC round trip failed')
    return payload,len(samples)

class Decoder:
    def __init__(self):
        self.directory=os.add_dll_directory(str(GAME/'bin64'))
        self.library=C.WinDLL(str(GAME/'bin64/fmodex64.dll'))
        self.system=PTR()
        self.bind('FMOD_System_Create',[C.POINTER(PTR)])(C.byref(self.system))
        self.bind('FMOD_System_SetOutput',[PTR,INT])(self.system,2) # NOSOUND
        self.bind('FMOD_System_Init',[PTR,INT,UINT,PTR])(self.system,64,0,None)
        self.stream=self.bind('FMOD_System_CreateSound',[PTR,C.c_char_p,UINT,PTR,C.POINTER(PTR)])
        self.count=self.bind('FMOD_Sound_GetNumSubSounds',[PTR,C.POINTER(INT)])
        self.sub=self.bind('FMOD_Sound_GetSubSound',[PTR,INT,C.POINTER(PTR)])
        self.name=self.bind('FMOD_Sound_GetName',[PTR,PTR,INT])
        self.length=self.bind('FMOD_Sound_GetLength',[PTR,C.POINTER(UINT),INT])
        self.format=self.bind('FMOD_Sound_GetFormat',[PTR,C.POINTER(INT),C.POINTER(INT),C.POINTER(INT),C.POINTER(INT)])
        self.defaults=self.bind('FMOD_Sound_GetDefaults',[PTR,C.POINTER(FLOAT),PTR,PTR,PTR])
        self.seek=self.bind('FMOD_Sound_SeekData',[PTR,UINT])
        self.read=self.bind('FMOD_Sound_ReadData',[PTR,PTR,UINT,C.POINTER(UINT)])
        self.release=self.bind('FMOD_Sound_Release',[PTR])
    def bind(self,name,args):
        fn=getattr(self.library,name);fn.argtypes=args;fn.restype=INT
        def checked(*values):
            result=fn(*values)
            if result:raise RuntimeError(name+' failed: '+str(result))
            return result
        return checked
    def samples(self,path):
        bank=PTR()
        print(path.name,'opening native stream',flush=True)
        # OPENONLY | LOOP_OFF | ACCURATETIME. createSound avoids a shared
        # streaming decoder blocking on multi-subsound streaming banks.
        self.stream(self.system,path.resolve().as_posix().encode(),0x6001,None,C.byref(bank))
        try:
            count=INT();self.count(bank,C.byref(count))
            if count.value<=0:raise ValueError('Expected an FSB with subsounds')
            for index in range(count.value):
                sample=PTR();self.sub(bank,index,C.byref(sample))
                name=C.create_string_buffer(1024);self.name(sample,name,len(name))
                kind=INT();fmt=INT();channels=INT();bits=INT();size=UINT();rate=FLOAT()
                self.format(sample,C.byref(kind),C.byref(fmt),C.byref(channels),C.byref(bits))
                if fmt.value!=2 or bits.value!=16:
                    raise ValueError(f'{index}: Unsupported PCM format {fmt.value}/{bits.value}; no lossy conversion')
                self.length(sample,C.byref(size),4) # FMOD_TIMEUNIT_PCMBYTES
                self.defaults(sample,C.byref(rate),None,None,None)
                if not 0<size.value<=256*1024*1024:raise ValueError('Invalid/oversized decoded sample')
                if rate.value!=int(rate.value):raise ValueError('Non-integral sample rate')
                buffer=C.create_string_buffer(size.value);actual=UINT()
                # Each subsound shares a streaming decoder. Reposition it before
                # reading, including index zero, or later reads can use stale state.
                self.seek(sample,0)
                cursor=0
                while cursor<size.value:
                    requested=min(16384,size.value-cursor)
                    try:self.read(sample,C.byref(buffer,cursor),requested,C.byref(actual))
                    except RuntimeError as error:raise RuntimeError(f'{index} {name.value!r} at PCM byte {cursor}/{size.value}: {error}') from error
                    if actual.value!=requested:raise ValueError(f'Truncated PCM at sample {index}: {cursor+actual.value}/{size.value}')
                    cursor+=actual.value
                yield dict(index=index,name=name.value.decode('utf8'),sampleRate=int(rate.value),channels=channels.value,
                           bitsPerSample=bits.value,pcmBytes=size.value),buffer.raw
        finally:self.release(bank)
    def close(self):
        self.bind('FMOD_System_Release',[PTR])(self.system)
        self.directory.close()

def atomic_json(path,value):
    temporary=path.with_suffix('.pending')
    temporary.write_text(json.dumps(value,indent=2),encoding='utf8');temporary.replace(path)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--bank',action='append',help='FSB basename; repeat or omit for all 153 banks')
    parser.add_argument('--worker',action='store_true',help=argparse.SUPPRESS)
    args=parser.parse_args()
    if (GAME/'version.txt').read_text().strip()!='756039':raise ValueError('Unsupported build')
    paths=sorted((GAME/'data/sound').glob('*.fsb'))
    if args.bank:
        wanted=set(args.bank);paths=[p for p in paths if p.name in wanted]
        if {p.name for p in paths}!=wanted:raise ValueError('Unknown bank basename')
    output=ROOT/'public/generated/audio';blobs=output/'samples';banks=output/'banks'
    blobs.mkdir(parents=True,exist_ok=True);banks.mkdir(exist_ok=True)
    if not args.worker:
        # Native decoders run out of process with a bank-sized timeout. A bad
        # bank cannot hang conversion indefinitely or poison the next decoder.
        successes=[];failures=[]
        for path in paths:
            try:
                process=subprocess.run([sys.executable,str(Path(__file__).resolve()),'--bank',path.name,'--worker'],
                                       capture_output=True,text=True,timeout=90)
                if process.returncode:raise ValueError((process.stdout+process.stderr)[-2000:])
                report=json.loads((banks/(path.stem+'.json')).read_text(encoding='utf8'))
                successes.append(dict(source=report['source'],sha256=report['sha256'],samples=len(report['samples']),url='audio/banks/'+path.stem+'.json'))
                print(path.name,len(report['samples']),'PCM verified samples',flush=True)
            except (ValueError,subprocess.TimeoutExpired) as error:
                failures.append(dict(source=path.name,error=str(error)));print(path.name,'FAILED:',str(error)[-300:],flush=True)
        index=dict(gameBuild='756039',converterVersion=2,scope=[p.name for p in paths],allBanksRequested=not bool(args.bank),
                   banks=successes,errors=failures,completeGraphConversion=False)
        atomic_json(output/('sample-index.json' if not args.bank else 'sample-subset-index.json'),index)
        print(json.dumps(dict(banks=len(successes),samples=sum(p['samples'] for p in successes),failedBanks=[p['source'] for p in failures]),indent=2))
        if failures:raise SystemExit(1)
        return
    decoder=Decoder();results=[];failures=[]
    decoder_hash=sha(GAME/'bin64/fmodex64.dll')
    try:
        for path in paths:
            fingerprint=sha(path);destination=banks/(path.stem+'.json')
            report=None
            if destination.exists():
                old=json.loads(destination.read_text(encoding='utf8'))
                if old.get('sha256')==fingerprint and old.get('decoderSha256')==decoder_hash and old.get('converterVersion')==2:
                    if all((blobs/(s['sha256']+'.flac')).is_file() and sha(blobs/(s['sha256']+'.flac'))==s['sha256'] for s in old['samples']):
                        report=old
            if report is None:
                try:
                    samples=[]
                    for meta,pcm in decoder.samples(path):
                        flac,frames=flac_from_pcm(pcm,meta['sampleRate'],meta['channels'])
                        content_hash=hashlib.sha256(flac).hexdigest()
                        target=blobs/(content_hash+'.flac')
                        if not target.exists():target.write_bytes(flac)
                        elif sha(target)!=content_hash:raise ValueError('Corrupt content-addressed audio blob')
                        samples.append(dict(**meta,frames=frames,sha256=content_hash,pcmSha256=hashlib.sha256(pcm).hexdigest(),
                                            url='audio/samples/'+target.name,bytes=len(flac)))
                    report=dict(gameBuild='756039',converterVersion=2,source=path.relative_to(GAME).as_posix(),sha256=fingerprint,
                                decoderSha256=decoder_hash,pcmVerified=True,samples=samples)
                    atomic_json(destination,report)
                except (RuntimeError,ValueError) as error:
                    failures.append(dict(source=path.name,error=str(error)));print(path.name,str(error),flush=True);continue
            results.append(report)
            print(path.name,len(report['samples']),'PCM verified samples',flush=True)
    finally:decoder.close()
    # An index is scoped to the requested bank list. Never describe a selected
    # subset as a complete game audio conversion.
    index=dict(gameBuild='756039',converterVersion=1,scope=[p.name for p in paths],allBanksRequested=not bool(args.bank),
               banks=[dict(source=p['source'],sha256=p['sha256'],samples=len(p['samples']),url='audio/banks/'+Path(p['source']).stem+'.json') for p in results],
               errors=failures,completeGraphConversion=False)
    if not args.worker:atomic_json(output/('sample-index.json' if not args.bank else 'sample-subset-index.json'),index)
    print(json.dumps(dict(banks=len(results),samples=sum(len(p['samples']) for p in results),errors=failures),indent=2))
    if failures:raise SystemExit(1)

if __name__=='__main__':main()
