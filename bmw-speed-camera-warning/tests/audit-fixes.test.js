'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm'),{createRequire}=require('module'),{EventEmitter}=require('events');
const app=path.resolve(__dirname,'../apps/aurelm_speed_camera_warning');
const {MapcamWarnings}=require(path.join(app,'mapcam-warnings'));
const {BackgroundNotification}=require(path.join(app,'background-notification'));
const flush=async()=>{for(let i=0;i<25;i++)await Promise.resolve();};
const camera={id:'test',warningProfile:'hybrid-v1',lat:56,lon:48,limit:60,mapcamTypeCode:4,averageControl:true,mapcamDirectionType:1,mapcamApproachHeadingDeg:0,mapcamAngleDeg:60,mapcamWarningDistanceM:500,mapcamPath:[[56,48],[56+1000/111320,48]]};
const fix=(y,t,speed=72,x=0)=>({lat:56+y/111320,lon:48+x/(111320*Math.cos(56*Math.PI/180)),speedKmh:speed,timeMs:t,accuracyM:5});
async function run(){
 for(const type of [1,2,3,11,13,16,4]){
  const c={...camera,mapcamTypeCode:type,averageControl:type===4},w=new MapcamWarnings({excessKmh:20});
  w.update(fix(-10,1000),[c],1000);w.update(fix(10,2000),[c],2000);
  for(let i=1;i<=8;i++)w.update(fix(10+10*i,2000+1000*i,36),[c],2000+1000*i);
  w.update(fix(90+120/3.6,11000,120),[c],11000);
  assert.equal(w.states.test.useAverage,type===4);assert.equal(w.states.test.speeding,type!==4);
 }
 for(const scenario of ['cross','side','reverse','gap','jump']){
  const w=new MapcamWarnings();w.update(fix(970,1000,180),[camera],1000);w.update(fix(990,2000,180),[camera],2000);
  const f=fix(scenario==='reverse'?890:scenario==='jump'?1990:1090,scenario==='gap'?6000:4000,180,scenario==='side'?100:0);
  const events=w.update(f,[camera],f.timeMs);assert.equal(events.some(e=>e.type==='end'&&e.endReason==='section-end'),scenario==='cross');
 }
 let now=10000;const calls=[];
 const transport={available:true,paint:async e=>calls.push('paint:'+e.camera.id),open:async()=>calls.push('open'),close:async()=>calls.push('close')};
 const popup=new BackgroundNotification(transport,()=>{},()=>now);
 const event=id=>({camera:{id},phase:'point'});
 popup.update(event('A'),80);await popup.pending;now+=3000;popup.update(event('B'),80);await popup.pending;
 assert.deepEqual(calls,['paint:A','open','close','paint:B','open']);
 now+=500;popup.update(event('B'),80);await popup.pending;assert(popup.opened);
 now+=3000;popup.update(event('B'),80);await popup.pending;assert(!popup.opened);

 // Reconnect silence, but do not reconnect every bad-quality/tunnel fix.
 let tick,attempts=0;const callbacks=[];
 const gpsContext={module:{exports:{}},require:n=>n==='oap-sdk'?{someipBuilders:{buildAndInitTypedProxy:async()=>{attempts++;return {updatePosition:{subscribe:async fn=>callbacks.push(fn)}};}}}:require(n),Date:class extends Date{static now(){return now;}},setInterval:fn=>{tick=fn;return 1;},setTimeout,clearTimeout,clearInterval(){}};
 vm.createContext(gpsContext);vm.runInContext(fs.readFileSync(path.join(app,'gps.js'),'utf8'),gpsContext);
 const gps=new gpsContext.module.exports.BmwGps();gps.start();await flush();assert.equal(attempts,1);
 now+=16000;tick();tick();await flush();assert.equal(attempts,2);
 const before=gps.eventsReceived;callbacks[0]({nmeaString:'obsolete'});assert.equal(gps.eventsReceived,before);
 for(let i=0;i<100;i++){now+=1000;callbacks[1]({nmeaString:'invalid'});tick();await flush();}
 assert.equal(attempts,2);gps.stop();now+=120000;tick();await flush();assert.equal(attempts,2);
 gps.start();await flush();assert.equal(attempts,3);callbacks[1]({nmeaString:'late'});assert.equal(gps.eventsReceived,before+100);gps.stop();

 // Real native request dispatcher: disconnect/expiry cancel only unstarted sound.
 const file=path.resolve(__dirname,'../native/bmwcaminfo-voice/voice.js');let handler;
 const server=new EventEmitter();server.listen=()=>{};
 const context={require:n=>n==='./pcm-output'?{MixedOutput:class{clear(){}close(){return Promise.resolve();}}}:n==='fs'?{existsSync:()=>true,unlinkSync(){}}:n==='net'?{createServer:fn=>{handler=fn;return server;}}:createRequire(file)(n),console:{log(){}},Date:class extends Date{static now(){return now;}},process:{on(){},exit(){}},setTimeout,clearTimeout};
 vm.createContext(context);vm.runInContext(fs.readFileSync(file,'utf8'),context);
 const svc=context.voice;svc.mixer=null;let plays=0,release=0,resolveWait;
 svc.connectAudio=async()=>{};svc.release=async()=>{release++;};svc.mp={callMethod:async()=>{plays++;return {EntError:'OK'};}};
 for(const reason of ['disconnect','expiry']){
  svc.waitAvailable=()=>new Promise(r=>{resolveWait=r;});
  const socket=new EventEmitter(),replies=[];socket.setEncoding=()=>{};socket.write=x=>replies.push(JSON.parse(x));handler(socket);
  socket.emit('data',JSON.stringify({action:'play-v3',id:reason,ttlMs:8000,volume:100,file:'camera-500.m4a'})+'\n');await flush();
  if(reason==='disconnect')socket.emit('close');else now+=9000;
  resolveWait();await flush();assert.equal(plays,0);assert(replies.some(r=>r.skipped));assert.equal(svc.speechPending,0);
 }
 let live=true;svc.waitAvailable=async()=>{};svc.connectAudio=async()=>{live=false;};
 const cancelled=await svc.play('camera-500.m4a',100,{live:()=>live});assert(cancelled.skipped);assert.equal(plays,0);assert.equal(release,1,'Release a route acquired just before cancellation');
 svc.connectAudio=async()=>{};
 // Started sound is allowed to finish; never send STOP to the shared player.
 context.setTimeout=fn=>{fn();return 1;};live=true;
 const played=await svc.play('camera-500.m4a',100,{live:()=>live,started:()=>{live=false;}});assert(played.ok);assert.equal(plays,1);

 // Client cancellation closes the waiting request; started playback stays bounded.
 const sockets=[];class Socket extends EventEmitter{setEncoding(){}write(s){this.request=JSON.parse(s);}destroy(){this.destroyed=true;this.emit('close');}}
 const mod={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(app,'voice-alert.js'),'utf8'),{module:mod,require:n=>n==='net'?{createConnection:()=>{const s=new Socket();sockets.push(s);return s;}}:createRequire(path.join(app,'voice-alert.js'))(n),setTimeout,clearTimeout});
 const client=new mod.exports.CameraVoiceAlerts({});let pending=client._request('camera-500.m4a',()=>false),socket=sockets[0];socket.emit('connect');assert.equal(socket.request.action,'play-v3');client.cancel();assert((await pending).skipped);assert(socket.destroyed);
 pending=client._request('camera-500.m4a',()=>false);socket=sockets[1];socket.emit('connect');socket.emit('data',JSON.stringify({event:'started',id:socket.request.id})+'\n');client.cancel();assert(!socket.destroyed);socket.emit('data','{"ok":true}\n');assert((await pending).ok);assert.equal(client.activeRequests.size,0);
 console.log('PASS: average/type separation, endpoint crossing/rejections, popup/HMI timer, GPS silence/restart/stale callbacks, native expiry/disconnect/cancel-after-connect, started audio completion and client cancellation');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
