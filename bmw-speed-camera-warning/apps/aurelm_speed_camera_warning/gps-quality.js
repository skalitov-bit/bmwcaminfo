'use strict';
// Coordinates stay measured, never relabel estimates as fresh satellite fixes.
const GOOD=15,RETAIN=35,MAX_AGE=3000;
// BMW's fused position has a validity flag, not a reported metre accuracy.
function trustedPosition(f){return !!f&&f.coordinatesValid===true&&f.accuracyM===null&&f.accuracySource==='not_reported'&&
 ((f.positionSource==='nav'&&f.source==='BMW Navigation')||(f.positionSource==='can'&&f.source==='BMW GPSData'&&Number.isInteger(f.positionQuality)&&(f.positionQuality&416)!==0));}
// Geometry allowance only. Never displayed/exported as measured accuracy.
function geometryAccuracy(f){return trustedPosition(f)?15:f&&f.accuracyM;}
function current(f,now){return !!f&&[f.lat,f.lon,f.timeMs,f.speedKmh,now].every(Number.isFinite)&&Math.abs(f.lat)<=90&&Math.abs(f.lon)<=180&&f.speedKmh>=0&&f.speedKmh<=350&&(trustedPosition(f)||Number.isFinite(f.accuracyM)&&f.accuracyM>0)&&now-f.timeMs<=MAX_AGE&&f.timeMs<=now+500;}
function precise(f,now){return current(f,now)&&Number.isFinite(f.accuracyM)&&f.accuracyM<GOOD&&f.warningAccuracyState!=='degraded';}
// Up to 35 m runs the normal detector; degraded is a presentation label only.
function usable(f,now){return current(f,now)&&(trustedPosition(f)||f.accuracyM<=RETAIN);}
class GpsQuality {
 constructor(){this.reset();}
 reset(){this.mode='searching';this.goodSince=null;this.goodCount=0;this.lastTime=null;this.lastFix=null;}
 update(raw,now){
  if(!current(raw,now)){this.mode='lost';this.goodSince=null;this.goodCount=0;this.lastTime=null;this.lastFix=null;return raw;}
  if(this.lastTime!==null&&raw.timeMs<this.lastTime)return this.lastFix;
  const f=Object.assign({},raw),newSample=this.lastTime===null||f.timeMs>this.lastTime;
  if(newSample)this.lastTime=f.timeMs;
  if(trustedPosition(f)){this.mode='vehicle_position';this.goodSince=null;this.goodCount=0;}
  else if(f.accuracyM>=GOOD){this.mode=f.accuracyM<=RETAIN?'degraded':'unreliable';this.goodSince=null;this.goodCount=0;}
  else if(this.mode==='degraded'||this.mode==='unreliable'){
   if(newSample){if(this.goodSince===null)this.goodSince=f.timeMs;this.goodCount++;}
   if(this.goodCount>=3&&f.timeMs-this.goodSince>=2000){this.mode='good';this.goodSince=null;this.goodCount=0;}
   else this.mode='degraded';
  }else this.mode='good';
  f.warningAccuracyState=this.mode;this.lastFix=f;return f;
 }
}
module.exports={GpsQuality,current,precise,usable,GOOD,RETAIN,trustedPosition,geometryAccuracy};
