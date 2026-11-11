'use strict';
// Feed the same HUD glyph masks to MGU's native atlas renderer. Raster previews
// use cluster-text; neither path depends on fonts installed in the vehicle.
const spec=require('./cluster-font.json');
const metrics=require('./cluster-text');
let font;const masks=new Map();
function getFont(){
 if(font)return font;
 const source=require('zlib').inflateSync(Buffer.from(spec.alpha,'base64'));
 const width=1024,positions={},scaled={};let x=1,y=1,row=0;
 for(const ch of Object.keys(spec.glyphs)){const g=spec.glyphs[ch];scaled[ch]=[g[0],Math.ceil(g[1]/2),Math.ceil(g[2]/2),g[3]/2,g[4]/2,g[5]/2];}
 for(const ch of Object.keys(scaled)){const g=scaled[ch];if(x+g[1]+1>width){x=1;y+=row+2;row=0;}positions[ch]=[x,y];x+=g[1]+2;row=Math.max(row,g[2]);}
 const height=y+row+1,alpha=Buffer.alloc(width*height),glyphs={};
 for(const ch of Object.keys(scaled)){
  const g=scaled[ch],original=spec.glyphs[ch],[gx,gy]=positions[ch];
  for(let j=0;j<g[2];j++)for(let i=0;i<g[1];i++){
   let sum=0;for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++)if(i*2+dx<original[1]&&j*2+dy<original[2])sum+=source[original[0]+(j*2+dy)*original[1]+i*2+dx];
   alpha[(gy+j)*width+gx+i]=Math.round(sum/4);
  }
  glyphs[ch]=[gx,gy,g[1],g[2],g[3],g[4],g[5]];
 }
 font={size:spec.size/2,atlasW:width,atlasH:height,alpha,glyphs,cacheKey:'bmw-hud-0911-96'};return font;
}
function commands(cv,f,family,rects,color){
 const record=require('./kit/record'),id=record.atlasId(f,family);cv.atlases.add(id);
 cv._grow(4+rects.length*8);let i=cv.n;
 cv.u[i++]=record.OP.GLYPHS;cv.u[i++]=id;cv.u[i++]=record.pack(color);cv.u[i++]=rects.length;
 for(const r of rects)for(const v of r)cv.f[i++]=v;
 cv.n=i;
}
function text(cv,value,x,top,size,color,options){
 const o=options||{},s=String(value).toUpperCase(),f=getFont();size=metrics.fittedSize(s,size,o.maxWidth);
 const scale=size/f.size;let pen=x;
 if(o.align==='center')pen-=metrics.width(s,size)/2;else if(o.align==='right')pen-=metrics.width(s,size);
 const baseline=top+metrics.capHeight(size),rects=[];
 for(const ch of s){const g=f.glyphs[ch]||f.glyphs['?'];if(g[2]&&g[3])rects.push([pen+g[4]*scale,baseline+g[5]*scale,g[2]*scale,g[3]*scale,g[0],g[1],g[0]+g[2],g[1]+g[3]]);pen+=g[6]*scale;}
 commands(cv,f,'bmw-hud',rects,color);return size;
}
function mask(cv,key,alpha,sw,sh,x,y,w,h,color){
 let f=masks.get(key);if(!f){f={size:1,atlasW:sw,atlasH:sh,alpha,cacheKey:key};masks.set(key,f);}
 commands(cv,f,'bmw-mask-'+key,[[x,y,w,h,0,0,sw,sh]],color);
}
module.exports={text,mask};
