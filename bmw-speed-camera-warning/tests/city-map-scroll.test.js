'use strict';
const assert=require('assert'),path=require('path');
const {CityMapPanel}=require('../apps/aurelm_speed_camera_warning/city-map-panel');
const packed=path.resolve(process.argv[2]),{Display}=require(packed+'/kit/display'),{Recorder}=require(packed+'/kit/record'),style=require(packed+'/screen-style');
let targets=[],d;
const rows=Array.from({length:100},(_,i)=>({id:'region-'+i,countryCode:'RU',name:'Область '+String(i).padStart(3,'0'),bytes:123456,createdAt:'2026-11-21T00:00:00Z',coverage:'Test'}));
const store={installed:{},catalog:{cities:rows},busy:false,status:'',state:()=> 'НЕ УСТАНОВЛЕНА',entry:id=>rows.find(e=>e.id===id),refresh(){}};
function draw(){const cv=new Recorder(1600,520);panel.draw(cv,style,(cv,x,y,w,h,fn,key)=>cv.target(x,y,w,h,fn,key,0));targets=cv.targets;if(d)d.pageTargets=targets;assert(cv.scroll);}
const panel=new CityMapPanel(store,draw,()=>{},()=>{});
panel.scope='russia';
d=Object.create(Display.prototype);Object.assign(d,{pageTargets:[],ccuLast:null,focusKey:null,sheet:null,place:{scale:1,ox:0,oy:0,x:0,y:0,w:1600,h:520},log:{info(){},error(e){throw e;}},_repaint(){},_tabList:()=>({tabs:[],sel:-1,settings:-1}),buttons:()=>[]});panel.bindNavigation(d,()=>true);draw();
let knob=0;function input(pb,df){d._ccu({frontRotaryEncoderOperation:knob,frontRotaryEncoderPushButton:pb||0,frontRotaryEncoderDeflection:df||0});}
d._focus({k:'tgt:map-city-region-0'});input();
for(let i=1;i<100;i++){knob++;input();assert.equal(d.focusKey,'tgt:map-city-region-'+i);assert.equal(panel.selected,'region-'+i);assert(targets.some(t=>t.key==='map-city-region-'+i));}
assert.equal(panel.offset,97);knob++;input();assert.notEqual(d.focusKey,'tgt:map-city-region-99','can leave list at end');
d._focus({k:'tgt:map-city-region-99'});for(let i=98;i>=0;i--){knob--;input();assert.equal(panel.selected,'region-'+i);}assert.equal(panel.offset,0);
panel.tap(1530,245);assert.equal(panel.offset,1,'touch down arrow');panel.tap(1530,110);assert.equal(panel.offset,0,'touch up arrow');panel.scrollPixels(10000);assert.equal(panel.offset,97);panel.scrollPixels(-10000);assert.equal(panel.offset,0);
input(0,7);assert.equal(panel.selected,'region-1');input(0,0);input(0,1);assert.equal(panel.selected,'region-0');
store.busy=true;assert.equal(panel.scrollRows(1),false);store.busy=false;store.catalog.cities=rows.slice(0,2);panel.offset=97;const cv=new Recorder(1600,520);panel.draw(cv,style,()=>{});assert.equal(panel.offset,0);assert(!cv.scroll);
console.log('PASS 100 maps: rotary and tilt auto-scroll, exit list, touch arrows, swipe/clamping, busy guard and catalog shrink');
