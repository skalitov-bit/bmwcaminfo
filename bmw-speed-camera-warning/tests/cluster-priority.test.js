'use strict';
// Exercise the actual output module and wire client, including reconnect replay.
// This verifies sent protocol messages, not physical BMW display arbitration.
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const EventEmitter=require('events');
const base=path.resolve(process.argv[2]||path.join(__dirname,'../apps/aurelm_speed_camera_warning'));
const sockets=[],timers=new Map();let nextTimer=1;
function later(fn){const id=nextTimer++;timers.set(id,fn);return id;}
function cancel(id){timers.delete(id);}
class Socket extends EventEmitter{
 constructor(){super();this.messages=[];}
 write(raw){
  assert.strictEqual(raw.readUInt32LE(0),raw.length-4);
  if(raw[4]===0x4a)this.messages.push(JSON.parse(raw.slice(5).toString('utf8')));
  return true;
 }
 destroy(){this.emit('close');}
 hello(){
  this.emit('connect');
  const body=Buffer.from(JSON.stringify({ev:'hello',proto:1,backend:'id7',targets:'map:1088x480,panel:1920x720,hud:800x480'}));
  const packet=Buffer.alloc(5+body.length);packet.writeUInt32LE(body.length+1,0);packet[4]=0x4a;body.copy(packet,5);
  this.emit('data',packet);
 }
}
const clientModule={exports:{}};
vm.runInNewContext(fs.readFileSync(path.join(base,'cluster_render_client.js'),'utf8'),{
 Buffer,module:clientModule,require:n=>n==='net'?{connect:()=>{const s=new Socket();sockets.push(s);return s;}}:require(n),
 setTimeout:later,clearTimeout:cancel
});
const outputModule={exports:{}};
vm.runInNewContext(fs.readFileSync(path.join(base,'cluster-output.js'),'utf8'),{
 Buffer,module:outputModule,require:n=>n==='./cluster_render_client'?clientModule.exports:require(path.join(base,n)),
 setTimeout:later,clearTimeout:cancel,setInterval:later,clearInterval:cancel
});
const output=new outputModule.exports.CameraClusterOutput({mode:'both',now:()=>0});
sockets[0].hello();
function checkLayers(socket,visible,hudPosition){
 hudPosition=hudPosition||{x:190,y:182};
 const layers=socket.messages.filter(m=>m.op==='layer');assert.strictEqual(layers.length,5);
 assert(!layers.some(m=>m.target==='panel'),'Never claim the whole-cluster popup that hides the OEM right widget');
 for(const target of ['map','hud']){
  const all=layers.filter(m=>m.target===target);assert.strictEqual(all.length,target==='map'?3:2);
  const pair=target==='map'?all.slice(1):all;
  if(target==='map'){
   const backing=all[0];assert.strictEqual(backing.x,314);assert.strictEqual(backing.y,346);
   assert.strictEqual(backing.w,460);assert.strictEqual(backing.h,134);assert.strictEqual(backing.visible,visible?1:0);
   assert.strictEqual(backing.x+backing.w/2,1088/2);assert.strictEqual(backing.y+backing.h,480);
   assert.strictEqual(backing.exclusive,0);assert.strictEqual(backing.guide_hold,0);
  }
  const card=pair[0],ring=pair[1];
  assert.strictEqual(card.w,420);assert.strictEqual(card.h,116);assert.strictEqual(ring.w,84);
  for(const layer of pair){
   assert.strictEqual(layer.class,'alert');assert.strictEqual(layer.z,1000);
   assert.strictEqual(layer.contend,1);assert.strictEqual(layer.yield,0);
   assert.strictEqual(layer.guide_hold,0,'Neither card nor ring may suppress the OEM maneuver box');
   assert(layer.x>=0&&layer.y>=0&&layer.x+layer.w<=(target==='map'?1088:800)&&layer.y+layer.h<=480,'Layer stays inside its target');
  }
  assert.strictEqual(card.exclusive,0,'Priority must not hide unrelated lower layers');assert.strictEqual(ring.exclusive,0);
  assert.strictEqual(card.x,target==='map'?334:hudPosition.x);assert.strictEqual(card.y,target==='map'?355:hudPosition.y);
  if(target==='map'){assert.strictEqual(card.x+card.w/2,544,'Information is centred');assert.strictEqual(card.y+card.h,471,'Bottom padding stays inside map canvas');}
  assert.strictEqual(ring.x,card.x+(target==='map'?288:315));assert.strictEqual(ring.y,card.y+(target==='map'?16:17));
  assert.strictEqual(card.visible,visible?1:0);
  assert.strictEqual(ring.visible,0,'Ring starts hidden and cannot suppress its own card');
 }
}
checkLayers(sockets[0],false);
// cluster-render charges two RGBA copies per image, globally across clients.
// Leave room for a modest 2 MiB layer belonging to another application.
const serviceBytes=sockets[0].messages.filter(m=>m.op==='layer').reduce((n,m)=>n+m.iw*m.ih*4*2,0);
assert(serviceBytes+2*1024*1024<=16*1024*1024,'Both displays must fit the shared 16 MiB service budget with another 2 MiB layer; requested '+serviceBytes);
output.show({camera:{id:'camera',limit:60},distanceM:300,speedKmh:60,type:'camera'});
for(const ref of Object.values(output.layers)){
 assert(sockets[0].messages.some(m=>m.op==='set'&&m.ref===ref&&m.visible===1));
}
// Service restart: replay must retain priority, visibility and ring-after-card order.
const layerCount=output.cr.layers.size;
output.setHudPosition({x:-500,y:1000});
assert.strictEqual(output.cr.layers.size,layerCount,'Moving does not allocate new layers');
assert.strictEqual(output.cr.layers.get(output.layers.map).opts.x,334,'HUD movement never moves KOMBI');
assert.strictEqual(output.cr.layers.get(output.layers.hud).opts.x,0);
assert.strictEqual(output.cr.layers.get(output.layers.hud).opts.y,364);
sockets[0].destroy();
const reconnect=output.cr.timer;assert(timers.has(reconnect));timers.get(reconnect)();timers.delete(reconnect);
sockets[1].hello();checkLayers(sockets[1],true,{x:0,y:364});
assert.strictEqual(output.cr.layers.size,5,'Reconnect does not allocate duplicate layers');
// The protocol's yield field must also be transmitted and remembered by set().
const ref=output.layers.hud;
output.cr.set(ref,{yield:true});
assert.strictEqual(sockets[1].messages.slice(-1)[0].yield,1);
output.cr.set(ref,{yield:false});
assert.strictEqual(sockets[1].messages.slice(-1)[0].yield,0);
assert.strictEqual(output.cr.layers.get(ref).opts.yield,false);
output.clear();
for(const layer of output.cr.layers.values())assert.strictEqual(layer.opts.visible,false,'Clear releases all visible layer requests');
output.setMode('hud');sockets[2].hello();
assert.strictEqual(sockets[2].messages.filter(m=>m.op==='layer').length,2);
output.show({camera:{id:'next',limit:60},distanceM:200,speedKmh:81,type:'speeding'});
output.close();assert.strictEqual(timers.size,0,'Close cancels alert, blink and reconnect timers');
// Standalone KOMBI mode must use the same path, including after a mode change.
const kombi=new outputModule.exports.CameraClusterOutput({mode:'kombi',now:()=>0});
sockets[3].hello();
assert(sockets[3].messages.filter(m=>m.op==='layer').every(m=>m.target==='map'&&m.guide_hold===0&&m.exclusive===0));
kombi.show({camera:{id:'kombi',limit:60},distanceM:200,speedKmh:81,type:'speeding'});
kombi.setMode('off');
assert.strictEqual(timers.size,0);assert.strictEqual(kombi.cr,null);
kombi.setMode('both');sockets[4].hello();checkLayers(sockets[4],false);
kombi.close();assert.strictEqual(timers.size,0);
console.log('PASS: KOMBI uses map, never panel; card/ring non-exclusive, guide_hold=0, alert z=1000, bounds, reconnect replay, both/kombi/hud/off modes and cleanup. No physical MGU assertion.');
const {HudPositionEditor}=require(path.join(base,'hud-position'));
const shared=new outputModule.exports.CameraClusterOutput({mode:'both'});sockets[sockets.length-1].hello();
let saved={x:200,y:187,stripe:true},clock=0;
const editor=new HudPositionEditor({store:{load:()=>saved,save:p=>(saved=p)},output:shared,now:()=>clock,moving:()=>false,change:()=>{},apply:p=>shared.setHudPosition(p)});
editor.open();editor.test();assert(editor.busy);assert(!shared.current,'Wait for render service before sending the test');
const testSocket=sockets[sockets.length-1];testSocket.hello();
assert.equal(testSocket.messages.find(m=>m.op==='hello').app,'aurelm_speed_camera_warning','Use the registered production renderer client');
assert.equal(shared.current.camera.id,'hud-position-test');
const testCard=testSocket.messages.find(m=>m.op==='layer'&&m.target==='hud');assert(testCard);assert.equal(testCard.x,200);
assert(testSocket.messages.some(m=>m.op==='set'&&m.ref===testCard.ref&&m.visible===1),'Actual wire requests visible HUD');
editor.move(5,0);assert(testSocket.messages.some(m=>m.op==='set'&&m.ref===testCard.ref&&m.x===205));
clock=45001;editor.tick();assert.equal(shared.mode,'both');assert.deepStrictEqual(shared.hudPosition,saved);
shared.close();assert.equal(timers.size,0);console.log('PASS HUD editor: production renderer identity, ready handshake, visible layer, live coordinates, timeout and restoration');
