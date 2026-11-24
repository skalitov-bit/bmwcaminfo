'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert');
const source=path.resolve(__dirname,'../apps/aurelm_speed_camera_warning'),packed=path.resolve(process.argv[2]),maps=path.resolve(process.argv[3]);
const {CityMapStore}=require(source+'/city-map-store'),{CityMapPanel}=require(source+'/city-map-panel');
const {Display}=require(packed+'/kit/display'),{Recorder}=require(packed+'/kit/record'),style=require(packed+'/screen-style');
const c=JSON.parse(fs.readFileSync(maps+'/catalog.json')),e=c.cities[0];
let targets=[],shown=false,back=false,knob=0;
const store=new CityMapStore(fs.mkdtempSync(path.join(os.tmpdir(),'maps-controls-')),{download:async(url,file,max,progress)=>{if(!file)return Buffer.from(JSON.stringify(c));fs.copyFileSync(path.join(maps,e.file),file);progress(e.bytes);return {bytes:e.bytes,sha256:e.sha256};}});
const panel=new CityMapPanel(store,draw,()=>{back=true;},()=>{shown=true;});store.on('change',draw);
function draw(){const cv=new Recorder(1600,520);panel.draw(cv,style,(cv,x,y,w,h,fn,key)=>cv.target(x,y,w,h,fn,key,0));targets=cv.targets;}
const d=Object.create(Display.prototype);Object.assign(d,{pageTargets:[],ccuLast:null,focusKey:null,sheet:null,place:{scale:1,ox:0,oy:0,x:0,y:0,w:1600,h:520},log:{info(){},error(e){throw e;}},_repaint(){},_tabList:()=>({tabs:[],sel:-1,settings:-1}),buttons:()=>[]});require(source+'/controller-navigation').install(d);
function input(pb){d._ccu({frontRotaryEncoderOperation:knob,frontRotaryEncoderPushButton:pb||0,frontRotaryEncoderDeflection:0});}
async function press(key){d.pageTargets=targets;const ring=d._ring(),at=ring.findIndex(p=>p.k==='tgt:'+key);assert(at>=0,'controller target '+key);let pos=ring.findIndex(p=>p.k===d.focusKey);if(pos<0){knob++;input();pos=0;}knob+=at-pos;input();assert.equal(d.focusKey,'tgt:'+key);input(1);input(0);for(let i=0;store.busy&&i<500;i++)await new Promise(r=>setTimeout(r,10));assert(!store.busy);}
(async()=>{await store.refresh();draw();d.pageTargets=targets;input();await press('map-city-@russia');assert.equal(panel.scope,'russia');await press('map-city-moscow');await press('maps-install');assert(store.installed.moscow);await press('maps-install');assert.equal(store.status,'КАРТА УЖЕ АКТУАЛЬНА');await press('maps-show');assert(shown);await press('maps-delete');assert(panel.confirm);await press('maps-cancel');assert(!panel.confirm);await press('maps-delete');await press('maps-confirm');assert(!store.installed.moscow);await press('maps-back');assert.equal(panel.scope,'countries');assert(!back);await press('maps-back');assert(back);store.close();console.log('PASS controller: city selection, download, update, show, delete/cancel/confirm and back');})().catch(e=>{console.error(e.stack);process.exitCode=1;});
