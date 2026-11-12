'use strict';
const {policeKind}=require('./point-kind');
function warningRange(camera,options,speed){
 const override=Number(options&&options.distanceM);
 if(override>0)return Math.min(2000,override);
 if(camera.mapcamWarningDistanceM>0)return Math.min(2000,camera.mapcamWarningDistanceM);
 return camera.source==='local-user'?(speed>90?700:500):2000;
}
function isSpeeding(camera,speed,options,previous,useAverage){
 if(policeKind(camera)||camera.camera_family==='dummy'||camera.averageControl&&!useAverage||
    !Number.isFinite(camera.limit)||camera.limit<=0||!Number.isFinite(speed))return false;
 const threshold=camera.limit+Math.max(0,Number(options&&options.excessKmh)||0);
 // Entry is strictly above the chosen threshold; leave 2 km/h below it.
 return previous?speed>camera.limit&&speed>threshold-2:speed>threshold;
}
function gpsHealth(fix,now){
 if(!fix||!Number.isFinite(fix.timeMs)||now-fix.timeMs>3000||fix.timeMs>now+500)return 'НЕТ GPS';
 if(!Number.isFinite(fix.accuracyM)||fix.accuracyM<=0||fix.accuracyM>=15)return 'НИЗКАЯ ТОЧНОСТЬ GPS';
 if(![fix.lat,fix.lon,fix.speedKmh].every(Number.isFinite)||Math.abs(fix.lat)>90||Math.abs(fix.lon)>180||fix.speedKmh<0||fix.speedKmh>350)return 'НЕТ GPS';
 return 'GPS · СИГНАЛ ПОЛУЧЕН';
}
module.exports={warningRange,isSpeeding,gpsHealth};
