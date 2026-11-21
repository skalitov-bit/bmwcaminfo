'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const {fixture}=require('./stable-shared-output.test');
const {ChannelDiagnostics}=require('../native/bmwcaminfo-voice/channel-diagnostics');
function pulseFixture(file,fail){
 const f=fixture(file);f.sessions=0;f.pairs=0;f.drains=0;f.stops=0;
 Object.assign(f.o,{platform:'linux',arch:'x64',pulseExec(bin,args,o,cb){cb(fail==='dependency'?Error('loader'):null,path.basename(bin)+' 5.0',fail==='dependency'?'libasound.so.2 missing':'');},read(){const b=Buffer.alloc(4800);for(let i=0;i<b.length;i+=2)b.writeInt16LE(5000,i);return b;},makePulseRuntime(){return {stats:{simulated:true},check:async()=>{},start:async()=>{f.sessions++;},writePair:async(v,b)=>{assert.equal(v.length,b.length);f.pairs++;if(fail==='stream')throw Error('pulse child failed');},drain:async()=>{f.drains++;},close:async()=>{f.stops++;}};}});
 f.d=new ChannelDiagnostics(f.s,f.o);return f;
}
async function run(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pulse-shared-')),file=path.join(dir,'route.json');
 try{
  const f=pulseFixture(file);const scan=await f.d.handle({action:'audio-overlay-scan',backend:'pulse'});assert.equal(scan.pulseProtocol,1);assert(!scan.pulse.hardwareTested);assert.equal(f.s.pulseDiagnostics.stage,'preflight-passed');
  const r=await f.d.handle({action:'audio-overlay-test',backend:'pulse',kind:'both'},()=>true);assert(r.overlay.accepted);assert.equal(r.overlay.outputMechanism,'private-pulseaudio-two-streams');assert.equal(f.routes.length,1);assert.equal(f.sessions,1);assert.equal(f.drains,1);assert(f.s.fileFallback,'Probe preserves selected M4A');
  await f.d.handle({action:'audio-save',backend:'pulse',overlay:true,sourceID:1048,sinkID:1024,heard:true});await f.s.mixer.close();
  const reboot=pulseFixture(file);assert.equal(reboot.s.audioBackend,'pulse');const owner={};const beat=()=>reboot.s.mixer.set({cameraId:'x',intervalMs:700,volume:40},owner);beat();const timer=setInterval(beat,400);
  try{assert((await reboot.s.mixer.speak('camera-500.m4a',40,{live:()=>true})).ok);assert((await reboot.s.mixer.speak('camera-500.m4a',40,{live:()=>true})).ok);assert.equal(reboot.sessions,1,'Same private mixer while beeper continues');}finally{clearInterval(timer);reboot.s.mixer.clear(owner);if(reboot.s.mixer.running)await reboot.s.mixer.running;await reboot.s.mixer.close();}
  assert.equal(reboot.routes.length,1);assert.equal(reboot.drains,1);assert(reboot.pairs>0);
  fs.unlinkSync(file);
  const missing=pulseFixture(file,'dependency');await assert.rejects(missing.d.handle({action:'audio-overlay-scan',backend:'pulse'}),/libasound/);assert.equal(missing.s.pulseDiagnostics.stage,'preflight-failed');assert(!missing.calls.includes('connect'));assert(missing.s.fileFallback);assert(!missing.d.last);await missing.s.mixer.close();
  const failed=pulseFixture(file,'stream');await assert.rejects(failed.d.handle({action:'audio-overlay-test',backend:'pulse',kind:'both'},()=>true),/pulse child failed/);assert.equal(failed.routes.length,1);assert(!failed.d.last);assert(failed.s.fileFallback);await failed.s.mixer.close();
  console.log('PASS PulseAudio shared production path: real Overlay adapter + probe -> save -> reboot -> two ordinary voices with continuing beeper, one mixer, owned-route cleanup, dependency/stream denial. PulseAudio processes and BMW hardware mocked.');
 }finally{if(fs.existsSync(file))fs.unlinkSync(file);fs.rmdirSync(dir);}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
