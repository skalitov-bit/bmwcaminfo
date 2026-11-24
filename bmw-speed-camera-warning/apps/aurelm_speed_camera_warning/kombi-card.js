'use strict';
// Compact opaque KOMBI card. Shares the application's offline font and icons.
const {gpsMessage}=require('./gps-message');
const text=require('./cluster-text'),{hudLabels}=require('./camera-label'),{policeKind,iconFor}=require('./point-kind');
// Supersample x3: image height stays below the wire client's 720px limit.
const W=200,H=200,S=3,IW=W*S,IH=H*S;
// Provisional right-side placement within the existing map target. Physical
// alignment with the OEM tyre-pressure widget must be calibrated on the car.
const POSITION={x:800,y:140},RING={x:12,y:129,w:64,h:64};
const DISTANCE_RECT={x:12*S,y:72*S,w:176*S,h:53*S};
const BG=[8,9,11,255],WHITE=[245,249,252,255],MUTED=[169,190,207,255],RED=[211,44,54,255];
function fill(px,c){for(let i=0;i<px.length;i+=4){px[i]=c[0];px[i+1]=c[1];px[i+2]=c[2];px[i+3]=255;}return px;}
function distancePixels(e,buffer){
 const r=DISTANCE_RECT,px=fill(buffer||Buffer.alloc(r.w*r.h*4),BG);
 text.draw(px,r.w,r.h,S,Math.max(0,Math.round(e.distanceM||0))+' М',88,3,48,WHITE,{align:'center',maxWidth:172});return px;
}
function makeFrame(e){
 const px=fill(Buffer.alloc(IW*IH*4),BG),police=policeKind(e.camera)||require('./notification-types').hazardKind(e.camera),titles=hudLabels(e.camera);
 const label=(s,x,y,size,c,o)=>text.draw(px,IW,IH,S,s,x,y,size,c||WHITE,o);
 // Solid base covers every pixel; the accent fades only across the top edge.
 for(let y=0;y<3*S;y++)for(let x=0;x<IW;x++){const a=1-x/IW,i=(y*IW+x)*4;for(let c=0;c<3;c++)px[i+c]=Math.round(BG[c]+(RED[c]-BG[c])*a);}
 iconFor(e.camera).drawPixels(px,IW,IH,14*S,19*S,34*S,28*S,WHITE);
 label(titles.control,58,17,19.2,WHITE,{maxWidth:130});
 if(titles.model)label(titles.model,58,42,16.8,MUTED,{maxWidth:130});
 const r=DISTANCE_RECT,dp=distancePixels(e);for(let row=0;row<r.h;row++)dp.copy(px,((r.y+row)*IW+r.x)*4,row*r.w*4,(row+1)*r.w*4);
 function circle(cx,cy,rad,color){
  for(let y=Math.max(0,Math.floor((cy-rad-1)*S));y<Math.min(IH,(cy+rad+1)*S);y++)for(let x=Math.max(0,Math.floor((cx-rad-1)*S));x<Math.min(IW,(cx+rad+1)*S);x++){
   const a=Math.max(0,Math.min(1,rad*S+.5-Math.hypot(x+.5-cx*S,y+.5-cy*S))),i=(y*IW+x)*4;
   if(a)for(let k=0;k<3;k++)px[i+k]=Math.round(px[i+k]*(1-a)+color[k]*a);
  }
 }
 const limit=Number(e.camera&&e.camera.limit),speed=e.useAverage?e.averageKmh:Number.isFinite(e.measuredSpeedKmh)?e.measuredSpeedKmh:e.speedKmh;
 const known=!police&&Number.isFinite(limit)&&limit>0;
 if(known){circle(44,161,25,RED);circle(44,161,20,[255,255,255]);const size=text.fittedSize(String(limit),26,34);label(String(limit),44,161-text.capHeight(size)/2,size,[20,29,38,255],{align:'center'});}
 else label(police?'ПОСТ ДПС':'ЛИМИТ Н/Д',14,151,12,MUTED,{maxWidth:66});
 if(e.estimated){label(gpsMessage('lost'),88,141,15,WHITE,{maxWidth:100});label('РАСЧЁТНО',88,168,13,MUTED);}
 else if(known&&e.type==='speeding'&&Number.isFinite(speed)&&speed>limit){
  label('ПРЕВЫШЕНИЕ',88,139,12,MUTED);
  const excess='+'+Math.round(speed-limit),size=text.fittedSize(excess,29,72);
  label(excess,88,158,size,RED);
  label('КМ/Ч',159,158+text.capHeight(size)-text.capHeight(12),12,MUTED);
 }
 else if(e.useAverage&&Number.isFinite(e.averageKmh)){label(e.partialSection?'ЧАСТ. СРЕДНЯЯ':'СРЕДНЯЯ',88,139,10,MUTED,{maxWidth:100});label(Math.round(e.averageKmh)+' КМ/Ч',88,162,23,WHITE,{maxWidth:100});}
 else {label(e.phase==='section'?'УЧАСТОК':e.phase==='rear'?'ПОСЛЕ КАМЕРЫ':police?'ВПЕРЕДИ':'КОНТРОЛЬ',88,145,13,MUTED,{maxWidth:100});label(police?'ПОСТ':'СКОРОСТИ',88,169,13,WHITE,{maxWidth:100});}
 return px;
}
module.exports={W,H,S,IW,IH,POSITION,RING,DISTANCE_RECT,makeFrame,distancePixels};
