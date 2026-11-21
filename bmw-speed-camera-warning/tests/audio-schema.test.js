'use strict';
const assert=require('assert');
const {extendAudioSchema,COMMAND,ROUTING,INVENTORIES,CATALOG}=require('../native/bmwcaminfo-voice/audio-schema');
// Synthetic wire contract: no BMW catalog is copied into test or release.
const catalog={interfaces:{},instanceIDs:{},datatypes:{
 Id:{type:'typedef',dataRef:'UInt16'},
 StatusBase:{type:'enum',enumWidth:1,items:{E_OK:0,E_FAILED:1}},
 Status:{type:'enum',extends:'StatusBase',enumWidth:1,items:{E_UNAVAILABLE:2}},
 Route:{type:'struct',members:[{name:'mainConnectionID',dataRef:'Id'},{name:'sourceID',dataRef:'Id'},{name:'sinkID',dataRef:'Id'}]},
 Routes:{type:'array',dataRef:'Route',arrayLengthWidth:2,arrayMinLength:0,arrayMaxLength:100},
 Availability:{type:'struct',members:[{name:'availability',dataRef:'Status'},{name:'availabilityReason',dataRef:'UInt16'}]}
}};
catalog.interfaces[COMMAND]={name:COMMAND,serviceId:101,version:{major:1,minor:0},methods:{}};
for(let i=0;i<INVENTORIES.length;i++)catalog.interfaces[COMMAND].methods[INVENTORIES[i]]={methodId:50+i,inputs:[],outputs:[{name:'amError',dataRef:'Status'},{name:'listConnections',dataRef:'Routes'}],reliable:true};
catalog.interfaces[ROUTING]={name:ROUTING,serviceId:102,version:{major:1,minor:0},methods:{hookSourceAvailablityStatusChange:{methodId:78,inputs:[{name:'sourceID',dataRef:'Id'},{name:'availability',dataRef:'Availability'}],outputs:[]}}};
catalog.instanceIDs[COMMAND]={'1':{instanceId:7}};
const oem={name:COMMAND,serviceId:101,version:{major:1,minor:0},instances:{'1':{instanceId:7}},methods:{connect:{id:3,schema:{vendor:true}},disconnect:{id:4}},properties:{volume:{id:8}}};
function read(file){assert.equal(file,CATALOG);return JSON.stringify(catalog);}
const completed=extendAudioSchema(oem,COMMAND,INVENTORIES,read);
assert.strictEqual(completed.methods.connect,oem.methods.connect);assert.strictEqual(completed.properties,oem.properties);assert(!oem.methods.getListMainSources);
assert.deepStrictEqual(completed.methods.getListMainConnections,{id:52,schema:{},retSchema:{t:'Struct',e:[{n:'amError',t:'Enum',w:1,e:{E_OK:0,E_FAILED:1,E_UNAVAILABLE:2}},{n:'listConnections',t:'ArrayD',lw:2,nl:0,xl:100,e:{t:'Struct',e:[{n:'mainConnectionID',t:'UInt16'},{n:'sourceID',t:'UInt16'},{n:'sinkID',t:'UInt16'}]}}]},reliable:true});
assert.strictEqual(extendAudioSchema(completed,COMMAND,INVENTORIES,()=>{throw Error('Must not read catalog');}),completed);
const routing=extendAudioSchema(null,ROUTING,['hookSourceAvailablityStatusChange'],read);assert.equal(routing.methods.hookSourceAvailablityStatusChange.id,78);
assert.throws(()=>extendAudioSchema(oem,COMMAND,INVENTORIES,()=>{throw Error('ENOENT');}),/catalog unavailable/);
assert.throws(()=>extendAudioSchema(oem,COMMAND,INVENTORIES,()=>'{'),/catalog unavailable/);
assert.throws(()=>extendAudioSchema({...oem,serviceId:999},COMMAND,INVENTORIES,read),/mismatch/);
assert.throws(()=>extendAudioSchema(oem,COMMAND,['notAdvertised'],read),/method absent/);
catalog.datatypes.Id.dataRef='Id';assert.throws(()=>extendAudioSchema(oem,COMMAND,INVENTORIES,read),/cyclic/);catalog.datatypes.Id.dataRef='UInt16';
delete catalog.datatypes.Routes;assert.throws(()=>extendAudioSchema(oem,COMMAND,INVENTORIES,read),/missing/);
console.log('PASS audio schema: reduced OEM definition expanded from synthetic vehicle catalog; exact IDs/wire schemas, enums/arrays/aliases; existing M4A methods retained; unavailable/malformed/unknown/cyclic catalogs refused.');
