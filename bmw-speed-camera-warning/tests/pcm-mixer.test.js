'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const native=path.resolve(__dirname,'../native/bmwcaminfo-voice');
const {PcmMixer,wavHeader,RATE}=require(native+'/pcm-mixer');
const {MixedOutput}=require(native+'/pcm-output');
const {intervalFor}=require('../apps/aurelm_speed_camera_warning/overspeed-beeper');
const pcm=(n,value)=>{const b=Buffer.alloc(n*2);for(let i=0;i<n;i++)b.writeInt16LE(value,i*2);return b;};
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
async function run(){
 let now=10000;const owner={},req={cameraId:'c',intervalMs:300,volume:100};
 const m=new PcmMixer(pcm(RATE*2,4000),{now:()=>now});m.set(req,owner);
 m.render(RATE/10);const before=m.gain;let starts=0;
 const voice=m.enqueue(pcm(RATE,1000),100,{live:()=>true,started:()=>starts++});
 const mixed=m.render(RATE/10);assert.equal(starts,1);assert.equal(m.gain,0.25);assert.equal(before,1);
 assert(Math.abs(mixed.readInt16LE(mixed.length-2)-2000)<=2,'Voice + 25% beeper both present');
 now+=100;m.set({...req,intervalMs:400},owner);m.render(RATE);m.acknowledge();assert((await voice).ok);
 m.render(RATE/4);assert.equal(m.gain,1,'Restore full volume after speech');
 m.clear(owner);const lastBeat=m.lastBeat,tail=m.render(RATE/10);assert(tail.readInt16LE(tail.length-2)>0,'Started pulses finish after clear');
 m.render(RATE*2);assert.equal(m.lastBeat,lastBeat,'No new pulses after clear');assert(!m.pending());
 assert(m.render(480).every(v=>v===0),'Silence after all tails end');
 // Exact remainder of a single sample survives cancellation or lease expiry.
 for(const expire of [false,true]){
  const clean=new PcmMixer(pcm(RATE*2,4000),{now:()=>now});clean.set({...req,intervalMs:3000},owner);
  clean.render(RATE/10);if(expire)now+=1201;else clean.clear(owner);
  const remainder=clean.render(RATE*19/10);
  for(let j=0;j<remainder.length;j+=2)assert(Math.abs(remainder.readInt16LE(j)-4000)<=1,'No fade/truncation of tail');
  assert.equal(clean.lastBeat,0);assert(clean.render(480).every(v=>v===0));assert(!clean.pending());
 }
 // A final beep remains audible, but ducked, under speech after clear.
 const duckTail=new PcmMixer(pcm(RATE*2,4000),{now:()=>now});duckTail.set({...req,intervalMs:3000},owner);duckTail.render(480);duckTail.clear(owner);
 duckTail.enqueue(pcm(RATE,1000),100,{live:()=>true});const duckedTail=duckTail.render(RATE/10);
 assert(Math.abs(duckedTail.readInt16LE(duckedTail.length-2)-2000)<=2);assert.equal(duckTail.lastBeat,0);
 duckTail.fail('stop');assert(duckTail.render(480).every(v=>v===0),'Hard failure still stops playback');
 const expiry=new PcmMixer(pcm(100,1000),{now:()=>now});let started=false;
 const stale=expiry.enqueue(pcm(RATE,1000),100,{live:()=>false,started:()=>{started=true;}});expiry.pending();assert((await stale).skipped);assert(!started);
 expiry.set(req,owner);now+=1201;assert(!expiry.live());assert.throws(()=>expiry.set({...req,intervalMs:299},owner));
 const cancelled=expiry.enqueue(pcm(RATE,1000),100,{live:()=>true});expiry.fail('broken pipe');assert.equal((await cancelled).error,'broken pipe');
 // A queued voice starts during the same stream and never interrupts its beeps.
 now=0;let reads=0,writes=0,connects=0,releases=0,plays=0,pendingVoice,live=true;
 const sink={open:async()=>'/run/test.wav',write:async data=>{writes++;assert(data.length<=960);},close(){}};
 const service={waitAvailable:async()=>{},connectAudio:async()=>connects++,release:async()=>releases++,mp:{callMethod:async()=>{plays++;return {EntError:'OK'};}}};
 let lastNonzeroAt=0;sink.write=async data=>{writes++;assert(data.length<=960);if(data.some(v=>v!==0))lastNonzeroAt=now;};
 let output;output=new MixedOutput(service,{now:()=>now,read:name=>{reads++;return pcm(name.startsWith('beeper')?RATE*2:RATE,1000);},makeSink:()=>sink,sleep:async ms=>{
  now+=ms;if(now<2500)output.set({...req,intervalMs:now<1200?800:300},owner);else output.clear(owner);
  if(now>=400&&!pendingVoice)pendingVoice=output.speak('strelka.m4a',100,{live:()=>live,started:()=>{live=false;}});
 }});
 output.set({...req,intervalMs:800},owner);await output.running;assert((await pendingVoice).ok);
 assert.equal(plays,1);assert.equal(connects,1);assert.equal(releases,1);assert(writes>100);assert.equal(reads,2);
 assert(lastNonzeroAt>4200,'BMW stream stays open for the final two-second sample');
 // Failed sink cannot report successful completed voice; cleanup and retry bound.
 now=0;let closed=0;
 const failed=new MixedOutput(service,{now:()=>now,read:()=>pcm(480,1000),makeSink:()=>({open:async()=>'/run/test.wav',write:async()=>{throw Error('broken pipe');},close(){closed++;}})});
 const result=await failed.speak('strelka.m4a',100,{live:()=>true});assert(!result.ok);await failed.running;assert.equal(closed,1);assert.equal(releases,2);assert(failed.retryAt>now);await failed.close();
 // Real assets through the actual mixer: 500 m -> 100 m past at 81 km/h.
 const manifest=require(native+'/pcm-manifest.json'),component=require(native+'/component.json');
 for(const [name,info] of Object.entries(manifest)){
  const data=fs.readFileSync(native+'/'+name);assert.equal(crypto.createHash('sha256').update(data).digest('hex'),info.sha256);assert(component.files.some(f=>f.path===name));
 }
 const pulse=fs.readFileSync(native+'/pcm/beeper-sonar.pcm');assert.equal(pulse.length/2/RATE,2);
 const demo=new PcmMixer(pulse,{now:()=>now}),chunks=[],beats=[];let v1=null,v2=null,peak=0;
 for(now=0;now<26680;now+=20){
  const distance=500-now/1000*81/3.6;
  if(distance>=0)demo.set({...req,intervalMs:intervalFor(distance)},owner);else demo.clear(owner);
  if(now===1600)v1=demo.enqueue(fs.readFileSync(native+'/pcm/strelka.pcm'),100,{live:()=>true});
  if(now===13400)v2=demo.enqueue(fs.readFileSync(native+'/pcm/strelka-200.pcm'),100,{live:()=>true});
  const last=demo.lastBeat,chunk=demo.render(480);demo.acknowledge();if(last!==demo.lastBeat)beats.push({ms:now,ducked:!!demo.speech});
  for(let i=0;i<chunk.length;i+=2)peak=Math.max(peak,Math.abs(chunk.readInt16LE(i)));chunks.push(chunk);
 }
 assert((await v1).ok&&(await v2).ok);assert(beats.some(b=>b.ducked));assert(peak<=Math.ceil(32767*0.96));
 assert(beats.every(b=>b.ms<=500/(81/3.6)*1000),'No new pulses after passing target');
 const past=Buffer.concat(chunks.slice(1120,1140));assert(past.some(v=>v!==0),'Selected beeper tail survives camera passage');
 const ending=Buffer.concat(chunks.slice(-100));assert(ending.every(v=>v===0),'Silence after final tail');
 if(process.env.SPEEDCAM_AUDIO_DEMO){const out=path.resolve(process.env.SPEEDCAM_AUDIO_DEMO);fs.mkdirSync(out,{recursive:true});const raw=Buffer.concat(chunks);fs.writeFileSync(path.join(out,'sonar-voice-ducking.wav'),Buffer.concat([wavHeader(raw.length),raw]));fs.writeFileSync(path.join(out,'SONAR-TEST.json'),JSON.stringify({beats,peak,pcmAssets:Object.keys(manifest).length,bmwHardwareTested:false},null,2));}
 console.log('PASS: simultaneous PCM, 12dB ducking/restore, moving cadence during speech, expiry/cancel, single BMW stream, broken pipe/cleanup/backoff, 14 asset hashes, real audio/no clipping/pass silence. BMW/FIFO mocked.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
