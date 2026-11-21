'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const {PulseOutput}=require('../native/bmwcaminfo-voice/pulse-output');
const {PulseRuntime,config}=require('../native/bmwcaminfo-voice/pulse-runtime');
const {ChannelDiagnostics}=require('../native/bmwcaminfo-voice/channel-diagnostics');
const {AudioDiagnostics}=require('../apps/aurelm_speed_camera_warning/audio-diagnostics');
const {AudioOutput}=require('../native/bmwcaminfo-voice/audio-output');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function pcm(ms,value){const b=Buffer.alloc(48*ms);for(let i=0;i<b.length;i+=2)b.writeInt16LE(value,i);return b;}
function fixture(fail){
 const s={fileFallback:false,audioBackend:'pulse',audioOverlay:true},pairs=[],events=[];
 const route={profile:{sourceID:1048,sinkID:1024},waitAvailable:async()=>{},connectAudio:async b=>events.push('connect:'+b),release:async()=>events.push('release')};
 const runtime={stats:{simulated:true},check:async()=>{if(fail==='check')throw Error('missing ELF dependency');},start:async()=>events.push('server'),writePair:async(v,b)=>{pairs.push([Buffer.from(v),Buffer.from(b)]);if(fail==='write')throw Error('backend disconnected');},drain:async()=>{if(fail==='drain')throw Error('drain failed');events.push('drain');},close:async()=>events.push('close')};
 const o={read:n=>pcm(n==='beeper-sonar.pcm'?150:180,16000),pulseRoute:route,makePulseRuntime:()=>runtime};
 return {s,o,route,runtime,pairs,events,out:new PulseOutput(s,o)};
}
async function run(){
 const f=fixture(),owner={};f.out.set({cameraId:'x',intervalMs:300,volume:100},owner);
 const spoken=f.out.speak('strelka.m4a',100,{live:()=>true});await sleep(60);f.out.clear(owner);
 assert((await spoken).ok);if(f.out.running)await f.out.running;
 assert(f.pairs.some(p=>p[0].some(v=>v)&&p[1].some(v=>v)),'two nonzero concurrent streams');
 const values=f.pairs.map(p=>[p[0].readInt16LE(0),p[1].readInt16LE(0)]);
 assert(values.some(p=>p[0]>0&&p[1]>0&&p[1]<p[0]*.4),'beeper ducks, not muted');
 assert.equal(f.out.beep.signal.frames,f.out.voice.signal.frames,'same submitted clock');
 assert.equal(f.out.beep.tails.length,0,'last pulse fully rendered');
 assert.equal(f.events.join(','),'connect:converter,server,drain,close,release');assert(!f.s.fileFallback);
 for(const kind of ['check','write','drain']){const b=fixture(kind);const r=await b.out.speak('strelka.m4a',40,{live:()=>true});assert(!r.ok,kind);if(b.out.running)await b.out.running;assert(b.s.lastError);assert(b.events.includes('close'));if(kind!=='check')assert(b.events.includes('release'));assert(!b.s.fileFallback);await b.out.close();}
 const stop=fixture();const task=stop.out.speak('strelka.m4a',40,{live:()=>true});await sleep(10);await stop.out.close();assert(!(await task).ok);
 const cancelled=fixture();assert((await cancelled.out.speak('strelka.m4a',40,{live:()=>false})).skipped);assert.equal(cancelled.events.length,0);
 const queue=fixture();const permit={live:()=>true};const a=queue.out.speak('strelka.m4a',40,permit),b=queue.out.speak('strelka.m4a',40,permit),c=queue.out.speak('strelka.m4a',40,permit);assert((await c).retryable);assert((await a).ok&&(await b).ok);await queue.out.close();
 // Gain is monotonic and worst-case sum of two full-scale streams remains below FS.
 const levels=[];for(const volume of [20,40,60,80,100]){const g=fixture();g.out.read=()=>pcm(500,32767);g.out.beep.pulse=pcm(500,32767);g.out.beep.set({cameraId:'x',intervalMs:300,volume},owner);g.out.voice.enqueue(pcm(500,32767),volume,{live:()=>true});const pair=g.out.frames();let max=0;for(let i=0;i<pair[0].length;i+=2){const sum=pair[0].readInt16LE(i)+pair[1].readInt16LE(i);assert(sum<32767);max=Math.max(max,sum);}levels.push(max);g.out.voice.fail('done');}assert(levels.every((v,i)=>!i||v>levels[i-1]));
 const cfg=config('/run/bmwcaminfo-voice/pulse-test/native','/run/bmwcaminfo-voice/pulse-test/cookie');assert(cfg.includes('tsched=0 mmap=0'));assert(!/tcp|udev|suspend|switch|restore/.test(cfg));assert(cfg.includes('auth-anonymous=0 auth-cookie-enabled=1'));assert.throws(()=>config('/tmp/x\nload-module bad','/tmp/cookie'),/Unsafe/);assert.throws(()=>config('/tmp/native','/tmp/cookie\nload-module bad'),/Unsafe/);assert.throws(()=>config('/tmp/native'),/Unsafe/);
 let platformError;try{await new PulseRuntime({platform:'win32'}).check();}catch(e){platformError=e;}assert(platformError&&/Linux/.test(platformError.message));
 // Saving is gated by an exact successful both-stream test and explicit listening confirmation.
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pulse-route-')),file=path.join(dir,'route.json');
 try{const s={audioBackend:'converter',audioOverlay:true},d=new ChannelDiagnostics(s,{file});assert.throws(()=>d.save({backend:'pulse',overlay:true,heard:true}),/combined/);d.last={backend:'pulse',overlay:true,sourceID:1048,sinkID:1024,kind:'both',generation:d.generation,at:Date.now()};assert.throws(()=>d.save({backend:'pulse',overlay:false,heard:true}),/Overlay/);assert.throws(()=>d.save({backend:'pulse',overlay:true,sourceID:1048,sinkID:1024,heard:false}),/confirm/);d.save({backend:'pulse',overlay:true,sourceID:1048,sinkID:1024,heard:true});assert.equal(s.audioBackend,'pulse');assert(s.audioOverlay&&!s.fileFallback);const restarted={},d2=new ChannelDiagnostics(restarted,{file});assert.equal(restarted.audioBackend,'pulse');assert((await d2.handle({action:'audio-current'})).active.backend==='pulse');
  const output=new AudioOutput(s,f.o);assert(output.current instanceof PulseOutput);assert(output.current.musicDuckWrapped);await output.close();
 }finally{if(fs.existsSync(file))fs.unlinkSync(file);fs.rmdirSync(dir);}
 const ui=new AudioDiagnostics(()=>{},{back(){}}),requests=[];ui.request=async r=>{requests.push(r);return r.action==='audio-save'?{saved:r}:{pulseProtocol:1,overlayProtocol:2,overlaySaveSupported:true,backend:'pulse',overlay:{backend:'pulse',accepted:true,kind:'both',sourceID:1048,sinkID:1024}};};await ui.testMode('pulse');assert(ui.overlay&&ui.confirmable);ui.askSave();await ui.saveMode();assert.equal(requests[requests.length-1].backend,'pulse');ui.toggleOverlay();assert.equal(ui.backend,'converter');
 const boxes=[];ui.draw({fillRect(){},strokeRoundRect(){},line(){}},{colors:{},heading(){},text(){},drawSelection(){}},(c,x,y,w,h,run,key)=>boxes.push({x,y,w,h,run,key}));const tile=boxes.find(b=>b.key==='audio-pulse');assert(tile);assert(tile.x+tile.w<=1580);assert(boxes.find(b=>b.key==='audio-file'));assert.equal(new Set(boxes.map(b=>b.key)).size,boxes.length);
 console.log('PASS PulseAudio: concurrent streams, ducking/headroom/5 levels, tail/drain, bounded queue, cancellation/failures, isolated config, platform gate, exact save/restart, runtime dispatch and touch/joystick targets. PulseAudio process and MGU hardware mocked.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
