'use strict';
const assert=require('assert'),path=require('path');
const base=path.resolve(process.argv[2]);
const {Canvas}=require(path.join(base,'kit/canvas'));
const fill=Canvas.prototype.roundRect,stroke=Canvas.prototype.strokeRoundRect;
require('../tools/canvas-performance').install(Canvas);
let comparisons=0;
for(const coords of [[0,0,80,60],[3,5,60,40],[-5,-4,40,35],[60,40,40,30],[1.5,2.5,60.5,40.5]]){
 for(const color of ['#d32c36',[30,50,100,70],[70,30,50,0],[220,180,120,255]])for(const bg of ['#08090b',[8,9,11,80]]){
  for(const r of [0,4]){
   const a=new Canvas(80,60).clear(bg),b=new Canvas(80,60).clear(bg);
   fill.apply(a,coords.concat([r,color]));b.roundRect.apply(b,coords.concat([r,color]));assert.deepStrictEqual(a.d,b.d,'Fill pixel equality');comparisons++;
   for(const t of [1,2,3.5]){a.clear(bg);b.clear(bg);stroke.apply(a,coords.concat([r,t,color]));b.strokeRoundRect.apply(b,coords.concat([r,t,color]));assert.deepStrictEqual(a.d,b.d,'Outline pixel equality');comparisons++;}
  }
 }
}
const {reusable}=require('../apps/aurelm_speed_camera_warning/map-view-cache');
const old={time:1000,center:{lat:55.75,lon:37.62}};
assert(reusable(old,{lat:55.7501,lon:37.62},2000),'GPS jitter reuses map candidates');
assert(!reusable(old,{lat:55.752,lon:37.62},2000),'Moving out of cache radius reloads');
assert(!reusable(old,old.center,11000),'Map cache refreshes after ten seconds');
assert(!reusable(old,old.center,999),'Clock rollback reloads');
assert(!reusable(null,old.center,2000),'Database invalidation reloads');
console.log(JSON.stringify({pixelComparisons:comparisons,mapCache:'ok'}));
