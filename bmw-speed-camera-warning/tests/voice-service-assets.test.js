'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm'),crypto=require('crypto');
const root=path.resolve(__dirname,'../native/bmwcaminfo-voice');
const source=fs.readFileSync(path.join(root,'voice.js'),'utf8');
const manifest=require(path.join(root,'audio-manifest.json')),component=require(path.join(root,'component.json'));
const waits=[], calls=[];
const context={require:n=>n==='fs'?{existsSync:()=>true}:n==='./audio-manifest.json'?manifest:require(n),
  setTimeout:(fn,ms)=>{waits.push(ms);fn();},log:()=>{},VoiceService:function(){}};
vm.createContext(context);
vm.runInContext(source.slice(0,source.indexOf('function log('))+source.slice(source.indexOf('VoiceService.prototype.play ='),source.indexOf('VoiceService.prototype.release ='))+'\nthis.allowed=ALLOWED;',context);

async function run(){
  for(const [file,info] of Object.entries(manifest)){
    assert(component.files.some(f=>f.path==='audio/'+file),'Packaged asset '+file);
    const bytes=fs.readFileSync(path.join(root,'audio',file));
    assert.strictEqual(crypto.createHash('sha256').update(bytes).digest('hex'),info.sha256);
    assert(context.allowed[file]>=Math.ceil(info.durationSeconds*1000)+1000,'Route must cover recording duration');
    const service=new context.VoiceService();
    service.queue=Promise.resolve();service.waitAvailable=async()=>{};
    service.cc={getValue:async()=>[],callMethod:async()=>({amError:'E_OK',mainConnectionID:7})};
    service.mp={callMethod:async(name,args)=>{calls.push({name,args});return {EntError:'OK'};}};
    let released=false;service.release=async()=>{released=true;};
    const r=await service.play(file);
    assert.strictEqual(r.ok,true);assert(released,'Restore route after each phrase');
    assert.strictEqual(waits.pop(),context.allowed[file]);assert(calls.pop().args.path.endsWith(file));
  }
  const service=new context.VoiceService();
  await assert.rejects(service.play('toString'),/Unsupported voice asset/);
  await assert.rejects(service.play('../strelka.m4a'),/Unsupported voice asset/);
  console.log('PASS: eight packaged recordings, SHA-256 hashes, measured playback holds, route release and whitelist. BMW services are mocked.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
