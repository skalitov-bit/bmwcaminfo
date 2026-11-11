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
 display.cameraNavigationInstalled=true;return true;
}
module.exports={install};
