'use strict';
const assert=require('assert');
const base='../apps/aurelm_speed_camera_warning/';
const {NotificationSession,selectRadar}=require(base+'notification-session');
const {RoadGuidanceWarnings}=require(base+'road-guidance');
const {CameraVoiceAlerts}=require(base+'voice-alert');
const {gpsHealth}=require(base+'notification-rules');
const {pointHit}=require(base+'mapcam-warnings');
const c={id:'test',lat:55,lon:37,limit:60,source:'MapCam.info',mapcamDirectionType:0,mapcamWarningDistanceM:500,mapcamAngleDeg:60};
const fix=(d,t=Date.now(),speed=81)=>({lat:55-d/111320,lon:37,speedKmh:speed,headingDeg:0,accuracyM:5,timeMs:t});
const state=(d,camera=c,extra={})=>Object.assign({camera,distanceM:d,phase:'point',speeding:true,speedKmh:81},extra);
const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
function setup(options){
 let now=Date.now();const o=Object.assign({voice:'always',repeat200:true,distanceM:0},options),calls=[];
 const voice={cancel(){},cameraResult:async(stage,relevant,camera)=>{if(!relevant())return {ok:false,skipped:true};calls.push({stage,id:camera.id});return {ok:true};}};
 const session=new NotificationSession(voice,()=>o,()=>now);
 return {session,voice,calls,o,advance(ms){now+=ms;},update(d,states,heading=0){return session.update(states||{test:state(d)},fix(d,now),heading);}};
}
async function run(){
 let x=setup();x.update(500);await flush();assert.deepStrictEqual(x.calls,[{stage:1,id:'test'}]);
 for(let d=480;d>=220;d-=20){x.advance(1000);x.update(d);await flush();}
 assert.strictEqual(x.calls.length,1);
 x.advance(1000);x.update(200);await flush();assert.deepStrictEqual(x.calls.map(x=>x.stage),[1,2]);
 x.advance(1000);x.update(180);await flush();assert.strictEqual(x.calls.length,2,'Repeat plays once per approach');
 x.update(-150,{});x.advance(1000);x.update(450);await flush();assert.strictEqual(x.calls.length,3,'A new pass must speak immediately, without a time lockout');

 x=setup();x.update(500);await flush();x.session.suspend();x.advance(1000);x.update(480);await flush();
 assert.strictEqual(x.calls.length,1,'GPS reconnection is not a second physical pass');
 x.update(-40,{});x.advance(1000);x.update(-50,{test:state(50)},180);await flush();
 assert.strictEqual(x.calls.length,2,'A confirmed U-turn is a new approach even within 100m');

 x=setup({repeat200:false});x.update(500);await flush();x.advance(10000);x.update(190);await flush();assert.strictEqual(x.calls.length,1);
 x=setup();x.update(190);await flush();x.advance(10000);x.update(160);await flush();assert.strictEqual(x.calls.length,1,'Do not double-announce a late first detection');
 x=setup();x.update(500);await flush();x.advance(10000);x.update(140);await flush();assert.deepStrictEqual(x.calls.map(x=>x.stage),[1,1],'A late repeat must not claim 200m');
 x=setup();x.update(500);await flush();x.advance(10000);x.update(190,{test:state(190,c,{phase:'section',useAverage:true})});await flush();assert.strictEqual(x.calls.length,1,'No approach recording at 200m to section end');

 for(const source of ['MapCam.info','еСтрелка','local-user']){
  const camera=Object.assign({},c,{source});x=setup({voice:'off'});x.update(450,{test:state(450,camera)});await flush();assert(!x.calls.length);
  x.o.voice='speeding';x.update(440,{test:state(440,camera,{speeding:false})});await flush();assert(!x.calls.length);
  x.update(430,{test:state(430,camera,{speeding:true})});await flush();assert.strictEqual(x.calls.length,1);
 }

 x=setup();let tries=0;
 x.voice.cameraResult=async()=>{tries++;return {ok:false,retryable:true};};
 x.update(500);await flush();x.advance(1000);x.update(480);await flush();assert.strictEqual(tries,1);
 x.advance(1000);x.update(460);await flush();assert.strictEqual(tries,2);
 x.advance(10000);x.update(440);await flush();assert.strictEqual(tries,2,'At most one retry before playback');
 assert(!x.session.encounters.get('test').stages[1].done,'A failed request is never marked played');
 x=setup();tries=0;x.voice.cameraResult=async()=>{tries++;return {ok:false,retryable:false};};
 x.update(500);await flush();x.advance(10000);x.update(200);await flush();assert.strictEqual(tries,1,'Unknown playback result is never retried');

 x=setup();let complete;
 x.voice.cameraResult=(stage,relevant,camera)=>{x.calls.push({stage,id:camera.id});return new Promise(r=>complete=r);};
 const far=Object.assign({},c,{id:'far'}),near=Object.assign({},c,{id:'near'});
 x.update(450,{far:state(450,far),near:state(250,near)});assert.strictEqual(x.calls[0].id,'near');
 x.update(300,{far:state(300,far)});assert.strictEqual(x.calls.length,1,'Do not enqueue an obsolete distance-ordered backlog');
 complete({ok:true});await flush();x.update(280,{far:state(280,far)});assert.strictEqual(x.calls[1].id,'far');complete({ok:true});await flush();

 const f=fix(500),ahead=Object.assign({},c,{id:'ahead'}),behind=Object.assign({},c,{id:'behind',lat:f.lat-.001});
 assert.strictEqual(selectRadar(state(500,ahead),[behind,ahead],f,0,null).camera.id,'ahead');
 assert.strictEqual(selectRadar(null,[behind,ahead],f,0,null).camera.id,'ahead');
 assert.strictEqual(selectRadar(null,[behind],f,0,null),null);
 assert.strictEqual(selectRadar(null,[ahead],f,null,null),null);
 assert.strictEqual(selectRadar(null,[ahead],Object.assign({},f,{timeMs:Date.now()-4000}),0,null),null);
 assert.strictEqual(gpsHealth(null,Date.now()),'НЕТ GPS');
 assert.strictEqual(gpsHealth(Object.assign({},f,{accuracyM:30}),Date.now()),'НИЗКАЯ ТОЧНОСТЬ GPS');
 assert.strictEqual(gpsHealth(Object.assign({},f,{timeMs:Date.now()-4000}),Date.now()),'НЕТ GPS');

 // Use the actual local-road detector, not handcrafted UI flags.
 const local=Object.assign({},c,{id:'local-test',source:'local-user'}),zone={id:local.id,lat:55,lon:37,roads:[{id:'r',pts:[[0,-1500],[0,1500]],camM:1500,dir:1}]};
 const engine=new RoadGuidanceWarnings([zone],{distanceM:1000,excessKmh:20});
 engine.update(fix(820,1000,80),[local],1000);engine.update(fix(800,2000,80),[local],2000);
 assert(engine.states[local.id]);assert.strictEqual(engine.states[local.id].camera,local);assert.strictEqual(engine.states[local.id].speedKmh,80);assert.strictEqual(engine.states[local.id].speeding,false);
 engine.update(fix(780,3000,81),[local],3000);assert(engine.states[local.id].speeding);
 engine.update(fix(760,4000,78),[local],4000);assert(!engine.states[local.id].speeding);
 engine.configure({distanceM:500});engine.update(fix(820,5000),[local],5000);engine.update(fix(800,6000),[local],6000);assert(!engine.states[local.id]);

 const voice=new CameraVoiceAlerts({});voice._request=async()=>{throw Object.assign(new Error('connection refused'),{retryable:true});};
 assert.deepStrictEqual(await voice.cameraResult(1,()=>true,c),{ok:false,retryable:true});
 voice._request=async()=>{throw new Error('timeout after sending');};
 assert.deepStrictEqual(await voice.cameraResult(1,()=>true,c),{ok:false,retryable:false});
 assert.deepStrictEqual(await voice.cameraResult(1,()=>false,c),{ok:false,skipped:true});
 assert(!pointHit(Object.assign({},c,{lon:37+160/(111320*Math.cos(55*Math.PI/180))}),fix(400),0,60,500));
 console.log('PASS: per-pass speech, GPS recovery, U-turn, 200m option, late detection, section end, all-source voice settings, bounded retry, uncertain playback, visual/voice priority, forward Radar, GPS health, local speed/distance and socket outcomes');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
