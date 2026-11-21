'use strict';
// Read-only navigation/GPSData integration inspired by hexlay Speed Limit:
// https://github.com/hexlay/idrive7-custom-apps/blob/main/apps/speed_limit/position.js
// Independent adapter for SpeedCAM's lifecycle, quality policy and NMEA fallback.
const EventEmitter=require('events');
const {BmwGps}=require('./gps');
const {usable}=require('./gps-quality');
const {distance,bearing}=require('./gps-geometry');
const NAV='de.bmw.infotainment.navigation.positioning.Positioning';
const CAN='de.bmw.infotainment.GPSData';
const FRESH=2500,RETRY=15000;
const finite=Number.isFinite;
function canDegrees(v){return (v*.001-2147483.648)/3600;}
function coords(lat,lon){return finite(lat)&&finite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180&&(lat!==0||lon!==0);}
function closeSub(s){if(s&&s.shutdown)Promise.resolve().then(()=>s.shutdown()).catch(()=>{});}
class BmwPosition extends EventEmitter{
 constructor(ctx,options){
  super();const o=options||{};this.ctx=ctx||{};this.now=o.now||Date.now;this.vehicle=o.vehicle||(()=>({valid:false}));
  this.nmea=o.nmea||new BmwGps();this.every=o.setInterval||setInterval;this.cancel=o.clearInterval||clearInterval;
  this.running=false;this.generation=0;this.slots={};this.samples={nav:null,can:null};this.quality=null;this.nmeaState={};
  this.counts={nav:0,can:0,invalid:0};this.errors={};this.history=[];this.active=null;this.lastSignature=null;
  this.nmea.on('change',s=>{if(!this.running)return;this.nmeaState=s;this.publish();});
 }
 start(){
  if(this.running)return;this.running=true;this.generation++;this.started=this.now();this.lastNow=this.started;
  this.samples={nav:null,can:null};this.quality=null;this.nmeaState={};this.active=null;this.lastSignature=null;this.navSince=null;
  this.lastEmit=-Infinity;this.headingAnchors={};
  this.connect('nav');this.nmea.start();this.timer=this.every(()=>this.tick(),500);
 }
 stop(){
  this.running=false;this.generation++;this.cancel(this.timer);this.timer=null;
  Object.keys(this.slots).forEach(k=>closeSub(this.slots[k].sub));this.slots={};
  this.samples={nav:null,can:null};this.quality=null;this.active=null;this.nmeaState={};this.nmea.stop();
  this.emit('change',{state:'stopped',fix:null});
 }
 fresh(s,now){return !!s&&now>=s.at&&now-s.at<=FRESH;}
 connect(key){
  if(!this.running)return;const now=this.now(),old=this.slots[key];
  if(old&&(old.pending||old.sub&&!old.sub.error||now-old.at<RETRY))return;
  closeSub(old&&old.sub);const slot={at:now,pending:true,sub:null,readAt:0,busy:false},gen=this.generation;
  this.slots[key]=slot;const live=()=>this.running&&gen===this.generation&&this.slots[key]===slot;
  const handler=(field,v,at)=>{if(live())this.accept(key,field,v,at===undefined?this.now():at);};
  const fields=key==='nav'?['currentLocation']:['GPSPositionCAN','GPSPositionExtendedCAN'];
  const handlers={};fields.forEach(f=>handlers[f]=v=>handler(f,v));slot.fields=fields;slot.handler=handler;
  Promise.resolve().then(()=>{
   if(!this.ctx.signals||typeof this.ctx.signals.watch!=='function')throw Error('POSITION_SIGNALS_UNAVAILABLE');
   return this.ctx.signals.watch(key==='nav'?NAV:CAN,key==='nav'?'Main_Instance':'1',handlers,this.ctx.log);
  }).then(sub=>{if(!live()){closeSub(sub);return;}slot.pending=false;slot.sub=sub;
   this.errors[key]=sub&&sub.error?String(sub.error).slice(0,180):sub?null:'POSITION_SUBSCRIPTION_UNAVAILABLE';
  },e=>{if(live()){slot.pending=false;this.errors[key]=String(e.message||e).slice(0,180);}});
 }
 accept(key,field,v,at){
  const now=this.now();if(!this.running||now-at>1500||at>now)return;
  if(field==='GPSPositionExtendedCAN'){
   if(this.quality&&at<this.quality.at)return;
   const q=v&&v.statusQualityPositionGPSCAN;
   this.quality={value:Number.isInteger(q)&&q>=0&&q<4095?q:null,at};this.publish();return;
  }
  const previous=this.samples[key];if(previous&&at<previous.at)return;
  let lat,lon,heading=null,valid=false;
  if(key==='nav'){
   lat=v&&v.latitude;lon=v&&v.longitude;valid=!!v&&(v.coordinatesValid===true||v.coordinatesValid===1);
   if(v&&finite(v.heading)&&v.heading>=0&&v.heading<=360)heading=v.heading%360;
  }else{
   const la=v&&v.statusGPSLatitudeCAN,lo=v&&v.statusGPSLongitudeCAN;
   valid=[la,lo].every(x=>Number.isInteger(x)&&x>=0&&x<4294967293&&x!==2147483647);
   if(valid){lat=canDegrees(la);lon=canDegrees(lo);}
  }
  if(!valid||!coords(lat,lon)){this.samples[key]=null;this.counts.invalid++;this.errors[key]='INVALID_COORDINATES';this.publish();return;}
  const s={lat,lon,heading,at,status:key==='nav'&&v.status!==undefined?String(v.status).slice(0,60):null};
  if(previous&&this.fresh(previous,now)&&at>previous.at){
   const car=this.vehicle(),speed=car.valid&&finite(car.speedKmh)?car.speedKmh:130;
   const d=distance(previous,s);
   if(d>Math.max(80,speed/3.6*(at-previous.at)/1000*2+30)){this.counts.invalid++;this.errors[key]='POSITION_JUMP';return;}
  }
  const anchor=this.headingAnchors[key];
  if(!anchor||now-anchor.at>5000)this.headingAnchors[key]=s;
  else if(distance(anchor,s)>=6){if(heading===null)s.heading=bearing(anchor,s);this.headingAnchors[key]=s;}
  else if(heading===null&&previous)s.heading=previous.heading;
  this.samples[key]=s;this.counts[key]++;this.errors[key]=null;this.publish();
 }
 read(key,slot,now){
  const sub=slot.sub,s=this.samples[key];
  if(!sub||!sub.available||!sub.proxy||typeof sub.proxy.getValue!=='function'||slot.busy||now-slot.readAt<2000||s&&now-s.at<2000)return;
  slot.busy=true;slot.readAt=now;
  // Do not enter the native binding inline in another SOME/IP callback.
  setImmediate(()=>{
   if(!this.running||this.slots[key]!==slot){slot.busy=false;return;}
   Promise.all(slot.fields.map(f=>Promise.resolve().then(()=>sub.proxy.getValue(f,1500))
    .then(v=>slot.handler(f,v,now),()=>{}))).then(()=>{slot.busy=false;});
  });
 }
 tick(){
  if(!this.running)return;const now=this.now();
  if(now<this.lastNow||now-this.lastNow>10000){this.stop();this.start();return;}this.lastNow=now;
  this.connect('nav');
  const navSlot=this.slots.nav;
  if(navSlot&&navSlot.sub&&navSlot.sub.available===false)this.samples.nav=null;
  const nav=this.samples.nav;
  if(!this.fresh(nav,now)&&now-(nav?nav.at:this.started)>=5000)this.connect('can');
  if(this.fresh(nav,now)){
   if(!this.navSince)this.navSince=now;
   if(this.slots.can&&now-this.navSince>=15000){closeSub(this.slots.can.sub);delete this.slots.can;this.samples.can=null;this.quality=null;}
  }else this.navSince=null;
  Object.keys(this.slots).forEach(k=>{const slot=this.slots[k];if(slot.sub&&slot.sub.available===false)this.samples[k]=null;this.read(k,slot,now);});
  this.publish();
 }
 nativeFix(key,now){
  const s=this.samples[key],slot=this.slots[key];if(!this.fresh(s,now)||slot&&slot.sub&&slot.sub.available===false)return null;
  // Unlike Speed Limit, unknown CAN quality is not treated as a valid fix.
  if(key==='can'&&(!this.fresh(this.quality,now)||this.quality.value===null||!(this.quality.value&((1<<5)|(1<<7)|(1<<8)))))return null;
  const car=this.vehicle(),n=this.nmeaState.fix;
  const speed=car.valid&&finite(car.speedKmh)?car.speedKmh:n&&now-n.timeMs<=3000&&now>=n.timeMs?n.speedKmh:null;
  if(!finite(speed)||speed<0||speed>350)return null;
  return {lat:s.lat,lon:s.lon,headingDeg:s.heading,speedKmh:speed,accuracyM:null,timeMs:s.at,
   source:key==='nav'?'BMW Navigation':'BMW GPSData',positionSource:key,coordinatesValid:true,
   timeBasis:'local_receipt_or_getter_start',accuracySource:'not_reported',navigationStatus:s.status,
   positionQuality:key==='can'?this.quality.value:null,speedSource:car.valid?'Vehicle2':'NMEA'};
 }
 snapshot(){
  const now=this.now(),nav=this.nativeFix('nav',now),n=this.nmeaState.fix;
  const nmea=this.running&&n&&now-n.timeMs<=3000&&n.timeMs<=now+500?n:null;
  const f=nav||(usable(nmea,now)?nmea:null)||this.nativeFix('can',now)||nmea;
  return Object.assign({},this.nmeaState,{state:f?'fix':this.running?'searching':'stopped',fix:f||null,
   positionSource:f&&(f.positionSource||'nmea'),ageMs:f?now-f.timeMs:null,
   eventsReceived:(this.nmeaState.eventsReceived||0)+this.counts.nav+this.counts.can,
   invalidEvents:(this.nmeaState.invalidEvents||0)+this.counts.invalid});
 }
 captureFix(){
  // Adding a point still requires a measured accuracy. Native validity alone
  // cannot qualify a five-fix survey; use the independently retained NMEA fix.
  const n=this.nmeaState.fix,car=this.vehicle();
  if(!this.running||!require('./gps-quality').precise(n,this.now()))return null;
  return Object.assign({},n,{speedKmh:car.valid?Math.max(n.speedKmh,car.speedKmh):n.speedKmh});
 }
 publish(){
  if(!this.running)return;const s=this.snapshot(),source=s.positionSource||null;
  const changed=source!==this.active;
  if(changed){this.history.push({at:this.now(),from:this.active,to:source,reason:source?'best_available_valid_source':'no_fresh_complete_position'});if(this.history.length>12)this.history.shift();this.active=source;}
  // Native navigation may notify much faster than NMEA. Limit camera/cache work
  // to 2 Hz; the existing 10 Hz display interpolation remains independent.
  if(!changed&&s.fix&&s.fix.positionSource&&this.now()-this.lastEmit<500)return;
  const sig=JSON.stringify([s.fix,s.state]);if(sig===this.lastSignature)return;this.lastSignature=sig;this.lastEmit=this.now();this.emit('change',s);
 }
 diagnosticReport(now,effectiveFix){
  const r=this.nmea.diagnosticReport(now,effectiveFix),s=this.snapshot();r.source=effectiveFix&&effectiveFix.source||s.fix&&s.fix.source||'unavailable';
  r.positioning={priority:['nav','usable NMEA','qualified GPSData'],selected:s.positionSource,
   samples:this.samples,quality:this.quality,errors:this.errors,counts:this.counts,transitions:this.history.slice(),
   subscriptions:Object.keys(this.slots).map(k=>({source:k,available:!!(this.slots[k].sub&&this.slots[k].sub.available),pending:this.slots[k].pending})),
   note:'Navigation/GPSData supply no metre accuracy or verified measurement UTC here. Local receipt/getter-start age only; quality comes from BMW validity/quality fields. NMEA keeps its own UTC and accuracy.'};
  return r;
 }
}
module.exports={BmwPosition,NAV,CAN,canDegrees};
