'use strict';
// Listening survey only: never sends audio-save/reset and never changes the saved route.
const fs=require('fs'),path=require('path');
const KINDS=['voice','beeper','both'];
const KIND_NAMES={voice:'ГОЛОС',beeper:'БИПЕР',both:'ГОЛОС + БИПЕР'};
const QUALITY=['НЕТ ЗВУКА','ШУМ / ХРИПЫ','ТИХО, НО ЧИСТО','ЧИСТО И ХОРОШО'];
function candidates(scan){
 const seen={},out=[];
 (scan.sinks||[]).forEach(s=>{
  if(!Number.isInteger(s.id)||s.id<1||s.id>65535||seen[s.id])return;seen[s.id]=true;
  ['file','pcm'].forEach(backend=>out.push({id:backend+'-'+s.id,backend,sinkID:s.id,sourceID:1046,name:(backend==='file'?'M4A':'PCM / FIFO')+' · '+s.id+' · '+String(s.name||'').slice(0,70),samples:[],independence:'unknown',mix:'unknown'}));
 });
 if(scan.alsa&&scan.alsa.available)out.push({id:'alsa-287-1024',backend:'alsa',sourceID:287,sinkID:1024,name:'ALSA · CARLIFE 287 / 1024',samples:[],independence:'unknown',mix:'unknown'});
 return out;
}
function audible(c){return c.samples.some(s=>s.accepted&&s.quality>0);}
function complete(c){return KINDS.every(k=>c.samples.some(s=>s.kind===k&&s.accepted&&s.quality>=2));}
function recommend(report){
 const rows=report.candidates||[],preferred=rows.find(c=>c.id===report.preferred&&audible(c));
 const scored=rows.filter(audible).sort((a,b)=>b.samples.reduce((n,s)=>n+(s.quality||0),0)-a.samples.reduce((n,s)=>n+(s.quality||0),0));
 const best=preferred||scored[0],live=rows.filter(c=>c.backend!=='file'&&complete(c)&&c.mix==='ducked'&&c.independence==='independent');
 const pick=live.find(c=>best&&best.id===c.id)||live[0];
 const lines=[];
 if(report.status!=='complete')lines.push('ТЕСТ НЕ ЗАВЕРШЁН: выводы предварительные.');
 if(rows.some(c=>c.samples.some(s=>/cleanup|restore|release/i.test(s.error||''))))lines.push('Ошибка восстановления маршрута: проверьте штатный звук.');
 if(!best){lines.push('Слышимый вариант не подтверждён.','Нужна проверка маршрута и журнала звукового сервиса.');}
 else{
  lines.push((preferred?'Лучший по вашему выбору: ':'Лучший по оценкам: ')+best.name);
  if(pick){lines.push('Кандидат для голоса и живого бипера: '+pick.name);
   lines.push(pick.backend==='alsa'?'Проверить ALSA в длительном проезде; рабочий режим выбирается в проверке аудиоканалов.':'Доработать PCM: закрепить маршрут и проверить длительную работу.');
  }else{
   lines.push('Независимый живой бипер пока не подтверждён.');
   if(best.backend==='file')lines.push('M4A пригоден для голоса; запись бипера не доказывает работу живого микшера.');
   if(best.independence==='dependent')lines.push('Громкость зависит от ручки: исследовать другой аудиомаршрут.');
   if(best.independence==='unknown')lines.push('Повторить пробу с изменением штатной громкости.');
   if(best.backend!=='file'&&best.mix!=='ducked')lines.push('Проверить одновременный звук и приглушение бипера под голосом.');
  }
 }
 const skipped=rows.filter(c=>c.skipped).length+(report.skipped||[]).length;
 if(skipped)lines.push('Пропущено вариантов: '+skipped+'. Причины сохранены в отчёте.');
 if(Object.keys(report.discoveryErrors||{}).length)lines.push('BMW выдал неполный список каналов; полнота проверки ограничена.');
 lines.push('Настройки звука не перезаписаны. Слышимость оценена пользователем.');
 return {preferredId:preferred?preferred.id:null,candidateId:pick?pick.id:null,lines};
}
function reportText(r){
 return ['SpeedCAM — автоматический тест звука',r.startedAt,'Приложение: '+r.appVersion,'Звуковой компонент: '+(r.serviceVersion||'неизвестен'),'Статус: '+r.status,'ИТОГ:',...recommend(r).lines,'','ПРОБЫ:',...(r.candidates||[]).map(c=>c.name+' | '+c.independence+' | совместно: '+c.mix+(c.skipped?' | ПРОПУЩЕН':'')+'\n'+c.samples.map(s=>'  '+KIND_NAMES[s.kind]+': '+(s.error?'ОШИБКА '+s.error:s.quality==null?'НЕ ОЦЕНЕНО':QUALITY[s.quality])).join('\n')),'','Пропуски: '+(r.skipped||[]).join('; '),'Нет автоматического применения. Нет GPS, VIN и учётных данных.'].join('\n');
}
class AudioWizard {
 constructor(diagnostic,change,options){
  this.diagnostic=diagnostic;this.change=change;this.o=options||{};this.phase='intro';this.busy=false;this.token=0;this.buttons=[];this.report=null;this.previous=null;this.index=0;this.kindIndex=0;this.page=0;this.error='';this.saveError='';
  this.file=this.o.dataDir?path.join(this.o.dataDir,'audio-survey-latest.json'):null;
  try{const r=JSON.parse(fs.readFileSync(this.file,'utf8'));if(r.schema===1&&Array.isArray(r.candidates))this.previous=r;}catch(e){}
 }
 moving(){return !!(this.o.moving&&this.o.moving());}
 current(){return this.report&&this.report.candidates[this.index];}
 notify(){this.change();}
 persist(){
  if(!this.report)return;this.report.recommendation=recommend(this.report);this.saveError='';
  try{
   if(!this.file)throw Error('Папка данных недоступна');
   fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.report,null,2),{encoding:'utf8',mode:0o600});fs.renameSync(this.file+'.tmp',this.file);
   const txt=this.file.replace(/\.json$/,'.txt');fs.writeFileSync(txt+'.tmp',reportText(this.report),{encoding:'utf8',mode:0o600});fs.renameSync(txt+'.tmp',txt);
  }catch(e){this.saveError='ОТЧЁТ НЕ СОХРАНЁН: '+e.message;}
 }
 async start(){
  if(this.busy)return;if(this.moving()){this.error='Остановите автомобиль перед тестом';this.notify();return;}
  this.error='';this.saveError='';this.report=null;this.phase='scanning';this.busy=true;const token=++this.token;this.notify();
  try{
   const scan=await this.diagnostic.request({action:'audio-scan'});if(token!==this.token)return;
   this.report={schema:1,startedAt:new Date().toISOString(),appVersion:this.o.appVersion||'unknown',serviceVersion:this.o.serviceVersion?this.o.serviceVersion():null,status:'running',preferred:null,candidates:candidates(scan),skipped:[],discoveryErrors:scan.errors||{},sourceID:scan.sourceID||1046,savedSettingsChanged:false};
   if(!scan.alsa||!scan.alsa.available)this.report.skipped.push('ALSA: '+(scan.alsa&&scan.alsa.error||'модуль недоступен'));
   this.index=0;this.kindIndex=0;this.phase=this.report.candidates.length?'ready':'done';
   if(!this.report.candidates.length)this.report.status='no-candidates';this.persist();
  }catch(e){if(token===this.token){this.error=/ENOENT|ECONNREFUSED/.test(e.message)?'Звуковой сервис недоступен. На MGU нужен компонент 0.1.23.':e.message;this.phase='intro';}}
  finally{if(token===this.token){this.busy=false;this.notify();if(this.phase==='ready')this.play();}}
 }
 async play(){
  if(this.busy||!['ready','rate','error','independence'].includes(this.phase))return;
  if(this.moving()){this.stop('Движение: тест остановлен');return;}
  const c=this.current(),kind=KINDS[this.kindIndex],token=++this.token;if(!c)return;
  this.phase='playing';this.busy=true;this.error='';this.notify();
  const sample={kind,at:new Date().toISOString(),accepted:false,quality:null};
  try{const r=await this.diagnostic.request({action:'audio-test',sinkID:c.sinkID,backend:c.backend,kind});
   if(token!==this.token)return;sample.accepted=r.ok===true;sample.transport=r.alsa||null;
   if(!sample.accepted)throw Error('Сервис не подтвердил завершение');this.phase='rate';
  }catch(e){if(token!==this.token)return;sample.error=String(e.message).slice(0,500);this.error=sample.error;this.phase='error';}
  finally{if(token===this.token){c.samples=c.samples.filter(s=>s.kind!==kind).concat([sample]);this.busy=false;this.persist();this.notify();}}
 }
 rate(value){
  if(this.phase!=='rate'||![0,1,2,3].includes(value))return;
  const c=this.current(),s=c.samples.find(s=>s.kind===KINDS[this.kindIndex]);s.quality=value;this.persist();
  if(this.kindIndex<2){this.kindIndex++;this.phase='ready';this.play();}
  else{this.phase='mix';this.notify();}
 }
 mix(value){if(this.phase!=='mix'||!['ducked','both','voice-only','beeper-only','none','unknown'].includes(value))return;this.current().mix=value;this.phase='independence';this.persist();this.notify();}
 independence(value){if(this.phase!=='independence'||!['independent','dependent','unknown'].includes(value))return;this.current().independence=value;this.phase='preference';this.persist();this.notify();}
 prefer(value){if(this.phase!=='preference')return;if(value&&audible(this.current()))this.report.preferred=this.current().id;this.next();}
 next(){
  if(this.busy||!this.report)return;
  this.index++;this.kindIndex=0;
  if(this.index>=this.report.candidates.length){this.report.status='complete';this.report.finishedAt=new Date().toISOString();this.phase='done';this.page=0;this.previous=this.report;this.persist();this.notify();}
  else{this.phase='ready';this.persist();this.play();}
 }
 skip(){if(this.busy||!this.current())return;this.current().skipped=true;this.next();}
 stop(reason){
  ++this.token;if(this.busy)this.diagnostic.stop();this.busy=false;
  if(this.report&&this.report.status==='running'){this.report.status='interrupted';this.report.stopReason=reason||'Пользователь остановил тест';this.report.finishedAt=new Date().toISOString();this.persist();this.previous=this.report;}
  this.phase=this.report?'done':'intro';this.error=reason||'';this.page=0;this.notify();
 }
 open(){if(!this.busy){this.phase='intro';this.error='';this.notify();}}
 tap(x,y){const b=this.buttons.find(b=>x>=b.x&&x<b.x+b.w&&y>=b.y&&y<b.y+b.h);if(b)b.run();}
 draw(cv,style,target,back){
  const C=style.colors,txt=style.text;this.buttons=[];style.heading(cv,'АВТОТЕСТ ЗВУКА','SPEEDCAM');cv.fillRect(266,74,1314,240,C.panel);
  const line=(s,i,color)=>txt(cv,s,286,107+i*32,20,color||C.text,{maxWidth:1270});
  const add=(label,col,row,fn,key,enabled)=>{const x=266+col*440,y=326+row*59,w=434,h=53;const run=()=>{if(enabled!==false)fn();};this.buttons.push({x,y,w,h,run});cv.fillRect(x,y,w,h,C.panel);cv.strokeRoundRect(x,y,w,h,0,1,enabled===false?'#343434':'#a9becf');txt(cv,label,x+w/2,y+34,19,enabled===false?C.muted:C.text,{align:'center',maxWidth:w-16});if(enabled!==false)target(cv,x,y,w,h,run,'wizard-'+key);};
  const c=this.current();
  if(this.phase==='intro'){
   line('Голос, бипер и совместное звучание на каждом доступном выходе.',0);line('Только на стоянке. Установите комфортную громкость музыки.',1);line('Во время пробы измените штатную громкость, затем верните её.',2);line('После каждой пробы оцените звук. Выберите лучший вариант.',3);line('ALSA экспериментален. Настройки звука автоматически не сохраняются.',4);line(this.error||'Неизвестные источники BMW не проверяются перебором.',5,C.muted);
   add('НАЧАТЬ АВТОТЕСТ',0,0,()=>this.start(),'start',!this.busy);add('ПРОШЛЫЙ ОТЧЁТ',1,0,()=>{this.report=this.previous;this.phase='done';this.page=0;this.notify();},'last',!!this.previous);
  }else if(this.phase==='scanning'){line('Поиск поддерживаемых аудиовыходов…',0);line('Результаты появятся после ответа звукового сервиса.',1);}
  else if(this.phase==='done'){
   const r=this.report,lines=r?recommend(r).lines:['Отчёт отсутствует'];line('ИТОГ · '+(r&&r.status==='complete'?'ТЕСТ ЗАВЕРШЁН':'НЕПОЛНЫЙ ТЕСТ'),0);
   lines.slice(this.page*4,this.page*4+4).forEach((s,i)=>line(s,i+1));line(this.saveError||'JSON/TXT сохранены в данных приложения. Итог можно сфотографировать.',6,this.saveError?C.red:C.muted);
   add('ПРЕДЫДУЩАЯ СТРАНИЦА',0,0,()=>{this.page--;this.notify();},'prev',this.page>0);add('СЛЕДУЮЩАЯ СТРАНИЦА',1,0,()=>{this.page++;this.notify();},'next',(this.page+1)*4<lines.length);add('НОВЫЙ ТЕСТ',2,0,()=>this.open(),'new');
   add('ПОДРОБНОСТИ ПРОБ',0,1,()=>{this.phase='details';this.page=0;this.notify();},'details',!!(r&&r.candidates.length));add('СОХРАНИТЬ ОТЧЁТ',1,1,()=>{this.persist();this.notify();},'save');
  }else if(this.phase==='details'){
   const row=this.report.candidates[this.page];line('ПРОБА '+(this.page+1)+' / '+this.report.candidates.length+' · '+row.name,0);
   row.samples.forEach((s,i)=>line(KIND_NAMES[s.kind]+': '+(s.error?'ОШИБКА: '+s.error:s.quality==null?'НЕ ОЦЕНЕНО':QUALITY[s.quality]),i+1));
   line('ОТ РУЧКИ: '+({unknown:'НЕ ПРОВЕРЕНО',independent:'НЕ ЗАВИСИТ',dependent:'ЗАВИСИТ'}[row.independence]),4);line('СОВМЕСТНО: '+({ducked:'БИПЕР ПРИГЛУШАЕТСЯ',both:'ОБА БЕЗ ПРИГЛУШЕНИЯ','voice-only':'ТОЛЬКО ГОЛОС','beeper-only':'ТОЛЬКО БИПЕР',none:'ТИШИНА',unknown:'НЕ ПРОВЕРЕНО'}[row.mix]),5);
   add('ПРЕДЫДУЩИЙ',0,0,()=>{this.page--;this.notify();},'prev',this.page>0);add('СЛЕДУЮЩИЙ',1,0,()=>{this.page++;this.notify();},'next',this.page+1<this.report.candidates.length);add('К ИТОГУ',2,0,()=>{this.phase='done';this.page=0;this.notify();},'result');add('ЗДЕСЬ ЗВУК ЛУЧШЕ',0,1,()=>{this.report.preferred=row.id;this.persist();this.phase='done';this.page=0;this.notify();},'best',audible(row));
  }else if(c){
   line('ВАРИАНТ '+(this.index+1)+' / '+this.report.candidates.length+' · '+c.name,0);line('ПРОБА '+(this.kindIndex+1)+' / 3 · '+KIND_NAMES[KINDS[this.kindIndex]],1);
   line(c.backend==='file'?'M4A: бипер в записи, а не живой микшер.':'PCM / ALSA: проверяется живое смешивание.',2,C.muted);
   if(this.phase==='ready'){line('Готово к проверке. После ответа следующий звук включится сам.',3);add('ПРОСЛУШАТЬ',0,0,()=>this.play(),'play');}
   if(this.phase==='playing'){line('ВОСПРОИЗВЕДЕНИЕ…',3);line('Измените штатную громкость. Запомните влияние на звук.',4);}
   if(this.phase==='error'){line('ПРОБА НЕ ЗАВЕРШЕНА: '+this.error,3);line('Автопереход остановлен. Проверьте, что штатный звук восстановлен.',4);add('ПОВТОРИТЬ ПРОБУ',0,0,()=>this.play(),'repeat');add('ПРОПУСТИТЬ ВАРИАНТ',1,0,()=>this.skip(),'skip');}
   if(this.phase==='rate'){line('КАК ПРОЗВУЧАЛО?',3);QUALITY.forEach((s,i)=>add(s,i%3,Math.floor(i/3),()=>this.rate(i),'rate-'+i));add('ПРОСЛУШАТЬ ЕЩЁ',1,1,()=>this.play(),'repeat');}
   if(this.phase==='mix'){
    line('В СОВМЕСТНОЙ ПРОБЕ ЧТО БЫЛО СЛЫШНО?',3);
    [['БИПЕР ПРИГЛУШАЛСЯ','ducked'],['ОБА БЕЗ ПРИГЛУШЕНИЯ','both'],['ТОЛЬКО ГОЛОС','voice-only'],['ТОЛЬКО БИПЕР','beeper-only'],['НИЧЕГО / НЕ ПОНЯЛ','unknown']].forEach((a,i)=>add(a[0],i%3,Math.floor(i/3),()=>this.mix(a[1]),'mix-'+a[1]));
   }
   if(this.phase==='independence'){line('ГРОМКОСТЬ УВЕДОМЛЕНИЙ МЕНЯЛАСЬ ОТ РУЧКИ?',3);[['НЕ МЕНЯЛАСЬ','independent'],['МЕНЯЛАСЬ','dependent'],['НЕ ПРОВЕРИЛ','unknown']].forEach((a,i)=>add(a[0],i,0,()=>this.independence(a[1]),'volume-'+a[1]));add('ПОВТОРИТЬ С РУЧКОЙ',0,1,()=>this.play(),'repeat');}
   if(this.phase==='preference'){line('ГДЕ ЗВУК БЫЛ ЛУЧШЕ?',3);line('Текущий лучший: '+(this.report.candidates.find(v=>v.id===this.report.preferred)||{name:'ЕЩЁ НЕ ВЫБРАН'}).name,4);add('В ЭТОМ ВАРИАНТЕ',0,0,()=>this.prefer(true),'better',audible(c));add('ОСТАВИТЬ ПРЕЖНИЙ',1,0,()=>this.prefer(false),'keep');add('НЕ МОГУ СРАВНИТЬ',2,0,()=>this.prefer(false),'unknown');}
  }
  add(this.busy?'ОСТАНОВИТЬ ТЕСТ':'НАЗАД',2,2,()=>{if(this.busy){this.stop();}else{if(this.report&&this.report.status==='running')this.stop();back();}},'back');
 }
}
module.exports={AudioWizard,candidates,recommend,reportText};
