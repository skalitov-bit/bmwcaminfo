'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.resolve(__dirname,'../native/bmwcaminfo-voice');
const schema=require(path.join(root,'audio-schema'));
async function check(missingCatalog){
 const cc={name:schema.COMMAND,serviceId:101,version:{major:1,minor:0},methods:{connect:{id:1},disconnect:{id:2}}};
 const mp={name:'OEM MediaPlayer',methods:{playFile:{id:3}}};
 const cat={interfaces:{},datatypes:{},instanceIDs:{}};
 cat.interfaces[schema.COMMAND]={name:schema.COMMAND,serviceId:101,version:{major:1,minor:0},methods:{}};
 schema.INVENTORIES.forEach((n,i)=>{cat.interfaces[schema.COMMAND].methods[n]={methodId:40+i,inputs:[],outputs:[]};});
 cat.interfaces[schema.ROUTING]={name:schema.ROUTING,serviceId:102,version:{major:1,minor:0},methods:{hookSourceAvailablityStatusChange:{methodId:70,inputs:[],outputs:[]}}};
 const read=(file)=>{
  if(file===schema.CATALOG){if(missingCatalog)throw Error('ENOENT');return JSON.stringify(cat);}
  if(file.endsWith('CommandControl.json'))return JSON.stringify(cc);
  if(file.endsWith('MediaPlayer.json'))return JSON.stringify(mp);
  throw Error('Unexpected read '+file);
 };
 const definitions=[],calls=[],instances=[];
 const binding={buildProxy:async(def,instance)=>{
  definitions.push(def);instances.push(instance);
  return {init:async()=>{},subscribe(){},isAvailable:async()=>true,callMethod:async(name,args)=>{
   if(!def.methods[name])throw Error('Unknown method name '+name);
   calls.push(name);
   if(name==='getListMainConnections')return {amError:'E_OK',listConnections:[]};
   return {amError:'E_OK',mainConnectionID:10};
  }};
 }};
 const context={setTimeout,clearTimeout,console:{log(){}},require:n=>{
  if(n==='fs')return {existsSync:p=>!p.endsWith('RoutingControlObserver.json'),readFileSync:read};
  if(n==='/usr/lib/someip.node')return binding;
  if(n==='./audio-schema')return Object.assign({},schema,{extendAudioSchema:(base,name,methods)=>schema.extendAudioSchema(base,name,methods,read)});
  return n.startsWith('./')?require(path.join(root,n)):require(n);
 }};
 const src=fs.readFileSync(path.join(root,'voice.js'),'utf8');vm.runInNewContext(src.slice(0,src.indexOf('var voice = new VoiceService();')),context);
 const service=new context.VoiceService();await service.init();
 assert.deepStrictEqual(JSON.parse(JSON.stringify(definitions[1])),mp,'M4A MediaPlayer must remain OEM');
 assert.deepStrictEqual(JSON.parse(JSON.stringify(definitions[0].methods.connect)),cc.methods.connect);
 if(missingCatalog){assert(/catalog unavailable/.test(service.inventoryError));await service.connectAudio();assert(calls.includes('connect'),'M4A route still works when optional catalog is missing');}
 else{assert(!service.inventoryError);assert.deepStrictEqual(await service.readConnections(),[]);assert.equal(definitions[0].methods.getListMainConnections.id,42);await service.createRoutingObserver();assert.equal(definitions[2].methods.hookSourceAvailablityStatusChange.id,70);
  await assert.rejects(service.createOverlayPlayer(),/not declared/);
  cat.instanceIDs['de.bmw.infotainment.entertainment.mediaplayer.MediaPlayer']={OapGenericOverlay:{instanceId:88}};
  const previous=service.mp;await service.createOverlayPlayer();assert.equal(instances[instances.length-1],'OapGenericOverlay');assert.strictEqual(service.mp,previous,'Overlay must not replace working M4A proxy');assert.equal(definitions[definitions.length-1].instances.OapGenericOverlay.instanceId,88);
 }
}
check(false).then(()=>check(true)).then(()=>console.log('PASS service initializes full audio proxies from reduced OEM definitions, generates routing observer when missing, preserves M4A without catalog. BMW mocked.')).catch(e=>{console.error(e);process.exitCode=1;});
