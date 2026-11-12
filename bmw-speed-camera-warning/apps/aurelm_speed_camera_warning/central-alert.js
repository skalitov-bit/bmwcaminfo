'use strict';
const text=require('./cluster-text');
const cameraIcon=require('./camera-icon');
const {drawSelection}=require('./screen-style');
const {monotonicMs}=require('./ring-pulse');
const {hudLabels}=require('./camera-label');
const WHITE=[245,249,252],MUTED=[169,190,207],RED=[211,44,54];
const BANNER_ANIMATION_MS=2400;
function drawCentralAlert(cv,event,fallbackSpeed,bounds,animationMs){
 const original=cv,native=cv.recording===true;
 const k=bounds?bounds.w/1456:1;
 if(bounds){
  const target=cv,ox=bounds.x-72*k,oy=bounds.y-86*k;
  const scaled={
   fillRect:(x,y,w,h,c)=>{
    const left=Math.round(ox+x*k),top=Math.round(oy+y*k);
    target.fillRect(left,top,Math.round(ox+(x+w)*k)-left,Math.round(oy+(y+h)*k)-top,c);
   },
   roundRect:(x,y,w,h,r,c)=>target.roundRect(ox+x*k,oy+y*k,w*k,h*k,r*k,c),
   strokeRoundRect:(x,y,w,h,r,t,c)=>target.strokeRoundRect(ox+x*k,oy+y*k,w*k,h*k,r*k,t*k,c),
   circle:(x,y,r,c)=>target.circle(ox+x*k,oy+y*k,r*k,c),
   blit:(img,x,y)=>target.blit(img,ox+x*k,oy+y*k)
  };
  cv=scaled;
 }
 const e=event,c=e.camera||{},x=72,y=86,w=1456,h=174;
 const measured=e.useAverage?e.averageKmh:Number.isFinite(e.speedKmh)?e.speedKmh:fallbackSpeed;
 const speed=Number.isFinite(measured)?Math.round(measured):null;
 const limit=Number.isFinite(c.limit)&&c.limit>0?c.limit:null;
 const speeding=e.type==='speeding'||e.speeding===true;
 const gw=Math.ceil(w*k),gh=Math.ceil(h*k),glyphs={w:gw,h:gh,d:Buffer.alloc(gw*gh*4)};
 const label=(value,l,t,size,color,maxWidth,align)=>native?require('./hud-canvas').text(original,value,(bounds?bounds.x:x)+l*k,(bounds?bounds.y:y)+t*k,size*k,color,{maxWidth:maxWidth*k,align}):text.draw(glyphs.d,gw,gh,1,value,l*k,t*k,size*k,color,{maxWidth:maxWidth*k,align});
 drawSelection(cv,x,y,w,h);
 // A periodic highlight travels right; the wrap is continuous at both edges.
 // Keep the menu-style border and all foreground content stationary.
 const phase=(Number.isFinite(animationMs)?animationMs:monotonicMs())/BANNER_ANIMATION_MS;
 const stripes=128,innerWidth=w-4;
 for(let i=0;i<stripes;i++){
  const left=Math.round(i*innerWidth/stripes),right=Math.round((i+1)*innerWidth/stripes);
  const wave=Math.pow((1+Math.cos(2*Math.PI*(i/stripes-phase)))/2,4);
  cv.fillRect(x+4+left,y+1,right-left,h-2,RED.concat(Math.round(36*wave)));
 }
 cameraIcon.drawCanvas(original,(bounds?bounds.x:x)+23*k,(bounds?bounds.y:y)+29*k,140*k,116*k,[234,242,248]);
 const titles=hudLabels(c);
 label(titles.control,194,13,30,WHITE,510);
 if(titles.model)label(titles.model,194,48,26,MUTED,510);
 const prefix=e.phase==='section'?'ДО КОНЦА ':e.phase==='rear'?'ЗА КАМЕРОЙ ':'ЧЕРЕЗ ';
 label(prefix+Math.max(0,Math.round(e.distanceM||0))+' М',194,90,46,speeding?RED:[255,205,74],510);
 if(e.useAverage)label(e.partialSection?'СРЕДНЯЯ С МОМЕНТА ПОДКЛЮЧЕНИЯ':'СРЕДНЯЯ НА УЧАСТКЕ',194,146,18,MUTED,510);
 if(limit!==null){
  // Same 32:26 outer/inner radius ratio and foreground as HUD/KOMBI, enlarged.
  cv.circle(x+786,y+h/2,54,'#d32c36');
  cv.circle(x+786,y+h/2,54*26/32,'#ffffff');
  const size=text.fittedSize(String(limit),54,74);
  label(String(limit),786,h/2-text.capHeight(size)/2,size,[20,29,38],74,'center');
  label('ОГРАНИЧЕНИЕ',864,30,24,MUTED,211);
  label('КМ/Ч',864,74,30,WHITE,211);
 }else{
  label('ЛИМИТ',748,35,32,MUTED,320);
  label('НЕ УКАЗАН',748,80,30,MUTED,320);
 }
 if(speeding){
  const excessTitleY=(h-text.capHeight(26)-12-text.capHeight(46))/2;
  label('ПРЕВЫШЕНИЕ',1265,excessTitleY,26,WHITE,290,'center');
  const excess=speed!==null&&limit!==null?'+'+Math.max(0,speed-limit)+' КМ/Ч':'НЕТ ДАННЫХ';
  label(excess,1265,excessTitleY+text.capHeight(26)+12,46,WHITE,290,'center');
 }else{
  label(e.useAverage?'СРЕДНЯЯ':'СКОРОСТЬ',1120,28,26,MUTED,290);
  label(speed!==null?speed+' КМ/Ч':'НЕТ ДАННЫХ',1120,71,44,WHITE,290);
 }
 if(!native)cv.blit(glyphs,x,y);
}
module.exports={drawCentralAlert,BANNER_ANIMATION_MS};
