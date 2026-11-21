'use strict';
const assert=require('assert');
const {AudioDiagnostics}=require('../apps/aurelm_speed_camera_warning/audio-diagnostics');
const scan={ok:true,sinks:[{id:1024}],alsa:{available:true},converter:{available:true},errors:{}};
async function run(){
 const d=new AudioDiagnostics(()=>{}),calls=[];
 d.request=async r=>{calls.push(r);return r.action==='audio-scan'?scan:r.action==='audio-save'?{ok:true,saved:{backend:r.backend,sinkID:r.sinkID}}:{ok:true};};
 for(const backend of ['converter','alsa','file']){
  await d.testMode(backend);assert.deepStrictEqual(calls.slice(-2),[{action:'audio-scan'},{action:'audio-test',sinkID:1024,backend,kind:'both'}]);assert(!d.busy);
 }
 assert(!calls.some(r=>/save|reset/.test(r.action)),'Tests must not persist a new audio mode');
 const cv={fillRect(){},strokeRoundRect(){}},targets=[];
 d.draw(cv,{colors:{},text(){},heading(){},drawSelection(){}},(cv,x,y,w,h,run,key)=>targets.push(key));
 assert.deepStrictEqual(targets,['audio-overlay','audio-converter','audio-alsa','audio-file','audio-pulse','audio-converter-hold','audio-converter-reset','audio-converter-period','audio-save','audio-report-phone','audio-mixer']);
 await d.saveMode();assert(!calls.some(r=>r.action==='audio-save'),'Explicit confirmation required');
 d.askSave();assert(d.confirming);await d.saveMode();assert.equal(calls.slice(-1)[0].action,'audio-save');assert.equal(calls.slice(-1)[0].backend,'file');assert.strictEqual(calls.slice(-1)[0].independent,false);assert(!d.confirmable);
 for(const backend of ['converter','alsa']){await d.testMode(backend);d.askSave();await d.saveMode();assert.equal(calls.slice(-1)[0].backend,backend);}
 await d.testMode('converter');d.askSave();d.request=async()=>{throw Error('write failed');};await d.saveMode();assert(d.message.includes('write failed'));assert(!d.confirmable);
 let finish;calls.length=0;d.request=r=>{calls.push(r);return new Promise(resolve=>{finish=resolve;});};
 const pending=d.testMode('converter');await d.testMode('alsa');assert.equal(calls.length,1,'No overlapping probes');
 d.stop();finish(scan);await pending;assert.equal(calls.length,1,'Leaving during scan must not start playback');
 d.request=async r=>r.action==='audio-scan'?scan:Promise.reject(Error('decoder rejected stream'));
 await d.testMode('converter');assert(d.message.includes('decoder rejected stream'));const error=d.message;d.stop();assert.equal(d.message,error);
 calls.length=0;d.request=async r=>{calls.push(r);return {sinks:[],errors:{sinks:'BMW inventory failed'},alsa:{available:false,error:'missing helper'}};};
 await d.testMode('file');assert(d.message.includes('BMW inventory failed'));assert.equal(calls.length,1);
 await d.testMode('alsa');assert(d.message.includes('missing helper'));assert.equal(calls.length,2);
 d.request=async r=>r.action==='audio-scan'?scan:new Promise(resolve=>{finish=resolve;});
 const playing=d.testMode('file');await new Promise(resolve=>setImmediate(resolve));assert(d.testing);d.stop();const stopped=d.message;finish({ok:true});await playing;assert.equal(d.message,stopped,'Late success must not overwrite cancellation');
 calls.length=0;d.toggleOverlay();assert(d.overlay&&!d.confirmable);
 d.request=async r=>{calls.push(r);return r.action==='audio-overlay-scan'?{ok:true,overlayProtocol:2,backend:r.backend,carplayConnected:true}:{ok:true,overlayProtocol:2,overlay:{backend:r.backend,kind:'both',accepted:true,duckingConfirmed:false}};};
 for(const backend of ['converter','alsa','file']){
  await d.testMode(backend);assert.deepStrictEqual(calls.slice(-2),[{action:'audio-overlay-scan',backend},{action:'audio-overlay-test',backend,kind:'both'}]);
  assert(!d.confirmable&&d.result.overlay);d.askSave();await d.saveMode();assert(!d.confirming);
 }
 assert(!calls.some(r=>r.action==='audio-save'),'Overlay test cannot silently save a different regular mode');
 d.request=async()=>({ok:true,overlayProbeSupported:true});await d.testMode('converter');assert(d.message.includes('Обновите звуковой компонент'));assert(!d.result);
 d.request=async r=>({ok:true,overlayProtocol:2,backend:r.backend,carplayConnected:false});await d.testMode('file');assert(d.message.includes('Включите музыку CarPlay'));
 d.toggleOverlay();assert(!d.overlay&&!d.result&&!d.confirmable);
 const moving=new AudioDiagnostics(()=>{},{moving:()=>true});moving.request=()=>{throw Error('Must not send request while moving');};await moving.testMode('converter');assert(moving.message.includes('остановите'));
 console.log('PASS three audio modes: exact requests, no persistence, sequential probes, cancellation and errors. Service mocked.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
