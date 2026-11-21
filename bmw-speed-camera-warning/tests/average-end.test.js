'use strict';
const assert=require('assert');
const base='../apps/aurelm_speed_camera_warning/';
const {MapcamWarnings}=require(base+'mapcam-warnings');
const {NotificationSession}=require(base+'notification-session');
const {CameraVoiceAlerts}=require(base+'voice-alert');
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
const camera={id:'section',warningProfile:'hybrid-v1',lat:56,lon:48,limit:60,mapcamTypeCode:4,mapcamDirectionType:1,
 mapcamApproachHeadingDeg:0,mapcamAngleDeg:60,mapcamWarningDistanceM:500,
 mapcamPath:[[56,48],[56+1000/111320,48]],camera_model:''};
function setup(options={},changes={}){
 let now=100000;const c={...camera,...changes},o={voice:'always',repeat200:true,...options},calls=[];
 const voice={cancel(){},cameraResult:async(stage,relevant)=>{if(relevant())calls.push('approach');return {ok:true};},
 sectionEndResult:async relevant=>{if(relevant())calls.push('end');return {ok:true};}};
 const session=new NotificationSession(voice,()=>o,()=>now),engine=new MapcamWarnings({excessKmh:20});
 let last;
 return {c,o,calls,voice,session,engine,get last(){return last;},
  tick(y,extra={},dt=1000){now+=dt;const fix={lat:56+y/111320,lon:48,speedKmh:72,headingDeg:0,accuracyM:5,timeMs:now,...extra};
   const events=engine.update(fix,[c],now);session.update({...engine.states},fix,engine.heading,events);last={fix,events};return events;},
  advance(ms){now+=ms;}};
}
async function drive(x,end=990){for(let y=-10;y<=end;y+=20){x.tick(y);await flush();}}
async function run(){
 let x=setup();await drive(x);let events=x.tick(1010);await flush();
 assert(events.some(e=>e.endReason==='section-end'&&e.averageControl));
 assert.deepStrictEqual(x.calls,['approach','end'],'Unknown model still has a mapped average-control endpoint');
 x.session.update({},x.last.fix,0,events);await flush();assert.strictEqual(x.calls.filter(c=>c==='end').length,1);
 x.tick(1030);await flush();assert.strictEqual(x.calls.length,2);
 for(const changes of [{mapcamTypeCode:1},{mapcamPath:[],camera_model:'Автодория'}]){
  x=setup({},changes);await drive(x,1030);assert(!x.calls.includes('end'));
 }
 for(const extra of [{accuracyM:30},{lon:48.002}]){
  x=setup();await drive(x);x.tick(1010,extra);await flush();assert(!x.calls.includes('end'),'Invalid exit must stay silent');
 }
 x=setup();await drive(x);x.tick(970);await flush();assert(!x.calls.includes('end'),'U-turn is not endpoint crossing');
 x=setup();await drive(x);x.tick(1010,{},5000);await flush();assert(!x.calls.includes('end'),'GPS gap is not endpoint crossing');
 for(const voice of ['off','speeding']){
  x=setup({voice});await drive(x,1030);assert(!x.calls.includes('end'),'Silent encounter stays silent');
 }
 x=setup({voice:'speeding'});for(let y=-10;y<=990;y+=20){x.tick(y,{speedKmh:90},800);await flush();}
 x.tick(1010,{speedKmh:70});await flush();assert(x.calls.includes('end'),'Previously audible speeding encounter closes even after slowdown');

 // Queue completion behind an in-flight approach; GPS loss and age cancel it.
 for(const cancel of ['none','gps','expired','next']){
  x=setup();let resolve;
  x.voice.cameraResult=()=>new Promise(r=>{resolve=r;});
  await drive(x);events=x.tick(1010);
  if(cancel==='gps')x.session.suspend();
  if(cancel==='expired')x.advance(6000);
  if(cancel==='next')x.session.update({next:{camera:{...camera,id:'next'},distanceM:200,phase:'point',speeding:true}},x.last.fix,0,[]);
  resolve({ok:true});await flush();
  assert.strictEqual(x.calls.includes('end'),cancel==='none','Pending completion: '+cancel);
 }
 let requested=[];const voice=new CameraVoiceAlerts({});
 voice._request=async file=>{requested.push(file);return {ok:false,error:'Unknown action or audio file'};};
 assert.deepStrictEqual(await voice.sectionEndResult(()=>true),{ok:false,retryable:false});
 assert.deepStrictEqual(requested,['average-end.m4a'],'Never fall back to an approaching-camera phrase');
 assert(voice.lastError.includes('0.1.15'));
 const mute=new CameraVoiceAlerts({getVolume:()=>0});assert.deepStrictEqual(await mute.sectionEndResult(()=>true),{ok:true});
 assert.deepStrictEqual(await voice.sectionEndResult(()=>false),{ok:false,skipped:true});
 console.log('PASS: real endpoint, unknown model, once per pass, point/non-average exclusions, invalid GPS/direction, gap, settings, priority, queue expiry, cancellation, mute and legacy component');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
