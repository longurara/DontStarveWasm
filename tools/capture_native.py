"""Launch only our native reference process into an isolated profile directory."""
import ctypes
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
import secrets

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'output/native-reference'

def main(advance_simulation=False):
    OUT.mkdir(parents=True,exist_ok=True)
    profile=OUT/'storage/fixtures/Cluster_1'
    shard=profile/'Master';shard.mkdir(parents=True,exist_ok=True)
    binary_source=shard/'save/wasm_io_binary_source'
    binary_source.parent.mkdir(parents=True,exist_ok=True)
    binary_source.write_bytes(b'KLEI     1 a\x00b\xff')
    run_id=secrets.token_hex(16)
    oracle_sources={name:(ROOT/'tools'/(name+'.lua')).read_bytes() for name in ['native_trace','native_asset_trace','native_entity_trace']}
    for name,source in oracle_sources.items():
        (shard/'save'/('wasm_oracle_source_'+name)).write_bytes(b'KLEI     1 '+source)
    pause='false' if advance_simulation else 'true'
    (profile/'cluster.ini').write_text('[GAMEPLAY]\ngame_mode = survival\nmax_players = 6\npause_when_empty = '+pause+'\n[NETWORK]\ncluster_name = WASM reference fixtures\ncluster_password = local-fixture-only\noffline_cluster = true\nlan_only_cluster = true\n[SHARD]\nshard_enabled = false\n')
    (shard/'server.ini').write_text('[NETWORK]\nserver_port = 12997\n[SHARD]\nis_master = true\n')
    (shard/'worldgenoverride.lua').write_text('return {override_enabled=true, preset="SURVIVAL_TOGETHER", overrides={world_size="medium"}}\n')
    executable=ROOT.parent/'bin64/dontstarve_dedicated_server_nullrenderer_x64.exe'
    command=[str(executable),'-persistent_storage_root',str(OUT/'storage'),'-conf_dir','fixtures','-cluster','Cluster_1','-shard','Master','-offline','-console']
    if os.name=='nt':ctypes.windll.kernel32.SetErrorMode(0x8003)
    started=time.time()
    with (OUT/'stdout.log').open('wb') as log:
        process=subprocess.Popen(command,cwd=executable.parent,stdout=log,stderr=subprocess.STDOUT,stdin=subprocess.PIPE,
                                 creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
        timeout=False
        inventory_error=None
        inventory_file=None
        entity_file=None
        entity_error=None
        resource_file=None
        resource_error=None
        deadline=time.monotonic()+150
        saves=[]
        ready=False
        while process.poll() is None and time.monotonic()<deadline:
            saves=[p for p in shard.rglob('*') if p.is_file() and p.name.isdigit() and p.stat().st_size>1000]
            log.flush()
            output=(OUT/'stdout.log').read_bytes()
            marker=b'LOAD BE: done' if advance_simulation else b'Sim paused'
            if saves and marker in output:ready=True;break
            time.sleep(1)
        if process.poll() is None:
            timeout=not ready
            try:
                from native_inventory_memory import capture
                inventory=capture(process.pid,executable)
                inventory_file=OUT/'inventory-dataset.json'
                inventory_file.write_text(json.dumps(inventory,indent=2),encoding='utf8')
                (OUT/'inventory-capture-error.txt').unlink(missing_ok=True)
            except Exception as error:
                inventory_error=str(error)
                (OUT/'inventory-capture-error.txt').write_text(str(error),encoding='utf8')
            # Native console input truncates large commands. Keep each command
            # short and load the exact source bytes through the native codec.
            commands=[]
            for name in oracle_sources:
                command='TheSim:GetPersistentString('+json.dumps('wasm_oracle_source_'+name)+',function(ok,source) local success,detail=pcall(function() assert(ok,"oracle source missing");local fn,err=loadstring(source,'+json.dumps('@oracle/'+name+'.lua')+');assert(fn,err);fn()end);TheSim:SetPersistentString('+json.dumps('wasm_oracle_done_'+name)+',json.encode_compliant({runId='+json.dumps(run_id)+',ok=success,error=success and "" or tostring(detail)}),false)end)\n'
                commands.append(command)
            trace=''.join(commands)
            process.stdin.write(trace.encode());process.stdin.flush()
            # c_save in the first oracle can stall the simulation. A fixed
            # delay captured pre-notification flags but post-notification Lua
            # files at shutdown. Wait for this run's commands AND callbacks.
            settle_deadline=time.monotonic()+45
            previous=None;stable=0
            while process.poll() is None and time.monotonic()<settle_deadline:
                try:
                    completions=[json.loads((shard/'save'/('wasm_oracle_done_'+name)).read_bytes()[11:]) for name in oracle_sources]
                    if not all(row.get('runId')==run_id and row.get('ok') for row in completions):raise ValueError('Oracle commands pending')
                    entity_bytes=(shard/'save/wasm_entity_trace').read_bytes()
                    rows=json.loads(entity_bytes[11:])['cases']
                    if not rows or not all(len(row['events'])>=3 for row in rows):raise ValueError('Entity notifications pending')
                    stable=stable+1 if entity_bytes==previous else 0
                    previous=entity_bytes
                    if stable>=2:break
                except (OSError,ValueError,KeyError):stable=0
                time.sleep(.25)
            else:
                entity_error='Native oracle commands/entity callbacks did not settle before capture'+(' (use --advance-simulation for lifecycle fixtures)' if not advance_simulation else '')
            try:
                if entity_error:raise ValueError(entity_error)
                from native_entity_memory import capture as capture_entities
                entity_data=capture_entities(process.pid,executable,shard/'save/wasm_entity_trace')
                entity_file=OUT/'entity-flags.json'
                entity_file.write_text(json.dumps(entity_data,indent=2),encoding='utf8')
                (OUT/'entity-capture-error.txt').unlink(missing_ok=True)
            except Exception as error:
                entity_error=str(error)
                (OUT/'entity-capture-error.txt').write_text(entity_error,encoding='utf8')
            try:
                from native_resource_memory import capture as capture_resources
                resource_data=capture_resources(process.pid,executable,shard/'save/wasm_asset_trace')
                resource_file=OUT/'resource-managers.json'
                resource_file.write_text(json.dumps(resource_data,indent=2),encoding='utf8')
            except Exception as error:resource_error=str(error)
            try: process.communicate(b'c_shutdown(true)\n',timeout=12)
            except subprocess.TimeoutExpired: process.kill();process.wait()
            if entity_file and entity_data['traceSha256']!=hashlib.sha256((shard/'save/wasm_entity_trace').read_bytes()).hexdigest():
                entity_error='Entity trace changed after read-only memory capture'
    saves=[p for p in shard.rglob('*') if p.is_file() and p.name.isdigit() and p.stat().st_size>1000]
    # Native rollback rotation deletes old numbered files on the next capture.
    # Pin their bytes by hash so a recorded attempt remains replayable while
    # another isolated native run is producing its next rollback generation.
    frozen=[]
    archive=OUT/'saves';archive.mkdir(exist_ok=True)
    for source in saves:
        data=source.read_bytes();fingerprint=hashlib.sha256(data).hexdigest()
        target=archive/(fingerprint+'.save')
        if not target.exists():target.write_bytes(data)
        elif hashlib.sha256(target.read_bytes()).hexdigest()!=fingerprint:
            raise ValueError('Corrupt archived native save: '+str(target))
        frozen.append(target)
    report=dict(started=started,elapsed=round(time.time()-started,2),exitCode=process.returncode,
                exitCodeHex=hex(process.returncode&0xffffffff),timeLimitReached=timeout,
                profile=str(profile.relative_to(ROOT)),nativeSaveFiles=[str(p.relative_to(ROOT)) for p in frozen],
                nativeSourceSaveFiles=[str(p.relative_to(ROOT)) for p in saves],
                note='Only this launched child process is terminated on timeout. Exit code alone does not prove successful world generation.')
    report['inventoryCaptureError']=inventory_error
    report['entityCaptureError']=entity_error
    report['resourceCaptureError']=resource_error
    report['simulationAdvanced']=advance_simulation
    report['nativeWorldReady']=ready
    report['oracleRunId']=run_id
    report['oracleScripts']={}
    for name in oracle_sources:
        marker=shard/'save'/('wasm_oracle_done_'+name)
        try:
            record=json.loads(marker.read_bytes()[11:])
            if record.get('runId')!=run_id:record=dict(ok=False,error='Stale oracle completion marker')
        except (OSError,ValueError) as error:record=dict(ok=False,error=str(error))
        report['oracleScripts'][name]=record
    report['oracleComplete']=all(value.get('ok') for value in report['oracleScripts'].values())
    sources=[executable,ROOT.parent/'data/databundles/scripts.zip',ROOT/'tools/capture_native.py',ROOT/'tools/native_trace.lua',ROOT/'tools/native_asset_trace.lua',ROOT/'tools/native_inventory_memory.py',ROOT/'tools/native_entity_trace.lua',ROOT/'tools/native_entity_memory.py',ROOT/'tools/native_memory.py',ROOT/'tools/native_resource_memory.py',profile/'cluster.ini',shard/'server.ini',shard/'worldgenoverride.lua']
    report['sourceSha256']={str(p.relative_to(ROOT.parent)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sources}
    report['fixtureSha256']={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in frozen+list((shard/'save').glob('wasm_*'))}
    if inventory_file:report['fixtureSha256'][str(inventory_file.relative_to(ROOT))]=hashlib.sha256(inventory_file.read_bytes()).hexdigest()
    if entity_file:report['fixtureSha256'][str(entity_file.relative_to(ROOT))]=hashlib.sha256(entity_file.read_bytes()).hexdigest()
    if resource_file:report['fixtureSha256'][str(resource_file.relative_to(ROOT))]=hashlib.sha256(resource_file.read_bytes()).hexdigest()
    (OUT/'attempt.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2))
    return 0 if ready and report['oracleComplete'] and inventory_error is None and entity_error is None and resource_error is None and process.returncode==0 else 1

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--advance-simulation',action='store_true',help='Disable auto-pause in the isolated profile to capture multi-frame entity transitions')
    raise SystemExit(main(parser.parse_args().advance_simulation))
