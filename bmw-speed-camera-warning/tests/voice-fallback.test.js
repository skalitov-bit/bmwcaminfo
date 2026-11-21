'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const native=path.resolve(__dirname,'../native/bmwcaminfo-voice');
const {MixedOutput}=require(native+'/pcm-output');
const source=fs.readFileSync(native+'/voice.js','utf8');
const manifest=require(native+'/audio-manifest.json');
let now=10000;const waits=[];
const context={require:n=>n==='fs'?{existsSync:()=>true}:n==='./audio-manifest.json'?manifest:require(n),
 Date:class extends Date{static now(){return now;}},console:{log(){}},
 setTimeout:(fn,ms)=>{waits.push(ms);fn();}};
vm.createContext(context);vm.runInContext(source.slice(0,source.indexOf('var voice = new VoiceService();')),context);
const pcm=Buffer.alloc(960,1);
function service(options={}){
 const v=new context.VoiceService(),calls=[];let active=0;
 v.waitAvailable=async()=>{};v.connectAudio=async()=>{assert.equal(active,0,'No overlapping routes');active++;};
 v.release=async()=>{assert.equal(active,1);active--;};
 v.mp={callMethod:async(name,args)=>{calls.push(args.path.replace(/\\/g,'/'));return {EntError:options.rejectFile&&args.path.endsWith('.m4a')?'FAILED':'OK'};}};
 v.mixer=new MixedOutput(v,{now:()=>now,read:()=>pcm,makeSink:()=>({open:async()=>'/run/test.wav',write:async()=>{
  if(options.expire)now+=9000;
  const e=Error('BMW decoder did not consume PCM stream');e.code=options.generic?'OTHER':'PCM_NOT_CONSUMED';throw e;
 },close(){}})});
 return {v,calls,active:()=>active};
}
async function run(){
 let s=service(),starts=0;
 let r=await s.v.play('strelka.m4a',80,{live:()=>true,started:()=>starts++});
 assert(r.ok);assert(s.v.fileFallback);assert.equal(s.calls.length,2);assert(s.calls[1].endsWith('/audio/volume-80/strelka.m4a'));
 assert.equal(starts,1,'One started event across retry');assert.equal(s.active(),0);assert.equal(s.v.lastError,null);
 assert.throws(()=>s.v.mixer.set({cameraId:'c',intervalMs:300,volume:100},{}),/Beeper unavailable/);
 r=await s.v.play('camera-200.m4a',100,{live:()=>true});assert(r.ok);assert.equal(s.calls.length,3);assert(s.calls[2].endsWith('/audio/camera-200.m4a'));
 assert(!s.calls.slice(1).some(p=>p==='/run/test.wav'),'Known failed FIFO is not reopened');
 s=service({expire:true});r=await s.v.play('strelka.m4a',100,{live:()=>true});assert(r.skipped);assert.equal(s.calls.length,1,'No stale fallback');
 s=service({rejectFile:true});r=await s.v.play('strelka.m4a',100,{live:()=>true});assert(!r.ok);assert.match(r.error,/rejected audio/);assert.equal(s.active(),0);
 s=service({generic:true});r=await s.v.play('strelka.m4a',100,{live:()=>true});assert(!r.ok);assert(!s.v.fileFallback);assert.equal(s.calls.length,1,'Do not hide unrelated transport errors');
 // A beeper can discover the incompatible FIFO before the first voice request.
 s=service();s.v.mixer.set({cameraId:'c',intervalMs:300,volume:100},{});await s.v.mixer.running;
 assert(s.v.fileFallback);r=await s.v.play('strelka.m4a',100,{live:()=>true});assert(r.ok);assert.equal(s.calls.length,2);
 // Successful stream remains the normal mixed path, without a second playFile.
 s=service();s.v.mixer={speak:async()=>({ok:true})};r=await s.v.play('strelka.m4a',100);assert(r.ok);assert.equal(s.calls.length,0);
 console.log('PASS: FIFO no-consumer failure -> regular M4A retry, gain asset, single start, route cleanup, no stale retry, no false success, no repeated FIFO; hardware not tested.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
