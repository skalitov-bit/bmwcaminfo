'use strict';
// App-specific navigation for the pinned kit/display runtime. Rotation already
// follows page target order; vertical tilts must follow the same sequence too.
const ORDER=['nav-MAP','nav-RADAR','nav-ADD','nav-MY','nav-SETTINGS',
 'action-BTN_CAM_PREV','action-BTN_CAM_NEXT','action-BTN_ZOOM',
 'action-BTN_REFRESH','action-BTN_VOICE_TEST','action-BTN_CAMERA_MENU',
 'engineering-test','engineering-back'];
function install(display){
 if(!display||typeof display._toward!=='function'||typeof display._ring!=='function'||display.cameraNavigationInstalled)return false;
 const original=display._toward;
 display._toward=function(direction,here){
  if(direction==='N'||direction==='S'){
   const ring=this._ring();
   const sequence=ORDER.map(key=>ring.find(p=>p.k==='tgt:'+key)).filter(Boolean);
   const index=sequence.findIndex(p=>p.k===this.focusKey);
   if(index>=0)return sequence[Math.max(0,Math.min(sequence.length-1,index+(direction==='S'?1:-1)))];
  }
  return original.call(this,direction,here);
 };
 // Replace the kit's rounded page-focus outline with the app's selection style.
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
  if(pressedTarget&&pressedTarget!==focused)style.drawSelection(recorder,pressedTarget.x,pressedTarget.y,pressedTarget.w,pressedTarget.h,true);
  if(focused)style.drawSelection(recorder,focused.x,focused.y,focused.w,focused.h,true);
 };
 display.cameraNavigationInstalled=true;return true;
}
module.exports={install};
