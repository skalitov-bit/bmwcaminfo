'use strict';
const assert=require('assert');
const {OverlayProbe}=require('../native/bmwcaminfo-voice/overlay-probe');
const {ChannelDiagnostics}=require('../native/bmwcaminfo-voice/channel-diagnostics');
function fixture(){
 const f={calls:[],routes:[{mainConnectionID:1,sourceID:266,sinkID:1024,connectionState:'CS_CONNECTED'}],live:true,source:true,available:true,plays:0,disposed:0};
 f.s={fileFallback:true,routeSinkId:1024,audioBackend:'pcm-fifo',init:async()=>{},createOverlayPlayer:async()=>({shutdown:async()=>{f.disposed++;},callMethod:async(n,a)=>{f.calls.push(n);assert.equal(n,'playFile');assert(/(?:volume-40[\\/]strelka|diagnostics[\\/]both).m4a$/.test(a.path));f.plays++;if(f.playError)return {EntError:'FAILED'};return {EntError:'OK'};}}),cc:{callMethod:async(n,a)=>{
  f.calls.push(n);
  if(n==='getListMainSources')return {listMainSources:[{sourceID:266,name:'CarPlayMedia'}].concat(f.source?[{sourceID:2048,name:'OAPGenericOverlay',availability:{availability:f.available?'A_AVAILABLE':'A_UNAVAILABLE'}}]:[])};
  if(n==='getListMainSinks')return {listMainSinks:[{sinkID:1024,name:'MediaSink_Front'}]};
  if(n==='getListMainConnections')return {listConnections:f.routes.map(x=>Object.assign({},x))};
  if(n==='connect'){assert.deepStrictEqual(a,{sourceID:2048,sinkID:1024});if(f.timeout)throw Error('connect timeout');if(f.connectError)return {amError:'E_UNKNOWN'};f.routes.push({mainConnectionID:2,sourceID:a.sourceID,sinkID:a.sinkID,connectionState:'CS_CONNECTED'});if(f.dropMusic)f.routes=f.routes.filter(c=>c.sourceID!==266);return {amError:'E_OK',mainConnectionID:2};}
  if(n==='disconnect'){assert.equal(a.mainConnectionID,2,'Never disconnect CarPlay');if(f.cleanupError)throw Error('disconnect failure');f.routes=f.routes.filter(c=>c.mainConnectionID!==2);return {amError:'E_OK'};}
  throw Error('Unexpected mutation: '+n);
 }}};
 f.p=new OverlayProbe(f.s,{sleep:async()=>{if(f.cancelAfterPlay)f.live=false;}});return f;
}
async function run(){
 let f=fixture();const scan=await f.p.scan();assert(scan.carplayConnected);assert.equal(scan.sourceID,2048);assert(!f.calls.includes('connect'));assert.equal(f.disposed,1);
 let r=await f.p.test(()=>f.live);assert(r.ok&&r.overlay.carplayRoutePreserved);assert.equal(r.overlay.duckingConfirmed,false);assert.equal(r.overlay.audibleConfirmed,false);assert.equal(f.routes.length,1);assert(f.s.fileFallback);assert.equal(f.s.audioBackend,'pcm-fifo');assert.equal(f.s.routeSinkId,1024);
 for(const key of ['source','available']){f=fixture();f[key]=false;await assert.rejects(f.p.test(()=>true));assert(!f.calls.includes('connect'));assert.equal(f.plays,0);}
 f=fixture();f.routes=[];await assert.rejects(f.p.test(()=>true),/Start CarPlay/);assert(!f.calls.includes('connect'));
 f=fixture();f.routes.push({mainConnectionID:20,sourceID:2048,sinkID:1024});await assert.rejects(f.p.test(()=>true),/busy/);assert(!f.calls.includes('disconnect'));
 f=fixture();f.dropMusic=true;await assert.rejects(f.p.test(()=>true),/CarPlay route changed/);assert.equal(f.plays,0);assert(f.calls.includes('disconnect'));assert(!f.calls.includes('sendButtonEvent'));
 f=fixture();f.playError=true;await assert.rejects(f.p.test(()=>true),/rejected test phrase/);assert.equal(f.routes.length,1);assert.equal(f.disposed,1);
 f=fixture();f.cancelAfterPlay=true;await assert.rejects(f.p.test(()=>f.live),/cancelled/);assert.equal(f.routes.length,1);
 f=fixture();f.cleanupError=true;await assert.rejects(f.p.test(()=>true),/disconnect failure/);assert(f.p.uncertain);await assert.rejects(f.p.test(()=>true),/restart/);
 f=fixture();f.timeout=true;await assert.rejects(f.p.test(()=>true),/ownership unknown/);assert(f.p.uncertain);assert(!f.calls.includes('disconnect'));
 // New combined variants use exactly the selected output; no PCM -> M4A fallback.
 f=fixture();r=await f.p.test(()=>true,{backend:'file',kind:'both'});assert.equal(r.overlay.backend,'file');assert.equal(r.overlay.kind,'both');
 f=fixture();let streamed=false;
 f.p.o.alsa={checkOverlay:async()=>({overlay:true}),scanOverlay:async()=>({available:true}),stop(){},stream:async(kind,live,overlay)=>{assert.equal(kind,'both');assert(live());assert(overlay);streamed=true;}};
 f.p.sleep=()=>new Promise(r=>setTimeout(r,1));
 r=await f.p.scan('alsa');assert.equal(r.overlayProtocol,2);assert.equal(f.disposed,0,'ALSA does not open MediaPlayer');
 r=await f.p.test(()=>true,{backend:'alsa',kind:'both'});assert(streamed);assert.equal(f.plays,0);assert.equal(r.overlay.backend,'alsa');assert.equal(f.routes.length,1);
 f=fixture();f.p.o.alsa={checkOverlay:async()=>{throw Error('No advertised port');}};await assert.rejects(f.p.test(()=>true,{backend:'alsa',kind:'both'}),/No advertised port/);assert(!f.calls.includes('connect'));
 f=fixture();let mixed=false;f.p.sleep=()=>new Promise(r=>setTimeout(r,1));
 f.p.o.makeMixer=adapter=>({set(){},clear(){},close:async()=>{},speak:async()=>{mixed=true;assert(adapter.mp);return {ok:true};}});
 r=await f.p.test(()=>true,{backend:'pcm',kind:'both'});assert(mixed);assert.equal(f.plays,0);assert.equal(r.overlay.backend,'pcm');assert.equal(f.routes.length,1);assert(f.s.fileFallback);
 f=fixture();f.p.sleep=()=>new Promise(r=>setTimeout(r,1));f.p.o.makeMixer=()=>({set(){},clear(){},close:async()=>{},speak:async()=>({ok:false,error:'PCM not consumed'})});
 await assert.rejects(f.p.test(()=>true,{backend:'pcm',kind:'both'}),/PCM not consumed/);assert.equal(f.plays,0,'No file fallback during Overlay PCM probe');assert.equal(f.routes.length,1);
 // Shared service lock also covers Overlay, preserving selected M4A and saved settings.
 f=fixture();let done;const d=new ChannelDiagnostics(f.s,{file:'nonexistent-overlay-test-settings.json',overlay:{scan:()=>new Promise(r=>{done=r;})}});
 const pending=d.handle({action:'audio-overlay-scan'},()=>true);assert(d.busy&&f.s.diagnosticBusy);await assert.rejects(d.handle({action:'audio-overlay-test'}),/busy/);assert.throws(()=>d.save({}),/busy/);done(scan);await pending;assert(!d.busy&&!f.s.diagnosticBusy);assert(f.s.fileFallback);
 console.log('PASS Overlay experiment: advertised IDs, read-only scan, scoped playback, CarPlay guard, cancellation, owned-route cleanup, failed cleanup lock, M4A preserved. BMW mocked; no hardware claim.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
