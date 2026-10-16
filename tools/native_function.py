"""Read-only disassembly of a hash-verified build 756039 executable function."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(Path.home()/'.cache/dst-wasm-tools/python-deps'))
import capstone
import pefile

def disassemble(executable, address, limit=160, byte_count=None):
    raw=executable.read_bytes()
    metadata=json.loads((ROOT.parent/'analysis/output'/(executable.stem+'.json')).read_text(encoding='utf8'))
    if hashlib.sha256(raw).hexdigest()!=metadata['sha256']:
        raise ValueError('Executable fingerprint mismatch')
    pe=pefile.PE(data=raw);base=pe.OPTIONAL_HEADER.ImageBase;rva=address-base
    # Unwind regions may split one function into several records. An explicit
    # byte range allows inspection of the continuation without guessing a ret.
    end=next((entry.struct.EndAddress for entry in pe.DIRECTORY_ENTRY_EXCEPTION
              if entry.struct.BeginAddress<=rva<entry.struct.EndAddress),rva+2048)
    decoder=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64)
    return '\n'.join(f'{ins.address:#x}: {ins.mnemonic:8s} {ins.op_str}'
                     for ins in decoder.disasm(pe.get_data(rva,byte_count or min(end-rva,4096)),address,count=limit))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('address',type=lambda value:int(value,0))
    parser.add_argument('--client',action='store_true')
    parser.add_argument('--limit',type=int,default=160)
    parser.add_argument('--bytes',type=int)
    args=parser.parse_args()
    name='dontstarve_steam_x64' if args.client else 'dontstarve_dedicated_server_nullrenderer_x64'
    print(disassemble(ROOT.parent/'bin64'/(name+'.exe'),args.address,args.limit,args.bytes))
