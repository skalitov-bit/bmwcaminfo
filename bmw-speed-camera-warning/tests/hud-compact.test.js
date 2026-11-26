'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm'),os=require('os');
const base=path.resolve(__dirname,'../apps/aurelm_speed_camera_warning');
const compact=require(path.join(base,'hud-compact')),i18n=require(path.join(base,'i18n'));
let next=1,full=0,partial=0;
class Render{
 constructor(){this.ready=true;this.targets='map:1088x480,hud:800x480';this.items={};}on(){}removeListener(){}connect(){}close(){}
 image(o){const id=next++;this.items[id]={o,px:Buffer.alloc(o.iw*o.ih*4)};return id;}
 drop(id){delete this.items[id];}set(id,o){Object.assign(this.items[id].o,o);}
 pixels(id,rs,px){const item=this.items[id];assert(item);if(!rs){assert.equal(px.length,item.px.length);px.copy(item.px);full++;return;}
  partial++;let off=0;for(const r of rs){assert(r.x>=0&&r.y>=0&&r.x+r.w<=item.o.iw&&r.y+r.h<=item.o.ih);for(let y=0;y<r.h;y++){px.copy(item.px,((r.y+y)*item.o.iw+r.x)*4,off,off+r.w*4);off+=r.w*4;}}assert.equal(off,px.length);
 }
}
const api=vm.runInNewContext(fs.readFileSync(path.join(base,'cluster-output.js'),'utf8')+'\n({CameraClusterOutput,makeFrame,footer,makeGpsFrame});',{
 Buffer,module:{exports:{}},require:n=>n==='./cluster_render_client'?{ClusterRender:Render}:require(path.join(base,n)),setTimeout:()=>1,clearTimeout:()=>{},setInterval:()=>1,clearInterval:()=>{}
});
const e={camera:{id:'compact',mapcamTypeCode:1,camera_model:'СТРЕЛКА',limit:60},distanceM:300,type:'speeding',speedKmh:90};
const o=new api.CameraClusterOutput({mode:'both',hudPosition:{x:190,y:160,banner:'short'}});
function verifyRing(short){
 const card=o.cr.items[o.layers.hud].o,ring=o.cr.items[o.rings.hud].o;
 const k=o.hudPosition.scale/100;
 assert(Math.abs(ring.x+ring.w/2-card.x-(short?compact.GEOMETRY.signX:284)*k)<1e-8,'Ring centre must match speed sign horizontally');
 assert(Math.abs(ring.y+ring.h/2-card.y-(short?compact.GEOMETRY.signY:59)*k)<1e-8,'Ring centre must match speed sign vertically');
 assert.equal(ring.w,84*k);assert.equal(ring.h,84*k);
}
function verify(){assert(o.cr.items[o.layers.hud].px.equals(compact.frame(o.current,api.footer(o.current),o.hudPosition.stripe)),'Compact dirty patches equal complete frame');assert(o.cr.items[o.layers.map].px.equals(api.makeFrame(o.current,true)),'KOMBI is unchanged');verifyRing(true);}
o.show(e);verify();const initialFull=full;
for(const d of [10000,1000,999,100,9,0]){o.updateDistance(d,false);verify();}assert.equal(full,initialFull,'10 Hz updates must only upload numeric patches');
o.updateDistance(75,true);verify();o.updateDistance(74,false);verify();
o.current.accuracyDegraded=true;o._draw(o.current);verify();
const model=compact.frame(e,api.footer(e),true);
// The sign must cut a transparent annulus into the camera, not hide it with
// black pixels (which would obscure the real HUD background).
const g=compact.GEOMETRY;
for(let y=(g.signY-35)*2;y<(g.signY+35)*2;y++)for(let x=(g.signX-35)*2;x<(g.signX+35)*2;x++){
 const d=Math.hypot((x+.5)/2-g.signX,(y+.5)/2-g.signY);
 if(d>32.5&&d<33.5)assert.equal(model[(y*g.IW+x)*4+3],0,'Transparent separation around speed sign');
}
assert.equal(model[((g.signY*2)*g.IW+g.signX*2)*4+3],255,'Speed sign remains opaque');
// Compare actual pixels with the full HUD, including ring, digits and AA.
const regular=api.makeFrame(e);
for(let y=-63;y<64;y++)for(let x=-63;x<64;x++)if(Math.hypot(x+.5,y+.5)<63){
 const shortAt=((g.signY*2+y)*g.IW+g.signX*2+x)*4,fullAt=((59*2+y)*840+284*2+x)*4;
 assert(model.slice(shortAt,shortAt+4).equals(regular.slice(fullAt,fullAt+4)),'Same speed sign pixels in both HUD formats');
}
assert(model.equals(compact.frame(Object.assign({},e,{camera:Object.assign({},e.camera,{camera_model:'ДРУГАЯ МОДЕЛЬ'})}),api.footer(e),true)),'No model is drawn');
const oldMap=o.layers.map;o.setHudPosition({x:190,y:160,stripe:false,banner:'full'});assert.equal(o.layers.map,oldMap);assert(o.cr.items[o.layers.hud].px.equals(api.makeFrame(o.current).fill(0,0,840*10*4)));
verifyRing(false);
o.setHudPosition({x:190,y:160,stripe:true,banner:'short'});verify();assert.equal(o.layers.map,oldMap);
for(const banner of ['short','full','short'])for(const pos of [{x:0,y:0},{x:250,y:200}]){
 o.setHudPosition(Object.assign({banner},pos));verifyRing(banner==='short');
 o.current.camera.limit=90;o._draw(o.current);verifyRing(banner==='short');
 o.current.camera.limit=60;o._draw(o.current);verifyRing(banner==='short');
 o._setBlink(1,true);assert.equal(o.cr.items[o.rings.hud].o.visible,true);verifyRing(banner==='short');
 o._setBlink(0,true);assert.equal(o.cr.items[o.rings.hud].o.visible,false);
}
// Every supported scale: same backing pixels/10 Hz dirty rectangles, only the
// display rectangles shrink; KOMBI is not scaled. Reconnect uses saved geometry.
for(const banner of ['full','short']){
 o.setHudPosition({banner,x:190,y:160,scale:100});
 const mapBefore=JSON.stringify(o.cr.items[o.layers.map].o);
 for(const scale of [100,95,90,85,80,75,70,100]){
  const before=full,ref=o.layers.hud;
  o.setHudPosition({banner,x:800,y:480,scale});verifyRing(banner==='short');
  const card=o.cr.items[o.layers.hud].o,k=scale/100;
  assert.equal(o.layers.hud,ref,'Scaling does not recreate the image');
  assert.equal(full,before,'Scaling does not upload another pixel buffer');
  assert.equal(card.w,(banner==='short'?244:420)*k);assert.equal(card.h,(banner==='short'?227:116)*k);
  assert(card.x+card.w<=800&&card.y+card.h<=480,'Scaled image stays inside HUD');
  for(const d of [1000,99,0]){o.updateDistance(d,false);verifyRing(banner==='short');}
  assert.equal(JSON.stringify(o.cr.items[o.layers.map].o),mapBefore,'KOMBI geometry stays unchanged');
 }
 o.setHudPosition({banner,x:210,y:180,scale:70});
 o.cr.drop(o.layers.hud);o.cr.drop(o.rings.hud);delete o.layers.hud;delete o.rings.hud;
 o._makeLayers();o._draw(o.current);verifyRing(banner==='short');
}
for(const status of ['lost','searching','unreliable','degraded','reserve']){o.clear();o.setGpsStatus(status);assert(o.cr.items[o.layers.hud].px.equals(compact.gps(status)));}
o.setHudPosition({x:190,y:160,banner:'full'});assert(o.cr.items[o.layers.hud].px.equals(api.makeGpsFrame('reserve',false,o.hudStripeWidth)));
// Every source category, unknown limit, rear flag and both supported languages.
const cameras=[...Array.from({length:22},(_,i)=>({mapcamTypeCode:i+1})),...[15,68,155,156,194,206,208,210,211,227].map(typeCode=>({typeNamespace:'estrelka',typeCode}))];
for(const language of ['ru','en']){i18n.setLanguage(language);for(const c of cameras)for(const limit of [null,60,120]){const x=Object.assign({},e,{camera:Object.assign({},c,{limit,rearCapture:true})});assert.equal(compact.frame(x,api.footer(x),true).length,g.IW*g.IH*4);}}i18n.setLanguage('ru');
const {HudPositionStore,HudPositionEditor,normalize}=require(path.join(base,'hud-position'));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hud-compact-'));try{
 const store=new HudPositionStore(dir);assert.equal(store.load().banner,'full');store.save({x:700,y:400,banner:'short',stripe:false});assert.deepEqual(store.load(),{x:556,y:253,banner:'short',stripe:false,scale:100});assert.equal(normalize({banner:'bad'}).banner,'full');
 const ed=new HudPositionEditor({store,output:o,moving:()=>false,change:()=>{},apply:p=>o.setHudPosition(p),back:()=>{}});ed.open();ed.setBanner('full');ed.stop();ed.open();assert.equal(ed.draft.banner,'short');
 for(const key of ['hud-full','hud-short']){const b=ed.buttons().find(b=>b.key===key);ed.tap(b.x+1,b.y+1);assert.equal(ed.draft.banner,key==='hud-full'?'full':'short');}
 ed.save();assert.equal(store.load().banner,'short');ed.reset();assert.equal(ed.draft.banner,'full');
 assert.equal(store.load().scale,100,'Old preferences default to current 100%');
 ed.test();for(let i=0;i<10;i++)ed.buttons().find(b=>b.key==='hud-smaller').run();
 assert.equal(ed.draft.scale,70);assert.equal(o.hudPosition.scale,70,'Live test uses draft scale');
 assert.equal(store.load().scale,100,'Draft is not saved until requested');
 ed.save();ed.stop();ed.open();assert.equal(ed.draft.scale,70,'Scale survives reopen');
 ed.buttons().find(b=>b.key==='hud-larger').run();assert.equal(ed.draft.scale,75);
 ed.stop();ed.open();assert.equal(ed.draft.scale,70,'Cancel discards scale');
 for(const scale of [NaN,Infinity,'70',null])assert.equal(normalize({scale}).scale,100);
 assert.equal(normalize({scale:5}).scale,70);assert.equal(normalize({scale:200}).scale,100);
 ed.reset();assert.equal(ed.draft.scale,100);
 const b=ed.buttons();for(let i=0;i<b.length;i++)for(let j=i+1;j<b.length;j++)assert(!(b[i].x<b[j].x+b[j].w&&b[i].x+b[i].w>b[j].x&&b[i].y<b[j].y+b[j].h&&b[i].y+b[i].h>b[j].y),'No overlapping touch targets');
 const nav={_toward:()=>null,_ring:()=>b.map(p=>({k:'tgt:'+p.key})),focusKey:'tgt:hud-short'};
 require(path.join(base,'controller-navigation')).install(nav);
 for(const key of ['hud-smaller','hud-larger','hud-save']){const next=nav._toward('S');assert.equal(next.k,'tgt:'+key);nav.focusKey=next.k;}
 assert.equal(nav._toward('N').k,'tgt:hud-larger','Joystick navigates back through scale controls');
}finally{fs.readdirSync(dir).forEach(f=>fs.unlinkSync(path.join(dir,f)));fs.rmdirSync(dir);}
if(process.argv[2]){fs.mkdirSync(process.argv[2],{recursive:true});fs.writeFileSync(path.join(process.argv[2],'compact.rgba'),model);fs.writeFileSync(path.join(process.argv[2],'full.rgba'),api.makeFrame(e));}
console.log('PASS compact HUD: real renderer, partial/full parity, model removal, saved format, bounds, touch targets, live switching, GPS, unchanged KOMBI');
