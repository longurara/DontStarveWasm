import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {loadEngine} from '../tools/load-engine.mjs';

test('web profile statistics produce bounded local diagnostics with no official service transport',async t=>{
  const hash=text=>createHash('sha256').update(text).digest('hex');
  for(const role of [0,1,2]){
    const {engine,evaluate}=await loadEngine(role);t.after(()=>engine._dst_close());evaluate('json=require("json")');
    const inspect=()=>JSON.parse(evaluate('return json.encode_compliant(WebProfileStats.Inspect())'));
    assert.deepEqual(inspect(),{policy:'local-diagnostics',networkEnabled:false,events:0,bytes:0,lastChannel:'',lastPayloadSha256:''});
    assert.equal(evaluate('return select("#",TheSim:SendProfileStats("{\\"event\\":\\"startup\\"}","local"))'),'0');
    const payload='{"event":"startup"}';
    assert.deepEqual(inspect(),{policy:'local-diagnostics',networkEnabled:false,events:1,bytes:payload.length,lastChannel:'local',lastPayloadSha256:hash(payload)});
    for(const args of ['nil','false','{}','"ok",false','string.rep("x",262145)','"ok",string.rep("x",129)']){
      const before=inspect();assert.throws(()=>evaluate(`TheSim:SendProfileStats(${args})`));assert.deepEqual(inspect(),before);
    }
    evaluate('TheSim:SendProfileStats("a\\000tail","N\\000ignored");TheSim:SendProfileStats(123.5,12,"extra")');
    assert.deepEqual(inspect(),{policy:'local-diagnostics',networkEnabled:false,events:3,bytes:payload.length+6,lastChannel:'12',lastPayloadSha256:hash('123.5')});
    evaluate('TheSim:SendProfileStats(string.rep("x",262144))');
    assert.equal(inspect().events,4);assert.equal(inspect().lastChannel,'');assert.equal(inspect().lastPayloadSha256,hash('x'.repeat(262144)));
    engine._dst_close();assert.equal(engine._dst_init(role),0);evaluate('package.path="/scripts/?.lua";json=require("json")');
    assert.equal(inspect().events,0);assert.equal(inspect().networkEnabled,false);
  }
});
