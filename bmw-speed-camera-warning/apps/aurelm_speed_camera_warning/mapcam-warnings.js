'use strict';
// Independent implementation of the verified MC85 point/section rules.
// No Android runtime, MapCam executable code or inferred OSM roads are used.
const {warningRange,isSpeeding,MAX_WARNING_RANGE_M}=require('./notification-rules');
const {usable,geometryAccuracy}=require('./gps-quality');
const R=6371000, DEG=Math.PI/180, M=111320;
const SECTION_TYPES=[1,2,3,4,11,13,16];
const {distance,bearing,diff}=require('./gps-geometry');
const {curveHit,withDensity,adjacentRoad}=require('./approach-trajectory');
const {isDummy}=require('./point-kind');
const REAR_DISTANCE_M=100;
function hasRearControl(c){return !!c&&!isDummy(c)&&(c.rearCapture===true||c.mapcamControlDirection>0);}
// Freeze the last valid approach axis when crossing the camera plane. Bearing
// to an identical coordinate is undefined; never use that bearing to end control.
function passage(c,state,previous,fix,heading,moved){
 const axis=Number.isFinite(state.approachHeading)?state.approachHeading:heading;
 const h=axis*DEG,cos=Math.cos(c.lat*DEG),corridor=50+2*Math.min(15,geometryAccuracy(fix)||0);
 function at(f){const x=(f.lon-c.lon)*M*cos,y=(f.lat-c.lat)*M;
  return {along:x*Math.sin(h)+y*Math.cos(h),side:Math.abs(x*Math.cos(h)-y*Math.sin(h))};}
 const a=at(previous),b=at(fix),aligned=diff(heading,axis)<70;
 return {axis,along:b.along,side:b.side,aligned,corridor,
  crossed:aligned&&state.distanceM<=moved+70&&a.along<=0.5&&b.along>=0&&
   b.along>=a.along&&a.side<=corridor&&b.side<=corridor};
}
function freshFix(f,now){return usable(f,now);}
function inHours(hours,hour){
 if(!Array.isArray(hours)||hours.length!==2||hours.some(h=>!Number.isInteger(h)||h<0||h>23)||hours[0]===hours[1])return true;
 return hours[0]<hours[1] ? hour>=hours[0]&&hour<hours[1] : hour>=hours[0]||hour<hours[1];
}
function pathSegments(camera){
 const pts=camera.mapcamPath||[], segments=[];let total=0;
 for(let i=1;i<pts.length;i++){
  const a={lat:pts[i-1][0],lon:pts[i-1][1]},b={lat:pts[i][0],lon:pts[i][1]};
  const cos=Math.cos((a.lat+b.lat)/2*DEG),dx=(b.lon-a.lon)*M*cos,dy=(b.lat-a.lat)*M,len=Math.hypot(dx,dy);
  if(len<0.1)continue;
  segments.push({a,b,cos,dx,dy,len,start:total,heading:bearing(a,b)});total+=len;
 }
 return {segments,total};
}
function projectPath(path,fix,heading){
 let hit=null;
 path.segments.forEach((s,i)=>{
  if(diff(heading,s.heading)>=20)return;
  const x=(fix.lon-s.a.lon)*M*s.cos,y=(fix.lat-s.a.lat)*M;
  const t=(x*s.dx+y*s.dy)/(s.len*s.len),clamp=Math.max(0,Math.min(1,t));
  const lateral=Math.hypot(x-clamp*s.dx,y-clamp*s.dy);
  if(lateral>70)return;
  // Before the first point use the point sector, not a falsely entered section.
  if(t<0&&i===0)return;
  const along=s.start+clamp*s.len, end=i===path.segments.length-1&&t>1;
  if(!hit||lateral<hit.lateral)hit={lateral,along,end,distanceM:Math.max(0,path.total-along)};
 });return hit;
}
function pointHit(camera,fix,heading,width,range,maxRange=2000,trajectory){
 if(adjacentRoad(camera,trajectory))return null;
 const curved=curveHit(camera,trajectory,width,range,maxRange);
 if(curved)return curved;
 const d=distance(fix,camera);
 const delta=diff(heading,bearing(fix,camera));
 if(d>Math.min(maxRange,range)||delta>width/2)return null;
 // Conservative corridor around the measured approach; this is not lane matching.
 const lateral=d*Math.sin(delta*DEG),corridor=50+2*Math.min(15,geometryAccuracy(fix)||0)+Math.min(60,d*.05);
 if(lateral>corridor)return null;
 const dt=camera.mapcamDirectionType;
 if(dt===3)return null; // Reserved direction: never guess an orientation.
 if(dt===1||dt===2){
  if(!Number.isFinite(camera.mapcamApproachHeadingDeg))return null;
  const azimuth=(camera.mapcamApproachHeadingDeg+180)%360;
  const towardCar=bearing(camera,fix);
  if(!Number.isFinite(azimuth)||Math.min(diff(towardCar,azimuth),dt===2?diff(towardCar,(azimuth+180)%360):360)>width/2)return null;
 }
 return {distanceM:d};
}
// Cross the last segment's end plane, including valid samples >70 m past it.
// Time/jump checks in update() still bound the observed movement.
function crossedEnd(path,previous,fix,heading,state,moved){
 const s=path&&path.segments[path.segments.length-1];
 if(!s||!state||state.phase!=='section'||state.distanceM>moved+70||diff(heading,s.heading)>=20)return false;
 function at(p){const x=(p.lon-s.a.lon)*M*s.cos,y=(p.lat-s.a.lat)*M;
  return {t:(x*s.dx+y*s.dy)/(s.len*s.len),side:Math.abs(x*s.dy-y*s.dx)/s.len};}
 const a=at(previous),b=at(fix);
 return a.t>=0&&a.t<=1&&b.t>1&&a.side<=70&&b.side<=70;
}
class MapcamWarnings{
 constructor(options){this.options=Object.assign({distanceM:0,excessKmh:0,voice:'always',hours:false},options||{});
  this.reset();}
 configure(options){Object.assign(this.options,options);this.reset();}
 reset(){this.states=Object.create(null);this.previous=null;this.previousTrajectory=null;this.heading=null;this.paths=Object.create(null);}
 // Loss of GPS clears live control. Rejoining a section starts a partial observation.
 suspend(){this.states=Object.create(null);this.previous=null;this.previousTrajectory=null;this.heading=null;}
 update(fix,cameras,now,trajectory){
  now=Number.isFinite(now)?now:Date.now();
  if(!freshFix(fix,now)){this.suspend();return [];}
  trajectory=withDensity(trajectory,cameras);
  const previous=this.previous;
  if(previous&&fix.timeMs<=previous.timeMs)return [];
  const previousTrajectory=this.previousTrajectory;this.previousTrajectory=trajectory||null;
  this.previous=fix;
  if(!previous)return [];
  const dt=(fix.timeMs-previous.timeMs)/1000,moved=distance(previous,fix);
  if(dt>3||moved>Math.max(60,Math.max(previous.speedKmh,fix.speedKmh)/3.6*dt*2+15)){
   this.states=Object.create(null);this.previousTrajectory=null;this.heading=null;return [];
  }
  if(moved>2&&fix.speedKmh>5)this.heading=bearing(previous,fix);
  if(this.heading===null)return [];
  const events=[],seen=Object.create(null),list=Object.create(null);
  (cameras||[]).forEach(c=>{if(c&&(c.source==='MapCam.info'||c.warningProfile==='hybrid-v1')&&c.warningEnabled!==false)list[c.id]=c;});
  Object.keys(this.states).forEach(id=>{if(!list[id])list[id]=this.states[id].camera;});
  Object.keys(list).forEach(id=>{
   const c=list[id],o=this.options;
   if(o.hours&&!inHours(c.mapcamHours,new Date(fix.timeMs).getHours()))return;
   let state=this.states[id];
   const canEnter=fix.speedKmh>15&&moved>0.01;
   if(!state&&!canEnter)return;
   const closingKmh=fix.speedKmh*Math.max(0,Math.cos(diff(this.heading,bearing(fix,c))*DEG));
   // Once acquired, braking must not shrink the range and hide a live warning.
   const range=Math.max(state&&state.warningRangeM||0,warningRange(c,o,closingKmh));
   let path=null,hit=null;
   if(SECTION_TYPES.indexOf(c.mapcamTypeCode)>=0&&Array.isArray(c.mapcamPath)&&c.mapcamPath.length>=2){
    path=this.paths[id]||(this.paths[id]=pathSegments(c));
    hit=projectPath(path,fix,this.heading);
   }
   const section=hit&&!hit.end;
   const width=state?state.width:c.mapcamAngleDeg;
   if(!section){
    if(state&&state.phase==='section'&&((hit&&hit.end)||crossedEnd(path,previous,fix,this.heading,state,moved))){finish('section-end');return;}
    const d=distance(fix,c);
    if(state&&(state.phase==='point'||state.phase==='rear')){
     const pass=passage(c,state,previous,fix,this.heading,moved);
     if(state.phase==='rear'||pass.crossed){
      if(hasRearControl(c)&&d<REAR_DISTANCE_M&&pass.aligned&&pass.side<=pass.corridor&&pass.along>=-5){
       state.phase='rear';state.approachHeading=pass.axis;state.distanceM=d;state.lastSeenAt=now;
       state.speedKmh=fix.speedKmh;state.speeding=isSpeeding(c,fix.speedKmh,o,state.speeding,false);seen[id]=true;return;
      }
      finish();return;
     }
     // Normal point control ends on a passed sample even when it missed the plane.
     if(state.distanceM<120&&d<150&&diff(this.heading,bearing(fix,c))>150){finish();return;}
    }
    hit=pointHit(c,fix,this.heading,Number.isFinite(width)?width:60,range,MAX_WARNING_RANGE_M,trajectory);
   }
   if(!hit)return;
   // Two consistent positions are required. Allow the first to be just outside entry distance.
   if(!state&&!section&&!pointHit(c,previous,this.heading,Number.isFinite(width)?width:60,range+250,MAX_WARNING_RANGE_M+250,previousTrajectory))return;
   if(!state){state=this.states[id]={camera:c,phase:section?'section':'point',width:c.mapcamAngleDeg,
      startedAt:fix.timeMs,lastSeenAt:now,distanceM:hit.distanceM,travelledM:0,averageKmh:null,
      partialSection:!!section&&hit.along>70,speedingAlerted:false};}
   else if(section&&state.phase!=='section'){
    state.phase='section';state.startedAt=fix.timeMs;state.travelledM=0;state.partialSection=hit.along>70;state.averageKmh=null;
   }else if(section){
    state.travelledM+=moved;
    if(fix.timeMs>state.startedAt)state.averageKmh=state.travelledM/(fix.timeMs-state.startedAt)*3600;
   }
   // Never silently downgrade a lost section to point-based average control.
   if(state.phase==='section'&&!section)return;
   state.warningRangeM=range;state.closingSpeedKmh=closingKmh;
   state.distanceM=hit.distanceM;state.lastSeenAt=now;seen[id]=true;
   if(state.phase==='point')state.approachHeading=this.heading;
   if(state.phase==='point'&&hit.distanceM<250&&state.width<100)state.width*=1.5;
   const averageControl=c.averageControl===true||c.mapcamTypeCode===4;
   const useAverage=averageControl&&section&&path.total>=300;
   state.useAverage=!!useAverage;
   state.speedKmh=useAverage?state.averageKmh:fix.speedKmh;
   const speeding=isSpeeding(c,state.speedKmh,o,state.speeding,useAverage);
   state.speeding=speeding;
   function event(type,voice){return {type,stage:1,camera:c,distanceM:Math.round(state.distanceM),
    phase:state.phase,speedKmh:Number.isFinite(state.speedKmh)?Math.round(state.speedKmh):null,
    averageKmh:state.averageKmh,partialSection:state.partialSection,useAverage:!!useAverage,
    limitKmh:c.limit,excessKmh:Number.isFinite(state.speedKmh)&&c.limit?Math.round(state.speedKmh-c.limit):null,
    voice:!!voice,speeding,thresholdM:range};}
   if(!state.visualSent){events.push(event('camera',false));state.visualSent=true;}
   if(canEnter&&speeding&&!state.speedingAlerted){events.push(event('speeding',false));state.speedingAlerted=true;}
   if(!speeding)state.speedingAlerted=false;
   function finish(reason){events.push({type:'end',camera:c,distanceM:-1,phase:'end',voice:false,
    endReason:reason||'point-passed',endedAt:fix.timeMs,
    averageControl:reason==='section-end'&&c.mapcamTypeCode===4});}
  });
  Object.keys(this.states).forEach(id=>{if(!seen[id])delete this.states[id];});
  // Keep geometry only for active controls.
  Object.keys(this.paths).forEach(id=>{if(!this.states[id])delete this.paths[id];});
  return events;
 }
}
module.exports={MapcamWarnings,distance,bearing,diff,freshFix,inHours,pathSegments,projectPath,pointHit,hasRearControl,REAR_DISTANCE_M};
