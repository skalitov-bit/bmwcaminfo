'use strict';
function viewportBounds(center,scale,heading,area,located){
 const h=(heading||0)*Math.PI/180,c=Math.cos(h),s=Math.sin(h),pts=[];
 for(const x of [-area.w/2-60,area.w/2+60])for(const y of [-(located?area.h-48:area.h/2)-60,(located?48:area.h/2)+60]){
  const right=x/scale,forward=-y/scale,east=right*c+forward*s,north=-right*s+forward*c;
  pts.push([center.lon+east/(111320*Math.cos(center.lat*Math.PI/180)),center.lat+north/111320]);
 }
 return [Math.min.apply(null,pts.map(p=>p[0])),Math.min.apply(null,pts.map(p=>p[1])),Math.max.apply(null,pts.map(p=>p[0])),Math.max.apply(null,pts.map(p=>p[1]))];
}
// No database work here: only the asynchronously loaded road cells, bounded drawing.
class CityMapRenderer{
 constructor(){this.key='';this.lines=[];this.labels=[];this.stats={segments:0,labels:0,prepareMs:0,limited:false};}
 prepare(reader,center,scale,heading,area,project,clip){
  const origin=project(center.lat,center.lon),key=[reader.file,reader.version,Math.round(center.lat*1e5),Math.round(center.lon*1e5),Math.round(heading*2),scale,area.w,area.h,origin[0],origin[1]].join(':');if(key===this.key)return;this.key=key;const start=process.hrtime();this.lines=[];this.labels=[];let limited=false;
  const cellLimit=scale<.1?4:scale<.16?5:6;
  // Major roads first. Skip fine geometry at distant zoom, preserve all coordinates in package.
  for(let kind=0;kind<=cellLimit;kind++){
   for(const road of reader.rows){if(road[0]!==kind)continue;const pts=road[6];let a=project(pts[1]/1e6,pts[0]/1e6),longest=null,length=0;
    for(let i=2;i<pts.length;i+=2){const b=project(pts[i+1]/1e6,pts[i]/1e6);if(i<pts.length-2&&Math.hypot(b[0]-a[0],b[1]-a[1])<2.5)continue;const c=clip(a,b);a=b;if(!c)continue;const len=Math.hypot(c[1][0]-c[0][0],c[1][1]-c[0][1]);if(len<.6)continue;
     if(this.lines.length>=1200){limited=true;break;}
     this.lines.push([c[0][0],c[0][1],c[1][0],c[1][1],kind,road[5]]);if(len>length){length=len;longest=[(c[0][0]+c[1][0])/2,(c[0][1]+c[1][1])/2];}
    }
    if(road[1]&&kind<=4&&longest&&length>18&&this.labels.length<10&&!this.labels.some(l=>l[0]===road[1]||Math.abs(l[1]-longest[0])<190&&Math.abs(l[2]-longest[1])<38)){
     const x=longest[0],y=longest[1];if(x>area.x+100&&x<area.x+area.w-100&&y>area.y+68&&y<area.y+area.h-45)this.labels.push([road[1],x,y]);
    }
    if(limited)break;
   }if(limited)break;
  }
  const t=process.hrtime(start);this.stats={segments:this.lines.length,labels:this.labels.length,prepareMs:t[0]*1000+t[1]/1e6,limited};
 }
 draw(cv,reader,center,scale,heading,area,project,clip,text){this.prepare(reader,center,scale,heading,area,project,clip);
  // Draw outlines once, then interiors: intersections do not have capped seams.
  for(const inner of [false,true])for(const l of this.lines){const major=l[4]<=3,w=major?8:4,color=l[5]?'#263039':inner?(major?'#303b47':'#232c35'):(major?'#56616c':'#39444f');cv.line(l[0],l[1],l[2],l[3],inner?Math.max(1,w-3):w,color);}
  this.labels.forEach(l=>{cv.fillRect(l[1]-98,l[2]-16,196,23,'#070a0dc0');text(cv,l[0],l[1],l[2]+2,15,'#b9c2cc',{align:'center',maxWidth:190});});
 }
}
module.exports={CityMapRenderer,viewportBounds};
