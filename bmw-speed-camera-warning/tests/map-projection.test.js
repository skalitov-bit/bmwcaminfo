'use strict';
const assert=require('assert'),path=require('path');
const {project,MapOrientation}=require(path.resolve(process.argv[2]||path.join(__dirname,'../apps/aurelm_speed_camera_warning'),'map-projection'));
const a={x:10,y:20,w:800,h:400},c={lat:55,lon:37},m=111320,cos=Math.cos(55*Math.PI/180);
const near=(x,y)=>assert(Math.abs(x-y)<.001,`${x} != ${y}`);
for(const heading of [0,45,90,180,270,359]){
 const h=heading*Math.PI/180,p=project(c.lat,c.lon,c,1,a,heading,true);near(p[0],410);near(p[1],372);
 const ahead=project(c.lat+100*Math.cos(h)/m,c.lon+100*Math.sin(h)/(m*cos),c,1,a,heading,true);near(ahead[0],410);near(ahead[1],272);
 const right=project(c.lat-30*Math.sin(h)/m,c.lon+30*Math.cos(h)/(m*cos),c,1,a,heading,true);near(right[0],440);near(right[1],372);
}
const o=new MapOrientation(),fix={timeMs:1,speedKmh:60,accuracyM:5,headingDeg:90};assert.equal(o.update(fix),90);
assert.equal(o.update(Object.assign({},fix,{timeMs:2,speedKmh:0,headingDeg:250})),90);
assert.equal(o.update(null),90);assert.equal(o.update(Object.assign({},fix,{timeMs:3,accuracyM:70,headingDeg:0})),90);
assert.equal(o.update(Object.assign({},fix,{timeMs:4,headingDeg:359})),359);
assert.equal(o.update(Object.assign({},fix,{timeMs:5,headingDeg:1})),1);
assert.equal(o.update(Object.assign({},fix,{timeMs:4,headingDeg:50})),1);
console.log('PASS: fixed bottom GPS anchor, ahead always up, right stays right, all cardinal headings, stop/loss/accuracy hold and duplicate ordering.');
