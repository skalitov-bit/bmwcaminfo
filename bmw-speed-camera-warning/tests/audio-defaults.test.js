'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),vm=require('vm');
const native=path.resolve(__dirname,'../native/bmwcaminfo-voice');
const {ChannelDiagnostics}=require(native+'/channel-diagnostics');
const {AudioOutput}=require(native+'/audio-output');
const app=require('../apps/aurelm_speed_camera_warning/app.json');
const source=fs.readFileSync(native+'/voice.js','utf8');
function startup(){
 const ctx={require:n=>n.startsWith('./')?require(path.join(native,n)):require(n),console};
 vm.createContext(ctx);vm.runInContext(source.slice(0,source.indexOf('var beeper =')),ctx);return ctx.voice;
}
async function run(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'speedcam-defaults-')),file=path.join(dir,'route.json');
 try{
  const fresh=startup(),d=new ChannelDiagnostics(fresh,{file});
  const current=await d.handle({action:'audio-current'});
  assert.equal(current.active.backend,'pulse');assert.equal(current.active.overlay,true);assert(!current.saved);assert(!fresh.fileFallback);
  const mixer=new AudioOutput(fresh,{read:()=>fs.readFileSync(native+'/pcm/beeper-sonar.pcm')});assert.strictEqual(mixer.current,mixer.pulse);await mixer.close();
  for(const route of [{backend:'file',overlay:true},{backend:'alsa',overlay:false},{backend:'converter',overlay:true}]){
   const saved=Object.assign({sinkID:2049,sourceID:2048},route);fs.writeFileSync(file,JSON.stringify(saved));
   const s=startup(),restored=new ChannelDiagnostics(s,{file});const r=await restored.handle({action:'audio-current'});
   assert.equal(r.active.backend,route.backend);assert.equal(r.active.overlay,route.overlay);assert.equal(s.fileFallback,route.backend==='file');
   assert.equal(fs.readFileSync(file,'utf8'),JSON.stringify(saved),'Default never overwrites a saved route');
  }
  // The actual packaged settings loader: defaults first, saved choices second.
  const kit=fs.readFileSync(path.resolve(process.argv[2]),'utf8');
  const definition=kit.match(/class Settings[\s\S]*?\n}\n/)[0];
  const Settings=new Function('fs','path','DATA_DIR','log',definition+'\nreturn Settings;')(fs,path,dir,{warn(){}});
  let settings=new Settings(app.settings);assert.equal(settings.get('audio_force_notifications'),'off');assert.equal(settings.get('notification_volume'),'40');
  fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({audio_force_notifications:'on',notification_volume:'80'}));
  settings=new Settings(app.settings);assert.equal(settings.get('audio_force_notifications'),'on','Explicit engineering preference is retained');assert.equal(settings.get('notification_volume'),'80','Saved volume is retained');
  console.log('PASS actual startup defaults: PulseAudio + Overlay, live PulseAudio mixer, saved routes retained, force-audio default off, volume level 2, saved preferences retained');
 }finally{for(const name of fs.readdirSync(dir))fs.unlinkSync(path.join(dir,name));fs.rmdirSync(dir);}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
