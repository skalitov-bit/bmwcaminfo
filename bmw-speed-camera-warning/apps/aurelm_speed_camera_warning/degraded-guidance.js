'use strict';
const {current,precise}=require('./gps-quality');
const {diff}=require('./mapcam-warnings');
const {isSpeeding}=require('./notification-rules');
// Keep only previously confirmed targets, on a consistent straight approach.
// No acquisition, section endpoint event, or average-speed integration here.
class DegradedGuidance {
 constructor(){this.reset();}
 reset(){this.anchor=null;this.reason='НЕТ ПОДТВЕРЖДЁННОЙ КАМЕРЫ';}
 capture(states,fix,heading){
  if(!precise(fix,fix.timeMs))return;
  this.anchor={fix:Object.assign({},fix),heading,states:Object.keys(states).reduce((o,k)=>{o[k]=Object.assign({},states[k]);return o;},{}),previous:Object.assign({},fix)};
  this.reason='ТОЧНЫЕ КООРДИНАТЫ';
 }
 update(fix,now,options){
  const a=this.anchor;
  const stop=reason=>{this.reason=reason;this.anchor=null;return {};};
  if(!a)return {};
  if(!current(fix,now)||fix.accuracyM>35)return stop('КООРДИНАТЫ НЕДОСТОВЕРНЫ');
  if(fix.timeMs<a.previous.timeMs||now-a.fix.timeMs>30000)return stop('ЛИМИТ СОПРОВОЖДЕНИЯ 30 С');
  const heading=a.heading;
  if(!Number.isFinite(heading))return stop('НАПРАВЛЕНИЕ НЕ ПОДТВЕРЖДЕНО');
  if(fix.speedKmh>5&&(!Number.isFinite(fix.headingDeg)||diff(heading,fix.headingDeg)>25))return stop('ИЗМЕНЕНИЕ НАПРАВЛЕНИЯ');
  const scale=111320,cos=Math.cos(a.fix.lat*Math.PI/180),r=heading*Math.PI/180;
  const dx=(fix.lon-a.fix.lon)*scale*cos,dy=(fix.lat-a.fix.lat)*scale;
  const along=dx*Math.sin(r)+dy*Math.cos(r),side=Math.abs(dx*Math.cos(r)-dy*Math.sin(r));
  const dt=(fix.timeMs-a.previous.timeMs)/1000;
  const moved=Math.hypot((fix.lon-a.previous.lon)*scale*cos,(fix.lat-a.previous.lat)*scale);
  const allowed=Math.max(fix.speedKmh,a.previous.speedKmh)/3.6*Math.max(0,dt)*1.5+fix.accuracyM+a.previous.accuracyM;
  if(side>Math.max(15,fix.accuracyM*1.25)||along<-(fix.accuracyM+a.fix.accuracyM)||moved>allowed)return stop('СКАЧОК ИЛИ УХОД С ТРАЕКТОРИИ');
  a.previous=Object.assign({},fix);const states={};
  Object.keys(a.states).forEach(id=>{
   const old=a.states[id],distanceM=old.distanceM-Math.max(0,along);
   if(!['point','section'].includes(old.phase)||distanceM<=fix.accuracyM+10){delete a.states[id];return;}
   const s=Object.assign({},old,{distanceM,lastSeenAt:now,accuracyDegraded:true});
   if(s.useAverage){s.averageKmh=null;s.speedKmh=null;s.speeding=false;s.partialSection=true;}
   else {s.speedKmh=fix.speedKmh;s.speeding=isSpeeding(s.camera,fix.speedKmh,options,s.speeding,false);}
   states[id]=s;
  });
  this.reason=Object.keys(states).length?'СОПРОВОЖДЕНИЕ / ТОЧНОСТЬ СНИЖЕНА':'ВОЗМОЖЕН ПРОЕЗД КАМЕРЫ';return states;
 }
}
module.exports={DegradedGuidance};
