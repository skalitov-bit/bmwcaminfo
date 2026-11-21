'use strict';
const R=6371000,DEG=Math.PI/180;
function diff(a,b){return Math.abs((a-b+540)%360-180);}
function distance(a,b){const dlat=(b.lat-a.lat)*DEG,dlon=(b.lon-a.lon)*DEG;
 const h=Math.sin(dlat/2)**2+Math.cos(a.lat*DEG)*Math.cos(b.lat*DEG)*Math.sin(dlon/2)**2;
 return 2*R*Math.asin(Math.min(1,Math.sqrt(h)));}
function bearing(a,b){const d=(b.lon-a.lon)*DEG,x=Math.sin(d)*Math.cos(b.lat*DEG);
 const y=Math.cos(a.lat*DEG)*Math.sin(b.lat*DEG)-Math.sin(a.lat*DEG)*Math.cos(b.lat*DEG)*Math.cos(d);
 return (Math.atan2(x,y)/DEG+360)%360;}
module.exports={distance,bearing,diff};
