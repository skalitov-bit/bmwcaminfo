'use strict';
// Deterministic queue model, NOT an ALSA driver or vehicle benchmark.
// 20 ms producer blocks; consumer drains 1 ms per tick. Producer pauses are
// injected after warm-up at all 20 possible chunk phases. No extra pipe reserve
// is assumed. Restart follows each empty queue; samples are never discarded.
const assert=require('assert'),fs=require('fs');
const path=require('path');
const native=fs.readFileSync(path.join(__dirname,'../native/bmwcaminfo-voice/alsa-probe.c'),'utf8');
const telemetry=require('../native/bmwcaminfo-voice/buffer-telemetry');
assert(native.includes('pcm_params(pcm,2,3,channels,rate,1,192000)'));
assert.equal(telemetry.start({},{}).requestedLatencyMs,192,'Diagnostics must match the native request');
function simulate(capacity,stallMs,phase){
 let queue=capacity,missing=0,underruns=0,inUnderrun=false,maxQueue=queue;
 const start=1000+phase,end=start+stallMs;
 for(let t=0;t<4000;t++){
  if(!(t>=start&&t<end)&&t%20===0)while(queue<=capacity-20)queue+=20;
  maxQueue=Math.max(maxQueue,queue);
  if(queue>0){queue--;inUnderrun=false;}else{missing++;if(!inUnderrun)underruns++;inUnderrun=true;}
 }
 return {missing,underruns,maxQueue};
}
const result={kind:'deterministic finite-queue model; no real ALSA or MGU',chunkMs:20,phases:20,rows:[]};
for(const stallMs of [0,40,80,120,160,240])for(const bufferMs of [64,128,192]){
 const runs=Array.from({length:20},(_,phase)=>simulate(bufferMs,stallMs,phase));
 result.rows.push({stallMs,bufferMs,phasesWithUnderrun:runs.filter(r=>r.underruns).length,maxMissingMs:Math.max(...runs.map(r=>r.missing))});
 assert(runs.every(r=>r.maxQueue<=bufferMs));
}
const row=(s,b)=>result.rows.find(r=>r.stallMs===s&&r.bufferMs===b);
assert.equal(row(0,64).maxMissingMs,0);assert(row(80,64).phasesWithUnderrun>0);
for(const s of [40,80,120,160])assert.equal(row(s,192).phasesWithUnderrun,0);
assert(row(240,192).phasesWithUnderrun>0,'Large buffer is not a cure for sustained stalls');
result.memory=[{mode:'Converter 24kHz mono S16',oldBytes:3072,newBytes:9216,extraBytes:6144},{mode:'ALSA 48kHz stereo S16',oldBytes:12288,newBytes:36864,extraBytes:24576}];
result.maxAdditionalQueueLatencyMs=128;
if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
