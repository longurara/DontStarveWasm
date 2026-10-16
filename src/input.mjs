const special={Tab:9,Backspace:8,Enter:13,Escape:27,Space:32,Home:278,Insert:277,Delete:127,End:279,Pause:19,
  PrintScreen:316,CapsLock:301,ScrollLock:302,ShiftRight:303,ShiftLeft:304,ControlRight:305,ControlLeft:306,
  AltRight:307,AltLeft:308,MetaLeft:311,MetaRight:312,ArrowUp:273,ArrowDown:274,ArrowRight:275,ArrowLeft:276,
  PageUp:280,PageDown:281,Minus:45,Equal:61,Period:46,Slash:47,Semicolon:59,BracketLeft:91,Backslash:92,
  BracketRight:93,Backquote:96,Quote:39,Comma:44,NumpadDecimal:266,NumpadDivide:267,NumpadMultiply:268,
  NumpadSubtract:269,NumpadAdd:270,NumpadEnter:271,NumpadEqual:272};
export function nativeKeyCode(code){
  if(/^Key[A-Z]$/.test(code))return code.charCodeAt(3)+32;
  if(/^Digit[0-9]$/.test(code))return code.charCodeAt(5);
  if(/^Numpad[0-9]$/.test(code))return 256+Number(code.at(-1));
  if(/^F([1-9]|1[0-2])$/.test(code))return 281+Number(code.slice(1));
  return special[code]??null;
}
export const nativeMouseButton=button=>[1000,1002,1001][button]??null;

// Only the focused game canvas captures game input. A blur releases all held
// state, so changing tab or using another page control cannot leave keys stuck.
export function attachCanvasInput(canvas,send,onError){
  canvas.tabIndex=0;
  const emit=message=>{Promise.resolve(send(message)).catch(onError);};
  const position=event=>{
    const box=canvas.getBoundingClientRect();
    return {x:Math.max(0,Math.min(canvas.width,(event.clientX-box.left)*canvas.width/box.width)),
      y:Math.max(0,Math.min(canvas.height,(box.bottom-event.clientY)*canvas.height/box.height))};
  };
  let latest,scheduled=false;
  for(const kind of ['keydown','keyup'])canvas.addEventListener(kind,event=>{
    const code=nativeKeyCode(event.code);if(code===null)return;
    event.preventDefault();emit({kind:'key',code,down:kind==='keydown'});
  });
  canvas.addEventListener('pointerdown',event=>{
    const button=nativeMouseButton(event.button);if(button===null)return;
    canvas.focus();canvas.setPointerCapture(event.pointerId);event.preventDefault();
    latest=position(event);emit({kind:'pointer',...latest,button,down:true});
  });
  canvas.addEventListener('pointerup',event=>{
    const button=nativeMouseButton(event.button);if(button===null)return;
    latest=position(event);emit({kind:'pointer',...latest,button,down:false});
  });
  canvas.addEventListener('pointermove',event=>{
    latest=position(event);if(scheduled)return;scheduled=true;
    requestAnimationFrame(()=>{scheduled=false;emit({kind:'pointer',...latest,button:-1,down:false});});
  });
  canvas.addEventListener('contextmenu',event=>event.preventDefault());
  canvas.addEventListener('blur',()=>emit({kind:'reset'}));
  canvas.addEventListener('pointercancel',()=>emit({kind:'reset'}));
  window.addEventListener('blur',()=>emit({kind:'reset'}));
}
