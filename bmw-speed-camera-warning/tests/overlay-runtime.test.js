'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const {OverlayOutput}=require('../native/bmwcaminfo-voice/overlay-output');
const {AudioOutput}=require('../native/bmwcaminfo-voice/audio-output');
const {MixedOutput}=require('../native/bmwcaminfo-voice/pcm-output');
const native=path.resolve(__dirname,'../native/bmwcaminfo-voice');
function fixture(){
 const f={calls:[],routes:[],disposed:0};
 f.s={init:async()=>{},createOverlayPlayer:async()=>({callMethod:async(n,a)=>{f.calls.push([n,a]);return {EntError:'OK'};},shutdown:async()=>{f.disposed++;}}),cc:{callMethod:async(n,a)=>{
  f.calls.push([n,a]);
  if(n==='getListMainSources')return {listMainSources:[{sourceID:2048,name:'OapGenericOverlay',availability:{availability:'A_AVAILABLE'}},{sourceID:3000,name:'CarPlayMedia'}]};
  if(n==='getListMainSinks')return {listMainSinks:[{sinkID:2049,name:'MediaSink_Front'}]};
  if(n==='getListMainConnections')return {listConnections:f.routes};
  if(n==='connect'){assert.deepStrictEqual(a,{sourceID:2048,sinkID:2049});if(f.connectFail)throw Error('connect timeout');f.routes.push({sourceID:2048,sinkID:2049,mainConnectionID:7,connectionState:'CS_CONNECTED'});return {amError:'E_OK',mainConnectionID:7};}
  if(n==='disconnect'){assert.equal(a.mainConnectionID,7);if(f.cleanupFail)throw Error('cleanup failed');f.routes=f.routes.filter(c=>c.mainConnectionID!==7);return {amError:'E_OK'};}
  throw Error('Unexpected music transport call '+n);
 }}};
 f.o=new OverlayOutput(f.s,{sleep:async()=>{},alsa:{checkOverlay:async()=>{if(f.noPort)throw Error('No Overlay ALSA port');}}});return f;
}
async function run(){
 let f=fixture();await f.o.waitAvailable(()=>true);await f.o.connectAudio();assert(f.o.mp);await f.o.release();assert.equal(f.routes.length,0);assert.equal(f.disposed,1);
 f=fixture();f.routes=[{mainConnectionID:1,sourceID:3000,sinkID:2049,connectionState:'CS_CONNECTED'}];await f.o.withRoute('runtime',()=>true,async()=>{assert.equal(f.o.mp,null,'ALSA never opens MediaPlayer');});assert.equal(f.routes.length,1);assert(!f.calls.some(c=>c[0]==='sendButtonEvent'));
 f=fixture();f.noPort=true;await assert.rejects(f.o.withRoute('runtime',()=>true,async()=>{}),/No Overlay/);assert(!f.calls.some(c=>c[0]==='connect'));
 f=fixture();f.connectFail=true;await assert.rejects(f.o.connectAudio(),/timeout/);assert(f.o.uncertain);await assert.rejects(f.o.connectAudio(),/ownership/);
 f=fixture();await f.o.connectAudio();f.routes[0].sourceID=999;await assert.rejects(f.o.release(),/changed owner/);assert(!f.calls.some(c=>c[0]==='disconnect'));
 f=fixture();await f.o.connectAudio();f.cleanupFail=true;await assert.rejects(f.o.release(),/cleanup failed/);assert(f.o.uncertain);
 // Real FIFO failure must never silently change a saved Overlay PCM into M4A.
 f=fixture();const m=new MixedOutput(f.o,{read:()=>Buffer.alloc(480,1),makeSink:()=>({open:async()=>'/run/test.wav',write:async()=>{const e=Error('decoder refused');e.code='PCM_NOT_CONSUMED';throw e;},close(){}})});
 const r=await m.speak('camera-500.m4a',80,{live:()=>true});await m.running;assert(!r.ok);assert(!f.o.fileFallback);assert(f.s.lastError.includes('decoder'));assert.equal(f.routes.length,0);await m.close();
 const svc={audioOverlay:true,audioBackend:'pcm-fifo'},mux=new AudioOutput(svc,{read:()=>Buffer.alloc(100)});assert.equal(mux.current,mux.overlayFifo);svc.audioBackend='alsa';assert.equal(mux.current,mux.overlayAlsa);assert(mux.current.overlay);assert.strictEqual(mux.current.route,mux.overlayRoute);svc.audioOverlay=false;assert.equal(mux.current,mux.alsa);await mux.close();
 // Exercise the actual VoiceService.play M4A branch with isolated Overlay player.
 const source=fs.readFileSync(native+'/voice.js','utf8');
 const ctx={require:n=>n==='fs'?{existsSync:()=>true}:n.startsWith('./')?require(path.join(native,n)):require(n),console:{log(){}},setTimeout:fn=>fn(),Date};
 vm.createContext(ctx);vm.runInContext(source.slice(0,source.indexOf('var voice = new VoiceService();')),ctx);
 const v=new ctx.VoiceService();f=fixture();v.audioOverlay=true;v.fileFallback=true;v.mixer={overlayRoute:f.o};v.waitAvailable=()=>{throw Error('Normal player touched');};
 const played=await v.play('strelka.m4a',80,{live:()=>true});assert(played.ok);assert(f.calls.some(c=>c[0]==='playFile'&&c[1].path.replace(/\\/g,'/').endsWith('/audio/volume-80/strelka.m4a')));assert.equal(f.routes.length,0);
 console.log('PASS Overlay runtime: no-music playback, exact route, ALSA isolation, no fallback, cancellation ownership, cleanup lock, PCM failure and actual M4A voice path. BMW mocked.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
