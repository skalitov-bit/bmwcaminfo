'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const {fixture}=require('./stable-shared-output.test');
const {ChannelDiagnostics}=require('../native/bmwcaminfo-voice/channel-diagnostics');
async function run(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mixer-outputs-'));
 try{
  for(const backend of ['converter-stable','converter-hold','converter-reset','converter-period','pulse']){
   const f=fixture(path.join(dir,'route-'+backend+'.json'),backend==='converter-period'?'period':backend.indexOf('converter-')===0&&backend!=='converter-stable'?'profile':undefined);
   f.s.fileFallback=false;f.s.audioBackend=backend;f.o.mixerFile=path.join(dir,'mix-'+backend+'.json');
   if(backend==='pulse')f.o.makePulseRuntime=()=>({stats:{},check:async()=>{},start:async()=>{},writePair:async()=>{},drain:async()=>{},close:async()=>{}});
   f.d=new ChannelDiagnostics(f.s,f.o);f.s.fileFallback=false;f.s.audioBackend=backend;
   const values={voice:60,beeper:40,duck:10,musicDuck:true};await f.d.handle({action:'audio-mixer-save',values});
   const saved=fs.readFileSync(f.o.mixerFile,'utf8'),preview={voice:20,beeper:80,duck:50};
   const result=await f.d.handle({action:'audio-mixer-listen',values:preview,volume:40},()=>true);assert(result.ok);assert(!result.voiceOnly);
   assert.deepStrictEqual(f.s.audioMix,values);assert.equal(fs.readFileSync(f.o.mixerFile,'utf8'),saved);assert.equal(f.s.audioBackend,backend);assert(f.s.audioOverlay);assert(!f.d.busy&&!f.s.diagnosticBusy);assert.equal(f.routes.length,1,'Preserve CarPlay route');
   if(backend!=='pulse')assert.equal(f.packetTypes[0],7,'Mixer gains precede PCM');
   await f.s.mixer.close();console.log('PASS saved '+backend+' draft audition: unchanged route/settings, voice+beeper, cleanup');
  }
 }finally{for(const name of fs.readdirSync(dir))fs.unlinkSync(path.join(dir,name));fs.rmdirSync(dir);}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
