'use strict';
const font=require('./cluster-text');
const colors={bg:'#000000',panel:'#08090b',road:'#333b45',edge:'#56616d',text:'#f5f9fc',muted:'#a9becf',blue:'#f5f9fc',red:'#d32c36',green:'#f5f9fc',yellow:'#ffcd4a',grid:'#1b232d'};
const tabs=[['MAP','КАРТА'],['RADAR','РАДАР'],['ADD','ДОБАВИТЬ'],['MY','МОИ КАМЕРЫ'],['SETTINGS','НАСТРОЙКИ']];
const nav={x:20,y:24,w:222,h:(518-24)/tabs.length,gap:0};
const content={x:266,y:74,w:1314,h:398};
const cache=new Map();let cacheBytes=0;
const backgrounds=new Map();let backgroundBytes=0;
function cachedBackground(cv,key,x,y,w,h,draw){
 if(cv.recording!==true||typeof cv.blit!=='function'||![x,y,w,h].every(Number.isInteger)||w<=0||h<=0)return false;
 let layer=backgrounds.get(key);
 if(!layer){
  const bytes=w*h*4;
  // Do not create/evict an unbounded sequence of remote textures.
  if(backgrounds.size>=16||backgroundBytes+bytes>2*1024*1024)return false;
  const record=require('./kit/record');
  if(typeof record.makeLayer!=='function')return false;
  layer=record.makeLayer(w,h,draw);backgrounds.set(key,layer);backgroundBytes+=bytes;
 }
 cv.blit(layer,x,y);return true;
}
function text(cv,value,x,baseline,size,color,options){
 const o=options||{},s=require('./i18n').t(value).toUpperCase().replace(/[·•]/g,'/').replace(/[—−–]/g,'-').replace(/×/g,'X').replace(/[«»]/g,'').replace(/,/g,' ');
 size=font.fittedSize(s,size,o.maxWidth||Math.max(1,1580-x));
 if(cv.recording===true)return require('./hud-canvas').text(cv,s,x,baseline-font.capHeight(size),size,color,o);
 const rgb=color.match(/[a-f\d]{2}/gi).map(v=>parseInt(v,16));
 const inset=font.topInset(s,size),key=JSON.stringify([s,size,color]);let image=cache.get(key);
 if(!image){
  const w=Math.max(1,Math.ceil(font.width(s,size))+4),h=Math.ceil(size*1.5)+4+inset;
  image={w,h,d:Buffer.alloc(w*h*4)};font.draw(image.d,w,h,1,s,2,2+inset,size,rgb);
  if(image.d.length<=8*1024*1024){
   while(cache.size&&(cache.size>=160||cacheBytes+image.d.length>8*1024*1024)){const k=cache.keys().next().value;cacheBytes-=cache.get(k).d.length;cache.delete(k);}
   cache.set(key,image);cacheBytes+=image.d.length;
  }
 }
 let left=x-2;if(o.align==='center')left-=font.width(s,size)/2;else if(o.align==='right')left-=font.width(s,size);
 cv.blit(image,Math.round(left),Math.round(baseline-font.capHeight(size)-2-inset));return size;
}
function tabAt(x,y){
 if(x<nav.x||x>=nav.x+nav.w)return null;
 const i=Math.floor((y-nav.y)/(nav.h+nav.gap));
 return i>=0&&i<tabs.length&&y>=nav.y+i*(nav.h+nav.gap)&&y<nav.y+i*(nav.h+nav.gap)+nav.h?tabs[i][0]:null;
}
function drawSelection(cv,x,y,w,h,overlay){
 if(!overlay&&cachedBackground(cv,'selected:'+w+':'+h,x,y,w,h,c=>selectionPixels(c,0,0,w,h,false)))return;
 selectionPixels(cv,x,y,w,h,overlay);
}
function drawFocus(cv,x,y,w,h){
 // Translucent focus for controls whose labels have already been painted.
 selectionPixels(cv,x,y,w,h,true,true);
}
function selectionPixels(cv,x,y,w,h,overlay,gray){
 const accent=gray?'#8e8e8e':colors.red;
 const divider=accent.match(/[a-f\d]{2}/gi).map(v=>parseInt(v,16));
 const left=gray?[42,42,42]:[48,18,22],right=[8,9,11],steps=Math.min(Math.ceil(w),256);
 for(let i=0;i<steps;i++){
  const t=i/Math.max(1,steps-1),dx=Math.round(i*w/steps),dw=Math.round((i+1)*w/steps)-dx;
  const opacity=1-t*t*(3-2*t);
  const fill=overlay?divider.concat(Math.round(28*opacity)):left.map((v,k)=>Math.round(v+(right[k]-v)*t));
  cv.fillRect(x+dx,y,dw,h,fill);
  const line=divider.concat(Math.round(255*opacity));
  cv.fillRect(x+dx,y,dw,1,line);cv.fillRect(x+dx,y+h-1,dw,1,line);
 }
 cv.fillRect(x,y,Math.min(4,w),h,accent);
}
function drawNavTile(cv,id,active,version,renderMode,gray){
 const i=tabs.findIndex(t=>t[0]===id);if(i<0)return;
 const label=tabs[i][1],y=Math.round(nav.y+i*nav.h),h=Math.round(nav.y+(i+1)*nav.h)-y,on=active===id;
  // Horizontal graphite fade; narrow strips work on both native and preview
  // canvases without introducing another renderer operation or bitmap asset.
  if(on)drawSelection(cv,nav.x,y,nav.w,h);
  else if(gray){if(!cachedBackground(cv,'nav-focus:'+nav.w+':'+h,nav.x,y,nav.w,h,c=>selectionPixels(c,0,0,nav.w,h,false,true)))selectionPixels(cv,nav.x,y,nav.w,h,false,true);}
  else if(!cachedBackground(cv,'nav:'+nav.w+':'+h,nav.x,y,nav.w,h,c=>navBackground(c,0,0,nav.w,h)))navBackground(cv,nav.x,y,nav.w,h);
  text(cv,label,nav.x+20,y+h/2+font.capHeight(25)/2,25,on?colors.text:colors.muted,{maxWidth:nav.w-34});
  if(id==='SETTINGS'&&version){
   const suffix='.'+version+(renderMode?'  '+renderMode:''),right=nav.x+nav.w-12,baseline=y+h-10;
   text(cv,suffix,right,baseline,17,colors.muted,{align:'right'});
   // A small v shares the baseline with the version; the UI atlas is uppercase.
   text(cv,'V',right-font.width(suffix,17)-1,baseline,12,colors.muted,{align:'right'});
  }
}
function drawNav(cv,active,version,renderMode){
 tabs.forEach(([id])=>drawNavTile(cv,id,active,version,renderMode,false));
}
function drawNavFocus(cv,id,state){
 if(!state||state.active===id)return;
 drawNavTile(cv,id,state.active,state.version,state.renderMode,true);
}
function navBackground(cv,x,y,w,h){
 const left=[17,18,20],right=[8,9,11];
 for(let i=0;i<w;i++){
  const t=i/(w-1),rgb=left.map((v,k)=>Math.round(v+(right[k]-v)*t));
  cv.fillRect(x+i,y,1,h,rgb);
 }
}
function heading(cv,title,detail){
 text(cv,title,content.x,46,30,colors.text,{maxWidth:760});
 if(detail)text(cv,detail,1580,44,17,colors.muted,{align:'right',maxWidth:500});
 cv.line(content.x,60,1580,60,2,'#28323d');
}
function speedSign(cv,limit,x,y,r){
 cv.circle(x,y,r,colors.red);cv.circle(x,y,r*26/32,'#ffffff');
 const size=font.fittedSize(String(limit),r,1.38*r);
 text(cv,limit,x,y+font.capHeight(size)/2,size,'#141d26',{align:'center',maxWidth:1.38*r});
}
module.exports={text,colors,tabs,nav,content,tabAt,drawNav,drawNavFocus,drawSelection,drawFocus,heading,speedSign};
