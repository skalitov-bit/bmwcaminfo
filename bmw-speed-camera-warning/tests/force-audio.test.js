'use strict';
const assert=require('assert'),path=require('path');
const base='../apps/aurelm_speed_camera_warning/';
const {NotificationSession}=require(base+'notification-session');
const {cameraVoiceFile}=require(base+'voice-alert');
const {beepState}=require(base+'overspeed-beeper');
const {AudioDiagnostics}=require(base+'audio-diagnostics');
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const now=Date.now(),fix={lat:55,lon:37,speedKmh:40,accuracyM:5,timeMs:now};
const camera=(id,extra)=>Object.assign({id,lat:55.004,lon:37,mapcamTypeCode:1,limit:60},extra);
const state=c=>({camera:c,distanceM:450,phase:'point',speeding:false});
const speed=camera('speed'),dummy=camera('dummy',{camera_family:'dummy',limit:0}),police=camera('police',{typeNamespace:'mapcam',typeCode:8,mapcamTypeCode:8,limit:0}),unknown=camera('unknown',{limit:null});
async function run(){
 const options={forceAudio:true,voice:'off',repeat200:false},calls=[];
 const voice={cancel(){},cameraResult:async(stage,relevant,c,forced)=>{assert(relevant());calls.push({id:c.id,file:cameraVoiceFile(stage,c,forced)});return {ok:true};}};
 const session=new NotificationSession(voice,()=>options,()=>now),states={speed:state(speed),dummy:state(dummy),police:state(police),unknown:state(unknown)};
 session.update(states,fix,0,[]);await flush();
 assert.equal(calls.length,4);assert(calls.every(c=>c.file));assert.equal(new Set(calls.map(c=>c.id)).size,4);
 session.update(states,fix,0,[]);await flush();assert.equal(calls.length,4,'No endless speech loop while stopped near the same points');
 for(const s of Object.values(states)){
  assert(beepState(s,fix,now,true,false,60,true),'All detected types beep below limit');
  assert.equal(beepState(s,fix,now,true,false,60,false),null);
 }
 assert.equal(beepState(state(speed),Object.assign({},fix,{timeMs:now-4000}),now,true,false,60,true),null);
 assert.equal(beepState(Object.assign(state(speed),{phase:'rear'}),fix,now,true,false,60,true),null);
 assert.equal(beepState(null,fix,now,true,false,60,true),null);
 assert.equal(beepState(state(speed),fix,now,false,false,60,true),null);
 assert.equal(cameraVoiceFile(1,dummy),null);assert.equal(cameraVoiceFile(1,dummy,true),'camera-500.m4a');
 options.forceAudio=false;session.clear();session.update(states,fix,0,[]);await flush();assert.equal(calls.length,4,'Voice off applies again');
 options.voice='speeding';session.update(states,fix,0,[]);await flush();assert.equal(calls.length,4,'Normal speeding threshold restored');
 options.forceAudio=true;session.clear();session.update({rear:Object.assign(state(speed),{phase:'rear'})},fix,0,[]);await flush();assert.equal(calls.length,4,'No passed/rear warning');
 session.clear();session.update(states,Object.assign({},fix,{timeMs:now-4000}),0,[]);await flush();assert.equal(calls.length,4,'No invented alerts on stale GPS');
 // Slow/zero speed does not suppress audio for an already detected live approach.
 session.clear();session.update({speed:state(speed)},Object.assign({},fix,{speedKmh:0}),0,[]);await flush();assert.equal(calls.length,5);
 // Queue is reevaluated after speech: a disappeared second point is never spoken.
 let done,active=0,maxActive=0;const ordered=[];
 const delayed=new NotificationSession({cancel(){},cameraResult:(stage,relevant,c)=>{active++;maxActive=Math.max(maxActive,active);ordered.push(c.id);return new Promise(resolve=>{done=()=>{active--;resolve({ok:true});};});}},()=>options,()=>now);
 delayed.update({speed:state(speed),unknown:state(unknown)},fix,0,[]);assert.equal(ordered.length,1);
 delayed.update({speed:state(speed)},fix,0,[]);done();await flush();assert.equal(ordered.length,1);assert.equal(maxActive,1);
 // Toggling the persistent option invalidates unsent diagnostic requests.
 let relevance,finish;const cancelSession=new NotificationSession({cancel(){},cameraResult:(st,r)=>{relevance=r;return new Promise(resolve=>finish=resolve);}},()=>options,()=>now);
 cancelSession.update({speed:state(speed)},fix,0,[]);assert(relevance());options.forceAudio=false;assert(!relevance());finish({ok:false,skipped:true});await flush();
 let stored='off';const uiOptions={getForceAudio:()=>stored==='on',setForceAudio:on=>{stored=on?'on':'off';}};
 const ui=new AudioDiagnostics(()=>{},uiOptions);ui.backend='converter';ui.overlay=true;
 const targets=[],cv={fillRect(){},strokeRoundRect(){},line(){}},style={colors:{},text(){},heading(){},drawSelection(){}};
 ui.draw(cv,style,(cv,x,y,w,h,run,key)=>targets.push({x,y,w,h,run,key}));
 const force=targets.find(t=>t.key==='audio-force-notifications'),overlay=targets.find(t=>t.key==='audio-overlay');assert(force&&overlay);assert(overlay.x+overlay.w<=force.x);
 force.run();assert.equal(stored,'on');assert(ui.forceAudio());assert(ui.overlay&&ui.backend==='converter');
 const reopened=new AudioDiagnostics(()=>{},uiOptions);assert(reopened.forceAudio(),'Checkbox reads persisted option on recreation');
 ui.tap(force.x+2,force.y+2);assert.equal(stored,'off');assert(!ui.forceAudio());
 ui.busy=true;ui.toggleForceAudio();assert.equal(stored,'off');
 const app=require(base+'app.json');assert.equal(app.settings.find(s=>s.key==='audio_force_notifications').default,'off');
 console.log('PASS force audio: every live approach serialized, voice off/speed/type/limit/dummy bypass; no repeats/stale GPS/rear/vanished candidates; normal rules restored; independent persistent checkbox and touch/controller targets; route untouched');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
