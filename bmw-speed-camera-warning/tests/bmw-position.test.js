'use strict';
const assert=require('assert'),EventEmitter=require('events');
const {BmwPosition,NAV,CAN,canDegrees}=require('../apps/aurelm_speed_camera_warning/bmw-position');
const quality=require('../apps/aurelm_speed_camera_warning/gps-quality');
const {MapcamWarnings}=require('../apps/aurelm_speed_camera_warning/mapcam-warnings');
const {GpsOutputStatus}=require('../apps/aurelm_speed_camera_warning/gps-output-status');
const {MapOrientation}=require('../apps/aurelm_speed_camera_warning/map-projection');
const {gpsHealth}=require('../apps/aurelm_speed_camera_warning/notification-rules');
const {decision}=require('../apps/aurelm_speed_camera_warning/gps-diagnostics');
const flush=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));};
class Nmea extends EventEmitter{start(){}stop(){}diagnosticReport(n,f){return {schema:1,decision:decision(f,n)};} send(f){this.emit('change',{state:'fix',fix:f});}}
let count=0;
async function test(name,fn){await fn();count++;console.log('PASS '+name);}
function harness(){
 let now=10000,car={valid:true,speedKmh:72};const calls=[],nmea=new Nmea();
 const ctx={signals:{watch:(iface,instance,handlers)=>{
  const s={available:true,handlers,iface,instance,closed:false,shutdown(){this.closed=true;},proxy:{getValue:()=>Promise.reject(Error('no getter'))}};
  calls.push(s);return Promise.resolve(s);
 }}};
 const p=new BmwPosition(ctx,{nmea,now:()=>now,vehicle:()=>car,setInterval:()=>1,clearInterval:()=>{}});
 return {p,nmea,calls,start:async()=>{p.start();await flush();},set:t=>now=t,car:v=>car=v,
  nav:(y=0,valid=true)=>calls.filter(x=>x.iface===NAV).slice(-1)[0].handlers.currentLocation({latitude:56+y/111320,longitude:48,heading:0,coordinatesValid:valid}),
  nf:(t,y=0,a=7)=>({lat:56+y/111320,lon:48,speedKmh:72,headingDeg:0,timeMs:t,accuracyM:a,source:'BMW SatellitePositioning'})};
}
async function run(){
 await test('Navigation preferred; no fabricated metre accuracy; output accepts validity',async()=>{
  const h=harness();await h.start();try{h.nmea.send(h.nf(10000));h.nav();const f=h.p.snapshot().fix;
   assert.equal(f.positionSource,'nav');assert.equal(f.accuracyM,null);assert(quality.usable(f,10000));assert(!quality.precise(f,10000));
   assert.equal(decision(f,10000).reason,'accepted_vehicle_validity_accuracy_not_reported');
   assert.equal(new GpsOutputStatus().update(f,10000,false,true),'');assert(/НАВИГАЦИЯ/.test(gpsHealth(f,10000)));
   assert.equal(new MapOrientation().update(Object.assign({},f,{headingDeg:90})),90);
   assert.equal(h.calls[0].instance,'Main_Instance');assert(!h.calls.some(c=>c.iface===CAN));
  }finally{h.p.stop();}
 });
 await test('Stale or explicitly invalid navigation immediately falls back to measured NMEA',async()=>{
  const h=harness();await h.start();try{h.nav();h.set(12000);h.nmea.send(h.nf(12000));h.set(12501);h.p.tick();assert.equal(h.p.snapshot().fix.source,'BMW SatellitePositioning');
   h.nav(20);assert.equal(h.p.snapshot().fix.positionSource,'nav');h.nav(20,false);assert.equal(h.p.snapshot().fix.source,'BMW SatellitePositioning');
   h.set(16000);h.p.tick();assert.equal(h.p.snapshot().fix,null);
  }finally{h.p.stop();}
 });
 await test('Missing optional service preserves NMEA and retries at bounded intervals',async()=>{
  const h=harness();let calls=0;h.p.ctx.signals.watch=()=>{calls++;return Promise.reject(Error('not in catalog'));};await h.start();
  try{h.nmea.send(h.nf(10000));assert(h.p.snapshot().fix);h.set(11000);h.p.tick();await flush();assert.equal(calls,1);
   h.set(15000);h.p.tick();await flush();h.set(25000);h.p.tick();await flush();assert.equal(calls,3);assert(/not in catalog/.test(h.p.errors.nav));
  }finally{h.p.stop();}
 });
 await test('GPSData conversion, explicit quality, NMEA priority, expiry and sentinel rejection',async()=>{
  const h=harness();await h.start();try{h.set(15000);h.p.tick();await flush();const can=h.calls.find(c=>c.iface===CAN);assert(can);
   const raw=deg=>Math.round((deg*3600+2147483.648)/.001),send=()=>can.handlers.GPSPositionCAN({statusGPSLatitudeCAN:raw(56),statusGPSLongitudeCAN:raw(48)});
   send();assert.equal(h.p.snapshot().fix,null,'unknown quality is not silently usable');
   can.handlers.GPSPositionExtendedCAN({statusQualityPositionGPSCAN:256});assert.equal(h.p.snapshot().fix.positionSource,'can');assert(Math.abs(canDegrees(raw(56))-56)<1e-6);
   h.nmea.send(h.nf(15000,0,109));assert.equal(h.p.snapshot().fix.positionSource,'can','valid CAN can replace unreliable NMEA');
   h.nmea.send(h.nf(15000));assert.equal(h.p.snapshot().fix.source,'BMW SatellitePositioning');
   h.nmea.send(null);can.handlers.GPSPositionCAN({statusGPSLatitudeCAN:4294967295,statusGPSLongitudeCAN:raw(48)});assert.equal(h.p.snapshot().fix,null);
   send();can.handlers.GPSPositionExtendedCAN({statusQualityPositionGPSCAN:4095});assert.equal(h.p.snapshot().fix,null);
   can.handlers.GPSPositionExtendedCAN({statusQualityPositionGPSCAN:32});assert(h.p.snapshot().fix);h.set(17501);assert.equal(h.p.snapshot().fix,null);
  }finally{h.p.stop();}
 });
 await test('No speed means no native fix, not standstill; no cross-source heading borrowing',async()=>{
  const h=harness();h.car({valid:false});await h.start();try{h.nav();assert.equal(h.p.snapshot().fix,null);h.nmea.send(h.nf(10000));assert.equal(h.p.snapshot().fix.speedSource,'NMEA');
   h.set(13100);h.nav();assert.equal(h.p.snapshot().fix,null);
  }finally{h.p.stop();}
 });
 await test('Shutdown, delayed subscriptions, sleep and unavailable provider cannot revive position',async()=>{
  const h=harness();await h.start();h.nav();const old=h.calls[0];h.p.stop();old.handlers.currentLocation({latitude:56,longitude:48,heading:0,coordinatesValid:true});assert.equal(h.p.snapshot().fix,null);
  await h.start();try{h.nav();h.calls[1].available=false;assert.equal(h.p.snapshot().fix,null);h.set(21001);h.p.tick();await flush();assert.equal(h.p.snapshot().fix,null);assert(old.closed);
  }finally{h.p.stop();}
  const late=harness();let resolve;late.p.ctx.signals.watch=()=>new Promise(r=>resolve=r);late.p.start();await flush();late.p.stop();let closed=false;resolve({shutdown:()=>closed=true});await flush();assert(closed);
 });
 await test('Jump rejection and report retains source, validity and no claimed accuracy',async()=>{
  const h=harness();await h.start();try{h.nav();h.set(11000);h.nav(1000);assert.equal(h.p.snapshot().fix.lat,56);assert.equal(h.p.errors.nav,'POSITION_JUMP');
   const report=h.p.diagnosticReport(11000,h.p.snapshot().fix);assert.equal(report.source,'BMW Navigation');assert.equal(report.positioning.selected,'nav');assert(report.positioning.transitions.length);assert(report.positioning.errors.nav);assert(!report.decision.blocked);
  }finally{h.p.stop();}
 });
 await test('Real camera detector triggers with navigation positions and preserves NMEA quality cutoff',async()=>{
  const h=harness();await h.start();try{
   const engine=new MapcamWarnings(),c={id:'c',warningProfile:'hybrid-v1',lat:56,lon:48,limit:60,mapcamTypeCode:1,mapcamDirectionType:1,mapcamApproachHeadingDeg:0,mapcamAngleDeg:60,mapcamWarningDistanceM:500};
   h.nav(-520);assert.deepStrictEqual(engine.update(h.p.snapshot().fix,[c],10000),[]);h.set(11000);h.nav(-500);
   assert(engine.update(h.p.snapshot().fix,[c],11000).some(e=>e.type==='camera'));
   assert(!quality.usable(h.nf(11000,0,109),11000));assert(!quality.usable(Object.assign(h.nf(11000),{accuracyM:null}),11000));
  }finally{h.p.stop();}
 });
 await test('High-rate navigation is bounded to 2 Hz and loss bypasses the throttle',async()=>{
  const h=harness();await h.start();let count=0;h.p.on('change',()=>count++);
  try{for(let i=0;i<10;i++){h.set(10000+i*100);h.nav(i*2);}assert.equal(count,2);
   h.nav(0,false);assert.equal(count,3);assert.equal(h.p.snapshot().fix,null);
  }finally{h.p.stop();}
 });
 await test('Quiet-source getters retain request time, ignore late responses and release CAN after recovery',async()=>{
  const h=harness();await h.start();try{
   h.nav();let resolve;h.calls[0].proxy.getValue=()=>new Promise(r=>resolve=r);
   h.set(12000);h.p.tick();await flush();h.set(14000);resolve({latitude:56,longitude:48,coordinatesValid:true});await flush();
   assert.equal(h.p.snapshot().fix,null,'late getter cannot revive a stale fix');
   h.set(15000);h.p.tick();await flush();const can=h.calls.find(c=>c.iface===CAN);assert(can);
   for(let t=15000;t<=31000;t+=1000){h.set(t);h.nav();h.p.tick();await flush();}
   assert(can.closed);assert(!h.p.slots.can);
  }finally{h.p.stop();}
 });
 console.log('BMW position: '+count+' tests passed');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
