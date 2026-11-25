'use strict';
const { ClusterRender } = require('./cluster_render_client');
const {hudLabels}=require('./camera-label');
const {gpsMessage}=require('./gps-message');
// Two-times supersampling retains antialiasing at the same on-screen size.
// At 4x, both displays use 15.5 MiB of cluster-render's GLOBAL 16 MiB
// image budget (two RGBA copies), leaving almost no room for other clients.
const W=420,H=116,S=2,IW=W*S,IH=H*S;
const RING_SIZE=84,RING_PIXELS=RING_SIZE*S;
const ALERT_RED=[211,44,54,255]; // Same red as the speed-limit sign (#D32C36).
// Approved compact HUD: sign centre x=284 (47px left of the previous x=331).
// All content fits fixed slots; neither labels nor distance move icons/stripe.
const HUD_LAYOUT={textX:108,textWidth:136,gap:8};
// The dots in РАСЧЁТНО / НЕТ GPS and other accented glyphs may reach
// above the footer baseline. Keep its patch separate from the distance patch.
const DISTANCE_RECT={x:106*S,y:57*S,w:(HUD_LAYOUT.textWidth+2)*S,h:27*S};
const KOMBI_DISTANCE_RECT={x:126*S,y:57*S,w:168*S,h:35*S};
const FOOTER_RECT={x:106*S,y:92*S,w:210*S,h:24*S};
const HUD_FOOTER_RECT={x:0,y:84*S,w:IW,h:32*S};
// Matching 64px side slots, centred in the free areas beside the text.
const KOMBI_ICONS={left:90,right:330,y:H/2,size:64};
// cluster-render PROTOCOL v1: alert is above overlay; z is bounded to 1000.
// Equal-priority layers use creation order: create the ring AFTER the card.
// Keep both non-exclusive: priority must not suspend unrelated display layers.
// This is priority within cluster-render, not an override of BMW slot locks.
const ALERT_LAYER={klass:'alert',z:1000,exclusive:false,contend:true,yield:false,guide_hold:false};
// panel (DCSM 0x203) activates a whole-cluster popup and can blank the OEM
// right information widget even with transparent pixels. Use the central map
// slot (0x100) for KOMBI; never fall back to panel. guide_hold=0 preserves the
// stock maneuver box while our map layer is wanted. This needs on-car testing.
const kombiBackplate=require('./kombi-backplate');
// Bottom-centre of the advertised map canvas, not the whole-panel popup.
// Physical alignment with the OEM belt area still needs on-car verification.
const OUTPUT_RECT={map:{x:331,y:355},hud:{x:190,y:182}};
const {normalize:normalizeHudPosition}=require('./hud-position');
const clusterText=require('./cluster-text');
const compactHud=require('./hud-compact');
const {policeKind,iconFor}=require('./point-kind');
const noLimit=c=>!!policeKind(c)||!!require('./notification-types').hazardKind(c);
const {PULSE,pulseOpacity,monotonicMs}=require('./ring-pulse');
function shouldBlink(e){
 if(e&&e.estimated)return false;
 const c=e&&e.camera||{},limit=c.limit;
 const speed=e&&(e.useAverage?e.averageKmh:Number.isFinite(e.measuredSpeedKmh)?e.measuredSpeedKmh:e.speedKmh);
 return !noLimit(c)&&c.camera_family!=='dummy'&&(!c.averageControl||e.useAverage)&&
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
function cameraIcon(px,c,centered){
 const k=KOMBI_ICONS,w=centered?k.size:60,h=w*.825;
 const x=centered?k.left-w/2:25,y=centered?k.y-h/2:34;
 iconFor(c).drawPixels(px,IW,IH,x*S,y*S,w*S,h*S,[245,249,252]);
}
function hudGeometry(e){
 const width=HUD_LAYOUT.textWidth,signX=HUD_LAYOUT.textX+width+HUD_LAYOUT.gap+32;
 // Centre every text row on the fixed stripe; only the digits are redrawn.
 const titleCenter=HUD_LAYOUT.textX+width/2;
 return {signX,titleCenter,stripeWidth:2*titleCenter,textWidth:width+HUD_LAYOUT.gap-8,
  distanceRect:{x:DISTANCE_RECT.x,y:DISTANCE_RECT.y,w:Math.ceil(width+2)*S,h:DISTANCE_RECT.h}};
}
function distancePixels(e,buffer,centered){
 const r=centered?KOMBI_DISTANCE_RECT:hudGeometry(e).distanceRect,px=buffer||Buffer.alloc(r.w*r.h*4);px.fill(0);
 const red=!noLimit(e.camera)&&e.type==='speeding';
 clusterText.draw(px,r.w,r.h,S,String(Math.max(0,Math.round(e.distanceM||0)))+(centered?' М':' м'),centered?r.w/S/2:hudGeometry(e).titleCenter-r.x/S,2,32,red?ALERT_RED:rgba(255,205,74),{align:'center',preserveCase:!centered,maxWidth:centered?164:HUD_LAYOUT.textWidth});
 return px;
}
function baseFooter(e){
 const red=!noLimit(e.camera)&&e.type==='speeding',white=rgba(245,249,252);
 if(e.estimated)return {text:gpsMessage('reserve'),color:white};
 if(e.useAverage&&Number.isFinite(e.averageKmh))return {text:(e.partialSection?'ЧАСТ. СРЕДНЯЯ ':'СРЕДНЯЯ ')+Math.round(e.averageKmh),color:red?ALERT_RED:white};
 if(e.phase==='section'||e.phase==='rear')return {text:(e.phase==='section'?'УЧАСТОК':'ПОСЛЕ')+(red?' / ПРЕВЫШЕНИЕ':''),color:red?ALERT_RED:white};
 return {text:red?'ПРЕВЫШЕНИЕ':'',color:red?ALERT_RED:white};
}
function footer(e){const g=hudGeometry(e);return Object.assign(baseFooter(e),{notice:e.accuracyDegraded&&!e.estimated?gpsMessage('degraded'):'',hudCenter:g.titleCenter,hudSignLeft:g.signX-32});}
function footerRegions(value,centered){
 if(centered)return [FOOTER_RECT];
 // The raised caption shares vertical space with the bottom of the sign.
 // Never erase sign pixels when replacing only the footer.
 return [{x:0,y:84*S,w:Math.floor(value.hudSignLeft-1)*S,h:8*S},{x:0,y:92*S,w:IW,h:24*S}];
}
function footerPatches(value,buffer,centered){
 const full=footerPixels(value,buffer,centered),origin=centered?FOOTER_RECT:HUD_FOOTER_RECT,rects=footerRegions(value,centered);
 if(centered)return {rects,pixels:full};
 const pixels=Buffer.alloc(rects.reduce((sum,r)=>sum+r.w*r.h*4,0));let offset=0;
 rects.forEach(r=>{for(let y=0;y<r.h;y++){const start=((r.y-origin.y+y)*origin.w+r.x-origin.x)*4;full.copy(pixels,offset,start,start+r.w*4);offset+=r.w*4;}});
 return {rects,pixels};
}
function footerPixels(value,buffer,centered){
 const r=centered?FOOTER_RECT:HUD_FOOTER_RECT,px=buffer||Buffer.alloc(r.w*r.h*4);px.fill(0);
 const x=(centered?W/2:value.hudCenter)-r.x/S;
 const gps=value.text.indexOf('🛰')===0,textY=!centered?87:gps?98:94;
 const statusWidth=centered?168:Math.min(168,2*(value.hudSignLeft-2-value.hudCenter));
 if(value.text){
  if(gps&&!centered){
   // Keep the text on the common status row; the taller satellite must fit
   // inside the footer patch without touching the distance or camera icon.
   const size=clusterText.fittedSize(value.text,12,statusWidth),left=x-clusterText.width(value.text,size)/2;
   clusterText.draw(px,r.w,r.h,S,'🛰',left,Math.max(textY-r.y/S,clusterText.topInset('🛰',size)),size,value.color);
   clusterText.draw(px,r.w,r.h,S,value.text.slice('🛰'.length),left+clusterText.width('🛰',size),textY-r.y/S,size,value.color);
  }else clusterText.draw(px,r.w,r.h,S,value.text,x,textY-r.y/S,12,value.color,{align:'center',maxWidth:statusWidth});
 }
 if(value.notice)clusterText.draw(px,r.w,r.h,S,value.notice,x,107-r.y/S,9,rgba(255,205,74),{align:'center',maxWidth:168});
 return px;
}
// Key the pixels, not camera identity or raw speed: equal visible content
// needs no new icon/sign/title rendering. Keep only keys, not full-frame copies.
function staticFrameKey(e){
 const c=e.camera||{},titles=hudLabels(c),police=!!noLimit(c),limit=Number(c.limit);
 return JSON.stringify([require('./i18n').language(),titles.control,titles.model,police,!police&&Number.isFinite(limit)&&limit>0?limit:null,!police&&e.type==='speeding',hudGeometry(e).signX]);
}
function hudTitle(value,maxWidth){
 const english=require('./i18n').language()==='en';
 if(english)value=require('./i18n').t(value).toUpperCase();
 const rear=english?' / REAR-FACING':' / В СПИНУ',suffix=value.endsWith(rear)?rear:'';
 if(suffix)return hudTitle(value.slice(0,-suffix.length),maxWidth-clusterText.width(suffix,18))+suffix;
 const short={'СРЕДНЯЯ СКОРОСТЬ':'СРЕДНЯЯ СКОР.','ОСТАНОВКА/СТОЯНКА':'ОСТ./СТОЯНКА','ВЕСОВОЙ КОНТРОЛЬ':'ВЕС. КОНТРОЛЬ','ОПЛАТА ПРОЕЗДА':'ОПЛАТА ПРОЕЗДА'};
 Object.assign(short,{'AVERAGE SPEED':'AVG. SPEED','SCHOOL / CROSSING':'SCHOOL / CROSSING','POLICE CHECKPOINT':'POLICE CHECK'});
 let result=value;
 if(clusterText.width(result,18)>maxWidth)result=short[value]||value;
 if(clusterText.width(result,18)>maxWidth){
  while(result.length&&clusterText.width(result+'...',18)>maxWidth)result=result.slice(0,-1);
  result=result.trim()+'...';
 }
 return result;
}
function makeFrame(e,centered){
 const layout=hudGeometry(e);
 const px=Buffer.alloc(IW*IH*4),red=!noLimit(e.camera)&&e.type==='speeding',white=rgba(245,249,252),muted=rgba(169,190,207),accent=red?ALERT_RED:rgba(255,205,74);
 const label=(value,x,y,size,color,options)=>clusterText.draw(px,IW,IH,S,value,centered&&x===108?W/2:x,y,size,color,centered&&x===108?Object.assign({},options,{align:'center',maxWidth:168}):options);
 // Preserve transparency so OEM cluster information remains visible around the card.
 if(!centered)rect(px,0,0,Math.round(layout.stripeWidth),5,accent);
 cameraIcon(px,e.camera,centered);
 const titles=hudLabels(e.camera);
 // The top row sits above the sign: use its full width without shrinking type.
 if(centered)label(titles.control,108,13,18,white,{maxWidth:168});
 else label(hudTitle(titles.control,2*layout.titleCenter-16),layout.titleCenter,13,18,white,{align:'center'});
 if(titles.model){
  if(centered)label(titles.model,108,36,16,muted,{maxWidth:168});
  else label(titles.model,layout.titleCenter,36,16,muted,{align:'center',maxWidth:Math.max(24,2*(layout.signX-32-8-layout.titleCenter))});
 }
 const r=centered?KOMBI_DISTANCE_RECT:layout.distanceRect,dp=distancePixels(e,null,centered);
 for(let row=0;row<r.h;row++)dp.copy(px,((r.y+row)*IW+r.x)*4,row*r.w*4,(row+1)*r.w*4);
 const limit=noLimit(e.camera)?NaN:Number(e.camera&&e.camera.limit);
 const signX=centered?KOMBI_ICONS.right:layout.signX,signY=centered?KOMBI_ICONS.y:59;
 if(Number.isFinite(limit)&&limit>0){
  circle(px,signX,signY,32,ALERT_RED);circle(px,signX,signY,26,rgba(255,255,255));
  const size=clusterText.fittedSize(String(limit),32,44);
  label(String(limit),signX,signY-clusterText.capHeight(size)/2,size,rgba(20,29,38),{align:'center'});
 }else if(!noLimit(e.camera))label('ЛИМИТ Н/Д',signX,centered?signY-clusterText.capHeight(11)/2:52,11,muted,{align:'center',maxWidth:64});
 const patches=footerPatches(footer(e),null,centered);let offset=0;
 patches.rects.forEach(fr=>{for(let row=0;row<fr.h;row++){patches.pixels.copy(px,((fr.y+row)*IW+fr.x)*4,offset,offset+fr.w*4);offset+=fr.w*4;}});
 return px;
}
function makeGpsFrame(status,centered,stripeWidth){
 const px=Buffer.alloc(IW*IH*4),yellow=rgba(255,205,74);
 const message=gpsMessage(status==='reserve'?'lost':status);
 const width=Number.isFinite(stripeWidth)?stripeWidth:Math.round(hudGeometry({distanceM:300}).stripeWidth);
 clusterText.draw(px,IW,IH,S,message,centered?W/2:width/2,98,12,yellow,{align:'center',maxWidth:260});
 return px;
}
class CameraClusterOutput{
 constructor(options){
  const o=options||{};this.log=o.log||function(){};this.mode=o.mode||'kombi';this.cr=null;this.layers={};this.rings={};this.backplate=null;this.backplateLayout='';this.blinkTimer=null;this.blinkOn=false;this.current=null;this.hideTimer=null;this.missingTimer=null;this.closed=false;
  this.now=o.now||monotonicMs;this.blinkStarted=0;this.blinkOpacity=-1;this.gpsStatus='';
  this.frameKey=null;this.footerKey=null;
  this.hudPosition=normalizeHudPosition(o.hudPosition);this.clientName=o.clientName||'aurelm_speed_camera_warning';
  this.hudStripeWidth=Math.round(hudGeometry({distanceM:300}).stripeWidth);
  if(this.mode==='off')return;
  try{
   this.cr=new ClusterRender(this.clientName);
   this.cr.on('ready',()=>{this.log('CLUSTER_RENDER_READY backend='+this.cr.backend+' targets='+this.cr.targets);this._makeLayers();if(this.current)this._draw(this.current);else this._drawGpsStatus();});
   this.cr.on('target',(name,state,holder,reason,guideDisabled,disabled)=>this.log('CLUSTER_RENDER_TARGET '+name+' '+state+(holder?' holder='+holder:'')+(reason?' '+reason:'')+' guide_disabled='+!!guideDisabled+' disabled='+!!disabled));
   this.cr.on('layer',(ref,state,reason)=>this.log('CLUSTER_RENDER_LAYER '+ref+' '+state+(reason?' '+reason:'')));
   this.cr.on('refused',(op,ref,reason)=>this.log('CLUSTER_RENDER_REFUSED '+op+' '+reason));
   this.cr.on('disconnected',()=>this.log('CLUSTER_RENDER_DISCONNECTED'));
   this.cr.connect();
  }catch(e){this.log('CLUSTER_RENDER_INIT_FAILED '+String(e&&e.message||e));this.cr=null;}
 }
 _makeLayers(){
  if(!this.cr||!this.cr.ready)return;
  const targets=this.mode==='both'?['map','hud']:[this.mode==='hud'?'hud':'map'];
  targets.forEach(target=>{
   const backing=target==='map'?kombiBackplate.layout(this.cr.targets):null;
   const pos=target==='hud'?this.hudPosition:{x:backing.contentX,y:backing.contentY};
   const card=target==='hud'&&this.hudPosition.banner==='short'?compactHud.GEOMETRY:{W,H,IW,IH},ring={x:backing?KOMBI_ICONS.right-RING_SIZE/2:hudGeometry(this.current).signX-RING_SIZE/2,y:backing?KOMBI_ICONS.y-RING_SIZE/2:17,w:RING_SIZE,h:RING_SIZE};
   if(target==='hud'&&this.hudPosition.banner==='short'){ring.x=compactHud.GEOMETRY.signX-RING_SIZE/2;ring.y=compactHud.GEOMETRY.signY-RING_SIZE/2;ring.w=RING_SIZE;ring.h=RING_SIZE;}
   if(backing&&!this.backplate){
    this.backplate=this.cr.image(Object.assign({},ALERT_LAYER,{target,x:backing.x,y:backing.y,w:backing.w,h:backing.h,iw:backing.iw,ih:backing.ih,sampling:'bilinear',visible:false,opacity:1}));
    if(this.backplate)this.cr.pixels(this.backplate,null,kombiBackplate.makePixels());
   }
   if(!this.layers[target]){
   this.frameKey=null;
   const ref=this.cr.image(Object.assign({},ALERT_LAYER,{target,x:pos.x,y:pos.y,w:card.W,h:card.H,iw:card.IW,ih:card.IH,sampling:'bilinear',visible:false,opacity:1}));
   if(ref){this.layers[target]=ref;this.log('CLUSTER_RENDER_LAYER_CREATED target='+target+' ref='+ref+' x='+pos.x+' y='+pos.y+' size='+card.W+'x'+card.H+' class=alert z=1000 exclusive=0 contend=1 yield=0 guide_hold=0');}else this.log('CLUSTER_RENDER_LAYER_CREATE_FAILED target='+target);
   }
   if(this.layers[target]&&!this.rings[target]){
    const ref=this.cr.image(Object.assign({},ALERT_LAYER,{target,x:pos.x+ring.x,y:pos.y+ring.y,w:ring.w,h:ring.h,iw:RING_PIXELS,ih:RING_PIXELS,sampling:'bilinear',visible:false,opacity:0}));
    if(ref){this.rings[target]=ref;this.cr.pixels(ref,null,makeRing());}
   }
   if(backing){
    const key=backing.width+'x'+backing.height;
    if(key!==this.backplateLayout){
     this.backplateLayout=key;
     if(this.backplate)this.cr.set(this.backplate,{x:backing.x,y:backing.y});
     if(this.layers.map)this.cr.set(this.layers.map,{x:pos.x,y:pos.y});
     if(this.rings.map)this.cr.set(this.rings.map,{x:pos.x+ring.x,y:pos.y+ring.y});
     this.log('KOMBI_BOTTOM_BANNER canvas='+key+' reported='+backing.reported+' content='+pos.x+','+pos.y+' backing='+backing.x+','+backing.y+' size='+backing.w+'x'+backing.h);
    }
   }
  });
 }
 _draw(e){
  if(!this.cr||!this.cr.ready)return;
  this._makeLayers();
  const key=staticFrameKey(e)+this.hudPosition.banner,status=footer(e),statusKey=JSON.stringify(status);
  if(this.frameKey!==key){
   this.hudStripeWidth=Math.round(hudGeometry(e).stripeWidth);
   this.lastDistance=Math.max(0,Math.round(e.distanceM||0));
   const frame=this.layers.hud?(this.hudPosition.banner==='short'?compactHud.frame(e,status,this.hudPosition.stripe):makeFrame(e)):null;
   if(this.rings.hud)this.cr.set(this.rings.hud,{x:this.hudPosition.x+(this.hudPosition.banner==='short'?compactHud.GEOMETRY.signX-56:hudGeometry(e).signX-RING_SIZE/2)});
   this._sendFrames(frame,true,this.layers.map?makeFrame(e,true):null);
   this.frameKey=key;
  }else{
   if(this.footerKey!==statusKey)Object.keys(this.layers).forEach(target=>{
    if(target==='hud'&&this.hudPosition.banner==='short'){this.compactFooterBuffer=compactHud.status(e,status,this.compactFooterBuffer);this.cr.pixels(this.layers.hud,[compactHud.FOOTER],this.compactFooterBuffer);return;}
    const bufferKey=target==='map'?'kombiFooterBuffer':'hudFooterBuffer';
    const r=target==='map'?FOOTER_RECT:HUD_FOOTER_RECT;
    if(!this[bufferKey])this[bufferKey]=Buffer.alloc(r.w*r.h*4);
    const patches=footerPatches(status,this[bufferKey],target==='map');
    this.cr.pixels(this.layers[target],patches.rects,patches.pixels);
   });
   this._uploadDistance(Math.max(0,Math.round(e.distanceM||0)));
  }
  this.footerKey=statusKey;
  this._syncBlink(e);
 }
 _sendFrames(frame,visible,kombiFrame,withoutBackplate){
  if(this.backplate)this.cr.set(this.backplate,{visible:!!visible&&!!this.layers.map&&!withoutBackplate});
  // KOMBI centres its text independently; HUD keeps its existing layout.
  // GPS cards already have centred text, but their old stripe is omitted on KOMBI.
  let mapFrame=kombiFrame||frame;
  if(!kombiFrame&&frame&&this.layers.map){mapFrame=this.layers.hud?Buffer.from(frame):frame;mapFrame.fill(0,0,IW*5*S*4);}
  if(frame&&this.layers.hud&&this.hudPosition.banner!=='short'&&!this.hudPosition.stripe)frame.fill(0,0,IW*5*S*4);
  Object.keys(this.layers).forEach(target=>{const ref=this.layers[target],px=target==='map'?mapFrame:frame;if(px)this.cr.pixels(ref,null,px);this.cr.set(ref,{visible:!!visible});});
 }
 setGpsStatus(status){
  status=['searching','lost','reserve','unreliable','degraded'].indexOf(status)>=0?status:'';
  if(status===this.gpsStatus)return;
  this.gpsStatus=status;
  if(!this.current)this._drawGpsStatus();
 }
 _drawGpsStatus(){
  if(this.closed||this.current||!this.cr||!this.cr.ready)return;
  this.frameKey=null;this.footerKey=null;
  this._makeLayers();this._stopBlink();
  const frame=this.gpsStatus?(this.hudPosition.banner==='short'?compactHud.gps(this.gpsStatus):makeGpsFrame(this.gpsStatus,false,this.hudStripeWidth)):null;
  const mapFrame=this.gpsStatus&&this.layers.map?makeGpsFrame(this.gpsStatus,true):null;
  this._sendFrames(frame,!!frame,mapFrame,true);
 }
 setHudPosition(position){
  const previousStripe=this.hudPosition.stripe,previousBanner=this.hudPosition.banner;
  this.hudPosition=normalizeHudPosition(position);
  const p=this.hudPosition;
  if(previousBanner!==p.banner&&this.cr){
   // Image backing dimensions are immutable: replace only the HUD layers.
   ['layers','rings'].forEach(group=>{if(this[group].hud){this.cr.drop(this[group].hud);delete this[group].hud;}});
   this.frameKey=null;this.footerKey=null;this.distanceBuffer=null;this._makeLayers();
  }
  if(this.cr){if(this.layers.hud)this.cr.set(this.layers.hud,{x:p.x,y:p.y});if(this.rings.hud)this.cr.set(this.rings.hud,{x:p.x+(p.banner==='short'?compactHud.GEOMETRY.signX-56:hudGeometry(this.current).signX-RING_SIZE/2),y:p.y+(p.banner==='short'?compactHud.GEOMETRY.signY-56:17)});}
  if(previousStripe!==p.stripe||previousBanner!==p.banner){this.frameKey=null;if(this.current)this._draw(this.current);else this._drawGpsStatus();}
 }
 updateDistance(distanceM,estimated){
  if(!this.current||!Number.isFinite(distanceM))return;
  const distance=Math.max(0,Math.round(distanceM)),changed=!!this.current.estimated!==!!estimated;
  this.current.distanceM=distance;this.current.estimated=!!estimated;
  if(changed){this._draw(this.current);return;}
  this._uploadDistance(distance);
 }
 _uploadDistance(distance){
  if(!this.cr||!this.cr.ready||distance===this.lastDistance)return;
  if(this.frameKey!==staticFrameKey(this.current)+this.hudPosition.banner){this._draw(this.current);return;}
  this.lastDistance=distance;
  // Update only each display's numeric rectangle, retaining its text alignment.
  // Transparent erasure reveals the separate static KOMBI backing layer.
  Object.keys(this.layers).forEach(target=>{
   if(target==='hud'&&this.hudPosition.banner==='short'){this.distanceBuffer=compactHud.distance(this.current,this.distanceBuffer);this.cr.pixels(this.layers.hud,[compactHud.DISTANCE],this.distanceBuffer);return;}
   const centered=target==='map',r=centered?KOMBI_DISTANCE_RECT:hudGeometry(this.current).distanceRect,key=centered?'kombiDistanceBuffer':'distanceBuffer';
   if(!this[key]||this[key].length!==r.w*r.h*4)this[key]=Buffer.alloc(r.w*r.h*4);
   const px=distancePixels(this.current,this[key],centered);
   this.cr.pixels(this.layers[target],[r],px);
  });
 }
 _setBlink(opacity,force){
  opacity=Math.round(Math.max(0,Math.min(1,opacity))*1000)/1000;
  if(!force&&opacity===this.blinkOpacity)return;
  this.blinkOpacity=opacity;this.blinkOn=opacity>0;
  if(this.cr)Object.keys(this.rings).forEach(target=>this.cr.set(this.rings[target],{visible:this.blinkOn,opacity}));
 }
 _stopBlink(){
  if(this.blinkTimer!==null)clearInterval(this.blinkTimer);this.blinkTimer=null;this._setBlink(0);this.blinkStarted=0;
 }
 _syncBlink(e){
  if(!shouldBlink(e)){this._stopBlink();return;}
  if(this.blinkTimer!==null){this._setBlink(pulseOpacity(this.now()-this.blinkStarted),true);return;}
  this.blinkStarted=this.now();this._setBlink(0,true);
  // Update only opacity of the cached overlay. Elapsed time avoids drift after delayed ticks.
  this.blinkTimer=setInterval(()=>{
   if(!this.current||this.closed||!shouldBlink(this.current)){this._stopBlink();return;}
   if(this.cr&&this.cr.ready)this._setBlink(pulseOpacity(this.now()-this.blinkStarted));
  },PULSE.frameMs);
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
  const changed=this.current.phase!==state.phase||this.current.type!==(state.speeding?'speeding':'camera')||previousAverage!==nextAverage||this.current.useAverage!==state.useAverage||this.current.partialSection!==state.partialSection||!!this.current.accuracyDegraded!==!!state.accuracyDegraded;
  Object.assign(this.current,{distanceM:distance,phase:state.phase,type:state.speeding?'speeding':'camera',speedKmh:state.speedKmh,measuredSpeedKmh:state.speedKmh,averageKmh:state.averageKmh,useAverage:state.useAverage,partialSection:state.partialSection,accuracyDegraded:!!state.accuracyDegraded});
  this._syncBlink(this.current);
  if(Number.isFinite(distance)&&changed)this._draw(this.current);
  if(this.hideTimer)clearTimeout(this.hideTimer);
  this.hideTimer=setTimeout(()=>this.clear(),5000);
 }
 clear(){
  this.frameKey=null;this.footerKey=null;
  this._stopBlink();
  if(this.hideTimer)clearTimeout(this.hideTimer);this.hideTimer=null;
  if(this.missingTimer)clearTimeout(this.missingTimer);this.missingTimer=null;this.current=null;
  if(this.cr)Object.keys(this.layers).forEach(target=>this.cr.set(this.layers[target],{visible:false}));
  if(this.cr&&this.backplate)this.cr.set(this.backplate,{visible:false});
  this._drawGpsStatus();
 }
 setMode(mode){
  mode=String(mode||'kombi');if(['kombi','hud','both','off'].indexOf(mode)<0)return;
  if(mode===this.mode)return;this.clear();if(this.cr)this.cr.close();this.cr=null;this.layers={};this.rings={};this.backplate=null;this.backplateLayout='';this.mode=mode;
  if(mode!=='off'){try{this.cr=new ClusterRender(this.clientName);this.cr.on('ready',()=>{this.log('CLUSTER_RENDER_READY backend='+this.cr.backend+' targets='+this.cr.targets);this._makeLayers();if(this.current)this._draw(this.current);else this._drawGpsStatus();});this.cr.on('target',(n,state,h,r,guideDisabled,disabled)=>this.log('CLUSTER_RENDER_TARGET '+n+' '+state+(h?' holder='+h:'')+(r?' '+r:'')+' guide_disabled='+!!guideDisabled+' disabled='+!!disabled));this.cr.on('refused',(o,ref,r)=>this.log('CLUSTER_RENDER_REFUSED '+o+' '+r));this.cr.connect();}catch(e){this.log('CLUSTER_RENDER_INIT_FAILED '+String(e));}}
 }
 close(){this.closed=true;this.clear();if(this.cr)this.cr.close();this.cr=null;}
}
module.exports={CameraClusterOutput};
