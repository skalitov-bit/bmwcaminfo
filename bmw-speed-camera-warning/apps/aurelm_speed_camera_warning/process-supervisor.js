'use strict';
// Keep the process launched by MainApp alive when the worker crashes. No root
// service, MainApp restart, data deletion, or wake-lock. Hardware validation of
// SDK lifecycle registration from the worker remains necessary before release.
const cp=require('child_process');
const BACKOFF=[3000,10000,30000,60000,300000];
class Supervisor {
 constructor(entry,options){
  const o=options||{};this.entry=entry;this.fork=o.fork||cp.fork;this.now=o.now||Date.now;this.later=o.setTimeout||setTimeout;this.cancel=o.clearTimeout||clearTimeout;
  this.log=o.log||(s=>console.error(s));this.done=o.done||(code=>process.exit(code));this.delays=o.delays||BACKOFF;this.child=null;this.retry=null;this.killTimer=null;this.stopping=false;this.failures=0;this.restarts=0;this.started=0;
  this.replacing=null;this.gateOnly=false;this.resumeEntry='';
 }
 start(){
  if(this.stopping||this.child)return;this.retry=null;this.started=this.now();
  const env=Object.assign({},process.env,{SPEEDCAM_SUPERVISED_WORKER:'1',SPEEDCAM_RESTART_COUNT:String(this.restarts)});
  env.SPEEDCAM_GATE_ONLY=this.gateOnly?'1':'0';
  env.SPEEDCAM_USER_RESUME=this.resumeEntry?'1':'0';env.SPEEDCAM_RESUME_ENTRY=this.resumeEntry;this.resumeEntry='';
  let ch;
  try{ch=this.fork(this.entry,process.argv.slice(2),{env,cwd:process.cwd(),stdio:['ignore','inherit','inherit','ipc']});}catch(e){this.log('APP_WORKER_SPAWN_ERROR '+String(e));this.schedule();return;}
  this.child=ch;this.log('APP_WORKER_START restart='+this.restarts);
  ch.on('message',m=>{if(this.child!==ch||!m||m.speedcamLifecycle!==1)return;
   if(m.event==='park'||m.event==='resume'){this.replace(m);return;}
   if(m.event==='shutdown'&&!this.replacing)this.stop();
  });
  ch.on('error',e=>this.log('APP_WORKER_ERROR '+String(e)));
  // Wait for close, not exit: do not overlap the old worker with a new one.
  ch.once('close',(code,signal)=>{
   if(this.child!==ch)return;this.child=null;if(this.killTimer!==null)this.cancel(this.killTimer);this.killTimer=null;
   if(this.stopping){this.done(0);return;}
   if(this.replacing){this.replacing=null;this.start();return;}
   if(this.now()-this.started>=300000)this.failures=0;
   this.log('APP_WORKER_EXIT code='+code+' signal='+signal);this.schedule();
  });
 }
 schedule(){if(this.stopping||this.retry!==null)return;const delay=this.delays[Math.min(this.failures++,this.delays.length-1)];this.restarts++;this.log('APP_WORKER_RETRY delayMs='+delay);this.retry=this.later(()=>{this.retry=null;this.start();},delay);}
 replace(message){
  if(this.stopping||this.replacing||!this.child)return;
  if(message.event==='resume'&&(typeof message.entryUuid!=='string'||!message.entryUuid||message.entryUuid.length>256))return;
  this.replacing=message.event;this.gateOnly=message.event==='park';this.resumeEntry=this.gateOnly?'':message.entryUuid;
  this.log('APP_WORKER_REPLACE '+message.event);
  const ch=this.child;
  this.killTimer=this.later(()=>{if(this.child===ch)ch.kill('SIGKILL');},5000);
  if(ch.connected)ch.send({speedcamLifecycle:1,event:'stop'},()=>{});else ch.kill('SIGTERM');
 }
 stop(){
  if(this.stopping)return;this.stopping=true;if(this.retry!==null)this.cancel(this.retry);this.retry=null;
  const ch=this.child;if(!ch){this.done(0);return;}
  // Let the SDK shutdown listener finish its normal teardown first.
  this.killTimer=this.later(()=>{if(this.child===ch)ch.kill('SIGKILL');},5000);
  if(ch.connected)ch.send({speedcamLifecycle:1,event:'stop'},()=>{});
  else ch.kill('SIGTERM');
 }
}
module.exports={Supervisor,BACKOFF};
