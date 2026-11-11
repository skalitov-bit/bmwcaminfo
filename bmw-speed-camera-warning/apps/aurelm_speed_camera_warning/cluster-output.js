'use strict';
const { ClusterRender } = require('./cluster_render_client');
const {hudLabels}=require('./camera-label');
const W=420,H=116,S=4,IW=W*S,IH=H*S;
const RING_SIZE=84,RING_PIXELS=RING_SIZE*S;
const ALERT_RED=[211,44,54,255]; // Same red as the speed-limit sign (#D32C36).
const clusterText=require('./cluster-text');
function shouldBlink(e){
 const c=e&&e.camera||{},limit=c.limit;
 const speed=e&&(e.useAverage?e.averageKmh:Number.isFinite(e.measuredSpeedKmh)?e.measuredSpeedKmh:e.speedKmh);
 return c.camera_family!=='dummy'&&(!c.averageControl||e.useAverage)&&
  Number.isFinite(limit)&&limit>0&&Number.isFinite(speed)&&speed-limit>20;
}
function makeRing(){
 const px=Buffer.alloc(RING_PIXELS*RING_PIXELS*4);
 for(let y=0;y<RING_PIXELS;y++)for(let x=0;x<RING_PIXELS;x++){
  const d=Math.hypot(x+.5-RING_PIXELS/2,y+.5-RING_PIXELS/2);
  const coverage=Math.max(0,Math.min(1,42*S-d,d-38*S));
  if(coverage){const i=(y*RING_PIXELS+x)*4;px[i]=ALERT_RED[0];px[i+1]=ALERT_RED[1];px[i+2]=ALERT_RED[2];px[i+3]=Math.round(255*coverage);}
 }
 return px;
}
function rgba(r,g,b,a){return [r,g,b,a===undefined?255:a];}
function put(px,x,y,c){if(x<0||y<0||x>=IW||y>=IH)return;const i=(y*IW+x)*4;px[i]=c[0];px[i+1]=c[1];px[i+2]=c[2];px[i+3]=c[3];}
function rect(px,x,y,w,h,c){for(let yy=y*S;yy<(y+h)*S;yy++)for(let xx=x*S;xx<(x+w)*S;xx++)put(px,xx,yy,c);}
function circle(px,cx,cy,r,c){const rr=r*S,ccx=cx*S,ccy=cy*S;for(let y=Math.floor(ccy-rr-1);y<=Math.ceil(ccy+rr+1);y++)for(let x=Math.floor(ccx-rr-1);x<=Math.ceil(ccx+rr+1);x++){const dx=x+0.5-ccx,dy=y+0.5-ccy,d=Math.sqrt(dx*dx+dy*dy),coverage=Math.max(0,Math.min(1,rr+0.5-d));if(coverage>0){const a=Math.round(c[3]*coverage);put(px,x,y,[c[0],c[1],c[2],a]);}}}
function roundDistance(x,y,cx,cy,w,h,r){
 const dx=Math.abs(x-cx)-(w/2-r),dy=Math.abs(y-cy)-(h/2-r);
 return Math.hypot(Math.max(dx,0),Math.max(dy,0))+Math.min(Math.max(dx,dy),0)-r;
}
function cameraIcon(px){
 // Analytic rounded outline at the renderer's 4x resolution; no pixel-grid lens.
 const stroke=2.4;
 for(let yy=38*S;yy<75*S;yy++)for(let xx=30*S;xx<80*S;xx++){
  const x=(xx+.5)/S,y=(yy+.5)/S;
  const body=roundDistance(x,y,55,58.5,42,25,5),top=roundDistance(x,y,51.5,46,18,10,3);
  const outline=Math.abs(Math.min(body,top))-stroke/2;
  const lens=Math.abs(Math.hypot(x-55,y-58.5)-7)-stroke/2;
  const coverage=Math.max(0,Math.min(1,.5-Math.min(outline,lens)*S));
  if(coverage)put(px,xx,yy,rgba(245,249,252,Math.round(coverage*255)));
 }
}
function makeFrame(e){
 const px=Buffer.alloc(IW*IH*4),red=e.type==='speeding',white=rgba(245,249,252),muted=rgba(169,190,207),accent=red?ALERT_RED:rgba(255,205,74);
 const label=(value,x,y,size,color,options)=>clusterText.draw(px,IW,IH,S,value,x,y,size,color,options);
 // Preserve transparency so OEM cluster information remains visible around the card.
 rect(px,0,0,W,5,accent);
 cameraIcon(px);
 const titles=hudLabels(e.camera);
 label(titles.control,108,13,18,white,{maxWidth:207});
 if(titles.model)label(titles.model,108,36,16,muted,{maxWidth:207});
 label(String(Math.max(0,Math.round(e.distanceM||0)))+' М',108,59,32,accent,{maxWidth:207});
 const limit=Number(e.camera&&e.camera.limit);
 if(Number.isFinite(limit)&&limit>0){
  circle(px,357,59,32,ALERT_RED);circle(px,357,59,26,rgba(255,255,255));
  const size=clusterText.fittedSize(String(limit),32,44);
  label(String(limit),357,59-clusterText.capHeight(size)/2,size,rgba(20,29,38),{align:'center'});
 }else label('ЛИМИТ Н/Д',300,52,11,muted,{maxWidth:110});
 if(e.useAverage&&Number.isFinite(e.averageKmh))label((e.partialSection?'ЧАСТ. СРЕДНЯЯ ':'СРЕДНЯЯ ')+Math.round(e.averageKmh),108,94,12,red?ALERT_RED:white,{maxWidth:207});
 else if(e.phase==='section'||e.phase==='rear')label((e.phase==='section'?'УЧАСТОК':'ПОСЛЕ')+(red?' / ПРЕВЫШЕНИЕ':''),108,94,12,red?ALERT_RED:white,{maxWidth:207});
 else if(red)label('ПРЕВЫШЕНИЕ',108,94,12,ALERT_RED,{maxWidth:207});
 return px;
}
class CameraClusterOutput{
 constructor(options){
  const o=options||{};this.log=o.log||function(){};this.mode=o.mode||'kombi';this.cr=null;this.layers={};this.rings={};this.blinkTimer=null;this.blinkOn=false;this.current=null;this.hideTimer=null;this.missingTimer=null;this.closed=false;
  if(this.mode==='off')return;
  try{
   this.cr=new ClusterRender('aurelm_speed_camera_warning');
   this.cr.on('ready',()=>{this.log('CLUSTER_RENDER_READY backend='+this.cr.backend+' targets='+this.cr.targets);this._makeLayers();if(this.current)this._draw(this.current);});
   this.cr.on('target',(name,state,holder,reason,guideDisabled,disabled)=>this.log('CLUSTER_RENDER_TARGET '+name+' '+state+(holder?' holder='+holder:'')+(reason?' '+reason:'')+' guide_disabled='+!!guideDisabled+' disabled='+!!disabled));
   this.cr.on('layer',(ref,state,reason)=>this.log('CLUSTER_RENDER_LAYER '+ref+' '+state+(reason?' '+reason:'')));
   this.cr.on('refused',(op,ref,reason)=>this.log('CLUSTER_RENDER_REFUSED '+op+' '+reason));
   this.cr.on('disconnected',()=>this.log('CLUSTER_RENDER_DISCONNECTED'));
   this.cr.connect();
  }catch(e){this.log('CLUSTER_RENDER_INIT_FAILED '+String(e&&e.message||e));this.cr=null;}
 }
 _makeLayers(){
  if(!this.cr||!this.cr.ready)return;
  const targets=this.mode==='both'?['panel','hud']:[this.mode==='hud'?'hud':'panel'];
  targets.forEach(target=>{
   const hud=target==='hud';
   if(!this.layers[target]){
   const ref=this.cr.image({target,klass:'overlay',z:900,x:hud?190:750,y:hud?182:302,w:W,h:H,iw:IW,ih:IH,sampling:'bilinear',visible:false,opacity:1});
   if(ref){this.layers[target]=ref;this.log('CLUSTER_RENDER_LAYER_CREATED target='+target+' ref='+ref+' x='+(hud?190:750)+' y='+(hud?182:302)+' size='+W+'x'+H+' class=overlay');}else this.log('CLUSTER_RENDER_LAYER_CREATE_FAILED target='+target);
   }
   if(!this.rings[target]){
    const ref=this.cr.image({target,klass:'overlay',z:901,x:(hud?190:750)+315,y:(hud?182:302)+17,w:RING_SIZE,h:RING_SIZE,iw:RING_PIXELS,ih:RING_PIXELS,sampling:'bilinear',visible:false,opacity:1});
    if(ref){this.rings[target]=ref;this.cr.pixels(ref,null,makeRing());}
   }
  });
 }
 _draw(e){
  if(!this.cr||!this.cr.ready)return;
  this._makeLayers();const px=makeFrame(e);
  Object.keys(this.layers).forEach(target=>{const ref=this.layers[target];this.cr.pixels(ref,null,px);this.cr.set(ref,{visible:true});});
  this._syncBlink(e);
 }
 _setBlink(visible){
  this.blinkOn=visible;
  if(this.cr)Object.keys(this.rings).forEach(target=>this.cr.set(this.rings[target],{visible}));
 }
 _stopBlink(){
  if(this.blinkTimer!==null)clearInterval(this.blinkTimer);this.blinkTimer=null;this._setBlink(false);
 }
 _syncBlink(e){
  if(!shouldBlink(e)){this._stopBlink();return;}
  if(this.blinkTimer!==null)return;
  this._setBlink(true);
  // Only toggle a small overlay: no full-card allocation or upload per flash.
  this.blinkTimer=setInterval(()=>{
   if(!this.current||this.closed||!shouldBlink(this.current)){this._stopBlink();return;}
   if(this.cr&&this.cr.ready)this._setBlink(!this.blinkOn);
  },500);
 }
 show(event){
  if(!event||!event.camera||!this.cr)return;
  this.current=Object.assign({},event);
  if(this.hideTimer)clearTimeout(this.hideTimer);
  if(this.missingTimer)clearTimeout(this.missingTimer);this.missingTimer=null;
  this._draw(this.current);
  // Failsafe: clear stale alerts if GPS stops updating or the vehicle leaves the monitored segment.
  this.hideTimer=setTimeout(()=>this.clear(),45000);
 }
 sync(states){
  if(!this.current)return;
  // The manual output test uses a synthetic camera id that is intentionally
  // absent from the live road-guidance state map. Let its own 10s timer clear it.
  if(this.current.camera&&String(this.current.camera.id)==='camera-output-test'){
   this.log('CLUSTER_OUTPUT_SYNC_TEST_SKIP');
   return;
  }
  const state=states&&states[this.current.camera.id];
  if(!state){
   this._stopBlink();
   // GPS/state-machine updates can briefly omit a camera. Do not blank HUD/KOMBI
   // on the first missing sample; allow a short grace period for the next fix.
   if(!this.missingTimer){
    this.log('CLUSTER_OUTPUT_SYNC_MISSING camera='+this.current.camera.id+' grace_ms=10000');
    this.missingTimer=setTimeout(()=>{
     this.missingTimer=null;
     if(this.current)this.clear();
    },10000);
   }
   return;
  }
  if(this.missingTimer){clearTimeout(this.missingTimer);this.missingTimer=null;this.log('CLUSTER_OUTPUT_SYNC_RETURNED camera='+this.current.camera.id);}
  const distance=Math.max(0,Math.round(state.distanceM));
  const previousAverage=Number.isFinite(this.current.averageKmh)?Math.round(this.current.averageKmh):null;
  const nextAverage=Number.isFinite(state.averageKmh)?Math.round(state.averageKmh):null;
  const changed=Math.abs(distance-this.current.distanceM)>=8||this.current.phase!==state.phase||this.current.type!==(state.speeding?'speeding':'camera')||previousAverage!==nextAverage||this.current.useAverage!==state.useAverage||this.current.partialSection!==state.partialSection;
  Object.assign(this.current,{distanceM:distance,phase:state.phase,type:state.speeding?'speeding':'camera',speedKmh:state.speedKmh,measuredSpeedKmh:state.speedKmh,averageKmh:state.averageKmh,useAverage:state.useAverage,partialSection:state.partialSection});
  this._syncBlink(this.current);
  if(Number.isFinite(distance)&&changed)this._draw(this.current);
  if(this.hideTimer)clearTimeout(this.hideTimer);
  this.hideTimer=setTimeout(()=>this.clear(),5000);
 }
 clear(){
  this._stopBlink();
  if(this.hideTimer)clearTimeout(this.hideTimer);this.hideTimer=null;
  if(this.missingTimer)clearTimeout(this.missingTimer);this.missingTimer=null;this.current=null;
  if(this.cr)Object.keys(this.layers).forEach(target=>this.cr.set(this.layers[target],{visible:false}));
 }
 setMode(mode){
  mode=String(mode||'kombi');if(['kombi','hud','both','off'].indexOf(mode)<0)return;
  if(mode===this.mode)return;this.clear();if(this.cr)this.cr.close();this.cr=null;this.layers={};this.rings={};this.mode=mode;
  if(mode!=='off'){try{this.cr=new ClusterRender('aurelm_speed_camera_warning');this.cr.on('ready',()=>{this.log('CLUSTER_RENDER_READY backend='+this.cr.backend+' targets='+this.cr.targets);this._makeLayers();if(this.current)this._draw(this.current);});this.cr.on('target',(n,state,h,r,guideDisabled,disabled)=>this.log('CLUSTER_RENDER_TARGET '+n+' '+state+(h?' holder='+h:'')+(r?' '+r:'')+' guide_disabled='+!!guideDisabled+' disabled='+!!disabled));this.cr.on('refused',(o,ref,r)=>this.log('CLUSTER_RENDER_REFUSED '+o+' '+r));this.cr.connect();}catch(e){this.log('CLUSTER_RENDER_INIT_FAILED '+String(e));}}
 }
 close(){this.closed=true;this.clear();if(this.cr)this.cr.close();this.cr=null;}
}
module.exports={CameraClusterOutput};
