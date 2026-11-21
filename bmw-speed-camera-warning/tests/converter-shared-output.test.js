'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os');
const {EventEmitter}=require('events');const {Writable}=require('stream');
const {ChannelDiagnostics}=require('../native/bmwcaminfo-voice/channel-diagnostics');
const {AudioOutput}=require('../native/bmwcaminfo-voice/audio-output');
const root=path.resolve(__dirname,'../native/bmwcaminfo-voice');
const device='plug:smartx:Media_Overlay_Converter_Source_CF_24_MONO';
function fixture(file,mode){
 const f={routes:[{mainConnectionID:1,sourceID:266,sinkID:1024,connectionState:2}],calls:[],commands:[],bytes:0,ended:0};
 f.s={audioBackend:'pcm-fifo',fileFallback:true,audioOverlay:true,init:async()=>{},createOverlayPlayer:async()=>{throw Error('M4A player must not be used');},cc:{callMethod:async(m,a)=>{
  f.calls.push(m);
  if(m==='getListMainSources')return {listMainSources:[{sourceID:1048,name:'OapGenericOverlay',availability:{availability:1}},{sourceID:266,name:'CarPlayMedia'}]};
  if(m==='getListMainSinks')return {listMainSinks:[{sinkID:1024,name:'MediaSink_Front'}]};
  if(m==='getListMainConnections')return {listConnections:f.routes.slice()};
  if(m==='connect'){f.routes.push({mainConnectionID:2,sourceID:1048,sinkID:1024,connectionState:2});return {amError:0,mainConnectionID:2};}
  if(m==='disconnect'){assert.equal(a.mainConnectionID,2);f.routes=f.routes.filter(c=>c.mainConnectionID!==2);return {amError:0};}
  throw Error('Unexpected BMW call '+m);
 }}};
 const spawn=(bin,args)=>{
  f.commands.push(args);assert.deepStrictEqual(args,['--stream-converter']);
  const c=new EventEmitter();c.stdout=new EventEmitter();c.stderr=new EventEmitter();let bytes=0,dead=false;
  const end=code=>{if(dead)return;dead=true;f.ended++;setImmediate(()=>c.emit('close',code));};
  c.kill=()=>end(1);
  c.stdin=new Writable({write(chunk,enc,cb){assert.equal(chunk.length,960);bytes+=chunk.length;f.bytes+=chunk.length;setTimeout(cb,mode==='fast'?1:20);},final(cb){cb();if(mode==='drain-error'){c.stderr.emit('data','ALSA drain failed after speech');end(6);}else{c.stdout.emit('data',JSON.stringify({streamCompleted:true,framesWritten:bytes/2,pendingFrames:0,rate:24000,channels:1,device}));end(0);}}});return c;
 };
 const exec=(bin,args,o,cb)=>cb(null,JSON.stringify({converterProtocol:1,streamSupported:true,library:true,present:true,device,rate:24000,channels:1}),'');
 f.o={root,file,exec,spawn};f.s.mixer=new AudioOutput(f.s,f.o);f.d=new ChannelDiagnostics(f.s,f.o);return f;
}
async function run(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shared-converter-')),file=path.join(dir,'route.json');
 try{
  let f=fixture(file);
  const r=await f.d.handle({action:'audio-overlay-test',backend:'converter',kind:'both'},()=>true);
  assert(r.ok&&r.overlay.accepted);assert.equal(r.overlay.outputMechanism,'shared-runtime-converter');assert(r.overlay.stream.framesWritten>24000*3);assert.equal(f.commands.length,1);assert.equal(f.ended,1);assert(f.s.fileFallback,'Probe must not change saved M4A');assert.equal(f.routes.length,1);
  f.d.save({backend:'converter',overlay:true,sinkID:1024,sourceID:1048,heard:true});assert(!f.s.fileFallback);
  const reboot=fixture(file,'fast');assert.equal(reboot.s.audioBackend,'converter');assert(reboot.s.audioOverlay);
  const spoken=await reboot.s.mixer.speak('camera-500.m4a',40,{live:()=>true});await reboot.s.mixer.running;assert(spoken.ok);assert(!reboot.s.lastError);assert.deepStrictEqual(reboot.commands,f.commands);assert.equal(reboot.routes.length,1);await reboot.s.mixer.close();await f.s.mixer.close();
  fs.unlinkSync(file);
  f=fixture(file,'drain-error');await assert.rejects(f.d.handle({action:'audio-overlay-test',backend:'converter',kind:'both'},()=>true),/ALSA drain failed/);assert(!f.d.last,'Failed writer must not authorize save');assert.equal(f.routes.length,1);assert.equal(f.commands.length,1);await f.s.mixer.close();
  f=fixture(file);let alive=true;const test=f.d.handle({action:'audio-overlay-test',backend:'converter',kind:'both'},()=>alive);setTimeout(()=>{alive=false;},300);await assert.rejects(test,/cancelled|stopp/);assert.equal(f.ended,1);assert.equal(f.routes.length,1);assert(!f.d.last);assert(!f.d.busy&&!f.s.diagnosticBusy);await f.s.mixer.close();
  console.log('PASS shared Converter: actual channel probe -> save -> restored runtime use identical writer, route and mixer; native drain failure denies save; cancellation cleans only owned route; M4A selection untouched. BMW/native hardware mocked.');
 }finally{if(fs.existsSync(file))fs.unlinkSync(file);fs.rmdirSync(dir);}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
