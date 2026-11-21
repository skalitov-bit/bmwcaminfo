'use strict';
const assert=require('assert'),fs=require('fs');
const {PcmMixer}=require('../native/bmwcaminfo-voice/pcm-mixer');
const telemetry=require('../native/bmwcaminfo-voice/buffer-telemetry');
async function run(){
 const pulse=Buffer.alloc(24000),voice=Buffer.alloc(48000);
 for(let i=0;i<pulse.length/2;i++)pulse.writeInt16LE(32000,i*2);
 for(let i=0;i<voice.length/2;i++)voice.writeInt16LE(32000,i*2);
 let clock=0;const a=new PcmMixer(pulse,{now:()=>clock}),b=new PcmMixer(pulse,{now:()=>clock,diagnostics:true});
 for(const m of [a,b]){m.set({cameraId:'test',intervalMs:300,volume:100},'test');m.enqueue(voice,100,{live:()=>true});}
 for(let i=0;i<200;i++){clock=i*20;assert(a.render(480).equals(b.render(480)),'Diagnostics must not modify PCM');a.acknowledge();b.acknowledge();}
 const d=b.signalStats();assert(d.overFullScaleSamples>0&&d.limitedSamples>0&&d.minLimiterGain<1);assert(d.outputPeak<.961&&d.outputSaturatedSamples===0);assert(d.frames===96000);assert(d.maxBeepTails>1);b.resetSignalStats();assert.equal(b.signalStats().frames,0);
 const service={};const r=telemetry.start(service,{converter:true,overlay:true});
 for(let i=0;i<30;i++)telemetry.native(r,{queueFrames:i,queueCapacityFrames:5760,queueEmptyEvents:1,waitErrors:2,lastAlsaError:-32,availableFrames:512,alsaState:3,ignoredSecret:'never retain',bad:NaN});
 r.pcmSignal=d;telemetry.finish(service,r,Error('test failure'));assert.equal(r.queueSnapshots.length,8);assert.equal(r.native.queueFrames,29);assert.equal(r.native.lastAlsaError,-32);assert(!JSON.stringify(r).includes('never retain'));assert.equal(service.audioBufferHistory.lastFailure.pcmSignal.frames,96000);assert(r.events.some(x=>x.type==='alsa-wait-error'));
 for(let i=0;i<20;i++)telemetry.start(service,{});assert.equal(service.audioBufferHistory.streams.length,16);assert(JSON.stringify(service.audioBufferHistory).length<262144);
 const wasm=await WebAssembly.instantiate(fs.readFileSync(__dirname+'/pcm-queue.test.wasm'),{env:{test_failure:line=>{throw Error('Production PCM queue assertion at C line '+line);}}});assert.equal(wasm.instance.exports.main(),0);
 console.log('PASS production C queue (WASM, fake ALSA), byte-identical DSP with/without diagnostics, limiter evidence, bounded queue history and preserved failure. No MGU hardware execution.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
