"""Install the pinned, official Ghidra distribution in the user's tool cache."""
import hashlib
import json
from pathlib import Path
import urllib.request
import zipfile

ROOT=Path(__file__).resolve().parents[1]

def main():
    lock=json.loads((ROOT/'analysis-tools.lock.json').read_text(encoding='utf8'))['ghidra']
    cache=Path.home()/'.cache/dst-wasm-tools';cache.mkdir(parents=True,exist_ok=True)
    archive=cache/lock['archive']
    if not archive.exists():
        temporary=archive.with_suffix('.zip.partial')
        request=urllib.request.Request(lock['url'],headers={'User-Agent':'DST-WASM-native-analysis'})
        with urllib.request.urlopen(request,timeout=60) as response,temporary.open('wb') as output:
            total=0;reported=0
            while chunk:=response.read(1024*1024):
                output.write(chunk);total+=len(chunk)
                if total-reported>=64*1024*1024:print('Ghidra download MiB:',total//(1024*1024),flush=True);reported=total
        if hashlib.file_digest(temporary.open('rb'),'sha256').hexdigest()!=lock['sha256']:raise ValueError('Ghidra download hash mismatch')
        temporary.replace(archive)
    with archive.open('rb') as stream:
        if hashlib.file_digest(stream,'sha256').hexdigest()!=lock['sha256']:raise ValueError('Ghidra archive hash mismatch')
    install=cache/lock['directory']
    if not (install/'support/analyzeHeadless.bat').exists():
        with zipfile.ZipFile(archive) as source:
            for member in source.infolist():
                target=(cache/member.filename).resolve()
                if not target.is_relative_to(install.resolve()) or member.filename.startswith('/') or (member.external_attr>>16)&0o170000==0o120000:
                    raise ValueError('Unsafe Ghidra archive member: '+member.filename)
            source.extractall(cache)
    config=ROOT/'.cache/analysis-tools.json';config.parent.mkdir(parents=True,exist_ok=True)
    config.write_text(json.dumps(dict(ghidra=str(install),version=lock['version'],archiveSha256=lock['sha256']),indent=2)+'\n',encoding='utf8')
    print('Pinned Ghidra ready:',install,flush=True)

if __name__=='__main__':main()
