'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm'),crypto=require('crypto'),EventEmitter=require('events');
const base=path.resolve(process.argv[2]||path.join(__dirname,'../apps/aurelm_speed_camera_warning'));
const root=path.resolve(__dirname,'../native/bmwcaminfo-voice');
const source=fs.readFileSync(path.join(root,'voice.js'),'utf8');
const assets=require(path.join(root,'audio-manifest.json'));
const levels=require(path.join(root,'volume-manifest.json')),component=require(path.join(root,'component.json'));
const played=[],routes=[],requests=[];
const context={require:n=>n==='fs'?{existsSync:p=>fs.existsSync(p.replace(/\\/g,'/').replace('/var/opt/bmwcaminfo-voice/current',root))}:n==='./audio-manifest.json'?assets:require(n),
 setTimeout:fn=>fn(),log:()=>{},VoiceService:function(){}};
vm.createContext(context);
vm.runInContext(source.slice(0,source.indexOf('function log('))+source.slice(source.indexOf('VoiceService.prototype.play ='),source.indexOf('VoiceService.prototype.release =')),context);
const service=new context.VoiceService();service.queue=Promise.resolve();service.waitAvailable=async()=>{};
service.cc={getValue:async()=>[],callMethod:async(name,args)=>{routes.push({name,args});return {amError:'E_OK',mainConnectionID:7};}};
service.mp={callMethod:async(name,args)=>{played.push({name,args:{path:args.path.replace(/\\/g,'/')}});return {EntError:'OK'};}};
service.release=async()=>routes.push({name:'release'});
let legacy=false,connections=0,level='100';
class Socket extends EventEmitter{
 setEncoding(){} destroy(){}
 write(raw){const r=JSON.parse(raw);requests.push(r);Promise.resolve().then(async()=>{
  let result;
  if(legacy&&r.action!=='play')result={ok:false,error:'Unknown action or audio file'};
  else result=await service.play(r.file,r.action==='play-volume'?r.volume:undefined);
  this.emit('data',JSON.stringify(result)+'\n');
 }).catch(e=>this.emit('data',JSON.stringify({ok:false,error:e.message})+'\n'));}
}
const moduleObject={exports:{}};
vm.runInNewContext(fs.readFileSync(path.join(base,'voice-alert.js'),'utf8'),{module:moduleObject,require:n=>n==='net'?{createConnection:()=>{connections++;const s=new Socket();setImmediate(()=>s.emit('connect'));return s;}}:require(require.resolve(n,{paths:[base]})),setTimeout,clearTimeout});
async function run(){
 assert(require(path.join(base,'cluster-text')).hasGlyph('%'),'Volume percent must not render as a missing glyph');
 const voice=new moduleObject.exports.CameraVoiceAlerts({getVolume:()=>level});
 for(const volume of [100,90,50,10]){
  level=String(volume);assert(await voice.camera(1,()=>true,{camera_model:'СТРЕЛКА'}));
  const request=requests.pop(),play=played.pop();
  assert.strictEqual(request.action,volume===100?'play':'play-volume');
  assert.strictEqual(play.name,'playFile');
  assert(play.args.path.endsWith(volume===100?'/audio/strelka.m4a':'/audio/volume-'+volume+'/strelka.m4a'));
 }
 assert(routes.every(r=>r.name==='connect'||r.name==='release'),'Never change master, sink or music volume');
 const before=connections;level='0';assert(await voice.test());assert.strictEqual(connections,before,'Mute does not even connect to the service');
 assert((await service.play('camera-500.m4a',0)).muted);assert.strictEqual(connections,before);
 for(const value of [-10,101,55,NaN,Infinity,'50',null])await assert.rejects(service.play('camera-500.m4a',value),/Invalid voice volume/);
 legacy=true;level='50';const count=requests.length;assert.strictEqual(await voice.test(),false);
 assert.strictEqual(requests.length,count+1,'No full-volume fallback on old service');assert(voice.lastError.includes('0.1.11'));
 legacy=false;level='40';assert(await voice.test());assert.strictEqual(voice.lastError,null);
 assert(played.pop().args.path.endsWith('/volume-40/camera-500.m4a'));
 // Validate every model/stage/profile, packaged bytes and the measured gain.
 assert.strictEqual(Object.keys(levels).length,Object.keys(assets).length*9);
 for(const [relative,entry] of Object.entries(levels)){
  assert(component.files.some(f=>f.path===relative));
  assert.strictEqual(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,relative))).digest('hex'),entry.sha256);
  assert(Math.abs(entry.rmsRatio-entry.volume/100)<.025);
  assert((await service.play(entry.source,entry.volume)).ok);
  assert(played.pop().args.path.endsWith('/'+relative));
 }
 // Queued speech reads the latest saved setting when it actually dispatches.
 level='100';const pending=voice.test();level='20';assert(await pending);
 assert.strictEqual(requests.pop().volume,20);
 console.log('PASS: client-to-service volume requests, 72 checked audio profiles, mute without route, strict validation, latest setting at dispatch, legacy rejection without loud fallback; no master-volume changes. BMW proxies mocked.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
