'use strict';
const text=require('./cluster-text');
const cameraIcon=require('./camera-icon');
const {hudLabels}=require('./camera-label');
const WHITE=[245,249,252],MUTED=[169,190,207],RED=[211,44,54];
function drawCentralAlert(cv,event,fallbackSpeed,bounds){
 const original=cv,native=cv.recording===true;
 const k=bounds?bounds.w/1456:1;
 if(bounds){
  const target=cv,ox=bounds.x-72*k,oy=bounds.y-86*k;
  const scaled={
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
 cv.roundRect(x,y,w,h,18,'#080b10');
 cv.strokeRoundRect(x,y,w,h,18,2,speeding?'#d32c36':'#ffcd4a');
 cv.roundRect(x+18,y+18,150,106,14,'#10151c');
 cameraIcon.drawCanvas(original,(bounds?bounds.x:x)+58*k,(bounds?bounds.y:y)+42*k,70*k,58*k,[234,242,248]);
 const titles=hudLabels(c);
 label(titles.control,194,13,30,WHITE,510);
 if(titles.model)label(titles.model,194,48,26,MUTED,510);
 const prefix=e.phase==='section'?'ДО КОНЦА ':e.phase==='rear'?'ЗА КАМЕРОЙ ':'ЧЕРЕЗ ';
 label(prefix+Math.max(0,Math.round(e.distanceM||0))+' М',194,90,46,speeding?RED:[255,205,74],510);
 if(e.useAverage)label(e.partialSection?'СРЕДНЯЯ С МОМЕНТА ПОДКЛЮЧЕНИЯ':'СРЕДНЯЯ НА УЧАСТКЕ',194,146,18,MUTED,510);
 if(limit!==null){
  // Same 32:26 outer/inner radius ratio and foreground as HUD/KOMBI, enlarged.
  cv.circle(x+786,y+71,54,'#d32c36');
  cv.circle(x+786,y+71,54*26/32,'#ffffff');
  const size=text.fittedSize(String(limit),54,74);
  label(String(limit),786,71-text.capHeight(size)/2,size,[20,29,38],74,'center');
  label('ОГРАНИЧЕНИЕ',864,30,24,MUTED,211);
  label('КМ/Ч',864,74,30,WHITE,211);
 }else{
  label('ЛИМИТ',748,35,32,MUTED,320);
  label('НЕ УКАЗАН',748,80,30,MUTED,320);
 }
 if(speeding){
  cv.roundRect(x+1100,y+17,330,108,14,'#35121a');
  label('ПРЕВЫШЕНИЕ',1120,28,26,RED,290);
  const excess=speed!==null&&limit!==null?'+'+Math.max(0,speed-limit)+' КМ/Ч':'НЕТ ДАННЫХ';
  label(excess,1120,71,46,RED,290);
 }else{
  label(e.useAverage?'СРЕДНЯЯ':'СКОРОСТЬ',1120,28,26,MUTED,290);
  label(speed!==null?speed+' КМ/Ч':'НЕТ ДАННЫХ',1120,71,44,WHITE,290);
 }
 if(!native)cv.blit(glyphs,x,y);
}
module.exports={drawCentralAlert};
