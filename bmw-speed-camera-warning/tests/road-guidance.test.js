'use strict';
const assert=require('assert');
const {RoadGuidanceWarnings,candidate,prepare}=require('../apps/aurelm_speed_camera_warning/road-guidance');
const camera={id:'road-camera',name:'Test camera',lat:56.63,lon:47.928,limit:60};
const zone={id:camera.id,lat:camera.lat,lon:camera.lon,travel:[0,180],roads:[
 {id:'main-way',pts:[[0,-1000],[0,1000]],camM:1000,dir:0},
 {id:'cross-way',pts:[[-150,0],[150,0]],camM:null,dir:0}
]};
function fix(northM,time,speed){
 return {lat:camera.lat+northM/111320,lon:camera.lon,speedKmh:speed||36,headingDeg:0,accuracyM:5,timeMs:time};
}
let w=new RoadGuidanceWarnings([zone]),events=[];
events=events.concat(w.update(fix(-300,100000,36),[camera],100000));
assert.strictEqual(events.length,0,'One GPS sample is not enough to confirm approach');
events=events.concat(w.update(fix(-290,101000,36),[camera],101000));
assert.strictEqual(events.filter(e=>e.type==='camera'&&e.stage===1).length,1,'Warn after two fresh approaching fixes on the matched road');
for(let i=2;i<=11;i++)events=events.concat(w.update(fix(-300+i*10,100000+i*1000,36),[camera],100000+i*1000));
assert.strictEqual(events.filter(e=>e.type==='camera'&&e.stage===2).length,1,'Repeat warning at 200 m along the road');
assert(events.every(e=>e.roadConfirmed),'Every warning must have road confirmation');

w=new RoadGuidanceWarnings([zone]);
assert.strictEqual(w.update(fix(100,200000,36),[camera],200000).length,0,'Camera behind the car must not trigger');

w=new RoadGuidanceWarnings([zone]);
const crossingFix={lat:camera.lat,lon:camera.lon-50/(111320*Math.cos(camera.lat*Math.PI/180)),speedKmh:36,headingDeg:90,accuracyM:5,timeMs:300000};
assert.strictEqual(w.update(crossingFix,[camera],300000).length,0,'A crossing road without the camera must not be treated as the camera road');

const ambiguous={id:'ambiguous',lat:camera.lat,lon:camera.lon,travel:[0,180],roads:[
 {id:'a',pts:[[0,-1000],[0,1000]],camM:1000,dir:0},
 {id:'b',pts:[[5,-1000],[5,1000]],camM:null,dir:0}
]};
assert.strictEqual(candidate(prepare(ambiguous),fix(-300,400000,36),500,null),null,'Ambiguous parallel road geometry must suppress warning');

w=new RoadGuidanceWarnings([zone]);
for(const accuracyM of [15,23,35]){
 w=new RoadGuidanceWarnings([zone]);
 w.update(Object.assign(fix(-300,500000,36),{accuracyM}),[camera],500000);
 assert(w.update(Object.assign(fix(-290,501000,36),{accuracyM}),[camera],501000).some(e=>e.type==='camera'),'Moderate accuracy must allow normal road-confirmed warnings');
}
w=new RoadGuidanceWarnings([zone]);
for(let t=0;t<2;t++)assert.equal(w.update(Object.assign(fix(-300+t*10,502000+t*1000,36),{accuracyM:35.01}),[camera],502000+t*1000).length,0);

const oneWay={id:camera.id,lat:camera.lat,lon:camera.lon,travel:[0],roads:[
 {id:'oneway',pts:[[0,-1000],[0,1000]],camM:1000,dir:1}
]};
assert.strictEqual(candidate(prepare(oneWay),Object.assign(fix(300,600000,36),{headingDeg:180}),500,null),null,'One-way geometry must reject travel against its direction');

w=new RoadGuidanceWarnings([zone]);
let speeding=w.update(fix(-300,700000,78),[camera],700000);
speeding=w.update(fix(-290,701000,78),[camera],701000);
assert(speeding.some(e=>e.type==='speeding'&&e.excessKmh===18&&e.limitSource==='camera'),'Speeding warning uses only the camera record limit');

console.log('Road-matched camera guidance tests passed');
