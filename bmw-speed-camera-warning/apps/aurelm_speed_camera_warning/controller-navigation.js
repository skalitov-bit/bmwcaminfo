'use strict';
// App-specific navigation for the pinned kit/display runtime. Rotation already
// follows page target order; vertical tilts must follow the same sequence too.
const ORDER=['nav-MAP','nav-RADAR','nav-ADD','nav-MY','nav-SETTINGS',
 'action-BTN_CAM_PREV','action-BTN_CAM_NEXT','action-BTN_ZOOM',
 'action-BTN_REFRESH','action-BTN_VOICE_TEST','action-BTN_CAMERA_MENU',
 'settings-close','settings-hud-position','hud-left','hud-right','hud-up','hud-down','hud-test','hud-stripe','hud-full','hud-short','hud-smaller','hud-larger','hud-save','hud-reset','hud-back',
 'engineering-test','engineering-back','engineering-audio','audio-scan','audio-prev','audio-next','audio-voice','audio-beeper','audio-both','audio-heard','audio-independent','audio-mode','audio-save','audio-reset','audio-back'];
function install(display){
 if(!display||typeof display._toward!=='function'||typeof display._ring!=='function'||display.cameraNavigationInstalled)return false;
 const original=display._toward;
 display._toward=function(direction,here){
  if(direction==='N'||direction==='S'){
   const ring=this._ring();
   const sequence=ORDER.map(key=>ring.find(p=>p.k==='tgt:'+key)).filter(Boolean);
   for(const p of ring)if(p.k.indexOf('tgt:')===0&&!sequence.some(s=>s.k===p.k))sequence.push(p);
   const index=sequence.findIndex(p=>p.k===this.focusKey);
   if(index>=0)return sequence[Math.max(0,Math.min(sequence.length-1,index+(direction==='S'?1:-1)))];
  }
  return original.call(this,direction,here);
 };
 // Gray focus uses the selected tile design; the active page stays red.
 // Keep the original chrome for system tabs, sheets and native controls.
 const drawChrome=display._drawChrome;
 if(typeof drawChrome==='function')display._drawChrome=function(recorder){
  const focusKey=this.focusKey,pressed=this.pressed;
  const targets=this.sheet?[]:(this.pageTargets||[]);
  const focused=targets.find(p=>'tgt:'+p.key===focusKey);
  const pressedTarget=Date.now()-this.pressedT<300&&targets.find(p=>'tgt:'+p.key===pressed);
  try{
   if(focused)this.focusKey=null;
   if(pressedTarget)this.pressed=null;
   drawChrome.call(this,recorder);
  }finally{this.focusKey=focusKey;this.pressed=pressed;}
  const style=require('./screen-style');
  const paint=p=>{if(p.key.indexOf('nav-')===0)style.drawNavFocus(recorder,p.key.slice(4),this.cameraNavState);
   else style.drawFocus(recorder,p.x,p.y,p.w,p.h);};
  if(pressedTarget&&pressedTarget!==focused)paint(pressedTarget);
  if(focused)paint(focused);
 };
 display.cameraNavigationInstalled=true;return true;
}
function focusTab(display,tab){
 if(!display||!['MAP','RADAR','ADD','MY','SETTINGS'].includes(tab))return false;
 const key='tgt:nav-'+tab;
 if(typeof display._focus==='function')display._focus({k:key});
 else{display.focusKey=key;display.focusTab=null;display.focused=null;}
 if(display.pressed!==key){display.pressed=null;display.pressedT=0;}
 return true;
}
module.exports={install,focusTab};
