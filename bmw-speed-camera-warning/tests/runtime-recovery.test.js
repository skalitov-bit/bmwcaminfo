'use strict';
const assert=require('assert');const {RuntimeRecovery}=require('../apps/aurelm_speed_camera_warning/runtime-recovery');
async function run(){
 let now=0,calls=0,timer,cleared=0;
 const r=new RuntimeRecovery({now:()=>now,resume:()=>{calls++;},setInterval:f=>{timer=f;return 1;},clearInterval:()=>cleared++});
 r.start();r.start();for(let i=0;i<100;i++){now+=2000;timer();}assert.equal(calls,0);
 now+=3600000;await Promise.all([timer(),r.recover('SAME WAKE')]);assert.equal(calls,1);assert.equal(r.count,1);
 now+=6000;await r.recover('SDK RECONNECT');assert.equal(calls,2);
 r.stop();now+=3600000;timer();await r.recover('SHUTDOWN');assert.equal(calls,2);assert.equal(cleared,1);
 const stopped=new RuntimeRecovery({resume:()=>{throw Error('Must not resume after stop');}});
 const pending=stopped.recover('WAKE');stopped.stop();await pending;assert(!stopped.failed);
 const fail=new RuntimeRecovery({resume:()=>Promise.reject(Error('disconnect'))});await fail.recover('WAKE');assert(fail.failed);assert(fail.label().includes('ОШИБКА'));
 console.log('PASS sleep gap, deduplication, reconnect, shutdown cancellation, failed recovery diagnostics');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
