'use strict';
const assert=require('assert'),path=require('path'),crypto=require('crypto');
const app=process.env.SPEEDCAM_TEST_APP||path.resolve(__dirname,'../apps/aurelm_speed_camera_warning');
const {MapcamWarnings}=require(app+'/mapcam-warnings');
const {beepState}=require(app+'/overspeed-beeper');
const {compareWarnings}=require(app+'/notification-priority');
const {MotionDistance}=require(app+'/motion-distance');
const {NotificationSession}=require(app+'/notification-session');
const {openCatalog,canonical}=require(app+'/hybrid-catalog');
const base={id:'rear-test',warningProfile:'hybrid-v1',warningEnabled:true,lat:55,lon:37,limit:60,
 typeNamespace:'estrelka',typeCode:192,camera_family:'fixed',rearCapture:true,mapcamControlDirection:null,
 mapcamDirectionType:1,mapcamApproachHeadingDeg:0,mapcamAngleDeg:60,mapcamWarningDistanceM:500,mapcamPath:[]};
function make(c,d,t,speed=90,side=0){const h=c.mapcamApproachHeadingDeg*Math.PI/180,m=6371000*Math.PI/180;
 return {lat:c.lat+(-d*Math.cos(h)+side*Math.sin(h))/m,lon:c.lon+(-d*Math.sin(h)-side*Math.cos(h))/(m*Math.cos(c.lat*Math.PI/180)),speedKmh:speed,headingDeg:c.mapcamApproachHeadingDeg,accuracyM:5,timeMs:t};}
function drive(c,distances,speed=90,side=0){const w=new MapcamWarnings();let t=1000;
 return {w,rows:distances.map(d=>{const f=make(c,d,t+=1000,speed,side),events=w.update(f,[c],t),state=w.states[c.id];
  return {d,f,phase:state&&state.phase,events,beep:beepState(state,f,t,true,false,40,false,'auto'),state:state&&{...state}};})};}
const distances=[160,135,110,85,60,35,10,0,-10,-35,-60,-85,-99,-101,-125];
for(const h of [0,45,90,180,270]){
 const c={...base,mapcamApproachHeadingDeg:h},run=drive(c,distances);
 for(const r of run.rows.filter(r=>r.d<135&&r.d>-100)){
  assert(r.phase,'Control must survive crossing at heading '+h+' d='+r.d);assert(r.beep,'Beeper continuity at '+r.d);
  if(r.d<0){assert.strictEqual(r.phase,'rear');assert.strictEqual(r.beep.intervalMs,300);}
 }
 assert(!run.rows.find(r=>r.d===-101).phase);assert(!run.rows.find(r=>r.d===-101).beep);
 assert.strictEqual(run.rows.filter(r=>r.events.some(e=>e.type==='camera')).length,1,'No second announcement on crossing');
}
for(const c of [{...base,rearCapture:false},{...base,rearCapture:null},{...base,typeCode:155,camera_family:'dummy'}]){
 const run=drive(c,distances);assert(!run.rows.find(r=>r.d===-10).phase);assert(!run.rows.find(r=>r.d===-10).beep);
}
assert(!drive(base,[-180,-155,-130,-105,-80]).rows.some(r=>r.phase),'Wrong direction never acquires rear control');
assert(!drive(base,distances,90,160).rows.some(r=>r.phase),'Parallel road must remain excluded');
assert(drive(base,[180,125,70,15,-40,-95,-150],200).rows.some(r=>r.phase==='rear'),'200 km/h skipped point');
const jitter=drive(base,[80,55,30,5,0,-1,0,-1,-10,-35]);
assert(jitter.rows.filter(r=>r.d<=0).every(r=>r.phase==='rear'),'Near-zero GPS jitter keeps the latched rear state');
const rear=drive(base,distances).rows.find(r=>r.d===-35);
assert.strictEqual(beepState(rear.state,{...rear.f,speedKmh:80},rear.f.timeMs,true,false,40),null,'Exactly +20 is silent');
assert.strictEqual(beepState(rear.state,rear.f,rear.f.timeMs,true,false,40,false,'off'),null);
assert.strictEqual(beepState(rear.state,{...rear.f,accuracyM:50},rear.f.timeMs,true,false,40),null);
assert(beepState(rear.state,rear.f,rear.f.timeMs,true,true,40),'Voice does not stop rear beeper');
assert(compareWarnings({...rear.state,phase:'point',distanceM:400},rear.state)<0,'Upcoming camera has priority');
const lost=drive(base,[80,55,30,5,-20]);lost.w.update(null,[base],9000);assert.strictEqual(Object.keys(lost.w.states).length,0);
const session=new NotificationSession({cancel(){}},()=>({voice:'always'}),()=>rear.f.timeMs);
session.fix=rear.f;assert(!session.eligible(rear.state),'No repeated voice once camera is behind');
let now=1000;const motion=new MotionDistance({now:()=>now,wall:()=>now,vehicle:()=>({valid:true,speedKmh:90})});
const f=make(base,0,1000),hit={camera:base,distanceM:0,active:true,state:{phase:'rear'}};
motion.observeGps(f);motion.anchor(hit,f);now+=100;assert(Math.abs(motion.value().distanceM-2.5)<.01,'Smooth distance increases from exact zero at 10 Hz');
async function main(){
 if(process.argv[2]){const db=await openCatalog(process.argv[2]);let count=0,rearCount=0;const digest=crypto.createHash('sha256');
  for(let i=0;i<db.index.blocks.length;i++)for(const c of db.block(i)){
   count++;digest.update(JSON.stringify(canonical(c))+'\n');
   const expected=c.typeNamespace==='estrelka'&&c.estrelkaFlagsRaw!==null?!!(c.estrelkaFlagsRaw&16):null;
   assert.strictEqual(c.rearCapture,expected);if(c.rearCapture)rearCount++;
  }assert.strictEqual(count,db.manifest.count);assert.strictEqual(digest.digest('hex'),db.manifest.contentHash);
  assert(rearCount>0);db.close();console.log('PASS binary: '+count+' records; '+rearCount+' rear flags; unchanged canonical checksum');
 }
 console.log('PASS rear control: exact crossing, 5 headings, 200 km/h, jitter, direction, adjacent road, dummy, 100 m cutoff, beeper, voice and 10 Hz distance.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
