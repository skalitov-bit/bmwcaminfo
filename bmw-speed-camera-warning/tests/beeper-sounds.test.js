'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
const {BeeperSounds,pulse}=require('../native/bmwcaminfo-voice/beeper-sounds');
const {PcmMixer}=require('../native/bmwcaminfo-voice/pcm-mixer');
const {BeeperSoundPanel}=require('../apps/aurelm_speed_camera_warning/beeper-sound-panel');
const root=path.resolve(__dirname,'../native/bmwcaminfo-voice'),read=n=>fs.readFileSync(path.join(root,'pcm',n));
async function run(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'beeper-choice-')),file=path.join(dir,'sound.json');let busy=false;
 const d={s:{audioBackend:'converter',audioOverlay:true},mix:{busy:()=>{if(busy)throw Error('Audio busy');}}};
 try{
  let b=new BeeperSounds(d,{beeperFile:file,root});assert.equal(b.id,'1');assert.equal(b.snapshot().choices.length,8);
  for(let id=1;id<=8;id++){b.save(String(id));assert.equal(new BeeperSounds(d,{beeperFile:file,root}).id,String(id));}
  assert.throws(()=>b.save('../8'));busy=true;assert.throws(()=>b.save('1'),/busy/);busy=false;
  const original=fs.readFileSync(file,'utf8');let selected;
  b.o.sleep=async()=>{};b.o.makeBeeperOutput=s=>({set:()=>{selected=s.beeperSound;assert(pulse(s,read).equals(read('beeper-choice-2.pcm')));},clear:()=>{},close:async()=>{}});
  await b.listen({id:'2',volume:40},()=>true);assert.equal(selected,'2');assert.equal(d.s.beeperSound,'8');assert.equal(fs.readFileSync(file,'utf8'),original);assert(!d.busy&&!d.s.diagnosticBusy);
  b.o.makeBeeperOutput=()=>{throw Error('broken output');};await assert.rejects(b.listen({id:'1'},()=>true),/broken output/);assert.equal(d.s.beeperSound,'8');assert(!d.busy&&!d.s.diagnosticBusy);
  // Every source is distinct; fast repeats overlap while final tails finish naturally.
  const hashes=new Set();
  for(let id=1;id<=8;id++){
   const raw=read('beeper-choice-'+id+'.pcm');assert.equal(raw.length,48000);hashes.add(crypto.createHash('sha256').update(raw).digest('hex'));
   let now=0;const m=new PcmMixer(raw,{now:()=>now,diagnostics:true}),owner={};
   for(now=0;now<2400;now+=20){m.set({cameraId:'t',intervalMs:300,volume:100},owner);m.render(480);}
   m.clear(owner);assert(m.pending());for(now=2400;now<3600;now+=20)m.render(480);assert(!m.pending());assert.equal(m.signalStats().outputSaturatedSamples,0);
  }assert.equal(hashes.size,8);
  // Reused output engines must pick up a newly saved choice, including Overlay adapters.
  const {AudioOutput}=require('../native/bmwcaminfo-voice/audio-output');
  for(const backend of ['alsa','converter','converter-stable','converter-hold','converter-reset','converter-period','pulse'])for(const overlay of (backend==='alsa'||backend==='converter'?[false,true]:[true])){
   const service={audioBackend:backend,audioOverlay:overlay,beeperSound:'1'},output=new AudioOutput(service,{root,read}),out=output.current;out.kick=()=>{};service.beeperSound='3';
   out.set({cameraId:'choice-test',intervalMs:300,volume:100},{});
   if(out.pulse)assert(out.pulse.equals(read('beeper-choice-3.pcm')),backend);
   else{const core=out.core||out.beep;core.render(1);assert(core.tails[0].pulse.equals(read('beeper-choice-3.pcm')),backend);}
  }
  // Existing tails keep their original buffer when the next pulse selects another.
  let current=read('beeper-choice-1.pcm');const m=new PcmMixer(current,{getPulse:()=>current,now:()=>0});m.set({cameraId:'t',intervalMs:300,volume:100},{});m.render(480);const first=m.tails[0].pulse;current=read('beeper-choice-2.pcm');m.render(7200);assert.strictEqual(m.tails[0].pulse,first);assert(m.tails.some(t=>t.pulse===current));
  const p={o:{getVolume:()=>40},moving:()=>false,generation:0,change:()=>{},request:async r=>r.action==='beeper-sounds-get'?b.snapshot():r.action==='beeper-sounds-save'?b.save(r.id):{ok:true,beeperSoundsProtocol:1}};
  const panel=new BeeperSoundPanel(p);await panel.open();const targets=[];p.buttons=[];const cv={fillRect:()=>{}};panel.draw(cv,{colors:{},text:()=>{},drawSelection:()=>{}},(c,x,y,w,h,run,key)=>targets.push({run,key}));assert.equal(targets.length,11);
  targets.find(t=>t.key==='beeper-choice-3').run();assert.equal(panel.id,'3');assert.equal(b.id,'8');await panel.action('beeper-sounds-save');assert.equal(b.id,'3');
  let calls=0;p.request=async()=>{calls++;};p.moving=()=>true;await panel.action('beeper-sounds-listen');assert.equal(calls,0);
  fs.writeFileSync(file,'bad');assert.equal(new BeeperSounds(d,{beeperFile:file,root}).id,'1');
  console.log('PASS eight distinct audio assets, persistence/restart, input validation, busy/failure cleanup, draft preview, UI touch/joystick targets, overlap/no clipping/final tail. Hardware not tested.');
 }finally{for(const f of fs.readdirSync(dir))fs.unlinkSync(path.join(dir,f));fs.rmdirSync(dir);}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
