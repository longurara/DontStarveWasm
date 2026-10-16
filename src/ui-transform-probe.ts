/** Real UITransform data in all Worker roles; no replacement UI drawing. */
export async function uiTransformProbe(engine:any,evaluate:(code:string)=>string,role:string){
  const response=await fetch('/generated/preview/ui-transform-provenance.json',{cache:'no-store'});
  if(!response.ok)throw new Error('Missing native UI layout provenance');
  const oracle=await response.json();if(!oracle.nativeVerified||oracle.gameBuild!=='756039')throw new Error('Unverified native UI layout evidence');
  const scene=evaluate('return _WEB_Snapshot()'),count=engine._dst_entity_count();
  const before=evaluate('return json.encode_compliant(WebUI.Inspect())');
  let result:any;
  try {
    result=JSON.parse(evaluate(`
      local owned={}
      local function create(name)
        local inst=CreateEntity("ui_browser_"..name);owned[#owned+1]=inst;inst.persists=false
        inst.entity:AddUITransform();inst.entity:CallPrefabConstructionComplete();return inst
      end
      local ok,result=xpcall(function()
        local p=create("parent");local c=create("child");local g=create("grandchild")
        c.entity:SetParent(p.entity);g.entity:SetParent(c.entity)
        p.UITransform:SetPosition(10.25,-20.5,3);c.UITransform:SetPosition(2.5,4.25,-5);g.UITransform:SetPosition(-3.75,7.125,2)
        p.UITransform:SetScale(1.5,-2,0.75);c.UITransform:SetScale(2,3,4)
        p.UITransform:SetRotation(90);c.UITransform:SetRotation(-45)
        local out={parent={p.UITransform:GetWorldPosition()},child={c.UITransform:GetWorldPosition()},grandchild={g.UITransform:GetWorldPosition()}}
        c.UITransform:SetHAnchor(0);c.UITransform:SetVAnchor(0)
        c.UITransform:GetWorldPosition();out.anchored=WebUI.Inspect(c.GUID)
        c.UITransform:SetHAnchor(3);c.UITransform:SetVAnchor(3)
        c.UITransform:SetScaleMode(2);out.autoScale={c.UITransform:GetScale()}
        c.UITransform:SetScaleMode(0);p.UITransform:SetRotation(0);c.UITransform:SetRotation(0);c.UITransform:SetScale(0,0,0)
        p.UITransform:SetScissor(-1.9,65538,32768,12.75);c.UITransform:SetScissor(5,6,20,30);c.UITransform:ClearScissor();c.UITransform:SetScissor(-4,8,10,20)
        p.UITransform:UpdateTransform()
        out.final={parent=WebUI.Inspect(p.GUID),child=WebUI.Inspect(c.GUID),grandchild=WebUI.Inspect(g.GUID)}
        local stale=c.UITransform;g:Remove();c:Remove();owned[3]=nil;owned[2]=nil
        assert(select("#",stale:SetPosition(nil))==0 and select("#",stale:GetWorldPosition())==0)
        return json.encode_compliant(out)
      end,debug.traceback)
      for i=#owned,1,-1 do if owned[i] and owned[i]:IsValid() then owned[i]:Remove() end end
      if not ok then error(result) end;return result
    `));
    const near=(a:number[],b:number[])=>a.length===b.length&&a.every((v,i)=>Math.abs(v-b[i])<=0.0001);
    for(const key of ['parent','child','grandchild'])if(!near(result[key],oracle.pose[key].worldPosition))throw new Error('Native UI hierarchy mismatch: '+key);
    const viewport=JSON.parse(before);
    const bits=result.anchored.worldMatrixBits;
    const bytes=Uint8Array.from(bits.match(/../g).map((part:string)=>parseInt(part,16)));
    const matrix=new DataView(bytes.buffer);
    if(matrix.getFloat32(12,true)!==viewport.width*0.5+2.5||matrix.getFloat32(28,true)!==viewport.height*0.5+4.25)throw new Error('UI viewport/anchor mismatch');
    const scale=Math.min(viewport.width/1280,viewport.height/720,3);
    if(!near(result.autoScale,[scale,scale,scale]))throw new Error('UI proportional scale mismatch');
    for(const key of ['parent','child','grandchild']){
      for(const field of ['scissor','transformedScissor','clearScissor'])if(JSON.stringify(result.final[key][field]??null)!==JSON.stringify(oracle.final[key][field]??null))throw new Error('Native UI scissor data mismatch: '+key+'/'+field);
      if(!near(result.final[key].worldPosition,oracle.final[key].worldPosition)||result.final[key].rendererReady)throw new Error('Invalid UI transform readiness/state');
    }
    return {role,nativeLayoutVerified:true,scissorDataVerified:true,viewport:[viewport.width,viewport.height],retiredVerified:true,rendererReady:false,heapBytes:engine.HEAPU8.buffer.byteLength};
  } finally {
    if(scene!==evaluate('return _WEB_Snapshot()')||count!==engine._dst_entity_count()||before!==evaluate('return json.encode_compliant(WebUI.Inspect())'))throw new Error('UI probe did not restore scene and ownership');
  }
}
