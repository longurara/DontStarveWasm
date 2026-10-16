"""Run pinned Ghidra headlessly against the hash-verified reference executable."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

ROOT=Path(__file__).resolve().parents[1]

def main(addresses):
    name='dontstarve_dedicated_server_nullrenderer_x64'
    executable=ROOT.parent/'bin64'/(name+'.exe')
    metadata=json.loads((ROOT.parent/'analysis/output'/(name+'.json')).read_text(encoding='utf8'))
    with executable.open('rb') as stream:fingerprint=hashlib.file_digest(stream,'sha256').hexdigest()
    if fingerprint!=metadata['sha256']:raise ValueError('Reference executable hash mismatch')
    settings=json.loads((ROOT/'.cache/analysis-tools.json').read_text(encoding='utf8'))
    lock=json.loads((ROOT/'analysis-tools.lock.json').read_text(encoding='utf8'))['ghidra']
    if settings['version']!=lock['version'] or settings['archiveSha256']!=lock['sha256']:raise ValueError('Ghidra tool lock mismatch')
    project=ROOT/'output/ghidra';project.mkdir(parents=True,exist_ok=True)
    output=ROOT/'output/native-decomp';output.mkdir(parents=True,exist_ok=True)
    marker=project/'import.json';ready=False
    if marker.exists():
        previous=json.loads(marker.read_text(encoding='utf8'));ready=previous.get('executableSha256')==fingerprint and previous.get('ghidraVersion')==lock['version']
    command=[str(Path(settings['ghidra'])/'support/analyzeHeadless.bat'),str(project),'dst756039']
    command+=['-process',executable.name,'-noanalysis'] if ready else ['-import',str(executable),'-overwrite','-analysisTimeoutPerFile','180','-max-cpu','4']
    command+=['-scriptPath',str(ROOT/'tools/ghidra'),'-postScript','DumpFunctions.java',str(output),*[hex(value) for value in addresses]]
    environment=os.environ.copy();jdk=Path('C:/Program Files/Java/jdk-25.0.4.1')
    if (jdk/'bin/java.exe').exists():environment['JAVA_HOME']=str(jdk)
    result=subprocess.run(command,cwd=ROOT,env=environment)
    if result.returncode:raise SystemExit(result.returncode)
    for value in addresses:
        path=output/('fn_'+format(value,'x')+'.c')
        # Address formatting may include a leading zero, depending on language.
        if not path.exists():raise ValueError('Ghidra output missing: '+str(path))
    marker.write_text(json.dumps(dict(executableSha256=fingerprint,ghidraVersion=lock['version']),indent=2)+'\n',encoding='utf8')
    print('Verified decompilation output:',output,flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('addresses',nargs='+',type=lambda value:int(value,0))
    main(parser.parse_args().addresses)
