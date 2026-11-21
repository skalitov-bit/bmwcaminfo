'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const N='../native/bmwcaminfo-voice/';
const {MixerSettings,DEFAULTS,validate,fileVolume}=require(N+'mixer-settings');
const {PcmMixer,RATE}=require(N+'pcm-mixer');
const {MixerPanel}=require('../apps/aurelm_speed_camera_warning/mixer-panel');
const pcm=(value)=>{const b=Buffer.alloc(RATE*2);for(let i=0;i<b.length;i+=2)b.writeInt16LE(value,i);return b;};
async function run(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'speedcam-mixer-')),file=path.join(dir,'mix.json');
 try{
  const d={s:{fileFallback:true,audioBackend:'file',audioOverlay:true},busy:false};
  const store=new MixerSettings(d,{mixerFile:file});assert.deepStrictEqual(store.snapshot().values,DEFAULTS);
  // Old files migrate without discarding balance; strict boolean for the new switch.
  assert.deepStrictEqual(validate({voice:60,beeper:40,duck:10}),{voice:60,beeper:40,duck:10,musicDuck:true});
  assert.throws(()=>validate({voice:60,beeper:40,duck:10,musicDuck:'off'}));
  store.save({voice:60,beeper:40,duck:10,musicDuck:false});assert.equal(new MixerSettings(d,{mixerFile:file}).values.musicDuck,false);
  const v={voice:60,beeper:40,duck:10,musicDuck:true};store.save(v);assert.deepStrictEqual(new MixerSettings(d,{mixerFile:file}).snapshot().values,v);
  assert.throws(()=>validate({voice:120,beeper:40,duck:10}));assert.throws(()=>validate({voice:20,beeper:40,duck:0}));
  d.s.speechPending=1;assert.throws(()=>store.save(DEFAULTS),/busy/);d.s.speechPending=0;
  const before=fs.readFileSync(file,'utf8');let played;
  d.s.play=async(name,vol,permit,internal)=>{assert(permit.live());assert(d.s.diagnosticBusy);played={name,vol,internal};return {ok:true};};
  const preview=await store.listen({values:{voice:20,beeper:80,duck:50},volume:40},()=>true);
  assert(preview.voiceOnly);assert.equal(played.internal.mixConfig.voice,20);assert.equal(fs.readFileSync(file,'utf8'),before);assert.deepStrictEqual(d.s.audioMix,v);assert(!d.busy&&!d.s.diagnosticBusy);
  d.s.play=async()=>{throw Error('test failure');};await assert.rejects(store.listen({values:v},()=>true),/test failure/);assert(!d.busy&&!d.s.diagnosticBusy);
  assert.equal(fileVolume(40,{voice:100}),40);assert.equal(fileVolume(40,{voice:60}),20);assert.equal(fileVolume(20,{voice:20}),10);assert.equal(fileVolume(40,{voice:0}),0);
  // Measure independent channel gains and ducking using the production mixer.
  for(const values of [DEFAULTS,v,{voice:0,beeper:100,duck:50},{voice:100,beeper:0,duck:100}]){
   const m=new PcmMixer(pcm(4000),{now:()=>0,getMix:()=>values}),owner={};m.set({cameraId:'test',intervalMs:3000,volume:100},owner);
   m.enqueue(pcm(1000),100,{live:()=>true});const block=m.render(4800),actual=block.readInt16LE(block.length-2),expected=1000*values.voice/100+4000*values.beeper/100*values.duck/100;
   assert(Math.abs(actual-expected)<3,JSON.stringify({values,actual,expected}));
   m.clear(owner);m.render(RATE);m.acknowledge();assert(!m.pending());
  }
  const requests=[],parent={o:{getVolume:()=>40},moving:()=>false,generation:0,change:()=>{},request:async r=>{requests.push(r);if(r.action==='audio-mixer-get')return store.snapshot();if(r.action==='audio-mixer-save')return store.save(r.values);return {ok:true,mixerProtocol:1,musicDuckProtocol:1};}};
  const panel=new MixerPanel(parent);await panel.open();panel.change('voice',-1);assert.equal(panel.values.voice,40);assert.equal(d.s.audioMix.voice,60);
  await panel.action('audio-mixer-listen');assert.equal(requests[1].values.voice,40);assert.equal(requests[1].volume,40);assert.equal(d.s.audioMix.voice,60);
  panel.toggleMusic();assert.equal(panel.values.musicDuck,false);await panel.action('audio-mixer-save');assert.equal(d.s.audioMix.musicDuck,false);assert.equal(d.s.audioMix.voice,40);panel.reset();assert.deepStrictEqual(panel.values,DEFAULTS);assert.equal(d.s.audioMix.voice,40);
  parent.moving=()=>true;const count=requests.length;await panel.action('audio-mixer-listen');assert.equal(requests.length,count);
  fs.writeFileSync(file,'broken');const bad=new MixerSettings(d,{mixerFile:file});assert(bad.snapshot().loadError);assert.deepStrictEqual(bad.snapshot().values,DEFAULTS);
  console.log('PASS mixer: persistence/restart, malformed file, bounds, busy/failure cleanup, draft preview/save/reset, M4A quantization, measured independent PCM gains and ducking. Hardware mocked.');
 }finally{for(const f of fs.readdirSync(dir))fs.unlinkSync(path.join(dir,f));fs.rmdirSync(dir);}
}
run().catch(e=>{console.error(e);process.exitCode=1;});

