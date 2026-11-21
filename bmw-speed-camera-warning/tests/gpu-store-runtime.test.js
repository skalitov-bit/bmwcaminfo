'use strict';
// Packaged runtime contract: no renderer -> PNG -> GPU -> lost/stalled -> PNG -> GPU.
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm'),EventEmitter=require('events');
const root=path.resolve(process.argv[2]);
let available=false,now=10000,polls=[],frames=0,uploads=0;
class Clock extends Date{static now(){return now;}}
class GPU extends EventEmitter{
 static available(){return available;}
 constructor(){super();this.ready=false;this.native=true;this.touch=true;this.visible=false;this.screen={w:1920,h:720};this.opts={};}
 connect(){} show(v){this.visible=v;} grab(v){this.grabbing=v;} claim(a){this.claims=a;}
 frame(){frames++;} place(){} dropLayer(){} recover(){this.recovered=true;this.ready=false;return true;}
 close(){this.ready=false;this.closed=true;}
}
const mod={exports:{}};
vm.runInNewContext(fs.readFileSync(root+'/kit/display.js','utf8'),{
 module:mod,exports:mod.exports,Buffer,Uint32Array,process:{env:{}},Date:Clock,console,
 require:p=>p==='./renderd'?{RenderClient:GPU}:require(root+'/kit/'+p),
 setInterval:fn=>{const t={fn,unref(){}};polls.push(t);return t;},clearInterval:t=>{if(t)t.cancelled=true;},
 setTimeout:fn=>({fn}),clearTimeout(){}
});
const {Display}=mod.exports,{Recorder}=require(root+'/kit/record');
const d=Object.create(Display.prototype);let mode='auto',shown=true;
Object.assign(d,{spec:{id:'gpu-test'},screen:{name:'MAIN',buttons:[]},settings:{get:k=>k==='renderer'?mode:'full'},
 ui:{isVisible:n=>shown&&n==='MAIN',hasFocus:()=>shown,_invalidate(){}},theme:()=>({bg:'#000000'}),
 log:{info(){},warn(){}},recorders:new Map(),tickHandlers:[],layoutHandlers:[],
 place:{full:true,scale:1},_place(){this.place={full:true,scale:1};},_reach(){},_hmiBar(){},_layoutChanged(){},
 _claimTabs(){},_repaint(){},shownT:now,tickT:now});
const record=()=>{const r=new Recorder(8,8);r.clear('#d32c36');return r;};
const image=()=>{uploads++;return Promise.resolve();};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function run(){
 d._mode();assert(!d.gpu);assert(d.poll);assert(!d.active('MAIN'));
 await d.present('MAIN_GFX',record(),image);assert.equal(uploads,1,'PNG when renderer absent');
 available=true;d.poll.fn();assert(d.gpu);assert.equal(d.poll,null);
 const g=d.gpu;g.ready=true;g.emit('ready');assert(d.active('MAIN'));
 // Native path sends ops. Its one plain background upload is expected; subsequent frames are GPU-only.
 await d.present('MAIN_GFX',record(),image);const sent=frames,blank=uploads;
 await d.present('MAIN_GFX',record(),image);assert.equal(uploads,blank);assert(frames>=sent);
 now+=2500;d._softIfNoTick();await flush();assert(!d.active('MAIN'));assert(!g.visible);assert(!g.grabbing);
 assert.equal(g.claims.length,0);const fallback=uploads;
 await d.present('MAIN_GFX',record(),image);assert.equal(uploads,fallback+1,'stalled native renderer must not swallow PNG');
 now+=2000;d._softIfNoTick();await flush();assert(g.recovered,'hidden stalled surface still reconnects');
 g.emit('tick');assert(!d.active('MAIN'),'late tick cannot re-enable a failed layer');
 g.ready=true;g.emit('ready');assert(d.active('MAIN'));assert(g.visible);assert(!d.softDone);
 g.ready=false;g.emit('close');await flush();assert(!d.active('MAIN'));
 const lost=uploads;await d.present('MAIN_GFX',record(),image);assert.equal(uploads,lost+1);
 g.ready=true;g.emit('ready');assert(d.active('MAIN'));
 shown=false;d._syncVisible();assert(!g.visible);assert(!d.active('MAIN'));assert(!g.grabbing);
 shown=true;d._syncVisible();assert(g.visible);assert(d.active('MAIN'));
 mode='software';d._mode();assert.equal(d.gpu,null);assert(!d.poll);assert(!d.active('MAIN'));
 mode='auto';d._mode();assert(d.gpu,'auto can be restored without restarting app');
 const client=fs.readFileSync(root+'/kit/renderd.js','utf8');
 assert(client.includes("['/run/mgu-renderd/renderd.sock']"),'use the shared idrive7 service');
 assert(!client.includes("'/run/mgu-render/render.sock'"),'do not silently choose another renderer');
 console.log('PASS GPU runtime: auto discovery, real PNG fallback, GPU command path, stall/input release, reconnect, foreground, explicit software override, idrive7 socket. Vehicle/GPU not tested.');
}
run().catch(e=>{console.error(e.stack);process.exitCode=1;});
