'use strict';
const assert=require('assert'),EventEmitter=require('events');
const {DisplayOutputProbe}=require('../apps/aurelm_speed_camera_warning/display-output-probe');
const {AudioDiagnostics}=require('../apps/aurelm_speed_camera_warning/audio-diagnostics');
function fixture(mode){
 const cr=new EventEmitter();cr.ready=true;cr.targets='map:1088x480,hud:800x480';
 const output={mode,gpsStatus:'lost',cr,layers:{map:'m',hud:'h'},backplate:'b',current:null,
  setMode(m){this.mode=m;},setGpsStatus(s){this.gpsStatus=s;},clear(){this.current=null;},show(e){this.current=e;}};
 let count=0;const f={output,moving:false};
 f.probe=new DisplayOutputProbe(output,{moving:()=>f.moving,sleep:async()=>{},snapshot:async(client,info)=>{
  assert.strictEqual(client,cr);assert.equal(output.mode,'both');assert(output.current,'Snapshot must precede hide');
  assert(info.duringTest&&info.alertActive);count++;cr.emit('target','hud','shown');return Object.assign({status:'map shown; hud shown'},info);
 }});f.count=()=>count;return f;
}
async function run(){
 for(const mode of ['hud','kombi','both','off']){
  const f=fixture(mode),r=await f.probe.run();assert.equal(r.phase,'completed');assert.equal(f.count(),2);assert.equal(f.output.mode,mode);
  assert.equal(f.output.gpsStatus,'lost');assert(!f.output.current&&!f.probe.busy);assert.equal(r.events.length,2);assert.equal(f.output.cr.listenerCount('target'),0);
  assert.strictEqual(f.probe.last,r);assert(r.snapshots.every(s=>s.outputMode==='both'));assert.equal(r.visualConfirmation,false);
 }
 let f=fixture('hud');f.moving=true;await assert.rejects(f.probe.run(),/остановите/);assert.equal(f.output.mode,'hud');
 f=fixture('hud');f.probe.sleep=async()=>{f.moving=true;};let r=await f.probe.run();assert.equal(r.phase,'failed');assert(!f.output.current);assert.equal(f.output.mode,'hud');
 f=fixture('kombi');let release;f.probe.sleep=()=>new Promise(resolve=>{release=resolve;});const pending=f.probe.run();
 await assert.rejects(f.probe.run(),/уже/);f.probe.stop();assert(!f.output.current);assert.equal(f.output.mode,'kombi');release();r=await pending;assert.equal(r.phase,'cancelled');
 f=fixture('hud');f.probe.o.snapshot=async()=>{throw Error('status disconnected');};r=await f.probe.run();assert.equal(r.error,'status disconnected');assert.equal(f.output.mode,'hud');assert.equal(f.output.cr.listenerCount('refused'),0);
 f=fixture('hud');f.output.cr.ready=false;r=await f.probe.run();assert(r.error.includes('3,5'));assert.equal(f.count(),0);
 f=fixture('hud');const ui=new AudioDiagnostics(()=>{},{testDisplays:()=>f.probe.run(),stopDisplays:()=>f.probe.stop()});
 await ui.testDisplays();assert.equal(ui.reportKind,'display');assert(ui.reportPages.join().includes('map shown'));assert(!ui.busy);assert.equal(f.output.mode,'hud');
 console.log('PASS combined display probe: active snapshots, exact original-mode restore, same client, cancellation, movement, timeout and UI report. Renderer mocked.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
