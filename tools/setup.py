"""Install pinned local build tools without changing system configuration."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
LOCK = json.loads((ROOT / 'toolchain.lock.json').read_text())
CACHE = Path.home() / '.cache' / 'dst-wasm-tools'
CACHE.mkdir(parents=True, exist_ok=True)


def download(url, path):
    if not path.exists():
        print('Downloading', url, flush=True)
        temporary = path.with_suffix(path.suffix + '.partial')
        with urllib.request.urlopen(url, timeout=120) as response, temporary.open('wb') as output:
            shutil.copyfileobj(response, output)
        temporary.replace(path)
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    sdk = CACHE / 'emsdk'
    if not (sdk / 'emsdk.py').exists():
        archive = CACHE / ('emsdk-' + LOCK['emscripten'] + '.zip')
        download('https://github.com/emscripten-core/emsdk/archive/refs/tags/' + LOCK['emscripten'] + '.zip', archive)
        with zipfile.ZipFile(archive) as z:
            z.extractall(CACHE)
        (CACHE / ('emsdk-' + LOCK['emscripten'])).rename(sdk)
    env = os.environ.copy()
    env['EMSDK_PYTHON'] = sys.executable
    for action in ('install', 'activate'):
        subprocess.run([sys.executable, str(sdk / 'emsdk.py'), action, LOCK['emscripten']], cwd=sdk, env=env, check=True)
    vendor = ROOT / 'vendor'
    vendor.mkdir(exist_ok=True)
    lua_archive = CACHE / 'lua-5.1.5.tar.gz'
    lua_hash = download('https://www.lua.org/ftp/lua-5.1.5.tar.gz', lua_archive)
    # Published by lua.org/ftp/; verifies the exact source used in the build.
    assert lua_hash == '2640fc56a795f29d28ef15e13c34a47e223960b0240e8cb0a82d9b0738695333', lua_hash
    if not (vendor / 'lua-5.1.5' / 'src' / 'lua.h').exists():
        with tarfile.open(lua_archive) as tar:
            tar.extractall(vendor, filter='data')
    luaconf = vendor / 'lua-5.1.5' / 'src' / 'luaconf.h'
    luaconf_text = luaconf.read_text()
    if '#define LUAI_MAXUPVALUES\t60' in luaconf_text:
        luaconf.write_text(luaconf_text.replace('#define LUAI_MAXUPVALUES\t60', '#define LUAI_MAXUPVALUES\t160'))
    bit_archive=CACHE/('LuaBitOp-'+LOCK['luaBitOp']+'.tar.gz')
    bit_hash=download('https://bitop.luajit.org/download/'+bit_archive.name,bit_archive)
    assert bit_hash==LOCK['luaBitOpSha256'],'LuaBitOp source hash mismatch'
    if not (vendor/('LuaBitOp-'+LOCK['luaBitOp'])/'bit.c').exists():
        with tarfile.open(bit_archive) as tar:tar.extractall(vendor,filter='data')
    flac_archive=CACHE/('dr_flac-'+LOCK['drFlacCommit']+'.h')
    flac_hash=download('https://raw.githubusercontent.com/mackron/dr_libs/'+LOCK['drFlacCommit']+'/dr_flac.h',flac_archive)
    assert flac_hash==LOCK['drFlacSha256'],'dr_flac source hash mismatch'
    (vendor/'dr_libs').mkdir(exist_ok=True)
    shutil.copyfile(flac_archive,vendor/'dr_libs/dr_flac.h')
    xml_archive=CACHE/('rapidxml-'+LOCK['rapidXml']+'.zip')
    xml_hash=download('https://downloads.sourceforge.net/project/rapidxml/rapidxml/rapidxml%20'+LOCK['rapidXml']+'/'+xml_archive.name,xml_archive)
    assert xml_hash==LOCK['rapidXmlSha256'],'RapidXML source hash mismatch'
    with zipfile.ZipFile(xml_archive) as archive:
        for name in ['rapidxml.hpp','license.txt']:
            target=vendor/('rapidxml-'+LOCK['rapidXml'])/name
            target.parent.mkdir(exist_ok=True)
            target.write_bytes(archive.read('rapidxml-'+LOCK['rapidXml']+'/'+name))
    deps = CACHE / 'python-deps'
    if not (deps / 'cmake').exists():
        subprocess.run([sys.executable, '-m', 'pip', 'install', '--disable-pip-version-check', '--target', str(deps),
                        'cmake==' + LOCK['cmake'], 'ninja==' + LOCK['ninja']], check=True)
    if not (deps/'soundfile.py').exists():
        subprocess.run([sys.executable,'-m','pip','install','--disable-pip-version-check','--target',str(deps)]+[
            key+'=='+LOCK[key] for key in ['soundfile','numpy','cffi','pycparser']],check=True)
    if not (deps/'pefile.py').exists() or not (deps/'capstone').exists():
        subprocess.run([sys.executable,'-m','pip','install','--disable-pip-version-check','--target',str(deps)]+[
            key+'=='+LOCK[key] for key in ['pefile','capstone']],check=True)
    config = dict(sdk=str(sdk), python=sys.executable,
                  node=str(next((sdk / 'node').glob('*/bin/node.exe'))),
                  cmake=str(deps / 'cmake' / 'data' / 'bin' / 'cmake.exe'),
                  ninja=str(deps / 'bin' / 'ninja.exe'), luaSha256=lua_hash)
    local = ROOT / '.cache'
    local.mkdir(exist_ok=True)
    (local / 'tools.json').write_text(json.dumps(config, indent=2))
    print('Local tool configuration:', local / 'tools.json', flush=True)


if __name__ == '__main__':
    main()
