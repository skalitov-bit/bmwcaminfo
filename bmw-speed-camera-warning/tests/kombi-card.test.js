'use strict';
const assert=require('assert'),path=require('path'),fs=require('fs');
const base=path.resolve(process.argv[2]||path.join(__dirname,'../apps/aurelm_speed_camera_warning'));
const card=require(path.join(base,'kombi-card'));
const fixtures={
 speeding:{camera:{id:'a',limit:60,camera_model:'СТРЕЛКА',mapcamTypeCode:1},distanceM:300,speedKmh:85,type:'speeding'},
 unknown:{camera:{id:'b',limit:null,mapcamTypeCode:1},distanceM:1200,speedKmh:80,type:'camera'},
 police:{camera:{id:'c',mapcamTypeCode:20},distanceM:500,speedKmh:60,type:'camera'},
 average:{camera:{id:'d',limit:90,camera_model:'АВТОДОРИЯ',averageControl:true},distanceM:650,useAverage:true,averageKmh:85,type:'camera'},
 estimated:{camera:{id:'e',limit:60,camera_model:'СТРЕЛКА'},distanceM:250,speedKmh:85,type:'speeding',estimated:true}
};
assert(card.IH<=720&&card.IW<=1920,'Wire image dimensions accepted');
assert(card.POSITION.x+card.W<=1088&&card.POSITION.y+card.H<=480);
assert(card.RING.x>=0&&card.RING.y>=0&&card.RING.x+card.RING.w<=card.W&&card.RING.y+card.RING.h<=card.H,'Outer ring remains inside opaque card');
for(const name of Object.keys(fixtures)){
 const e=fixtures[name],px=card.makeFrame(e);assert.strictEqual(px.length,card.IW*card.IH*4);
 for(let i=3;i<px.length;i+=4)assert.strictEqual(px[i],255,'Opaque '+name+' pixel '+i);
 const patched=Buffer.from(px),r=card.DISTANCE_RECT,next=Object.assign({},e,{distanceM:9}),small=card.distancePixels(next);
 for(let row=0;row<r.h;row++)small.copy(patched,((r.y+row)*card.IW+r.x)*4,row*r.w*4,(row+1)*r.w*4);
 assert(patched.equals(card.makeFrame(next)),'No old glyphs or erased labels after '+name+' distance update');
 if(process.env.KOMBI_PREVIEW_DIR){
  const {Canvas}=require(path.join(base,'kit/canvas')),cv=new Canvas(card.IW,card.IH);cv.blit({w:card.IW,h:card.IH,d:px},0,0);
  fs.mkdirSync(process.env.KOMBI_PREVIEW_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.KOMBI_PREVIEW_DIR,name+'.png'),cv.png());
 }
}
console.log('PASS compact KOMBI: opaque pixels, wire bounds, contained ring, five event types, clean partial updates');
