'use strict';
const assert=require('assert'),path=require('path'),fs=require('fs');
const packed=path.resolve(process.argv[2]),out=process.argv[3]&&path.resolve(process.argv[3]);
const {CityMapHddDialog}=require(packed+'/city-map-hdd-dialog'),{Display}=require(packed+'/kit/display'),{Recorder,play}=require(packed+'/kit/record'),{Canvas}=require(packed+'/kit/canvas'),style=require(packed+'/screen-style'),i18n=require(packed+'/i18n');
let response=null,targets=[];const store={notice:{kind:'found',count:3},respondToHddNotice:v=>{response=v;}},dialog=new CityMapHddDialog(store);
function draw(name){const cv=new Recorder(1600,520).clear('#000000');dialog.draw(cv,style,(cv,x,y,w,h,fn,key)=>cv.target(x,y,w,h,fn,key,0));targets=cv.targets;if(out)fs.writeFileSync(path.join(out,name+'.png'),play(cv.words(),new Canvas(1600,520)).png());}
const d=Object.create(Display.prototype);Object.assign(d,{pageTargets:[],ccuLast:null,focusKey:null,sheet:null,place:{scale:1,ox:0,oy:0,x:0,y:0,w:1600,h:520},log:{info(){},error(e){throw e;}},_repaint(){},_tabList:()=>({tabs:[],sel:-1,settings:-1}),buttons:()=>[]});require(packed+'/controller-navigation').install(d);
let knob=0;function input(pb){d._ccu({frontRotaryEncoderOperation:knob,frontRotaryEncoderPushButton:pb||0,frontRotaryEncoderDeflection:0});}
for(const lang of ['ru','en']){i18n.setLanguage(lang);store.notice={kind:'found',count:3};draw('hdd-found-'+lang);assert.equal(targets.length,2);const later=targets.find(t=>t.key==='hdd-transfer-later');dialog.tap(later.x+5,later.y+5);assert.strictEqual(response,false);
 d.pageTargets=targets;d._focus({k:'tgt:hdd-transfer-start'});input();input(1);input(0);assert.strictEqual(response,true);knob++;input();assert.equal(d.focusKey,'tgt:hdd-transfer-later');input(1);input(0);assert.strictEqual(response,false);
 for(const n of [{kind:'success',count:3},{kind:'failure',count:1,remaining:2},{kind:'success',count:0,empty:true}]){store.notice=n;draw('hdd-'+n.kind+(n.empty?'-empty':'')+'-'+lang);assert.equal(targets.length,1);response=null;dialog.tap(targets[0].x+5,targets[0].y+5);assert.strictEqual(response,true);}
}
i18n.setLanguage('ru');console.log('PASS HDD dialogs: RU/EN, touch, rotary focus and press, success/failure/empty states');
