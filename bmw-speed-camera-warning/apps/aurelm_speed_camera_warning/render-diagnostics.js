'use strict';
const REASONS={NO_RENDERER:'НЕТ ГРАФИЧЕСКОГО СЕРВИСА',CONNECTING:'ПОДКЛЮЧЕНИЕ',FOREGROUND_GATE:'НЕТ ФОКУСА BMW',NO_FRAME_ACK:'НЕТ ОТВЕТА НА КАДР',NOT_VISIBLE:'ПРИЛОЖЕНИЕ СКРЫТО',SOFTWARE_SETTING:'ВЫБРАН РЕЗЕРВНЫЙ РЕЖИМ',READY:'КАНАЛ ГОТОВ'};
function read(display){
 if(!display||typeof display.renderDiagnostics!=='function')return {left:['ОТРИСОВКА: НЕТ ДИАГНОСТИКИ','ПРИЧИНА: СТАРЫЙ RUNTIME / ЭМУЛЯЦИЯ','ОТВЕТ КАДРА: Н/Д'],right:['ЭКРАН СЕРВИСА: Н/Д','ОБЛАСТЬ: Н/Д','МАСШТАБ: Н/Д'],state:null};
 const s=display.renderDiagnostics(),p=s.geometry,b=p.box;
 const ctl=s.controllerRecovery==='unavailable'?' / ПРОВЕРЬТЕ CONTROLLER GATE':s.controllerRecovery&&s.controllerRecovery!=='ready'?' / ПОВТОР '+(s.controllerRetryAttempts||0)+'/3':'';
 return {state:s,left:['ОТРИСОВКА: '+(s.mode==='GPU'?'GPU / ГРАФИЧЕСКИЙ СЛОЙ':'HMI / РЕЗЕРВ'),
  'ПРИЧИНА: '+(REASONS[s.reason]||s.reason)+ctl,'ВВОД: '+(s.touch?'T+':'T-')+' / '+(s.controller?'J+':'J-')+' / СОБЫТИЯ '+(s.touchEvents||0)+' / '+(s.ccuEvents||0)],
  right:['ЭКРАН СЕРВИСА: '+(s.rendererScreen?s.rendererScreen.w+' X '+s.rendererScreen.h:'НЕ ПОЛУЧЕН'),
   'ОБЛАСТЬ: '+b.w+' X '+b.h+' / '+b.x+','+b.y,
   'МАСШТАБ: '+p.scale.toFixed(3)+' / '+(s.rendererScreen?'ЛОГИЧЕСКИЙ':'РАСЧЁТНЫЙ')]};
}
Object.assign(REASONS,{INPUT_CAPABILITIES:'НЕТ ГРАФИЧЕСКОГО ВВОДА',REPEATED_STALL:'ПОВТОРНЫЙ СБОЙ GPU',REPEATED_SUSPEND:'СЛОЙ ПОВТОРНО СКРЫВАЕТСЯ',SURFACE_SUSPENDED:'СЛОЙ ВРЕМЕННО СКРЫТ BMW'});
module.exports={read};
Object.assign(REASONS,{CONTROLLER_WAIT:'ОЖИДАНИЕ ДЖОЙСТИКА',CONTROLLER_UNAVAILABLE:'ДЖОЙСТИК НЕ ДОСТУПЕН'});
