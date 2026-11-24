'use strict';
// Narrow rounded shoulders, widening towards the open bottom (photo reference).
// The 420x116 information layer remains
// unchanged, inset by (20,9) in this 460x134 backing layer.
const W=460,H=134,S=2,IW=W*S,IH=H*S,INSET_X=20,INSET_Y=9;
const SCALE=.85*1.05,EDGE=460*.0065*1.2;
const BACKGROUND_OPACITY=.65; // 35% transparency; top accent fades at both ends.
function roundedPoints(){
 const out=[];
 const curve=(a,b,c,d)=>{for(let j=0;j<=48;j++){const t=j/48,u=1-t;out.push([0,1].map(k=>u*u*u*a[k]+3*u*u*t*b[k]+3*u*t*t*c[k]+t*t*t*d[k]));}};
 curve([13.8,H],[45,33],[50,0],[105,0]);
 // Straight top joins both curves tangentially; no lower red border.
 curve([W-105,0],[W-50,0],[W-45,33],[W-13.8,H]);
 return out;
}
function layout(targets){
 const match=/(?:^|[^a-z])map:(\d+)x(\d+)/i.exec(String(targets||''));
 const valid=match&&Number(match[1])>=W&&Number(match[2])>=H;
 const width=valid?Number(match[1]):1088,height=valid?Number(match[2]):480;
 // Align the complete banner 3 display pixels left of the canvas centre.
 const x=Math.round((width-W)/2)-3,y=height-H;
 return {x,y,w:W,h:H,iw:IW,ih:IH,contentX:x+INSET_X,contentY:y+INSET_Y,width,height,reported:!!valid};
}
function gradient(t){
 const stops=[[0,[37,40,44]],[.22,[17,19,21]],[.8,[3,4,5]],[1,[3,4,5]]];
 for(let i=1;i<stops.length;i++)if(t<=stops[i][0]){
  const a=stops[i-1],b=stops[i],f=Math.max(0,(t-a[0])/(b[0]-a[0]));
  return a[1].map((v,k)=>Math.round(v+(b[1][k]-v)*f));
 }
 return stops[3][1];
}
function makePixels(){
 const pixels=Buffer.alloc(IW*IH*4),points=roundedPoints();
 const dx=W*(1-SCALE)/2,dy=H*(1-SCALE)/2;
 function fill(x,y,w,h,color){
  const p=points.map(v=>[(x+v[0]/W*w)*S,(y+v[1]/H*h)*S]);
  const coverageRow=new Float32Array(IW);
  for(let row=Math.max(0,Math.floor(y*S));row<Math.min(IH,Math.ceil((y+h)*S));row++){
   coverageRow.fill(0);
   // Four subrows keep the shallow rounded shoulders antialiased at 2x.
   for(let sub=0;sub<4;sub++){
    const cy=row+(sub+.5)/4,hits=[];
    for(let j=0;j<p.length;j++){
     const a=p[j],b=p[(j+1)%p.length];
     if((a[1]<=cy&&b[1]>cy)||(b[1]<=cy&&a[1]>cy))hits.push(a[0]+(cy-a[1])*(b[0]-a[0])/(b[1]-a[1]));
    }
    hits.sort((a,b)=>a-b);
    for(let j=0;j+1<hits.length;j+=2)for(let col=Math.max(0,Math.floor(hits[j]));col<Math.min(IW,Math.ceil(hits[j+1]));col++)coverageRow[col]+=Math.max(0,Math.min(col+1,hits[j+1])-Math.max(col,hits[j]))/4;
   }
   const rgb=color||gradient(((row+.5)/S-y)/h);
   for(let col=0;col<IW;col++){
    const coverage=coverageRow[col];if(!coverage)continue;
    // Nested shape coverage replaces its portion of the outer silhouette.
    // Source-over here would leave a red fringe at the shared open bottom.
    const i=(row*IW+col)*4,old=pixels[i+3]/255,remaining=Math.max(0,old-coverage);
    const ink=coverage*(color?1:BACKGROUND_OPACITY),alpha=remaining+ink;
    for(let k=0;k<3;k++)pixels[i+k]=Math.round((rgb[k]*ink+pixels[i+k]*remaining)/alpha);
    pixels[i+3]=Math.round(alpha*255);
   }
  }
 }
 fill(dx,dy,W*SCALE,H*SCALE,null);
 // Upper accent is 20% longer, centred, following the start of each shoulder.
 // Taper thickness and opacity at both ends; render once with the background.
 const halfLength=(W-210)*SCALE*.6,left=W/2-halfLength,right=W/2+halfLength,fade=45*SCALE*1.2,red=[211,44,54];
 const upperEdge=x=>{
  const localX=(x-dx)/SCALE;let top=H;
  for(let j=0;j<points.length;j++){
   const a=points[j],b=points[(j+1)%points.length];
   if(a[0]!==b[0]&&localX>=Math.min(a[0],b[0])&&localX<=Math.max(a[0],b[0]))top=Math.min(top,a[1]+(localX-a[0])*(b[1]-a[1])/(b[0]-a[0]));
  }
  return (dy+top*SCALE)*S;
 };
 for(let col=Math.floor(left*S);col<Math.ceil(right*S);col++){
  const x=(col+.5)/S,t=Math.max(0,Math.min(1,(x-left)/fade,(right-x)/fade)),ease=t*t*(3-2*t);
  const top=upperEdge(x),bottom=top+EDGE*ease*S;
  for(let row=Math.floor(top);row<Math.ceil(bottom);row++){
   const coverage=Math.max(0,Math.min(row+1,bottom)-Math.max(row,top)),ink=coverage*ease;
   if(!ink)continue;
   const i=(row*IW+col)*4,remaining=pixels[i+3]/255*(1-ink),alpha=ink+remaining;
   for(let k=0;k<3;k++)pixels[i+k]=Math.round((red[k]*ink+pixels[i+k]*remaining)/alpha);
   pixels[i+3]=Math.round(alpha*255);
  }
 }
 return pixels;
}
module.exports={W,H,S,IW,IH,INSET_X,INSET_Y,layout,makePixels};
