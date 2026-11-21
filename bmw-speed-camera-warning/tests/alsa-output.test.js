'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os');
const {EventEmitter}=require('events');const {Writable}=require('stream');
const {AlsaOutput}=require('../native/bmwcaminfo-voice/alsa-output');
const {AudioOutput}=require('../native/bmwcaminfo-voice/audio-output');
const {ChannelDiagnostics}=require('../native/bmwcaminfo-voice/channel-diagnostics');
function fixture(options){
 const o=options||{},s={},owner={},calls=[];let clock=0,output,child,writes=0,closed=false,starts=0;
 const pulse=Buffer.alloc(24000);for(let i=0;i<pulse.length/2;i++)pulse.writeInt16LE(1000,i*2);
 const pcm=Buffer.alloc(4800);for(let i=0;i<pcm.length/2;i++)pcm.writeInt16LE(2000,i*2);
 const route={withRoute:async(kind,alive,stream)=>{calls.push('acquire');try{if(o.routeError)throw Error('route busy');return await stream();}finally{calls.push('release');}}};
 const spawn=(bin,args)=>{
  assert.deepStrictEqual(args,[o.converter?'--stream-converter':o.overlay?'--stream-overlay':'--stream']);starts++;child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();
  child.kill=()=>{if(!closed){closed=true;setImmediate(()=>child.emit('close',1,'SIGTERM'));}};
  child.stdin=new Writable({write(chunk,encoding,callback){
   assert.equal(chunk.length,o.converter?960:3840);clock+=20;writes++;
   if(o.telemetry&&writes===1){clock+=100;child.stderr.emit('data','SPEEDCAM_BUF');child.stderr.emit('data','FER {"bufferParamsKnown":true,"bufferMs":64,"bufferFrames":1536,"periodFrames":480,"underruns":1,"recoveries":1}\n');}
   if(o.long&&clock<60000)output.set({cameraId:'long',intervalMs:300,volume:40},owner);else output.clear(owner);
   if(o.onWrite)o.onWrite(clock,output,chunk);
   if(o.failure&&writes===3)return callback(Error('simulated write failure'));
   if(o.stall)return;setImmediate(callback);
  },final(callback){callback();closed=true;setImmediate(()=>{child.stdout.emit('data',JSON.stringify({streamCompleted:true,framesWritten:writes*960,pendingFrames:0,audibleConfirmed:false,rate:24000,channels:1,device:'plug:smartx:Media_Overlay_Converter_Source_CF_24_MONO'}));child.emit('close',0);});}});
  return child;
 };
 output=new AlsaOutput(s,{root:'.',route,spawn,overlay:o.overlay,converter:o.converter,now:()=>clock,measure:()=>clock,read:n=>/^beeper-choice-[1-8]\.pcm$/.test(n)?pulse:pcm});
 return {s,output,calls,owner,stats:()=>({clock,writes,starts}),start:()=>output.set({cameraId:'long',intervalMs:300,volume:40},owner)};
}
async function run(){
 let monitored=fixture({converter:true,overlay:true,telemetry:true,failure:true});await monitored.output.speak('camera-500.m4a',60,{live:()=>true});await monitored.output.running;
 const evidence=monitored.s.audioBufferHistory;assert.equal(evidence.total,1);assert.equal(evidence.streams[0].origin,'runtime');assert.equal(evidence.lastFailure.native.underruns,1);assert.equal(evidence.lastFailure.native.bufferMs,64);assert(evidence.lastFailure.maxWriteCallbackMs>=120);assert(evidence.lastFailure.writeCallbacksOver64Ms>0);assert(!evidence.lastFailure.error.includes('SPEEDCAM_BUFFER'),'Telemetry must not mask the playback error');
 assert(evidence.lastFailure.pcmSignal.frames>0,'Signal metrics must survive process close');
 let f=fixture({long:true});f.start();const p=f.output.speak('camera-500.m4a',60,{live:()=>true});assert((await p).ok);await f.output.running;
 assert(f.stats().clock>60000,'stream must outlast 12-second probe cap');assert.deepStrictEqual(f.calls,['acquire','release']);assert.equal(f.stats().starts,1);assert(!f.s.lastError);await f.output.close();
 f=fixture({overlay:true});assert((await f.output.speak('camera-500.m4a',60,{live:()=>true})).ok);await f.output.running;assert.equal(f.stats().starts,1);
 for(const overlay of [false,true]){f=fixture({converter:true,overlay,long:true});f.start();assert((await f.output.speak('camera-500.m4a',60,{live:()=>true})).ok);await f.output.running;assert(f.stats().clock>60000);assert.equal(f.stats().starts,1);assert(!f.s.lastError);await f.output.close();}
 let ducked=false,tail=false;
 f=fixture({converter:true,onWrite:(clock,out)=>{if(clock===20)out.speak('camera-500.m4a',60,{live:()=>true});if(clock>=60&&out.core.gain<.9)ducked=true;if(clock>100&&out.core.tails.length)tail=true;}});
 f.start();await f.output.running;assert(ducked,'voice ducks pulse');assert(tail,'cleared pulse plays tail');
 f=fixture({failure:true});const error=await f.output.speak('camera-500.m4a',60,{live:()=>true});await f.output.running;assert(!error.ok);assert(/failure/.test(f.s.lastError));assert.equal(f.stats().starts,1,'no automatic replay');assert.deepStrictEqual(f.calls,['acquire','release']);
 f=fixture({routeError:true});const blocked=await f.output.speak('camera-500.m4a',60,{live:()=>true});await f.output.running;assert(!blocked.ok);assert.equal(f.stats().starts,0);
 f=fixture({stall:true});const pending=f.output.speak('camera-500.m4a',60,{live:()=>true});while(!f.stats().starts)await new Promise(r=>setImmediate(r));await f.output.close();assert(!(await pending).ok);assert.deepStrictEqual(f.calls,['acquire','release']);
 f=fixture();const expired=await f.output.speak('camera-500.m4a',40,{live:()=>false});await f.output.running;assert(expired.skipped);assert.equal(f.stats().starts,0);
 // Persist ALSA only after an explicit heard-both confirmation, and retain M4A reset.
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alsa-selection-')),file=path.join(dir,'audio-route.json');
 const s={mixer:{running:null},init:async()=>{},cc:{callMethod:async m=>m==='getListMainSources'?{listMainSources:[{sourceID:287}]}:m==='getListMainSinks'?{listMainSinks:[{sinkID:1024}]}:{listConnections:[]}}},alsa={scan:async()=>({available:true}),test:async()=>({ok:true}),stop(){}};
 const d=new ChannelDiagnostics(s,{file,alsa});await d.scan();assert.throws(()=>d.save({backend:'alsa',sinkID:1024,heard:true}),/Run combined/);
 await d.test({backend:'alsa',sinkID:1024,kind:'both'},()=>true);d.save({backend:'alsa',sinkID:1024,heard:true,independent:false});assert.equal(s.audioBackend,'alsa');assert.equal(s.fileFallback,false);assert.equal(d.saved.independentVolume,'not-confirmed');
 const s2={};new ChannelDiagnostics(s2,{file,alsa});assert.equal(s2.audioBackend,'alsa');d.reset();assert(s.fileFallback);
 const s3={};new ChannelDiagnostics(s3,{file,alsa});assert(s3.fileFallback,'M4A rollback survives restart');fs.unlinkSync(file);fs.rmdirSync(dir);
 const svc={audioBackend:'alsa'},mux=new AudioOutput(svc,{read:()=>Buffer.alloc(100)});assert.equal(mux.current,mux.alsa);svc.audioBackend='pcm-fifo';assert.equal(mux.current,mux.fifo);await mux.close();
 console.log('PASS ALSA runtime: 60s stream, voice/beeper ducking and tail, failures without replay, route refusal, shutdown, expired voice, persisted ALSA selection and M4A reset. BMW/ALSA mocked.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
