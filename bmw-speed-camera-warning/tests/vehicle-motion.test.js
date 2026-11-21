'use strict';
const assert=require('assert'),path=require('path');
const base=path.resolve(process.argv[2]||path.join(__dirname,'../apps/aurelm_speed_camera_warning'));
const {VehicleSpeed}=require(path.join(base,'vehicle-speed'));
const {MotionDistance}=require(path.join(base,'motion-distance'));
let cases=0;
function check(name,fn){fn();cases++;console.log('PASS '+name);}
function rig(speed){
 let t=1000,v={valid:true,speedKmh:speed===undefined?36:speed};
 const m=new MotionDistance({now:()=>t,wall:()=>100000+t,vehicle:()=>v});
 const camera={id:'a',lat:55.01,lon:37,limit:60};
 const fix=(options)=>Object.assign({lat:55,lon:37,timeMs:100000+t,speedKmh:v.speedKmh,headingDeg:0,accuracyM:5},options);
 m.observeGps(fix());t+=1000;m.observeGps(fix());
 const anchor=(distance,opts)=>{t++;const f=fix(opts);m.observeGps(f);m.anchor({camera,distanceM:distance,state:{phase:'point'},active:true},f);};
 anchor(500);
 return {m,anchor,fix,step:ms=>{t+=ms;return m.value();},vehicle:x=>{v=Object.assign({},v,x);m.vehicleChanged();}};
}
check('100 ms integrates vehicle speed; GPS is never modified',()=>{
 const r=rig(90),before=r.m.lastGps.timeMs;
 assert(Math.abs(r.step(100).distanceM-497.5)<.01);
 assert.strictEqual(r.m.lastGps.timeMs,before);
});
check('Vehicle/GPS disagreement rejects reserve and stays rejected after GPS expires',()=>{
 const r=rig(36);r.vehicle({speedKmh:90});r.m.observeGps(null);
 assert.strictEqual(r.step(100),null);assert.strictEqual(r.step(3100),null);
});
check('An explicitly lost GPS retains only the existing active target briefly',()=>{
 const r=rig(36);r.m.observeGps(null);
 const p=r.step(100);assert(p.estimated);assert.strictEqual(p.hit.camera.id,'a');
 for(let i=0;i<49;i++)r.step(100);
 assert(r.m.value());assert.strictEqual(r.step(1),null);
});
check('80 m travel limit bounds reserve even at high speed',()=>{
 const r=rig(180);r.m.observeGps(null);
 for(let i=0;i<16;i++)assert(r.step(100));
 assert.strictEqual(r.step(100),null);
});
check('25 m uncertainty limit is independent of time/travel bounds',()=>{
 const r=rig(36);r.anchor(500,{accuracyM:14});r.m.observeGps(null);
 for(let i=0;i<34;i++)assert(r.step(100));
 assert.strictEqual(r.step(100),null);
});
check('No predicted camera crossing or zero-distance confirmation',()=>{
 const r=rig(36);r.anchor(20);r.m.observeGps(null);
 for(let i=0;i<7;i++)assert(r.step(100));
 assert.strictEqual(r.step(100),null);
});
check('Stale vehicle signal ends fallback immediately',()=>{
 const r=rig();r.m.observeGps(null);assert(r.step(100));r.vehicle({valid:false});
 assert.strictEqual(r.m.value(),null);r.vehicle({valid:true});assert.strictEqual(r.m.value(),null);
});
check('GPS-only smoothing stops extrapolating after 1.2 s and cannot reserve',()=>{
 const r=rig();r.vehicle({valid:false});r.step(1200);const d=r.m.value().distanceM;
 assert.strictEqual(r.step(1000).distanceM,d);assert.strictEqual(r.step(1000),null);
});
check('Turns and non-active previews cannot be carried through GPS loss',()=>{
 const r=rig();r.step(100);r.anchor(480,{headingDeg:30});r.m.observeGps(null);assert.strictEqual(r.m.value(),null);
 const q=rig();q.m.anchorState.hit.active=false;q.m.observeGps(null);assert.strictEqual(q.m.value(),null);
});
check('Fresh GPS resumes after fallback expiry, small corrections remain continuous',()=>{
 const r=rig();for(let i=0;i<60;i++)r.step(100);assert.strictEqual(r.m.value(),null);
 r.anchor(450);assert(r.m.value());assert(!r.m.value().estimated);
 r.step(1000);const before=r.m.value().distanceM;r.anchor(before+3);
 assert(Math.abs(r.m.value().distanceM-before)<.02);
 assert(Math.abs(r.step(400).distanceM-(before+3-4))<.01);
});
check('Stationary vehicle and perpendicular heading do not invent progress',()=>{
 const r=rig(0);assert.strictEqual(r.step(1000).distanceM,500);
 const q=rig(36);q.anchor(500,{headingDeg:90});assert(Math.abs(q.step(1000).distanceM-500)<.01);
});
check('Large timer gaps and older GPS samples cannot extend a reserve',()=>{
 const r=rig();r.m.observeGps(null);assert.strictEqual(r.step(2000),null);
 const q=rig(),at=q.m.lastGps.timeMs;q.m.observeGps(q.fix({timeMs:at-1}));assert.strictEqual(q.m.lastGps.timeMs,at);
});
check('A frozen wall clock cannot extend the five-second reserve',()=>{
 let mono=0,wall=100000;const m=new MotionDistance({now:()=>mono,wall:()=>wall,vehicle:()=>({valid:true,speedKmh:0})});
 const f=t=>({lat:55,lon:37,timeMs:t,accuracyM:5,speedKmh:0,headingDeg:0});
 m.observeGps(f(wall-1000));m.observeGps(f(wall));
 m.anchor({camera:{id:'clock',lat:55.01,lon:37},distanceM:500,active:true},f(wall));m.observeGps(null);
 for(let i=0;i<50;i++){mono+=100;assert(m.value());}
 mono+=100;assert.strictEqual(m.value(),null);
});
async function signalTests(){
 let t=0,handler,poll,shutdown=0,reads=0,resolveRead;
 const sub={available:true,shutdown:()=>{shutdown++;},proxy:{getValue:()=>{reads++;return new Promise(resolve=>{resolveRead=resolve;});}}};
 const ctx={signals:{watch:async(i,n,h)=>{assert.strictEqual(n,'1');handler=h.statusCarSpeed2;return sub;}}};
 const v=new VehicleSpeed(ctx,{now:()=>t,setInterval:f=>{poll=f;return 7;},clearInterval:id=>assert.strictEqual(id,7)});
 await v.start();handler({speedVehicleCentreOfGravity:6400});assert.strictEqual(v.snapshot().speedKmh,100);
 t=1501;assert(!v.snapshot().valid);
 for(const invalid of [65535,-1,NaN,Infinity,'6400',30000]){handler({speedVehicleCentreOfGravity:invalid});assert(!v.snapshot().valid);}
 assert.strictEqual(v.snapshot().invalid,6);
 t=2000;poll();poll();await Promise.resolve();assert.strictEqual(reads,1);
 t=2100;handler({speedVehicleCentreOfGravity:3200});resolveRead({speedVehicleCentreOfGravity:6400});
 await new Promise(resolve=>setImmediate(resolve));assert.strictEqual(v.snapshot().speedKmh,50,'Delayed getter cannot overwrite newer event');
 sub.available=false;assert(!v.snapshot().valid);v.close();await Promise.resolve();assert.strictEqual(shutdown,1);
 const missing=new VehicleSpeed({});await missing.start();assert(!missing.snapshot().valid);missing.close();
 console.log('PASS vehicle signal parsing, staleness, invalid sentinel, availability, bounded polling and cleanup');
 console.log('PASS '+cases+' motion cases + vehicle signal suite');
}
signalTests().catch(e=>{console.error(e);process.exit(1);});
