'use strict';
const {policeKind}=require('./point-kind');
const {gpsMessage}=require('./gps-message');
const MAX_WARNING_RANGE_M=4000,APPROACH_SECONDS=30,REFERENCE_SPEED_KMH=100;
function baseWarningRange(camera,options,speed){
 const override=Number(options&&options.distanceM);
 if(override>0)return Math.min(2000,override);
 if(camera.mapcamWarningDistanceM>0)return Math.min(2000,camera.mapcamWarningDistanceM);
 return camera.source==='local-user'?(speed>90?700:500):2000;
}
// Auto mode keeps the database distance as a floor, supplies a 30-second
// approach window and scales large database distances above 100 km/h.
// Callers supply validated GPS speed projected toward the point (or along a road).
function warningRange(camera,options,speed){
 const base=baseWarningRange(camera,options,speed);
 if(!options||options.dynamicDistance!==true)return base;
 const closing=Number.isFinite(speed)?Math.max(0,Math.min(350,speed)):0;
 const target=Math.max(base,base*closing/REFERENCE_SPEED_KMH,closing/3.6*APPROACH_SECONDS);
 return Math.min(MAX_WARNING_RANGE_M,Math.ceil((target-1e-7)/50)*50);
}
function isSpeeding(camera,speed,options,previous,useAverage){
 if(require('./notification-types').hazardKind(camera)||policeKind(camera)||camera.camera_family==='dummy'||camera.averageControl&&!useAverage||
    !Number.isFinite(camera.limit)||camera.limit<=0||!Number.isFinite(speed))return false;
 const threshold=camera.limit+Math.max(0,Number(options&&options.excessKmh)||0);
 // Entry is strictly above the chosen threshold; leave 2 km/h below it.
 return previous?speed>camera.limit&&speed>threshold-2:speed>threshold;
}
function gpsHealth(fix,now){
 if(!fix||!Number.isFinite(fix.timeMs)||now-fix.timeMs>3000||fix.timeMs>now+500)return gpsMessage('lost');
 if(require('./gps-quality').trustedPosition(fix)&&require('./gps-quality').usable(fix,now))return fix.positionSource==='nav'?'GPS: НАВИГАЦИЯ BMW':'GPS: ДАННЫЕ BMW';
 if(fix.warningAccuracyState==='degraded'&&require('./gps-quality').current(fix,now)&&fix.accuracyM<=35)return gpsMessage('degraded');
 if(!Number.isFinite(fix.accuracyM)||fix.accuracyM<=0||fix.accuracyM>=15)return gpsMessage('unreliable');
 if(![fix.lat,fix.lon,fix.speedKmh].every(Number.isFinite)||Math.abs(fix.lat)>90||Math.abs(fix.lon)>180||fix.speedKmh<0||fix.speedKmh>350)return gpsMessage('unreliable');
 return 'GPS: СИГНАЛ ПОЛУЧЕН';
}
module.exports={warningRange,baseWarningRange,isSpeeding,gpsHealth,MAX_WARNING_RANGE_M,APPROACH_SECONDS};
