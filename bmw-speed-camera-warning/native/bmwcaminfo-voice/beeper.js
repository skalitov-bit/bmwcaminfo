'use strict';
const FILE='beeper-21.m4a';
// Executed on the voice service's shared queue: speech and beeps cannot overlap.
class Beeper {
 constructor(service,options){options=options||{};this.service=service;this.now=options.now||Date.now;this.sleep=options.sleep||(ms=>new Promise(resolve=>setTimeout(resolve,ms)));this.exists=options.exists||require('fs').existsSync;this.root=options.root||'/var/opt/bmwcaminfo-voice/current';this.state=null;this.running=false;this.retryAt=0;}
 set(request,owner){
  if(![350,600,1000,1500,2000].includes(request.intervalMs)||typeof request.cameraId!=='string'||request.cameraId.length>200||
     !Number.isInteger(request.volume)||request.volume<10||request.volume>100||request.volume%10)throw Error('Invalid beeper state');
  this.state={owner,cameraId:request.cameraId,intervalMs:request.intervalMs,volume:request.volume,expires:this.now()+1200};
  this.kick();return {ok:true};
 }
 clear(owner){if(this.state&&this.state.owner===owner)this.state=null;}
 live(){return this.state&&this.state.expires>this.now()&&!this.service.speechPending;}
 kick(){
  if(this.running||!this.live()||this.now()<this.retryAt)return;
  this.running=true;
  const task=this.service.queue.then(()=>this.run());
  this.service.queue=task.catch(error=>{this.service.lastError='Beeper: '+error.message;this.retryAt=this.now()+10000;}).then(()=>{this.running=false;});
 }
 async run(){
  const svc=this.service;
  if(!this.live())return;
  await svc.waitAvailable();
  if(!this.live())return;
  try{
   await svc.connectAudio();
   let last=-Infinity;
   while(this.live()){
    const state=this.state;
    if(this.now()-last<state.intervalMs){await this.sleep(20);continue;}
    const audio=this.root+'/audio/'+(state.volume===100?'':'volume-'+state.volume+'/')+FILE;
    if(!this.exists(audio))throw Error('Beeper asset missing');
    if(!this.live())break;
    last=this.now();
    const result=await svc.mp.callMethod('playFile',{path:audio,languageCode:7695972},7000);
    if(!result||result.EntError!=='OK')throw Error('BMW MediaPlayer rejected beeper');
    // AAC includes its padding; finish this short pulse before yielding to speech.
    await this.sleep(280);
   }
  }finally{await svc.release();}
 }
}
module.exports={Beeper};
