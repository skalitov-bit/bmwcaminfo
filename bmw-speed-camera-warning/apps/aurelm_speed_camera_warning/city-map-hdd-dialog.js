'use strict';
class CityMapHddDialog{
 constructor(store){this.store=store;this.buttons=[];}
 draw(cv,style,target){const n=this.store.notice;if(!n)return;const C=style.colors;
  cv.fillRect(180,44,1240,432,C.panel);style.drawSelection(cv,180,44,1240,432);
  let title,lines;
  if(n.kind==='found'){title='HDD ОБНАРУЖЕН';lines=[
   'В автомобиле обнаружен доступный жёсткий диск.',
   'Будет предпринята попытка переноса всех скачанных карт на HDD.',
   'Лимит хранения на HDD увеличится со 128 МБ до 4 ГБ.',
   'Файлы будут проверены. При ошибке прежняя карта сохранится.',
   'База камер и уведомления продолжат работать.'
  ];}else if(n.kind==='success'){title=n.empty||n.already?'HDD ГОТОВ К РАБОТЕ':'ПЕРЕНОС КАРТ ЗАВЕРШЁН';lines=n.empty?[
   'Скачанных карт пока нет. Новые карты будут сохраняться на HDD.',
   'Лимит хранения карт на HDD: 4 ГБ.',
   'База камер остаётся во внутренней памяти.'
  ]:[
   'Все скачанные карты размещены на HDD.',
   n.already?'Карты уже находятся на HDD.':'Перенесено и проверено карт: '+n.count,
   'Лимит хранения карт на HDD: 4 ГБ.',
   'База камер осталась на прежнем месте.'
  ];}else{title='ПЕРЕНОС НЕ ЗАВЕРШЁН';lines=[
   'Не удалось перенести все карты на HDD.',
   'Перенесено карт: '+(n.count||0)+' · Осталось: '+(n.remaining||0),
   'Неперенесённые карты сохранены на прежнем месте.',
   'База камер и уведомления продолжат работать.'
  ];}
  style.text(cv,title,800,102,32,C.text,{align:'center',maxWidth:1120});
  lines.forEach((s,i)=>style.text(cv,s,800,164+i*40,23,C.text,{align:'center',maxWidth:1120}));
  const found=n.kind==='found';this.buttons=found?[
   {key:'hdd-transfer-start',label:'ПРОДОЛЖИТЬ',x:370,w:410,start:true},
   {key:'hdd-transfer-later',label:'ПОЗЖЕ',x:820,w:410,start:false}
  ]:[{key:'hdd-transfer-ok',label:'ПОНЯТНО',x:590,w:420,start:true}];
  this.buttons.forEach(b=>{b.y=388;b.h=62;b.run=()=>this.store.respondToHddNotice(b.start);cv.fillRect(b.x,b.y,b.w,b.h,C.bg);style.drawSelection(cv,b.x,b.y,b.w,b.h);style.text(cv,b.label,b.x+b.w/2,b.y+40,26,C.text,{align:'center',maxWidth:b.w-30});target(cv,b.x,b.y,b.w,b.h,b.run,b.key);});
 }
 tap(x,y){const b=this.buttons.find(b=>x>=b.x&&x<b.x+b.w&&y>=b.y&&y<b.y+b.h);if(b)return b.run();}
}
module.exports={CityMapHddDialog};
