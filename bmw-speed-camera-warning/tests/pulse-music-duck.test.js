'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const {fixture}=require('./stable-shared-output.test');
const {AudioOutput}=require('../native/bmwcaminfo-voice/audio-output');
const {MusicDucker}=require('../native/bmwcaminfo-voice/music-ducker');
const {MixerSettings}=require('../native/bmwcaminfo-voice/mixer-settings');
const {musicStatus}=require('../apps/aurelm_speed_camera_warning/mixer-panel');
async function run(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pulse-duck-'));
 try{
  for(const mode of ['on','off','unsupported','failure','preview-on','preview-off']){
   const f=fixture(path.join(dir,'route-'+mode));let offset=0,voicePairs=0,beepPairs=0,overlap=0,started=0;const writes=[];
   f.s.audioBackend='pulse';f.s.audioOverlay=true;f.s.fileFallback=false;
   const saved=mode!=='off'&&mode!=='preview-on',preview=mode==='preview-on'?true:mode==='preview-off'?false:saved;
   const mix=new MixerSettings(f.d,{mixerFile:path.join(dir,'mix-'+mode)});mix.save({voice:60,beeper:40,duck:25,musicDuck:saved});
   f.s.createCarplayDuckingControl=async()=>{if(mode==='unsupported')throw Error('Source property units/types are not declared');return {candidates:[{type:7,name:'MSP_SOURCE_VOLUME_OFFSET_DB',units:1}],read:async()=>[{type:7,value:offset}],write:async(id,p,value)=>{assert.equal(id,266);offset=value;writes.push(value);},close:async()=>{}};};
   f.s.musicDucker=new MusicDucker(f.s,{musicDuckJournal:path.join(dir,'journal-'+mode),sleep:async()=>{}});
   const shouldDuck=preview&&mode!=='unsupported';
   const opts=Object.assign({},f.o,{getMix:()=>({voice:60,beeper:40,duck:25,musicDuck:preview}),read:()=>{const b=Buffer.alloc(4800);for(let i=0;i<b.length;i+=2)b.writeInt16LE(5000,i);return b;},makePulseRuntime:()=>({stats:{},check:async()=>{},start:async()=>{started++;},writePair:async(v,b)=>{
    const speaking=v.some(x=>x),beeping=b.some(x=>x);if(beeping)beepPairs++;if(speaking){voicePairs++;assert.equal(offset,shouldDuck?-6:0);if(beeping)overlap++;if(mode==='failure')throw Error('simulated output failure');}
   },drain:async()=>{},close:async()=>{}})});
   const out=new AudioOutput(f.s,opts),owner={};let timer;
   try{
    const beat=()=>out.set({cameraId:'test',intervalMs:700,volume:40},owner);beat();timer=setInterval(beat,400);
    const result=await out.speak('camera-500.m4a',40,{live:()=>true});assert.equal(result.ok,mode!=='failure');assert.equal(offset,0);assert(voicePairs&&beepPairs&&overlap);
    assert.deepStrictEqual(writes,shouldDuck?[-6,0]:[]);assert.equal(f.s.audioMix.musicDuck,saved,'Preview must not change saved preference');
    if(mode!=='failure'){assert(out.running,'Beeper remains active after music restoration');assert.equal(started,1);}
    if(mode==='unsupported'){assert(!f.s.musicDucker.snapshot().apiConfirmed);assert(musicStatus({musicDucking:f.s.musicDucker.snapshot()}).includes('НЕДОСТУПНО'));}
   }finally{clearInterval(timer);out.clear(owner);if(out.running)await out.running;await out.close();await f.s.musicDucker.close();await f.s.mixer.close();}
   assert.equal(f.routes.length,1,'CarPlay remains connected');console.log('PASS PulseAudio music duck '+mode+': actual writer/wrapper, simultaneous beeper, source-only volume and restoration. BMW/Pulse process mocked.');
  }
 }finally{for(const name of fs.readdirSync(dir))fs.unlinkSync(path.join(dir,name));fs.rmdirSync(dir);}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
