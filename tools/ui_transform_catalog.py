"""Freeze verified native UI CPU-layout evidence for browser regression probes."""
import hashlib
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

def main():
    target=ROOT/'public/generated/preview/ui-transform-provenance.json';target.parent.mkdir(parents=True,exist_ok=True)
    attempt_path=ROOT/'output/native-reference/attempt.json'
    if not attempt_path.exists():
        target.write_text(json.dumps(dict(gameBuild='756039',nativeVerified=False,note='Run tools/capture_native.py --advance-simulation to collect UI layout evidence.')),encoding='utf8')
        print('Native UI evidence unavailable; browser probe will reject unverified data');return
    attempt=json.loads(attempt_path.read_text(encoding='utf8'))
    if not attempt['oracleComplete'] or attempt['entityCaptureError'] is not None:
        raise ValueError('Native UI capture is incomplete')
    def checked(path):
        data=(ROOT/path).read_bytes()
        recorded=next((v for k,v in attempt['fixtureSha256'].items() if k.replace('\\','/')==path),None)
        if hashlib.sha256(data).hexdigest()!=recorded:raise ValueError('Native UI fixture hash mismatch: '+path)
        return data
    trace=checked('output/native-reference/storage/fixtures/Cluster_1/Master/save/wasm_ui_transform_trace')
    memory=checked('output/native-reference/entity-flags.json')
    native=json.loads(trace[11:]);state=json.loads(memory)['uiTransform']
    if state['traceSha256']!=hashlib.sha256(trace).hexdigest():raise ValueError('UI trace/memory provenance mismatch')
    report=dict(gameBuild='756039',nativeVerified=True,nativeRunId=attempt['oracleRunId'],
        nativeTraceSha256=state['traceSha256'],nativeMemorySha256=hashlib.sha256(memory).hexdigest(),
        pose=next(row for row in native['states'] if row['name']=='rotations'),
        final={row['name']:{key:row[key] for key in ['worldPosition','scissor','transformedScissor','clearScissor']} for row in state['components'] if row['name'] in ['parent','child','grandchild']},
        note='CPU UI layout and scissor data only; no claim of rendered pixels, inverse transforms or renderable bounds.')
    target.write_text(json.dumps(report,separators=(',',':')),encoding='utf8')
    print('Verified native UI layout provenance written')

if __name__=='__main__':main()
