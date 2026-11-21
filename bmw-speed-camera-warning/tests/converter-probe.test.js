'use strict';
const assert=require('assert');
const {AlsaDiagnostics}=require('../native/bmwcaminfo-voice/alsa-diagnostics');
const {OverlayProbe}=require('../native/bmwcaminfo-voice/overlay-probe');
const {ChannelDiagnostics}=require('../native/bmwcaminfo-voice/channel-diagnostics');
const {AudioDiagnostics}=require('../apps/aurelm_speed_camera_warning/audio-diagnostics');
const profile={converterProtocol:1,library:true,present:true,device:'plug:smartx:Media_Overlay_Converter_Source_CF_24_MONO',rate:24000,channels:1};
function fixture(){
 const f={routes:[{mainConnectionID:1,sourceID:266,sinkID:1024,connectionState:2}],calls:[],streamed:false,stopped:0};
 f.s={init:async()=>{},audioBackend:'pcm-fifo',fileFallback:true,audioOverlay:true,routeSinkId:1024,
  createOverlayPlayer:async()=>{throw Error('Converter must not instantiate M4A player');},cc:{callMethod:async(method,args)=>{
   f.calls.push(method);
   if(method==='getListMainSources')return {listMainSources:[{sourceID:266,name:'CarPlayMedia'},{sourceID:1048,name:'OAPGenericOverlay',availability:{availability:1}}]};
   if(method==='getListMainSinks')return {listMainSinks:[{sinkID:1024,name:'MediaSink_Front'}]};
   if(method==='getListMainConnections')return {listConnections:f.routes.slice()};
   if(method==='connect'){assert.equal(args.sourceID,1048);f.routes.push({mainConnectionID:2,sourceID:1048,sinkID:1024,connectionState:2});return {amError:0,mainConnectionID:2};}
   if(method==='disconnect'){assert.equal(args.mainConnectionID,2);f.routes=f.routes.filter(r=>r.mainConnectionID!==2);return {amError:0};}
   throw Error('Unexpected mutation: '+method);
  }}};
 f.alsa={checkConverter:async()=>profile,stop(){f.stopped++;},stream:async(kind,live,port)=>{
  assert.equal(port,'converter');assert.equal(kind,'both');assert(live());f.streamed=true;if(f.fail)throw Error('ALSA open: busy');return {framesWritten:192000,pendingFrames:0,rate:24000,channels:1,streamCompleted:true};
 }};
 f.p=new OverlayProbe(f.s,{alsa:f.alsa,sleep:()=>new Promise(r=>setTimeout(r,1)),testConverterOutput:async(service,o,live)=>{await f.alsa.checkConverter();f.calls.push('connect');f.routes.push({mainConnectionID:2,sourceID:1048,sinkID:1024,connectionState:2});try{return {sourceID:1048,sinkID:1024,stream:await f.alsa.stream('both',live,'converter')};}finally{f.routes=f.routes.filter(r=>r.mainConnectionID!==2);}}});return f;
}
async function run(){
 let response=profile;
 const a=new AlsaDiagnostics({}, {exec:(bin,args,opt,cb)=>{assert.deepStrictEqual(args,['--check-converter']);cb(null,JSON.stringify(response),'');}});
 assert.deepStrictEqual(await a.checkConverter(),profile);
 response=Object.assign({},profile,{device:'plug:smartx:CarLifeMedia_CF_48_STEREO'});await assert.rejects(a.checkConverter());
 let f=fixture(),r=await f.p.testConverter(()=>true);assert(r.converterProtocol===1&&!r.overlaySaveSupported);assert(f.streamed);assert.equal(f.routes.length,1);
 assert.equal(f.p.lastConverter.stage,'completed');assert.equal(f.p.lastConverter.stream.rate,24000);assert(!f.p.lastConverter.audibleConfirmed);assert(f.s.fileFallback&&f.s.audioOverlay);
 f.fail=true;await assert.rejects(f.p.testConverter(()=>true),/ALSA open/);assert.equal(f.p.lastConverter.stage,'failed');assert(f.p.lastConverter.error.includes('busy'));assert.equal(f.routes.length,1);
 f.alsa.checkConverter=async()=>{throw Error('port absent');};await assert.rejects(f.p.testConverter(()=>true),/port absent/);assert(!f.p.lastConverter.accepted);assert(!f.p.lastConverter.stream,'No stale success after preflight failure');
 f=fixture();f.routes=[];await assert.rejects(f.p.testConverter(()=>true),/Start CarPlay/);assert(!f.streamed&&!f.calls.includes('connect'));
 f=fixture();const d=new ChannelDiagnostics(f.s,{file:'nonexistent-converter-settings.json',alsa:f.alsa,overlay:f.p});
 await d.handle({action:'audio-overlay-converter-test'},()=>true);assert(!d.last,'Experimental probe must not authorize persistence');assert(!d.saved);assert(!d.busy&&!f.s.diagnosticBusy);
 assert.throws(()=>d.save({overlay:true,backend:'alsa',sinkID:1024,sourceID:1048,heard:true}),/Run combined/);
 await assert.rejects(d.handle({action:'audio-overlay-test',backend:'alsa',kind:'both',probeProfile:'media-overlay-converter'}),/separate probe/);
 const ui=new AudioDiagnostics(()=>{});ui.backend='file';ui.overlay=true;const requests=[];
 ui.request=async request=>{requests.push(request);return r;};await ui.testConverter();assert.deepStrictEqual(requests,[{action:'audio-overlay-converter-test'}]);
 assert.equal(ui.backend,'file');assert(ui.overlay&&!ui.confirmable&&!ui.busy);assert(ui.message.includes('поток завершён'));
 console.log('PASS converter probe: observed port only, separate test, scoped cleanup, failed discovery, no M4A changes and no save authorization. BMW mocked.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
