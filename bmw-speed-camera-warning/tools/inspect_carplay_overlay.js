'use strict';
// Read-only discovery, NOT an audio test. Run using Node 8 on the MGU.
// No connect/disconnect, source-availability changes, playback or volume writes.
const fs=require('fs'),path=require('path');
const {extendAudioSchema,COMMAND,INVENTORIES,CATALOG}=require('../native/bmwcaminfo-voice/audio-schema');
const {readList}=require('../native/bmwcaminfo-voice/command-control');
const MP='de.bmw.infotainment.entertainment.mediaplayer.MediaPlayer';
const INSTANCE='OapGenericOverlay';
const ROOTS=['/usr/lib/oap-mainapp','/usr/lib/oap-mainapp21'];
const clean=v=>typeof v==='string'?v.replace(/[\x00-\x1f]/g,' ').slice(0,120):null;
const id=v=>Number.isInteger(v)&&v>=0&&v<=65535?v:null;
function availability(v){return v?{availability:typeof v.availability==='number'?v.availability:clean(v.availability),availabilityReason:id(v.availabilityReason)}:null;}
function describe(sources,sinks,connections){
 const src=sources.filter(s=>/^(OAPGeneric(Media|Overlay|Interrupt)|CarPlayMedia|CarLifeMedia)$/i.test(s.name||''));
 return {
  sources:src.map(s=>({id:id(s.sourceID),name:clean(s.name),availability:availability(s.availability),sourceClassID:id(s.sourceClassID)})),
  sinks:sinks.slice(0,64).map(s=>({id:id(s.sinkID),name:clean(s.name),availability:availability(s.availability),sinkClassID:id(s.sinkClassID)})),
  connections:connections.filter(c=>src.some(s=>s.sourceID===c.sourceID)).slice(0,128).map(c=>({id:id(c.mainConnectionID),sourceID:id(c.sourceID),sinkID:id(c.sinkID),state:typeof c.connectionState==='number'?c.connectionState:clean(c.connectionState)})),
  overlaySourceFound:src.some(s=>/^OAPGenericOverlay$/i.test(s.name||'')),
  // A source, available service or connected route does not prove ducking.
  duckingConfirmed:false,carplayPlaybackConfirmed:false
 };
}
function bounded(p,ms){return new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Read-only discovery timed out')),ms);Promise.resolve(p).then(v=>{clearTimeout(t);resolve(v);},e=>{clearTimeout(t);reject(e);});});}
async function collect(options){
 const o=options||{},read=o.read||((f)=>JSON.parse(fs.readFileSync(f,'utf8'))),report={schemaVersion:1,readOnly:true,errors:{}};
 let base,ccDef,mpDef,catalog;
 for(const root of ROOTS){try{ccDef=read(path.posix.join(root,'src-gen/org_genivi_am_commandinterface_CommandControl.json'));base=root;break;}catch(e){}}
 if(!base)throw Error('BMW CommandControl definition unavailable');
 try{catalog=read(CATALOG);}catch(e){report.errors.catalog=clean(e.message);}
 ccDef=extendAudioSchema(ccDef,COMMAND,INVENTORIES,()=>{if(!catalog)throw Error('No vehicle catalog');return JSON.stringify(catalog);});
 try{mpDef=read(path.posix.join(base,'src-gen/de_bmw_infotainment_entertainment_mediaplayer_MediaPlayer.json'));}catch(e){report.errors.mediaPlayerDefinition=clean(e.message);}
 const instances=Object.assign({},catalog&&catalog.instanceIDs&&catalog.instanceIDs[MP]||{},mpDef&&mpDef.instances||{});
 report.overlay={instance:INSTANCE,declared:Object.prototype.hasOwnProperty.call(instances,INSTANCE),available:null,
  methods:mpDef?Object.keys(mpDef.methods||{}).filter(k=>['playFile','sendButtonEvent','stop','pause'].includes(k)):[]};
 const native=o.native||require('/usr/lib/someip.node');let cc,mp;
 try{
  cc=await bounded(native.buildProxy(ccDef,'1'),3000);await bounded(cc.init(),3000);
  // Subscribe before reads: required by some versions of BMW's binding.
  if(typeof cc.subscribeToAvailability==='function')cc.subscribeToAvailability(()=>{});
  const lists=[];
  for(const key of ['listOfMainSources','listOfMainSinks','listOfMainConnections']){
   try{lists.push(await readList(cc,key,2500));}catch(e){report.errors[key]=clean(e.message);lists.push([]);}
  }
  Object.assign(report,describe(lists[0],lists[1],lists[2]));
  report.inventoryComplete=Object.keys(report.errors).filter(k=>/^listOf/.test(k)).length===0;
  if(report.overlay.declared&&mpDef){
   try{
    mp=await bounded(native.buildProxy(Object.assign({},mpDef,{instances}),INSTANCE),3000);
    await bounded(mp.init(),3000);
    let announced=false;
    if(typeof mp.subscribeToAvailability==='function')mp.subscribeToAvailability(a=>{announced=a===true;});
    const sleep=o.sleep||(ms=>new Promise(r=>setTimeout(r,ms)));
    for(let i=0;i<5;i++){
     const available=typeof mp.isAvailable==='function'?await bounded(mp.isAvailable(),500):announced;
     if(available===true){report.overlay.available=true;break;}
     await sleep(150);
    }
    if(report.overlay.available!==true)report.overlay.available=false;
   }catch(e){report.errors.overlayAvailability=clean(e.message);}
  }
 }finally{
  for(const p of [mp,cc]){try{if(p&&typeof p.shutdown==='function')await bounded(p.shutdown(),500);}catch(e){report.errors.cleanup=clean(e.message);}}
 }
 report.nextStep='Confirm overlay route and mixing policy on this MGU before any playback; no sink is selected automatically.';
 return report;
}
module.exports={collect,describe};
if(require.main===module)setImmediate(()=>{
 const watchdog=setTimeout(()=>{console.error('Discovery deadline exceeded');process.exit(1);},20000);
 collect().then(r=>{console.log(JSON.stringify(r,null,2));clearTimeout(watchdog);process.exit(r.inventoryComplete?0:2);},e=>{console.error(JSON.stringify({readOnly:true,error:clean(e.message)}));clearTimeout(watchdog);process.exit(1);});
});
