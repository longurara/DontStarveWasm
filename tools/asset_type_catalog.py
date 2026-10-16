"""Read fixed asset-kind tables from hash-verified build 756039 images."""
import hashlib
import json
from pathlib import Path
import struct
from native_function import ROOT
import pefile
def main():
    cases=[]
    for name,table,function in [('dontstarve_dedicated_server_nullrenderer_x64',0x1404c1fa0,0x1400fcec0),('dontstarve_steam_x64',0x14052ca00,0x140108f10)]:
        path=ROOT.parent/'bin64'/(name+'.exe');data=path.read_bytes();digest=hashlib.sha256(data).hexdigest()
        metadata=json.loads((ROOT.parent/'analysis/output'/(name+'.json')).read_text())
        if digest!=metadata['sha256']:raise ValueError('Native asset table executable hash mismatch')
        pe=pefile.PE(data=data);base=pe.OPTIONAL_HEADER.ImageBase;rows=[]
        for i in range(12):
            address,kind=struct.unpack('<QI',pe.get_data(table-base+i*16,12))
            rows.append(dict(name=pe.get_string_at_rva(address-base).decode('ascii'),kind=kind))
        if len({row['name'] for row in rows})!=12 or {row['kind'] for row in rows}!=set(range(1,13)):raise ValueError('Invalid fixed asset table')
        cases.append(dict(executable='bin64/'+path.name,sha256=digest,table=hex(table),function=hex(function),rows=rows))
    if cases[0]['rows']!=cases[1]['rows']:raise ValueError('Client/server asset-kind tables differ')
    output=dict(gameBuild='756039',generatorSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),cases=cases)
    (ROOT/'output/asset-type-catalog.json').write_text(json.dumps(output,indent=2)+'\n')
    print('Native asset-kind tables:',len(cases),'images, 12 kinds each')
if __name__=='__main__':main()
