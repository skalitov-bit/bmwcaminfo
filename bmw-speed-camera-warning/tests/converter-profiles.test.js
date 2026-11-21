'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const {fixture}=require('./stable-shared-output.test');
const {PROFILES}=require('../native/bmwcaminfo-voice/audio-profiles');
const {AudioDiagnostics}=require('../apps/aurelm_speed_camera_warning/audio-diagnostics');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function run(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'converter-profiles-')),file=path.join(dir,'route.json');
 try{
  for(const pair of PROFILES){
   const backend=pair[0],mode=backend==='converter-period'?'period':'profile';
   if(fs.existsSync(file))fs.unlinkSync(file);
   const f=fixture(file,mode);
   const scan=await f.d.handle({action:'audio-overlay-scan',backend});assert.equal(scan.converterProfilesProtocol,1);
   const result=await f.d.handle({action:'audio-overlay-test',backend,kind:'both'},()=>true);
   assert(result.overlay.accepted);assert.equal(result.overlay.profile,backend);assert.equal(f.routes.length,1);
   assert.equal(f.commands.length,backend==='converter-hold'?1:3,'Hold reuses a session; other profiles fully close between phrases');
   assert.equal(f.ended,f.commands.length);assert(f.s.fileFallback,'Probe must preserve M4A');assert(!fs.existsSync(file));
   assert.throws(()=>f.d.save({backend,overlay:true,sinkID:1024,sourceID:1048,heard:false}),/confirm/);
   assert.throws(()=>f.d.save({backend:backend==='converter-hold'?'converter-reset':'converter-hold',overlay:true,sinkID:1024,sourceID:1048,heard:true}),/combined/);
   const saved=await f.d.handle({action:'audio-save',backend,overlay:true,sinkID:1024,sourceID:1048,heard:true});assert.equal(saved.saved.backend,backend);await f.s.mixer.close();
   const reboot=fixture(file,mode);assert.equal(reboot.s.audioBackend,backend);assert(reboot.s.audioOverlay&&!reboot.s.fileFallback);
   const owner={};reboot.s.mixer.set({cameraId:'camera',intervalMs:700,volume:40},owner);
   assert((await reboot.s.mixer.speak('camera-500.m4a',40,{live:()=>true})).ok);reboot.s.mixer.clear(owner);
   await wait(400);
   if(backend==='converter-hold'){
    assert.equal(reboot.routes.length,2);assert.equal(reboot.ended,0,'Dormant session retained');
    assert((await reboot.s.mixer.speak('camera-500.m4a',40,{live:()=>true})).ok);assert.equal(reboot.commands.length,1,'Second runtime phrase shares PCM and route');
    await wait(70);await reboot.s.mixer.releaseIdle();assert.equal(reboot.routes.length,1);assert.equal(reboot.ended,1);
   }else {if(reboot.s.mixer.running)await reboot.s.mixer.running;assert.equal(reboot.routes.length,1);}
   assert.equal(reboot.s.audioBufferHistory.lastRuntime.backend,backend);assert(reboot.packetTypes.includes(2)&&reboot.packetTypes.includes(3));
   reboot.d.last={backend:'file',overlay:true,sinkID:1024,sourceID:1048,kind:'both',generation:reboot.d.generation,at:Date.now()};
   await reboot.d.handle({action:'audio-save',backend:'file',overlay:true,sinkID:1024,sourceID:1048,heard:true});assert(reboot.s.fileFallback&&reboot.s.audioOverlay);await reboot.s.mixer.close();
  }
  fs.writeFileSync(file,JSON.stringify({backend:'smartx',sinkID:1024,sourceID:1048,overlay:true}));const migrated=fixture(file);assert.equal(migrated.s.audioBackend,'converter');assert.equal(JSON.parse(fs.readFileSync(file)).backend,'converter');assert(migrated.s.audioOverlay);await migrated.s.mixer.close();
  const bad=fixture(file,'profile-fail');let error;try{await bad.d.handle({action:'audio-overlay-test',backend:'converter-reset',kind:'both'},()=>true);}catch(e){error=e;}
  assert(error);assert(!bad.d.last);assert.equal(bad.routes.length,1);assert.throws(()=>bad.d.save({backend:'converter-reset',overlay:true,sinkID:1024,sourceID:1048,heard:true}),/combined/);await bad.s.mixer.close();
  const cancelled=fixture(file,'profile');let alive=true;const probe=cancelled.d.handle({action:'audio-overlay-test',backend:'converter-hold',kind:'both'},()=>alive);setTimeout(()=>alive=false,300);let failure;try{await probe;}catch(e){failure=e;}assert(failure);assert.equal(cancelled.routes.length,1);assert(!cancelled.d.last);await cancelled.s.mixer.close();
  const ui=new AudioDiagnostics(()=>{},{back(){}}),calls=[];
  ui.request=async r=>{calls.push(r);return r.action==='audio-save'?{saved:r}:{converterProfilesProtocol:1,overlayProtocol:2,overlaySaveSupported:true,backend:r.backend,carplayConnected:true,overlay:{accepted:true,backend:r.backend,kind:'both',sourceID:1048,sinkID:1024}};};
  for(const p of PROFILES){await ui.testMode(p[0]);assert(ui.overlay&&ui.confirmable);ui.askSave();await ui.saveMode();assert.equal(calls[calls.length-1].backend,p[0]);assert(ui.message.includes('сохранён'));}
  const targets=[],labels=[],cv={fillRect(){},strokeRoundRect(){},line(){}};
  ui.draw(cv,{colors:{},heading(){},text(c,t){labels.push(t);},drawSelection(){}},(c,x,y,w,h,run,key)=>targets.push({x,y,w,h,run,key}));
  assert(!labels.some(t=>/SMARTX/.test(t)));assert(!targets.some(t=>/compare|smartx/.test(t.key)));
  for(const p of PROFILES){const t=targets.find(t=>t.key==='audio-'+p[0]);assert(t&&t.y>targets.find(t=>t.key==='audio-converter').y);}
  assert(targets.some(t=>t.key==='audio-back'));assert.equal(new Set(targets.map(t=>t.key)).size,targets.length);
  ui.request=async()=>({saved:{backend:'converter-hold',overlay:true}});await ui.loadSaved();assert.equal(ui.backend,'converter-hold');ui.toggleOverlay();assert.equal(ui.backend,'converter');assert(!ui.overlay);
  ui.request=async r=>({overlayProtocol:2,backend:r.backend,carplayConnected:true});await ui.testMode('converter-period');assert(!ui.confirmable);assert(ui.message.includes('Обновите'));
  console.log('PASS three production Converter profiles: 3-phrase probe, exact-profile save guards, restart/runtime identity, persistent session reuse and release, full close, failure/cancel cleanup, SMARTX migration, M4A return, touch/joystick targets and old-helper denial. BMW/ALSA hardware mocked.');
 }finally{if(fs.existsSync(file))fs.unlinkSync(file);fs.rmdirSync(dir);}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
