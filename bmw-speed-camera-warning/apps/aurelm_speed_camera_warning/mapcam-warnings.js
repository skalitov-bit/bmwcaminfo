'use strict';
// Independent implementation of the verified MC85 point/section rules.
// No Android runtime, MapCam executable code or inferred OSM roads are used.
const R=6371000, DEG=Math.PI/180, M=111320;
const SECTION_TYPES=[1,2,3,4,11,13,16];
function diff(a,b){return Math.abs((a-b+540)%360-180);}
function distance(a,b){
 const dlat=(b.lat-a.lat)*DEG,dlon=(b.lon-a.lon)*DEG;
 const h=Math.sin(dlat/2)**2+Math.cos(a.lat*DEG)*Math.cos(b.lat*DEG)*Math.sin(dlon/2)**2;
 return 2*R*Math.asin(Math.min(1,Math.sqrt(h)));
}
function bearing(a,b){
 const d=(b.lon-a.lon)*DEG,x=Math.sin(d)*Math.cos(b.lat*DEG);
 const y=Math.cos(a.lat*DEG)*Math.sin(b.lat*DEG)-Math.sin(a.lat*DEG)*Math.cos(b.lat*DEG)*Math.cos(d);
 return (Math.atan2(x,y)/DEG+360)%360;
}
function freshFix(f,now){return !!f && [f.lat,f.lon,f.timeMs,f.speedKmh,f.accuracyM,now].every(Number.isFinite) &&
 Math.abs(f.lat)<=90 && Math.abs(f.lon)<=180 && f.speedKmh>=0 && f.speedKmh<=350 &&
 f.accuracyM>0 && f.accuracyM<15 && now-f.timeMs<=3000 && f.timeMs<=now+500;}
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
function pointHit(camera,fix,heading,width,range){
 const d=distance(fix,camera);
 if(d>Math.min(2000,range)||diff(heading,bearing(fix,camera))>width/2)return null;
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
class MapcamWarnings{
 constructor(options){this.options=Object.assign({distanceM:0,excessKmh:0,voice:'always',hours:false},options||{});
  this.cooldown=Object.create(null);this.reset();}
 configure(options){Object.assign(this.options,options);this.reset();}
 reset(){this.states=Object.create(null);this.previous=null;this.heading=null;this.paths=Object.create(null);}
 // Loss of GPS clears live control. Rejoining a section starts a partial observation.
 suspend(){this.states=Object.create(null);this.previous=null;this.heading=null;}
 update(fix,cameras,now){
  now=Number.isFinite(now)?now:Date.now();
  if(!freshFix(fix,now)){this.suspend();return [];}
  const previous=this.previous;
  if(previous&&fix.timeMs<=previous.timeMs)return [];
  this.previous=fix;
  if(!previous)return [];
  const dt=(fix.timeMs-previous.timeMs)/1000,moved=distance(previous,fix);
  if(dt>3||moved>Math.max(60,Math.max(previous.speedKmh,fix.speedKmh)/3.6*dt*2+15)){
   this.states=Object.create(null);this.heading=null;return [];
  }
  if(moved>2&&fix.speedKmh>5)this.heading=bearing(previous,fix);
  if(this.heading===null)return [];
  const events=[],seen=Object.create(null),list=Object.create(null);
  (cameras||[]).forEach(c=>{if(c&&c.source==='MapCam.info')list[c.id]=c;});
  Object.keys(this.states).forEach(id=>{if(!list[id])list[id]=this.states[id].camera;});
  Object.keys(list).forEach(id=>{
   const c=list[id],o=this.options;
   if(o.hours&&!inHours(c.mapcamHours,new Date(fix.timeMs).getHours()))return;
   let state=this.states[id];
   const canEnter=fix.speedKmh>15&&moved>0.01;
   if(!state&&!canEnter)return;
   const range=o.distanceM>0?o.distanceM:(c.mapcamWarningDistanceM>0?c.mapcamWarningDistanceM:2000);
   let path=null,hit=null;
   if(SECTION_TYPES.indexOf(c.mapcamTypeCode)>=0&&Array.isArray(c.mapcamPath)&&c.mapcamPath.length>=2){
    path=this.paths[id]||(this.paths[id]=pathSegments(c));
    hit=projectPath(path,fix,this.heading);
   }
   const section=hit&&!hit.end;
   const width=state?state.width:c.mapcamAngleDeg;
   if(!section){
    if(state&&state.phase==='section'&&hit&&hit.end){finish();return;}
    const d=distance(fix,c);
    // Keep a rear-facing control active briefly after passing the camera.
    if(state&&(state.phase==='point'||state.phase==='rear')&&state.distanceM<120&&
       d<150&&diff(this.heading,bearing(fix,c))>150){
     if(c.mapcamControlDirection>0&&d<100){state.phase='rear';state.distanceM=d;state.lastSeenAt=now;seen[id]=true;return;}
     finish();return;
    }
    hit=pointHit(c,fix,this.heading,Number.isFinite(width)?width:60,range);
   }
   if(!hit)return;
   if(!state){state=this.states[id]={camera:c,phase:section?'section':'point',width:c.mapcamAngleDeg,
      startedAt:fix.timeMs,lastSeenAt:now,distanceM:hit.distanceM,travelledM:0,averageKmh:null,
      partialSection:!!section&&hit.along>70,voiceSent:false,speedingAlerted:false};}
   else if(section&&state.phase!=='section'){
    state.phase='section';state.startedAt=fix.timeMs;state.travelledM=0;state.partialSection=hit.along>70;state.averageKmh=null;
   }else if(section){
    state.travelledM+=moved;
    if(fix.timeMs>state.startedAt)state.averageKmh=state.travelledM/(fix.timeMs-state.startedAt)*3600;
   }
   // Never silently downgrade a lost section to point-based average control.
   if(state.phase==='section'&&!section)return;
   state.distanceM=hit.distanceM;state.lastSeenAt=now;seen[id]=true;
   if(state.phase==='point'&&hit.distanceM<250&&state.width<100)state.width*=1.5;
   const useAverage=section&&path.total>=300;
   state.useAverage=!!useAverage;
   state.speedKmh=useAverage?state.averageKmh:fix.speedKmh;
   const speeding=Number.isFinite(c.limit)&&Number.isFinite(state.speedKmh)&&state.speedKmh>=c.limit+o.excessKmh;
   state.speeding=speeding;
   function event(type,voice){return {type,stage:1,camera:c,distanceM:Math.round(state.distanceM),
    phase:state.phase,speedKmh:Number.isFinite(state.speedKmh)?Math.round(state.speedKmh):null,
    averageKmh:state.averageKmh,partialSection:state.partialSection,useAverage:!!useAverage,
    limitKmh:c.limit,excessKmh:Number.isFinite(state.speedKmh)&&c.limit?Math.round(state.speedKmh-c.limit):null,
    voice:!!voice,speeding,thresholdM:range};}
   if(!state.visualSent){events.push(event('camera',false));state.visualSent=true;}
   if(canEnter&&!state.voiceSent&&(o.voice==='always'||o.voice==='speeding'&&speeding)){
    state.voiceSent=true;
    if(!this.cooldown[id]||now-this.cooldown[id]>=1200000){
     this.cooldown[id]=now;events.push(event('voice',true));
    }
   }
   if(canEnter&&speeding&&!state.speedingAlerted){events.push(event('speeding',false));state.speedingAlerted=true;}
   if(!speeding)state.speedingAlerted=false;
   function finish(){events.push({type:'end',camera:c,distanceM:-1,phase:'end',voice:false});}
  });
  Object.keys(this.states).forEach(id=>{if(!seen[id])delete this.states[id];});
  // Avoid retaining geometry/cooldown for every camera encountered over a long run.
  Object.keys(this.paths).forEach(id=>{if(!this.states[id])delete this.paths[id];});
  Object.keys(this.cooldown).forEach(id=>{if(now-this.cooldown[id]>=1200000)delete this.cooldown[id];});
  return events;
 }
}
module.exports={MapcamWarnings,distance,bearing,diff,freshFix,inHours,pathSegments,projectPath,pointHit};
