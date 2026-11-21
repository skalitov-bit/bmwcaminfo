'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const {CarplayDuckProbe}=require('../native/bmwcaminfo-voice/carplay-duck-probe');
const {ChannelDiagnostics}=require('../native/bmwcaminfo-voice/channel-diagnostics');
const {AudioDiagnostics}=require('../apps/aurelm_speed_camera_warning/audio-diagnostics');
const {definition,createControl}=require('../native/bmwcaminfo-voice/carplay-duck-control');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'carplay-duck-'));
let serial=0;
function fixture(options){
 const o=options||{},n=++serial,writes=[],calls=[],property={type:7,name:'MSP_SOURCE_VOLUME_OFFSET_DB',units:1};let value=0,ticks=0,closed=0,released=0,alive=true,played=false;
 let routes=[{sourceID:266,sinkID:1024,mainConnectionID:91,connectionState:2}];
 const control={candidates:o.unsupported?[]:[property],async read(){return [{type:7,value,name:property.name}];},async write(id,p,v){assert.equal(id,266);writes.push(v);value=v;if(o.timeout&&v===-6)throw Error('timeout after apply');if(o.restoreFail&&v===0)throw Error('restore failed');},async close(){closed++;}};
 const s={audioOverlay:true,fileFallback:true,routeSinkId:1024,init:async()=>{},createCarplayDuckingControl:async()=>control,cc:{callMethod:async(name)=>{calls.push(name);if(name==='getListMainSources')return {listMainSources:[{name:'CarPlayMedia',sourceID:266}]};if(name==='getListMainConnections')return {listConnections:routes};throw Error('Unexpected system command: '+name);}}};
 const output={profile:{sinkID:1024,before:routes.slice()},connectAudio:async()=>{if(o.noMusic)output.profile.before=[];},mp:{callMethod:async(name)=>{assert.equal(name,'playFile');played=true;if(o.playFail)throw Error('decoder failed');return {EntError:'OK'};}},release:async()=>{released++;}};
 const opts={duckJournal:path.join(dir,n+'-pending.json'),duckReport:path.join(dir,n+'-report.json'),makeDuckOutput:()=>output,sleep:async()=>{ticks++;if(o.cancel)alive=false;if(o.routeChange)routes=[];if(o.external)value=-3;}};
 const probe=new CarplayDuckProbe(s,opts);
 return {probe,s,opts,control,property,writes,calls,run:()=>probe.run(()=>alive),value:()=>value,played:()=>played,closed:()=>closed,released:()=>released};
}
async function run(){
 let f=fixture(),r=await f.run();assert(r.apiConfirmed&&!r.duckingConfirmed&&!r.audibleConfirmed);assert.equal(r.restoration,'restored');assert.deepStrictEqual(f.writes,[-6,0]);assert.equal(f.value(),0);assert.equal(f.closed(),1);assert.equal(f.released(),1);assert(!fs.existsSync(f.probe.journal));assert(f.s.audioOverlay&&f.s.fileFallback);assert(!r.continuousBeeper);
 f=fixture({unsupported:true});r=await f.run();assert(r.error.includes('No unambiguous'));assert(!f.writes.length&&!f.played());assert(!r.apiConfirmed);
 f=fixture({noMusic:true});r=await f.run();assert(r.error.includes('Start CarPlay'));assert(!f.writes.length&&!f.played());
 for(const key of ['cancel','routeChange','playFail','timeout']){f=fixture({[key]:true});r=await f.run();assert(r.error,key);assert.equal(f.value(),0,key);assert.equal(r.restoration,'restored',key);assert(!r.apiConfirmed,key);assert(!r.recoveryPending,key);}
 f=fixture({external:true});r=await f.run();assert.equal(r.restoration,'external-change-preserved');assert.equal(f.value(),-3);assert.deepStrictEqual(f.writes,[-6]);
 f=fixture({restoreFail:true});r=await f.run();assert(r.recoveryPending&&r.restoreError);assert(fs.existsSync(f.probe.journal));
 // A persisted record from an interrupted process is restored without playback.
 f=fixture();await f.control.write(266,f.property,-6);f.probe.persist(f.probe.journal,{schema:1,sourceID:266,property:f.property,original:0,applied:-6,uncertain:false});r=await f.probe.run(()=>true,true);assert.equal(r.restoration,'restored');assert.equal(f.value(),0);assert(!f.played());
 f=fixture();f.probe.persist(f.probe.journal,{schema:1,sourceID:267,property:f.property,original:0,applied:-6});r=await f.probe.run(()=>true,true);assert(r.error&&r.recoveryPending);assert(!f.writes.length);
 // Schema and encoding are taken from declared OEM structures; bare numeric IDs
 // or unitless VOLUME enum values cannot activate a source mutation.
 const en={t:'Enum',e:{MSP_SOURCE_VOLUME_OFFSET_DB:7,MSP_VOLUME:8}},prop={t:'Struct',e:[{n:'type',...en},{n:'value',t:'Int16'}]};
 const base={methods:{getListMainSourceSoundProperties:{schema:{e:[{n:'sourceID',t:'UInt16'}]},retSchema:{e:[{n:'amError',t:'Enum'},{n:'listSourceProperties',t:'ArrayD',e:prop}]}},setMainSourceSoundProperty:{schema:{e:[{n:'sourceID',t:'UInt16'},{n:'soundProperty',...prop}]},retSchema:{e:[{n:'amError',t:'Enum'}]}}}};
 const spec=definition(base);assert.equal(spec.candidates.length,1);let args;
 const c=createControl({callMethod:async(n,a)=>{args=a;return {amError:0,listSourceProperties:[{type:'MSP_SOURCE_VOLUME_OFFSET_DB',value:0}]};}},spec);
 assert.equal((await c.read(266))[0].type,7);await c.write(266,spec.candidates[0],-6);assert.deepStrictEqual(args,{sourceID:266,soundProperty:{type:'MSP_SOURCE_VOLUME_OFFSET_DB',value:-6}});
 await assert.rejects(c.write(266,{type:8,name:'MSP_VOLUME',units:1},-6),/Unapproved/);
 const unknown=JSON.parse(JSON.stringify(base));unknown.methods.setMainSourceSoundProperty.schema.e[1].e[0].e={MSP_VOLUME:8};assert.equal(definition(unknown).candidates.length,0);
 const bad=JSON.parse(JSON.stringify(base));bad.methods.setMainSourceSoundProperty.schema.e[0].n='sinkID';assert.throws(()=>definition(bad),/schema/);
 // Service/UI integration never saves or switches the ordinary audio mode.
 f=fixture();const d=new ChannelDiagnostics(f.s,Object.assign({file:path.join(dir,'selection.json'),duck:f.probe},f.opts)),ui=new AudioDiagnostics(()=>{});
 ui.request=q=>d.handle(q,()=>true);ui.openDuck();await ui.testDucking(false);assert(ui.message.includes('громкость восстановлена'));assert(!ui.confirmable);assert(f.s.audioOverlay&&f.s.fileFallback);assert(!fs.existsSync(d.file));
 const keys=[];ui.draw({fillRect(){},strokeRoundRect(){}},{colors:{},text(){},heading(){}},(cv,x,y,w,h,fn,key)=>keys.push(key));assert.deepStrictEqual(keys,['duck-test','duck-recover']);
 ui.o.moving=()=>true;const count=f.writes.length;await ui.testDucking(false);assert(ui.message.includes('остановите'));assert.equal(f.writes.length,count);
 ui.o.moving=()=>false;ui.request=async()=>({ok:true});await ui.testDucking(false);assert(ui.message.includes('локальный звуковой компонент'));
 let finish;ui.request=()=>new Promise(resolve=>{finish=resolve;});const task=ui.testDucking(false);ui.stop();const cancelled=ui.message;finish({ok:true,duckProtocol:1,duck:{apiConfirmed:true,restoration:'restored'}});await task;assert.equal(ui.message,cancelled);
 // Diagnostic exclusion prevents a second probe and runtime speech competing.
 let unblock;d.duck={run:()=>new Promise(resolve=>{unblock=resolve;})};const pending=d.handle({action:'audio-carplay-duck-test'});assert(d.busy&&f.s.diagnosticBusy);await assert.rejects(d.handle({action:'audio-carplay-duck-test'}),/busy/);unblock({});await pending;assert(!d.busy&&!f.s.diagnosticBusy);
 console.log('PASS CarPlay ducking: source-only schema, refusal without explicit units, route guard, cancellation, decoder/write failure, readback, restore, external changes, restart recovery, UI/joystick, mode isolation. Synthetic BMW fixtures only.');
}
run().then(()=>fs.rmSync(dir,{recursive:true,force:true})).catch(e=>{console.error(e);process.exitCode=1;});
