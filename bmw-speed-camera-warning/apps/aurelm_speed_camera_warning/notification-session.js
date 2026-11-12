'use strict';
const {distance,bearing,diff,freshFix,pointHit}=require('./mapcam-warnings');
const {warningRange}=require('./notification-rules');
// One announcement ledger per physical approach. No elapsed-time camera lockout.
class NotificationSession {
 constructor(voice,getOptions,now){this.voice=voice;this.getOptions=getOptions;this.now=now||Date.now;
  this.encounters=new Map();this.live={};this.fix=null;this.current=null;this.busy=false;this.serial=0;}
 suspend(){this.live={};this.fix=null;this.current=null;if(this.voice.cancel)this.voice.cancel();}
 clear(){this.suspend();this.encounters.clear();}
 update(states,fix,heading){
  this.live=states;this.fix=fix;const now=this.now(),o=this.getOptions();
  for(const [id,r] of this.encounters){
   const d=distance(fix,r.camera);
   const passed=d>100&&Number.isFinite(heading)&&diff(heading,bearing(fix,r.camera))>110;
   if(!states[id]&&d>10&&Number.isFinite(heading)&&diff(heading,bearing(fix,r.camera))>110)r.passed=true;
   const turnedBack=states[id]&&r.passed&&d>30&&Number.isFinite(heading)&&diff(heading,r.heading)>100;
   if(turnedBack||!states[id]&&(passed||d>warningRange(r.camera,o,fix.speedKmh)+250))this.encounters.delete(id);
  }
  const sorted=Object.values(states).filter(s=>s.camera&&Number.isFinite(s.distanceM)).sort((a,b)=>a.distanceM-b.distanceM||String(a.camera.id).localeCompare(String(b.camera.id)));
  this.current=sorted[0]||null;
  for(const s of sorted){
   const id=s.camera.id;
   if(!this.encounters.has(id))this.encounters.set(id,{id,token:++this.serial,camera:s.camera,heading,stages:{},announcedDistance:null,announcedAt:null});
  }
  this.pump();return this.current;
 }
 eligible(s){const o=this.getOptions();return !!s&&s.phase!=='rear'&&freshFix(this.fix,this.now())&&this.fix.speedKmh>15&&o.voice!=='off'&&(o.voice!=='speeding'||s.speeding);}
 pump(){
  if(this.busy)return;
  // Never enqueue every nearby camera. Re-evaluate the current visual priority after playback.
  const s=this.current;if(!this.eligible(s))return;
  const r=this.encounters.get(s.camera.id);if(!r)return;
  const o=this.getOptions();let stage=1;
  if(r.stages[1]&&r.stages[1].done){
   if(o.repeat200===false||s.phase==='section'||s.distanceM>200||s.distanceM<80||
      r.announcedDistance<=250||this.now()-r.announcedAt<5000)return;
   stage=2;
  }
  const attempt=r.stages[stage]||(r.stages[stage]={tries:0,done:false,blocked:false,nextAt:0});
  if(attempt.done||attempt.blocked||attempt.tries>=2||this.now()<attempt.nextAt)return;
  // If stage 1 was delayed until very close, use the generic distance-free phrase, not "200 metres".
  const relevant=()=>this.encounters.get(r.id)===r&&this.current&&this.current.camera.id===r.id&&
    this.live[r.id]&&this.eligible(this.live[r.id])&&(stage!==2||this.getOptions().repeat200!==false&&this.live[r.id].phase!=='section'&&this.live[r.id].distanceM>=80&&this.live[r.id].distanceM<=210);
  attempt.tries++;this.busy=true;
  const assetStage=stage===2&&s.distanceM<150?1:stage;
  const dispatch=this.voice.cameraResult?this.voice.cameraResult(assetStage,relevant,s.camera):this.voice.camera(assetStage,relevant,s.camera).then(ok=>({ok,retryable:false}));
  Promise.resolve(dispatch).then(result=>{
   if(this.encounters.get(r.id)!==r)return;
   if(result&&result.ok){attempt.done=true;if(stage===1){r.announcedDistance=this.live[r.id]?this.live[r.id].distanceM:s.distanceM;r.announcedAt=this.now();}}
   else if(result&&result.skipped){attempt.tries--;attempt.nextAt=this.now()+1000;}
   else if(result&&result.retryable){attempt.nextAt=this.now()+2000;}
   else attempt.blocked=true; // Unknown playback outcome must not trigger duplicate speech.
  },()=>{attempt.blocked=true;}).then(()=>{this.busy=false;});
 }
}
function selectRadar(current,cameras,fix,heading,roadEngine){
 if(!freshFix(fix,Date.now()))return null;
 if(current)return {camera:current.camera,distanceM:current.distanceM,state:current,active:true};
 if(!Number.isFinite(heading)||fix.speedKmh<=5)return null;
 let best=null;
 for(const c of cameras){
  if(c.warningEnabled===false)continue;
  const hit=c.source==='local-user'?roadEngine.preview(c,fix,4200):pointHit(c,fix,heading,Number.isFinite(c.mapcamAngleDeg)?c.mapcamAngleDeg:60,4200,4200);
  if(hit&&(!best||hit.distanceM<best.distanceM))best={camera:c,distanceM:hit.distanceM,active:false};
 }
 return best;
}
module.exports={NotificationSession,selectRadar};
