'use strict';
// Real RHMI buttons, independent of renderer input and PNG coordinates.
// Do not open a state over CarPlay/another app: only recover our visible MAIN.
function install(ctx){
 const d=ctx.display,ui=ctx.ui;
 if(!d||!ui||typeof ui.comp!=='function'||!ui.comp('DISPLAY_RECOVERY'))return null;
 let pending=false,disconnectedSince=Date.now(),lastStatus=null;
 function diagnostic(){
  const s=d.renderDiagnostics(),reason=d.recoveryLocked||s.reason;
  const why=reason==='INPUT_CAPABILITIES'?'Графический сервис не подтвердил управление. После установки перезагрузите MGU.':
   reason==='REPEATED_STALL'?'Графический слой повторно не ответил. Автопереподключение остановлено.':
   reason==='REPEATED_SUSPEND'?'Графический сервис неоднократно скрывал экран. Повторите подключение.':'Нет доступного графического управления.';
  return why+'\nКасания: '+(s.touch?'есть':'нет')+' / джойстик: '+(s.controller?'есть':'нет')+
   '\nПолучено: '+s.touchEvents+' / '+s.ccuEvents;
 }
 function status(){const s=diagnostic();if(s!==lastStatus){lastStatus=s;return ui.text('DISPLAY_RECOVERY_STATUS',s);}}
 function check(){
  const now=Date.now();
  if(d.gpu&&d.gpu.ready)disconnectedSince=null;
  else if(disconnectedSince===null)disconnectedSince=now;
  if(ui.isVisible('DISPLAY_RECOVERY')){status();return;}
  if(pending||!d._shown())return;
  // A routine socket reconnect needs its own grace period. App uptime must
  // not open a native menu over PNG and prevent the GPU from returning.
  const unavailable=d.recoveryLocked||disconnectedSince!==null&&now-disconnectedSince>=10000||
   d.rendererSuspended&&d.suspendedAt&&now-d.suspendedAt>=15000;
  if(!unavailable)return;
  pending=true;
  // Release only our input/surface; do not stop the shared renderer.
  if(d.gpu){d.gpu.claim([]);d.gpu.grab(false);d.gpu.show(false);}
  Promise.resolve(status()).then(()=>{if(d._shown())return ui.open('DISPLAY_RECOVERY');})
   .catch(e=>ctx.log.warn('DISPLAY_RECOVERY_MENU '+String(e))).then(()=>{pending=false;});
 }
 ui.onClick('DISPLAY_RETRY',()=>{
  disconnectedSince=Date.now();d.recoveryLocked=null;d.recoveryAttempts=0;d.recoveryT=0;d.suspensions=[];
  d.softDone=false;d.rendererSuspended=false;d.blocked=false;d.ownDown=null;d.downAt=null;d.ccuLast=null;
  if(d.gpu){const old=d.gpu;d.gpu=null;old.claim([]);old.show(false);old.close();}
  d.place=null;d.bgShown=null;d.lastWords=null;d._mode();
  return ui.open('MAIN');
 });
 ui.onClick('DISPLAY_SETTINGS',()=>ui.open('SETTINGS'));
 ui.onClick('DISPLAY_EXIT',()=>Promise.resolve(ui.close('DISPLAY_RECOVERY')).then(()=>ui.close('MAIN')));
 const timer=setInterval(check,1000);if(timer.unref)timer.unref();
 return {check,diagnostic,close(){clearInterval(timer);}};
}
module.exports={install};
