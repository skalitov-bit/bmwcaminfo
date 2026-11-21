'use strict';
const net=require('net');
class AudioHealth {
 constructor(options){const o=options||{};this.net=o.net||net;this.now=o.now||Date.now;this.state=null;this.checkedAt=0;this.socket=null;this.pending=null;this.closed=false;this.finish=null;}
 poll(){
  if(this.closed)return Promise.resolve();if(this.pending)return this.pending;
  this.pending=new Promise(resolve=>{
   let done=false,buffer='';const socket=this.socket=this.net.createConnection('/run/bmwcaminfo-voice/ctl.sock');
   const finish=(state)=>{if(done)return;done=true;clearTimeout(timer);this.state=state;this.checkedAt=this.now();this.socket=null;this.finish=null;socket.destroy();resolve();};
   this.finish=finish;const timer=setTimeout(()=>finish({ok:false,error:'Нет ответа звукового сервиса'}),3000);
   socket.setEncoding('utf8');socket.on('connect',()=>socket.write('{"action":"status"}\n'));
   socket.on('data',chunk=>{buffer+=chunk;if(buffer.length>4096){finish({ok:false,error:'Некорректный ответ сервиса'});return;}const end=buffer.indexOf('\n');if(end<0)return;
    try{const r=JSON.parse(buffer.slice(0,end));if(r.ok!==true)throw Error();finish(r);}catch(e){finish({ok:false,error:'Некорректный ответ сервиса'});}});
   socket.on('error',()=>finish({ok:false,error:'Звуковой сервис недоступен'}));
   socket.on('close',()=>{if(!done)finish({ok:false,error:'Соединение со звуковым сервисом закрыто'});});
  }).then(()=>{this.pending=null;},()=>{this.state={ok:false,error:'Не удалось проверить звуковой сервис'};this.checkedAt=this.now();this.pending=null;});return this.pending;
 }
 lines(voiceError,beeperError){
  const s=this.state;
  if(!s)return ['ЗВУК: ПРОВЕРКА СЕРВИСА','BMW MEDIAPLAYER: ЕЩЁ НЕ ПРОВЕРЕН'];
  if(this.now()-this.checkedAt>30000)return ['ЗВУК: СОСТОЯНИЕ УСТАРЕЛО','ОЖИДАНИЕ ПРОВЕРКИ СВЯЗИ'];
  const version=typeof s.version==='string'?s.version:'НЕИЗВЕСТНА';
  const compatible=s.speechProtocol>=3&&s.beeperProtocol>=3;
  const top='ЗВУК: '+version+' · '+(!s.ok?'НЕДОСТУПЕН':!compatible?'НУЖНО ОБНОВЛЕНИЕ':s.ready?'ГОТОВ':'ОЖИДАНИЕ BMW');
  const error=beeperError||voiceError||s.error||s.lastError;
  return [top,error?'ОШИБКА: '+String(error).slice(0,105):(s.audioBackend==='pulse'?'PULSEAUDIO + OVERLAY · ЭКСПЕРИМЕНТ':require('./audio-profiles').isProfile(s.audioBackend)?require('./audio-profiles').PROFILES.find(p=>p[0]===s.audioBackend)[1]+' + OVERLAY':s.audioBackend==='converter-stable'?'CONVERTER ТЕСТ · НАТИВНЫЙ МИКШЕР −6 ДБ':s.audioBackend==='converter'?'ALSA CONVERTER · ГОЛОС + ЖИВОЙ БИПЕР':s.audioBackend==='alsa'?'ALSA · ГОЛОС + ЖИВОЙ БИПЕР':'BMW MEDIAPLAYER: '+(s.mpAvailable?'ДОСТУПЕН':'НЕДОСТУПЕН'))+' · АУДИОКАНАЛ: '+(s.ccAvailable?'ДОСТУПЕН':'НЕДОСТУПЕН')];
 }
 close(){this.closed=true;if(this.finish)this.finish({ok:false,error:'Проверка остановлена'});}
}
module.exports={AudioHealth};
