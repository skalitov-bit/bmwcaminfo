'use strict';
// Fixed geometry shared by complete frames and the 10 Hz numeric patch.
const text=require('./cluster-text'),{hudLabels}=require('./camera-label');
const {iconFor,policeKind}=require('./point-kind');
const {gpsMessage}=require('./gps-message');
const W=244,H=300,S=2,IW=W*S,IH=H*S;
const WHITE=[245,249,252,255],RED=[211,44,54,255],GOLD=[255,205,74,255];
const DISTANCE={x:20*S,y:207*S,w:160*S,h:36*S};
const FOOTER={x:0,y:246*S,w:224*S,h:54*S};
// The 160 px camera mask has a ~5 px outer stroke. Clear that same width
// around the overlapping sign, retaining alpha rather than painting black.
const GEOMETRY={W,H,IW,IH,signX:180,signY:120,signRadius:44,signGap:5,cameraCenter:100,stripeWidth:200};
function label(px,iw,ih,value,x,y,size,color,options){return text.draw(px,iw,ih,S,value,x,y,size,color,options);}
function distance(e,buffer){
 const r=DISTANCE,px=buffer&&buffer.length===r.w*r.h*4?buffer:Buffer.alloc(r.w*r.h*4);px.fill(0);
 const red=e.type==='speeding'&&!policeKind(e.camera)&&!require('./notification-types').hazardKind(e.camera);
 label(px,r.w,r.h,String(Math.max(0,Math.round(e.distanceM||0)))+' м',80,2,35,red?RED:GOLD,{align:'center',maxWidth:156,preserveCase:true});return px;
}
function status(e,value,buffer){
 const r=FOOTER,px=buffer&&buffer.length===r.w*r.h*4?buffer:Buffer.alloc(r.w*r.h*4);px.fill(0);
 if(value.text)label(px,r.w,r.h,value.text,GEOMETRY.cameraCenter,4,12,value.color,{align:'center',maxWidth:196});
 if(value.notice)label(px,r.w,r.h,value.notice,GEOMETRY.cameraCenter,33,11,GOLD,{align:'center',maxWidth:196});
 return px;
}
function patch(px,r,data){for(let y=0;y<r.h;y++)data.copy(px,((r.y+y)*IW+r.x)*4,y*r.w*4,(y+1)*r.w*4);}
function circle(px,cx,cy,r,color){for(let y=Math.floor((cy-r)*S);y<Math.ceil((cy+r)*S);y++)for(let x=Math.floor((cx-r)*S);x<Math.ceil((cx+r)*S);x++){
 const a=Math.max(0,Math.min(1,r*S+.5-Math.hypot(x+.5-cx*S,y+.5-cy*S)));if(!a)continue;
 const i=(y*IW+x)*4;for(let k=0;k<3;k++)px[i+k]=color[k];px[i+3]=Math.round(a*255);
}}
function clearSignGap(px){
 const g=GEOMETRY,r=g.signRadius+g.signGap;
 for(let y=Math.floor((g.signY-r)*S);y<Math.ceil((g.signY+r)*S);y++)for(let x=Math.floor((g.signX-r)*S);x<Math.ceil((g.signX+r)*S);x++){
  const coverage=Math.max(0,Math.min(1,r*S+.5-Math.hypot(x+.5-g.signX*S,y+.5-g.signY*S)));
  const i=(y*IW+x)*4;px[i+3]=Math.round(px[i+3]*(1-coverage));
  if(px[i+3]===0)px.fill(0,i,i+4);
 }
}
function frame(e,value,stripe){
 const px=Buffer.alloc(IW*IH*4),c=e.camera||{},titles=hudLabels(c);
 const stripeLeft=GEOMETRY.cameraCenter-GEOMETRY.stripeWidth/2;
 if(stripe!==false)for(let y=0;y<5*S;y++)for(let x=stripeLeft*S;x<(stripeLeft+GEOMETRY.stripeWidth)*S;x++){const i=(y*IW+x)*4;for(let k=0;k<4;k++)px[i+k]=RED[k];}
 // Stationary is a control category, not a hardware model: retain it in title.
 const title=policeKind(c)==='stationary'?'СТАЦИОНАРНЫЙ ПОСТ ДПС':titles.control;
 label(px,IW,IH,title,GEOMETRY.cameraCenter,32,19,WHITE,{align:'center',maxWidth:196});
 iconFor(c).drawPixels(px,IW,IH,20*S,65*S,160*S,132*S,WHITE);
 // A hazard's recorded limit may be displayed without treating it as a speed
 // camera or changing the voice/beeper rules. Never invent a missing limit.
 const hazard=!!require('./notification-types').hazardKind(c),noLimit=!!policeKind(c),limit=Number(c.limit);
 if(!noLimit&&Number.isFinite(limit)&&limit>0){
  clearSignGap(px);
  circle(px,180,120,44,WHITE);circle(px,180,120,42,RED);circle(px,180,120,34,[255,255,255,255]);
  const size=text.fittedSize(String(limit),42,58);label(px,IW,IH,String(limit),180,120-text.capHeight(size)/2,size,[20,29,38,255],{align:'center'});
 }else if(!noLimit&&!hazard){
  // Clear only the unknown-limit label's backing where it overlaps the icon.
  for(let y=107*S;y<133*S;y++)px.fill(0,(y*IW+136*S)*4,(y*IW+224*S)*4);
  label(px,IW,IH,'ЛИМИТ Н/Д',180,114,12,WHITE,{align:'center',maxWidth:86});
 }
 patch(px,DISTANCE,distance(e));patch(px,FOOTER,status(e,value));return px;
}
function gps(status){const px=Buffer.alloc(IW*IH*4);label(px,IW,IH,gpsMessage(status==='reserve'?'lost':status),GEOMETRY.cameraCenter,279,11,GOLD,{align:'center',maxWidth:196});return px;}
module.exports={GEOMETRY,DISTANCE,FOOTER,frame,distance,status,gps};
