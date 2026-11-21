'use strict';
const assert=require('assert');
const {collect,describe}=require('../tools/inspect_carplay_overlay');
const methods={getListMainSources:{},getListMainSinks:{},getListMainConnections:{}};
async function run(){
 let calls=[],builds=[],stopped=0,missing=false,declared=true,available=true;
 const read=f=>{
  if(f.endsWith('CommandControl.json'))return {methods};
  if(f.endsWith('MediaPlayer.json'))return {instances:declared?{OapGenericOverlay:{instanceId:42}}:{},methods:{playFile:{}}};
  if(f.endsWith('someip-interfaces.json'))return {};
  throw Error('Unexpected read');
 };
 const native={buildProxy:async(def,instance)=>{
  builds.push(instance);
  return {init:async()=>{},subscribeToAvailability:()=>{},isAvailable:async()=>available,shutdown:async()=>{stopped++;},callMethod:async k=>{
   calls.push(k);assert(instance==='1','No MediaPlayer method may be called');assert(Object.prototype.hasOwnProperty.call(methods,k),'No mutations');
   if(missing)return {};
   if(k==='getListMainSources')return {listMainSources:[{sourceID:2099,name:'OAPGenericOverlay',availability:{availability:'A_AVAILABLE'}},{sourceID:266,name:'CarPlayMedia'},{sourceID:1046,name:'OAPGenericMedia'}]};
   if(k==='getListMainSinks')return {listMainSinks:[{sinkID:1024,name:'MediaSink_Front'}]};
   return {listConnections:[{mainConnectionID:9,sourceID:266,sinkID:1024,connectionState:'CS_CONNECTED'}]};
  }};
 }};
 let r=await collect({read,native,sleep:async()=>{}});
 assert(r.readOnly&&r.overlaySourceFound&&r.inventoryComplete&&r.overlay.available);
 assert.equal(r.sources[0].id,2099,'Use reported IDs, never hard-code 1048');
 assert.equal(r.duckingConfirmed,false);assert.equal(r.carplayPlaybackConfirmed,false);
 assert.equal(r.connections[0].sourceID,266);assert.equal(stopped,2);assert.deepStrictEqual(calls,Object.keys(methods));
 available=false;r=await collect({read,native,sleep:async()=>{}});assert.strictEqual(r.overlay.available,false);
 missing=true;r=await collect({read,native,sleep:async()=>{}});assert(!r.inventoryComplete);assert(r.errors.listOfMainSources);assert(!r.overlaySourceFound);
 declared=false;builds=[];r=await collect({read,native,sleep:async()=>{}});assert.deepStrictEqual(builds,['1']);assert.strictEqual(r.overlay.available,null);
 r=describe([{sourceID:1,name:'Radio',secret:'do not export'}],[],[]);assert.deepStrictEqual(r.sources,[]);assert(!JSON.stringify(r).includes('secret'));
 console.log('PASS read-only overlay discovery: advertised IDs, unavailable/missing service, malformed inventory, no routing/playback/volume writes; no ducking claim. Hardware not tested.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
