'use strict';
const assert=require('assert'),path=require('path');
const {CityMapPanel}=require('../apps/aurelm_speed_camera_warning/city-map-panel');
const packed=path.resolve(process.argv[2]),{Display}=require(packed+'/kit/display'),{Recorder}=require(packed+'/kit/record'),style=require(packed+'/screen-style');
const entry=(id,name,more)=>Object.assign({id,name,bytes:1000,createdAt:'2026-11-25T00:00:00Z',coverage:name},more);
const maps=[entry('moscow','Москва'),entry('tver-oblast','Тверь'),entry('novgorod-oblast','Новгород'),entry('saint-petersburg','Петербург'),entry('mari-el','Марий Эл'),entry('belarus','Республика Беларусь',{center:[27.56,53.9]}),entry('kyrgyzstan','Кыргызская Республика',{center:[74.6,42.87]}),entry('future-region','Новый регион',{countryCode:'RU'})];
let targets=[],exited=0,refreshes=0,installedId,shownId,d;
const store={installed:{},catalog:{cities:maps},busy:false,status:'',state:()=>'',entry:id=>maps.find(e=>e.id===id)||store.installed[id],refresh(){refreshes++;},install(id){installedId=id;},update(){},remove(){}};
function draw(){const cv=new Recorder(1600,520);panel.draw(cv,style,(cv,x,y,w,h,fn,key)=>cv.target(x,y,w,h,fn,key,0));targets=cv.targets;if(d)d.pageTargets=targets;}
const panel=new CityMapPanel(store,draw,()=>exited++,e=>shownId=e.id);
d=Object.create(Display.prototype);Object.assign(d,{pageTargets:[],ccuLast:null,focusKey:null,sheet:null,place:{scale:1,ox:0,oy:0,x:0,y:0,w:1600,h:520},log:{info(){},error(e){throw e;}},_repaint(){},_tabList:()=>({tabs:[],sel:-1,settings:-1}),buttons:()=>[]});panel.bindNavigation(d,()=>true);
const target=key=>targets.find(t=>t.key===key);
function click(key){const t=target(key);assert(t,key);panel.tap(t.x+2,t.y+2);}
function press(key){d._focus({k:'tgt:'+key});for(const pb of [0,1,0])d._ccu({frontRotaryEncoderOperation:0,frontRotaryEncoderPushButton:pb,frontRotaryEncoderDeflection:0});}
panel.open();draw();assert.equal(refreshes,1);
assert.deepStrictEqual(panel.visibleRows().map(e=>e.id),['@russia','belarus','kyrgyzstan']);assert(!target('maps-install'),'Russia is a folder, not a downloadable package');
click('map-city-@russia');assert.equal(panel.scope,'russia');assert.equal(panel.visibleRows().length,6);assert.equal(d.focusKey,'tgt:map-city-moscow');assert(target('maps-install'));
panel.scrollRows(3);assert(target('map-city-future-region'));click('maps-back');assert.equal(panel.scope,'countries');assert.equal(panel.selected,'@russia');assert.equal(d.focusKey,'tgt:map-city-@russia');assert.equal(panel.offset,0);assert.equal(exited,0);
press('map-city-@russia');assert.equal(panel.scope,'russia');press('maps-back');assert.equal(panel.scope,'countries');
click('map-city-belarus');draw();click('maps-install');assert.equal(installedId,'belarus');
store.installed.belarus=maps[5];draw();click('maps-show');assert.equal(shownId,'belarus');click('maps-delete');draw();assert(panel.confirm);click('maps-cancel');assert(!panel.confirm);
store.busy=true;panel.enterRussia();assert.equal(panel.scope,'countries');store.busy=false;
store.installed.moscow=maps[0];store.catalog.cities=[];draw();assert.deepStrictEqual(panel.visibleRows().map(e=>e.id),['@russia','belarus'],'installed maps stay grouped offline');click('map-city-@russia');assert.deepStrictEqual(panel.visibleRows().map(e=>e.id),['moscow']);click('maps-back');click('maps-back');assert.equal(exited,1);
console.log('PASS countries: touch and joystick open/back, focus restoration, Russian regions, future country metadata, foreign map actions, busy guard and offline grouping');
