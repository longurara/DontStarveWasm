"""Freeze verified native TextWidget CPU-measurement evidence for browser regression probes."""
import hashlib
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

def main():
    target=ROOT/'public/generated/preview/text-widget-provenance.json';target.parent.mkdir(parents=True,exist_ok=True)
    attempt_path=ROOT/'output/native-reference/attempt.json'
    if not attempt_path.exists():
        target.write_text(json.dumps(dict(gameBuild='756039',nativeVerified=False,note='Run tools/capture_native.py --advance-simulation to collect TextWidget evidence.')),encoding='utf8')
        print('Native TextWidget evidence unavailable; browser probe will reject unverified data');return
    attempt=json.loads(attempt_path.read_text(encoding='utf8'))
    if not attempt['oracleComplete'] or attempt['entityCaptureError'] is not None:
        raise ValueError('Native TextWidget capture is incomplete')
    def checked(path):
        data=(ROOT/path).read_bytes()
        recorded=next((v for k,v in attempt['fixtureSha256'].items() if k.replace('\\','/')==path),None)
        if hashlib.sha256(data).hexdigest()!=recorded:raise ValueError('Native TextWidget fixture hash mismatch: '+path)
        return data
    trace=checked('output/native-reference/storage/fixtures/Cluster_1/Master/save/wasm_text_widget_trace')
    memory=checked('output/native-reference/entity-flags.json')
    native=json.loads(trace[11:]);state=json.loads(memory)['textWidget']
    if state['traceSha256']!=hashlib.sha256(trace).hexdigest():raise ValueError('TextWidget trace/memory provenance mismatch')
    report=dict(gameBuild='756039',nativeVerified=True,nativeRunId=attempt['oracleRunId'],
        nativeTraceSha256=state['traceSha256'],nativeMemorySha256=hashlib.sha256(memory).hexdigest(),
        sample=next(row for row in native['states'] if row['name']=='string-16'),
        final={row['name']:{key:row[key] for key in ['dirty','fontHandle','sizeBits','squeezeBits','regionBits','wordWrap','whitespaceWrap','hAnchor','vAnchor','colourBits','autoRegionSize','text','showEditCursor','cursorIndex','editCursorColourBits']} for row in state['components']},
        note='CPU text measurement and wrapping data only; no claim of rendered glyphs.')
    target.write_text(json.dumps(report,separators=(',',':')),encoding='utf8')
    print('Verified native TextWidget provenance written')

if __name__=='__main__':main()
