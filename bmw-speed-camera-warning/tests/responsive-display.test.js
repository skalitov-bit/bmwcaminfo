'use strict';
const assert=require('assert'),path=require('path'),fs=require('fs');
const root=path.resolve(process.argv[2]);
const {Display}=require(root+'/kit/display'),{Canvas}=require(root+'/kit/canvas'),{Recorder}=require(root+'/kit/record');
const {geometry,softwareImage,snapshot}=require(root+'/kit/responsive-display');
const spec=require(root+'/kit/app-spec.json');assert.strictEqual(spec.responsiveMain,true);
const checks=[];
for(const [w,h] of [[1920,720],[1280,480],[1440,540],[1920,1080],[1280,720],[2560,960]]){
 let claims;const d=Object.create(Display.prototype);
 Object.assign(d,{spec,screen:spec.screens[0],gpu:{ready:true,native:true,touch:true,screen:{w,h},place(p){this.placement=p;},claim(c){claims=c;}},recorders:new Map(),log:{info(){}},_grab(){},_hmiBar(){},_layoutChanged(){},_shown:()=>true,theme:()=>({bg:'#000000'}),own:()=>true});
 d._place();const p=d.place,b=p.box;
 assert(p.full&&d.ownable());assert.equal(d.barH(),0);assert(p.ox>=b.x&&p.oy>=b.y);
 assert(p.ox+1600*p.scale<=w+1e-8&&p.oy+520*p.scale<=h+1e-8,'whole page fits');
 const r=new Recorder(1600,520);r.chrome={};d._drawChrome(r);d._claimTabs([],null);
 assert.equal(claims.length,1);assert(Math.abs(claims[0].y*p.scale+p.oy-b.y)<1e-8,'OEM header excluded');
 for(const [x,y] of [[20,24],[1530,246],[1550,502],[100,459]]){
  const sx=x*p.scale+p.ox,sy=y*p.scale+p.oy;
  assert(Math.abs((sx-p.ox)/p.scale-x)<1e-8&&Math.abs((sy-p.oy)/p.scale-y)<1e-8,'touch round trip');
 }
 assert.deepStrictEqual(d.chromeRec.tabRects,[]);
 const before=JSON.stringify(p);d.softDone=true;d._place();assert.equal(JSON.stringify(d.place),before,'recovery cannot reposition page');
 checks.push({screen:[w,h],scale:p.scale,box:b});
}
const cv=new Canvas(1600,520).clear('#123456');cv.fillRect(0,0,1600,1,'#ff0000');cv.fillRect(0,519,1600,1,'#00ff00');
const soft=softwareImage(cv),p=geometry(),b=p.box;
assert.equal(soft.w,b.w);assert.equal(soft.h,b.h);
const pixel=(x,y)=>Array.from(soft.d.slice((y*soft.w+x)*4,(y*soft.w+x)*4+4));
assert.deepStrictEqual(pixel(0,0),[0,0,0,255]);assert.deepStrictEqual(pixel(soft.w-1,soft.h-1),[0,0,0,255]);
let red=0,green=0;for(let i=0;i<soft.d.length;i+=4){if(soft.d[i]===255&&soft.d[i+1]===0)red++;if(soft.d[i]===0&&soft.d[i+1]===255)green++;}
assert(red>0&&green>0,'header/footer survive fallback');assert.equal(softwareImage(soft),soft,'no double resize');
const state={settings:{get:()=>null}};
assert.equal(snapshot(state).reason,'NO_RENDERER');state.gpu={ready:false};assert.equal(snapshot(state).reason,'CONNECTING');
state.gpu={ready:true,screen:{w:1920,h:720}};state.place=p;state._shown=()=>true;assert.equal(snapshot(state).mode,'GPU');
state.softDone=true;assert.equal(snapshot(state).reason,'NO_FRAME_ACK');state.softDone=false;state.blocked=true;assert.equal(snapshot(state).reason,'FOREGROUND_GATE');
console.log(JSON.stringify({passed:true,resolutions:checks,softwareHeaderFooter:true,opaqueGutters:true,touchRoundtrip:true,hardwareVerified:false},null,2));
