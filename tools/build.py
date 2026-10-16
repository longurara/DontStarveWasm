import json
import hashlib
import os
from pathlib import Path
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]

def main():
    lock=json.loads((ROOT/'toolchain.lock.json').read_text())
    header=ROOT/'vendor'/('rapidxml-'+lock['rapidXml'])/'rapidxml.hpp'
    if not header.exists() or hashlib.sha256(header.read_bytes()).hexdigest()!=lock['rapidXmlHeaderSha256']:
        raise SystemExit('RapidXML header missing or changed; run tools/setup.py')
    luaconf=ROOT/'vendor/lua-5.1.5/src/luaconf.h'
    if luaconf.exists() and '#define LUAI_MAXUPVALUES\t60' in luaconf.read_text():
        luaconf.write_text(luaconf.read_text().replace('#define LUAI_MAXUPVALUES\t60','#define LUAI_MAXUPVALUES\t160'))
    config=json.loads((ROOT/'.cache/tools.json').read_text())
    sdk=Path(config['sdk'])
    env=os.environ.copy()
    env['EMSDK_PYTHON']=config['python']
    env['EM_CONFIG']=str(sdk/'.emscripten')
    env['EMSDK_NODE']=config['node']
    env['PATH']=os.pathsep.join([str(sdk/'upstream/emscripten'),str(sdk/'upstream/bin'),str(Path(config['ninja']).parent),env['PATH']])
    build=ROOT/'build'
    subprocess.run([config['cmake'],'-S',str(ROOT),'-B',str(build),'-G','Ninja',
                    '-DCMAKE_MAKE_PROGRAM='+config['ninja'],
                    '-DCMAKE_TOOLCHAIN_FILE='+str(sdk/'upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake'),
                    '-DCMAKE_BUILD_TYPE=RelWithDebInfo'],env=env,check=True)
    subprocess.run([config['cmake'],'--build',str(build),'--parallel','8'],env=env,check=True)
    from prepare import finalize_engine
    finalize_engine()

if __name__=='__main__': main()
