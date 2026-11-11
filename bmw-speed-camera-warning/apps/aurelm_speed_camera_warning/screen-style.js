'use strict';
const font=require('./cluster-text');
const colors={bg:'#080b10',panel:'#10151c',road:'#333b45',edge:'#56616d',text:'#f5f9fc',muted:'#a9becf',blue:'#f5f9fc',red:'#d32c36',green:'#f5f9fc',yellow:'#ffcd4a',grid:'#1b232d'};
const tabs=[['MAP','КАРТА'],['ADD','ДОБАВИТЬ'],['MY','МОИ КАМЕРЫ'],['SETTINGS','НАСТРОЙКИ']];
const nav={x:20,y:24,w:222,h:98,gap:16};
const content={x:266,y:74,w:1314,h:382};
const cache=new Map();let cacheBytes=0;
function text(cv,value,x,baseline,size,color,options){
 const o=options||{},s=String(value).toUpperCase().replace(/[·•]/g,'/').replace(/[—−–]/g,'-').replace(/×/g,'X').replace(/[«»]/g,'').replace(/,/g,' ');
 size=font.fittedSize(s,size,o.maxWidth||Math.max(1,1580-x));
 if(cv.recording===true)return require('./hud-canvas').text(cv,s,x,baseline-font.capHeight(size),size,color,o);
 const rgb=color.match(/[a-f\d]{2}/gi).map(v=>parseInt(v,16));
 const key=JSON.stringify([s,size,color]);let image=cache.get(key);
 if(!image){
  const w=Math.max(1,Math.ceil(font.width(s,size))+4),h=Math.ceil(size*1.5)+4;
  image={w,h,d:Buffer.alloc(w*h*4)};font.draw(image.d,w,h,1,s,2,2,size,rgb);
  if(image.d.length<=8*1024*1024){
   while(cache.size&&(cache.size>=160||cacheBytes+image.d.length>8*1024*1024)){const k=cache.keys().next().value;cacheBytes-=cache.get(k).d.length;cache.delete(k);}
   cache.set(key,image);cacheBytes+=image.d.length;
  }
 }
 let left=x-2;if(o.align==='center')left-=font.width(s,size)/2;else if(o.align==='right')left-=font.width(s,size);
 cv.blit(image,Math.round(left),Math.round(baseline-font.capHeight(size)-2));return size;
}
function tabAt(x,y){
 if(x<nav.x||x>=nav.x+nav.w)return null;
 const i=Math.floor((y-nav.y)/(nav.h+nav.gap));
 return i>=0&&i<tabs.length&&y>=nav.y+i*(nav.h+nav.gap)&&y<nav.y+i*(nav.h+nav.gap)+nav.h?tabs[i][0]:null;
}
function drawNav(cv,active){
 tabs.forEach(([id,label],i)=>{const y=nav.y+i*(nav.h+nav.gap),on=active===id;
  cv.roundRect(nav.x,y,nav.w,nav.h,8,on?'#251318':colors.panel);
  if(on){cv.strokeRoundRect(nav.x,y,nav.w,nav.h,8,2,colors.red);cv.roundRect(nav.x+1,y+17,4,64,2,colors.red);}
  text(cv,label,nav.x+20,y+58,25,on?colors.text:colors.muted,{maxWidth:nav.w-34});
 });
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
module.exports={text,colors,tabs,nav,content,tabAt,drawNav,heading,speedSign};
