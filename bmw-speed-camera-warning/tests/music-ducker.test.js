'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os');
const {MusicDucker,musicName,wrapOutput}=require('../native/bmwcaminfo-voice/music-ducker');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'music-duck-'));let serial=0;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function rejects(p,re){let error;try{await p;}catch(e){error=e;}assert(error&&re.test(error.message));}
function fixture(options){
 const o=options||{},property={name:'MSP_SOURCE_VOLUME_OFFSET_DB',type:7,units:o.units||1};
 if(o.units===10)property.name='MSP_SOURCE_VOLUME_OFFSET_01DB';
 const f={writes:[],calls:[],values:{266:0,300:2*(o.units||1)},sources:[{sourceID:266,name:'CarPlayMedia'},{sourceID:300,name:'USBMedia'},{sourceID:1048,name:'OapGenericOverlay'},{sourceID:400,name:'Navigation'},{sourceID:500,name:'Phone'}],active:[266],played:0};
 const c={candidates:o.unsupported?[]:[property],read:async id=>{if(o.readFail&&f.values[id]===-6&&!f.readFailed){f.readFailed=true;throw Error('proxy lost during sleep');}return [{type:7,value:f.values[id]||0}];},write:async(id,p,value)=>{
  assert(![1048,400,500].includes(id));f.writes.push({id,value});
  if(o.slowWrite&&value<0)await sleep(80);
  if(o.restoreFail&&value===0)throw Error('restore unavailable');
  f.values[id]=value;if(o.writeFail&&value<0)throw Error('timeout after write');
 },close:async()=>{f.closed=true;}};
 f.s={createCarplayDuckingControl:async()=>{f.created=(f.created||0)+1;if(o.factoryFail)throw Error('No declared source control');return c;},cc:{callMethod:async(name)=>{
  f.calls.push(name);if(name==='getListMainSources')return {listMainSources:f.sources};
  if(name==='getListMainSinks')return {listMainSinks:[{sinkID:1024,name:'MediaSink_Front'}]};
  if(name==='getListMainConnections')return {listConnections:f.active.concat([1048,400,500]).map((id,i)=>({sourceID:id,sinkID:1024,mainConnectionID:i+1,connectionState:2}))};
  throw Error('Unexpected command '+name);
 }}};
 f.d=new MusicDucker(f.s,{musicDuckJournal:path.join(dir,String(++serial)+'.json'),sleep:async()=>{},prepareMs:o.prepareMs||800});f.s.musicDucker=f.d;f.c=c;f.property=property;
 f.play=fn=>f.d.withVoice({live:()=>true},async()=>{f.played++;if(fn)await fn();return {ok:true};},600);
 return f;
}
async function run(){
 assert(musicName('CarPlayMedia')&&musicName('Bluetooth_A2DP')&&musicName('Tuner_FM'));assert(!musicName('Navigation')&&!musicName('Phone')&&!musicName('OapGenericOverlay'));
 for(const name of ['FmDABCombined','OnlineEntertainment','ExternalDeviceBtA','ExternalDeviceBtB','ExternalDeviceUsbFrontA','ExternalDeviceUsbFrontBSingle'])assert(musicName(name));
 for(const name of ['FmDABAnnouncement','CarPlayMediaTelephony','HFPSource_1','CarLifeMedia','OAPGenericMedia','OAPGenericInterrupt'])assert(!musicName(name));
 let f=fixture();f.s.audioMix={musicDuck:false};await f.play();assert.equal(f.created||0,0);assert(!f.calls.length&&!f.writes.length);assert.equal(f.d.snapshot().state,'disabled');await f.d.close();
 // An unsaved mixer preview must override the saved switch in both directions.
 for(const saved of [true,false]){
  f=fixture();f.s.audioMix={musicDuck:saved};let beeping=true;
  const output=wrapOutput({speak:async()=>{assert(beeping);assert.equal(f.values[266],saved?0:-6);return {ok:true};}},f.s,{getMix:()=>({musicDuck:!saved})});
  await output.speak('strelka.m4a',40,{live:()=>true});assert.equal(f.values[266],0);assert.equal(f.s.audioMix.musicDuck,saved);assert.equal(f.writes.length,saved?0:2);await f.d.close();
 }
 // Turning the switch off does not abandon a pending restore after a restart.
 f=fixture();f.s.audioMix={musicDuck:false};f.values[266]=-6;
 fs.writeFileSync(f.d.file,JSON.stringify({schema:2,entries:[{sourceID:266,name:'CarPlayMedia',property:f.property,original:0,applied:-6,uncertain:false}]}));
 await f.play(()=>assert.equal(f.values[266],0));assert.deepStrictEqual(f.writes,[{id:266,value:0}]);assert(!fs.existsSync(f.d.file));await f.d.close();
 f=fixture();await f.play(()=>assert.equal(f.values[266],-6));assert.deepStrictEqual(f.writes,[{id:266,value:-6},{id:266,value:0}]);assert(!fs.existsSync(f.d.file));assert(f.d.status.apiConfirmed);await f.d.close();
 f=fixture({units:10});f.active=[300];await f.play(()=>assert.equal(f.values[300],-40));assert.equal(f.values[300],20);await f.d.close();
 f=fixture();f.active=[266,300];await f.play(()=>{assert.equal(f.values[266],-6);assert.equal(f.values[300],-4);});assert.equal(f.values[300],2);assert.equal(f.values[266],0);await f.d.close();
 for(const option of ['unsupported','factoryFail']){f=fixture({[option]:true});await f.play();assert.equal(f.played,1);assert(!f.writes.length);assert(!f.d.status.apiConfirmed);await f.d.close();}
 f=fixture();f.active=[];await f.play();assert(!f.writes.length);await f.d.close();
 f=fixture();f.d.legacyJournal=path.join(dir,'legacy-pending.json');fs.writeFileSync(f.d.legacyJournal,'{}');await f.play();assert(!f.writes.length&&f.played===1);await f.d.close();fs.unlinkSync(f.d.legacyJournal);
 f=fixture();await rejects(f.play(()=>{throw Error('decoder failed');}),/decoder/);assert.equal(f.values[266],0);await f.d.close();
 f=fixture();await f.play(()=>{f.values[266]=-3;});assert.equal(f.values[266],-3);assert.equal(f.writes.length,1);assert(f.d.status.history.some(e=>e.state==='external-change-preserved'));await f.d.close();
 f=fixture();await f.play(async()=>{f.values[266]=-3;await f.d.serial(()=>f.d.reconcile(f.d.token));assert.equal(f.values[266],-3);await f.d.serial(()=>f.d.reconcile(f.d.token));assert.equal(f.writes.length,1);});await f.d.close();
 f=fixture();await f.play(async()=>{f.active=[300];await f.d.serial(()=>f.d.reconcile(f.d.token));assert.equal(f.values[266],0);assert.equal(f.values[300],-4);});assert.equal(f.values[300],2);await f.d.close();
 f=fixture({writeFail:true});await f.play();assert.equal(f.values[266],0);assert(!fs.existsSync(f.d.file));await f.d.close();
 f=fixture({readFail:true});await f.play();assert.equal(f.values[266],0);assert(f.created>=2);assert(!fs.existsSync(f.d.file));await f.d.close();
 f=fixture({slowWrite:true,prepareMs:25});await f.play(()=>assert.equal(f.values[266],0));assert.equal(f.values[266],0);assert(f.d.status.history.some(e=>e.detail.includes('timed out')));await f.d.close();
 f=fixture({restoreFail:true});await f.play();assert(f.d.status.recoveryPending);assert(fs.existsSync(f.d.file));await f.d.close();
 const recovered=fixture();recovered.d.file=f.d.file;recovered.values[266]=-6;await recovered.d.recover();assert.equal(recovered.values[266],0);assert(!fs.existsSync(recovered.d.file));await recovered.d.close();
 f=fixture();let unblock;const a=f.play(()=>new Promise(r=>{unblock=r;}));while(!unblock)await sleep(1);const b=f.play();const busy=await f.play();assert(busy.retryable);assert.equal(f.writes.filter(w=>w.value===-6).length,1);unblock();await Promise.all([a,b]);assert.equal(f.values[266],0);await f.d.close();
 f=fixture();const skipped=await f.d.withVoice({live:()=>false},()=>{throw Error('Must not play');},0);assert(skipped.skipped&&!f.writes.length);await f.d.close();
 f=fixture();const output={set:()=>{f.beeping=true;},clear:()=>{f.beeping=false;},speak:async()=>{assert(f.beeping);assert.equal(f.values[266],-6);return {ok:true};}};wrapOutput(output,f.s);output.set();await output.speak('camera.m4a',40,{live:()=>true});assert(f.beeping);assert.equal(f.values[266],0);await f.d.close();
 console.log('PASS music duck: source-only -6dB (dB/0.1dB), CarPlay/USB/multiple sources, switch, restoration, external changes, failure, unsupported/slow firmware, late write recovery, restart journal, bounded voice queue, continuous beeper untouched. BMW mocked.');
}
run().then(()=>{for(const n of fs.readdirSync(dir))fs.unlinkSync(path.join(dir,n));fs.rmdirSync(dir);}).catch(e=>{console.error(e);process.exitCode=1;});
