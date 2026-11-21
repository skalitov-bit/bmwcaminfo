'use strict';
// Integer, square-corner rectangles have exact coverage. Avoid evaluating a
// rounded signed-distance field for every interior pixel of every large tile.
function install(Canvas){
 const p=Canvas.prototype,fill=p.roundRect,stroke=p.strokeRoundRect;
 const square=(x,y,w,h,r)=>r===0&&w>0&&h>0&&[x,y,w,h].every(Number.isInteger);
 p.roundRect=function(x,y,w,h,r,c){return square(x,y,w,h,r)?this.fillRect(x,y,w,h,c):fill.call(this,x,y,w,h,r,c);};
 p.strokeRoundRect=function(x,y,w,h,r,t,c){
  if(!square(x,y,w,h,r)||!Number.isInteger(t)||t<=0||2*t>Math.min(w,h))return stroke.call(this,x,y,w,h,r,t,c);
  this.fillRect(x,y,w,t,c);this.fillRect(x,y+h-t,w,t,c);
  this.fillRect(x,y+t,t,h-2*t,c);this.fillRect(x+w-t,y+t,t,h-2*t,c);return this;
 };
}
module.exports={install};
