'use strict';
// Offline, anti-aliased glyph images. No font engine or installed car fonts needed.
const atlas=require('./cluster-font.json');
const alpha=require('zlib').inflateSync(Buffer.from(atlas.alpha,'base64'));
function glyph(ch){return atlas.glyphs[ch]||atlas.glyphs['?'];}
function upper(value,options){return options&&options.preserveCase?String(value):String(value).toUpperCase();}
function width(value,size,options){let units=0;for(const ch of upper(value,options))units+=glyph(ch)[5];return units*size/atlas.size;}
function fittedSize(value,size,maxWidth,options){const w=width(value,size,options);return maxWidth&&w>maxWidth?size*maxWidth/w:size;}
function topInset(value,size,options){let top=0;for(const ch of upper(value,options))top=Math.min(top,atlas.capHeight+glyph(ch)[4]);return Math.ceil(-top*size/atlas.size);}
function draw(px,iw,ih,scale,value,x,y,size,color,options){
 const o=options||{},s=upper(value,o);size=fittedSize(s,size,o.maxWidth,o);
 const factor=size*scale/atlas.size;
 let pen=x*scale;
 if(o.align==='center')pen-=width(s,size,o)*scale/2;
 const baseline=y*scale+atlas.capHeight*factor;
 for(const ch of s){
  const g=glyph(ch),off=g[0],gw=g[1],gh=g[2];
  const left=pen+g[3]*factor,top=baseline+g[4]*factor;
  const right=left+gw*factor,bottom=top+gh*factor;
  for(let yy=Math.max(0,Math.floor(top));yy<Math.min(ih,Math.ceil(bottom));yy++){
   const sy=(yy+.5-top)/factor-.5,y0=Math.floor(sy),fy=sy-y0;
   for(let xx=Math.max(0,Math.floor(left));xx<Math.min(iw,Math.ceil(right));xx++){
    const sx=(xx+.5-left)/factor-.5,x0=Math.floor(sx),fx=sx-x0;
    let coverage=0;
    for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
     const ax=x0+dx,ay=y0+dy;
     if(ax>=0&&ay>=0&&ax<gw&&ay<gh)coverage+=alpha[off+ay*gw+ax]*(dx?fx:1-fx)*(dy?fy:1-fy);
    }
    const a=coverage/255*(color[3]===undefined?1:color[3]/255);
    if(a<=0)continue;
    const i=(yy*iw+xx)*4,old=px[i+3]/255,out=a+old*(1-a);
    for(let k=0;k<3;k++)px[i+k]=Math.round((color[k]*a+px[i+k]*old*(1-a))/out);
    px[i+3]=Math.round(out*255);
   }
  }
  pen+=g[5]*factor;
 }
 return size;
}
module.exports={draw,width,fittedSize,topInset,capHeight:size=>atlas.capHeight*size/atlas.size,hasGlyph:ch=>!!atlas.glyphs[ch]};
