'use strict';
const net=require('net');
const {controlsSpeed}=require('./notification-priority');
const {freshFix,hasRearControl,REAR_DISTANCE_M}=require('./mapcam-warnings');
const SOCKET='/run/bmwcaminfo-voice/ctl.sock';
// One faster step at every 50 m boundary, fastest during the final 50 m.
function intervalFor(distance){return Math.min(30000,300+100*Math.max(0,Math.ceil(distance/50)-1));}
// voiceBusy is retained for caller compatibility; the native mixer ducks instead of stopping.
function beepState(state,fix,now,monitoring,voiceBusy,volume,forceAudio,mode){
 const c=state&&state.camera;
 const speed=state&&state.useAverage?state.speedKmh:fix&&fix.speedKmh;
 const rear=state&&state.phase==='rear'&&hasRearControl(c)&&state.distanceM<REAR_DISTANCE_M;
 if((mode==='off'&&forceAudio!==true)||!monitoring||!freshFix(fix,now)||!c||
    (!['point','section'].includes(state.phase)&&!rear)||!Number.isFinite(state.distanceM)||state.distanceM<0)return null;
 if(forceAudio!==true&&(!controlsSpeed(c)||!Number.isFinite(c.limit)||c.limit<=0||!Number.isFinite(speed)||speed-c.limit<=20))return null;
 const raw=volume===undefined||volume===null||volume===''?100:Number(volume);
 const level=Number.isFinite(raw)?Math.max(0,Math.min(100,Math.round(raw/10)*10)):100;
 return level?{cameraId:String(c.id),intervalMs:intervalFor(rear?0:state.distanceM),distanceM:state.distanceM,volume:level}:null;
}
// A live connection carries a lease, never a queue of individual beeps.
class OverspeedBeeper {
 constructor(options){options=options||{};this.net=options.net||net;this.now=options.now||Date.now;this.log=options.log||(()=>{});this.socket=null;this.connected=false;this.latest=null;this.retryAt=0;this.lastError=null;}
 update(state){
  // Accelerate at the boundary; require 5 m of retreat to slow again.
  if(state&&this.latest&&state.cameraId===this.latest.cameraId&&state.intervalMs>this.latest.intervalMs&&
     Number.isFinite(state.distanceM)&&state.distanceM<=(1+(this.latest.intervalMs-300)/100)*50+5){
   state=Object.assign({},state,{intervalMs:this.latest.intervalMs});
  }
  this.latest=state;
  if(!state){this.stop();return;}
  if(this.socket){if(this.connected)this.send();return;}
  if(this.now()<this.retryAt)return;
  const socket=this.socket=this.net.createConnection(SOCKET);let buffer='';
  const fail=message=>{if(this.socket!==socket)return;this.lastError=message;this.log('BEEPER: '+message);this.retryAt=this.now()+10000;this.stop();};
  socket.setEncoding('utf8');socket.setTimeout(2000);
  socket.on('connect',()=>{if(this.socket!==socket)return;this.connected=true;this.send();});
  socket.on('data',chunk=>{buffer+=chunk;if(buffer.length>4096){fail('Invalid service response');return;}let end;while((end=buffer.indexOf('\n'))>=0){let r;try{r=JSON.parse(buffer.slice(0,end));}catch(e){fail('Invalid service response');return;}buffer=buffer.slice(end+1);if(!r.ok){fail(r.error==='Unknown action or audio file'?'Для нового бипера нужен звуковой компонент 0.1.18':r.error||'Service rejected beeper');return;}this.lastError=null;}});
  socket.on('error',()=>fail('Звуковой компонент недоступен'));
  socket.on('timeout',()=>fail('Нет ответа звукового компонента'));
  socket.on('close',()=>{if(this.socket===socket){this.socket=null;this.connected=false;this.retryAt=this.now()+10000;}});
 }
 send(){if(this.socket&&this.connected&&this.latest)this.socket.write(JSON.stringify(Object.assign({action:'beeper-v3'},this.latest))+'\n');}
 stop(){const socket=this.socket;this.socket=null;this.connected=false;this.latest=null;if(socket)socket.destroy();}
}
module.exports={OverspeedBeeper,beepState,intervalFor};
