'use strict';
const assert=require('assert');
const {GpsQuality,usable,precise}=require('../apps/aurelm_speed_camera_warning/gps-quality');
const {MapcamWarnings}=require('../apps/aurelm_speed_camera_warning/mapcam-warnings');
const {NotificationSession,selectRadar}=require('../apps/aurelm_speed_camera_warning/notification-session');
const {gpsHealth}=require('../apps/aurelm_speed_camera_warning/notification-rules');
const {GpsOutputStatus}=require('../apps/aurelm_speed_camera_warning/gps-output-status');
const fix=(t,y,accuracy=7,extra)=>Object.assign({lat:56+y/111320,lon:48,timeMs:t,accuracyM:accuracy,speedKmh:72,headingDeg:0},extra);
const camera={id:'confirmed',source:'MapCam.info',lat:56,lon:48,limit:60,mapcamTypeCode:1,mapcamDirectionType:1,mapcamApproachHeadingDeg:0,mapcamAngleDeg:60,mapcamWarningDistanceM:500};
const q=new GpsQuality();
let f=q.update(fix(1000,-520),1000);assert(precise(f,1000));
f=q.update(fix(2000,-500,23),2000);assert(usable(f,2000));assert(!precise(f,2000));assert.equal(f.warningAccuracyState,'degraded');
assert(/СНИЖЕНА/.test(gpsHealth(f,2000)));assert.equal(new GpsOutputStatus().update(f,2000,false,true),'degraded');
assert(!usable(f,5001));assert(usable(fix(2000,-500,23),2000),'Moderate measured fixes are usable');
for(let t=3000;t<=5000;t+=1000){f=q.update(fix(t,-500+(t-2000)/50),t);assert.equal(f.warningAccuracyState,t<5000?'degraded':'good');if(t===3000)for(let n=0;n<10;n++)assert.equal(q.update(fix(t,-480),t).warningAccuracyState,'degraded');}
assert.equal(q.update(fix(4000,-900),5000).timeMs,5000,'Old samples cannot move the anchor backward');
assert(!usable(q.update(fix(6000,-400,36),6000),6000));
assert.equal(q.update(fix(7000,-380),7000).warningAccuracyState,'degraded');
assert.equal(q.update(fix(8000,-360,23),8000).warningAccuracyState,'degraded');
assert.equal(q.update(fix(9000,-340),9000).warningAccuracyState,'degraded','Recovery restarts after another bad fix');
for(const extra of [{lat:NaN},{lon:181},{speedKmh:351},{accuracyM:0},{timeMs:99999}])assert(!usable(q.update(fix(10000,-320,7,extra),10000),10000));

async function run(){
 for(const accuracy of [15,23,35]){
  const quality=new GpsQuality(),engine=new MapcamWarnings({excessKmh:20});let now=1000,calls=0;
  const session=new NotificationSession({cameraResult:()=>{calls++;return Promise.resolve({ok:true});}},()=>({voice:'always',repeat200:true}),()=>now);
  let sample,current;
  function step(y,a=accuracy){sample=quality.update(fix(now,y,a),now);const events=engine.update(sample,[camera],now);current=session.update(engine.states,sample,engine.heading,events);}
  step(-520);now=2000;step(-500);await Promise.resolve();await Promise.resolve();
  assert(current,'Acquire a new camera at '+accuracy+' m accuracy');assert.equal(calls,1);
  assert(selectRadar(null,[camera],Object.assign({},sample,{timeMs:Date.now()}),0,{}),'Radar preview remains available');
  for(let i=1;i<=20;i++){now+=1000;step(-500+i*20);await Promise.resolve();await Promise.resolve();}
  assert.equal(calls,2,'Normal 200 m repetition remains enabled');
  now+=1000;step(-80,7);await Promise.resolve();await Promise.resolve();assert.equal(calls,2,'Accuracy recovery does not replay voice');
 }
 assert(!usable(q.update(fix(20000,-100,35.01),20000),20000));
 assert(!usable(q.update(fix(21000,-100,23),24001),24001));
 console.log('PASS moderate GPS: new acquisition at 15/23/35 m, normal voice and repeat, preview, no replay on recovery, stale/severe rejected.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
