'use strict';
const assert=require('assert');
const {centralDistance}=require('../apps/aurelm_speed_camera_warning/central-distance');
const event={camera:{id:'a'},phase:'point',distanceM:500,speedKmh:90,type:'speeding'};
const p={distanceM:492.5,speedKmh:91,estimated:false,hit:{active:true,camera:{id:'a'},state:{phase:'point'}}};
assert.deepStrictEqual(centralDistance(event,p),Object.assign({},event,{distanceM:492.5}));assert.equal(event.distanceM,500);
for(const variant of [null,Object.assign({},p,{estimated:true}),Object.assign({},p,{distanceM:NaN}),Object.assign({},p,{distanceM:-1}),Object.assign({},p,{hit:{active:true,camera:{id:'b'}}}),Object.assign({},p,{hit:{active:true,camera:{id:'a'},state:{phase:'rear'}}}),Object.assign({},p,{hit:{active:false,camera:{id:'a'}}})])assert.strictEqual(centralDistance(event,variant),event);
for(const phase of ['point','rear','section']){const e=Object.assign({},event,{phase,useAverage:phase==='section',averageKmh:85});const v=Object.assign({},p,{distanceM:0,hit:{active:true,camera:event.camera,state:{phase}}});assert.deepStrictEqual(centralDistance(e,v),Object.assign({},e,{distanceM:0}));}
assert.strictEqual(centralDistance(null,p),null);
console.log('PASS central distance: same-target/phase smoothing, immutable warning, average-speed fields, GPS-loss and stale-target guards.');
