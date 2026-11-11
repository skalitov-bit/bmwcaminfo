'use strict';
const { ClusterRender } = require('./cluster_render_client');
const W=420,H=116,S=4,IW=W*S,IH=H*S;
// Single-stroke vector font. Coordinates use a 4x6 em grid; strokes are
// rasterized directly into the supersampled RGBA buffer with round caps.
const RASTER_DIGITS={
 '0':['01110','10001','10011','10101','11001','10001','01110'],
 '1':['00100','01100','00100','00100','00100','00100','01110'],
 '2':['01110','10001','00001','00010','00100','01000','11111'],
 '3':['11110','00001','00001','01110','00001','00001','11110'],
 '4':['00010','00110','01010','10010','11111','00010','00010'],
 '5':['11111','10000','10000','11110','00001','00001','11110'],
 '6':['01110','10000','10000','11110','10001','10001','01110'],
 '7':['11111','00001','00010','00100','01000','01000','01000'],
 '8':['01110','10001','10001','01110','10001','10001','01110'],
 '9':['01110','10001','10001','01111','00001','00001','01110'],
 'M':['10001','11011','10101','10101','10001','10001','10001'],
 'М':['10001','11011','10101','10101','10001','10001','10001'],
 'К':['10001','10010','10100','11000','10100','10010','10001'],
 'А':['01110','10001','10001','11111','10001','10001','10001'],
 'Е':['11111','10000','10000','11110','10000','10000','11111'],
 'Р':['11110','10001','10001','11110','10000','10000','10000']
};
const VF={
 '0':[[0,0,4,0,4,6,0,6,0,0],[0,0,4,6]],
 '1':[[1,1,2,0,2,6],[0,6,4,6]],
 '2':[[0,1,1,0,3,0,4,1,4,2,0,6,4,6]],
 '3':[[0,0,4,0,2,3,4,3,4,5,3,6,0,6]],
 '4':[[3,6,3,0,0,4,4,4]],
 '5':[[4,0,0,0,0,3,3,3,4,4,4,5,3,6,0,6]],
 '6':[[4,0,1,0,0,2,0,5,1,6,3,6,4,5,4,4,3,3,0,3]],
 '7':[[0,0,4,0,1,6]],
 '8':[[1,3,0,2,0,1,1,0,3,0,4,1,4,2,3,3,1,3,0,4,0,5,1,6,3,6,4,5,4,4,3,3]],
 '9':[[4,3,1,3,0,2,0,1,1,0,3,0,4,1,4,4,3,6]],
 'A':[[0,6,0,2,2,0,4,2,4,6],[0,4,4,4]],
 'C':[[4,0,1,0,0,1,0,5,1,6,4,6]],
 'E':[[4,0,0,0,0,6,4,6],[0,3,3,3]],
 'I':[[0,0,4,0],[2,0,2,6],[0,6,4,6]],
 'L':[[0,0,0,6,4,6]],
 'M':[[0,6,0,0,2,3,4,0,4,6]],
 'N':[[0,6,0,0,4,6,4,0]],
 'O':[[1,0,3,0,4,1,4,5,3,6,1,6,0,5,0,1,1,0]],
 'P':[[0,6,0,0,3,0,4,1,4,2,3,3,0,3]],
 'S':[[4,0,1,0,0,1,0,2,1,3,3,3,4,4,4,5,3,6,0,6]],
 'T':[[0,0,4,0],[2,0,2,6]],
 'D':[[0,0,2,0,4,1,4,5,2,6,0,6,0,0]],
 'R':[[0,6,0,0,3,0,4,1,4,2,3,3,0,3],[2,3,4,6]],
 'V':[[0,0,2,6,4,0]],
 'G':[[4,0,1,0,0,1,0,5,1,6,4,6,4,3,2,3]],
 '/':[[0,6,4,0]],
 ' ':[],
 ':':[[2,2,2,2.1],[2,5,2,5.1]],
 '+':[[0,3,4,3],[2,1,2,5]]
};
function rgba(r,g,b,a){return [r,g,b,a===undefined?255:a];}
function put(px,x,y,c){if(x<0||y<0||x>=IW||y>=IH)return;const i=(y*IW+x)*4;px[i]=c[0];px[i+1]=c[1];px[i+2]=c[2];px[i+3]=c[3];}
function rect(px,x,y,w,h,c){for(let yy=y*S;yy<(y+h)*S;yy++)for(let xx=x*S;xx<(x+w)*S;xx++)put(px,xx,yy,c);}
function circle(px,cx,cy,r,c){const rr=r*S,ccx=cx*S,ccy=cy*S;for(let y=Math.floor(ccy-rr-1);y<=Math.ceil(ccy+rr+1);y++)for(let x=Math.floor(ccx-rr-1);x<=Math.ceil(ccx+rr+1);x++){const dx=x+0.5-ccx,dy=y+0.5-ccy,d=Math.sqrt(dx*dx+dy*dy),coverage=Math.max(0,Math.min(1,rr+0.5-d));if(coverage>0){const a=Math.round(c[3]*coverage);put(px,x,y,[c[0],c[1],c[2],a]);}}}
function text(px,s,x,y,scale,c){
 let at=x;
 const thickness=Math.max(1.15,scale*0.34)*S;
 String(s).toUpperCase().split('').forEach(ch=>{
  // Preserve the original 5x7 bitmap silhouettes for numerals.
  if(RASTER_DIGITS[ch]){
   const glyph=RASTER_DIGITS[ch];
   const radius=Math.max(0.28,Math.min(0.42,scale*0.085))*S;
   for(let yy=0;yy<7;yy++)for(let xx=0;xx<5;xx++)if(glyph[yy][xx]==='1'){
    const x0=(at+xx*scale)*S,y0=(y+yy*scale)*S,w=scale*S,h=scale*S,r=radius*S;
    for(let py=Math.floor(y0);py<Math.ceil(y0+h);py++)for(let pxX=Math.floor(x0);pxX<Math.ceil(x0+w);pxX++){
     const qx=Math.max(x0+r,Math.min(pxX+0.5,x0+w-r));
     const qy=Math.max(y0+r,Math.min(py+0.5,y0+h-r));
     const dx=pxX+0.5-qx,dy=py+0.5-qy;
     const coverage=Math.max(0,Math.min(1,r+0.5-Math.sqrt(dx*dx+dy*dy)));
     if(coverage>0){const i=(py*IW+pxX)*4,a=Math.round(c[3]*coverage);px[i]=c[0];px[i+1]=c[1];px[i+2]=c[2];px[i+3]=Math.max(px[i+3],a);}
    }
   }
   at+=6*scale;
   return;
  }
  const paths=VF[ch]||[];
  // Make the M noticeably heavier without changing the weight of other letters.
  const glyphThickness=ch==='M'?thickness*1.55:thickness;
  paths.forEach(path=>{
   for(let n=0;n<path.length-2;n+=2){
    const x1=(at+path[n]*scale)*S,y1=(y+path[n+1]*scale)*S;
    const x2=(at+path[n+2]*scale)*S,y2=(y+path[n+3]*scale)*S;
    const minX=Math.max(0,Math.floor(Math.min(x1,x2)-glyphThickness/2-1));
    const maxX=Math.min(IW-1,Math.ceil(Math.max(x1,x2)+glyphThickness/2+1));
    const minY=Math.max(0,Math.floor(Math.min(y1,y2)-glyphThickness/2-1));
    const maxY=Math.min(IH-1,Math.ceil(Math.max(y1,y2)+glyphThickness/2+1));
    const dx=x2-x1,dy=y2-y1,len2=dx*dx+dy*dy;
    for(let py=minY;py<=maxY;py++)for(let xx=minX;xx<=maxX;xx++){
     const qx=xx+0.5-x1,qy=py+0.5-y1;
     const t=len2?Math.max(0,Math.min(1,(qx*dx+qy*dy)/len2)):0;
     const dist=Math.sqrt((qx-t*dx)*(qx-t*dx)+(qy-t*dy)*(qy-t*dy));
     const coverage=Math.max(0,Math.min(1,glyphThickness/2+0.5-dist));
     if(coverage>0){const i=(py*IW+xx)*4,a=Math.round(c[3]*coverage);px[i]=c[0];px[i+1]=c[1];px[i+2]=c[2];px[i+3]=Math.max(px[i+3],a);}
    }
   }
  });
  at+=6*scale;
 });
}
function makeFrame(e){
 const px=Buffer.alloc(IW*IH*4),red=e.type==='speeding',white=rgba(245,249,252),muted=rgba(169,190,207),accent=red?rgba(255,75,88):rgba(255,205,74);
 // Keep the image transparent: an opaque canvas hides OEM consumption/cluster data.
 rect(px,0,0,W,5,accent);
 // camera glyph
 rect(px,34,46,42,25,white);rect(px,43,41,17,7,white);
 for(let y=0;y<15;y++)for(let x=0;x<15;x++){const dx=x-7,dy=y-7;if(dx*dx+dy*dy<=49)rect(px,55+x,51+y,1,1,rgba(7,15,24));}
 text(px,e.phase==='section'?'CONTROL':e.phase==='rear'?'REAR':'КАМЕРА',108,18,3,white);
 text(px,String(Math.max(0,Math.round(e.distanceM||0))+' M'),108,52,5,accent);
 const limit=Number(e.camera&&e.camera.limit);
 if(Number.isFinite(limit)&&limit>0){circle(px,357,59,32,rgba(211,44,54));circle(px,357,59,26,rgba(255,255,255));const label=String(limit);const scale=label.length<=2?4:label.length===3?3:2;const width=label.length*6*scale-scale;const tx=357-width/2;const ty=59-(7*scale)/2;text(px,label,tx,ty,scale,rgba(20,29,38));}
 else text(px,'LIMIT N/A',300,52,2,muted);
 if(e.useAverage&&Number.isFinite(e.averageKmh))text(px,(e.partialSection?'PART AVG ':'AVG ')+Math.round(e.averageKmh),108,94,2,red?rgba(255,112,120):white);
 else if(red)text(px,'SPEED',108,94,2,rgba(255,112,120));
 return px;
}
class CameraClusterOutput{
 constructor(options){
  const o=options||{};this.log=o.log||function(){};this.mode=o.mode||'kombi';this.cr=null;this.layers={};this.current=null;this.hideTimer=null;this.missingTimer=null;this.closed=false;
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
   if(this.layers[target])return;
   const hud=target==='hud';
   const ref=this.cr.image({target,klass:'overlay',z:900,x:hud?190:750,y:hud?182:302,w:W,h:H,iw:IW,ih:IH,sampling:'bilinear',visible:false,opacity:1});
   if(ref){this.layers[target]=ref;this.log('CLUSTER_RENDER_LAYER_CREATED target='+target+' ref='+ref+' x='+(hud?190:750)+' y='+(hud?182:302)+' size='+W+'x'+H+' class=overlay');}else this.log('CLUSTER_RENDER_LAYER_CREATE_FAILED target='+target);
  });
 }
 _draw(e){
  if(!this.cr||!this.cr.ready)return;
  this._makeLayers();const px=makeFrame(e);
  Object.keys(this.layers).forEach(target=>{const ref=this.layers[target];this.cr.pixels(ref,null,px);this.cr.set(ref,{visible:true});});
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
  const changed=Math.abs(distance-this.current.distanceM)>=8||this.current.phase!==state.phase||this.current.type!==(state.speeding?'speeding':'camera')||Math.round(this.current.averageKmh)!==Math.round(state.averageKmh);
  Object.assign(this.current,{distanceM:distance,phase:state.phase,type:state.speeding?'speeding':'camera',averageKmh:state.averageKmh,useAverage:state.useAverage,partialSection:state.partialSection});
  if(Number.isFinite(distance)&&changed)this._draw(this.current);
  if(this.hideTimer)clearTimeout(this.hideTimer);
  this.hideTimer=setTimeout(()=>this.clear(),5000);
 }
 clear(){
  if(this.hideTimer)clearTimeout(this.hideTimer);this.hideTimer=null;
  if(this.missingTimer)clearTimeout(this.missingTimer);this.missingTimer=null;this.current=null;
  if(this.cr)Object.keys(this.layers).forEach(target=>this.cr.set(this.layers[target],{visible:false}));
 }
 setMode(mode){
  mode=String(mode||'kombi');if(['kombi','hud','both','off'].indexOf(mode)<0)return;
  if(mode===this.mode)return;this.clear();if(this.cr)this.cr.close();this.cr=null;this.layers={};this.mode=mode;
  if(mode!=='off'){try{this.cr=new ClusterRender('aurelm_speed_camera_warning');this.cr.on('ready',()=>{this.log('CLUSTER_RENDER_READY backend='+this.cr.backend+' targets='+this.cr.targets);this._makeLayers();if(this.current)this._draw(this.current);});this.cr.on('target',(n,state,h,r,guideDisabled,disabled)=>this.log('CLUSTER_RENDER_TARGET '+n+' '+state+(h?' holder='+h:'')+(r?' '+r:'')+' guide_disabled='+!!guideDisabled+' disabled='+!!disabled));this.cr.on('refused',(o,ref,r)=>this.log('CLUSTER_RENDER_REFUSED '+o+' '+r));this.cr.connect();}catch(e){this.log('CLUSTER_RENDER_INIT_FAILED '+String(e));}}
 }
 close(){this.closed=true;this.clear();if(this.cr)this.cr.close();this.cr=null;}
}
module.exports={CameraClusterOutput};
