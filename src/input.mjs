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

/**
 * Polls connected HTML5 Gamepad controllers (Xbox / PlayStation / Standard mapping)
 * and translates left thumbstick / D-Pad to WASD movement and face/shoulder buttons
 * to Don't Starve Together gameplay actions.
 */
export function attachGamepadPoller(onKey, onAction) {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return () => {};
  const heldKeys = new Set();
  const prevButtons = new Map();
  let rafId = 0;

  const setHeldKey = (code, down) => {
    if (down && !heldKeys.has(code)) {
      heldKeys.add(code);
      onKey?.(code, true);
    } else if (!down && heldKeys.has(code)) {
      heldKeys.delete(code);
      onKey?.(code, false);
    }
  };

  const poll = () => {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = Array.from(pads || []).find(p => p && p.connected);
    if (pad) {
      const axX = pad.axes?.[0] ?? 0;
      const axY = pad.axes?.[1] ?? 0;
      const dUp = Boolean(pad.buttons?.[12]?.pressed) || axY < -0.28;
      const dDown = Boolean(pad.buttons?.[13]?.pressed) || axY > 0.28;
      const dLeft = Boolean(pad.buttons?.[14]?.pressed) || axX < -0.28;
      const dRight = Boolean(pad.buttons?.[15]?.pressed) || axX > 0.28;

      setHeldKey(119, dUp);    // KEY_W
      setHeldKey(115, dDown);  // KEY_S
      setHeldKey(97, dLeft);   // KEY_A
      setHeldKey(100, dRight); // KEY_D

      const buttonActions = [
        [0, 'spacebar-action'], // A / Cross: Action / Harvest / Chop / PickUp
        [2, 'attack-nearest'],  // X / Square: Attack
        [3, 'inspect-self'],    // Y / Triangle: Inspect Survivor
        [1, 'escape'],          // B / Circle: Cancel / Pause
        [4, 'rot-left'],        // LB / L1: Rotate Camera Left
        [5, 'rot-right'],       // RB / R1: Rotate Camera Right
        [8, 'toggle-map'],      // Back / Select: MapScreen
        [9, 'toggle-pause'],    // Start / Options: PauseScreen
      ];
      for (const [btnIdx, actName] of buttonActions) {
        const pressed = Boolean(pad.buttons?.[btnIdx]?.pressed);
        const wasPressed = Boolean(prevButtons.get(btnIdx));
        if (pressed && !wasPressed) {
          onAction?.(actName);
        }
        prevButtons.set(btnIdx, pressed);
      }
    } else if (heldKeys.size > 0) {
      for (const code of [...heldKeys]) {
        heldKeys.delete(code);
        onKey?.(code, false);
      }
    }
    rafId = requestAnimationFrame(poll);
  };

  rafId = requestAnimationFrame(poll);
  return () => cancelAnimationFrame(rafId);
}

/**
 * Wires virtual touch D-pad & action buttons for touchscreens / mobile browsers.
 */
export function attachTouchControls(rootEl, onKey, onAction) {
  if (!rootEl) return;
  const bindTouchKey = (selector, keyCode) => {
    const el = rootEl.querySelector(selector);
    if (!el) return;
    el.addEventListener('pointerdown', e => { e.preventDefault(); onKey?.(keyCode, true); });
    el.addEventListener('pointerup', e => { e.preventDefault(); onKey?.(keyCode, false); });
    el.addEventListener('pointercancel', () => onKey?.(keyCode, false));
    el.addEventListener('pointerleave', () => onKey?.(keyCode, false));
  };
  bindTouchKey('[data-touch-key="W"]', 119);
  bindTouchKey('[data-touch-key="S"]', 115);
  bindTouchKey('[data-touch-key="A"]', 97);
  bindTouchKey('[data-touch-key="D"]', 100);

  rootEl.querySelectorAll('[data-touch-action]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      const act = btn.getAttribute('data-touch-action');
      if (act) onAction?.(act);
    });
  });
}

