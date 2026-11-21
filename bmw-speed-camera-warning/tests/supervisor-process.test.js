'use strict';
// Actual child exit/restart on both Node 8 and current Node, not just mocks.
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const {Supervisor}=require('../apps/aurelm_speed_camera_warning/process-supervisor');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'speedcam-supervisor-')),entry=path.join(dir,'worker.js'),marker=path.join(dir,'starts.txt');
const settings=path.join(dir,'settings.json');fs.writeFileSync(settings,'{"auto_monitor":"on","audio":"M4A+Overlay"}');
fs.writeFileSync(entry,"const fs=require('fs');fs.appendFileSync("+JSON.stringify(marker)+",process.env.SPEEDCAM_RESTART_COUNT+'\\n');if(process.env.SPEEDCAM_RESTART_COUNT==='0'){setTimeout(()=>process.exit(23),20);}else{process.on('message',m=>{if(m.event==='stop')process.exit(0);});process.send({speedcamLifecycle:1,event:'shutdown'});}");
const deadline=setTimeout(()=>{console.error('Supervisor timed out');guard.stop();process.exitCode=1;},10000);
const guard=new Supervisor(entry,{delays:[30],log:s=>console.log(s),done:()=>{
 clearTimeout(deadline);
 try{assert.equal(fs.readFileSync(marker,'utf8'),'0\n1\n');assert.equal(fs.readFileSync(settings,'utf8'),'{"auto_monitor":"on","audio":"M4A+Overlay"}');assert.equal(guard.child,null);assert.equal(guard.restarts,1);console.log('PASS actual crash -> worker restart -> OEM stop; settings preserved');}
 catch(e){console.error(e);process.exitCode=1;}
 [entry,marker,settings].forEach(f=>{if(fs.existsSync(f))fs.unlinkSync(f);});fs.rmdirSync(dir);
}});guard.start();
