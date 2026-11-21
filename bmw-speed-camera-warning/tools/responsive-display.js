'use strict';
// SpeedCAM opt-in. READY reports renderer coordinates, not necessarily panel pixels.
// Keep the entire app page (including y=0..38), with uniform scale and opaque gutters.
const {Canvas}=require('./canvas');
const {Recorder}=require('./record');
const PAGE={w:1600,h:520}, BASE={w:1920,h:720};
function valid(s){return !!s&&Number.isFinite(s.w)&&Number.isFinite(s.h)&&s.w>=320&&s.h>=200&&s.w<=8192&&s.h<=4096;}
function geometry(screen){
 const s=valid(screen)?screen:BASE;
 const x=Math.round(84*s.w/BASE.w),y=Math.round(80*s.h/BASE.h);
 const box={x,y,w:s.w-x,h:s.h-y};
 const scale=Math.min(box.w/PAGE.w,box.h/PAGE.h);
 return {x:0,y:0,w:s.w,h:s.h,full:true,scale,
  ox:box.x+(box.w-PAGE.w*scale)/2,oy:box.y+(box.h-PAGE.h*scale)/2,box};
}
function enabled(d){return !!(d.spec&&d.spec.responsiveMain&&d.screen&&d.screen.name==='MAIN');}
function softwareImage(cv,screen,destination){
 if(!(cv instanceof Canvas)||cv.w!==PAGE.w||cv.h!==PAGE.h)return cv;
 const p=geometry(screen),b=p.box,cap=Math.min(1,1836/b.w,960/b.h);
 const w=Math.round(b.w*cap),h=Math.round(b.h*cap);
 const result=(destination instanceof Canvas&&destination!==cv&&destination.w===w&&destination.h===h?destination:new Canvas(w,h)).clear('#000000');
 result.drawImage(cv.d,cv.w,cv.h,(p.ox-b.x)*cap,(p.oy-b.y)*cap,cv.w*p.scale*cap,cv.h*p.scale*cap);
 return result;
}
class SoftwareFrames {
 constructor(){this.input=null;this.free=[];}
 canvas(w,h){
  if(!this.input||this.input.w!==w||this.input.h!==h)this.input=new Canvas(w,h);
  else this.input.clear(0);
  return this.input;
 }
 image(cv,screen,send){
  if(!(cv instanceof Canvas)||cv.w!==PAGE.w||cv.h!==PAGE.h)return Promise.resolve().then(()=>send(cv));
  // Lease outputs until RHMI has finished, including coalesced uploads.
  const out=softwareImage(cv,screen,this.free.pop());
  const release=()=>{if(this.free.length<2)this.free.push(out);};
  let result;try{result=send(out);}catch(e){release();throw e;}
  return Promise.resolve(result).then(v=>{release();return v;},e=>{release();throw e;});
 }
}
function snapshot(d){
 const g=d.gpu,p=d.place;let mode='HMI',reason='NO_RENDERER';
 if(g&&!g.ready)reason='CONNECTING';
 else if(d.recoveryLocked)reason=d.recoveryLocked;
 else if(d.rendererSuspended)reason='SURFACE_SUSPENDED';
 else if(d.blocked)reason='FOREGROUND_GATE';
 else if(d.softDone)reason='NO_FRAME_ACK';
 else if(g&&g.ready&&p){
  if(typeof d._shown==='function'&&!d._shown())reason='NOT_VISIBLE';
  else {mode='GPU';reason='READY';}
 }else if(d.settings&&d.settings.get('renderer')==='software')reason='SOFTWARE_SETTING';
 const now=Date.now(),screen=g&&g.ready&&valid(g.screen)?g.screen:null;
 return {mode,reason,rendererScreen:screen,geometry:geometry(screen),
  coordinateSpace:screen?'renderer-logical':'default-profile',
  ackAgeMs:d.tickT?Math.max(0,now-d.tickT):null,
  connected:!!(g&&g.ready),native:!!(g&&g.native),touch:!!(g&&g.touch),
  controller:!!(g&&g.info&&g.info.controller),modes:g&&g.info&&g.info.modes,
  onScreen:g&&g.onScreen,front:d.rendererFront,
  touchEvents:d.touchEvents||0,ccuEvents:d.ccuEvents||0,recoveryAttempts:d.recoveryAttempts||0,
  path:g&&g.path||null,layout:'wide-no-bar'};
}
function install(Display){
 const proto=Display.prototype;
 const place=proto._place,chrome=proto._drawChrome,claim=proto._claimTabs;
 const ownable=proto.ownable,head=proto.headH,bar=proto.barH;
 proto._place=function(){
  if(!enabled(this))return place.call(this);
  if(!this.gpu||!this.gpu.ready)return;
  const p=geometry(this.gpu.screen),key=JSON.stringify(p);
  this.place=p;this.gpu.place(p);this._grab();this._hmiBar();
  this.recorders.clear();this.app=null;this.outRec=null;this.chromeRec=null;
  if(this.layoutKey!==key){this.layoutKey=key;this.log.info('DISPLAY_GEOMETRY '+key);this._layoutChanged();}
 };
 proto.ownable=function(){if(!enabled(this))return ownable.call(this);const g=this.gpu;return !!(g&&g.ready&&g.native&&g.touch&&valid(g.screen));};
 proto.headH=function(){return enabled(this)?geometry(this.gpu&&this.gpu.screen).box.y:head.call(this);};
 proto.barH=function(){return enabled(this)?0:bar.call(this);};
 proto._drawChrome=function(r){
  if(!enabled(this))return chrome.call(this,r);
  const p=this.place,b=p.box||geometry({w:p.w,h:p.h}).box;
  const c=new Recorder(p.w,p.h);c.tabRects=[];this.chromeRec=c;this.headEnd=b.x;
  // Fill letterboxing around the whole logical page, without covering any app pixels.
  const right=p.ox+PAGE.w*p.scale,bottom=p.oy+PAGE.h*p.scale;
  c.fillRect(b.x,b.y,b.w,Math.max(0,p.oy-b.y),'#000000');
  c.fillRect(b.x,bottom,b.w,Math.max(0,p.h-bottom),'#000000');
  c.fillRect(b.x,p.oy,Math.max(0,p.ox-b.x),PAGE.h*p.scale,'#000000');
  c.fillRect(right,p.oy,Math.max(0,p.w-right),PAGE.h*p.scale,'#000000');
  c.clip(0,0,p.w,b.y).clear(0).noclip();
  c.clip(0,b.y,b.x,p.h-b.y).clear(0).noclip();
  r.xf(1,0,0).append(c).xf();
 };
 proto._claimTabs=function(rects,r){
  if(!enabled(this))return claim.call(this,rects,r);
  if(!this.own()){this.gpu.claim([]);return;}
  const p=this.place,b=p.box;
  this.gpu.claim([{x:(b.x-p.ox)/p.scale,y:(b.y-p.oy)/p.scale,w:b.w/p.scale,h:b.h/p.scale}]);
 };
 proto.renderDiagnostics=function(){return snapshot(this);};
}
module.exports={install,geometry,softwareImage,snapshot,enabled,SoftwareFrames};
