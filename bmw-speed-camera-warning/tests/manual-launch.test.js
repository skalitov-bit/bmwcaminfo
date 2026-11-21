'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os'),EventEmitter=require('events');
const {ManualLaunchGate,ManualLaunchStore}=require('../apps/aurelm_speed_camera_warning/manual-launch');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'speedcam-launch-'));
try{
 const store=new ManualLaunchStore(dir),sent=[];
 function gate(reason,env){const app=new EventEmitter();app.startReason=reason;return new ManualLaunchGate(app,dir,{store,env:env||{},send:m=>sent.push(m)});}
 let g=gate('AUTOSTART');assert(g.allowStart());g.close();assert(store.paused());assert.equal(sent.pop().event,'park');g.close();assert.equal(sent.length,0,'Double click idempotent');
 for(const reason of ['AUTOSTART','RESUME','LUM','UNKNOWN',undefined])assert(!gate(reason).allowStart(),'No auto restart '+reason);
 assert(!gate('ENTRY_POINT',{SPEEDCAM_RESTART_COUNT:'1'}).allowStart(),'Stale manual launch reason after crash');
 assert(!gate('ENTRY_POINT',{SPEEDCAM_GATE_ONLY:'1'}).allowStart(),'Replacement after closing a manually started app');
 g=gate('AUTOSTART');assert(!g.allowStart());g.app.emit('appStatusProxyReady');assert(store.paused(),'SDK reconnect does not rearm');
 g.app.emit('entryPointExecute','real-tile');assert.equal(sent[0].event,'resume');assert.equal(sent[0].entryUuid,'real-tile');assert(store.paused(),'Only new worker commits resume');g.app.emit('entryPointExecute','real-tile');assert.equal(sent.length,1,'Double entry deduplicated');sent.length=0;
 g=gate('AUTOSTART',{SPEEDCAM_USER_RESUME:'1'});assert(g.allowStart());assert(!store.paused());assert(gate('AUTOSTART').allowStart(),'Following boot restored');
 store.save(true);assert(gate('ENTRY_POINT').allowStart());assert(!store.paused());
 store.save(true);g=gate('AUTOSTART');g.app.emit('entryPointExecute','early-tile');assert(g.allowStart(),'Early entry during SDK start');assert(!store.paused());
 fs.writeFileSync(store.file,'broken');assert(!gate('AUTOSTART').allowStart(),'Corrupt marker fails closed');assert(gate('ENTRY_POINT').allowStart(),'Explicit launch repairs marker');
 const fail=new ManualLaunchGate(new EventEmitter(),dir,{env:{},send:()=>{throw Error('IPC');}});assert.throws(()=>fail.close(),/IPC/);assert(!store.paused(),'Failed close rolls back');
 let called=false;const bad=new ManualLaunchGate(new EventEmitter(),dir,{env:{},store:{save(){throw Error('disk');}},send:()=>{called=true;}});assert.throws(()=>bad.close(),/disk/);assert(!called,'Save before close');
 console.log('PASS durable manual close, reboot/sleep/crash suppression, early/late tile, explicit rearm, double actions, corrupt marker and write/IPC failures');
}finally{fs.readdirSync(dir).forEach(f=>fs.unlinkSync(path.join(dir,f)));fs.rmdirSync(dir);}
