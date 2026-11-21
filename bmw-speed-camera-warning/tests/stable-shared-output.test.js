'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os');
assert.rejects=async(p,re)=>{let error;try{await p;}catch(e){error=e;}assert(error&&re.test(error.message),'Expected failure matching '+re);};
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
  f.commands.push(args);assert.deepStrictEqual(args,[mode==='period'?'--stream-converter-period':mode==='profile'||mode==='profile-fail'?'--stream-converter-profile':mode==='direct'||mode==='direct-error'?'--stream-converter-direct':'--stream-converter-stable']);
  const c=new EventEmitter();c.stdout=new EventEmitter();c.stderr=new EventEmitter();let bytes=0,dead=false;
  const end=code=>{if(dead)return;dead=true;f.ended++;setImmediate(()=>c.emit('close',code));};
  c.kill=()=>end(1);
  let speaking=false,beeping=false;
  setImmediate(()=>{c.stderr.emit('data','SPEEDCAM_FORMAT {"parametersKnown":true,"rate":24000,"channels":1,"formatId":2}\n');if(mode==='direct-error'){c.stderr.emit('data','Direct SmartX requires verified S16_LE; no plug fallback\n');end(5);}});
  const event=(event,id)=>c.stderr.emit('data','SPEEDCAM_STABLE '+JSON.stringify({event,id:id||0})+'\n');
  const idle=()=>{if(!speaking&&!beeping&&!dead)event('idle');};
  const progress=setInterval(()=>{if(!dead)c.stderr.emit('data','SPEEDCAM_BUFFER {"bufferParamsKnown":true,"bufferFrames":512,"periodFrames":128,"queueFrames":4700,"queueCapacityFrames":4800,"eagainCount":10,"underruns":0,"waitErrors":0}\n');},200);
  c.on('close',()=>clearInterval(progress));
  c.stdin=new Writable({write(chunk,enc,cb){
   assert.equal(chunk.readUInt32LE(0),0x31504353);const type=chunk.readUInt32LE(4),id=chunk.readUInt32LE(8);
   assert.equal(chunk.length,24+chunk.readUInt32LE(20));
   f.packetTypes=f.packetTypes||[];f.packetTypes.push(type);f.bytes+=chunk.length;bytes+=chunk.length;
   if(type===1)assert(chunk.length>24,'Complete pulse');
   if(type===2)beeping=true;
   if(type===3){assert(chunk.length>24000,'Full phrase preloaded');assert(!speaking);speaking=true;event('started',id);setTimeout(()=>{if(dead)return;speaking=false;idle();event('done',id);},mode==='fast'?10:150);}
   if(type===4){beeping=false;setTimeout(idle,50);}
   if(type===5)assert(!speaking&&!beeping,'Graceful end after last voice/tail');
   cb();
  },final(cb){cb();if(mode==='drain-error'||mode==='profile-fail'){c.stderr.emit('data','ALSA drain failed after speech');end(6);}else{c.stderr.emit('data','SPEEDCAM_STABLE {"event":"stats","peak":0.25,"limitedSamples":0,"saturatedSamples":0}\n');c.stdout.emit('data',JSON.stringify({streamCompleted:true,framesWritten:24000*4,pendingFrames:0,rate:24000,channels:1,device:mode==='direct'?device.replace('plug:',''):device}));end(0);}}});return c;
 };
 const exec=(bin,args,o,cb)=>cb(null,JSON.stringify({converterProtocol:1,converterProfilesProtocol:1,stableMixerProtocol:1,directSmartxProtocol:1,streamSupported:true,library:true,present:true,device,rate:24000,channels:1}),'');
 f.o={root,file,exec,spawn};f.s.mixer=new AudioOutput(f.s,f.o);f.d=new ChannelDiagnostics(f.s,f.o);return f;
}
async function run(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shared-converter-')),file=path.join(dir,'route.json');
 try{
  let f=fixture(file);
  const r=await f.d.handle({action:'audio-overlay-test',backend:'converter-stable',kind:'both'},()=>true);
  assert(r.ok&&r.overlay.accepted);assert.equal(r.overlay.outputMechanism,'native-stable-plug');assert(r.overlay.stream.framesWritten>24000*3);assert.equal(f.commands.length,1);assert.equal(f.ended,1);assert(f.s.fileFallback,'Probe must not change saved M4A');assert.equal(f.routes.length,1);
  f.d.save({backend:'converter-stable',overlay:true,sinkID:1024,sourceID:1048,heard:true});assert(!f.s.fileFallback);
  const reboot=fixture(file,'fast');assert.equal(reboot.s.audioBackend,'converter-stable');assert(reboot.s.audioOverlay);
  const spoken=await reboot.s.mixer.speak('camera-500.m4a',40,{live:()=>true});await reboot.s.mixer.running;assert(spoken.ok);assert(!reboot.s.lastError);assert.deepStrictEqual(reboot.commands,f.commands);assert.equal(reboot.routes.length,1);await reboot.s.mixer.close();await f.s.mixer.close();
  fs.unlinkSync(file);
  f=fixture(file,'drain-error');await assert.rejects(f.d.handle({action:'audio-overlay-test',backend:'converter-stable',kind:'both'},()=>true),/ALSA drain failed/);assert(!f.d.last,'Failed writer must not authorize save');assert.equal(f.routes.length,1);assert.equal(f.commands.length,1);await f.s.mixer.close();
  f=fixture(file);let alive=true;const test=f.d.handle({action:'audio-overlay-test',backend:'converter-stable',kind:'both'},()=>alive);setTimeout(()=>{alive=false;},300);await assert.rejects(test,/cancelled|stopp/);assert.equal(f.ended,1);assert.equal(f.routes.length,1);assert(!f.d.last);assert(!f.d.busy&&!f.s.diagnosticBusy);await f.s.mixer.close();
  console.log('PASS stable Converter: stable native packet channel probe -> save -> restored runtime use identical writer, route and mixer; native drain failure denies save; cancellation cleans only owned route; M4A selection untouched. BMW/native hardware mocked.');
 }finally{if(fs.existsSync(file))fs.unlinkSync(file);fs.rmdirSync(dir);}
}
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={fixture};
