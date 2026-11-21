'use strict';
const net=require('net');
const reportView=require('./diagnostic-report-view');
const qrcode=require('./report-qrcode');
const {PROFILES,isProfile}=require('./audio-profiles');
const MODES=[['converter','ALSA CONVERTER'],['alsa','ALSA'],['file','M4A']];
const CHOICES=MODES.concat(PROFILES,[['pulse','PULSEAUDIO']]);
function duckError(message){const s=String(message||'');
 if(s.indexOf('No unambiguous source-only')>=0)return 'Прошивка не объявила отдельную регулировку CarPlay с известными единицами. Громкость не менялась.';
 if(s.indexOf('Start CarPlay music first')>=0)return 'Сначала включите музыку CarPlay.';
 if(s.indexOf('Source offset changed externally')>=0)return 'Настройка канала изменилась извне. Новое значение сохранено.';
 if(s.indexOf('BMW audio method absent')>=0||s.indexOf('Source property units')>=0||s.indexOf('Unsupported source-property')>=0)return 'Интерфейс этой прошивки не поддерживает безопасную пробу. '+s;
 return s;
}
function channelError(message){const s=String(message||'');
 if(/no unique advertised SmartX OapGenericOverlay ALSA output/i.test(s))return 'ALSA не смогла однозначно выбрать выход Overlay. Причина требует диагностики. Используйте рабочий M4A + Overlay.';
 return s;
}
class AudioDiagnostics {
 constructor(change,options){this.change=change;this.o=options||{};this.net=this.o.net||net;this.busy=false;this.testing=false;this.backend=null;this.overlay=false;this.result=null;this.generation=0;this.message='Выберите режим для проверки голоса и бипера.';this.buttons=[];this.socket=null;this.mixerPanel=new (require('./mixer-panel').MixerPanel)(this);this.beeperPanel=new (require('./beeper-sound-panel').BeeperSoundPanel)(this);

 }
 async shareReport(){
  if(this.busy)return;
  if(this.moving()){this.message='Для передачи отчёта остановите автомобиль.';this.change();return;}
  const generation=++this.generation,lastMessage=this.message;
  this.screen='share';this.busy=true;this.reporting=true;this.share=null;this.shareIndex=0;this.shareQr=null;this.shareStopError=false;
  this.shareMessage='СБОР ДИАГНОСТИКИ…';this.change();
  try{
   const r=await this.request({action:'audio-report-share-start',appVersion:this.o.appVersion,backend:this.backend,overlay:this.overlay,lastMessage,gps:this.o.gpsReport?this.o.gpsReport():null});
   if(generation!==this.generation)return;
   if(r.reportShareProtocol!==1||!r.active||!r.urls||!r.urls.length)throw Error('Обновите звуковой компонент для передачи отчёта на телефон.');
   this.share=r;this.selectShareAddress(0);this.shareMessage='СЕРВЕР ВКЛЮЧЁН НА 10 МИНУТ';
   clearTimeout(this.shareExpiryTimer);this.shareExpiryTimer=setTimeout(()=>{if(this.screen==='share')this.change();},Math.max(1,r.expiresAt-Date.now()+30));
   if(this.shareExpiryTimer.unref)this.shareExpiryTimer.unref();
   this.pollShare(generation);
  }catch(e){if(generation===this.generation)this.shareMessage='НЕ УДАЛОСЬ ОТКРЫТЬ ДОСТУП: '+(/Unknown|Unsupported/.test(e.message)?'Обновите звуковой компонент.':e.message);}
  finally{if(generation===this.generation){this.busy=false;this.reporting=false;this.change();}}
 }
 pollShare(generation){
  clearTimeout(this.sharePollTimer);
  this.sharePollTimer=setTimeout(async()=>{
   if(generation!==this.generation||this.screen!=='share'||!this.share||this.busy)return;
   try{
    const r=await this.request({action:'audio-report-share-status'});
    if(generation!==this.generation||this.screen!=='share'||this.busy)return;
    if(!r.active){this.share=null;this.shareQr=null;this.shareMessage=r.error||'Передача отчёта отключена. Создайте новый отчёт.';this.change();return;}
    this.share=r;this.change();this.pollShare(generation);
   }catch(e){if(generation===this.generation&&this.screen==='share'&&!this.busy){this.share=null;this.shareQr=null;this.shareMessage='Не удалось проверить доступ к отчёту: '+e.message;this.change();}}
  },3000);
  if(this.sharePollTimer.unref)this.sharePollTimer.unref();
 }
 selectShareAddress(step){
  if(!this.share||!this.share.urls.length)return;
  this.shareIndex=(this.shareIndex+step+this.share.urls.length)%this.share.urls.length;
  const qr=qrcode(0,'M');qr.addData(this.share.urls[this.shareIndex],'Byte');qr.make();this.shareQr=qr;this.change();
 }
 async stopShare(){
  if(this.busy)return;clearTimeout(this.sharePollTimer);++this.generation;this.busy=true;this.change();
  try{const r=await this.request({action:'audio-report-share-stop'});if(r.reportShareProtocol!==1||r.active)throw Error('Отключение не подтверждено');this.share=null;this.shareQr=null;this.shareMessage='СЕРВЕР ОТКЛЮЧЁН. ССЫЛКА БОЛЬШЕ НЕ РАБОТАЕТ.';}
  catch(e){this.shareMessage='ОШИБКА ОТКЛЮЧЕНИЯ: '+e.message;this.shareStopError=true;}
  finally{this.busy=false;this.change();}
 }
 async showReport(kind){
  if(this.busy)return;
  if(this.moving()){this.message='Для просмотра отчёта остановите автомобиль.';this.change();return;}
  const lastMessage=this.message,generation=++this.generation;
  this.screen='report';this.reportKind=kind||'audio';this.reportPage=0;this.reportPages=[['Сбор данных…']];
  this.reportTime='';this.busy=true;this.reporting=true;this.change();
  try{
   let data;
   if(this.reportKind==='display'){
    if(!this.o.displayReport)throw Error('Диагностика приборки недоступна в этой сборке.');
    data=await this.o.displayReport();
   }else{
    const r=await this.request({action:'audio-report',screenOnly:true,appVersion:this.o.appVersion,backend:this.backend,overlay:this.overlay,lastMessage,gps:this.o.gpsReport?this.o.gpsReport():null});
    if(r.audioReportProtocol!==1||!r.report)throw Error('Для отчёта на экране обновите звуковой компонент. Эта версия поддерживает только файл.');
    data=r.report;
   }
   if(generation!==this.generation)return;
   this.reportTime=data.createdAt||'';
   this.reportPages=reportView.pages(this.reportKind==='display'?data:reportView.audioReport(data));
  }catch(e){if(generation===this.generation)this.reportPages=reportView.pages({'ОТЧЁТ НЕДОСТУПЕН':String(e.message)});}
  finally{if(generation===this.generation){this.busy=false;this.reporting=false;this.change();}}
 }
 turnReport(step){if(this.busy)return;this.reportPage=Math.max(0,Math.min(this.reportPages.length-1,this.reportPage+step));this.change();}
 closeReport(){if(this.busy)this.stop();this.screen='channels';if(this.reportHome==='engineering'&&this.o.closeDisplayReport){this.reportHome='audio';this.o.closeDisplayReport();}else this.change();}
 async saveReport(){
  if(this.busy)return;
  if(this.moving()){this.message='Для сохранения отчёта остановите автомобиль.';this.change();return;}
  const generation=++this.generation,lastMessage=this.message;
  this.busy=true;this.reporting=true;this.message='СБОР АУДИООТЧЁТА… РЕЖИМ ЗВУКА НЕ МЕНЯЕТСЯ.';this.change();
  try{
   const r=await this.request({action:'audio-report',appVersion:this.o.appVersion,backend:this.backend,overlay:this.overlay,lastMessage,gps:this.o.gpsReport?this.o.gpsReport():null});
   if(generation!==this.generation)return;
   if(r.audioReportProtocol!==1||!r.local)throw Error('Звуковой компонент не поддерживает сохранение отчёта. Требуется его обновление.');
   this.reportResult=r;
   this.message=r.usb?'ОТЧЁТ НА USB: SpeedCAM-Diagnostics / '+r.fileName+' · Передайте этот JSON-файл для анализа.':'ОТЧЁТ СОХРАНЁН В MGU. '+(r.usbError||'Копирование на USB не подтверждено.');
  }catch(e){if(generation===this.generation)this.message='ОТЧЁТ НЕ СОХРАНЁН: '+(/Unknown.*action/i.test(e.message)?'Обновите звуковой компонент для поддержки отчёта.':e.message);}
  finally{if(generation===this.generation){this.busy=false;this.reporting=false;this.change();}}
 }
 async loadSaved(){
  if(this.busy)return;const generation=++this.generation;this.confirmable=false;this.confirming=false;this.result=null;
  try{const r=await this.request({action:'audio-current'});if(generation!==this.generation||this.busy)return;
   const saved=r.saved||r.active;if(saved&&['smartx','converter-stable'].includes(saved.backend)){this.backend='converter';this.overlay=true;this.message='Прежний режим: обновите звуковой сервис для перехода на ALSA Converter + Overlay.';this.change();return;}if(saved&&CHOICES.some(m=>m[0]===saved.backend)){this.backend=saved.backend;this.overlay=saved.overlay===true;this.message=(r.saved?'Сохранено: ':'Текущий режим: ')+CHOICES.find(m=>m[0]===saved.backend)[1]+(this.overlay?' + OVERLAY':'')+'. Выберите режим для проверки.';this.change();}
  }catch(e){if(generation===this.generation){this.message='Выберите режим для проверки. '+e.message;this.change();}}
 }
 moving(){return !!(this.o.moving&&this.o.moving());}
 forceAudio(){return !!(this.o.getForceAudio&&this.o.getForceAudio());}
 toggleForceAudio(){
  if(this.busy||!this.o.setForceAudio)return;
  try{this.o.setForceAudio(!this.forceAudio());this.message=this.forceAudio()?'Сохранено: голос и бипер для каждой камеры на пути. M4A — только голос.':'Диагностический режим выключен. Обычные правила звука восстановлены.';}
  catch(e){this.message='Настройка не сохранена: '+e.message;}
  this.change();
 }
 async testConverter(){
  if(this.busy)return;
  if(this.moving()){this.message='Для проверки остановите автомобиль.';this.change();return;}
  const generation=++this.generation;this.confirmable=false;this.confirming=false;this.result=null;
  this.busy=true;this.testing=true;
  this.message='ПРОБА CONVERTER + OVERLAY: включите музыку CarPlay. Голос + бипер; сохранённый режим не меняется.';this.change();
  try{
   const r=await this.request({action:'audio-overlay-converter-test'});if(generation!==this.generation)return;
   if(r.converterProtocol!==1||!r.overlay||r.overlay.probeProfile!=='media-overlay-converter'||!r.overlay.accepted)throw Error('Обновите звуковой компонент: нет пробы Converter.');
   this.message='CONVERTER: поток завершён. Проверьте на слух голос, бипер и музыку. Результат — в отчёте; режим не сохранён.';
  }catch(e){if(generation===this.generation)this.message='CONVERTER / ОШИБКА: '+e.message;}
  finally{if(generation===this.generation){this.busy=false;this.testing=false;this.change();}}
 }
 async testDisplays(){
  if(this.busy)return;
  if(this.moving()){this.message='Для проверки остановите автомобиль.';this.change();return;}
  const generation=++this.generation;this.confirmable=false;this.confirming=false;
  this.screen='report';this.reportKind='display';this.reportPage=0;this.reportTime='';
  this.reportPages=[['ТЕСТ HUD + ПРИБОРКА','Стрелка: 500 м, ограничение 60 км/ч.','На обоих дисплеях должны появиться баннеры.','Два снимка состояния будут сняты до скрытия слоёв.','Звук и сохранённые настройки не меняются.','Кнопка НАЗАД останавливает тест.']];
  this.busy=true;this.displayTesting=true;this.change();
  try{
   if(!this.o.testDisplays)throw Error('Совместный тест недоступен в этой сборке.');
   const r=await this.o.testDisplays();if(generation!==this.generation)return;
   this.reportTime=r.createdAt;this.reportPages=reportView.pages(r);
  }catch(e){if(generation===this.generation)this.reportPages=reportView.pages({error:e.message});}
  finally{if(generation===this.generation){this.busy=false;this.displayTesting=false;this.change();}}
 }
 openDuck(){this.stop();this.screen='duck';this.duckResult=null;this.message='Включите музыку CarPlay. Проба: голос M4A + Overlay и уменьшение только канала музыки на 6 дБ.';this.change();}
 async testDucking(recover){
  if(this.busy)return;
  if(!recover&&this.moving()){this.message='Для проверки приглушения остановите автомобиль.';this.change();return;}
  const generation=++this.generation;this.confirmable=false;this.confirming=false;this.duckResult=null;this.busy=true;this.testing=true;
  this.message=recover?'Проверка восстановления канала CarPlay…':'Проверка управления CarPlay. При поддержке — голос и временное приглушение…';this.change();
  try{
   const r=await this.request({action:recover?'audio-carplay-duck-recover':'audio-carplay-duck-test'});if(generation!==this.generation)return;
   if(r.duckProtocol!==1||!r.duck)throw Error('Для этой пробы требуется обновлённый локальный звуковой компонент');
   const d=r.duck;this.duckResult=d;
   if(d.recoveryPending||d.restoreError)this.message='ВОССТАНОВЛЕНИЕ НЕ ПОДТВЕРЖДЕНО. Нажмите «ВОССТАНОВИТЬ». '+(d.restoreError||d.error||'');
   else if(d.error||d.routeCleanupError)this.message='ПРОБА НЕ ЗАВЕРШЕНА: '+duckError(d.error||d.routeCleanupError);
   else if(recover)this.message=d.restoration==='external-change-preserved'?'Сохранено внешнее изменение громкости.':'Восстановление завершено; незавершённой пробы нет.';
   else if(d.apiConfirmed)this.message='Команды приняты, громкость восстановлена. На слух проверьте: музыка стала тише, голос остался слышен?';
   else this.message='Приглушение не подтверждено.';
  }catch(e){if(generation===this.generation)this.message='ПРОБА НЕДОСТУПНА: '+e.message;}
  finally{if(generation===this.generation){this.busy=false;this.testing=false;this.change();}}
 }
 toggleOverlay(){if(this.busy)return;++this.generation;this.overlay=!this.overlay;if(!this.overlay&&(isProfile(this.backend)||this.backend==='pulse'))this.backend='converter';this.confirmable=false;this.confirming=false;this.result=null;this.message=this.overlay?'OVERLAY: включите музыку CarPlay. Выберите ALSA Converter, ALSA или M4A.':'Обычный вывод: выберите ALSA Converter, ALSA или M4A.';this.change();}
 request(payload){return new Promise((resolve,reject)=>{
  let done=false,buffer='';const socket=this.net.createConnection('/run/bmwcaminfo-voice/ctl.sock');this.socket=socket;
  const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);socket.destroy();if(this.socket===socket)this.socket=null;error?reject(error):resolve(value);};
  const timer=setTimeout(()=>finish(Error('Нет ответа звукового сервиса')),70000);
  socket.setEncoding('utf8');socket.on('connect',()=>socket.write(JSON.stringify(payload)+'\n'));
  socket.on('data',chunk=>{buffer+=chunk;if(buffer.length>262144)return finish(Error('Слишком большой ответ'));const n=buffer.indexOf('\n');if(n<0)return;try{const r=JSON.parse(buffer.slice(0,n));if(!r.ok)throw Error(r.error||'Ошибка сервиса');finish(null,r);}catch(e){finish(e);}});
  socket.on('error',e=>finish(e));socket.on('close',()=>{if(!done)finish(Error('Проверка прервана'));});
 });}
 async testMode(backend){
  if(this.busy||!CHOICES.some(m=>m[0]===backend))return;
  if(this.moving()){this.message='Для проверки звука остановите автомобиль.';this.change();return;}
  if(isProfile(backend)||backend==='pulse')this.overlay=true;
  const overlay=this.overlay,generation=++this.generation,label=CHOICES.find(m=>m[0]===backend)[1]+(overlay?' + OVERLAY':'');
  this.backend=backend;this.result=null;this.confirmable=false;this.confirming=false;this.busy=true;this.testing=false;this.message=label+': подготовка пробы…';this.change();
  try{
   if(overlay){
    const scan=await this.request({action:'audio-overlay-scan',backend});if(generation!==this.generation)return;
    if(backend==='pulse'&&scan.pulseProtocol!==1)throw Error('Обновите экспериментальный звуковой компонент для PulseAudio');
    if(isProfile(backend)&&scan.converterProfilesProtocol!==1)throw Error('Обновите звуковой компонент для трёх профилей Converter');
    if(scan.overlayProtocol!==2||scan.backend!==backend)throw Error('Обновите звуковой компонент: нет проверки трёх режимов Overlay');
    if(!scan.carplayConnected&&!isProfile(backend)&&backend!=='pulse')throw Error('Включите музыку CarPlay перед пробой Overlay');
    this.testing=true;this.message=label+': воспроизводится голос и бипер…';this.change();
    const r=await this.request({action:'audio-overlay-test',backend,kind:'both'});if(generation!==this.generation)return;
    if(r.overlayProtocol!==2||!r.overlay||!r.overlay.accepted||r.overlay.backend!==backend||r.overlay.kind!=='both')throw Error('Сервис не подтвердил выбранный способ проверки');
    this.confirmable=scan.overlaySaveSupported===true&&r.overlaySaveSupported===true;this.result={backend,overlay:true,api:r.overlay};this.message=label+(isProfile(backend)?': серия из трёх фраз завершена. ':': проба завершена. ')+(this.confirmable?'Если звук слышен, сохраните режим.':'Для сохранения обновите звуковой компонент.');
   }else{
   const scan=await this.request({action:'audio-scan'});if(generation!==this.generation)return;
   if(backend==='converter'){
    if(!scan.converter||!scan.converter.available)throw Error(scan.converter&&scan.converter.error||'Обновите звуковой компонент для ALSA Converter');
   }else if(backend==='alsa'){
    if(!scan.alsa||!scan.alsa.available)throw Error(scan.alsa&&scan.alsa.error||'ALSA-модуль недоступен');
   }else if(!Array.isArray(scan.sinks)||!scan.sinks.some(s=>s.id===1024)){
    const errors=Object.keys(scan.errors||{}).map(k=>scan.errors[k]);
    throw Error(errors.join('; ')||'BMW не предоставил выход 1024 для проверки');
   }
   this.testing=true;this.message=label+': воспроизводится голос и бипер…';this.change();
   const r=await this.request({action:'audio-test',sinkID:1024,backend,kind:'both'});
   if(generation!==this.generation)return;
   this.confirmable=true;
   this.result={backend,overlay:false,api:r};
   this.message=label+': проба завершена. Если звук слышен, сохраните режим.'+(backend==='file'?' M4A — готовая запись голоса и бипера.':'');
   }
  }catch(e){if(generation===this.generation)this.message=label+' / ОШИБКА: '+channelError(e.message);}
  finally{if(generation===this.generation){this.busy=false;this.testing=false;this.change();}}
 }
 askSave(){if(this.busy||!this.confirmable)return;this.confirming=true;this.change();}
 async saveMode(){
  if(this.busy||!this.confirmable||!this.confirming)return;
  const backend=this.backend,overlay=this.overlay,sinkID=overlay?this.result.api.sinkID:1024,sourceID=overlay?this.result.api.sourceID:undefined,label=CHOICES.find(m=>m[0]===backend)[1]+(overlay?' + OVERLAY':''),generation=++this.generation;
  this.confirming=false;this.busy=true;this.saving=true;this.message='СОХРАНЕНИЕ '+label+'…';this.change();
  try{
   const r=await this.request({action:'audio-save',sinkID,sourceID,backend,overlay,heard:true,independent:false});
   if(generation!==this.generation)return;
   if(!r.saved||r.saved.backend!==backend||r.saved.sinkID!==sinkID||!!r.saved.overlay!==overlay||(overlay&&r.saved.sourceID!==sourceID))throw Error('Сервис не подтвердил сохранение режима');
   this.confirmable=false;this.message=label+': режим сохранён. Используется сейчас и после перезапуска.';
  }catch(e){if(generation===this.generation){this.confirmable=false;this.message='ОШИБКА СОХРАНЕНИЯ: '+e.message;}}
  finally{if(generation===this.generation){this.busy=false;this.saving=false;this.change();}}
 }
 stop(){
  clearTimeout(this.sharePollTimer);clearTimeout(this.shareExpiryTimer);
  if(this.displayTesting&&this.o.stopDisplays)this.o.stopDisplays();
  this.displayTesting=false;
  this.confirming=false;this.confirmable=false;
  this.result=null;
  if(!this.busy&&!this.socket)return;
  ++this.generation;const testing=this.testing,reporting=this.reporting;this.busy=false;this.testing=false;this.reporting=false;
  if(this.socket)this.socket.destroy();
  this.message=reporting?(this.screen==='report'?'Просмотр отчёта закрыт. Звук не менялся.':'Сохранение продолжится в сервисе. Результат не получен.'):this.saving?'Ответ о сохранении не получен. Проверьте режим в сервисе.':testing?'Проба остановлена. Короткая запись M4A может доиграть.':'Проверка отменена';this.saving=false;this.change();
  if(this.screen==='duck'){this.message='Проба отменена. Сервис восстанавливает громкость; при сомнении нажмите «ВОССТАНОВИТЬ».';this.change();}
 }
 tap(x,y){const b=this.buttons.find(b=>x>=b.x&&x<b.x+b.w&&y>=b.y&&y<b.y+b.h);if(b)b.run();}
 draw(cv,style,target){
  const C=style.colors,txt=style.text;this.buttons=[];
  style.heading(cv,this.screen==='beeper-sounds'?'ЗВУК БИПЕРА':this.screen==='mixer'?'МИКШЕР ЗВУКА':this.screen==='share'?'ОТЧЁТ НА ТЕЛЕФОН':this.screen==='report'?'ДИАГНОСТИЧЕСКИЙ ОТЧЁТ':this.screen==='duck'?'ПРИГЛУШЕНИЕ CARPLAY':'ПРОВЕРКА АУДИОКАНАЛОВ','SPEEDCAM');
  const button=(label,x,y,w,h,run,key,enabled)=>{
   cv.fillRect(x,y,w,h,C.panel);cv.strokeRoundRect(x,y,w,h,0,1,enabled?C.edge:'#343434');
   txt(cv,label,x+w/2,y+h/2+10,26,enabled?C.text:C.muted,{align:'center',maxWidth:w-24});
   if(enabled){this.buttons.push({x,y,w,h,run});target(cv,x,y,w,h,run,key);}
  };
  if(this.screen==='beeper-sounds'){this.beeperPanel.draw(cv,style,target);return;}
  if(this.screen==='mixer'){this.mixerPanel.draw(cv,style,target);return;}
  if(this.screen==='share'){
   const s=this.share,active=s&&Date.now()<s.expiresAt,qr=active&&this.shareQr;
   if(qr){
    const count=qr.getModuleCount(),cell=Math.max(1,Math.floor(300/(count+8))),size=(count+8)*cell,x=286,y=78;
    cv.fillRect(x,y,size,size,'#ffffff');
    for(let row=0;row<count;row++)for(let col=0;col<count;col++)if(qr.isDark(row,col))cv.fillRect(x+(col+4)*cell,y+(row+4)*cell,cell,cell,'#000000');
   }
   txt(cv,active?'ОТСКАНИРУЙТЕ QR-КОД ТЕЛЕФОНОМ':'ПЕРЕДАЧА ДИАГНОСТИКИ',625,103,26,C.text,{maxWidth:920});
   txt(cv,'ПОДКЛЮЧИТЕ ТЕЛЕФОН К WI-FI-ТОЧКЕ АВТОМОБИЛЯ',625,146,21,C.text,{maxWidth:920});
   txt(cv,'ИНТЕРНЕТ НЕ НУЖЕН. ОТКРОЙТЕ ССЫЛКУ И СКАЧАЙТЕ JSON.',625,182,19,C.muted,{maxWidth:920});
   if(active){
    const url=s.urls[this.shareIndex],parts=url.split('/r/');
    cv.text(parts[0],625,229,27,C.text,{literal:true});
    cv.text('/r/'+parts[1],625,264,22,C.text,{literal:true});
    txt(cv,'АДРЕС '+(this.shareIndex+1)+' / '+s.urls.length+' · АВТООТКЛЮЧЕНИЕ '+new Date(s.expiresAt).toLocaleTimeString(),625,306,21,C.muted,{maxWidth:920});
    txt(cv,this.shareStopError?this.shareMessage:s.simulated?'ЭМУЛЯТОР: АДРЕС ПК, ДАННЫЕ ДЕМОНСТРАЦИОННЫЕ':s.downloads?'ОТЧЁТ СКАЧАН · '+s.downloads:s.firewall==='ready'?'ПОРТ ОТКРЫТ ДЛЯ WI-FI АВТОМОБИЛЯ':'ДОСТУПНОСТЬ АДРЕСА ПРОВЕРЬТЕ С ТЕЛЕФОНА',625,344,18,C.yellow,{maxWidth:920});
   }else{
    const message=s?'Срок ссылки истёк. Создайте новый отчёт.':this.shareMessage||'';
    const lines=message.match(/.{1,70}(?:\s|$)|.{1,70}/g)||[];
    lines.slice(0,5).forEach((line,i)=>txt(cv,line.trim(),625,225+i*29,21,C.text,{maxWidth:920}));
   }
   button('ДРУГОЙ АДРЕС',266,415,310,66,()=>this.selectShareAddress(1),'share-address',!this.busy&&active&&s.urls.length>1);
   button(active?'ОТКЛЮЧИТЬ':'НОВЫЙ ОТЧЁТ',590,415,310,66,()=>active?this.stopShare():this.shareReport(),'share-toggle',!this.busy);
   button('НАЗАД',914,415,310,66,()=>{clearTimeout(this.sharePollTimer);this.screen='channels';this.change();},'share-back',!this.busy);
   txt(cv,'ДОСТУП ТОЛЬКО К ЭТОМУ ОТЧЁТУ. ВЫХОД ИЗ МЕНЮ НЕ ПРОДЛЕВАЕТ ССЫЛКУ.',286,510,18,C.muted,{maxWidth:1270});
   return;
  }
  if(this.screen==='report'){
   if(this.reportHome==='engineering'){
    button('ПОВТОРИТЬ ТЕСТ',266,74,310,48,()=>this.testDisplays(),'report-display-test',!this.busy);
    button('СОСТОЯНИЕ',590,74,310,48,()=>this.showReport('display'),'report-display',!this.busy);
   }else button('ОБНОВИТЬ ОТЧЁТ',266,74,634,48,()=>this.showReport('audio'),'report-audio',!this.busy);
   txt(cv,(this.reportKind==='display'?'ПРИБОРКА':'АУДИО')+' · '+(this.reportPage+1)+' / '+this.reportPages.length,930,106,24,C.text,{maxWidth:620});
   // Diagnostic names must retain case, underscores and punctuation. The HUD
   // uppercase atlas lacks these; use the already bundled full label font.
   (this.reportPages[this.reportPage]||[]).forEach((line,i)=>{
    const opts={literal:true},width=cv.textWidth(line,22,opts);
    cv.text(line,286,154+i*26,Math.min(22,22*1270/Math.max(1,width)),C.text,opts);
   });
   txt(cv,this.reportTime?('СНИМОК: '+this.reportTime):'USB НЕ ТРЕБУЕТСЯ',286,399,18,C.muted,{maxWidth:1270});
   button('ПРЕДЫДУЩАЯ',266,415,426,66,()=>this.turnReport(-1),'report-prev',!this.busy&&this.reportPage>0);
   button('СЛЕДУЮЩАЯ',710,415,426,66,()=>this.turnReport(1),'report-next',!this.busy&&this.reportPage+1<this.reportPages.length);
   button('НАЗАД',1154,415,426,66,()=>this.closeReport(),'report-back',true);
   txt(cv,this.reportHome==='engineering'?'СОСТОЯНИЕ — ЧТЕНИЕ ДИАГНОСТИКИ. ПОВТОРИТЬ ТЕСТ — ПОКАЗ БАННЕРОВ.':'АУДИОДИАГНОСТИКА. ОБНОВИТЬ ОТЧЁТ — НОВЫЙ СНИМОК БЕЗ ИЗМЕНЕНИЯ ЗВУКА.',286,510,18,C.muted,{maxWidth:1270});
   return;
  }
  if(this.screen==='duck'){
   txt(cv,'M4A + OVERLAY · ТОЛЬКО ПРОБА НА СТОЯНКЕ',286,105,28,C.text,{maxWidth:1270});
   txt(cv,'МУЗЫКА: -6 ДБ НА ВРЕМЯ ФРАЗЫ, ЗАТЕМ ВОССТАНОВЛЕНИЕ',286,147,24,C.text,{maxWidth:1270});
   txt(cv,'БИПЕР В M4A НЕ РЕАЛИЗОВАН. ЭТА ПРОБА ПРОВЕРЯЕТ ТОЛЬКО ГОЛОС.',286,185,19,C.yellow,{maxWidth:1270});
   const lines=String(this.message).match(/.{1,92}(?:\s|$)|.{1,92}/g)||[];
   lines.slice(0,5).forEach((line,i)=>txt(cv,line.trim(),286,232+i*26,20,C.text,{maxWidth:1270}));
   const d=this.duckResult;
   const states={'not-needed':'НЕ ТРЕБОВАЛОСЬ',restored:'ПОДТВЕРЖДЕНО','already-restored':'УЖЕ ВОССТАНОВЛЕНО','external-change-preserved':'ВНЕШНЕЕ ИЗМЕНЕНИЕ СОХРАНЕНО',pending:'НЕ ПОДТВЕРЖДЕНО'};
   if(d)txt(cv,'ВОССТАНОВЛЕНИЕ: '+(states[d.restoration]||'НЕИЗВЕСТНО')+' · РЕЗУЛЬТАТ НА СЛУХ НЕ ПОДТВЕРЖДЁН',286,375,18,d.recoveryPending?C.red:C.muted,{maxWidth:1270});
   button(this.busy?'ОСТАНОВИТЬ':'ПРОВЕРИТЬ',266,415,644,66,()=>this.busy?this.stop():this.testDucking(false),'duck-test',true);
   button('ВОССТАНОВИТЬ',936,415,644,66,()=>this.testDucking(true),'duck-recover',!this.busy);
   txt(cv,'РАБОЧИЙ РЕЖИМ НЕ МЕНЯЕТСЯ. ВЫХОД — ПЛИТКИ СЛЕВА.',286,510,18,C.muted,{maxWidth:1270});
   return;
  }
  if(this.confirming){
   txt(cv,'СОХРАНИТЬ РЕЖИМ '+CHOICES.find(m=>m[0]===this.backend)[1]+(this.overlay?' + OVERLAY':'')+'?',286,142,32,C.text,{maxWidth:1270});
   txt(cv,'ГОЛОС И БИПЕР БЫЛИ СЛЫШНЫ ВО ВРЕМЯ ПРОБЫ?',286,204,26,C.text,{maxWidth:1270});
   txt(cv,'ВЫБРАННЫЙ РЕЖИМ БУДЕТ ИСПОЛЬЗОВАТЬСЯ ПОСЛЕ ПЕРЕЗАПУСКА.',286,251,20,C.muted,{maxWidth:1270});
   button('ОТМЕНА',266,330,644,100,()=>{this.confirming=false;this.change();},'audio-cancel',true);
   button('ДА, СОХРАНИТЬ',936,330,644,100,()=>this.saveMode(),'audio-confirm',true);
   return;
  }
  const toggle=()=>this.toggleOverlay();
  cv.fillRect(266,76,1314,64,C.panel);cv.strokeRoundRect(288,94,26,26,0,2,this.overlay?C.red:C.text);
  if(this.overlay){cv.line(293,106,299,113,3,C.red);cv.line(299,113,310,100,3,C.red);}
  txt(cv,'OVERLAY',334,118,27,C.text);
  if(!this.busy){this.buttons.push({x:266,y:76,w:318,h:64,run:toggle});target(cv,266,76,318,64,toggle,'audio-overlay');}
  const forced=this.forceAudio(),forceRun=()=>this.toggleForceAudio();
  cv.strokeRoundRect(614,94,26,26,0,2,forced?C.red:C.text);
  if(forced){cv.line(619,106,625,113,3,C.red);cv.line(625,113,636,100,3,C.red);}
  txt(cv,'УВЕДОМЛЕНИЯ И БИПЕР ВСЕГДА',660,118,26,C.text,{maxWidth:896});
  if(!this.busy&&this.o.setForceAudio){this.buttons.push({x:600,y:76,w:980,h:64,run:forceRun});target(cv,600,76,980,64,forceRun,'audio-force-notifications');}
  MODES.concat([['pulse','PULSEAUDIO · ЭКСП.']]).forEach((mode,i)=>{
   const x=266+i*332,y=146,w=318,h=72,active=this.backend===mode[0];
   const run=()=>{if(!this.busy)this.testMode(mode[0]);};
   this.buttons.push({x,y,w,h,run});cv.fillRect(x,y,w,h,C.panel);
   if(active)style.drawSelection(cv,x,y,w,h);
   else cv.strokeRoundRect(x,y,w,h,0,1,C.edge);
   txt(cv,mode[1],x+w/2,y+45,25,this.busy&&!active?C.muted:C.text,{align:'center',maxWidth:w-32});
   if(!this.busy)target(cv,x,y,w,h,run,'audio-'+mode[0]);
  });
  txt(cv,'ТЕСТОВЫЕ ПРОФИЛИ ALSA CONVERTER + OVERLAY',286,242,18,C.muted,{maxWidth:1270});
  PROFILES.forEach((mode,i)=>{
   const x=266+i*444,y=254,w=426,h=66,active=this.backend===mode[0],run=()=>this.testMode(mode[0]);
   cv.fillRect(x,y,w,h,C.panel);if(active)style.drawSelection(cv,x,y,w,h);else cv.strokeRoundRect(x,y,w,h,0,1,C.edge);
   txt(cv,mode[1],x+w/2,y+41,25,this.busy&&!active?C.muted:C.text,{align:'center',maxWidth:w-24});
   if(!this.busy){this.buttons.push({x,y,w,h,run});target(cv,x,y,w,h,run,'audio-'+mode[0]);}
  });
  const lines=String(this.message).match(/.{1,103}(?:\s|$)|.{1,103}/g)||[];
  lines.slice(0,2).forEach((line,i)=>txt(cv,line.trim(),286,344+i*22,18,C.text,{maxWidth:1270}));
  button('СОХРАНИТЬ РЕЖИМ',266,382,426,48,()=>this.askSave(),'audio-save',!this.busy&&!!this.confirmable);
  button('ОТЧЁТ НА ТЕЛЕФОН',710,382,426,48,()=>this.shareReport(),'audio-report-phone',!this.busy);
  button('НАЗАД',1154,382,426,48,()=>{this.stop();this.o.back();},'audio-back',typeof this.o.back==='function');
  button('МИКШЕР',266,442,426,42,()=>this.mixerPanel.open(),'audio-mixer',!this.busy);
  txt(cv,forced?'ТЕСТ ЗВУКА ВКЛЮЧЁН. ГАЛОЧКА СОХРАНЕНА. БИПЕР: ALSA / CONVERTER; M4A — ТОЛЬКО ГОЛОС.':'ПРОБА НЕ МЕНЯЕТ РЕЖИМ БЕЗ СОХРАНЕНИЯ. НАЗАД — В ИНЖЕНЕРНОЕ МЕНЮ.',286,510,18,forced?C.yellow:C.muted,{maxWidth:1270});
 }
}
module.exports={AudioDiagnostics};
