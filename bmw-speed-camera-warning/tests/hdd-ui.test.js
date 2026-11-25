'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path');
const a=path.resolve(__dirname,'../apps/aurelm_speed_camera_warning'),kit=path.resolve(process.argv[2]),out=process.argv[3]&&path.resolve(process.argv[3]);
const {CityMapPanel}=require(a+'/city-map-panel'),style=require(a+'/screen-style'),i18n=require(a+'/i18n');
const {Canvas}=require(kit+'/kit/canvas'),{Recorder,play}=require(kit+'/kit/record'),{Display}=require(kit+'/kit/display');
let checks=0,targets=[],knob=0,snapshot={schema:1,active:false,share:'/mnt/share',root:'/mnt/share/speedcam-city-maps-12345',reason:'MAP_HDD_HELPER_UPDATE',freeBytes:null,operationError:null,attempts:[{path:'/var/opt/hdshare',reason:'MAP_HDD_NOT_FOUND'},{path:'/mnt/share',reason:'MAP_HDD_HELPER_UPDATE',directError:'EACCES'}]};
const store={busy:false,installed:{},catalog:{cities:[]},status:'',storage:{diagnostic:()=>snapshot},storageLabel:()=>snapshot.active?'КАРТЫ: HDD':'КАРТЫ: ВНУТРЕННЯЯ ПАМЯТЬ',prepareStorage(){checks++;}};
const panel=new CityMapPanel(store,()=>draw(),()=>{},()=>{});
const d=Object.create(Display.prototype);Object.assign(d,{pageTargets:[],ccuLast:null,focusKey:null,sheet:null,place:{scale:1,ox:0,oy:0,x:0,y:0,w:1600,h:520},log:{info(){},error(e){throw e;}},_repaint(){},_tabList:()=>({tabs:[],sel:-1,settings:-1}),buttons:()=>[]});require(a+'/controller-navigation').install(d);
function draw(name){const cv=new Canvas(1600,520).clear('#000000');targets=[];panel.draw(cv,style,(cv,x,y,w,h,run,key)=>targets.push({x,y,w,h,run,key,r:0}));d.pageTargets=targets;if(name&&out)fs.writeFileSync(path.join(out,name+'.png'),cv.png());}
function press(key){assert(targets.some(t=>t.key===key));d._focus({k:'tgt:'+key});for(const pb of [0,1,0])d._ccu({frontRotaryEncoderOperation:knob,frontRotaryEncoderPushButton:pb,frontRotaryEncoderDeflection:0});}
for(const language of ['ru','en']){i18n.setLanguage(language);panel.showStorage=false;draw();press('maps-hdd');assert(panel.showStorage);assert.equal(targets.length,2);draw('hdd-diagnostic-failure-'+language);press('maps-hdd-check');assert(checks>0);press('maps-hdd-back');assert(!panel.showStorage);
 const b=targets.find(t=>t.key==='maps-hdd');panel.tap(b.x+5,b.y+5);assert(panel.showStorage);
 const saved=snapshot;snapshot={active:true,share:'/mnt/share',root:'/mnt/share/speedcam-city-maps-12345',reason:null,freeBytes:8*1073741824,attempts:[{path:'/var/opt/hdshare',reason:'MAP_HDD_NOT_FOUND'},{path:'/mnt/share',access:'helper',directError:'EACCES'}]};draw('hdd-diagnostic-ready-'+language);snapshot=saved;
}
i18n.setLanguage('ru');console.log('PASS HDD diagnostics: RU/EN, failure and helper-ready states, touch, joystick open/check/back');
