'use strict';
const assert=require('assert');
const {AlsaDiagnostics,stereo48}=require('../native/bmwcaminfo-voice/alsa-diagnostics');
const {ChannelDiagnostics}=require('../native/bmwcaminfo-voice/channel-diagnostics');
function fixture(){
 const calls=[],routes=[];let available={availability:'A_UNAVAILABLE',availabilityReason:7};
 const s={fileFallback:true,fileFallbackReason:'working M4A',routeSinkId:1024,init:async()=>{},mixer:{running:null},
  cc:{getValue:async()=>{throw Error('Not a BMW property');},
   callMethod:async(method,args)=>{
    if(method==='getListMainSources')return {amError:'E_OK',listMainSources:[{sourceID:287,name:'CarLifeMedia',availability:available}]};
    if(method==='getListMainSinks')return {amError:'E_OK',listMainSinks:[{sinkID:1024}]};
    if(method==='getListMainConnections')return {amError:'E_OK',listConnections:routes.slice()};
    calls.push([method,args]);if(method==='connect'){routes.push({sourceID:287,sinkID:1024,mainConnectionID:42,connectionState:'CS_CONNECTED'});return {amError:'E_OK',mainConnectionID:42};}routes.splice(0);return {amError:'E_OK'};}},
  createRoutingObserver:async()=>({callMethod:async(method,args)=>{calls.push([method,args]);available=args.availability;}})};
 const d=new AlsaDiagnostics(s,{sleep:async()=>{},exec:(bin,args,opts,cb)=>cb(null,'{"library":true}','')});
 d.stream=async kind=>{calls.push(['stream',kind]);return {streamCompleted:true,framesWritten:384000,pendingFrames:0};};
 return {s,d,calls,routes,availability:()=>available,setAvailability:v=>{available=v;}};
}
async function run(){
 let f=fixture();const result=await f.d.test('both',()=>true);
 assert(result.ok);assert.strictEqual(result.audibleConfirmed,false);assert.equal(result.alsa.independentVolume,'not-confirmed');
 assert.equal(f.s.fileFallback,true);assert.equal(f.s.fileFallbackReason,'working M4A');assert.equal(f.routes.length,0);
 assert.deepStrictEqual(f.availability(),{availability:'A_UNAVAILABLE',availabilityReason:7});
 assert.deepStrictEqual(f.calls.map(c=>c[0]),['hookSourceAvailablityStatusChange','connect','stream','disconnect','hookSourceAvailablityStatusChange']);
 assert.deepStrictEqual(f.calls[1][1],{sourceID:287,sinkID:1024});
 f=fixture();f.setAvailability({availability:'A_AVAILABLE'});await assert.rejects(f.d.test('both',()=>true),/refused/);assert(!f.calls.length);
 f=fixture();f.routes.push({sourceID:287,sinkID:1024,mainConnectionID:8});await assert.rejects(f.d.test('both',()=>true),/busy/);assert(!f.calls.length);
 f=fixture();const original=f.s.cc.callMethod;f.s.cc.callMethod=async(m,a)=>m==='getListMainConnections'?{}:original(m,a);
 await assert.rejects(f.d.test('both',()=>true),/missing list/);assert(!f.calls.length,'Unknown routes must not be treated as idle');assert(/missing list/.test(f.d.last.error));
 f=fixture();f.d.stream=async()=>{throw Error('ALSA stream stalled');};await assert.rejects(f.d.test('both',()=>true),/stalled/);assert.equal(f.routes.length,0);assert.equal(f.availability().availability,'A_UNAVAILABLE');assert(f.s.fileFallback);
 f=fixture();await assert.rejects(f.d.test('both',()=>false),/cancelled/);assert(!f.calls.length);
 f=fixture();const call=f.s.cc.callMethod;f.s.cc.callMethod=async(m,a)=>{const r=await call(m,a);if(m==='connect')throw Error('late connect timeout');return r;};
 await assert.rejects(f.d.test('both',()=>true),/timeout/);assert.equal(f.routes.length,0);assert.equal(f.availability().availability,'A_UNAVAILABLE');
 f=fixture();f.d.exec=(b,a,o,cb)=>cb(Error('ENOENT'),'','');await assert.rejects(f.d.test('voice',()=>true),/ALSA helper/);assert(!f.calls.length);assert(!(await f.d.scan()).available);
 f=fixture();const parent=new ChannelDiagnostics(f.s,{alsa:f.d,file:'no-saved-alsa-profile'});let finish;
 f.d.stream=()=>new Promise(resolve=>{finish=resolve;});const pending=parent.handle({action:'audio-test',backend:'alsa',kind:'both'},()=>!parent.cancelled);
 while(!finish)await new Promise(resolve=>setImmediate(resolve));assert(f.s.diagnosticBusy);
 await assert.rejects(parent.test({backend:'alsa',kind:'voice'}),/busy/);
 assert.throws(()=>parent.save({backend:'alsa',sinkID:1024}),/busy/);
 await parent.handle({action:'audio-stop'});finish({streamCompleted:true});await assert.rejects(pending,/cancelled/);assert(!f.s.diagnosticBusy);assert(f.s.fileFallback);assert(!parent.active);
 assert.throws(()=>parent.save({backend:'alsa',sinkID:1024}),/Scan/,'ALSA must not become the persistent audio backend');
 const pcm=Buffer.alloc(4);pcm.writeInt16LE(1000,0);pcm.writeInt16LE(3000,2);const out=stereo48(pcm);
 assert.deepStrictEqual(Array.from({length:8},(_,i)=>out.readInt16LE(i*2)),[1000,1000,2000,2000,3000,3000,3000,3000]);
 console.log('PASS ALSA: manual route, occupied-source refusal, failure/timeout cleanup, M4A preservation, exclusive/cancel lifecycle, no persistent ALSA selection, PCM conversion. BMW/ALSA mocked.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
