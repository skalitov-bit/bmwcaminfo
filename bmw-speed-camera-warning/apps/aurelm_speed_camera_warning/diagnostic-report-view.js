'use strict';
// Bounded, photographable reports. No polling or rendering/audio mutations.
const PAGE_LINES=9,WIDTH=96,MAX_LINES=1600;
function pages(report){
 const lines=[];
 function add(value){String(value).split(/\r?\n/).forEach(line=>{
  if(!line){lines.push('');return;}
  while(line.length){lines.push(line.slice(0,WIDTH));line=line.slice(WIDTH);}
 });}
 function walk(v,key,depth){
  if(lines.length>MAX_LINES)return;
  if(v===null||typeof v!=='object'){add(key+': '+String(v));return;}
  if(depth>10){add(key+': [слишком глубокая структура]');return;}
  add(key+(Array.isArray(v)?' ['+v.length+']':''));
  const keys=Object.keys(v);if(!keys.length)add('  (пусто)');
  keys.forEach(k=>walk(v[k],'  '+k,depth+1));
 }
 walk(report,'ДАННЫЕ ОТЧЁТА',0);
 const bounded=lines.slice(0,MAX_LINES);
 if(lines.length>MAX_LINES)bounded.push('ЭКРАННЫЙ ОТЧЁТ СОКРАЩЁН. Полные данные — в JSON на USB.');
 const result=[];for(let i=0;i<bounded.length;i+=PAGE_LINES)result.push(bounded.slice(i,i+PAGE_LINES));
 return result.length?result:[['Нет данных']];
}
function audioReport(r){
 const mode=v=>v?(v.backend||'?')+(v.overlay?' + Overlay':''):'нет данных';
 const result=v=>!v?'нет данных':v.ok?'команда выполнена':v.error||'ошибка';
 const b=r.bufferDiagnostics,streams=b&&b.streams||[],runtime=b&&b.lastRuntime||streams.filter(s=>s.origin==='runtime').slice(-1)[0],probe=b&&b.lastProbe||streams.filter(s=>s.origin==='probe').slice(-1)[0];
 const bufferLine=s=>{if(!s)return 'нет данных';const n=s.native||{};return mode(s)+' / '+s.status+'\nБуфер: '+(n.bufferParamsKnown?n.bufferMs+' мс':'не измерен')+' / underrun: '+(n.underruns===undefined?'нет данных':n.underruns)+'\nВосстановлений: '+(n.recoveries===undefined?'нет данных':n.recoveries)+' / пауза подачи: '+Math.round(s.maxPumpGapMs||0)+' мс';};
 const queueLine=s=>{const n=s&&s.native;if(!n||n.queueFrames===undefined)return 'нет данных';return 'PCM: '+n.queueFrames+' / '+n.queueCapacityFrames+' кадров\nОпустошений: '+n.queueEmptyEvents+' / ожидание ALSA: '+n.waitErrors+' ошибок\nПоследний код ALSA: '+n.lastAlsaError+' / состояние: '+n.alsaState;};
 const signalLine=s=>{const d=s&&(s.nativeMixerStats||s.pcmSignal);if(!d)return 'нет данных';const n=x=>typeof x==='number'?x.toFixed(3):'не измерен';return 'Пик смеси: '+n(d.mixPeak)+' / выхода: '+n(s.nativeMixerStats?d.peak:d.outputPeak)+'\nОграничено отсчётов: '+d.limitedSamples+' / насыщение выхода: '+(s.nativeMixerStats?d.saturatedSamples:d.outputSaturatedSamples)+'\nЭти счётчики не доказывают слышимые искажения.';};
 return {
  'СВОДКА':['SpeedCAM '+(r.appVersion||'?')+' / звук '+(r.serviceVersion||'?'),
   'Активный: '+mode(r.active),'Сохранённый: '+mode(r.saved),
   'ALSA: '+result(r.alsa),'Overlay: '+result(r.overlay),
   'Последняя ошибка: '+(r.active&&r.active.lastError||'нет'),
   'Только чтение. Наличие слышимого звука не проверяется.'].join('\n'),
  'МИКШЕР: СОХРАНЁННЫЕ НАСТРОЙКИ':r.mixerSettings||'нет данных',
  'PULSEAUDIO: ЭКСПЕРИМЕНТАЛЬНЫЙ ВЫВОД':r.pulseAudio||'не запускался; наличие PulseAudio не доказывает звук на MGU',
  'СРАВНЕНИЕ SMARTX: С БИПЕРОМ И БЕЗ':r.audioComparisons||'не запускалось',
  'НАТИВНЫЙ ТЕСТ: ПАРАМЕТРЫ':probe?{profile:probe.profile,device:probe.device,format:probe.format,mixer:probe.nativeMixerStats,native:probe.native}:null,
  'ПРИГЛУШЕНИЕ МУЗЫКИ':r.musicDucking||'нет данных',
  'БУФЕР: ОБЫЧНЫЕ УВЕДОМЛЕНИЯ':bufferLine(runtime),
  'БУФЕР: РУЧНАЯ ПРОБА':bufferLine(probe),
  'ОЧЕРЕДЬ PCM: УВЕДОМЛЕНИЯ':queueLine(runtime),
  'СИГНАЛ PCM: УВЕДОМЛЕНИЯ':signalLine(runtime),
  'ОЧЕРЕДЬ PCM: ПРОБА':queueLine(probe),
  'СИГНАЛ PCM: ПРОБА':signalLine(probe),
  'БУФЕР: ОШИБКА УВЕДОМЛЕНИЙ':b&&b.lastRuntimeFailure?b.lastRuntimeFailure:'не зарегистрирована',
  'БУФЕР: ОШИБКА ПРОБЫ':b&&b.lastProbeFailure?b.lastProbeFailure:'не зарегистрирована',
  'БУФЕР: ПРИМЕЧАНИЕ':'История в памяти до перезапуска звукового сервиса. Паузы подачи не доказывают underrun. M4A/FIFO не измеряются.',
  'БУФЕР: ИСТОРИЯ':streams,
  'ALSA: ВЫХОДЫ И ОШИБКИ':r.alsa,
  'OVERLAY: ВЫХОДЫ И ОШИБКИ':r.overlay,
  'ПРЕДЫДУЩИЙ ПОИСК OVERLAY':r.previousDiscovery,
  'ПРОБА ALSA CONVERTER + OVERLAY':r.lastConverterProbe||'не запускалась',
  'ПОСЛЕДНИЕ ПРОБЫ':{alsa:r.lastAlsaProbe,overlay:r.lastOverlayProbe},
  'BMW: ИСТОЧНИКИ, ВЫХОДЫ, СОЕДИНЕНИЯ':r.bmw,
  'SMARTX':r.smartx,'ALSA: ДРАЙВЕРЫ И НАСТРОЙКИ':r.alsaFiles,
  'USB: ОБНАРУЖЕННЫЕ НОСИТЕЛИ':r.usbInventory,
  'РЕЖИМЫ И СООБЩЕНИЯ':{selected:r.ui,active:r.active,saved:r.saved},'СИСТЕМА':r.system
 };
}
function displayReport(client,info,options){
 const o=options||{},report=Object.assign({createdAt:new Date().toISOString(),backend:null,targets:null,status:null,readOnly:true},info||{});
 if(!client||!client.ready)return Promise.resolve(Object.assign(report,{error:'Нет подключения к cluster-render. Слои не создавались.'}));
 report.backend=client.backend;report.targets=client.targets;
 return new Promise(resolve=>{
  let ended=false;
  const finish=(text,error)=>{if(ended)return;ended=true;clearTimeout(timer);client.removeListener('status',onStatus);client.removeListener('disconnected',onDisconnect);report.status=text||null;if(error)report.error=error;resolve(report);};
  const onStatus=text=>finish(String(text).slice(0,65536));
  const onDisconnect=()=>finish(null,'Соединение с cluster-render разорвано.');
  const timer=setTimeout(()=>finish(null,'Нет ответа status от cluster-render.'),o.timeout||3500);
  client.on('status',onStatus);client.on('disconnected',onDisconnect);
  try{client.status();}catch(e){finish(null,e.message);}
 });
}
module.exports={pages,audioReport,displayReport,PAGE_LINES};
