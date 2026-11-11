'use strict';
const assert=require('assert');
const {MapcamWarnings,inHours,pointHit}=require('../apps/aurelm_speed_camera_warning/mapcam-warnings');
const {CameraIndex}=require('../apps/aurelm_speed_camera_warning/camera-index');
const origin={lat:56,lon:48},M=111320,cos=Math.cos(56*Math.PI/180);
const coord=(x,y)=>({lat:origin.lat+y/M,lon:origin.lon+x/(M*cos)});
const camera=changes=>Object.assign({id:'mapcam-1',source:'MapCam.info',name:'Test',lat:56,lon:48,limit:60,
 mapcamTypeCode:1,mapcamDirectionType:1,mapcamApproachHeadingDeg:0,mapcamAngleDeg:60,
 mapcamWarningDistanceM:500,mapcamPath:[],mapcamControlDirection:0,mapcamHours:null},changes);
const fix=(x,y,t,speed=72)=>Object.assign(coord(x,y),{speedKmh:speed,headingDeg:0,accuracyM:5,timeMs:t});
let tests=0;
function test(name,fn){fn();tests++;console.log('PASS',name);}
function pair(c,options,a,b){const w=new MapcamWarnings(options);w.update(a,[c],a.timeMs);return {w,events:w.update(b,[c],b.timeMs)};}
test('First fix silent, configured database distance and speed limit',()=>{
 const c=camera(),w=new MapcamWarnings();assert.deepStrictEqual(w.update(fix(0,-520,1000),[c],1000),[]);
 const events=w.update(fix(0,-500,2000),[c],2000);
 assert(events.some(e=>e.type==='camera'));assert(events.some(e=>e.type==='voice'));
 assert(events.some(e=>e.type==='speeding'&&e.limitKmh===60));
 assert(!w.update(fix(0,-480,3000),[c],3000).some(e=>e.type==='voice'));
});
test('Base distance and override independent of legacy 500/700 rule',()=>{
 const c=camera({mapcamWarningDistanceM:1000});
 assert(pair(c,{},fix(0,-920,1000),fix(0,-900,2000)).events.some(e=>e.type==='camera'));
 assert(!pair(c,{distanceM:500},fix(0,-920,1000),fix(0,-900,2000)).events.length);
 assert(!pair(camera({mapcamWarningDistanceM:200}),{},fix(0,-320,1000),fix(0,-300,2000)).events.length);
});
test('Wrong direction, sideways camera and narrow sector rejected',()=>{
 assert(!pair(camera(),{},fix(0,520,1000),fix(0,500,2000)).events.length);
 assert(!pair(camera(),{},fix(-400,-20,1000),fix(-400,0,2000)).events.length);
 assert(!pair(camera({mapcamAngleDeg:10}),{},fix(70,-520,1000),fix(70,-500,2000)).events.length);
 assert(pointHit(camera({mapcamAngleDeg:120}),fix(70,-300,1000),0,120,500));
});
test('Bidirectional and omnidirectional cameras',()=>{
 for(const dt of [0,2])assert(pair(camera({mapcamDirectionType:dt}),{},fix(0,510,1000),fix(0,490,2000)).events.some(e=>e.type==='camera'));
 assert(!pair(camera({mapcamApproachHeadingDeg:null}),{},fix(0,-510,1000),fix(0,-490,2000)).events.length,'Unknown direction must not become north');
});
test('Minimum speed strictly above 15 and accuracy strictly below 15',()=>{
 for(const speed of [0,5,15])assert(!pair(camera(),{},fix(0,-510,1000,speed),fix(0,-490,2000,speed)).events.length);
 const bad=fix(0,-490,2000);bad.accuracyM=15;
 assert(!pair(camera(),{},fix(0,-510,1000),bad).events.length);
});
test('Duplicate/out-of-order, stale GPS and implausible jumps',()=>{
 const c=camera(),w=new MapcamWarnings(),a=fix(0,-510,1000),b=fix(0,-490,2000);
 w.update(a,[c],1000);w.update(b,[c],2000);
 assert(!w.update(b,[c],2000).length);assert(!w.update(a,[c],2000).length);
 assert(!w.update(b,[c],6000).length);assert.strictEqual(Object.keys(w.states).length,0);
 assert(!pair(c,{},fix(0,-900,1000),fix(0,-100,2000)).events.length);
});
test('Voice settings and unknown limits',()=>{
 assert(!pair(camera(),{voice:'off'},fix(0,-510,1000),fix(0,-490,2000)).events.some(e=>e.voice));
 assert(!pair(camera(),{voice:'speeding',excessKmh:18},fix(0,-510,1000,77),fix(0,-490,2000,77)).events.some(e=>e.voice));
 assert(pair(camera(),{voice:'speeding',excessKmh:18},fix(0,-510,1000,78),fix(0,-490,2000,78)).events.some(e=>e.voice));
 assert(!pair(camera({limit:null}),{voice:'speeding'},fix(0,-510,1000),fix(0,-490,2000)).events.some(e=>e.voice||e.type==='speeding'));
});
test('Point passage and rear control',()=>{
 for(const rear of [0,1]){
  const c=camera({mapcamControlDirection:rear}),w=new MapcamWarnings();
  w.update(fix(0,-30,1000),[c],1000);w.update(fix(0,-10,2000),[c],2000);
  const e=w.update(fix(0,10,3000),[c],3000);
  if(rear){assert.strictEqual(w.states[c.id].phase,'rear');assert(!e.some(x=>x.type==='end'));
   for(let y=30;y<=110;y+=20)w.update(fix(0,y,3000+(y-10)*50),[c],3000+(y-10)*50);
   assert(!w.states[c.id]);
  }else{assert(e.some(x=>x.type==='end'));assert(!w.states[c.id]);}
 }
});
test('20 minute repeat filter survives suspend/reset but expires',()=>{
 const c=camera(),w=new MapcamWarnings();
 const pass=t=>{w.reset();w.update(fix(0,-510,t),[c],t);return w.update(fix(0,-490,t+1000),[c],t+1000);};
 assert(pass(1000).some(e=>e.voice));assert(!pass(10000).some(e=>e.voice));assert(pass(1202000).some(e=>e.voice));
});
const route=[coord(0,0),coord(0,1000)].map(p=>[p.lat,p.lon]);
test('Section entry, distance to end, measured mean, stops and exit',()=>{
 const c=camera({mapcamTypeCode:4,mapcamPath:route}),w=new MapcamWarnings();
 w.update(fix(0,-10,1000),[c],1000);w.update(fix(0,10,2000),[c],2000);
 let st=w.states[c.id];assert.strictEqual(st.phase,'section');assert.strictEqual(st.partialSection,false);
 assert(Math.abs(st.distanceM-990)<1);assert.strictEqual(st.averageKmh,null);
 w.update(fix(0,30,3000),[c],3000);assert(Math.abs(st.averageKmh-72)<1);
 w.update(fix(0,30,4000,0),[c],4000);assert(Math.abs(st.averageKmh-36)<1,'Stopped time counts');
 let events=[];for(let y=50;y<=1010;y+=20){const t=4000+(y-30)*50;events=w.update(fix(0,y,t),[c],t);}
 assert(events.some(e=>e.type==='end'));assert(!w.states[c.id]);
});
test('Mid-section reconnection is partial; opposing/parallel paths excluded',()=>{
 const c=camera({mapcamTypeCode:4,mapcamPath:route});
 const {w}=pair(c,{},fix(0,490,1000),fix(0,510,2000));assert(w.states[c.id].partialSection);
 w.suspend();assert(!Object.keys(w.states).length);
 assert(!pair(c,{},fix(0,510,1000),fix(0,490,2000)).events.length);
 assert(!pair(c,{},fix(80,490,1000),fix(80,510,2000)).events.length);
});
test('Long section indexed when entry camera is more than 2 km away',()=>{
 const end=coord(0,20000),c=camera({mapcamTypeCode:4,mapcamPath:[[56,48],[end.lat,end.lon]]});
 const index=new CameraIndex([c]),a=fix(0,10000,1000),b=fix(0,10020,2000);
 assert.deepStrictEqual(index.near(a,100).map(c=>c.id),[c.id]);
 assert(pair(c,{},a,b).events.some(e=>e.phase==='section'));
});
test('Optional hours with midnight and unknown fields',()=>{
 assert(inHours([22,6],23));assert(inHours([22,6],2));assert(!inHours([22,6],12));
 assert(inHours(null,12));assert(inHours([0,0],12));assert(inHours([31,31],12));
});
console.log('MapCam scenarios passed:',tests);
