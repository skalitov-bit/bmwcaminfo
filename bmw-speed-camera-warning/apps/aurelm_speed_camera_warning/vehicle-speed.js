'use strict';
const EventEmitter=require('events');
const {monotonicMs}=require('./ring-pulse');
const IFACE='de.bmw.infotainment.vehicle.Vehicle2',FIELD='statusCarSpeed2',MAX_AGE=1500;
class VehicleSpeed extends EventEmitter{
 constructor(ctx,options){super();const o=options||{};this.ctx=ctx;this.now=o.now||monotonicMs;this.every=o.setInterval||setInterval;this.cancel=o.clearInterval||clearInterval;this.sub=null;this.timer=null;this.closed=false;this.pending=false;this.value=null;this.at=null;this.events=[];this.reads=[];this.invalid=0;this.error='ОЖИДАНИЕ';}
 accept(payload,kind,at){
  if(this.closed)return;const t=at===undefined?this.now():at;
  if(this.at!==null&&t<this.at)return; // A slow getter must not overwrite a newer event.
  const raw=payload&&payload.speedVehicleCentreOfGravity;
  if(typeof raw!=='number'||!Number.isFinite(raw)||raw<0||raw===65535||raw*.015625>350){this.invalid++;this.value=null;this.at=t;this.error='НЕКОРРЕКТНЫЙ СИГНАЛ';this.emit('change',this.snapshot());return;}
  this.value=raw*.015625;this.at=t;this.error=null;
  const samples=kind==='read'?this.reads:this.events;samples.push(t);while(samples.length>120||samples.length&&t-samples[0]>5000)samples.shift();
  this.emit('change',this.snapshot());
 }
 async start(){
  if(!this.ctx.signals||typeof this.ctx.signals.watch!=='function'){this.error='ИНТЕРФЕЙС НЕДОСТУПЕН';return;}
  try{
   const sub=await this.ctx.signals.watch(IFACE,'1',{[FIELD]:v=>this.accept(v,'event')},this.ctx.log);
   if(this.closed){if(sub&&sub.shutdown)await sub.shutdown();return;}
   this.sub=sub;if(!sub||sub.error){this.error='НЕТ ДОСТУПА К СКОРОСТИ';return;}
   // Notifications can stop at constant speed. One bounded read per second
   // refreshes validity; do not poll the bus at the display refresh rate.
   this.timer=this.every(()=>this.read(),1000);
  }catch(e){this.error='ОШИБКА ПОДКЛЮЧЕНИЯ';}
 }
 read(){
  const sub=this.sub;if(this.closed||this.pending||!sub||!sub.available||!sub.proxy||typeof sub.proxy.getValue!=='function')return;
  this.pending=true;const at=this.now();
  Promise.resolve().then(()=>sub.proxy.getValue(FIELD,1000)).then(v=>{if(this.now()-at<=1000)this.accept(v,'read',at);},()=>{this.error='НЕТ ОТВЕТА';}).then(()=>{this.pending=false;});
 }
 snapshot(){
  const now=this.now(),ageMs=this.at===null?null:Math.max(0,now-this.at),valid=!this.closed&&this.value!==null&&ageMs!==null&&ageMs<=MAX_AGE&&(!this.sub||this.sub.available!==false);
  const hz=a=>{const live=a.filter(t=>now-t<=5000);return live.length>=2?(live.length-1)/Math.max(.001,(live[live.length-1]-live[0])/1000):0;};
  return {valid,speedKmh:valid?this.value:null,lastSpeedKmh:this.value,ageMs,eventHz:hz(this.events),readHz:hz(this.reads),invalid:this.invalid,error:valid?null:this.error||'СИГНАЛ УСТАРЕЛ'};
 }
 close(){this.closed=true;if(this.timer!==null)this.cancel(this.timer);this.timer=null;if(this.sub&&this.sub.shutdown)Promise.resolve().then(()=>this.sub.shutdown()).catch(()=>{});this.removeAllListeners();}
}
module.exports={VehicleSpeed,MAX_AGE,IFACE,FIELD};
