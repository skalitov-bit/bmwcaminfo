'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),vm=require('vm'),assert=require('assert');
const {MusicDucker}=require('../native/bmwcaminfo-voice/music-ducker');
const {AudioOutput}=require('../native/bmwcaminfo-voice/audio-output');
const root=path.resolve(__dirname,'../native/bmwcaminfo-voice'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'music-runtime-'));
const source=fs.readFileSync(path.join(root,'voice.js'),'utf8');
const holds=[];
const ctx={require:n=>n==='fs'?Object.assign({},fs,{existsSync:p=>String(p).replace(/\\/g,'/').indexOf('/audio/')>=0||fs.existsSync(p)}):n.startsWith('./')?require(path.join(root,n)):require(n),console:{log(){}},setTimeout:(fn,ms)=>{holds.push(ms);return setImmediate(fn);},clearTimeout:clearImmediate};
vm.createContext(ctx);vm.runInContext(source.slice(0,source.indexOf('var voice =')),ctx);
let sequence=0;
async function test(fileFallback,broken,unsupported){
 holds.length=0;
 const s=vm.runInContext('new VoiceService()',ctx),calls=[],property={type:7,name:'MSP_SOURCE_VOLUME_OFFSET_DB',units:1};let offset=0,beep=true;
 s.fileFallback=fileFallback;s.audioOverlay=true;s.audioBackend=fileFallback?'pcm-fifo':'alsa';
 s.createCarplayDuckingControl=async()=>({candidates:unsupported?[]:[property],read:async()=>[{type:7,value:offset}],write:async(id,p,v)=>{assert.equal(id,266);offset=v;calls.push('offset '+v);},close:async()=>{}});
 s.cc={callMethod:async n=>{if(n==='getListMainSources')return {listMainSources:[{sourceID:266,name:'CarPlayMedia'}]};if(n==='getListMainSinks')return {listMainSinks:[{sinkID:1024,name:'MediaSink_Front'}]};if(n==='getListMainConnections')return {listConnections:[{mainConnectionID:1,sourceID:266,sinkID:1024,connectionState:2}]};throw Error('Unexpected control '+n);}};
 s.musicDucker=new MusicDucker(s,{musicDuckJournal:path.join(dir,String(++sequence)+'.json'),sleep:async()=>{}});
 const play=async()=>{assert.equal(offset,unsupported?0:-6);assert(beep);calls.push('play');if(broken)throw Error('decoder failed');return {ok:true,EntError:'OK'};};
 const mixer=new AudioOutput(s,{read:()=>Buffer.alloc(960)});
 if(fileFallback){mixer.overlayAdapter={waitAvailable:async()=>{},connectAudio:async()=>{calls.push('connect');},mp:{callMethod:async(name)=>{assert.equal(name,'playFile');return play();}},release:async()=>calls.push('release')};}
 else Object.defineProperty(mixer,'current',{get:()=>({speak:play})});
 s.mixer=mixer;
 let started=0,result,error;try{result=await s.play('strelka.m4a',40,{live:()=>true,started:()=>{started++;}});}catch(e){error=e;}
 if(broken)assert(error||result&&!result.ok);else assert(result.ok,JSON.stringify({fileFallback,result,error}));
 assert.equal(offset,0);assert(beep);assert(calls.includes('play'));if(!unsupported){assert(calls.indexOf('offset -6')<calls.indexOf('play'));assert(calls.lastIndexOf('offset 0')>calls.indexOf('play'));}
 if(fileFallback){assert(calls.includes('release'));assert.equal(started,1);}
 if(fileFallback&&!broken)assert.deepStrictEqual(holds,[3160,840],'M4A music restores before extra route hold; total unchanged');
 await s.musicDucker.close();await mixer.close();
}
async function run(){for(const file of [false,true])for(const broken of [false,true])await test(file,broken,false);await test(true,false,true);
 console.log('PASS actual VoiceService/AudioOutput: PCM and M4A+Overlay duck before voice, restore on success/failure, keep beeper and M4A routing, play on unsupported firmware. BMW mocked.');
}
run().then(()=>{for(const f of fs.readdirSync(dir))fs.unlinkSync(path.join(dir,f));fs.rmdirSync(dir);}).catch(e=>{console.error(e);process.exitCode=1;});
