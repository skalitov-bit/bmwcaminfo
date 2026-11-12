'use strict';
// Approved police-head silhouette with small star and striped baton; compiled coverage mask.
const spec=require('./police-icon.json');
const alpha=require('zlib').inflateSync(Buffer.from(spec.alpha,'base64'));
if(alpha.length!==spec.width*spec.height)throw new Error('Invalid camera icon mask');
const cache=Object.create(null);
function image(width,height,color){
 const w=Math.max(1,Math.round(width)),h=Math.max(1,Math.round(height));
 const c=color||[245,249,252],key=w+'x'+h+':'+c.join(',');
 if(cache[key])return cache[key];
 const d=Buffer.alloc(w*h*4),sx=spec.width/w,sy=spec.height/h;
 // Area sampling preserves thin parts of the supplied silhouette at small display sizes.
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const x0=x*sx,x1=(x+1)*sx,y0=y*sy,y1=(y+1)*sy;let sum=0;
  for(let yy=Math.floor(y0);yy<Math.ceil(y1);yy++)for(let xx=Math.floor(x0);xx<Math.ceil(x1);xx++){
   const weight=(Math.min(x1,xx+1)-Math.max(x0,xx))*(Math.min(y1,yy+1)-Math.max(y0,yy));
   sum+=alpha[Math.min(spec.height-1,yy)*spec.width+Math.min(spec.width-1,xx)]*weight;
  }
  const i=(y*w+x)*4;d[i]=c[0];d[i+1]=c[1];d[i+2]=c[2];d[i+3]=Math.round(sum/(sx*sy));
 }
 return cache[key]={w,h,d};
}
function drawPixels(target,width,height,x,y,w,h,color){
 const fit=Math.min(w/spec.width,h/spec.height),nw=spec.width*fit,nh=spec.height*fit;x+=(w-nw)/2;y+=(h-nh)/2;w=nw;h=nh;
 const icon=image(w,h,color),left=Math.round(x),top=Math.round(y);
 for(let row=0;row<icon.h;row++)for(let col=0;col<icon.w;col++){
  const dx=left+col,dy=top+row;if(dx<0||dy<0||dx>=width||dy>=height)continue;
  const src=(row*icon.w+col)*4,a=icon.d[src+3]/255;if(!a)continue;
  const dst=(dy*width+dx)*4,old=target[dst+3]/255,result=a+old*(1-a);
  for(let k=0;k<3;k++)target[dst+k]=Math.round((icon.d[src+k]*a+target[dst+k]*old*(1-a))/result);
  target[dst+3]=Math.round(result*255);
 }
}
function drawCanvas(canvas,x,y,w,h,color){const fit=Math.min(w/spec.width,h/spec.height),nw=spec.width*fit,nh=spec.height*fit;x+=(w-nw)/2;y+=(h-nh)/2;w=nw;h=nh;if(canvas.recording===true)return require('./hud-canvas').mask(canvas,'police-post',alpha,spec.width,spec.height,x,y,w,h,color||[245,249,252]);canvas.blit(image(w,h,color),x,y);}
module.exports={drawPixels,drawCanvas};
