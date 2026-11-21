'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const {fixture}=require('./stable-shared-output.test');
const {AudioDiagnostics}=require('../apps/aurelm_speed_camera_warning/audio-diagnostics');
(async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'smartx-migrate-')),file=path.join(dir,'route.json');try{
 fs.writeFileSync(file,JSON.stringify({backend:'smartx',overlay:true,sinkID:1024,sourceID:1048}));const f=fixture(file);
 assert.equal(f.s.audioBackend,'converter');assert(f.s.audioOverlay);assert.equal(f.d.saved.backend,'converter');assert.equal(JSON.parse(fs.readFileSync(file)).backend,'converter');
 await assert.rejects(f.d.handle({action:'audio-overlay-test',backend:'smartx',kind:'both'},()=>true),/removed/);
 assert.throws(()=>f.d.save({backend:'smartx',overlay:true,sinkID:1024,sourceID:1048,heard:true}),/removed/);assert.equal(f.commands.length,0);await f.s.mixer.close();
 const ui=new AudioDiagnostics(()=>{});ui.request=()=>{throw Error('Removed mode requested');};await ui.testMode('smartx');assert.equal(ui.backend,null);assert.equal(typeof ui.openComparison,'undefined');
 console.log('PASS removed SMARTX UI and API; saved mode migrates atomically to Converter + Overlay, no direct PCM spawn.');
}finally{fs.unlinkSync(file);fs.rmdirSync(dir);}})().catch(e=>{console.error(e);process.exitCode=1;});
