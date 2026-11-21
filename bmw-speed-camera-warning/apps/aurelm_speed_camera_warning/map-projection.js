'use strict';
// Heading-up projection shared by roads, forecast, camera points and selection.
function project(lat,lon,center,scale,area,heading,located){
 const east=(lon-center.lon)*111320*Math.cos(center.lat*Math.PI/180),north=(lat-center.lat)*111320;
 const h=(heading||0)*Math.PI/180,right=east*Math.cos(h)-north*Math.sin(h),forward=east*Math.sin(h)+north*Math.cos(h);
 return [area.x+area.w/2+right*scale,area.y+(located?area.h-48:area.h/2)-forward*scale];
}
class MapOrientation{
 constructor(){this.heading=0;this.time=-Infinity;}
 update(fix){
  // At rest, during loss or with unreliable coordinates keep the last heading.
  if(fix&&Number.isFinite(fix.timeMs)&&fix.timeMs>this.time&&fix.speedKmh>=8&&(require('./gps-quality').trustedPosition(fix)||fix.accuracyM>0&&fix.accuracyM<=35)&&Number.isFinite(fix.headingDeg)&&fix.headingDeg>=0&&fix.headingDeg<360){this.heading=fix.headingDeg;this.time=fix.timeMs;}
  return this.heading;
 }
}
// Display-only memory. Never send this retained position to warning engines.
class MapPosition extends MapOrientation{
 constructor(){super();this.position=null;}
 update(fix,now){
  if(!require('./gps-quality').usable(fix,now===undefined?Date.now():now))return this.heading;
  if(this.position&&fix.timeMs<this.position.timeMs)return this.heading;
  super.update(fix);
  this.position={lat:fix.lat,lon:fix.lon,timeMs:fix.timeMs};
  return this.heading;
 }
}
module.exports={project,MapOrientation,MapPosition};
