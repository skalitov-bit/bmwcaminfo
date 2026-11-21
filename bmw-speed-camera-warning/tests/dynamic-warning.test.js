'use strict';
const assert=require('assert');
const root='../apps/aurelm_speed_camera_warning/';
const {warningRange,MAX_WARNING_RANGE_M}=require(root+'notification-rules');
const {MapcamWarnings}=require(root+'mapcam-warnings');
const {RoadGuidanceWarnings}=require(root+'road-guidance');
const {NotificationSession}=require(root+'notification-session');
const AUTO={dynamicDistance:true,voice:'always',repeat200:false};
const camera={id:'dynamic-test',lat:55,lon:37,source:'MapCam.info',warningProfile:'hybrid-v1',warningEnabled:true,
 mapcamTypeCode:1,mapcamAngleDeg:60,mapcamDirectionType:0,mapcamWarningDistanceM:800,limit:60};
const fix=(d,time,speed=100,extra)=>Object.assign({lat:55-d/111320,lon:37,timeMs:time,speedKmh:speed,headingDeg:0,accuracyM:5},extra);
const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
function drive(speed,c=camera,options=AUTO,road=false){
 const engine=road?new RoadGuidanceWarnings([{id:c.id,lat:c.lat,lon:c.lon,roads:[{id:'road',pts:[[0,-5000],[0,1000]],camM:5000,dir:1}]}],options):new MapcamWarnings(options);
 let first=null;
 for(let n=0;n<300;n++){
  const d=4400-n*speed/3.6;if(d<0)break;
  const events=engine.update(fix(d,1000+n*1000,speed),[c],1000+n*1000);
  if(events.some(e=>e.type==='camera')){first=engine.states[c.id].distanceM;break;}
 }
 return first;
}
async function run(){
 assert.equal(warningRange(camera,AUTO,100),850);assert.equal(warningRange(camera,AUTO,200),1700);
 assert.equal(warningRange(camera,AUTO,60),800);
 assert.equal(warningRange(Object.assign({},camera,{mapcamWarningDistanceM:400}),AUTO,60),500,'Exact 50m boundary must not round up from floating point noise');
 const noDistance=Object.assign({},camera,{mapcamWarningDistanceM:0});
 assert.equal(warningRange(noDistance,AUTO,100),2000);assert.equal(warningRange(noDistance,AUTO,200),4000);
 assert.equal(warningRange(noDistance,AUTO,350),MAX_WARNING_RANGE_M);
 for(const s of [NaN,Infinity,-10])assert.equal(warningRange(camera,AUTO,s),800);
 assert.equal(warningRange(camera,{distanceM:500},200),500);
 assert.equal(warningRange(camera,{dynamicDistance:false},200),800);
 const results=[];
 for(const base of [400,800,2000]){
  const c=Object.assign({},camera,{mapcamWarningDistanceM:base});
  for(const speed of [60,100,200]){
   const threshold=warningRange(c,AUTO,speed),first=drive(speed,c);
   assert(first!==null&&first<=threshold&&first>=threshold-speed/3.6-5,JSON.stringify({base,speed,threshold,first}));
   results.push({databaseM:base,speedKmh:speed,thresholdM:threshold,firstEventM:Math.round(first)});
  }
 }
 assert(drive(200)>drive(100)+750,'Fast approach must warn sooner in real detector');
 for(const speed of [100,200]){const first=drive(speed,camera,{distanceM:500});assert(first<=500&&first>430);}
 const local=Object.assign({},camera,{source:'local-user'});
 assert(drive(200,local,AUTO,true)>drive(100,local,AUTO,true)+700,'Road-matched cameras also use dynamic distance');
 const w=new MapcamWarnings(AUTO);let time=1000,voiceCount=0;
 const session=new NotificationSession({cameraResult:async()=>{voiceCount++;return {ok:true};},cancel(){}},()=>AUTO,()=>time);
 const step=async(d,speed,extra)=>{const f=fix(d,time,speed,extra),events=w.update(f,[camera],time);session.update(w.states,f,w.heading,events);await flush();time+=1000;return events;};
 await step(1740,200);await step(1690,200);assert.equal(voiceCount,1);
 await step(1660,40);assert(w.states[camera.id],'Braking must not hide active warning outside the new entry range');
 assert.equal(w.states[camera.id].warningRangeM,1700);assert.equal(voiceCount,1);
 await step(1650,40,{accuracyM:30});assert(!w.states[camera.id],'Dynamic range never bypasses GPS quality');
 await step(1640,40);await step(1630,40);assert.equal(voiceCount,1,'No duplicate announcement after GPS interruption');
 const bad=Object.assign({},camera,{warningEnabled:false});assert.equal(drive(200,bad),null);
 const away=new MapcamWarnings(AUTO);away.update(fix(-1740,1000,200),[camera],1000);
 assert(!away.update(fix(-1790,2000,200),[camera],2000).length,'Receding point must not become an early warning');
 const wrong=new MapcamWarnings(AUTO);const directional=Object.assign({},camera,{mapcamDirectionType:1,mapcamApproachHeadingDeg:180});
 wrong.update(fix(1740,1000,200),[directional],1000);assert(!wrong.update(fix(1690,2000,200),[directional],2000).length);
 // Waiting at a constant range, or one isolated fix, must not acquire a target.
 const still=new MapcamWarnings(AUTO);assert(!still.update(fix(1000,1000,200),[camera],1000).length);
 assert(!still.update(fix(1000,2000,200),[camera],2000).length);
 console.log(JSON.stringify({simulation:true,hardwareTested:false,results},null,2));
 console.log('PASS dynamic warning: speed/distance matrix, road path, fixed modes, latched braking, one voice per pass and GPS/direction/exclusion guards.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
