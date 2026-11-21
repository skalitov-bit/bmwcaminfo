'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm'),os=require('os');
const {EventEmitter}=require('events');const {Writable}=require('stream');
const root=path.resolve(__dirname,'../native/bmwcaminfo-voice');
const {AudioOutput}=require(root+'/audio-output');const {ChannelDiagnostics}=require(root+'/channel-diagnostics');
const source=fs.readFileSync(root+'/voice.js','utf8');
async function run(){
 const ctx={require:n=>n.startsWith('./')?require(path.join(root,n)):require(n),console:{log(){}},setTimeout,clearTimeout,Date};
 vm.createContext(ctx);vm.runInContext(source.slice(0,source.indexOf('var voice = new VoiceService();')),ctx);
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'converter-runtime-')),saved=path.join(folder,'route.json');
 fs.writeFileSync(saved,JSON.stringify({backend:'converter',overlay:true,sinkID:1024,sourceID:1048}));
 try{
  const measurements=[];
  for(const intervalMs of [300,700])for(const mode of ['voice','beeper','both'])for(const volume of [20,40,60,80,100]){const failure=false;let clock=0;const captured=[],owner={};
   const s=new ctx.VoiceService();let routes=[{mainConnectionID:1,sourceID:266,sinkID:1024,connectionState:2}],argsSeen=[],started=0,bytes=0;
   s.init=async()=>{};s.createOverlayPlayer=async()=>{throw Error('Unexpected MediaPlayer');};
   s.cc={callMethod:async(m,a)=>{
    if(m==='getListMainSources')return {listMainSources:[{sourceID:1048,name:'OapGenericOverlay',availability:{availability:1}},{sourceID:266,name:'CarPlayMedia'}]};
    if(m==='getListMainSinks')return {listMainSinks:[{sinkID:1024,name:'MediaSink_Front'}]};
    if(m==='getListMainConnections')return {listConnections:routes.slice()};
    if(m==='connect'){routes.push({mainConnectionID:2,sourceID:1048,sinkID:1024,connectionState:2});return {amError:0,mainConnectionID:2};}
    if(m==='disconnect'){assert.equal(a.mainConnectionID,2);routes=routes.filter(c=>c.mainConnectionID!==2);return {amError:0};}
    throw Error('Unexpected BMW mutation '+m);
   }};
   const spawn=(bin,args)=>{
    argsSeen.push(args);const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();let closed=false;
    child.kill=()=>{if(!closed){closed=true;setImmediate(()=>child.emit('close',1));}};
    child.stdin=new Writable({write(chunk,enc,cb){bytes+=chunk.length;captured.push(Buffer.from(chunk));clock+=20;if(mode!=='voice'){if(clock<2000)s.mixer.set({cameraId:'volume-test',intervalMs,volume},owner);else s.mixer.clear(owner);}if(failure){child.stderr.emit('data','ALSA open: Device or resource busy');cb(Object.assign(Error('write EPIPE'),{code:'EPIPE'}));}else setImmediate(cb);},final(cb){cb();closed=true;setImmediate(()=>{child.stdout.emit('data',JSON.stringify({streamCompleted:true,framesWritten:bytes/2,pendingFrames:0,rate:24000,channels:1,device:'plug:smartx:Media_Overlay_Converter_Source_CF_24_MONO'}));child.emit('close',0);});}});return child;
   };
   const exec=(bin,args,opt,cb)=>{assert.deepStrictEqual(args,['--check-converter']);cb(null,JSON.stringify({converterProtocol:1,streamSupported:true,library:true,present:true,device:'plug:smartx:Media_Overlay_Converter_Source_CF_24_MONO',rate:24000,channels:1}),'');};
   s.mixer=new AudioOutput(s,{root,spawn,exec,now:()=>clock});new ChannelDiagnostics(s,{file:saved});
   if(mode!=='voice')s.mixer.set({cameraId:'volume-test',intervalMs,volume},owner);
   const result=mode==='beeper'?{ok:true}:await s.play('strelka.m4a',volume,{live:()=>true,started:()=>started++});await s.mixer.running;
   assert.equal(result.ok,!failure);assert.deepStrictEqual(argsSeen,[['--stream-converter']]);assert.equal(routes.length,1);assert.equal(routes[0].sourceID,266);assert.equal(s.audioBackend,'converter');assert.equal(s.audioOverlay,true);
   if(!failure){assert.equal(started,mode==='beeper'?0:1);assert(bytes>0);}
   else {assert(result.error.includes('ALSA open: Device or resource busy'),'Native error must survive the broken input pipe');assert(s.lastError.includes('ALSA open: Device or resource busy'));}
   const pcm=Buffer.concat(captured);let squares=0,peak=0;for(let i=0;i<pcm.length;i+=2){const v=pcm.readInt16LE(i)/32768;squares+=v*v;peak=Math.max(peak,Math.abs(v));}measurements.push({mode,intervalMs,volume,frames:pcm.length/2,rms:Math.sqrt(squares/(pcm.length/2)),peak,signal:s.audioBufferHistory.lastRuntime.pcmSignal});
   await s.mixer.close();
  }
  for(const intervalMs of [300,700])for(const mode of ['voice','beeper','both']){const rows=measurements.filter(r=>r.mode===mode&&r.intervalMs===intervalMs),max=rows[4];for(let i=0;i<5;i++){const row=rows[i];row.rmsRelativeToMax=row.rms/max.rms;if(rows.every(r=>r.signal.limitedSamples===0))assert(Math.abs(row.rmsRelativeToMax-row.volume/100)<.025,'Gain mismatch '+JSON.stringify(row));if(i)assert(row.rms>rows[i-1].rms);assert.equal(row.signal.outputSaturatedSamples,0);}}
  console.log(JSON.stringify(measurements.map(r=>({mode:r.mode,intervalMs:r.intervalMs,volume:r.volume,relativeRms:r.rmsRelativeToMax,peak:r.peak,limited:r.signal.limitedSamples})),null,2));
  if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify({hardwareVerified:false,measurements},null,2));
 }finally{fs.unlinkSync(saved);fs.rmdirSync(folder);}
 console.log('PASS five levels: actual VoiceService -> saved Converter Overlay -> mixer -> captured PCM; voice, beeper and simultaneous output; no master-volume mutation. BMW and native device mocked.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
