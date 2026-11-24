'use strict';
const {TYPES,key,enabled}=require('./notification-types');
// Expanded checkbox list; touch and controller use the same callbacks.
class NotificationTypePanel{
 constructor(settings,change,back){this.settings=settings;this.change=change;this.back=back;this.channel='banner';this.buttons=[];}
 open(channel){this.channel=channel;}
 draw(cv,style,target){
  const C=style.colors,txt=style.text;this.buttons=[];
  style.heading(cv,this.channel==='banner'?'БАННЕР — ТИПЫ ТОЧЕК':'ГОЛОСОВЫЕ УВЕДОМЛЕНИЯ — ТИПЫ ТОЧЕК','');
  const add=(x,y,w,h,run,id)=>{this.buttons.push({x,y,w,h,run});target(cv,x,y,w,h,run,id);};
  TYPES.forEach((t,i)=>{const x=276+Math.floor(i/11)*660,y=83+(i%11)*34,on=enabled(k=>this.settings.get(k),this.channel,t.id);
   cv.fillRect(x,y,644,31,C.panel);cv.strokeRoundRect(x+12,y+6,20,20,0,2,on?C.red:C.muted);
   if(on){cv.line(x+16,y+16,x+21,y+22,2,C.red);cv.line(x+21,y+22,x+29,y+10,2,C.red);}
   txt(cv,t.label,x+46,y+24,21,C.text,{maxWidth:580});
   add(x,y,644,31,()=>{this.settings.set(key(this.channel,t.id),on?'off':'on');this.change();},'type-'+this.channel+'-'+t.id);
  });
  txt(cv,'Изменения сохраняются сразу. Снятая галочка запрещает этот тип даже в режиме тестирования.',288,477,18,C.muted,{maxWidth:1270});
  cv.fillRect(1200,480,370,38,C.panel);txt(cv,'НАЗАД',1385,507,24,C.text,{align:'center'});add(1200,480,370,38,this.back,'type-back');
 }
 tap(x,y){const b=this.buttons.find(b=>x>=b.x&&x<b.x+b.w&&y>=b.y&&y<b.y+b.h);if(b)b.run();}
}
module.exports={NotificationTypePanel};
