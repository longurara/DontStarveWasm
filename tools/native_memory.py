"""Read-only access to a specifically launched, hash-verified reference child."""
import ctypes as C
import hashlib
import json
from pathlib import Path
import struct

ROOT=Path(__file__).resolve().parents[1]

class ReferenceProcess:
    def __init__(self,pid,executable):
        self.executable=executable.resolve()
        self.sha256=hashlib.sha256(executable.read_bytes()).hexdigest()
        metadata=json.loads((ROOT.parent/'analysis/output'/(executable.stem+'.json')).read_text(encoding='utf8'))
        self.image_base=int(metadata['image_base'],16)
        if self.sha256!=metadata['sha256']:raise ValueError('Native executable hash mismatch')
        self.kernel=C.WinDLL('kernel32',use_last_error=True);psapi=C.WinDLL('psapi',use_last_error=True)
        self.kernel.OpenProcess.argtypes=[C.c_uint32,C.c_int,C.c_uint32];self.kernel.OpenProcess.restype=C.c_void_p
        self.kernel.ReadProcessMemory.argtypes=[C.c_void_p,C.c_void_p,C.c_void_p,C.c_size_t,C.POINTER(C.c_size_t)];self.kernel.ReadProcessMemory.restype=C.c_int
        self.kernel.CloseHandle.argtypes=[C.c_void_p];self.kernel.CloseHandle.restype=C.c_int
        psapi.EnumProcessModulesEx.argtypes=[C.c_void_p,C.c_void_p,C.c_uint32,C.POINTER(C.c_uint32),C.c_uint32];psapi.EnumProcessModulesEx.restype=C.c_int
        psapi.GetModuleFileNameExW.argtypes=[C.c_void_p,C.c_void_p,C.c_wchar_p,C.c_uint32];psapi.GetModuleFileNameExW.restype=C.c_uint32
        self.handle=self.kernel.OpenProcess(0x410,False,pid)
        if not self.handle:raise C.WinError(C.get_last_error())
        try:
            modules=(C.c_void_p*1024)();needed=C.c_uint32();name=C.create_unicode_buffer(32768)
            if not psapi.EnumProcessModulesEx(self.handle,modules,C.sizeof(modules),C.byref(needed),3):raise C.WinError(C.get_last_error())
            if not psapi.GetModuleFileNameExW(self.handle,modules[0],name,len(name)) or Path(name.value).resolve()!=self.executable:raise ValueError('Reference main module mismatch')
            self.base=modules[0]
        except Exception:
            self.close();raise
    def read(self,address,size):
        if address<=0 or address+size>=0x800000000000 or size<0 or size>1024*1024:raise ValueError('Native read exceeds capture budget/address range')
        data=C.create_string_buffer(size);actual=C.c_size_t()
        if not self.kernel.ReadProcessMemory(self.handle,address,data,size,C.byref(actual)) or actual.value!=size:raise C.WinError(C.get_last_error())
        return data.raw
    def u64(self,address):return struct.unpack('<Q',self.read(address,8))[0]
    def u32(self,address):return struct.unpack('<I',self.read(address,4))[0]
    def close(self):
        if self.handle:self.kernel.CloseHandle(self.handle);self.handle=None
    def __enter__(self):return self
    def __exit__(self,*args):self.close()
