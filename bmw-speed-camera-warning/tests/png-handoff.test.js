'use strict';
// Packaged Display + real protocol client; delay/fail the RHMI upload boundary.
const assert=require('assert'),path=require('path'),fs=require('fs'),vm=require('vm');
const root=path.resolve(process.argv[2]),{make}=require('./display-wire-fixture');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function setup(){
 let now=10000,shown=true,delayed=false,finish,fail,uploads=0;
 const events=[],w=make(root,{isVisible:n=>shown&&n==='MAIN',hasFocus:()=>shown,_invalidate(){}},{now:()=>now,setTimeout:fn=>({fn})});
 w.ready();
 const show=w.d.gpu.show.bind(w.d.gpu),recover=w.d.gpu.recover.bind(w.d.gpu);
 w.d.gpu.show=on=>{events.push(on?'SHOW':'HIDE');return show(on);};
 w.d.gpu.recover=()=>{events.push('RECONNECT');return recover();};
 const send=()=>{
   if(!delayed)return Promise.resolve(true);
   uploads++;events.push('PNG_BEGIN');
   return new Promise((resolve,reject)=>{finish=value=>{events.push(value===false?'PNG_REJECTED':'PNG_DONE');resolve(value);};fail=reject;});
 };
 const draw=()=>{const cv=w.d.canvas(1600,520);cv.clear('#112233');return w.d.present('MAIN_GFX',cv,send);};
 await draw();w.ack();events.length=0;delayed=true;
 return {w,events,draw,advance:n=>{now+=n;},hide:()=>{shown=false;w.d._syncVisible();},show:()=>{shown=true;w.d._syncVisible();},finish:v=>finish(v),fail:()=>fail(Error('RHMI failure')),uploads:()=>uploads};
}
async function run(){
 let f=await setup();f.advance(2500);f.w.d._softIfNoTick();await flush();
 assert.deepEqual(f.events,['PNG_BEGIN']);assert(f.w.d.gpu.visible);assert(!f.w.d.softDone);
 // Even beyond reconnect deadline the GPU stays until upload completion. No queue growth.
 for(let i=0;i<100;i++){f.advance(500);f.w.d._softIfNoTick();await f.draw();}
 assert.equal(f.uploads(),1);assert(!f.events.includes('RECONNECT'));assert(f.w.d.gpu.visible);
 f.finish(true);await flush();
 assert(f.events.indexOf('PNG_DONE')<f.events.indexOf('HIDE'));
 assert(f.events.indexOf('HIDE')<f.events.indexOf('RECONNECT'));
 assert.equal(f.w.d.recoveryAttempts,1);
 const delayedEvents=f.events.slice();
 // The real renderer acknowledges our SHOW(false) with onScreen=false.
 // This is not an external suspension, and a late ACK must not reset recovery.
 f=await setup();f.advance(2500);f.w.d._softIfNoTick();await flush();
 f.finish(true);await flush();assert(f.w.d.softDone);assert(!f.w.d.gpu.visible);
 f.w.words(0x4d520102,[1,0,1]);await flush();
 assert(!f.w.d.rendererSuspended,'own PNG hide must not block recovery');
 assert(!f.w.d.suspensions||!f.w.d.suspensions.length,'own hide is not a suspension strike');
 f.advance(1600);f.w.ack();f.w.d._softIfNoTick();await flush();
 assert.equal(f.w.d.recoveryAttempts,1,'late SHOW ACK cannot postpone reconnect');
 f.w.reconnect();f.w.ready();assert(f.w.d.active('MAIN'));assert(!f.w.d.softDone);
 assert.equal(f.w.d.softStallT,0,'READY starts a fresh frame timeout');
 // Errors and false (transport refusal) retain GPU; a subsequent successful retry switches.
 for(const rejected of [false,true]){
   f=await setup();f.advance(5000);f.w.d._softIfNoTick();await flush();
   if(rejected)f.fail();else f.finish(false);await flush();
   assert(f.w.d.gpu.visible);assert(!f.w.d.softDone);assert(!f.w.d.softPending);assert(!f.w.d.softBusy);
   assert(!f.events.includes('HIDE'));assert(!f.events.includes('RECONNECT'));
   f.advance(1000);f.w.d._softIfNoTick();await flush();f.finish(true);await flush();
   assert(f.w.d.softDone);assert.equal(f.w.d.recoveryAttempts,1);
 }
 // A completion from a previous READY or a screen we left cannot hide a new surface.
 f=await setup();f.advance(2500);f.w.d._softIfNoTick();await flush();
 f.w.ready();f.events.length=0;f.finish(true);await flush();assert(!f.events.includes('HIDE'));assert(!f.w.d.softDone);
 f=await setup();f.advance(2500);f.w.d._softIfNoTick();await flush();
 f.hide();f.show();f.events.length=0;f.finish(true);await flush();assert(!f.events.includes('HIDE'));assert(!f.w.d.softDone);
 // Actual packaged RHMI image method: do not report swallowed setValue errors as success.
 const source=fs.readFileSync(root+'/kit/mgu.js','utf8'),start=source.indexOf('    _image(name, img, cell) {');
 const end=source.indexOf('\n}\n',start),body=source.slice(start,end).replace('_image(name, img, cell)','function image(name, img, cell)');
 const image=vm.runInNewContext('('+body+')',{Buffer,Date,Promise,path,fs:{writeFileSync(){},renameSync(){}},RHMI_RES:'/test',RUN_TAG:'test',log:{info(){},warn(){}}});
 let rejectSet=false,release;
 const rb={createResourceHandles:()=>Promise.resolve(),getResourceHandle:()=>42,destroyResourceHandles:()=>Promise.resolve()};
 const host={_img:{},timing:{png:0,push:0},rhmi:{getResourceBundle:()=>rb},comp:()=>({setValue:()=>rejectSet?Promise.reject(Error('setValue')):Promise.resolve()})};host._image=image;
 assert.strictEqual(await image.call(host,'MAIN',Buffer.from('png')),true);
 rejectSet=true;assert.strictEqual(await image.call(host,'MAIN',Buffer.from('png')),false);
 host.comp=()=>null;assert.strictEqual(await image.call(host,'MAIN',Buffer.from('png')),false);
 host.comp=()=>({setValue:()=>new Promise(resolve=>{release=resolve;})});
 const a=image.call(host,'MAIN',Buffer.from('a'));await flush();const b=image.call(host,'MAIN',Buffer.from('b'));
 release();await flush();let done=false;b.then(()=>{done=true;});await flush();assert(!done,'coalesced frame must finish too');
 release();assert.strictEqual(await a,true);assert.strictEqual(await b,true);
 console.log('PASS PNG handoff: delayed upload, 100 waiting ticks, error/refusal/retry, stale READY/focus, single upload, RHMI success/failure/coalescing. Events: '+delayedEvents.join(' -> '));
}
run().catch(e=>{console.error(e);process.exitCode=1;});
