'use strict';
const assert=require('assert'),EventEmitter=require('events');
const {Supervisor,BACKOFF}=require('../apps/aurelm_speed_camera_warning/process-supervisor');
let now=0,children=[],timers=[],done=0,options;
function child(){const c=new EventEmitter();c.connected=true;c.send=m=>{c.sent=m;};c.kill=s=>{c.killed=s;};children.push(c);return c;}
const s=new Supervisor('/app.js',{fork:(entry,args,o)=>{options=o;return child();},now:()=>now,setTimeout:(fn,ms)=>{const t={fn,ms};timers.push(t);return t;},clearTimeout:t=>{t.canceled=true;},done:()=>done++,log:()=>{}});
s.start();s.start();assert.equal(children.length,1);assert.equal(options.env.SPEEDCAM_SUPERVISED_WORKER,'1');
for(let i=0;i<7;i++){
 const c=children[children.length-1];c.emit('exit',1);assert.strictEqual(s.child,c,'Wait for close before replacing worker');c.emit('close',1,null);
 assert.equal(timers[i].ms,BACKOFF[Math.min(i,BACKOFF.length-1)]);assert.equal(done,0);timers[i].fn();assert.equal(children.length,i+2);
}
now=300001;s.child.emit('close',1,null);assert.equal(timers[7].ms,3000,'Stable worker resets backoff');timers[7].fn();
const last=s.child;last.emit('message',{speedcamLifecycle:1,event:'shutdown'});assert(s.stopping);assert.equal(last.sent.event,'stop');
last.emit('close',0,null);assert.equal(done,1);assert(timers[8].canceled);s.start();assert.equal(children.length,9);
const paused=new Supervisor('app',{fork:()=>{throw Error('spawn');},setTimeout:(f,ms)=>({f,ms}),clearTimeout:t=>{t.canceled=true;},done:()=>done++,log:()=>{}});
paused.start();const retry=paused.retry;paused.stop();assert(retry.canceled);assert.equal(paused.child,null);
console.log('PASS single worker, crash backoff, stable reset, OEM shutdown, pending restart cancellation');
