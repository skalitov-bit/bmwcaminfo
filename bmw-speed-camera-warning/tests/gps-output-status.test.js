'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const base=path.resolve(process.argv[2]||path.join(__dirname,'../apps/aurelm_speed_camera_warning'));
const {GpsOutputStatus}=require(path.join(base,'gps-output-status'));
const policy=new GpsOutputStatus(),fix={lat:55,lon:37,speedKmh:80,accuracyM:7,timeMs:10000};
assert.strictEqual(policy.update(null,10000,false,true),'searching');
assert.strictEqual(policy.update(fix,10000,false,true),'');
assert.strictEqual(policy.update(fix,13000,false,true),'');
assert.strictEqual(policy.update(fix,13001,true,true),'reserve');
assert.strictEqual(policy.update(fix,15001,false,true),'lost');
assert.strictEqual(policy.update(null,15001,false,false),'');
assert.strictEqual(policy.update(Object.assign({},fix,{timeMs:15001,accuracyM:40}),15001,false,true),'unreliable');
assert.strictEqual(policy.update(Object.assign({},fix,{timeMs:15001}),15001,false,true),'');
let uploads=0,next=1,labels=[];
class Render{
 constructor(){this.ready=true;this.items={};this.events={};}
 on(event,fn){this.events[event]=fn;}connect(){}close(){}
 image(o){const id=next++;this.items[id]={visible:false,options:o};return id;}
 set(id,o){Object.assign(this.items[id],o);}
 pixels(id,r,px){uploads++;assert(Buffer.isBuffer(px));if(!r)this.items[id].frame=Buffer.from(px);}
}
const text=require(path.join(base,'cluster-text'));
const api=vm.runInNewContext(fs.readFileSync(path.join(base,'cluster-output.js'),'utf8')+'\n({CameraClusterOutput});',{
 Buffer,module:{exports:{}},require:n=>n==='./cluster_render_client'?{ClusterRender:Render}:n==='./cluster-text'?Object.assign({},text,{draw:function(){labels.push(arguments[4]);return text.draw.apply(text,arguments);}}):require(path.join(base,n)),
 setTimeout:()=>1,clearTimeout:()=>{},setInterval:()=>2,clearInterval:()=>{}
});
const out=new api.CameraClusterOutput({mode:'both'});
out.show({camera:{id:'stripe',limit:60},distanceM:300,type:'camera'});
const topBytes=840*10*4,hudFrame=Buffer.from(out.cr.items[out.layers.hud].frame),mapFrame=Buffer.from(out.cr.items[out.layers.map].frame);
assert(hudFrame.slice(0,topBytes).some(v=>v));
out.setHudPosition({x:190,y:182,stripe:false});
assert(out.cr.items[out.layers.hud].frame.slice(0,topBytes).every(v=>v===0));
assert(out.cr.items[out.layers.hud].frame.slice(topBytes).equals(hudFrame.slice(topBytes)),'Only the stripe changes');
assert(out.cr.items[out.layers.map].frame.equals(mapFrame),'KOMBI artwork is unchanged');
out.clear();out.setGpsStatus('lost');assert(out.cr.items[out.layers.hud].frame.slice(0,topBytes).every(v=>v===0),'GPS banner obeys preference too');
out.setHudPosition({x:190,y:182,stripe:true});assert(out.cr.items[out.layers.hud].frame.slice(0,topBytes).every(v=>v===0),'Compact GPS captions have no stripe');out.setGpsStatus('');
const visible=()=>Object.keys(out.layers).map(t=>out.cr.items[out.layers[t]].visible);
labels=[];out.setGpsStatus('searching');assert(visible().every(Boolean));assert(labels.includes('🛰 GPS: ПОИСК СИГНАЛА'));
assert.deepStrictEqual(labels,['🛰 GPS: ПОИСК СИГНАЛА','🛰 GPS: ПОИСК СИГНАЛА'],'One small caption per display without waiting text');
assert.strictEqual(out.cr.items[out.backplate].visible,false,'Search has no KOMBI backing card');
for(const target of Object.keys(out.layers)){
 const px=out.cr.items[out.layers[target]].frame;
 assert(px.slice(0,840*92*2*4).every(v=>v===0),'Search and enlarged satellite stay in the bottom area');
 assert(px.slice(840*92*2*4).some(v=>v),'Search is visible at the bottom');
}
let count=uploads;for(let i=0;i<100;i++)out.setGpsStatus('searching');assert.strictEqual(uploads,count,'No repeated rasterization for unchanged status');
out.setGpsStatus('');assert(visible().every(v=>!v));
out.setGpsStatus('lost');assert(labels.includes('🛰 GPS: НЕТ СИГНАЛА'));assert(visible().every(Boolean));
assert.strictEqual(out.cr.items[out.backplate].visible,false,'Signal loss is a compact caption without a backing card');
for(const status of ['lost','unreliable','degraded','reserve']){
 labels=[];out.setGpsStatus('');out.setGpsStatus(status);
 assert.strictEqual(labels.length,2,'One short message per display for each GPS status');
 assert.strictEqual(out.cr.items[out.backplate].visible,false);
 for(const target of Object.keys(out.layers)){
  const px=out.cr.items[out.layers[target]].frame;
  assert(px.slice(0,840*92*2*4).every(v=>v===0),'GPS status leaves the upper banner area empty');
  assert(px.slice(840*92*2*4).some(v=>v),'GPS caption remains visible at the bottom');
 }
}
out.setGpsStatus('lost');
out.cr.events.ready();assert(visible().every(Boolean),'Loss status survives renderer reconnect');
out.show({camera:{id:'c',limit:60},distanceM:200,estimated:true,type:'camera'});out.setGpsStatus('reserve');
assert(labels.includes('🛰 GPS: НЕТ СИГНАЛА / РАСЧЁТ'));assert.strictEqual(out.current.camera.id,'c');
count=uploads;out.setGpsStatus('lost');assert.strictEqual(uploads,count,'Status must not cover active camera');
out.clear();assert(visible().every(Boolean),'Reserve expiry replaces camera with persistent status');
assert.strictEqual(out.current,null);out.updateDistance(100,false);assert.strictEqual(out.current,null);
out.setGpsStatus('unreliable');assert(labels.includes('🛰 GPS: НЕДОСТОВЕРЕН'));
out.setGpsStatus('degraded');assert(labels.includes('🛰 GPS: ТОЧНОСТЬ СНИЖЕНА'));
out.show({camera:{id:'low',limit:60},distanceM:300,type:'speeding',accuracyDegraded:false});
labels=[];
const state={camera:{id:'low',limit:60},distanceM:290,speeding:true,accuracyDegraded:true};
out.sync({low:state});
assert.equal(labels.filter(s=>s==='🛰 GPS: ТОЧНОСТЬ СНИЖЕНА').length,2,'Both displays receive the small footer');
assert(labels.includes('ПРЕВЫШЕНИЕ'),'The accuracy footer must retain the speeding label');
count=uploads;out.sync({low:state});assert.equal(uploads,count,'Unchanged accuracy does not redraw');
labels=[];out.sync({low:Object.assign({},state,{accuracyDegraded:false})});
assert(!out.current.accuracyDegraded);assert(!labels.includes('🛰 GPS: ТОЧНОСТЬ СНИЖЕНА'));
assert(uploads>count,'Recovery clears the footer pixels');out.clear();
out.setMode('hud');out.cr.events.ready();assert.deepStrictEqual(Object.keys(out.layers),['hud']);assert(visible().every(Boolean));
out.setMode('off');assert.strictEqual(out.cr,null);out.setMode('both');out.cr.events.ready();assert(visible().every(Boolean));
out.setGpsStatus('');assert(visible().every(v=>!v),'Restored GPS removes status');
out.setGpsStatus('lost');out.close();assert.strictEqual(out.cr,null);
console.log('PASS GPS status: initial search, stale/lost/poor-accuracy fixes, bounded reserve, recovery, both targets, mode/reconnect, no repeated frames, cleanup');
