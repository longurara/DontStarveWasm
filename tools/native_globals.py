"""Recover inline Lua C-function registrations omitted by class-table scans."""
import hashlib
import json
from pathlib import Path
import re
import struct
import sys

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(Path.home()/'.cache/dst-wasm-tools/python-deps'))
import pefile

def recover(executable):
    raw=executable.read_bytes();pe=pefile.PE(data=raw);base=pe.OPTIONAL_HEADER.ImageBase
    metadata=json.loads((ROOT.parent/'analysis/output'/(executable.stem+'.json')).read_text(encoding='utf8'))
    fingerprint=hashlib.sha256(raw).hexdigest()
    if fingerprint!=metadata['sha256']:raise ValueError('Executable hash mismatch')
    code_sections=[s for s in pe.sections if s.Characteristics&0x20000000]
    result=[]
    for section in code_sections:
        data=section.get_data()
        for match in re.finditer(rb'\x4c\x8d\x05....\xba\xee\xd8\xff\xff\xe8',data,re.S):
            offset=match.start();name_va=base+section.VirtualAddress+offset+7+struct.unpack_from('<i',data,offset+3)[0]
            try:name=pe.get_data(name_va-base,128).split(b'\0')[0].decode('ascii')
            except (UnicodeDecodeError,pefile.PEFormatError):continue
            if not re.fullmatch(r'[A-Za-z_]\w{0,79}',name):continue
            function_offset=data.rfind(b'\x48\x8d\x15',max(0,offset-42),offset)
            if function_offset<0:continue
            between=data[function_offset+7:offset]
            if not re.search(rb'\x45\x33\xc0\xe8',between):continue
            function_va=base+section.VirtualAddress+function_offset+7+struct.unpack_from('<i',data,function_offset+3)[0]
            if not any(base+s.VirtualAddress<=function_va<base+s.VirtualAddress+s.Misc_VirtualSize for s in code_sections):continue
            result.append(dict(name=name,functionVA=hex(function_va),registrationVA=hex(base+section.VirtualAddress+offset)))
    return dict(gameBuild='756039',file=executable.name,sha256=fingerprint,registrations=result)

def main():
    output=ROOT/'output';output.mkdir(exist_ok=True)
    for short in ['dontstarve_steam_x64','dontstarve_dedicated_server_nullrenderer_x64']:
        report=recover(ROOT.parent/'bin64'/(short+'.exe'))
        (output/(short+'-globals.json')).write_text(json.dumps(report,indent=2),encoding='utf8')
        unique={entry['name']:entry['functionVA'] for entry in report['registrations']}
        print(json.dumps(dict(file=short,unique=unique),indent=2))

if __name__=='__main__':main()
