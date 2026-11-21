'use strict';
const fs=require('fs'),path=require('path');
const DEFAULT={x:190,y:182},AREA={w:800,h:480},CARD={w:420,h:116};
function normalize(p){
 p=p||{};
 const axis=(v,fallback,max)=>typeof v==='number'&&Number.isFinite(v)?Math.max(0,Math.min(max,Math.round(v))):fallback;
 return {x:axis(p.x,DEFAULT.x,AREA.w-CARD.w),y:axis(p.y,DEFAULT.y,AREA.h-CARD.h),stripe:p.stripe!==false};
}
class HudPositionStore{
 constructor(dir){this.file=path.join(dir,'hud-position.json');}
 load(){try{const v=JSON.parse(fs.readFileSync(this.file,'utf8'));return v.schema===1?normalize(v.hud):normalize();}catch(e){return normalize();}}
 save(p){const v=normalize(p),tmp=this.file+'.tmp';if(!fs.existsSync(path.dirname(this.file)))fs.mkdirSync(path.dirname(this.file));fs.writeFileSync(tmp,JSON.stringify({schema:1,hud:v})+'\n');fs.renameSync(tmp,this.file);return v;}
}
// HUD-only position and stripe preferences; audio is unchanged.
class HudPositionEditor{
 constructor(options){this.o=options;this.store=options.store;this.output=options.output;this.draft=this.store.load();this.message='';this.active=false;this.busy=false;this.listeners=[];this.now=options.now||Date.now;}
 open(){this.stop();this.draft=this.store.load();this.message='ШАГ 5 · ВРАЩАЙТЕ ДЖОЙСТИК И НАЖИМАЙТЕ';this.active=true;}
 stop(){this.active=false;this.finish();}
 finish(message){
  if(this.busy){
   this.busy=false;
   if(this.client)this.listeners.forEach(p=>this.client.removeListener(p[0],p[1]));
   this.listeners=[];this.client=null;
   this.output.setGpsStatus('');this.output.clear();
   this.output.setHudPosition(this.store.load());this.output.setMode(this.originalMode);
   this.output.setGpsStatus(this.originalGps||'');
  }
  if(message){this.message=message;this.o.change();}
 }
 listen(name,fn){this.listeners.push([name,fn]);this.client.on(name,fn);}
 startBanner(){
  if(!this.busy||this.shown)return;
  if(this.o.moving()){this.finish('ТЕСТ ОСТАНОВЛЕН: АВТОМОБИЛЬ ДВИЖЕТСЯ');return;}
  if(!/(^|,)hud:/.test(String(this.client.targets||''))){this.finish('ОШИБКА: СЕРВИС НЕ ОБЪЯВИЛ HUD');return;}
  this.shown=true;this.deadline=this.now()+45000;
  this.output.show({camera:{id:'hud-position-test',camera_model:'ТЕСТ HUD',mapcamTypeCode:1,limit:60},type:'camera',distanceM:300,speedKmh:0});
  if(this.busy){this.message='ТЕСТ HUD ОТПРАВЛЕН · 45 СЕК · БЕЗ ЗВУКА';this.o.change();}
 }
 move(dx,dy){this.draft=normalize(Object.assign({},this.draft,{x:this.draft.x+dx,y:this.draft.y+dy}));this.changed();}
 toggleStripe(){this.draft.stripe=!this.draft.stripe;this.changed();}
 changed(){this.message='ИЗМЕНЕНИЯ НЕ СОХРАНЕНЫ';if(this.busy)this.output.setHudPosition(this.draft);this.o.change();}
 test(){
  if(this.o.moving()){this.message='ТЕСТ ДОСТУПЕН ПОСЛЕ ОСТАНОВКИ';this.o.change();return;}
  this.finish();this.originalMode=this.output.mode;this.originalGps=this.output.gpsStatus;
  this.busy=true;this.shown=false;this.deadline=this.now()+3500;
  this.message='ПОДКЛЮЧЕНИЕ К HUD…';
  try{
   this.output.setGpsStatus('');this.output.clear();this.output.setMode('hud');this.output.setHudPosition(this.draft);
   this.client=this.output.cr;
   if(!this.client)throw Error('НЕТ ПОДКЛЮЧЕНИЯ К СЕРВИСУ');
   this.listen('ready',()=>this.startBanner());
   this.listen('refused',(op,ref,reason)=>this.finish('ОТКАЗ HUD: '+String(reason||op).slice(0,55)));
   this.listen('disconnected',()=>this.finish('ОШИБКА: СВЯЗЬ С HUD ПОТЕРЯНА'));
   this.listen('target',(name,state,holder,reason,guideDisabled,disabled)=>{
    if(name==='hud'&&(disabled||['blocked','disabled','unavailable','denied'].indexOf(state)>=0))this.finish('HUD НЕДОСТУПЕН: '+String(reason||state).slice(0,50));
   });
   this.listen('layer',(ref,state,reason)=>{
    if(ref===this.output.layers.hud&&['blocked','refused','suspended','failed'].indexOf(state)>=0)this.finish('СЛОЙ HUD: '+String(reason||state).slice(0,55));
   });
   if(this.client.ready)this.startBanner();else this.o.change();
  }catch(e){this.finish('ОШИБКА HUD: '+String(e.message||e).slice(0,55));}
 }
 save(){try{this.draft=this.store.save(this.draft);this.o.apply(this.draft);this.message='НАСТРОЙКИ HUD СОХРАНЕНЫ';}catch(e){this.message='ОШИБКА СОХРАНЕНИЯ · ПОВТОРИТЕ';}this.o.change();}
 reset(){this.draft=normalize();if(this.busy)this.output.setHudPosition(this.draft);this.message='ПО УМОЛЧАНИЮ · НАЖМИТЕ СОХРАНИТЬ';this.o.change();}
 tick(){if(!this.busy)return;if(this.o.moving())this.finish('ТЕСТ ОСТАНОВЛЕН: АВТОМОБИЛЬ ДВИЖЕТСЯ');else if(this.now()>=this.deadline)this.finish(this.shown?'ТЕСТ HUD ЗАВЕРШЁН':'ОШИБКА: HUD НЕ ОТВЕТИЛ ЗА 3,5 СЕК');}
 buttons(){return [
  {key:'hud-left',label:'ВЛЕВО',arrow:[-1,0],x:290,y:116,w:190,h:64,run:()=>this.move(-5,0)},
  {key:'hud-right',label:'ВПРАВО',arrow:[1,0],x:500,y:116,w:190,h:64,run:()=>this.move(5,0)},
  {key:'hud-up',label:'ВВЕРХ',arrow:[0,-1],x:290,y:198,w:190,h:64,run:()=>this.move(0,-5)},
  {key:'hud-down',label:'ВНИЗ',arrow:[0,1],x:500,y:198,w:190,h:64,run:()=>this.move(0,5)},
  {key:'hud-test',label:'ТЕСТ HUD',x:290,y:280,w:400,h:64,run:()=>this.test()},
  {key:'hud-stripe',label:'ПОЛОСА НА БАННЕРЕ',checkbox:true,checked:this.draft.stripe,x:290,y:350,w:400,h:34,run:()=>this.toggleStripe()},
  {key:'hud-save',label:'СОХРАНИТЬ',x:266,y:442,w:422,h:60,run:()=>this.save()},
  {key:'hud-reset',label:'СБРОСИТЬ',x:710,y:442,w:422,h:60,run:()=>this.reset()},
  {key:'hud-back',label:'НАЗАД',x:1154,y:442,w:426,h:60,run:()=>this.o.back()}
 ];}
 tap(x,y){const b=this.buttons().find(b=>x>=b.x&&x<b.x+b.w&&y>=b.y&&y<b.y+b.h);if(b)b.run();}
 draw(cv,style,target){
  const C=style.colors,t=(s,x,y,size,c,o)=>style.text(cv,s,x,y,size,c||C.text,o);
  style.heading(cv,'ПОЛОЖЕНИЕ HUD','ТОЛЬКО ПРОЕКЦИОННЫЙ ДИСПЛЕЙ');
  cv.fillRect(266,74,1314,350,C.panel);
  t('ГОРИЗОНТАЛЬ: '+(this.draft.x-DEFAULT.x)+' / ВЕРТИКАЛЬ: '+(this.draft.y-DEFAULT.y),742,104,22);
  const x=742,y=126,k=.72;
  cv.fillRect(x,y,AREA.w*k,AREA.h*k*.77,'#000000');
  // Miniature uses uniform scaling; label is outside the outline.
  const scale=.52,px=842,py=128;
  cv.strokeRoundRect(px,py,AREA.w*scale,AREA.h*scale,0,1,C.muted);
  const bx=px+this.draft.x*scale,by=py+this.draft.y*scale;
  if(this.draft.stripe)cv.fillRect(bx,by,CARD.w*scale,5*scale,C.yellow);
  t('СКОРОСТЬ · ТЕСТ HUD',bx+10,by+22,13);t('300 М',bx+10,by+47,22);
  style.speedSign(cv,60,bx+CARD.w*scale-32,by+30,24);
  t('ПРЕДПРОСМОТР ОБЛАСТИ HUD',1050,405,18,C.muted,{align:'center',maxWidth:620});
  t(this.message,290,416,18,C.yellow,{maxWidth:430});
  this.buttons().forEach(b=>{
   cv.fillRect(b.x,b.y,b.w,b.h,C.bg);cv.strokeRoundRect(b.x,b.y,b.w,b.h,0,1,C.muted);
   if(b.checkbox){
    const x=b.x+12,y=b.y+7;cv.strokeRoundRect(x,y,20,20,0,2,b.checked?C.red:C.muted);
    if(b.checked){cv.line(x+3,y+10,x+8,y+16,2,C.red);cv.line(x+8,y+16,x+18,y+3,2,C.red);}
    t(b.label,b.x+48,b.y+24,20,C.text,{maxWidth:b.w-60});
   }else if(b.arrow){
    // Geometry keeps arrows sharp and independent of the installed font glyphs.
    const cx=b.x+b.w/2,cy=b.y+b.h/2,dx=b.arrow[0],dy=b.arrow[1];
    const tipX=cx+dx*17,tipY=cy+dy*17;
    cv.line(cx-dx*17,cy-dy*17,tipX,tipY,4,C.text);
    for(const side of [-1,1])cv.line(tipX,tipY,cx+dx*3-dy*side*13,cy+dy*3+dx*side*13,4,C.text);
   }else t(b.label,b.x+b.w/2,b.y+b.h/2+8,23,C.text,{align:'center',maxWidth:b.w-20});
   target(cv,b.x,b.y,b.w,b.h,b.run,b.key);
  });
 }
}
module.exports={DEFAULT,AREA,CARD,normalize,HudPositionStore,HudPositionEditor};
