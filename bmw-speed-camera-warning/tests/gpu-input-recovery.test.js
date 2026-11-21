'use strict';
const assert=require('assert'),path=require('path');
const root=path.resolve(process.argv[2]),{make}=require('./display-wire-fixture');
let now=10000,shown=true;
const ui={isVisible:n=>shown&&n==='MAIN',hasFocus:()=>shown,_invalidate(){}};
const fixture=()=>make(root,ui,{now:()=>now,setTimeout:fn=>({fn})});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function run(){
 let w=fixture();w.ready(1);assert.equal(w.d.recoveryLocked,'INPUT_CAPABILITIES','missing controller must not silently take the screen');
 assert(!w.d.active());assert(!w.d.gpu.grabbing);
 w=fixture();w.ready(6);assert.equal(w.d.recoveryLocked,'INPUT_CAPABILITIES','missing touch');
 w=fixture();w.ready(7,0);assert.equal(w.d.recoveryLocked,'INPUT_CAPABILITIES','server offers no layer mode');
 w=fixture();w.words(0x4d520101,[1,1,7]);w.words(101,[4,1920,720,1]);
 w.words(0x4d520102,[1,0,1]);assert(w.d.active(),'initial surface not shown must allow the first frame');
 let hits=0,uploads=0;
 function draw(){const r=w.d.canvas(1600,520);r.clear('#000000');r.fillRect(20,24,222,98,'#d32c36');r.target(20,24,222,98,()=>hits++,'nav-MAP');return w.d.present('MAIN_GFX',r,()=>{uploads++;});}
 await draw();w.words(0x4d520102,[1,1,1]);w.ack();
 w.tap(100,60);assert.equal(hits,1);
 w.ccu(100);w.ccu(101);w.ccu(101,1);assert.equal(hits,2);
 assert.equal(w.d.touchEvents,2);assert.equal(w.d.ccuEvents,3);
 // Native temporary input/yield guard: do not reconnect or turn a late TICK into SHOW.
 w.words(0x4d520102,[1,0,1]);await flush();assert(w.d.rendererSuspended);assert(!w.d.active());
 assert(uploads>=2,'visible PNG replaces the blank background during suspension');
 now+=10000;w.d._softIfNoTick();assert(!w.d.recoveryAttempts,'suspension is not a dead socket');
 const before=hits;w.tap(100,60);w.ccu(102,1);assert.equal(hits,before,'stale hidden input cannot activate controls');
 const frames=w.packets.filter(p=>p.readUInt32LE(0)===7).length;w.timers.forEach(fn=>fn());
 assert(w.packets.filter(p=>p.readUInt32LE(0)===7).length>frames,'keepalive continues while renderer temporarily suspends surface');
 w.words(0x4d520102,[1,1,1]);await draw();w.tap(100,60);assert.equal(hits,before+1,'input works after suspension');
 // Genuine frame timeout: one reconnect; repeated failure is latched, never a blanking loop.
 now+=2500;w.d._softIfNoTick();await flush();assert(w.d.softDone);assert(!w.d.gpu.grabbing);
 w.ack();assert(w.d.softDone,'late PLACE/SHOW/TICK does not resurrect failed input');
 now+=4500;w.d._softIfNoTick();assert.equal(w.d.recoveryAttempts,1);
 w.reconnect();w.ready();await flush();assert(!w.d.softDone);
 now+=4500;w.d._softIfNoTick();await flush();assert.equal(w.d.recoveryLocked,'REPEATED_STALL');
 const attempts=w.d.recoveryAttempts;now+=60000;w.ack();w.d._softIfNoTick();assert(w.d.softDone);assert.equal(w.d.recoveryAttempts,attempts);
 // Repeated temporary hides must not become a second recovery loop.
 const suspended=fixture();suspended.ready();
 for(let i=0;i<3;i++){suspended.words(0x4d520102,[1,0,1]);suspended.words(0x4d520102,[1,1,1]);}
 assert.equal(suspended.d.recoveryLocked,'REPEATED_SUSPEND');assert(!suspended.d.active());
 // Emergency controls are native RHMI actions, not calls to GPU hit testing.
 const handlers={},opened=[],texts=[];let front=false;
 const mUi={comp:()=>true,isVisible:()=>false,onClick:(k,fn)=>handlers[k]=fn,text:(k,v)=>texts.push(v),open:n=>opened.push(n),close:n=>opened.push('close:'+n)};
 const d={recoveryLocked:'REPEATED_STALL',_shown:()=>front,renderDiagnostics:()=>({reason:'REPEATED_STALL',touch:true,controller:false,touchEvents:2,ccuEvents:0}),_mode(){this.started=true;}};
 const menu=require(root+'/display-recovery-menu').install({display:d,ui:mUi,log:{warn(){}}});
 menu.check();await flush();assert.equal(opened.length,0,'never open recovery over CarPlay');
 front=true;menu.check();await flush();assert(opened.includes('DISPLAY_RECOVERY'));
 handlers.DISPLAY_SETTINGS();assert(opened.includes('SETTINGS'));
 handlers.DISPLAY_RETRY();assert(d.started);assert.equal(d.recoveryLocked,null);assert(opened.includes('MAIN'));menu.close();
 console.log('PASS GPU wire recovery: capabilities, first frame, touch/controller, temporary hide, keepalive, PNG, stale input/TICK, bounded reconnect, native recovery and foreground gating. No vehicle tested.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
