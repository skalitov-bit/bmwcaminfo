'use strict';
const defaults={voice:100,beeper:100,duck:25,musicDuck:true};
const ducks=[100,75,50,25,10],duckLabels=['НЕТ','ЛЁГКОЕ','СРЕДНЕЕ','СИЛЬНОЕ','МАКСИМАЛЬНОЕ'];
function musicStatus(r){
 const d=r.musicDucking||{},state=d.state;
 if(state==='disabled')return 'МУЗЫКА: ПРИГЛУШЕНИЕ ВЫКЛЮЧЕНО.';
 if(d.recoveryPending)return 'МУЗЫКА: ВОССТАНОВЛЕНИЕ ГРОМКОСТИ НЕ ПОДТВЕРЖДЕНО; СМ. ОТЧЁТ.';
 if(d.apiConfirmed)return 'МУЗЫКА: КОМАНДА −6 дБ И ВОССТАНОВЛЕНИЕ ПРОВЕРЕНЫ; ОЦЕНИТЕ НА СЛУХ.';
 if(state==='no-music')return 'МУЗЫКА: АКТИВНЫЙ ИСТОЧНИК НЕ НАЙДЕН. ВКЛЮЧИТЕ МУЗЫКУ ДЛЯ ПРОБЫ.';
 if(['unavailable','unsupported','error'].includes(state))return 'МУЗЫКА: ПРИГЛУШЕНИЕ НЕДОСТУПНО НА ЭТОЙ MGU. ПОДРОБНОСТИ В ОТЧЁТЕ.';
 return 'МУЗЫКА: ПРИГЛУШЕНИЕ ЕЩЁ НЕ ПРОВЕРЕНО.';
}
class MixerPanel {
 constructor(parent){this.p=parent;this.ready=false;this.values=Object.assign({},defaults);this.saved=null;this.message='';}
 async open(){const p=this.p;if(p.busy)return;p.screen='mixer';this.ready=false;this.message='ЗАГРУЗКА НАСТРОЕК…';await this.action('audio-mixer-get');}
 async action(action){
  const p=this.p;if(p.busy)return;if(action!=='audio-mixer-get'&&!this.ready)return;
  if(action==='audio-mixer-listen'&&p.moving()){this.message='Для прослушивания остановите автомобиль.';p.change();return;}
  const generation=++p.generation,values=Object.assign({},this.values);p.busy=true;p.testing=action==='audio-mixer-listen';this.message=action==='audio-mixer-listen'?'ПРОСЛУШИВАНИЕ: БИПЕР → ГОЛОС С БИПЕРОМ → БИПЕР…':action==='audio-mixer-save'?'СОХРАНЕНИЕ…':'ЗАГРУЗКА…';p.change();
  try{
   const r=await p.request({action,values,volume:p.o.getVolume?p.o.getVolume():40});if(generation!==p.generation)return;
   if(r.mixerProtocol!==1)throw Error('Обновите звуковой компонент для микшера.');
   this.musicDuckSupported=r.musicDuckProtocol===1;
   if(action!=='audio-mixer-listen'){
    if(!r.values||!['voice','beeper','duck'].every(k=>typeof r.values[k]==='number'))throw Error('Некорректный ответ микшера');
    this.values=Object.assign({},defaults,r.values);this.saved=Object.assign({},r.values);this.backend=r.backend;this.overlay=r.overlay;this.ready=true;
    this.message=action==='audio-mixer-save'?'Сохранено. Настройки действуют сейчас и после перезапуска.':r.loadError?'Файл настроек повреждён: используются исходные значения.':'Измените баланс и прослушайте. До сохранения настройки не применяются.';
   }else this.message=(r.voiceOnly?'Проба M4A: только голос. ':'Проба завершена. ')+musicStatus(r)+' Настройки не сохранены.';
  }catch(e){if(generation===p.generation)this.message='ОШИБКА: '+e.message;}
  finally{if(generation===p.generation){p.busy=false;p.testing=false;p.change();}}
 }
 change(key,delta){if(this.p.busy||!this.ready)return;if(key==='duck')this.values.duck=ducks[Math.max(0,Math.min(4,ducks.indexOf(this.values.duck)+delta))];else this.values[key]=Math.max(0,Math.min(100,this.values[key]+delta*20));this.message='Есть изменения. «ПРОСЛУШАТЬ» — проба, «СОХРАНИТЬ» — применить.';this.p.change();}
 toggleMusic(){if(this.p.busy||!this.ready||!this.musicDuckSupported)return;this.values.musicDuck=!this.values.musicDuck;this.message='Музыка: '+(this.values.musicDuck?'приглушать при речи (−6 дБ), затем восстанавливать.':'не менять громкость.')+' Нажмите «СОХРАНИТЬ».';this.p.change();}
 reset(){if(this.p.busy||!this.ready)return;this.values=Object.assign({},defaults);this.message='Исходный баланс восстановлен в форме. Нажмите «СОХРАНИТЬ» для применения.';this.p.change();}
 draw(cv,style,target){
  const p=this.p,C=style.colors,txt=style.text,enabled=this.ready&&!p.busy;
  const button=(label,x,y,w,h,run,key,on)=>{cv.fillRect(x,y,w,h,C.panel);cv.strokeRoundRect(x,y,w,h,0,1,on?C.edge:'#343434');txt(cv,label,x+w/2,y+h/2+9,25,on?C.text:C.muted,{align:'center',maxWidth:w-18});if(on){p.buttons.push({x,y,w,h,run});target(cv,x,y,w,h,run,key);}};
  const labels={file:'M4A',pulse:'PULSEAUDIO',converter:'ALSA CONVERTER',alsa:'ALSA','converter-hold':'НЕПРЕРЫВНЫЙ ПОТОК','converter-reset':'ПОЛНЫЙ ПЕРЕЗАПУСК','converter-period':'ПО ГОТОВНОСТИ ALSA'};
  txt(cv,'КАНАЛ: '+(labels[this.backend]||this.backend||'…')+(this.overlay?' + OVERLAY':''),286,91,24,C.text,{maxWidth:1270});
  txt(cv,this.backend==='file'?'M4A: ТОЛЬКО ГОЛОС, ДИСКРЕТНЫЕ УРОВНИ. БИПЕР — В ALSA / PULSEAUDIO.':'БАЛАНС ОТНОСИТЕЛЬНО ОБЩЕЙ ГРОМКОСТИ. ПРОБА ИСПОЛЬЗУЕТ СОХРАНЁННЫЙ КАНАЛ.',286,115,18,C.muted,{maxWidth:1270});
  [['voice','ГОЛОС'],['beeper','БИПЕР'],['duck','ПРИГЛУШЕНИЕ БИПЕРА ПРИ РЕЧИ']].forEach((row,i)=>{
   const key=row[0],y=132+i*62;cv.fillRect(266,y,1314,56,C.panel);txt(cv,row[1],286,y+42,key==='duck'?23:29,C.text,{maxWidth:590});
   button('−',890,y+4,90,48,()=>this.change(key,-1),'mixer-'+key+'-down',enabled);
   button('+',1470,y+4,90,48,()=>this.change(key,1),'mixer-'+key+'-up',enabled);
   if(key==='duck')txt(cv,duckLabels[ducks.indexOf(this.values.duck)]||'…',1220,y+42,25,C.text,{align:'center',maxWidth:460});
   else{for(let j=0;j<5;j++){const h=16+j*8;cv.fillRect(1050+j*64,y+55-h,43,h,this.values[key]>=20*(j+1)?C.red:'#333333');}if(!this.values[key])txt(cv,'ВЫКЛ.',1418,y+43,18,C.muted,{align:'center'});}
  });
  cv.fillRect(266,318,1314,44,C.panel);txt(cv,'ПРИГЛУШАТЬ МУЗЫКУ ПРИ РЕЧИ',286,349,23,C.text,{maxWidth:700});
  button(this.musicDuckSupported?(this.values.musicDuck?'ВКЛЮЧЕНО':'ВЫКЛЮЧЕНО'):'ОБНОВИТЕ ЗВУКОВОЙ КОМПОНЕНТ',1010,318,550,44,()=>this.toggleMusic(),'mixer-music-duck',enabled&&this.musicDuckSupported);
  const lines=String(this.message).match(/.{1,108}(?:\s|$)|.{1,108}/g)||[];lines.slice(0,2).forEach((line,i)=>txt(cv,line.trim(),286,379+i*22,18,C.text,{maxWidth:1270}));
  button('ПРОСЛУШАТЬ',266,425,318,58,()=>this.action('audio-mixer-listen'),'mixer-listen',enabled);
  button('СОХРАНИТЬ',598,425,318,58,()=>this.action('audio-mixer-save'),'mixer-save',enabled);
  button('СБРОСИТЬ',930,425,318,58,()=>this.reset(),'mixer-reset',enabled);
  button('НАЗАД',1262,425,318,58,()=>{p.stop();p.screen='channels';if(p.mixerBack)p.mixerBack();else p.change();},'mixer-back',true);
  txt(cv,'МУЗЫКА: CARPLAY / BT / USB / РАДИО. ДОСТУПНОСТЬ ПРИГЛУШЕНИЯ ЗАВИСИТ ОТ MGU.',286,511,18,C.muted,{maxWidth:1270});
 }
}
module.exports={MixerPanel,defaults,ducks,musicStatus};
