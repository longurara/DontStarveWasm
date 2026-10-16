"""Read-only capture of the isolated reference process's dataset fingerprint.

Offsets come from build 756039's InventoryProxy wrappers and MSVC110 strings.
Never writes process memory, patches code, or reads another game/user process.
"""
import ctypes as C
import hashlib
import json
from pathlib import Path
import struct
import sys

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(Path.home()/'.cache/dst-engine-probe-python'))
sys.path.insert(0,str(Path.home()/'.cache/dst-wasm-tools/python-deps'))
import pefile
from capstone import Cs,CS_ARCH_X86,CS_MODE_64
from capstone.x86 import X86_OP_MEM,X86_REG_RIP

def capture(pid,executable):
    meta=json.loads((ROOT.parent/'analysis/output/dontstarve_dedicated_server_nullrenderer_x64.json').read_text(encoding='utf8'))
    raw=executable.read_bytes();sha=hashlib.sha256(raw).hexdigest()
    if sha!=meta['sha256']:raise ValueError('Native executable hash mismatch')
    pe=pefile.PE(data=raw);base=pe.OPTIONAL_HEADER.ImageBase
    method=next(m for g in meta['engine_binding_groups'] if g['class_candidate']=='InventoryProxy' for m in g['methods'] if m['name']=='ClearSkinsDataset')
    address=int(method['function_va'],16);md=Cs(CS_ARCH_X86,CS_MODE_64);md.detail=True
    global_address=None
    for ins in md.disasm(pe.get_data(address-base,40),address):
        if ins.mnemonic=='mov' and len(ins.operands)==2 and ins.operands[1].type==X86_OP_MEM and ins.operands[1].mem.base==X86_REG_RIP:
            global_address=ins.address+ins.size+ins.operands[1].mem.disp;break
    if global_address is None:raise ValueError('Cannot identify inventory manager global')
    kernel=C.WinDLL('kernel32',use_last_error=True);psapi=C.WinDLL('psapi',use_last_error=True)
    kernel.OpenProcess.argtypes=[C.c_uint32,C.c_int,C.c_uint32];kernel.OpenProcess.restype=C.c_void_p
    kernel.ReadProcessMemory.argtypes=[C.c_void_p,C.c_void_p,C.c_void_p,C.c_size_t,C.POINTER(C.c_size_t)];kernel.ReadProcessMemory.restype=C.c_int
    kernel.CloseHandle.argtypes=[C.c_void_p];kernel.CloseHandle.restype=C.c_int
    psapi.EnumProcessModulesEx.argtypes=[C.c_void_p,C.c_void_p,C.c_uint32,C.POINTER(C.c_uint32),C.c_uint32];psapi.EnumProcessModulesEx.restype=C.c_int
    psapi.GetModuleFileNameExW.argtypes=[C.c_void_p,C.c_void_p,C.c_wchar_p,C.c_uint32];psapi.GetModuleFileNameExW.restype=C.c_uint32
    handle=kernel.OpenProcess(0x410,False,pid)
    if not handle:raise C.WinError(C.get_last_error())
    try:
        modules=(C.c_void_p*1024)();needed=C.c_uint32()
        if not psapi.EnumProcessModulesEx(handle,modules,C.sizeof(modules),C.byref(needed),3):raise C.WinError(C.get_last_error())
        name=C.create_unicode_buffer(32768)
        if not psapi.GetModuleFileNameExW(handle,modules[0],name,len(name)) or Path(name.value).resolve()!=executable.resolve():raise ValueError('Reference main module mismatch')
        runtime_base=modules[0]
        def read(pointer,size):
            if size<0 or size>1024*1024:raise ValueError('Native read exceeds capture budget')
            result=C.create_string_buffer(size);actual=C.c_size_t()
            if not kernel.ReadProcessMemory(handle,pointer,result,size,C.byref(actual)) or actual.value!=size:raise C.WinError(C.get_last_error())
            return result.raw
        manager=struct.unpack('<Q',read(runtime_base+global_address-base,8))[0]
        if not manager:raise ValueError('Native inventory is not initialized')
        def string(offset):
            data=read(manager+offset,40);size,capacity=struct.unpack_from('<QQ',data,24)
            if size>capacity or size>1024*1024:raise ValueError('Invalid native std::string layout')
            return (read(struct.unpack_from('<Q',data,8)[0],size) if capacity>=16 else data[8:8+size]).decode('ascii')
        fingerprint=string(0x310);signature=string(0x2e8)
        if len(fingerprint)!=64 or any(c not in '0123456789abcdef' for c in fingerprint):raise ValueError('Native dataset fingerprint is not SHA256 hex')
        counts={key:struct.unpack('<Q',read(manager+offset,8))[0] for key,offset in [('skinSets',0x150),('skinLinks',0x168),('keys',0x138),('dlc',0x1b0),('freeItems',0x200)]}
        return dict(gameBuild='756039',executableSha256=sha,datasetSha256=fingerprint,signature=signature,
                    locked=bool(read(manager+0x338,1)[0]),counts=counts,
                    evidence='ReadProcessMemory on the exact isolated child process; no process writes or patches')
    finally:kernel.CloseHandle(handle)
