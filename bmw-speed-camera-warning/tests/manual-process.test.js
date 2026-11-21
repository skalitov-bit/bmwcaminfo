'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),cp=require('child_process');
const {Supervisor}=require('../apps/aurelm_speed_camera_warning/process-supervisor');
const moduleFile=path.resolve(__dirname,'../apps/aurelm_speed_camera_warning/manual-launch');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'speedcam-manual-process-')),entry=path.join(dir,'worker.js'),records=path.join(dir,'records.txt');
fs.writeFileSync(entry,`const fs=require('fs'),EventEmitter=require('events');
const app=new EventEmitter();app.startReason='ENTRY_POINT';
const g=new (require(${JSON.stringify(moduleFile)}).ManualLaunchGate)(app,${JSON.stringify(dir)});
process.on('message',m=>{if(m.event==='stop'){process.send({speedcamLifecycle:1,event:'shutdown'});setTimeout(()=>process.exit(0),10);}if(m.event==='tap')app.emit('entryPointExecute','test-tile');});
if(!g.allowStart()){fs.appendFileSync(${JSON.stringify(records)},'paused\\n');process.send({fixture:'paused'});}
else{fs.appendFileSync(${JSON.stringify(records)},'active\\n');if(process.env.SPEEDCAM_USER_RESUME==='1')process.send({speedcamLifecycle:1,event:'shutdown'});else setTimeout(()=>g.close(),10);}
`);
let parked=false;const deadline=setTimeout(()=>{guard.stop();console.error('Manual process test timed out');process.exitCode=1;},10000);
const guard=new Supervisor(entry,{log:()=>{},fork:(f,a,o)=>{const c=cp.fork(f,a,o);c.on('message',m=>{if(m.fixture==='paused'){
 parked=true;assert.equal(fs.readFileSync(records,'utf8'),'active\npaused\n');
 setTimeout(()=>{assert.equal(fs.readFileSync(records,'utf8'),'active\npaused\n','No autonomous monitoring restart');c.send({event:'tap'});},80);
 }});return c;},done:()=>{
 clearTimeout(deadline);
 try{assert(parked);assert.equal(fs.readFileSync(records,'utf8'),'active\npaused\nactive\n');assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'manual-close.json'))).paused,false);assert.equal(guard.restarts,0);console.log('PASS actual workers: close -> no monitoring -> explicit tile -> resumed; parent never exits during replacement');}
 catch(e){console.error(e);process.exitCode=1;}
 fs.readdirSync(dir).forEach(f=>fs.unlinkSync(path.join(dir,f)));fs.rmdirSync(dir);
}});guard.start();
