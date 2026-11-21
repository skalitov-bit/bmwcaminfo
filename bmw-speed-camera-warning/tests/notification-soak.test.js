'use strict';
// Six hours of virtual GPS time; real state machines, mocked audio/transport.
const assert=require('assert'),{EventEmitter}=require('events');
const {MapcamWarnings}=require('../apps/aurelm_speed_camera_warning/mapcam-warnings');
const {NotificationSession}=require('../apps/aurelm_speed_camera_warning/notification-session');
const {OverspeedBeeper,beepState}=require('../apps/aurelm_speed_camera_warning/overspeed-beeper');
const {BackgroundNotification}=require('../apps/aurelm_speed_camera_warning/background-notification');
const flush=async()=>{for(let j=0;j<10;j++)await Promise.resolve();};
async function run(){
 let now=100000,socket,opens=0,closed=0,warnings=0,ends=0,losses=0,restarts=0,maxLedger=0;
 class Socket extends EventEmitter{setEncoding(){}setTimeout(){}write(){}destroy(){if(!this.dead){this.dead=true;closed++;this.emit('close');}}}
 const b=new OverspeedBeeper({now:()=>now,net:{createConnection(){opens++;socket=new Socket();Promise.resolve().then(()=>socket.emit('connect'));return socket;}}});
 const o={voice:'always',repeat200:true,excessKmh:20};
 const voice={cancel(){},cameraResult:async(stage,relevant)=>{if(relevant())warnings++;return {ok:true};},sectionEndResult:async relevant=>{if(relevant())ends++;return {ok:true};}};
 const session=new NotificationSession(voice,()=>o,()=>now),engine=new MapcamWarnings(o);
 const popup=new BackgroundNotification({available:true,paint:async()=>{},open:async()=>{},close:async()=>{}},()=>{},()=>now);
 if(global.gc)global.gc();const before=process.memoryUsage();
 let maxLoopDelayMs=0,loopSamples=0,due=Date.now()+10;
 const sampler=setInterval(()=>{const t=Date.now();maxLoopDelayMs=Math.max(maxLoopDelayMs,t-due);due=t+10;loopSamples++;},10);sampler.unref();
 for(let tick=0;tick<21600;tick++){
  now+=1000;const cycle=Math.floor(tick/80),average=cycle%2===1,y=-500+(tick%80)*22.5;
  const c={id:'c-'+cycle,warningProfile:'hybrid-v1',lat:56,lon:48,limit:60,mapcamTypeCode:average?4:1,averageControl:average,mapcamDirectionType:1,mapcamApproachHeadingDeg:0,mapcamAngleDeg:60,mapcamWarningDistanceM:500,mapcamPath:average?[[56,48],[56+1000/111320,48]]:[]};
  if(tick%337===0){engine.suspend();session.suspend();popup.clear();b.stop();losses++;await flush();continue;}
  const f={lat:56+y/111320,lon:48,speedKmh:81,accuracyM:5,timeMs:now};
  const events=engine.update(f,[c],now);const state=session.update({...engine.states},f,engine.heading,events);
  b.update(beepState(state,f,now,true,session.busy,100));
  popup.update(state?{camera:state.camera,phase:state.phase}:null,81);
  if(tick%601===0&&socket&&!socket.dead){socket.emit('error',new Error('simulated restart'));restarts++;}
  if(tick%3600===0&&!Object.values(engine.states).some(s=>s.phase==='section')){engine.reset();session.clear();}
  await flush();maxLedger=Math.max(maxLedger,session.encounters.size);assert(session.encounters.size<=2);assert(Object.keys(engine.states).length<=1);
  if(tick%1000===0)await new Promise(r=>setImmediate(r));
 }
 b.stop();session.clear();popup.clear();await flush();clearInterval(sampler);if(global.gc)global.gc();const after=process.memoryUsage();
 assert(warnings>100&&ends>50);assert.equal(opens,closed);assert.equal(session.encounters.size,0);assert(!session.busy);
 assert(after.heapUsed-before.heapUsed<16*1048576,'State-machine retained heap growth exceeds 16 MiB');
 console.log(JSON.stringify({virtualHours:6,gpsTicks:21600,warnings,sectionEnds:ends,gpsLosses:losses,audioRestarts:restarts,maxLedger,connections:opens,closed,retainedHeapDeltaMiB:(after.heapUsed-before.heapUsed)/1048576,rssMiB:after.rss/1048576,maxLoopDelayMs,loopSamples,hardwareMocked:true},null,2));
}
run().catch(e=>{console.error(e);process.exitCode=1;});
