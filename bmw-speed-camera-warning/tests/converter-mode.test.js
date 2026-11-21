'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const {AlsaDiagnostics}=require('../native/bmwcaminfo-voice/alsa-diagnostics');
const {OverlayProbe}=require('../native/bmwcaminfo-voice/overlay-probe');
const {OverlayOutput}=require('../native/bmwcaminfo-voice/overlay-output');
const {AudioOutput}=require('../native/bmwcaminfo-voice/audio-output');
const {ChannelDiagnostics}=require('../native/bmwcaminfo-voice/channel-diagnostics');
const {AudioDiagnostics}=require('../apps/aurelm_speed_camera_warning/audio-diagnostics');
const profile={converterProtocol:1,streamSupported:true,library:true,present:true,device:'plug:smartx:Media_Overlay_Converter_Source_CF_24_MONO',rate:24000,channels:1};
async function run(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'converter-mode-')),file=path.join(dir,'route.json');
 try{
  let routes=[{mainConnectionID:1,sourceID:266,sinkID:1024,connectionState:2}],calls=[],response=profile,streamCount=0;
  const s={audioBackend:'pcm-fifo',fileFallback:true,audioOverlay:true,init:async()=>{},
   createOverlayPlayer:async()=>{throw Error('Converter must not open MediaPlayer');},
   cc:{callMethod:async(method,args)=>{
    calls.push(method);
    if(method==='getListMainSources')return {listMainSources:[{sourceID:266,name:'CarPlayMedia'},{sourceID:1048,name:'OapGenericOverlay',availability:{availability:1}}]};
    if(method==='getListMainSinks')return {listMainSinks:[{sinkID:1024,name:'MediaSink_Front'}]};
    if(method==='getListMainConnections')return {listConnections:routes.slice()};
    if(method==='connect'){assert.deepStrictEqual(args,{sourceID:1048,sinkID:1024});routes.push({mainConnectionID:2,sourceID:1048,sinkID:1024,connectionState:2});return {amError:0,mainConnectionID:2};}
    if(method==='disconnect'){assert.deepStrictEqual(args,{mainConnectionID:2});routes=routes.filter(r=>r.mainConnectionID!==2);return {amError:0};}
    throw Error('Unexpected music mutation: '+method);
   }}};
  const alsa=new AlsaDiagnostics(s,{exec:(bin,args,opt,cb)=>{assert.deepStrictEqual(args,['--check-converter']);cb(null,JSON.stringify(response),'');}});
  alsa.scan=async()=>({available:true});alsa.stream=async(kind,alive,format)=>{assert(alive());assert.equal(kind,'both');assert.equal(format,'converter');streamCount++;return {ok:true,accepted:true,streamCompleted:true,framesWritten:192000,pendingFrames:0,rate:24000,channels:1,device:profile.device};};
  const options={file,alsa,sleep:()=>new Promise(r=>setTimeout(r,1)),testConverterOutput:async(service,o,live)=>{const route=new OverlayOutput(service,Object.assign({},o,{converter:true}));let stream;await route.withRoute('runtime',live,async()=>{stream=await alsa.stream('both',live,'converter');});return {sourceID:route.profile.sourceID,sinkID:route.profile.sinkID,stream};}};
  const overlay=new OverlayProbe(s,options),d=new ChannelDiagnostics(s,Object.assign({},options,{overlay})),ui=new AudioDiagnostics(()=>{});
  ui.request=r=>d.handle(r,()=>true);ui.overlay=true;
  // The same saved backend uses two distinct route policies, both tested before saving.
  for(const enabled of [true,false]){
   ui.overlay=enabled;calls=[];await ui.testMode('converter');assert(ui.confirmable,ui.message);
   assert.equal(calls.filter(c=>c==='connect').length,enabled?1:0);
   assert.equal(calls.filter(c=>c==='disconnect').length,enabled?1:0);
   assert.equal(routes.length,1);assert.equal(routes[0].sourceID,266);
   assert.throws(()=>d.save({backend:'alsa',overlay:enabled,sinkID:1024,sourceID:1048,heard:true}));
   ui.askSave();await ui.saveMode();assert(ui.message.includes('сохранён'),ui.message);
   assert.equal(s.audioBackend,'converter');assert.equal(s.audioOverlay,enabled);assert(!s.fileFallback);
   const reboot={},restored=new ChannelDiagnostics(reboot,Object.assign({},options,{overlay}));
   const screen=new AudioDiagnostics(()=>{});screen.request=r=>restored.handle(r);await screen.loadSaved();
   assert.equal(screen.backend,'converter');assert.equal(screen.overlay,enabled);assert.equal(reboot.audioBackend,'converter');
   assert.equal(restored.saved.sourceID,enabled?1048:null);
   const stored=fs.readFileSync(file,'utf8');await ui.testMode('converter');ui.toggleOverlay();ui.askSave();await ui.saveMode();assert.equal(fs.readFileSync(file,'utf8'),stored);
  }
  const mux=new AudioOutput(s,{read:()=>Buffer.alloc(100),alsa});s.audioOverlay=false;assert.strictEqual(mux.current,mux.converter);assert(mux.current.converter);
  s.audioOverlay=true;assert.strictEqual(mux.current,mux.overlayConverter);assert(mux.current.overlay&&mux.current.converter);
  // Runtime uses the discovered Overlay source and performs only scoped cleanup.
  const route=new OverlayOutput(s,Object.assign({},options,{converter:true}));calls=[];
  await route.withRoute('runtime',()=>true,async()=>{assert.equal(routes.length,2);assert.equal(route.mp,null);});
  assert.equal(routes.length,1);assert.deepStrictEqual(calls.filter(c=>['connect','disconnect'].includes(c)),['connect','disconnect']);
  routes=[];await route.withRoute('runtime',()=>true,async()=>{});assert.equal(routes.length,0,'Runtime must work without CarPlay playing');
  response=Object.assign({},profile,{streamSupported:false});
  await assert.rejects(route.withRoute('runtime',()=>true,async()=>{throw Error('Must not play');}),/непрерывного/);
  ui.overlay=false;await ui.testMode('converter');assert(!ui.confirmable&&ui.message.includes('непрерывного'));
  assert.equal(streamCount,4);await mux.close();
  d.reset();assert(s.fileFallback&&!s.audioOverlay);assert.equal(d.saved.backend,'file');
  console.log('PASS Converter: shared checkbox, actual Overlay probe/routing, direct mode without BMW route mutation, save+reboot, invalidated confirmations, no MediaPlayer, capability guard, M4A rollback. Hardware mocked.');
 }finally{fs.unlinkSync(file);fs.rmdirSync(dir);}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
