'use strict';
// Presentation only. Never fabricate a GPS fix or feed extrapolation into
// camera selection, voice stages or section-completion logic.
const {monotonicMs}=require('./ring-pulse');
const {freshFix,bearing,diff}=require('./mapcam-warnings');
const LIMITS={reserveMs:5000,travelM:80,uncertaintyM:25,vehicleAgeMs:1500,gpsPredictMs:1200};
class MotionDistance{
 constructor(options){const o=options||{};this.now=o.now||monotonicMs;this.wall=o.wall||Date.now;this.vehicle=o.vehicle||(()=>({valid:false}));this.gpsEvents=[];this.lastGps=null;this.reset();}
 reset(){this.anchorState=null;this.lost=false;this.blocked=false;this.reason='НЕТ ЦЕЛИ';}
 observeGps(fix){
  if(!freshFix(fix,this.wall())){this.lost=true;return;}
  if(this.lastGps&&fix.timeMs<=this.lastGps.timeMs)return;
  this.previousGps=this.lastGps;this.lastGps=Object.assign({},fix);this.lost=false;
  this.gpsEvents.push(this.now());while(this.gpsEvents.length>120||this.now()-this.gpsEvents[0]>5000)this.gpsEvents.shift();
 }
 speed(){const v=this.vehicle(),f=this.lastGps;const mismatch=v.valid&&f&&freshFix(f,this.wall())&&Math.abs(v.speedKmh-f.speedKmh)>Math.max(10,f.speedKmh*.20);return {v,mismatch,car:v.valid&&!mismatch};}
 advance(){
  const a=this.anchorState;if(!a)return;const t=this.now(),dt=Math.max(0,t-a.tick),s=this.speed();
   if(dt>LIMITS.vehicleAgeMs||!s.car)a.continuous=false;
  // Integrate the speed retained at the preceding tick, then adopt the
  // newly received sample for the following interval.
  if(a.previousValid&&dt<=LIMITS.vehicleAgeMs){a.travel+=a.previousSpeed*dt/3600;a.progress+=a.previousSpeed*dt/3600*a.factor;}
  else if(dt>0)a.continuous=false;
  a.tick=t;a.previousValid=s.car;a.previousSpeed=s.car?s.v.speedKmh:0;
 }
 vehicleChanged(){this.advance();}
 anchor(hit,fix){
  if(!hit||!freshFix(fix,this.wall())||!Number.isFinite(hit.distanceM)){this.reset();return;}
  const old=this.anchorState,key=String(hit.camera.id)+':'+(hit.state&&hit.state.phase||'point');
  if(old&&old.key===key&&fix.timeMs<=old.fix.timeMs)return;
  const before=this.value(),s=this.speed(),phase=hit.state&&hit.state.phase||'point';
  let factor=0;
  if(Number.isFinite(fix.headingDeg))factor=Math.cos(diff(fix.headingDeg,bearing(fix,hit.camera))*Math.PI/180);
  if(phase==='rear'&&hit.distanceM<1)factor=-1;
  if(phase==='section')factor=old&&old.key===key&&fix.timeMs>old.fix.timeMs&&fix.speedKmh>5?Math.max(0,Math.min(1,(old.distance-hit.distanceM)/((fix.timeMs-old.fix.timeMs)/1000)/(fix.speedKmh/3.6))):0;
  factor=Math.max(-1,Math.min(1,Number.isFinite(factor)?factor:0));
  const prev=this.previousGps,straight=!!prev&&fix.timeMs-prev.timeMs>0&&fix.timeMs-prev.timeMs<=2000&&Number.isFinite(prev.headingDeg)&&Number.isFinite(fix.headingDeg)&&diff(prev.headingDeg,fix.headingDeg)<=10;
  const correction=old&&old.key===key&&before&&Math.abs(before.distanceM-hit.distanceM)<20?before.distanceM-hit.distanceM:0;
  this.anchorState={key,hit:Object.assign({},hit,{state:Object.assign({},hit.state)}),fix:Object.assign({},fix),ageAtStart:Math.max(0,this.wall()-fix.timeMs),distance:hit.distanceM,phase,tick:this.now(),started:this.now(),progress:0,travel:0,factor,correction,straight,continuous:s.car,previousValid:s.car,previousSpeed:s.car?s.v.speedKmh:0};
  this.lost=false;this.blocked=false;this.reason='GPS';
 }
 value(){
  const a=this.anchorState;if(!a||this.blocked)return null;
  this.advance();const wallAge=this.wall()-a.fix.timeMs,elapsed=Math.max(0,this.now()-a.started),age=Math.max(wallAge,a.ageAtStart+elapsed),s=this.speed();
  if(wallAge< -500){this.reason='ВРЕМЯ GPS';this.blocked=true;return null;}
  const estimated=this.lost||age>3000;
  const progress=s.car&&a.continuous?a.progress:a.fix.speedKmh/3.6*Math.min(elapsed,LIMITS.gpsPredictMs)/1000*a.factor;
  const distanceM=Math.max(0,a.distance-progress+a.correction*Math.max(0,1-elapsed/350));
  const uncertaintyM=Number.isFinite(a.fix.accuracyM)?a.fix.accuracyM+a.travel*.12+Math.max(0,age)/1000*2:null;
  if(estimated){
   let reason=null;
   if(!a.hit.active)reason='НЕТ АКТИВНОЙ КАМЕРЫ';
   else if(uncertaintyM===null)reason='ПОГРЕШНОСТЬ ИСТОЧНИКА НЕИЗВЕСТНА';
   else if(!s.car||!a.continuous)reason='НЕТ ДОСТОВЕРНОЙ СКОРОСТИ';
   else if(!a.straight||a.factor<.85||!['point','section'].includes(a.phase))reason='НЕОПРЕДЕЛЁННОЕ НАПРАВЛЕНИЕ';
   else if(age>LIMITS.reserveMs||a.travel>LIMITS.travelM||uncertaintyM>LIMITS.uncertaintyM)reason='ЛИМИТ РЕЗЕРВА';
   else if(distanceM<=uncertaintyM+5)reason='ВОЗМОЖЕН ПРОЕЗД КАМЕРЫ';
   if(reason){this.reason=reason;this.blocked=true;return null;}
  }
  this.reason=estimated?'РАСЧЁТНО':s.car?'GPS + АВТО':s.mismatch?'GPS / РАСХОЖДЕНИЕ':'GPS';
  return {distanceM,estimated,uncertaintyM,ageMs:age,source:this.reason,speedKmh:s.car?s.v.speedKmh:a.fix.speedKmh,hit:a.hit};
 }
 diagnostics(){const v=this.vehicle(),f=this.lastGps,a=this.anchorState,s=this.value(),now=this.now(),live=this.gpsEvents.filter(t=>now-t<=5000);return {vehicle:v,gpsSpeed:f&&f.speedKmh,gpsAgeMs:f?this.wall()-f.timeMs:null,gpsHz:live.length>=2?(live.length-1)/Math.max(.001,(live[live.length-1]-live[0])/1000):0,delta:v.valid&&f?v.speedKmh-f.speedKmh:null,mode:s?s.source:this.reason,reserveRemainingMs:a?Math.max(0,LIMITS.reserveMs-(this.wall()-a.fix.timeMs)):0,uncertaintyM:s&&s.uncertaintyM};}
}
module.exports={MotionDistance,LIMITS};
