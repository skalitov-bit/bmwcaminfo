'use strict';
const {distance,bearing,diff,freshFix,pointHit}=require('./mapcam-warnings');
const {warningRange}=require('./notification-rules');
const {compareWarnings,controlsSpeed}=require('./notification-priority');
const {isDummy}=require('./point-kind');
const {alignment,withDensity}=require('./approach-trajectory');
// One announcement ledger per physical approach. No elapsed-time camera lockout.
class NotificationSession {
 constructor(voice,getOptions,now){this.voice=voice;this.getOptions=getOptions;this.now=now||Date.now;
  this.encounters=new Map();this.live={};this.fix=null;this.current=null;this.busy=false;this.serial=0;
  this.pendingEnd=null;this.lastEndToken=null;this.choice=null;}
 suspend(){this.live={};this.fix=null;this.current=null;this.pendingEnd=null;this.choice=null;if(this.voice.cancel)this.voice.cancel();}
 clear(){this.suspend();this.encounters.clear();}
 update(states,fix,heading,events){
  // Capture the preceding encounter before pruning it after crossing the end.
  for(const e of events||[]){
   if(!e||e.type!=='end'||e.endReason!=='section-end'||e.averageControl!==true||
      !e.camera||e.camera.mapcamTypeCode!==4||!Array.isArray(e.camera.mapcamPath)||e.camera.mapcamPath.length<2||
      !Number.isFinite(e.endedAt)||e.endedAt!==fix.timeMs)continue;
   const token=e.camera.id+':'+e.endedAt,previous=this.live[e.camera.id],r=this.encounters.get(e.camera.id),o=this.getOptions();
   if(token===this.lastEndToken||!previous||previous.phase!=='section')continue;
   this.lastEndToken=token;
   // In speeding-only mode, close an audible warning, not a silent approach.
   if(!freshFix(fix,this.now())||!o.forceAudio&&(o.voice==='off'||o.voice==='speeding'&&
      !(r&&r.stages[1]&&r.stages[1].done)&&!previous.speeding))continue;
   this.pendingEnd={token,createdAt:this.now()};break;
  }
  this.live=states;this.fix=fix;const now=this.now(),o=this.getOptions();
  for(const [id,r] of this.encounters){
   const d=distance(fix,r.camera);
   const passed=d>100&&Number.isFinite(heading)&&diff(heading,bearing(fix,r.camera))>110;
   if(!states[id]&&d>10&&Number.isFinite(heading)&&diff(heading,bearing(fix,r.camera))>110)r.passed=true;
   const turnedBack=states[id]&&r.passed&&d>30&&Number.isFinite(heading)&&diff(heading,r.heading)>100;
   if(turnedBack||!states[id]&&(passed||d>Math.max(r.warningRangeM||0,warningRange(r.camera,o,fix.speedKmh))+250))this.encounters.delete(id);
  }
  const sorted=Object.values(states).filter(s=>s.camera&&Number.isFinite(s.distanceM)).sort(compareWarnings);
  let best=sorted[0]||null;
  const previous=this.current&&states[this.current.camera.id];
  // Confirm a trajectory-based replacement in two distinct GPS samples.
  // A disappeared/passed target and a higher-priority control switch at once.
  const samePriority=previous&&best&&previous.phase===best.phase&&
   isDummy(previous.camera)===isDummy(best.camera)&&
   controlsSpeed(previous.camera)===controlsSpeed(best.camera);
  if(samePriority&&best.camera.id!==previous.camera.id&&previous.trajectory&&best.trajectory&&previous.trajectory.trusted&&best.trajectory.trusted&&previous.trajectory.tier!==best.trajectory.tier){
   if(!this.choice||this.choice.id!==best.camera.id)this.choice={id:best.camera.id,time:fix.timeMs,count:1};
   else if(this.choice.time!==fix.timeMs){this.choice.time=fix.timeMs;this.choice.count++;}
   if(this.choice.count<2)best=previous;
  }else this.choice=null;
  this.current=best;
  // A new active warning takes precedence over a message about a finished one.
  if(this.current)this.pendingEnd=null;
  for(const s of sorted){
   const id=s.camera.id;
   if(!this.encounters.has(id))this.encounters.set(id,{id,token:++this.serial,camera:s.camera,heading,stages:{},announcedDistance:null,announcedAt:null});
   const encounter=this.encounters.get(id);encounter.warningRangeM=Math.max(encounter.warningRangeM||0,s.warningRangeM||0);
  }
  this.pump();return this.current;
 }
 eligible(s){const o=this.getOptions();return !!s&&s.phase!=='rear'&&freshFix(this.fix,this.now())&&(o.forceAudio===true||!isDummy(s.camera)&&this.fix.speedKmh>15&&o.voice!=='off'&&(o.voice!=='speeding'||s.speeding));}
 diagnosticCandidate(){
  // All currently detected approaches get one phrase; no queue of stale points.
  return Object.values(this.live).filter(s=>this.eligible(s)).sort(compareWarnings).find(s=>{
   const r=this.encounters.get(s.camera.id),a=r&&r.stages[1];
   return r&&(!a||!a.done&&!a.blocked&&a.tries<2&&this.now()>=a.nextAt);
  });
 }
 pump(){
  if(this.busy)return;
  // Diagnostic mode visits each live approach, normal mode follows visual priority.
  const o=this.getOptions(),forced=o.forceAudio===true;
  const s=forced?this.diagnosticCandidate():this.current;if(!this.eligible(s)){this.pumpEnd();return;}
  const r=this.encounters.get(s.camera.id);if(!r)return;
  let stage=1;
  if(r.stages[1]&&r.stages[1].done){
   if(o.repeat200===false||s.phase==='section'||s.distanceM>200||s.distanceM<80||
      r.announcedDistance<=250||this.now()-r.announcedAt<5000)return;
   stage=2;
  }
  const attempt=r.stages[stage]||(r.stages[stage]={tries:0,done:false,blocked:false,nextAt:0});
  if(attempt.done||attempt.blocked||attempt.tries>=2||this.now()<attempt.nextAt)return;
  // If stage 1 was delayed until very close, use the generic distance-free phrase, not "200 metres".
  const relevant=()=>this.encounters.get(r.id)===r&&(this.getOptions().forceAudio===true)===forced&&(forced||this.current&&this.current.camera.id===r.id)&&
    this.live[r.id]&&this.eligible(this.live[r.id])&&(stage!==2||this.getOptions().repeat200!==false&&this.live[r.id].phase!=='section'&&this.live[r.id].distanceM>=80&&this.live[r.id].distanceM<=210);
  attempt.tries++;this.busy=true;
  const assetStage=stage===2&&s.distanceM<150?1:stage;
  const dispatch=this.voice.cameraResult?this.voice.cameraResult(assetStage,relevant,s.camera,forced):this.voice.camera(assetStage,relevant,s.camera,forced).then(ok=>({ok,retryable:false}));
  Promise.resolve(dispatch).then(result=>{
   if(this.encounters.get(r.id)!==r)return;
   if(result&&result.ok){attempt.done=true;if(stage===1){r.announcedDistance=this.live[r.id]?this.live[r.id].distanceM:s.distanceM;r.announcedAt=this.now();}}
   else if(result&&result.skipped){attempt.tries--;attempt.nextAt=this.now()+1000;}
   else if(result&&result.retryable){attempt.nextAt=this.now()+2000;}
   else attempt.blocked=true; // Unknown playback outcome must not trigger duplicate speech.
  },()=>{attempt.blocked=true;}).then(()=>{this.busy=false;if(this.getOptions().forceAudio===true)this.pump();else this.pumpEnd();});
 }
 pumpEnd(){
  const end=this.pendingEnd;if(!end||this.busy)return;
  const relevant=()=>this.pendingEnd===end&&!this.current&&(this.getOptions().forceAudio===true||this.getOptions().voice!=='off')&&
    freshFix(this.fix,this.now())&&this.now()-end.createdAt<=5000;
  if(!relevant()||!this.voice.sectionEndResult){this.pendingEnd=null;return;}
  this.busy=true;
  // One attempt only: a lost acknowledgement must never repeat the end message.
  Promise.resolve().then(()=>this.voice.sectionEndResult(relevant)).catch(()=>{}).then(()=>{
   if(this.pendingEnd===end)this.pendingEnd=null;
   this.busy=false;
  });
 }
}
function selectRadar(current,cameras,fix,heading,roadEngine,trajectory){
 if(!freshFix(fix,Date.now()))return null;
 if(current)return {camera:current.camera,distanceM:current.distanceM,state:current,active:true};
 if(!Number.isFinite(heading)||fix.speedKmh<=5)return null;
 trajectory=withDensity(trajectory,cameras);
 let best=null;
 for(const c of cameras){
  if(c.warningEnabled===false)continue;
  const hit=c.source==='local-user'?roadEngine.preview(c,fix,4200):pointHit(c,fix,heading,Number.isFinite(c.mapcamAngleDeg)?c.mapcamAngleDeg:60,4200,4200,trajectory);
  if(hit){const candidate={camera:c,distanceM:hit.distanceM,active:false,trajectory:alignment(c,trajectory,hit)};if(!best||compareWarnings(candidate,best)<0)best=candidate;}
 }
 return best;
}
module.exports={NotificationSession,selectRadar};
