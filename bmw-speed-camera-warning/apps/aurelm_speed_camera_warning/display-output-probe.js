'use strict';
// Manual, bounded test on the SAME client/layers as ordinary warnings.
// Capture status before cleanup; never persist the temporary both-mode.
const {displayReport}=require('./diagnostic-report-view');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
class DisplayOutputProbe {
 constructor(output,options){this.output=output;this.o=options||{};this.sleep=this.o.sleep||sleep;this.busy=false;this.last=null;this.cancelled=false;}
 stop(){this.cancelled=true;if(this.restore)this.restore();}
 async run(){
  if(this.busy)throw Error('Проверка дисплеев уже выполняется.');
  if(this.o.moving&&this.o.moving())throw Error('Для проверки остановите автомобиль.');
  const output=this.output,originalMode=output.mode,originalGps=output.gpsStatus;
  const report=this.last={summary:'Тест запускается',createdAt:new Date().toISOString(),test:'HUD + KOMBI / Стрелка 500 м',originalMode,temporaryMode:'both',phase:'starting',snapshots:[],events:[],visualConfirmation:false,
   note:'Снимки сделаны до скрытия тестовых слоёв. Shown и успешная запись не подтверждают видимость на физических дисплеях.'};
  this.busy=true;this.cancelled=false;let client=null,listeners=[],restored=false;
  const live=()=>!this.cancelled&&!(this.o.moving&&this.o.moving());
  const check=()=>{if(!live())throw Error('Тест остановлен: выход из меню или движение.');};
  const wait=async ms=>{for(let elapsed=0;elapsed<ms;elapsed+=100){check();await this.sleep(Math.min(100,ms-elapsed));}check();};
  this.restore=()=>{
   if(restored)return;restored=true;
   if(client)listeners.forEach(pair=>client.removeListener(pair[0],pair[1]));
   output.setGpsStatus('');output.clear();output.setMode(originalMode);
   output.setGpsStatus(originalGps||'');report.restoredMode=output.mode;
  };
  try{
   output.setGpsStatus('');output.clear();output.setMode('both');client=output.cr;
   if(!client)throw Error('Нет клиента cluster-render.');
   ['ready','layer','target','refused','budget','disconnected'].forEach(name=>{
    const handler=(...args)=>{report.events.push({at:new Date().toISOString(),event:name,args:args.map(v=>String(v).slice(0,300))});if(report.events.length>48)report.events.shift();};
    listeners.push([name,handler]);client.on(name,handler);
   });
   for(let i=0;i<35&&!client.ready;i++)await wait(100);
   check();if(!client.ready)throw Error('cluster-render не подключился за 3,5 секунды.');
   output.show({type:'camera',stage:1,distanceM:500,speedKmh:60,camera:{id:'camera-output-test',name:'Стрелка',camera_model:'Стрелка',camera_family:'strelka',type:'Стационарная камера скорости',mapcamTypeCode:1,limit:60}});
   report.phase='showing';
   for(let i=0;i<2;i++){
    await wait(i?2000:1000);
    const snapshot=await (this.o.snapshot||displayReport)(client,{appVersion:this.o.appVersion,outputMode:output.mode,duringTest:true,
     alertActive:!!output.current,layers:Object.assign({},output.layers),backplate:output.backplate,
     sample:i+1});
    report.snapshots.push(snapshot);check();
   }
   await wait(1000);report.phase='completed';
  }catch(e){report.phase=this.cancelled?'cancelled':'failed';report.error=e.message;}
  finally{
   try{this.restore();}catch(e){report.cleanupError=e.message;}
   this.restore=null;this.busy=false;report.finishedAt=new Date().toISOString();
   report.summary=['ТЕСТ: HUD + ПРИБОРКА / СТРЕЛКА 500 М',
    'Состояние: '+({completed:'снимки собраны',cancelled:'отменён',failed:'ошибка'}[report.phase]||report.phase),
    'Снимков во время показа: '+report.snapshots.length,
    'Отказов renderer: '+report.events.filter(e=>e.event==='refused').length,
    'Ошибок снимков: '+report.snapshots.filter(s=>s.error).length,
    'Восстановлен режим: '+(report.restoredMode||'не подтверждён'),
    'Видимость обоих баннеров подтвердите на автомобиле.',
    report.error||report.cleanupError||'Подробности слоёв и ответов — ниже.'].join('\n');
  }
  return report;
 }
}
module.exports={DisplayOutputProbe};
