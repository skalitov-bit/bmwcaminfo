'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const base=path.resolve(process.argv[2]||path.join(__dirname,'../apps/aurelm_speed_camera_warning'));
let next=1,full=0,partial=0;
class Render{
 constructor(){this.ready=true;this.items={};}on(){}connect(){}close(){}
 image(o){const id=next++;this.items[id]={o,px:Buffer.alloc(o.iw*o.ih*4)};return id;}
 set(){}
 pixels(id,rects,px){const item=this.items[id];
  if(!rects){assert.strictEqual(px.length,item.px.length);px.copy(item.px);full++;return;}
  assert(Array.isArray(rects));partial++;let offset=0;
  for(const r of rects){for(let y=0;y<r.h;y++){px.copy(item.px,((r.y+y)*item.o.iw+r.x)*4,offset,offset+r.w*4);offset+=r.w*4;}}
  assert.strictEqual(offset,px.length);
 }
}
const api=vm.runInNewContext(fs.readFileSync(path.join(base,'cluster-output.js'),'utf8')+'\n({CameraClusterOutput,makeFrame,shouldBlink});',{
 Buffer,module:{exports:{}},require:n=>n==='./cluster_render_client'?{ClusterRender:Render}:require(path.join(base,n)),
 setTimeout:()=>1,clearTimeout:()=>{},setInterval:()=>2,clearInterval:()=>{}
});
const o=new api.CameraClusterOutput({mode:'both'}),e={camera:{id:'test',limit:60,camera_model:'СТРЕЛКА'},type:'camera',distanceM:1000,speedKmh:90};
o.show(e);const before=full;
for(const distance of [999,997,900,500,99,9,0]){
 o.updateDistance(distance,false);
 for(const target of Object.keys(o.layers)){
  const expected=api.makeFrame(Object.assign({},e,{distanceM:distance}),target==='map');
  if(target==='map')expected.fill(0,0,840*10*4);
  assert(o.cr.items[o.layers[target]].px.equals(expected),'Dirty rectangle equals complete '+target+' render at '+distance);
 }
}
assert.strictEqual(full,before);assert.strictEqual(partial,14);
o.updateDistance(0,false);assert.strictEqual(partial,14,'No upload when displayed number is unchanged');
o.updateDistance(20,true);assert.strictEqual(full,before,'Estimated marker updates only footer and distance on both targets');
assert(!api.shouldBlink(o.current));o.updateDistance(19,true);assert.strictEqual(full,before);
o.clear();o.updateDistance(18,true);assert.strictEqual(partial,20);
for(const limit of [null,0,60])for(const type of ['camera','speeding']){
 const event=Object.assign({},e,{camera:Object.assign({},e.camera,{limit}),type,distanceM:4000});o.show(event);
 o.updateDistance(9999,false);
 for(const target of Object.keys(o.layers)){
  const expected=api.makeFrame(Object.assign({},event,{distanceM:9999}),target==='map');
  if(target==='map')expected.fill(0,0,840*10*4);
  assert(o.cr.items[o.layers[target]].px.equals(expected),'Unknown-limit caption survives distance updates on '+target);
 }
}
console.log('PASS HUD partial pixels equal full renders; no repeated full-frame uploads; estimated marker and cleanup');
