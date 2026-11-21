'use strict';
// One transient RHMI popup, independent of the app's foreground canvas.
// Vehicle acceptance (and the SDK's popUp/openState contract) still needs an MGU test.
// A resolved API call is NOT treated as evidence that the HMI displayed it.
const fs=require('fs'),path=require('path');
const POPUP='SPEEDCAM_POPUP',GRAPHIC='SPEEDCAM_POPUP_GFX';
class RhmiPopupTransport {
 constructor(ui,log) {
  this.rhmi=ui.rhmi;this.log=log;this.serial=0;this.live=[];this.tag=Date.now().toString(36);
  this.dir=path.resolve(__dirname,'../../rhmiData/resources');
  const rhmi=this.rhmi;
  try {
   this.component=rhmi&&typeof rhmi.getByName==='function'?rhmi.getByName(POPUP):null;
   this.graphic=rhmi&&typeof rhmi.getByName==='function'?rhmi.getByName(GRAPHIC):null;
  } catch(e) { this.component=null;this.graphic=null;log('CENTRAL_POPUP_LOOKUP_ERROR '+String(e)); }
  // Vehicle report: this experimental RHMI popUp replaces/blocks CarPlay with
  // a black modal surface. Never open it automatically until a nonmodal native
  // transport is verified. In-app canvas, HUD and KOMBI remain independent.
  this.available=false;
  this.unavailableReason='MODAL_RHMI_DISABLED';
  if(this.available&&typeof this.component.on==='function')this.component.on('visible',ev=>{
   if(this.onVisible)this.onVisible(!!(ev&&ev.visible));
  });
 }
 async paint(event,speed) {
  if(!this.available)throw Error(this.unavailableReason);
  const {Canvas}=require('./kit/canvas'),{drawCentralAlert}=require('./central-alert');
  const cv=new Canvas(1456,174).clear('#080b10');
  drawCentralAlert(cv,event,speed,{x:0,y:0,w:1456});
  const file=path.join(this.dir,'dyn_'+this.tag+'_speedcam_popup_'+(this.serial++%4)+'.png');
  fs.writeFileSync(file+'.tmp',cv.png());fs.renameSync(file+'.tmp',file);
  const rb=this.rhmi.getResourceBundle();
  await rb.createResourceHandles([file]);
  await this.graphic.setValue(0,'Graphic',rb.getResourceHandle(file),'Asset');
  this.live=this.live.filter(f=>f!==file).concat([file]);
  while(this.live.length>2)await rb.destroyResourceHandles([this.live.shift()]);
 }
 open(){if(!this.available)return Promise.reject(Error(this.unavailableReason));return this.rhmi.openState(POPUP);}
 close(){return this.rhmi.closeState(POPUP);}
}
class BackgroundNotification {
 constructor(transport,log,now) {
  this.transport=transport;this.log=log||(()=>{});this.now=now||Date.now;
  this.desired=null;this.opened=false;this.busy=false;this.key=null;this.dismissed=null;
  this.lastPaint=0;this.openAt=0;this.retryAt=0;this.generation=0;this.paintedKey=null;
  this.status=transport.available?'unverified':'unavailable';
  transport.onVisible=on=>{
   if(on){if(this.status!=='visible')this.openAt=this.now();this.opened=true;this.status='visible';this.log('CENTRAL_POPUP_VISIBLE');if(!this.desired)this.kick();}
   else if(this.opened){this.dismissed=this.key;this.opened=false;this.status='hidden';}
  };
  if(!transport.available)this.log('CENTRAL_POPUP_UNAVAILABLE');
 }
 update(event,speed) {
  const key=event?String(event.camera.id)+':'+(event.phase||'approach'):null;
  if(key!==this.key){this.generation++;this.dismissed=null;this.key=key;}
  this.desired=event?{event,speed,key,generation:this.generation}:null;
  this.kick();
 }
 clear(){this.update(null,null);}
 kick(){
  if(this.busy||!this.transport.available||this.now()<this.retryAt)return;
  this.busy=true;
  this.pending=this.flush().catch(e=>{
   this.status='error';this.retryAt=this.now()+5000;
   this.log('CENTRAL_POPUP_ERROR '+String(e&&e.message||e));
  }).then(()=>{this.busy=false;});
 }
 async flush(){
  // The newest update replaces pending ones; never replay a backlog after a slow HMI.
  let wanted=this.desired;
  if(!wanted){if(this.opened){await this.transport.close();this.opened=false;this.status='hidden';}return;}
  if(this.opened&&this.paintedKey===wanted.key&&this.now()-this.openAt>=3500){
   this.dismissed=this.key;await this.transport.close();this.opened=false;this.status='hidden';return;
  }
  if(this.dismissed===wanted.key)return;
  if(this.opened&&this.paintedKey!==wanted.key){
   // Reset the HMI's own popup timeout as well as our local lifetime.
   this.opened=false;await this.transport.close();this.status='hidden';
   if(!this.desired||this.desired.generation!==wanted.generation)return;
  }
  if(this.opened&&this.now()-this.lastPaint<250)return;
  await this.transport.paint(wanted.event,wanted.speed);this.lastPaint=this.now();
  if(!this.desired||this.desired.generation!==wanted.generation)return;
  if(this.paintedKey!==wanted.key){this.paintedKey=wanted.key;this.openAt=this.now();}
  if(!this.opened){
   this.opened=true;this.openAt=this.now();this.status='requested';
   try{await this.transport.open();}catch(e){this.opened=false;throw e;}
   this.log('CENTRAL_POPUP_REQUESTED (not a display confirmation)');
   // Disabled, GPS expired, or Radar became visible while open() was pending.
   if(!this.desired||this.desired.generation!==wanted.generation){await this.transport.close();this.opened=false;this.status='hidden';}
  }
 }
}
module.exports={BackgroundNotification,RhmiPopupTransport,POPUP,GRAPHIC};
