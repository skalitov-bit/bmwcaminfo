'use strict';
const {distance,bearing,diff}=require('./gps-geometry');
const {usable:freshFix}=require('./gps-quality');
const DEG=Math.PI/180;
const signed=(a,b)=>(a-b+540)%360-180;
// Fit heading against travelled distance using overlapping, long chords.
// Short/noisy tracks cannot establish curvature. A lane change or a changing
// turn rate fails the residual checks and falls back to the ordinary selector.
function fitCurve(samples){
 if(samples.length<6)return null;
 const s=[0];for(let i=1;i<samples.length;i++)s.push(s[i-1]+distance(samples[i-1],samples[i]));
 const span=s[s.length-1],accuracy=Math.max.apply(null,samples.map(p=>p.accuracyM));
 if(span<100||accuracy>15)return null;
 const rows=[];let previous=null;
 for(let i=2;i<samples.length;i++){
  if(s[i]-s[i-2]<25)continue;
  let h=bearing(samples[i-2],samples[i])*DEG;
  if(previous!==null)h=previous+signed(h/DEG,previous/DEG)*DEG;
  previous=h;rows.push({x:(s[i-2]+s[i])/2,y:h});
 }
 if(rows.length<4)return null;
 const mx=rows.reduce((v,r)=>v+r.x,0)/rows.length,my=rows.reduce((v,r)=>v+r.y,0)/rows.length;
 let xx=0,xy=0;for(const r of rows){xx+=(r.x-mx)**2;xy+=(r.x-mx)*(r.y-my);}
 if(xx<1)return null;
 const k=xy/xx,angle=Math.abs(k*span),radius=1/Math.abs(k);
 if(radius<150||radius>5000||angle<8*DEG||Math.abs(k)*span*span/8<Math.max(3,accuracy*1.2))return null;
 const error=Math.max.apply(null,rows.map(r=>Math.abs(r.y-(my+k*(r.x-mx)))));
 if(error>2.5*DEG)return null;
 const n=samples.length,latestSpan=(s[n-1]-s[n-5])/2;
 const latestK=signed(bearing(samples[n-3],samples[n-1]),bearing(samples[n-5],samples[n-3]))*DEG/latestSpan;
 if(Math.abs(latestK-k)>Math.abs(k)*.45)return null;
 const end=samples[samples.length-1],heading=(my+k*(span-mx))/DEG;
 if(Number.isFinite(end.headingDeg)&&diff(heading,end.headingDeg)>8)return null;
 const model={lat:end.lat,lon:end.lon,heading,curvature:k};
 // Check every measured position against the fitted arc, including the last
 // segment so a turn exit does not continue a stale curve for the full window.
 let residual=0;for(let i=0;i<samples.length;i++)residual=Math.max(residual,distance(samples[i],point(model,s[i]-span,0)));
 if(residual>Math.max(3,accuracy)||diff(bearing(samples[samples.length-2],end),heading-k*(span-s[s.length-2])/2/DEG)>4)return null;
 return {curvature:k,heading:(heading+360)%360,fitErrorRad:error,fitResidualM:residual,
  horizonM:Math.min(600,span*3,Math.PI/2/Math.abs(k))};
}
// A short measured track, not a road/lane map. Ambiguous turns and poor fixes
// retain the original warning candidates instead of hiding an off-axis camera.
class ApproachTrajectory {
 constructor(){this.reset();}
 reset(){this.samples=[];this.track=null;}
 update(fix,now){
  now=Number.isFinite(now)?now:Date.now();
  if(!freshFix(fix,now)){this.reset();return null;}
  // A geometric tolerance is not a claimed measurement accuracy.
  fix=Object.assign({},fix,{accuracyM:require('./gps-quality').geometryAccuracy(fix)});
  const last=this.samples[this.samples.length-1];
  if(last&&fix.timeMs<=last.timeMs)return this.value(now);
  if(last&&(fix.timeMs-last.timeMs>3000||distance(last,fix)>Math.max(60,Math.max(last.speedKmh,fix.speedKmh)/3.6*(fix.timeMs-last.timeMs)/1000*2+15)))this.reset();
  this.samples.push(Object.assign({},fix));
  while(this.samples.length>20||this.samples.length>1&&fix.timeMs-this.samples[0].timeMs>16000)this.samples.shift();
  const recent=this.samples.filter(p=>fix.timeMs-p.timeMs<=6000);
  const first=recent[0],travel=distance(first,fix),minimum=Math.max(20,fix.accuracyM*4);
  if(fix.speedKmh<8||recent.length<3||travel<minimum){this.track=null;return null;}
  const heading=bearing(first,fix),segments=[];
  for(let i=1;i<recent.length;i++)if(distance(recent[i-1],recent[i])>=4)segments.push(bearing(recent[i-1],recent[i]));
  const turning=segments.some(h=>diff(h,heading)>12)||Number.isFinite(fix.headingDeg)&&diff(fix.headingDeg,heading)>15;
  this.track={lat:fix.lat,lon:fix.lon,timeMs:fix.timeMs,heading,accuracyM:fix.accuracyM,
   trusted:!turning&&recent.every(p=>p.accuracyM<=15),turning,travelM:travel,lengthM:Math.min(2000,Math.max(600,fix.speedKmh/3.6*30))};
  const curve=fitCurve(this.samples);
  if(curve){Object.assign(this.track,curve,{trusted:true,turning:true,model:'arc'});this.track.lengthM=curve.horizonM;}
  else this.track.model='ray';
  return this.track;
 }
 value(now){return this.track&&now-this.track.timeMs<=3000?this.track:null;}
}
// Source-qualified: these are road hints, not proof of the driver's road/lane.
function roadRole(camera){
 if(!camera||camera.typeNamespace!=='estrelka'||!Number.isInteger(camera.estrelkaFlagsRaw))return null;
 const code=(camera.estrelkaFlagsRaw&224)>>5;
 return code===6?'main':code===7?'service':null;
}
// One bounded linear scan per GPS observation. Co-located records count once;
// unrelated points behind the car or far to the side cannot tighten the corridor.
function withDensity(track,cameras){
 if(!track||track.selectionDensity!==undefined)return track;
 const cells=new Set(),cos=Math.cos(track.lat*DEG);
 if(track.trusted)for(const c of cameras||[]){
  if(!c||c.warningEnabled===false)continue;
  const a=alignment(c,track);
  if(!a.within||a.alongM>800||a.lateralM>150)continue;
  cells.add(Math.round((c.lat-track.lat)*111320/20)+':'+Math.round((c.lon-track.lon)*111320*cos/20));
 }
 const count=cells.size;
 return Object.assign({},track,{selectionDensity:count,densityFactor:Math.max(.7,1-Math.max(0,count-2)*.05)});
}
function halfWidth(track,along){return Math.max(8,track.accuracyM*1.5)+Math.max(0,along)*Math.tan(DEG+(track.fitErrorRad||0));}
function alignment(camera,track,state){
 if(!track)return null;
 const d=distance(track,camera),a=(bearing(track,camera)-track.heading)*DEG;
 let along=d*Math.cos(a),lateral=Math.abs(d*Math.sin(a));
 if(track.curvature){
  const k=track.curvature,x=d*Math.sin(a),y=d*Math.cos(a);
  along=Math.atan2(k*y,1-k*x)/k;
  lateral=Math.abs(Math.hypot(x-1/k,y)-Math.abs(1/k));
 }
 const role=roadRole(camera),baseWidth=halfWidth(track,along);
 const width=Math.max(Math.max(6,track.accuracyM*1.5),baseWidth*(track.densityFactor||1)*(role==='service'?.8:1)),within=along>=0&&(!track.curvature||along<=track.horizonM);
 // A section's endpoint may be off the present tangent. Its supplied path
 // and a locally confirmed road must take precedence over the straight ray.
 const confirmed=state&&(state.phase==='section'||state.way||state.roadConfirmed);
 return {trusted:track.trusted,alongM:along,lateralM:lateral,halfWidthM:width,roadRole:role,density:track.selectionDensity||0,
  within,headingDeg:(track.heading+(track.curvature||0)*along/DEG+360)%360,
  tier:confirmed?0:!within?2:lateral<=width?0:lateral<=width*2?1:2};
}
function adjacentRoad(camera,track,state){
 if(!track||!track.trusted||!Number.isFinite(track.travelM)||track.travelM<60||track.accuracyM>15||
    state&&(state.phase==='section'||state.phase==='rear'||state.way||state.roadConfirmed))return false;
 const a=alignment(camera,track,state);
 if(!a.within||a.alongM>Math.min(800,track.lengthM)||a.density<3&&a.roadRole!=='service')return false;
 // Retain uncertain borderline points. A service-road camera on our measured
 // trajectory remains eligible; the hint never bans the entire category.
 return a.lateralM>a.halfWidthM+Math.max(6,track.accuracyM*2);
}
function point(track,along,side){const h=track.heading*DEG,k=track.curvature||0,a=k*along;
 const forward=k?Math.sin(a)/k:along,right=k?(1-Math.cos(a))/k:0;
 const dx=Math.sin(h)*forward+Math.cos(h)*right+Math.cos(h+a)*side,dy=Math.cos(h)*forward-Math.sin(h)*right-Math.sin(h+a)*side;
 return {lat:track.lat+dy/111320,lon:track.lon+dx/(111320*Math.max(.01,Math.cos(track.lat*DEG)))};}
function curveHit(camera,track,width,range,maxRange){
 if(!track||!track.trusted||!track.curvature)return null;
 const a=alignment(camera,track);
 if(!a.within||a.tier!==0||a.alongM>Math.min(range,maxRange))return null;
 const dt=camera.mapcamDirectionType;
 if(dt===3)return null;
 if(dt===1||dt===2){const h=camera.mapcamApproachHeadingDeg;
  if(!Number.isFinite(h)||Math.min(diff(a.headingDeg,h),dt===2?diff(a.headingDeg,(h+180)%360):360)>width/2)return null;}
 return {distanceM:a.alongM,trajectoryCurve:true};
}
module.exports={ApproachTrajectory,alignment,halfWidth,point,curveHit,roadRole,withDensity,adjacentRoad};
