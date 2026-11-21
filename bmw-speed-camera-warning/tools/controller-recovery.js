'use strict';
// Controller availability is a per-connection capability, not a broken GPU.
// Re-negotiate only our socket, in front, after a successful PNG handoff.
const {Canvas}=require('./canvas');
const {play}=require('./record');
const LIMIT=3, FIRST_DELAY=5000, RETRY_DELAY=30000;
function ready(d,g,now){
 d.controllerRetryBusy=false;d.controllerRetryToken=null;
 if(!d.spec.responsiveMain||g.opts&&g.opts.file)return;
 const supported=g.native&&g.touch&&g.info&&(g.info.modes==null||(g.info.modes&1));
 if(!supported){d.controllerRecoveryStatus='incompatible';return;}
 if(g.info.controller){
  d.controllerRecoveryStatus='ready';d.controllerMissingAt=null;d.ccuLast=null;
  d.log.info('DISPLAY_CONTROLLER_READY attempts='+(d.controllerRetryAttempts||0));
 }else{
  if(d.controllerMissingAt==null)d.controllerMissingAt=now;
  d.controllerRecoveryStatus=(d.controllerRetryAttempts||0)>=LIMIT?'unavailable':'waiting';
  d.log.warn('DISPLAY_CONTROLLER_WAIT attempts='+(d.controllerRetryAttempts||0)+'; graphics/touch remain available');
 }
}
function check(d,now){
 const g=d.gpu;
 if(!g||!g.ready||!g.native||!g.info||g.info.controller||!g.touch||d.recoveryLocked||
    d.controllerRetryBusy||d.softBusy||d.softPending||d.softDone||d.rendererSuspended||d.blocked||
    d.rendererFront!==true||!d._shown()||!d.last||typeof g.recover!=='function'||
    d.controllerMissingAt==null||(d.controllerRetryAttempts||0)>=LIMIT)return Promise.resolve(false);
 const since=d.controllerRetryAt==null?d.controllerMissingAt:d.controllerRetryAt;
 const delay=d.controllerRetryAt==null?FIRST_DELAY:RETRY_DELAY;
 if(now-since<delay)return Promise.resolve(false);
 const epoch=d.softEpoch||0,token={};d.controllerRetryToken=token;
 const valid=()=>d.gpu===g&&g.ready&&(d.softEpoch||0)===epoch&&d._shown()&&
  d.rendererFront===true&&!d.blocked&&!d.rendererSuspended&&!d.recoveryLocked&&!g.info.controller;
 d.controllerRetryBusy=true;d.softPending=true;d.controllerRetryAt=now;
 d.controllerRecoveryStatus='preparing';
 return Promise.resolve().then(()=>{
  if(!valid())return false;
  const current=d.last,page=d.app&&d.app.name===current.name?d.app:null;
  const cv=new Canvas(page?page.w:current.w,page?page.h:current.h);
  play(page?page.words:current.frame.words(),cv);
  return current.softImage(current.name,cv);
 }).then(sent=>{
  if(!valid())return false;
  if(sent===false)throw Error('RHMI did not accept controller fallback');
  d.controllerRetryAttempts=(d.controllerRetryAttempts||0)+1;
  d.controllerRecoveryStatus='reconnecting';d.softDone=true;d.ccuLast=null;
  g.claim([]);g.grab(false);g.show(false);
  d.log.info('DISPLAY_CONTROLLER_RETRY '+d.controllerRetryAttempts+'/'+LIMIT+' PNG ready');
  return g.recover();
 }).catch(e=>{
  if(d.controllerRetryToken===token)d.controllerRecoveryStatus='fallback-failed';
  d.log.warn('DISPLAY_CONTROLLER_RETRY_FAILED '+String(e));return false;
 }).then(result=>{
  if((d.softEpoch||0)===epoch)d.softPending=false;
  if(d.controllerRetryToken===token){d.controllerRetryBusy=false;d.controllerRetryToken=null;}return result;
 });
}
module.exports={ready,check,LIMIT};
