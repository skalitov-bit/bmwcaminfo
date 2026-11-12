'use strict';
const net=require('net');
const {controlsSpeed}=require('./notification-priority');
const {freshFix}=require('./mapcam-warnings');
const SOCKET='/run/bmwcaminfo-voice/ctl.sock';
function intervalFor(distance){return distance<100?350:distance<200?600:distance<400?1000:distance<=700?1500:2000;}
function beepState(state,fix,now,monitoring,voiceBusy,volume){
 const c=state&&state.camera;
 const speed=state&&state.useAverage?state.speedKmh:fix&&fix.speedKmh;
 if(!monitoring||voiceBusy||!freshFix(fix,now)||!c||!controlsSpeed(c)||
    !['point','section'].includes(state.phase)||!Number.isFinite(state.distanceM)||state.distanceM<=0||
    !Number.isFinite(c.limit)||c.limit<=0||!Number.isFinite(speed)||speed-c.limit<=20)return null;
 const raw=volume===undefined||volume===null||volume===''?100:Number(volume);
 const level=Number.isFinite(raw)?Math.max(0,Math.min(100,Math.round(raw/10)*10)):100;
 return level?{cameraId:String(c.id),intervalMs:intervalFor(state.distanceM),volume:level}:null;
}
// A live connection carries a lease, never a queue of individual beeps.
class OverspeedBeeper {
 constructor(options){options=options||{};this.net=options.net||net;this.now=options.now||Date.now;this.log=options.log||(()=>{});this.socket=null;this.connected=false;this.latest=null;this.retryAt=0;this.lastError=null;}
 update(state){
  this.latest=state;
  if(!state){this.stop();return;}
  if(this.socket){if(this.connected)this.send();return;}
  if(this.now()<this.retryAt)return;
  const socket=this.socket=this.net.createConnection(SOCKET);let buffer='';
  const fail=message=>{if(this.socket!==socket)return;this.lastError=message;this.log('BEEPER: '+message);this.retryAt=this.now()+10000;this.stop();};
  socket.setEncoding('utf8');socket.setTimeout(2000);
  socket.on('connect',()=>{if(this.socket!==socket)return;this.connected=true;this.send();});
  socket.on('data',chunk=>{buffer+=chunk;if(buffer.length>4096){fail('Invalid service response');return;}let end;while((end=buffer.indexOf('\n'))>=0){let r;try{r=JSON.parse(buffer.slice(0,end));}catch(e){fail('Invalid service response');return;}buffer=buffer.slice(end+1);if(!r.ok){fail(r.error==='Unknown action or audio file'?'Для бипера нужен звуковой компонент 0.1.12':r.error||'Service rejected beeper');return;}this.lastError=null;}});
  socket.on('error',()=>fail('Звуковой компонент недоступен'));
  socket.on('timeout',()=>fail('Нет ответа звукового компонента'));
  socket.on('close',()=>{if(this.socket===socket){this.socket=null;this.connected=false;this.retryAt=this.now()+10000;}});
 }
 send(){if(this.socket&&this.connected&&this.latest)this.socket.write(JSON.stringify(Object.assign({action:'beeper'},this.latest))+'\n');}
 stop(){const socket=this.socket;this.socket=null;this.connected=false;this.latest=null;if(socket)socket.destroy();}
}
module.exports={OverspeedBeeper,beepState,intervalFor};
