'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const {ChannelDiagnostics}=require('../native/bmwcaminfo-voice/channel-diagnostics');
const {AudioDiagnostics}=require('../apps/aurelm_speed_camera_warning/audio-diagnostics');
async function run(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'overlay-save-')),file=path.join(dir,'route.json');
 try{
  const s={},overlay={scan:async backend=>({ok:true,overlayProtocol:2,backend,carplayConnected:true}),test:async(live,r)=>({ok:true,overlayProtocol:2,overlay:{backend:r.backend,kind:r.kind,sourceID:2048,sinkID:2049,accepted:true}})};
  const d=new ChannelDiagnostics(s,{file,overlay}),ui=new AudioDiagnostics(()=>{});
  ui.request=r=>d.handle(r,()=>true);ui.toggleOverlay();
  for(const backend of ['converter','alsa','file']){
   await ui.testMode(backend);assert(ui.confirmable,ui.message);
   assert.throws(()=>d.save({backend,overlay:false,sinkID:2049,heard:true}));
   assert.throws(()=>d.save({backend,overlay:true,sourceID:1046,sinkID:2049,heard:true}),/combined/);
   assert.throws(()=>d.save({backend,overlay:true,sourceID:2048,sinkID:1024,heard:true}),/combined/);
   assert.throws(()=>d.save({backend,overlay:true,sourceID:2048,sinkID:2049,heard:false}),/combined/);
   ui.askSave();await ui.saveMode();assert(ui.message.includes('сохранён'),ui.message);
   assert(s.audioOverlay);assert.equal(s.fileFallback,backend==='file');
   const reboot={};const restored=new ChannelDiagnostics(reboot,{file,overlay});assert(reboot.audioOverlay);assert.equal(restored.saved.backend,backend);
   const reloaded=new AudioDiagnostics(()=>{});reloaded.request=r=>restored.handle(r);await reloaded.loadSaved();assert(reloaded.overlay);assert.equal(reloaded.backend,backend);
   const previous=fs.readFileSync(file,'utf8');await ui.testMode(backend);ui.toggleOverlay();ui.askSave();await ui.saveMode();assert.equal(fs.readFileSync(file,'utf8'),previous,'Checkbox change invalidates UI confirmation');ui.toggleOverlay();
  }
  await d.handle({action:'audio-overlay-scan',backend:'file'});assert.throws(()=>d.save({backend:'file',overlay:true,sourceID:2048,sinkID:2049,heard:true}),/combined/);
  s.speechPending=1;assert.throws(()=>d.reset(),/busy/);s.speechPending=0;
  d.reset();assert(!s.audioOverlay&&s.fileFallback);const ordinary={};new ChannelDiagnostics(ordinary,{file});assert(!ordinary.audioOverlay&&ordinary.fileFallback);
  // Older component can still run tests; UI must not claim it can persist Overlay.
  ui.overlay=true;ui.request=async r=>r.action==='audio-overlay-scan'?{ok:true,overlayProtocol:2,backend:r.backend,carplayConnected:true}:overlay.test(()=>true,r);
  await ui.testMode('converter');assert(!ui.confirmable);assert(ui.message.includes('обновите'));
  console.log('PASS Overlay saving: all three end-to-end UI/service modes, discovered IDs, proof matching, explicit confirmation, reboot, checkbox invalidation, legacy service and M4A reset. Hardware mocked.');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
