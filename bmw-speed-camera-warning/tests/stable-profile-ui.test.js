'use strict';
const assert=require('assert');const {AudioDiagnostics}=require('../apps/aurelm_speed_camera_warning/audio-diagnostics');
const {AudioOutput}=require('../native/bmwcaminfo-voice/audio-output');const {PROFILES}=require('../native/bmwcaminfo-voice/audio-profiles');
(async()=>{for(const p of PROFILES){const ui=new AudioDiagnostics(()=>{}),calls=[];ui.request=async r=>{calls.push(r);return r.action==='audio-save'?{saved:r}:{converterProfilesProtocol:1,overlayProtocol:2,backend:r.backend,overlaySaveSupported:true,carplayConnected:false,overlay:{accepted:true,backend:r.backend,kind:'both',sourceID:1048,sinkID:1024}};};
 await ui.testMode(p[0]);assert(ui.confirmable&&ui.overlay,'Profiles can compare without CarPlay music');ui.askSave();await ui.saveMode();assert.equal(calls[calls.length-1].backend,p[0]);ui.toggleOverlay();assert.equal(ui.backend,'converter');
 const out=new AudioOutput({audioBackend:p[0],audioOverlay:true},{read:()=>Buffer.alloc(960)});assert.equal(out.current.o.profile,p[0]);assert(!out.current.o.direct);await out.close();}
 console.log('PASS profile UI: Overlay mandatory, explicit save, no-music comparison, shared runtime, no direct SmartX.');})().catch(e=>{console.error(e);process.exitCode=1;});
