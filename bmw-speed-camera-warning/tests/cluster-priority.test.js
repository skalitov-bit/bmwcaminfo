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
function checkLayers(socket,visible){
 const layers=socket.messages.filter(m=>m.op==='layer');assert.strictEqual(layers.length,4);
 assert(!layers.some(m=>m.target==='panel'),'Never claim the whole-cluster popup that hides the OEM right widget');
 for(const target of ['map','hud']){
  const pair=layers.filter(m=>m.target===target);assert.strictEqual(pair.length,2);
  const card=pair[0],ring=pair[1];
  assert.strictEqual(card.w,420);assert.strictEqual(ring.w,84);
  for(const layer of pair){
   assert.strictEqual(layer.class,'alert');assert.strictEqual(layer.z,1000);
   assert.strictEqual(layer.contend,1);assert.strictEqual(layer.yield,0);
   assert.strictEqual(layer.guide_hold,0,'Neither card nor ring may suppress the OEM maneuver box');
   assert(layer.x>=0&&layer.y>=0&&layer.x+layer.w<=(target==='map'?1088:800)&&layer.y+layer.h<=480,'Layer stays inside its target');
  }
  assert.strictEqual(card.exclusive,0,'Priority must not hide unrelated lower layers');assert.strictEqual(ring.exclusive,0);
  assert.strictEqual(card.x,target==='map'?334:190);assert.strictEqual(card.y,182);
  assert.strictEqual(ring.x,card.x+315);assert.strictEqual(ring.y,card.y+17);
  assert.strictEqual(card.visible,visible?1:0);
  assert.strictEqual(ring.visible,0,'Ring starts hidden and cannot suppress its own card');
 }
}
checkLayers(sockets[0],false);
output.show({camera:{id:'camera',limit:60},distanceM:300,speedKmh:60,type:'camera'});
for(const ref of Object.values(output.layers)){
 assert(sockets[0].messages.some(m=>m.op==='set'&&m.ref===ref&&m.visible===1));
}
// Service restart: replay must retain priority, visibility and ring-after-card order.
sockets[0].destroy();
const reconnect=output.cr.timer;assert(timers.has(reconnect));timers.get(reconnect)();timers.delete(reconnect);
sockets[1].hello();checkLayers(sockets[1],true);
assert.strictEqual(output.cr.layers.size,4,'Reconnect does not allocate duplicate layers');
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
