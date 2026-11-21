'use strict';
class BeeperSoundPanel {
 constructor(parent){this.p=parent;this.id='1';this.saved=null;this.ready=false;this.message='';}
 async open(){if(this.p.busy)return;this.p.screen='beeper-sounds';this.ready=false;await this.action('beeper-sounds-get');}
 async action(action){
  const p=this.p;if(p.busy||action!=='beeper-sounds-get'&&!this.ready)return;
  if(action==='beeper-sounds-listen'&&p.moving()){this.message='Для прослушивания остановите автомобиль.';p.change();return;}
  const generation=++p.generation,id=this.id;p.busy=true;p.testing=action==='beeper-sounds-listen';this.message=p.testing?'ПРОСЛУШИВАНИЕ…':'ЗАГРУЗКА…';p.change();
  try{const r=await p.request({action,id,volume:p.o.getVolume?p.o.getVolume():40});if(generation!==p.generation)return;if(r.beeperSoundsProtocol!==1)throw Error('Обновите звуковой компонент для выбора бипера.');
   if(action!=='beeper-sounds-listen'){if(!/^[1-8]$/.test(r.id))throw Error('Неверный номер бипера');this.id=this.saved=r.id;this.ready=true;this.message=action==='beeper-sounds-save'?'СОХРАНЕНО. ВЫБРАННЫЙ ЗВУК ИСПОЛЬЗУЕТСЯ В УВЕДОМЛЕНИЯХ.':'ВЫБЕРИТЕ ЗВУК, ПРОСЛУШАЙТЕ И СОХРАНИТЕ.';}
   else this.message='ПРОСЛУШИВАНИЕ ЗАВЕРШЕНО. ДЛЯ ПРИМЕНЕНИЯ НАЖМИТЕ «СОХРАНИТЬ».';
  }catch(e){if(generation===p.generation)this.message='ОШИБКА: '+e.message;}
  finally{if(generation===p.generation){p.busy=false;p.testing=false;p.change();}}
 }
 draw(cv,style,target){
  const p=this.p,C=style.colors,txt=style.text,enabled=this.ready&&!p.busy;
  const button=(label,x,y,w,h,run,key,on,selected)=>{cv.fillRect(x,y,w,h,C.panel);if(selected)style.drawSelection(cv,x,y,w,h);txt(cv,label,x+w/2,y+h/2+9,25,on?C.text:C.muted,{align:'center',maxWidth:w-16});if(on){p.buttons.push({x,y,w,h,run});target(cv,x,y,w,h,run,key);}};
  txt(cv,'СОХРАНЁН: '+(this.saved?'БИПЕР '+this.saved:'…'),286,101,24,C.text);
  for(let i=0;i<8;i++){const id=String(i+1),x=266+(i>=4?664:0),y=125+i%4*61;button('БИПЕР '+id,x,y,650,54,()=>{this.id=id;this.message='НАЖМИТЕ «ПРОСЛУШАТЬ» ИЛИ «СОХРАНИТЬ».';p.change();},'beeper-choice-'+id,enabled,this.id===id);}
  txt(cv,this.message,286,398,18,C.text,{maxWidth:1270});
  button('ПРОСЛУШАТЬ',266,425,426,58,()=>this.action('beeper-sounds-listen'),'beeper-sound-listen',enabled);
  button('СОХРАНИТЬ',710,425,426,58,()=>this.action('beeper-sounds-save'),'beeper-sound-save',enabled);
  button('НАЗАД',1154,425,426,58,()=>{p.stop();p.screen='channels';if(p.beeperBack)p.beeperBack();else p.change();},'beeper-sound-back',true);
  txt(cv,'ЧАСТОТА ПОВТОРОВ И БАЛАНС МИКШЕРА СОХРАНЯЮТСЯ.',286,511,18,C.muted,{maxWidth:1270});
 }
}
module.exports={BeeperSoundPanel};
