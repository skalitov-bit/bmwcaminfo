'use strict';
const assert=require('assert'),path=require('path');
const A=path.resolve(process.argv[2]||path.join(__dirname,'../apps/aurelm_speed_camera_warning'));
const {ApproachTrajectory,withDensity,alignment,adjacentRoad,point,roadRole}=require(A+'/approach-trajectory');
const {MapcamWarnings}=require(A+'/mapcam-warnings');
const {NotificationSession,selectRadar}=require(A+'/notification-session');
const epoch=Date.now(),m=111320,cos=Math.cos(55*Math.PI/180);
const fix=(s,x=0,accuracy=5)=>({lat:55+s*60/3.6/m,lon:37+x/(m*cos),headingDeg:0,timeMs:epoch+s*1000,speedKmh:60,accuracyM:accuracy});
const camera=(id,y,x,limit,flags=5)=>({id,lat:55+y/m,lon:37+x/(m*cos),limit,typeNamespace:'estrelka',typeCode:192,estrelkaFlagsRaw:flags,warningProfile:'hybrid-v1',warningEnabled:true,mapcamDirectionType:1,mapcamApproachHeadingDeg:0,mapcamAngleDeg:60,mapcamWarningDistanceM:1000});
const main=camera('main60',500,0,60),side=camera('side30',400,30,30,229);
const tr=new ApproachTrajectory();let t;for(let i=-6;i<=0;i++)t=tr.update(fix(i),epoch+i*1000);
assert(t.trusted&&t.travelM>=60);
const sparse=withDensity(t,[main,side]);assert.equal(roadRole(side),'service');
assert(adjacentRoad(side,sparse));assert(!adjacentRoad(main,sparse));
assert(!adjacentRoad(camera('own-service',400,0,30,229),sparse),'A camera on our service road remains valid');
assert(!adjacentRoad(camera('borderline',400,15,30,229),sparse),'GPS margin retained');
assert.equal(roadRole(Object.assign({},side,{typeNamespace:'mapcam'})),null);
const unmarked=Object.assign({},side,{estrelkaFlagsRaw:5});assert(!adjacentRoad(unmarked,sparse));
const points=[main,unmarked,camera('near1',200,80,60),camera('near2',600,80,60)];
const dense=withDensity(t,points);assert.equal(dense.selectionDensity,4);assert(dense.densityFactor<1);assert(adjacentRoad(unmarked,dense));
const duplicate=withDensity(t,Array.from({length:100},(_,i)=>Object.assign({},main,{id:'dup'+i})));
assert.equal(duplicate.selectionDensity,1,'Repeated records must not inflate density');
assert(!adjacentRoad(side,Object.assign({},sparse,{trusted:false})));
assert(!adjacentRoad(side,Object.assign({},sparse,{accuracyM:25})));
assert(!adjacentRoad(side,Object.assign({},sparse,{travelM:20})));
assert(!adjacentRoad(side,sparse,{phase:'rear'}));assert(!adjacentRoad(side,sparse,{phase:'section'}));
let now=epoch;const engine=new MapcamWarnings(),session=new NotificationSession({cancel(){}},()=>({voice:'off'}),()=>now);
const choices=[];for(let i=-1;i<25;i++){
 const f=fix(i);now=f.timeMs;const track=withDensity(tr.update(f,now),[main,side]);
 engine.update(f,[main,side],now,track);
 for(const s of Object.values(engine.states))s.trajectory=alignment(s.camera,track,s);
 const picked=session.update(engine.states,f,0,[]);if(picked)choices.push(picked.camera.limit);
 assert(!engine.states.side30,'Side camera must not be queued, including force-audio mode');
}
assert(choices.length>15&&choices.every(x=>x===60));
const radar=selectRadar(null,[main,side],fix(0),0,{preview(){return null;}},sparse);
assert(radar&&radar.camera.id==='main60');
// Preserve signed curve projection on either turn; never fall back to the
// straight tangent to admit a rejected service-road point.
for(const k of [1/600,-1/600]){
 const arc=Object.assign({},t,{curvature:k,model:'arc',horizonM:600,lengthM:600,travelM:150,fitErrorRad:0});
 const own=Object.assign({},main,point(arc,300,0),{mapcamApproachHeadingDeg:alignment(point(arc,300,0),arc).headingDeg});
 const other=Object.assign({},side,point(arc,250,Math.sign(k)*30),{mapcamApproachHeadingDeg:alignment(point(arc,250,0),arc).headingDeg});
 const ctx=withDensity(arc,[own,other]);assert(!adjacentRoad(own,ctx));assert(adjacentRoad(other,ctx));
 const hit=require(A+'/mapcam-warnings').pointHit(own,arc,arc.heading,60,1000,4000,ctx);assert(hit&&hit.trajectoryCurve);
 assert(!require(A+'/mapcam-warnings').pointHit(other,arc,arc.heading,60,1000,4000,ctx));
}
const start=process.hrtime();for(let i=0;i<1000;i++)withDensity(t,Array.from({length:500},(_,j)=>points[j%4]));
const elapsed=process.hrtime(start);console.log('PASS: 30/60, service-road own camera, density, duplicate records, GPS uncertainty, warm-up, radar, both curves, rear/section preservation. 1000 x 500 density checks: '+(elapsed[0]*1000+elapsed[1]/1e6).toFixed(1)+' ms (PC).');
