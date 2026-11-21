'use strict';
const assert=require('assert');
const {AlsaDiagnostics}=require('../native/bmwcaminfo-voice/alsa-diagnostics');
const {AudioDiagnostics}=require('../apps/aurelm_speed_camera_warning/audio-diagnostics');
async function run(){
 let reply,error,stderr='',logs=[];
 const d=new AlsaDiagnostics({}, {exec:(bin,args,options,cb)=>{
  assert.deepStrictEqual(args,['--check-overlay']);assert.equal(options.timeout,3000);cb(error,JSON.stringify(reply),stderr);
 }});
 const log=console.log;console.log=s=>logs.push(s);
 try{
  for(const pair of [['no-advertised-output','не объявила'],['ambiguous-output','несколько'],['hint-api-unavailable','интерфейс'],['enumeration-failed','прочитать']]){
   reply={library:true,discoveryProtocol:1,overlay:false,reason:pair[0],outputs:['default','smartx:CarLifeMedia_CF_48_STEREO'],hardwareVerified:false};error=Error('exit 7');
   await assert.rejects(d.checkOverlay(),new RegExp(pair[1]));
   assert.deepStrictEqual(d.lastOverlayDiscovery.outputs,reply.outputs);
   const before=logs.length;await assert.rejects(d.checkOverlay());assert.equal(logs.length,before,'Repeated inventory does not flood logs');
  }
  reply={library:true,overlay:true,device:'plug:smartx:OapGenericOverlay_CF_48_STEREO',hardwareVerified:false};error=null;
  assert.deepStrictEqual(await d.checkOverlay(),reply,'Old helper success stays compatible');
  reply.discoveryProtocol=1;reply.reason='unique-output';assert.deepStrictEqual(await d.checkOverlay(),reply);
  reply=Object.assign({},reply,{method:'smartx-shm',outputs:[],outputsTotal:0,sharedMemoryOutputs:['smartx_OapGenericOverlay_CF_48_STEREO_p_connection'],sharedMemoryTotal:1});
  assert.deepStrictEqual(await d.checkOverlay(),reply,'Published SmartX port works without ALSA hints');
  for(const device of ['plug:smartx:CarLifeMedia_CF_48_STEREO','plug:smartx:OapGenericOverlayOther','file:/tmp/OapGenericOverlay','plug:smartx:OapGenericOverlay,FILE=/tmp/x']){
   await assert.rejects(new AlsaDiagnostics({}, {exec:(b,a,o,cb)=>cb(null,JSON.stringify(Object.assign({},reply,{device})), '')}).checkOverlay(),/No advertised/);
  }
  const incomplete=Object.assign({},reply,{overlay:false,reason:'incomplete-inventory'});
  await assert.rejects(new AlsaDiagnostics({}, {exec:(b,a,o,cb)=>cb(Error('exit 7'),JSON.stringify(incomplete), '')}).checkOverlay(),/Неполный/);
  error=Error('timeout');await assert.rejects(d.checkOverlay(),/ALSA Overlay/,'Nonzero exit must never become success from partial JSON');
  reply=null;stderr='No unique advertised SmartX OapGenericOverlay ALSA output';await assert.rejects(d.checkOverlay(),/No unique/);
 }finally{console.log=log;}
 assert(logs.some(s=>s.includes('CarLifeMedia_CF_48_STEREO')),'Actual advertised names are logged');
 const ui=new AudioDiagnostics(()=>{});ui.overlay=true;const calls=[];
 ui.request=async r=>{calls.push(r);throw Error(stderr);};
 await ui.testMode('alsa');assert(ui.message.includes('M4A + Overlay'));assert(!ui.confirmable&&!ui.result&&!ui.busy);
 ui.askSave();await ui.saveMode();assert.equal(calls.length,1,'Failed scan neither plays audio nor saves mode');
 console.log('PASS ALSA Overlay discovery: failure distinctions, inventory logging, legacy helper, failed-exit guard and no playback/save after refusal. Mocked ALSA; not a vehicle test.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
