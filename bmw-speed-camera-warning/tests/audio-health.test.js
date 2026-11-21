'use strict';
const assert=require('assert'),{EventEmitter}=require('events');
const {AudioHealth}=require('../apps/aurelm_speed_camera_warning/audio-health');
const {OverspeedBeeper,beepState}=require('../apps/aurelm_speed_camera_warning/overspeed-beeper');
async function run(){
 let now=10000,socket,count=0;
 class Socket extends EventEmitter{setEncoding(){}setTimeout(){}write(raw){this.request=JSON.parse(raw);}destroy(){this.destroyed=true;this.emit('close');}}
 const net={createConnection(){count++;socket=new Socket();return socket;}};
 const h=new AudioHealth({net,now:()=>now});const p=h.poll();assert.strictEqual(p,h.poll());socket.emit('connect');assert.equal(socket.request.action,'status');
 socket.emit('data',JSON.stringify({ok:true,version:'0.1.18',speechProtocol:3,beeperProtocol:3,ready:true,ccAvailable:true,mpAvailable:true})+'\n');await p;
 assert(h.lines()[0].includes('ГОТОВ'));assert(h.lines(null,'TEST ERROR')[1].includes('TEST ERROR'));
 now+=31000;assert(h.lines()[0].includes('УСТАРЕЛО'));
 const failed=h.poll();socket.emit('error',new Error());await failed;assert(h.lines()[0].includes('НЕДОСТУПЕН'));
 const closed=h.poll();h.close();await closed;assert(socket.destroyed);assert.equal(h.pending,null);await h.poll();assert.equal(count,3);
 const b=new OverspeedBeeper({net,now:()=>now});
 const camera={id:'c',limit:60,mapcamTypeCode:1},fix={lat:56,lon:48,timeMs:now,speedKmh:81,accuracyM:5};
 const at=d=>beepState({camera,phase:'point',distanceM:d},fix,now,true,false,100);
 b.update(at(200));socket.emit('connect');assert.equal(b.latest.intervalMs,600);
 for(const d of [200.1,199.8,202,204.9,200]){b.update(at(d));assert.equal(b.latest.intervalMs,600);}
 b.update(at(206));assert.equal(b.latest.intervalMs,700);
 b.update(at(200));assert.equal(b.latest.intervalMs,600);
 b.update(at(50));assert.equal(b.latest.intervalMs,300);
 b.update(null);assert.equal(b.latest,null);assert(socket.destroyed);
 console.log('PASS: status polling bounded/no audio, readiness/version/errors/staleness/close; cadence jitter, retreat, acceleration and immediate stop');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
