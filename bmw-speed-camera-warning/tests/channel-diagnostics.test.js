'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const {ChannelDiagnostics}=require('../native/bmwcaminfo-voice/channel-diagnostics');
async function run(){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'speedcam-channels-')),file=path.join(temp,'route.json');
 try{
  let routes=0,plays=0,failed=false;
  const s={routeSinkId:1024,fileFallback:true,fileFallbackReason:'old failure',mixer:{running:null},init:async()=>{},waitAvailable:async()=>{},
   cc:{getValue:async()=>{throw Error('Not a property');},callMethod:async k=>k==='getListMainSinks'?{amError:'E_OK',listMainSinks:[{sinkID:1024,name:'Media'},{sinkID:1025,name:'Other'},{sinkID:-1,name:'Invalid'}]}:k==='getListMainSources'?{amError:'E_OK',listMainSources:[{sourceID:1046,name:'OapGenericMedia'},{sourceID:100,name:'Radio'}]}:{amError:'E_OK',listConnections:[]}},
   connectAudio:async()=>{assert.equal(routes,0);routes++;},release:async()=>{routes--;},mp:{callMethod:async(n,a)=>{plays++;assert.equal(n,'playFile');assert(a.path.endsWith('both.m4a'));return {EntError:failed?'FAILED':'OK'};}}};
  const d=new ChannelDiagnostics(s,{file,sleep:async()=>{}}),r={sinkID:1025,backend:'file',kind:'both',heard:true,independent:true};
  await assert.rejects(d.test(r),/Scan/);let scan=await d.scan();assert.equal(scan.sinks.length,2);assert.equal(scan.sources.length,2);
  assert.throws(()=>d.save(r),/Run combined/);
  await assert.rejects(d.test({...r,sinkID:100}),/Scan/);assert.equal(plays,0,'Inventory source ID is not a playable output');
  let result=await d.test(r);assert(result.ok);assert.strictEqual(result.audibleConfirmed,false);assert.equal(s.routeSinkId,1024);assert(s.fileFallback);assert.equal(s.fileFallbackReason,'old failure');assert.equal(routes,0);
  assert.throws(()=>d.save({...r,heard:false}),/confirm/);d.save({...r,independent:false});assert.equal(d.saved.independentVolume,'not-confirmed');assert.equal(s.routeSinkId,1025);assert(s.fileFallback);assert.equal(JSON.parse(fs.readFileSync(file)).continuousBeeper,false);
  const reboot={};new ChannelDiagnostics(reboot,{file});assert.equal(reboot.routeSinkId,1025);assert(reboot.fileFallback,'Selected file backend survives restart');
  failed=true;await assert.rejects(d.test(r),/rejected/);assert.equal(routes,0);assert.equal(d.last,null);assert.equal(s.routeSinkId,1025);
  assert.throws(()=>d.save(r),/Run combined/);failed=false;
  const release=s.release;s.release=async()=>{routes--;throw Error('restore failed');};await assert.rejects(d.test(r),/restore failed/);assert.equal(d.last,null);assert(!s.diagnosticBusy);s.release=release;
  s.speechPending=1;await assert.rejects(d.test(r),/busy/);assert.throws(()=>d.reset(),/busy/);s.speechPending=0;
  await assert.rejects(d.test(r,()=>false),/cancelled/);assert.equal(routes,0);assert(!s.diagnosticBusy);
  d.reset();assert.equal(s.routeSinkId,1024);assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).backend,'file');
  await d.test(r);await d.scan();assert.throws(()=>d.save(r),/Run combined/,'Rescan invalidates previous test');
  s.cc.callMethod=async()=>({});scan=await d.scan();assert.equal(scan.sinks.length,0);assert(/missing list/.test(scan.errors.listOfMainSinks));await assert.rejects(d.test(r),/Scan/);
  // Stream failure must not poison the previously working file fallback.
  s.cc.callMethod=async k=>k==='getListMainSinks'?{listMainSinks:[{sinkID:1025}]}:k==='getListMainSources'?{listMainSources:[{sourceID:1046}]}:{listConnections:[]};await d.scan();s.fileFallback=true;s.fileFallbackReason='keep';
  d.makeMixer=adapter=>({set(){},clear(){},speak:async()=>{adapter.lastError='PCM blocked';return {ok:false,error:'PCM blocked'};},close:async()=>{}});
  await assert.rejects(d.test({...r,backend:'pcm'}),/PCM blocked/);assert(s.fileFallback);assert.equal(s.fileFallbackReason,'keep');assert.equal(d.last,null);
  d.makeMixer=()=>({set(){},clear(){},speak:async()=>({ok:true}),close:async()=>{}});
  await d.test({...r,backend:'pcm'});d.save({...r,backend:'pcm',independent:false});
  const pcmReboot={};new ChannelDiagnostics(pcmReboot,{file});assert.equal(pcmReboot.audioBackend,'pcm-fifo');assert(!pcmReboot.fileFallback);assert.equal(pcmReboot.routeSinkId,1025);
  let finish;d.sleep=()=>new Promise(resolve=>{finish=resolve;});const pending=d.test(r);while(!finish)await new Promise(resolve=>setImmediate(resolve));
  await assert.rejects(d.test(r),/busy/);assert(s.diagnosticBusy);await d.handle({action:'audio-stop'});finish();await assert.rejects(pending,/cancelled/);assert(!s.diagnosticBusy);assert.equal(routes,0);
  console.log('PASS channel diagnostics: discovery, validation, restoration, file/stream failures, exclusive tests, cancel, explicit confirmation, persistence. BMW mocked.');
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
