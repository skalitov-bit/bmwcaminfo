'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const base=path.resolve(process.argv[2]||path.join(__dirname,'../apps/aurelm_speed_camera_warning'));
const intervals=new Map(),timeouts=new Map();let next=1,uploads=0;
class Render{
 constructor(){this.ready=true;this.items={};}
 on(){} connect(){} close(){this.ready=false;}
 image(options){const id=next++;this.items[id]=Object.assign({},options);return id;}
 pixels(id,unused,pixels){uploads++;this.items[id].pixels=pixels;}
 set(id,options){Object.assign(this.items[id],options);}
}
const code=fs.readFileSync(path.join(base,'cluster-output.js'),'utf8');
const api=vm.runInNewContext(code+'\n({CameraClusterOutput,shouldBlink,makeRing});',{
 Buffer,module:{exports:{}},require:n=>n==='./cluster_render_client'?{ClusterRender:Render}:require(path.join(base,n)),
 setInterval:(fn,ms)=>{assert.strictEqual(ms,500);const id=next++;intervals.set(id,fn);return id;},clearInterval:id=>intervals.delete(id),
 setTimeout:fn=>{const id=next++;timeouts.set(id,fn);return id;},clearTimeout:id=>timeouts.delete(id)
});
const camera={id:'real-camera',limit:60,camera_model:'СТРЕЛКА',typeNamespace:'estrelka',typeCode:15};
const event=speed=>({camera,speedKmh:speed,type:'speeding',phase:'point',distanceM:500});
for(const speed of [0,60,79.9,80,null,undefined,NaN,Infinity])assert(!api.shouldBlink(event(speed)));
for(const speed of [80.01,81,100])assert(api.shouldBlink(event(speed)));
assert(!api.shouldBlink(Object.assign(event(100),{camera:{limit:null}})));
assert(!api.shouldBlink(Object.assign(event(100),{camera:{limit:60,camera_family:'dummy'}})));
assert(!api.shouldBlink(Object.assign(event(100),{camera:{limit:60,averageControl:true}})));
assert(!api.shouldBlink(Object.assign(event(100),{useAverage:true,averageKmh:80})));
assert(api.shouldBlink(Object.assign(event(60),{useAverage:true,averageKmh:80.01})));
assert(api.shouldBlink(Object.assign(event(80),{measuredSpeedKmh:80.01})));
const output=new api.CameraClusterOutput({mode:'both'});
output.show(event(80));assert.strictEqual(intervals.size,0);
const sync=speed=>output.sync({[camera.id]:{distanceM:500,phase:'point',speeding:true,speedKmh:speed}});
sync(80.01);assert.strictEqual(intervals.size,1,'Speed-only threshold crossing starts flashing');
const refs=Object.values(output.rings);assert.strictEqual(refs.length,2);
for(const ref of refs){const r=output.cr.items[ref];assert(r.visible);assert.strictEqual(r.w,84);assert.strictEqual(r.pixels.length,336*336*4);}
const before=uploads;
const tick=()=>Array.from(intervals.values()).forEach(fn=>fn());
tick();refs.forEach(ref=>assert(!output.cr.items[ref].visible));
sync(90);assert.strictEqual(intervals.size,1);refs.forEach(ref=>assert(!output.cr.items[ref].visible),'GPS refresh preserves blink phase');
tick();refs.forEach(ref=>assert(output.cr.items[ref].visible));assert.strictEqual(uploads,before,'Flashes do not upload full frames');
sync(80);assert.strictEqual(intervals.size,0);refs.forEach(ref=>assert(!output.cr.items[ref].visible));
sync(81);output.sync({});assert.strictEqual(intervals.size,0,'Missing state stops stale flashing');
sync(81);output.clear();assert.strictEqual(intervals.size,0);assert.strictEqual(timeouts.size,0);
output.show(event(90));output.setMode('off');assert.strictEqual(intervals.size,0);assert.strictEqual(timeouts.size,0);
output.setMode('hud');output.show(event(90));output.close();assert.strictEqual(intervals.size,0);assert.strictEqual(timeouts.size,0);
const ring=api.makeRing(),alpha=(x,y)=>ring[(y*336+x)*4+3];
assert.strictEqual(alpha(168,168),0,'Transparent center leaves limit sign intact');
assert(alpha(168,8)>0);assert.strictEqual(alpha(168,24),0,'Gap separates outer ring and sign');
console.log('PASS: strict +20 threshold, fractional speed, averages, missing data, two targets, 500ms phases, speed-only updates, cached overlay, timer cleanup.');
