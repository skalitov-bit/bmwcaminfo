'use strict';
const assert=require('assert'),path=require('path');
const root=path.resolve(process.argv[2]),{make}=require('./display-wire-fixture');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function setup(){
 let now=10000,shown=true,delayed=false,finish,hits=0;
 const events=[],w=make(root,{isVisible:n=>shown&&n==='MAIN',hasFocus:()=>shown,_invalidate(){}},{now:()=>now,setTimeout:fn=>({fn})});
 w.ready(5); // valid native rendering + touch + foreground, no controller (photo)
 const show=w.d.gpu.show.bind(w.d.gpu),recover=w.d.gpu.recover.bind(w.d.gpu);
 w.d.gpu.show=on=>{events.push(on?'SHOW':'HIDE');return show(on);};
 w.d.gpu.recover=()=>{events.push('RECONNECT');return recover();};
 const send=()=>delayed?new Promise(resolve=>{events.push('PNG_BEGIN');finish=v=>{events.push('PNG_DONE');resolve(v);};}):true;
 const draw=()=>{const cv=w.d.canvas(1600,520);cv.clear('#112233');cv.target(20,24,222,98,()=>hits++,'nav-MAP');return w.d.present('MAIN_GFX',cv,send);};
 await draw();w.ack();events.length=0;delayed=true;
 return {w,events,draw:async()=>{delayed=false;await draw();delayed=true;},advance:n=>{now+=n;},hide:()=>{shown=false;w.d._syncVisible();},show:()=>{shown=true;w.d._syncVisible();},finish:v=>finish(v),hits:()=>hits};
}
async function run(){
 let f=await setup();assert(f.w.d.active());assert(!f.w.d.gpu.grabbing);f.w.tap(100,60);assert.equal(f.hits(),1,'touch works before controller recovery');
 f.advance(4999);assert.strictEqual(await f.w.d.retryController(),false);assert(!f.events.length);
 f.advance(1);const pending=f.w.d.retryController();await flush();assert.deepEqual(f.events,['PNG_BEGIN']);
 f.advance(60000);await f.w.d.retryController();f.w.d._softIfNoTick();assert.deepEqual(f.events,['PNG_BEGIN'],'no racing reconnect while PNG in flight');
 f.finish(true);assert.strictEqual(await pending,true);assert(f.events.indexOf('PNG_DONE')<f.events.indexOf('HIDE'));assert(f.events.indexOf('HIDE')<f.events.indexOf('RECONNECT'));
 f.w.reconnect();f.w.ready(7);await f.draw();assert(f.w.d.active());assert(f.w.d.gpu.grabbing);assert.equal(f.w.d.controllerRecoveryStatus,'ready');
 f.w.ccu(100);f.w.ccu(101);f.w.ccu(101,1);assert.equal(f.hits(),2,'turn and press work after new handshake');
 f.w.tap(100,60);assert.equal(f.hits(),3);f.advance(300000);assert.strictEqual(await f.w.d.retryController(),false);
 // A failed PNG upload keeps both the GPU image and touch usable.
 f=await setup();f.advance(5000);let p=f.w.d.retryController();await flush();f.finish(false);assert.strictEqual(await p,false);assert(f.w.d.active());assert(!f.events.includes('HIDE'));assert(!f.w.d.controllerRetryAttempts);
 // Do not cover another application or complete a stale handoff after returning.
 f=await setup();f.advance(5000);p=f.w.d.retryController();await flush();f.hide();f.show();f.events.length=0;f.finish(true);await p;assert(!f.events.includes('RECONNECT'));assert(!f.events.includes('HIDE'));
 f=await setup();f.advance(5000);p=f.w.d.retryController();await flush();f.w.ready(7);f.events.length=0;f.finish(true);await p;assert.equal(f.w.d.controllerRecoveryStatus,'ready');assert(!f.events.includes('RECONNECT'));assert(!f.events.includes('HIDE'));
 f=await setup();f.advance(5000);f.w.words(0x4d520102,[1,0,0]);assert.strictEqual(await f.w.d.retryController(),false);assert(!f.events.includes('RECONNECT'));
 // No unbounded retry loop when the controller gate is genuinely unavailable.
 f=await setup();
 for(let i=0;i<3;i++){
  f.advance(i?30000:5000);p=f.w.d.retryController();await flush();f.finish(true);await p;
  f.w.reconnect();f.w.ready(5);await f.draw();f.w.ack();
 }
 assert.equal(f.w.d.controllerRetryAttempts,3);assert.equal(f.w.d.controllerRecoveryStatus,'unavailable');
 f.advance(300000);assert.strictEqual(await f.w.d.retryController(),false);assert(f.w.d.active());assert(!f.w.d.gpu.grabbing);
 // A real capability repair clears only the capability lock, never a stall lock.
 f.w.ready(6);assert.equal(f.w.d.recoveryLocked,'INPUT_CAPABILITIES');f.w.ready(7);assert(!f.w.d.recoveryLocked);assert(f.w.d.active());
 f.w.d.recoveryLocked='REPEATED_STALL';f.w.ready(7);assert.equal(f.w.d.recoveryLocked,'REPEATED_STALL');assert(!f.w.d.active());
 // The normal menu timer must actually drive recovery; no hidden emulator hook.
 const handlers={},menuUi={comp:()=>true,isVisible:()=>false,onClick:(k,fn)=>{handlers[k]=fn;},text(){},open(){},close(){}};
 let checks=0;const menu=require(root+'/display-recovery-menu').install({display:{gpu:{ready:true},_shown:()=>true,retryController:()=>{checks++;}},ui:menuUi,log:{warn(){}}});
 menu.check();assert.equal(checks,1);menu.close();
 console.log('PASS controller recovery: missing capability, live touch, delayed/rejected PNG, bounded retries, foreground/epoch safety, READY repair, knob+press, stall protection. No real MGU tested.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
