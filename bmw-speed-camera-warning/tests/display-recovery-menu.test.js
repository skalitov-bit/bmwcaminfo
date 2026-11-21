'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.resolve(process.argv[2]);let now=10000,front=true;
class Clock extends Date {static now(){return now;}}
const mod={exports:{}};
vm.runInNewContext(fs.readFileSync(root+'/display-recovery-menu.js','utf8'),{
 module:mod,exports:mod.exports,Date:Clock,Promise,setInterval:()=>({unref(){}}),clearInterval(){}
});
const opened=[],handlers={};
const d={gpu:{ready:true,claim(){},grab(){},show(){}},_shown:()=>front,
 renderDiagnostics:()=>({reason:'CONNECTING',touch:true,controller:true}),_mode(){}};
const ui={comp:()=>true,isVisible:()=>false,onClick:(id,fn)=>handlers[id]=fn,text(){},open:n=>opened.push(n),close(){}};
const menu=mod.exports.install({display:d,ui,log:{warn(){}}});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function run(){
 menu.check();now+=60000;menu.check();
 d.gpu.ready=false;menu.check();await flush();assert.equal(opened.length,0,'long app uptime is not a disconnect timeout');
 now+=3000;menu.check();await flush();assert.equal(opened.length,0,'PNG remains while reconnecting');
 d.gpu.ready=true;menu.check();now+=15000;menu.check();assert.equal(opened.length,0);
 d.gpu.ready=false;menu.check();now+=9999;menu.check();await flush();assert.equal(opened.length,0);
 now++;menu.check();await flush();assert.deepEqual(opened,['DISPLAY_RECOVERY'],'sustained disconnect still offers recovery');
 opened.length=0;d.gpu.ready=true;d.recoveryLocked='REPEATED_STALL';front=false;menu.check();await flush();assert.equal(opened.length,0,'never cover CarPlay');
 front=true;menu.check();await flush();assert.equal(opened.length,1,'locked failure is immediate');menu.close();
 console.log('PASS recovery menu: reconnect grace after long uptime, READY reset, persistent failure, repeated-stall lock, foreground gate');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
