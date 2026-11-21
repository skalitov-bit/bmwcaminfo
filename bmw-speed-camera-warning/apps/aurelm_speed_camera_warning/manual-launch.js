'use strict';
// Only the light BMW entry-point bridge survives a user close. Never kill the
// MainApp-owned process: that can invoke BMW's corrupt-app recovery/deletion.
const fs=require('fs'),path=require('path');
class ManualLaunchStore {
 constructor(dir){this.file=path.join(dir,'manual-close.json');}
 paused(){try{return JSON.parse(fs.readFileSync(this.file,'utf8')).paused===true;}catch(e){if(e.code==='ENOENT')return false;return true;}}
 save(paused){
  const tmp=this.file+'.tmp',data=JSON.stringify({schema:1,paused:!!paused})+'\n';
  fs.writeFileSync(tmp,data);fs.renameSync(tmp,this.file);
 }
}
class ManualLaunchGate {
 constructor(app,dir,options){
  const o=options||{};this.app=app;this.store=o.store||new ManualLaunchStore(dir);this.env=o.env||process.env;
  this.send=o.send||((m)=>{if(!process.connected||typeof process.send!=='function')throw Error('Нет связи с обработчиком запуска');process.send(m);});
  this.log=o.log||(()=>{});this.manualEntry=null;this.parked=false;this.requested=false;this.closing=false;
  app.on('entryPointExecute',(uuid)=>{if(typeof uuid!=='string'||!uuid||uuid.length>256)return;this.manualEntry=uuid;if(this.parked&&!this.requested)this.resume(uuid);});
 }
 allowStart(){
  const manual=this.env.SPEEDCAM_USER_RESUME==='1'||this.env.SPEEDCAM_GATE_ONLY!=='1'&&
   (this.manualEntry||!(Number(this.env.SPEEDCAM_RESTART_COUNT)>0)&&['ENTRY_POINT','BOOKMARK'].indexOf(String(this.app.startReason))>=0);
  if(manual&&this.store.paused())this.store.save(false);
  this.parked=this.store.paused();
  if(this.parked)this.log('MANUAL_CLOSE_GATE: monitoring disabled; waiting for entry point');
  return !this.parked;
 }
 close(){
  if(this.closing)return;
  this.store.save(true); // Persistence must succeed before stopping anything.
  try{this.send({speedcamLifecycle:1,event:'park'});this.closing=true;}
  catch(e){this.store.save(false);throw e;}
 }
 resume(uuid){
  try{
   this.send({speedcamLifecycle:1,event:'resume',entryUuid:uuid});this.requested=true;
  }catch(e){this.log('MANUAL_RESUME_FAILED '+String(e));}
 }
}
module.exports={ManualLaunchStore,ManualLaunchGate};
