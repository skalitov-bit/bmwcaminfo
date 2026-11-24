'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const base=path.resolve(process.argv[2]||path.join(__dirname,'../apps/aurelm_speed_camera_warning'));
const source=fs.readFileSync(path.join(base,'cluster-output.js'),'utf8');
const oracleSource=process.argv[3]?fs.readFileSync(path.resolve(process.argv[3]),'utf8'):source;
const load=(code,Render)=>vm.runInNewContext(code+'\n({CameraClusterOutput,makeFrame});',{
 Buffer,module:{exports:{}},require:n=>n==='./cluster_render_client'?{ClusterRender:Render}:require(path.join(base,n)),
 setTimeout:()=>1,clearTimeout:()=>{},setInterval:()=>2,clearInterval:()=>{}
});
class Render{
 constructor(){this.ready=true;this.targets='map:1088x480,hud:800x480';this.items={};this.events={};this.next=1;this.bytes=2*1024*1024;this.full=0;this.partial=0;this.sent=0;}
 on(k,fn){this.events[k]=fn;}connect(){}close(){}
 image(o){
  const bytes=o.iw*o.ih*4*2;
  assert(this.bytes+bytes<=16*1024*1024,'Shared service budget including another client');this.bytes+=bytes;
  const ref=this.next++;this.items[ref]={o:Object.assign({},o),px:Buffer.alloc(o.iw*o.ih*4),uploads:0};return ref;
 }
 set(ref,o){Object.assign(this.items[ref].o,o);}
 pixels(ref,rects,px){
  const item=this.items[ref];item.uploads++;this.sent+=px.length;
  if(!rects){this.full++;assert.strictEqual(px.length,item.px.length);px.copy(item.px);return;}
  this.partial++;let offset=0;
  rects.forEach(r=>{assert(r.x>=0&&r.y>=0&&r.x+r.w<=item.o.iw&&r.y+r.h<=item.o.ih);
   for(let y=0;y<r.h;y++){px.copy(item.px,((r.y+y)*item.o.iw+r.x)*4,offset,offset+r.w*4);offset+=r.w*4;}
  });assert.strictEqual(offset,px.length);
 }
}
const api=load(source,Render),oracle=load(oracleSource,Render);
const e={camera:{id:'a',limit:60,camera_model:'СТРЕЛКА',mapcamTypeCode:1},type:'camera',distanceM:1000,speedKmh:60};
const out=new api.CameraClusterOutput({mode:'both'});out.show(e);
const cr=out.cr,back=out.backplate,backPixels=Buffer.from(cr.items[back].px);
function compare(event){
 for(const target of ['map','hud']){
  const item=cr.items[out.layers[target]];
  assert(item.o.visible,'Both targets visible: '+target);
  const expected=oracle.makeFrame(event,target==='map');
  if(!item.px.equals(expected)){const diffs=[];for(let i=0;i<expected.length;i++)if(expected[i]!==item.px[i]){diffs.push([i,expected[i],item.px[i]]);if(diffs.length===8)break;}console.error('Pixel mismatch',target,diffs);}
  assert(item.px.equals(expected),'Partial result equals full reference: '+target+' '+JSON.stringify(event));
 }
 assert(cr.items[back].o.visible);assert(cr.items[back].px.equals(backPixels));assert.strictEqual(cr.items[back].uploads,1,'Static backing uploaded once');
}
compare(e);const initialFull=cr.full,initialSent=cr.sent;
for(let i=0;i<50;i++)out.show(Object.assign({},e));
assert.strictEqual(cr.sent,initialSent,'Repeated identical events send no pixels');
for(const patch of [
 {distanceM:999,phase:'section'}, {distanceM:950,phase:'rear'}, {distanceM:900,phase:'point'},
 {distanceM:850,useAverage:true,averageKmh:64,partialSection:true},
 {distanceM:800,averageKmh:65,partialSection:false}, {distanceM:750,estimated:true},
 {distanceM:700,estimated:false}, {distanceM:650,useAverage:false,phase:'point'}
]){Object.assign(e,patch);out.show(e);compare(e);e.distanceM--;out.updateDistance(e.distanceM,!!e.estimated);compare(e);}
assert.strictEqual(cr.full,initialFull,'Digit-count changes never rebuild the static layout');
for(let d=649;d>=550;d--){e.distanceM=d;out.updateDistance(d,false);compare(e);}
assert.strictEqual(cr.full,initialFull,'10 Hz distance path stays partial across digit-count ranges');
for(const d of [101,100,99,98,10,9,8,0,9,10,99,100,999,1000,10000,99999,100000,999999,9]){
 e.distanceM=d;out.updateDistance(d,false);compare(e);
}
for(const patch of [
 {camera:{id:'long',limit:120,camera_model:'МОДЕЛЬ С ПРЕДЕЛЬНО ДЛИННЫМ НАЗВАНИЕМ КОМПЛЕКСА',mapcamTypeCode:13,rearCapture:true},distanceM:99999,accuracyDegraded:true},
 {accuracyDegraded:false,phase:'rear',type:'speeding'},
 {camera:{id:'rear',limit:60,camera_model:'СТРЕЛКА',mapcamTypeCode:1,rearCapture:true}},
 {type:'speeding'}, {camera:{id:'a',limit:80,camera_model:'СТРЕЛКА',mapcamTypeCode:1}},
 {camera:{id:'b',limit:null,camera_model:'КОРДОН',mapcamTypeCode:1}},
 {camera:{id:'c',mapcamTypeCode:20}}, {camera:{id:'d',typeNamespace:'estrelka',typeCode:206}},
 {camera:{id:'e',limit:60,camera_model:'СТРЕЛКА',mapcamTypeCode:1},type:'camera'}
]){Object.assign(e,patch);out.show(e);compare(e);}
// Reconnect keeps cached content in the wire client; repeated ready is harmless.
cr.events.ready();compare(e);
out.clear();assert(!cr.items[back].o.visible);out.show(e);compare(e);
out.clear();out.setGpsStatus('lost');out.show(e);compare(e);out.setGpsStatus('');
out.setMode('hud');out.show(e);assert.strictEqual(out.backplate,null);assert.deepStrictEqual(Object.keys(out.layers),['hud']);
out.setMode('both');out.show(e);assert.strictEqual(Object.keys(out.layers).length,2);assert(out.cr.items[out.backplate].o.visible);out.close();
console.log('PASS: shared 16 MiB budget, both displays, unchanged opaque backing, duplicate event suppression, clean footer/distance patches, full-reference pixel equality, GPS/reconnect/mode transitions. Physical MGU not tested.');
