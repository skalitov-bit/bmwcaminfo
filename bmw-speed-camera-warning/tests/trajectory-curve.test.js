'use strict';
const assert=require('assert'),path=require('path');
const base=path.resolve(process.argv[2]||path.join(__dirname,'../apps/aurelm_speed_camera_warning'));
const {ApproachTrajectory,alignment,point,curveHit}=require(path.join(base,'approach-trajectory'));
const {MapcamWarnings}=require(path.join(base,'mapcam-warnings'));
const {NotificationSession}=require(path.join(base,'notification-session'));
const epoch=Date.now(),speed=60,m=111320;
function pos(s,r,offset){const a=s/r;return {lat:55+(r*Math.sin(a)-(offset||0)*Math.sin(a))/m,
 lon:37+(r*(1-Math.cos(a))+(offset||0)*Math.cos(a))/(m*Math.cos(55*Math.PI/180)),headingDeg:(a*180/Math.PI+360)%360};}
function run(r,noise){
 const tr=new ApproachTrajectory(),engine=new MapcamWarnings();let now=epoch;
 const session=new NotificationSession({cancel(){}},()=>({voice:'off'}),()=>now);
 const proto={warningProfile:'hybrid-v1',warningEnabled:true,mapcamTypeCode:1,mapcamAngleDeg:60,mapcamWarningDistanceM:1000,camera_family:'fixed'};
 const cameras=[Object.assign({},proto,pos(700,r),{id:'main60',limit:60,mapcamDirectionType:0}),Object.assign({},proto,pos(600,r,Math.sign(r)*30),{id:'side30',limit:30,mapcamDirectionType:1,mapcamApproachHeadingDeg:pos(600,r).headingDeg})];
 const rows=[];let model;
 for(let i=-1;i<=48;i++){
  now=epoch+i*1000;const f=Object.assign(pos(i*speed/3.6,r),{timeMs:now,speedKmh:speed,accuracyM:5});
  if(noise){f.lat+=Math.sin(i*2.3)*noise/m;f.lon+=Math.cos(i*1.7)*noise/(m*Math.cos(55*Math.PI/180));}
  const track=tr.update(f,now);if(i===15)model=track;
  engine.update(f,cameras,now,track);
  for(const s of Object.values(engine.states))s.trajectory=alignment(s.camera,track,s);
  const current=session.update(engine.states,f,engine.heading,[]);
  if(current)rows.push({second:i,remainingM:Math.round(700-i*speed/3.6),limit:current.camera.limit});
 }
 return {rows,model};
}
for(const radius of [600,-600,1000,-1000]){
 const result=run(radius,0);assert(result.model.curvature,'Measured curve required');
 assert(result.rows.length>10);assert(result.rows.every(r=>r.limit===60),'Adjacent camera selected on radius '+radius+': '+JSON.stringify(result.rows));
 assert(result.rows[0].remainingM>350,'Late acquisition on curve');
 console.log('Curve R='+radius+': first 60 at '+result.rows[0].remainingM+' m; no 30 selections');
}
const sample=run(600,0).model;
const projected=point(sample,200,0);assert(alignment(projected,sample).lateralM<1);
const camera=Object.assign({},projected,{mapcamDirectionType:1,mapcamApproachHeadingDeg:alignment(projected,sample).headingDeg});
assert(curveHit(camera,sample,60,600,2000));camera.mapcamApproachHeadingDeg=(camera.mapcamApproachHeadingDeg+180)%360;assert(!curveHit(camera,sample,60,600,2000));
camera.mapcamDirectionType=3;assert(!curveHit(camera,sample,60,600,2000));
assert(!curveHit(Object.assign({},point(sample,700,0),{mapcamDirectionType:0}),sample,60,2000,2000),'Do not extrapolate beyond horizon');
assert(!curveHit(Object.assign({},point(sample,-50,0),{mapcamDirectionType:0}),sample,60,600,2000),'No rear acquisition');
const tr=new ApproachTrajectory();let t;
for(let i=0;i<=12;i++){const f=Object.assign(pos(i*speed/3.6,600),{timeMs:epoch+i*1000,speedKmh:speed,accuracyM:5});t=tr.update(f,f.timeMs);}
assert(t.curvature);const end=pos(200,600),h=end.headingDeg*Math.PI/180;
for(let i=1;i<=3;i++){const f=Object.assign({},end,{lat:end.lat+Math.cos(h)*i*speed/3.6/m,lon:end.lon+Math.sin(h)*i*speed/3.6/(m*Math.cos(55*Math.PI/180)),timeMs:epoch+(12+i)*1000,speedKmh:speed,accuracyM:5});t=tr.update(f,f.timeMs);}
assert(!t.curvature,'Discard stale curve after straightening');
tr.update(null,epoch+16000);assert(!tr.value(epoch+16000));
const noisy=run(600,5);console.log('GPS perturbation +/-5 m: '+noisy.rows.filter(r=>r.limit===30).length+' adjacent selections (conservative fallback may remain ambiguous)');
const poor=new ApproachTrajectory();for(let i=0;i<20;i++){const f=Object.assign(pos(i*speed/3.6,600),{timeMs:epoch+i*1000,speedKmh:speed,accuracyM:25});const model=poor.update(f,f.timeMs);assert(!model||!model.curvature&&!model.trusted,'Degraded accuracy cannot establish a confident arc');}
const jitter=new ApproachTrajectory();for(let i=0;i<30;i++){const f={lat:55+i*speed/3.6/m,lon:37+Math.sin(i*2.1)*8/(m*Math.cos(55*Math.PI/180)),headingDeg:0,timeMs:epoch+i*1000,speedKmh:speed,accuracyM:8};const model=jitter.update(f,f.timeMs);assert(!model||!model.curvature,'GPS zigzag must not become a fitted arc');}
console.log('PASS: both turn directions, four radii, direction gates, horizon, passage, turn exit and GPS loss.');
