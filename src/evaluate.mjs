// One Lua stack per instance. Asyncify may suspend it during verified asset
// I/O; another evaluation must wait rather than reenter the suspended VM.
export function engineEvaluator(engine,isReady=()=>true) {
  let pending=false;
  const check=budget=>{
    if(!isReady())throw new Error('Engine is not initialized');
    if(pending)throw new Error('Lua evaluation is waiting for resource I/O');
    if(!Number.isInteger(budget)||budget<1000||budget>200000000)throw new Error('Invalid Lua instruction budget');
  };
  const result=status=>{
    const text=engine.ccall('dst_result','string',[],[]);if(status)throw new Error(text);return text;
  };
  function evaluate(code,budget=2000000){
    check(budget);return result(engine.ccall('dst_eval_budget','number',['string','number'],[code,budget]));
  }
  async function evaluateAsync(code,budget=2000000){
    check(budget);pending=true;
    try{return result(await engine.ccall('dst_eval_async','number',['string','number'],[code,budget],{async:true}));}
    finally{pending=false;}
  }
  return {evaluate,evaluateAsync,get pending(){return pending;}};
}
