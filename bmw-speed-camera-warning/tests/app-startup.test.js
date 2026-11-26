'use strict';
// Exercise real app code and data while replacing only vehicle services/rendering.
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm'),os=require('os');
const {createRequire}=require('module');
let file=process.argv[2]||path.join(__dirname,'../apps/aurelm_speed_camera_warning/main.js');
if(path.basename(file)==='app.js'&&fs.existsSync(path.join(path.dirname(file),'speedcam-main.js')))file=path.join(path.dirname(file),'speedcam-main.js');
const appRequire=createRequire(path.resolve(file));
const {CameraStore:RealStore}=appRequire('./disk-camera-store');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-startup-'));
const warnings=[],texts=[],buttons={};let images=0,startPromise,gpsHandler,changeHandler,loopHandler,expectedCameras,tapHandler,lastCanvas,visibleHandler,pageTargets=[];
const cv=new Proxy({}, {get:(_,key)=>(...args)=>{if(key==='text')texts.push(String(args[0]));return cv;}});
const nativeButtonState={};
const settings={city:'russia',camera_display:'off',ui_language:process.env.BMW_LANGUAGE_TEST?'ask':'ru'};
const previewDir=process.env.BMW_PREVIEW_DIR;
const Canvas=previewDir?appRequire('./kit/canvas').Canvas:null;
const native=process.env.BMW_NATIVE_PREVIEW==='1'?appRequire('./kit/record'):null;
if(previewDir)fs.mkdirSync(previewDir,{recursive:true});
const ctx={dataDir:tmp,canvas:()=>native?new native.Recorder(1600,520):previewDir?new Canvas(1600,520):cv,onTap:fn=>{tapHandler=fn;},loop:(name,ms,fn)=>{loopHandler=fn;},
    log:{info:()=>{},warn:s=>warnings.push(String(s))},
    settings:{get:k=>settings[k],set:(k,v)=>{settings[k]=v;},onChange:fn=>{changeHandler=fn;}},
    ui:{visible:(id,on)=>{nativeButtonState[id]=on;},enabled:()=>{},image:(id,image)=>{images++;pageTargets=image.targets||[];lastCanvas=native?native.play(image.words(),new Canvas(1600,520)):image;},onClick:(k,fn)=>{buttons[k]=fn;},isVisible:()=>true,onVisible:fn=>{visibleHandler=fn;}}};
let manualCloses=0;ctx.requestUserClose=()=>{manualCloses++;};
let wire;
if(process.env.BMW_GPU_WIRE==='1'){
 const root=path.dirname(path.resolve(file));
 ctx.ui.isVisible=n=>n==='MAIN';ctx.ui.hasFocus=()=>true;ctx.ui._invalidate=()=>{};
 wire=require('./display-wire-fixture').make(root,ctx.ui);
 ctx.display=wire.d;ctx.canvas=()=>wire.d.canvas(1600,520);
 ctx.onTap=fn=>{wire.d.onTap=fn;tapHandler=(x,y)=>wire.tap(x,y);};
 const output=ctx.ui.image;ctx.ui.image=(id,image)=>wire.d.present(id,image,output);
 wire.ready();
}
let nextRefreshFailure=null,activeStore,pulseTime=0,voiceTests=0,voiceWarnings=0,clusterWarnings=0,centralWarnings=0;
const systemPopupCalls=[];
let lastCentralDistance=null,lastCentralBounds=null;
let beeperState=null,backgroundTick,motionTick,vehicleFixture,motionClock=null;
class TestPopupTransport {
 constructor(){this.available=true;}
 paint(e){systemPopupCalls.push('paint:'+e.camera.id);return Promise.resolve();}
 open(){systemPopupCalls.push('open');return Promise.resolve();}
 close(){systemPopupCalls.push('close');return Promise.resolve();}
}
class CameraStore extends RealStore {constructor(o){super(o);activeStore=this;}async loadLocal(){const r=await super.loadLocal();expectedCameras=this.current.cities.russia.length;return r;}refresh(){this.pending=(async()=>{
 if(nextRefreshFailure){
  const failure=nextRefreshFailure;nextRefreshFailure=null;
  const request=this.request;
  this.request=()=>{
   const req=new (require('events').EventEmitter)();
   req.destroy=()=>{};req.setTimeout=()=>{};
   process.nextTick(()=>req.emit('error',new Error(failure)));
   return req;
  };
  try{return await super.refresh();}finally{this.request=request;}
 }
 const old=this.current;this.current=await this.codec.openCatalog(path.dirname(path.resolve(file)));old.close();return {updated:true,database:this.current,source:this.source};})();return this.pending;}}
let gpsStarts=0,gpsStops=0,recoveryFixture,recoveryClock=0;
class GPS {on(k,fn){gpsHandler=fn;}start(){gpsStarts++;}stop(){gpsStops++;gpsHandler({state:'stopped',fix:null});}}
class Voice {cancel(){}camera(stage,relevant,camera){assert(camera&&camera.id,'Voice dispatch includes the database camera for model selection');assert.strictEqual(typeof relevant,'function');voiceWarnings++;return Promise.resolve(true);}test(){voiceTests++;return Promise.resolve(true);}}
let lastClusterCamera=null,lastCentralCamera=null;
let lastGpsOutput;
let clusterFixture;
class Cluster {constructor(o){clusterFixture=this;this.mode=o.mode;this.layers={hud:'test-hud'};this.cr=new (require('events'))();this.cr.ready=true;this.cr.targets='map:1088x480,hud:800x480';}setGpsStatus(s){this.gpsStatus=s;lastGpsOutput=s;}setMode(m){this.mode=m;if(m==='off')this.current=null;}setHudPosition(p){this.position=p;}show(e){this.current=Object.assign({},e);clusterWarnings++;lastClusterCamera=e.camera.id;}clear(){this.current=null;}sync(){}updateDistance(d,e){if(this.current)Object.assign(this.current,{distanceM:d,estimated:e});}}
let audioDiagnostic,audioWizard;const audioRequests=[];
class DiagnosticFixture extends appRequire('./audio-diagnostics').AudioDiagnostics {constructor(change,options){super(change,options);audioDiagnostic=this;}async request(r){audioRequests.push(r);if(r.action.indexOf('beeper-sounds-')===0){if(r.action==='beeper-sounds-save')this.savedSound=r.id;return {ok:true,beeperSoundsProtocol:1,id:this.savedSound||'1'};}if(r.action.indexOf('audio-mixer-')===0){if(!this.savedMix)this.savedMix={voice:100,beeper:100,duck:25,musicDuck:true};if(r.action==='audio-mixer-save')this.savedMix=Object.assign({},r.values);return {ok:true,mixerProtocol:1,musicDuckProtocol:1,values:Object.assign({},this.savedMix),backend:'pulse',overlay:true};}if(r.action==='audio-report')return {ok:true,audioReportProtocol:1,local:'/var/opt/bmwcaminfo-voice/reports/fixture.json',usb:'/media/TEST/SpeedCAM-Diagnostics/fixture.json',fileName:'fixture.json'};if(r.action==='audio-scan')return {ok:true,sinks:[{id:1024,name:'ТЕСТ: ВЫХОД 1'},{id:1025,name:'ТЕСТ: ВЫХОД 2'}],sources:[{id:1046,name:'OapGenericMedia'}],errors:{},alsa:{available:true},converter:{available:true}};if(r.action==='audio-current')return {ok:true,active:{backend:'file',overlay:false}};if(r.action==='audio-overlay-scan')return {ok:true,overlayProtocol:2,pulseProtocol:1,converterProfilesProtocol:1,overlaySaveSupported:true,backend:r.backend,carplayConnected:true};if(r.action==='audio-overlay-test')return {ok:true,overlayProtocol:2,overlaySaveSupported:true,overlay:{backend:r.backend,kind:'both',accepted:true,sourceID:2048,sinkID:2049}};if(r.action==='audio-save')return {ok:true,saved:{backend:r.backend,sinkID:r.sinkID,sourceID:r.sourceID,overlay:r.overlay===true}};return {ok:true};}}
const replacements={
 './runtime-recovery':{RuntimeRecovery:class extends appRequire('./runtime-recovery').RuntimeRecovery{constructor(o){super(Object.assign({},o,{now:()=>recoveryClock,setInterval:()=>0,clearInterval:()=>{}}));recoveryFixture=this;}}},
 './vehicle-speed':{VehicleSpeed:class extends appRequire('./vehicle-speed').VehicleSpeed{constructor(ctx){super(ctx,{now:()=>motionClock===null?Date.now():motionClock});vehicleFixture=this;}}},
 './motion-distance':{MotionDistance:class extends appRequire('./motion-distance').MotionDistance{constructor(o){super(Object.assign({},o,{now:()=>motionClock===null?Date.now():motionClock,wall:()=>motionClock===null?Date.now():motionClock}));}}},
 './audio-wizard':{AudioWizard:class extends appRequire('./audio-wizard').AudioWizard{constructor(...args){super(...args);audioWizard=this;}}},
 './audio-diagnostics':{AudioDiagnostics:DiagnosticFixture},
    './overspeed-beeper':Object.assign({},appRequire('./overspeed-beeper'),{OverspeedBeeper:class{update(s){beeperState=s;}stop(){beeperState=null;}}}),
    './background-notification':Object.assign({},appRequire('./background-notification'),{RhmiPopupTransport:TestPopupTransport}),
    './central-alert':{drawCentralAlert:(...args)=>{centralWarnings++;lastCentralCamera=args[1].camera.id;lastCentralDistance=args[1].distanceM;lastCentralBounds=args[3];return appRequire('./central-alert').drawCentralAlert(...args);}},
    './ring-pulse':Object.assign({},appRequire('./ring-pulse'),{monotonicMs:()=>pulseTime}),
    './kit/mgu':{run:o=>{startPromise=o.start(ctx);return startPromise;}},
    './screen-style':Object.assign({},appRequire('./screen-style'),{heading:(cv,s,...args)=>{texts.push(String(s));return appRequire('./screen-style').heading(cv,s,...args);},text:(cv,s,...args)=>{texts.push(String(s));return appRequire('./screen-style').text(cv,s,...args);}}),
    './uplink':{init:()=>{},describe:()=> 'test',checkInternet:()=>Promise.resolve(false)},
    './disk-camera-store':{CameraStore},'./gps':{BmwGps:GPS},'./bmw-position':{BmwPosition:GPS},
    './voice-alert':{CameraVoiceAlerts:Voice},'./cluster-output':{CameraClusterOutput:Cluster}
};
let hddFixture;
if(process.env.BMW_HDD_DIALOG_TEST){const Base=appRequire('./city-map-store').CityMapStore;replacements['./city-map-store']={CityMapStore:class extends Base{constructor(dir,o){assert(o.requireHddNotice,'Production enables HDD notices');const share=path.join(dir,'simulated-hdd');fs.mkdirSync(share);super(dir,Object.assign({},o,{storage:{share,mounted:()=>true,freeBytes:async()=>1e10}}));hddFixture=this;}}};}
vm.runInNewContext(fs.readFileSync(file,'utf8'),{require:n=>replacements[n]||appRequire(n),
    __dirname:path.dirname(path.resolve(file)),console,Buffer,process,setTimeout:fn=>setTimeout(fn,0),setInterval:(fn,ms)=>{if(ms===250)backgroundTick=fn;if(ms===100)motionTick=fn;return 0;}}, {filename:file});
async function run(){
    await startPromise;await activeStore.pending;await new Promise(resolve=>setTimeout(resolve,30));
    assert(images>0,'Initial app screen must render: '+warnings.join('\n'));
    if(process.env.BMW_SUPPORT_TEST){
      const settle=()=>new Promise(r=>setTimeout(r,60)),targets=()=>wire?wire.d.pageTargets:pageTargets;
      if(wire)wire.ack();
      const tap=async(x,y)=>{if(wire)wire.tap(x,y);else tapHandler(x,y);await settle();};
      await tap(100,470);assert(targets().some(t=>t.key==='settings-support'));
      const staleClose=targets().find(t=>t.key==='settings-close');
      await tap(1390,415);assert.deepStrictEqual(targets().map(t=>t.key),['support-close']);
      if(staleClose&&staleClose.run)staleClose.run();assert.equal(manualCloses,0);
      await tap(100,50);assert.deepStrictEqual(targets().map(t=>t.key),['support-close']);
      await tap(802,453);assert(targets().some(t=>t.key==='settings-support'));
      if(wire){
        let knob=100;wire.ccu(knob);
        const press=async key=>{const ring=wire.d._ring(),target=ring.findIndex(t=>t.k==='tgt:'+key);assert(target>=0,key);let current=ring.findIndex(t=>t.k===wire.d.focusKey);if(current<0){wire.ccu(++knob);current=0;}knob+=target-current;wire.ccu(knob);assert.equal(wire.d.focusKey,'tgt:'+key);wire.ccu(knob,1);wire.ccu(knob,0);await settle();};
        await press('settings-support');assert.deepStrictEqual(targets().map(t=>t.key),['support-close']);
        await press('support-close');assert(targets().some(t=>t.key==='settings-support'));
      }
      assert(!warnings.some(w=>/UI_RENDER_FAILED|ReferenceError|TypeError/.test(w)),warnings.join('\n'));
      console.log('PASS support dialog: open, modal guard, stale action guard, close; '+(wire?'GPU touch and joystick':'PNG touch'));return;
    }
    if(process.env.BMW_HDD_DIALOG_TEST&&process.env.BMW_LANGUAGE_TEST){
      const settle=()=>new Promise(r=>setTimeout(r,60));await hddFixture.ready;await settle();
      if(wire)wire.ack();
      assert.equal(hddFixture.notice.kind,'found');assert.equal(settings.ui_language,'ask');
      assert(texts.includes('SET LANGUAGE'));assert(!texts.includes('HDD ОБНАРУЖЕН'),'HDD waits behind language');
      const saveModal=name=>{if(previewDir&&!wire)fs.writeFileSync(path.join(previewDir,name+'.png'),lastCanvas.png());};saveModal('01-language-before-hdd');
      let knob=200;if(wire)wire.ccu(knob);
      const targets=()=>wire?wire.d.pageTargets:pageTargets;
      const activate=async(key,x,y)=>{
        if(wire&&process.env.BMW_MODAL_JOYSTICK==='1'){
          const ring=wire.d._ring(),target=ring.findIndex(t=>t.k==='tgt:'+key);assert(target>=0,key);
          let current=ring.findIndex(t=>t.k===wire.d.focusKey);if(current<0){wire.ccu(++knob);current=0;}
          knob+=target-current;wire.ccu(knob);assert.equal(wire.d.focusKey,'tgt:'+key);
          wire.ccu(knob,1);wire.ccu(knob,0);
        }else tapHandler(x,y);
        await settle();
      };
      const staleLanguage=targets().find(t=>t.key==='language-en');assert(staleLanguage);
      await activate('language-ru',580,270);
      assert.equal(settings.ui_language,'ru','Visible language action must not be blocked by pending HDD');
      assert.equal(hddFixture.notice.kind,'found','Selection does not discard HDD consent');
      assert(targets().some(t=>t.key==='hdd-transfer-start'),'HDD now visible');saveModal('02-hdd-after-language');
      if(typeof staleLanguage.run==='function')staleLanguage.run();
      assert.equal(settings.ui_language,'ru','Stale language input cannot bypass HDD dialog');
      tapHandler(100,460);await settle();assert.equal(hddFixture.notice.kind,'found');
      await activate('hdd-transfer-start',550,420);await hddFixture.ready;await settle();
      assert.equal(hddFixture.notice.kind,'success');assert(hddFixture.hddState.accepted);saveModal('03-hdd-success');
      await activate('hdd-transfer-ok',800,420);
      assert.equal(hddFixture.notice,null);assert.equal(settings.ui_language,'ru');
      assert(targets().some(t=>t.key==='settings-language'),'Return to normal settings');
      assert(!warnings.some(w=>/UI_RENDER_FAILED|ReferenceError|TypeError/.test(w)),warnings.join('\n'));
      hddFixture.close();console.log('PASS simultaneous language + HDD: select language, retain consent, transfer, success, return; '+(wire?(process.env.BMW_MODAL_JOYSTICK?'joystick':'GPU touch'):'PNG touch'));return;
    }
    if(process.env.BMW_HDD_DIALOG_TEST){
      const settle=()=>new Promise(r=>setTimeout(r,100));await hddFixture.ready;await settle();
      assert(texts.includes('HDD ОБНАРУЖЕН'),warnings.join('\n'));assert.equal(hddFixture.hddState.accepted,false);
      if(wire){wire.ack();assert(wire.d.pageTargets.some(t=>t.key==='hdd-transfer-start'));assert(!wire.d.pageTargets.some(t=>t.key.indexOf('nav-')===0));}
      tapHandler(100,460);await settle();assert.equal(hddFixture.notice.kind,'found','left tiles cannot bypass dialog');
      tapHandler(1000,420);await settle();assert.equal(hddFixture.notice,null);assert(!hddFixture.hddState.accepted);
      hddFixture.hddDeferred=false;await hddFixture.prepareStorage();await settle();assert.equal(hddFixture.notice.kind,'found');
      tapHandler(550,420);await hddFixture.ready;await settle();assert.equal(hddFixture.notice.kind,'success');assert(texts.includes('HDD ГОТОВ К РАБОТЕ'));
      tapHandler(800,420);await settle();assert.equal(hddFixture.notice,null);assert(hddFixture.hddState.accepted);
      assert(!warnings.some(w=>/UI_RENDER_FAILED|ReferenceError|TypeError/.test(w)),warnings.join('\n'));hddFixture.close();console.log('PASS actual app HDD dialogs: before transfer, modal input guard, later, start, success and return');return;
    }
    if(process.env.BMW_LANGUAGE_TEST){
      const settle=()=>new Promise(r=>setTimeout(r,60)),l=appRequire('./i18n');
      const save=name=>{if(previewDir)fs.writeFileSync(path.join(previewDir,name+'.png'),lastCanvas.png());};
      assert(texts.includes('SET LANGUAGE'),'First opening presents language dialog');save('01-first-language');
      if(wire){wire.ack();assert(wire.d.pageTargets.some(t=>t.key==='language-en'),'English available to controller');}
      if(wire){let knob=200;wire.ccu(knob);const ring=wire.d._ring(),target=ring.findIndex(t=>t.k==='tgt:language-en');let current=ring.findIndex(t=>t.k===wire.d.focusKey);if(current<0){wire.ccu(++knob);current=0;}knob+=target-current;wire.ccu(knob);assert.equal(wire.d.focusKey,'tgt:language-en');wire.ccu(knob,1);wire.ccu(knob,0);}else tapHandler(1000,270);await settle();
      assert.equal(settings.ui_language,'en');assert.equal(l.language(),'en');save('02-settings-en');
      assert(pageTargets.some(t=>t.key==='settings-language')||wire,'Language button on settings');
      texts.length=0;tapHandler(100,50);await settle();save('03-map-en');
      assert(!texts.includes('SET LANGUAGE'),'Selection not requested again');
      tapHandler(100,459);await settle();tapHandler(1390,352);await settle();save('04-language-switch');
      tapHandler(580,270);await settle();assert.equal(settings.ui_language,'ru');assert.equal(l.language(),'ru');
      tapHandler(1390,352);await settle();tapHandler(1000,270);await settle();
      if(wire){const b=wire.d.pageTargets.find(t=>t.key==='action-BTN_ZOOM');assert(b);wire.tap(b.x+b.w/2,b.y+b.h/2);}else buttons.BTN_ZOOM();await settle();save('05-notifications-en');
      tapHandler(400,101);await settle();save('06-banner-types-en');
      tapHandler(1380,500);await settle();tapHandler(400,132);await settle();save('07-voice-types-en');
      assert(!warnings.some(w=>/UI_RENDER_FAILED|ReferenceError|TypeError/.test(w)),warnings.join('\n'));
      console.log('PASS first-run language dialog, persistent selection, switch back, notification lists and controller targets');return;
    }
    if(wire){
      const settle=()=>new Promise(resolve=>setTimeout(resolve,60));
      assert(wire.d.pageTargets.length>5,'wire path has page targets');
      wire.ack();wire.tap(100,160);await settle();
      assert(texts.some(t=>t==='РАДАР'),'wire touch opens RADAR');
      assert.strictEqual(wire.d.focusKey,'tgt:nav-RADAR','Touch transfers controller focus to RADAR');
      wire.tap(100,470);await settle();
      assert(texts.some(t=>t.includes('НАСТРОЙКИ')),'wire touch opens SETTINGS');
      assert.strictEqual(wire.d.focusKey,'tgt:nav-SETTINGS');
      wire.tap(100,50);await settle();
      assert.strictEqual(wire.d.focusKey,'tgt:nav-MAP','Touching MAP clears stale SETTINGS focus');
      let knob=100;wire.ccu(knob);
      const focus=key=>{
        const ring=wire.d._ring(),target=ring.findIndex(p=>p.k==='tgt:'+key);
        assert(target>=0,'wire target '+key);
        let current=ring.findIndex(p=>p.k===wire.d.focusKey);
        if(current<0){wire.ccu(++knob);current=0;}
        knob+=target-current;wire.ccu(knob);
        assert.strictEqual(wire.d.focusKey,'tgt:'+key);
      };
      const press=async key=>{focus(key);wire.ccu(knob,1);wire.ccu(knob,0);await settle();};
      for(const [id,title] of [['MAP','КАРТА КАМЕР'],['RADAR','РАДАР'],['ADD','ДОБАВИТЬ КАМЕРУ'],['MY','МОИ КАМЕРЫ'],['SETTINGS','НАСТРОЙКИ'],['MAP','КАРТА КАМЕР']]){
        texts.length=0;await press('nav-'+id);
        assert(texts.includes(title),'wire joystick opens '+id);
      }
      const order=['nav-MAP','nav-RADAR','nav-ADD','nav-MY','nav-SETTINGS','action-BTN_CAM_PREV','action-BTN_CAM_NEXT','action-BTN_ZOOM','action-BTN_REFRESH'];
      focus(order[0]);
      for(const key of order.slice(1)){wire.ccu(++knob);assert.strictEqual(wire.d.focusKey,'tgt:'+key);}
      for(const key of order.slice(0,-1).reverse()){wire.ccu(--knob);assert.strictEqual(wire.d.focusKey,'tgt:'+key);}
      const scale=()=>texts.filter(t=>t.startsWith('МАСШТАБ ')).slice(-1)[0];
      const beforeScale=scale();await press('action-BTN_ZOOM');assert.notStrictEqual(scale(),beforeScale,'wire joystick activates zoom');
      await press('nav-SETTINGS');await press('settings-close');assert.equal(manualCloses,1,'Joystick activates close via lifecycle bridge');
      console.log('PASS real application + packaged Display + RenderClient: touch and controller wire events');
      return;
    }
    assert(expectedCameras>=50000&&texts.some(t=>t.includes(String(expectedCameras))),'Nationwide database count must be visible');
    const settle=()=>new Promise(resolve=>setTimeout(resolve,40));
    const save=name=>{if(previewDir)fs.writeFileSync(path.join(previewDir,name+'.png'),lastCanvas.png());};
    const scale=()=>texts.filter(t=>t.startsWith('МАСШТАБ ')).slice(-1)[0];
    assert.strictEqual(scale(),'МАСШТАБ 2.5×');
    tapHandler(1068,424);await settle();assert.strictEqual(scale(),'МАСШТАБ 2×','Minus zooms out');
    tapHandler(1068,352);await settle();assert.strictEqual(scale(),'МАСШТАБ 2.5×','Plus zooms in');
    tapHandler(1068,388);await settle();assert.strictEqual(scale(),'МАСШТАБ 2.5×','Gap is not a button');
    for(let i=0;i<10;i++)tapHandler(1068,424);await settle();assert.strictEqual(scale(),'МАСШТАБ 0.55×','Minus clamps at minimum');
    for(let i=0;i<10;i++)tapHandler(1068,352);await settle();assert.strictEqual(scale(),'МАСШТАБ 2.5×','Plus clamps at maximum');
    buttons.BTN_ZOOM();await settle();assert.strictEqual(scale(),'МАСШТАБ 0.55×','Controller keeps cyclic zoom');
    tapHandler(1068,352);await settle();
    tapHandler(100,263);await settle();tapHandler(1068,352);tapHandler(100,50);await settle();assert.strictEqual(scale(),'МАСШТАБ 0.75×','Other views cannot change map zoom');
    const cameraCounter=()=>texts.filter(t=>/^\d+ \/ \d+$/.test(t)).slice(-1)[0];
    const firstCounter=cameraCounter(),cameraCount=Number(firstCounter.split(' / ')[1]);
    tapHandler(1309,246);await settle();assert.strictEqual(cameraCounter(),firstCounter,'Previous clamps at first camera');
    tapHandler(1530,246);await settle();assert.strictEqual(cameraCounter(),'2 / '+cameraCount,'Right arrow selects next camera');
    tapHandler(1309,246);await settle();assert.strictEqual(cameraCounter(),firstCounter,'Left arrow selects previous camera');
    tapHandler(1419,246);await settle();assert.strictEqual(cameraCounter(),firstCounter,'Counter between arrows is not a button');
    for(let i=0;i<cameraCount+2;i++)tapHandler(1530,246);
    await settle();assert.strictEqual(cameraCounter(),cameraCount+' / '+cameraCount,'Next clamps at last camera');
    buttons.BTN_CAM_PREV();await settle();assert.strictEqual(cameraCounter(),(cameraCount-1)+' / '+cameraCount,'Controller shares camera selection');
    for(let i=0;i<cameraCount;i++)tapHandler(1309,246);
    await settle();
    tapHandler(100,263);await settle();tapHandler(1530,246);tapHandler(100,50);await settle();
    assert.strictEqual(cameraCounter(),firstCounter,'Other pages cannot select map cameras');
    save('01-map');
    const installedBeforeFailure=activeStore.current;
    const dateBeforeFailure=texts.filter(t=>t.startsWith('ДАТА БАЗЫ:')).slice(-1)[0];
    for(const [failure,title] of [
      ['getaddrinfo ENOTFOUND github.com','НЕТ СВЯЗИ С СЕРВЕРОМ'],
      ['CAMERA_DB_TIMEOUT','НЕТ СВЯЗИ С СЕРВЕРОМ'],
      ['CAMERA_DB_HTTP_503','СЕРВЕР НЕ ВЫДАЛ ОБНОВЛЕНИЕ'],
      ['CAMERA_DB_HASH_MISMATCH','НЕ УДАЛОСЬ ОБНОВИТЬ БАЗУ']
    ]){
      nextRefreshFailure=failure;texts.length=0;buttons.BTN_REFRESH();
      await activeStore.pending;await settle();
      assert.strictEqual(activeStore.current,installedBeforeFailure,'Failed download preserves the live catalog');
      assert.strictEqual(texts.filter(t=>t.startsWith('ДАТА БАЗЫ:')).slice(-1)[0],dateBeforeFailure,'Failed download preserves installed date');
      assert(texts.includes(title),'Friendly failure title is rendered');
      assert(texts.includes('ИСПОЛЬЗУЕТСЯ УСТАНОВЛЕННАЯ БАЗА'),'Existing database remains explicitly usable');
      assert(!texts.some(t=>t.includes(failure)),'Technical diagnostic is hidden from the screen');
      if(failure.includes('ENOTFOUND'))save('15-database-offline');
    }
    texts.length=0;buttons.BTN_REFRESH();await activeStore.pending;await settle();
    assert(texts.includes('База обновлена'),'Successful retry replaces the failure');
    assert(!texts.includes('ИСПОЛЬЗУЕТСЯ УСТАНОВЛЕННАЯ БАЗА'),'Retry clears old error details');

    if(previewDir){
      // Settle the first frame after catalog replacement before measuring a pulse.
      loopHandler();await settle();
      while(activeStore.current.region&&activeStore.current.region.pending)await activeStore.current.region.pending.promise;
      loopHandler();await settle();
      const beforePulse=Buffer.from(lastCanvas.d),reads=activeStore.current.readBlocks;
      pulseTime=700;loopHandler();await settle();save('07-map-pulse');
      assert.notDeepStrictEqual(lastCanvas.d,beforePulse,'Selected map marker must animate');
      const afterPulse=Buffer.from(lastCanvas.d);
      for(let y=0;y<520;y++)for(let x=0;x<1600;x++)if(x<266||x>=1116||y<114||y>=472){const i=(y*1600+x)*4;assert(afterPulse.subarray(i,i+4).equals(beforePulse.subarray(i,i+4)),'Pulse must stay inside the map');}
      assert.strictEqual(activeStore.current.readBlocks,reads,'Pulse frames must not reread database blocks');
      pulseTime=0;loopHandler();await settle();
    }
    if(previewDir){
      const alertCanvas=new Canvas(1600,520);alertCanvas.d.set(lastCanvas.d);
      const alertSurface=native?new native.Recorder(1600,520):alertCanvas;
      appRequire('./central-alert').drawCentralAlert(alertSurface,{camera:{mapcamTypeCode:1,camera_model:'СТРЕЛКА',limit:60},distanceM:500,speedKmh:81,type:'speeding'},81,{x:282,y:92,w:1282});
      if(native)native.play(alertSurface.words(),alertCanvas);
      for(let row=0;row<520;row++)assert.deepStrictEqual(alertCanvas.d.subarray(row*1600*4,(row*1600+266)*4),lastCanvas.d.subarray(row*1600*4,(row*1600+266)*4),'Warning must not cover sidebar');
      fs.writeFileSync(path.join(previewDir,'06-warning-example.png'),alertCanvas.png());
    }
    for(const [y,title,fileName] of [[263,'🛰 GPS: ОЖИДАНИЕ КООРДИНАТ','02-add'],[361,'ПОКА НЕТ СОХРАНЁННЫХ КАМЕР','03-my-cameras'],[459,'ВЫБЕРИТЕ ДИСПЛЕЙ','04-settings']]){
      texts.length=0;tapHandler(100,y);await settle();assert(texts.some(t=>t.includes(title)),'Sidebar opens '+title);save(fileName);
    }
    const staticImages=images;loopHandler();await settle();assert.strictEqual(images,staticImages,'An unchanged settings screen must not redraw on every loop tick');
    tapHandler(980,180);await settle();assert.strictEqual(settings.camera_display,'both','Display tile selects KOMBI + HUD');
    buttons.BTN_ZOOM();await settle();save('05-warning-settings');
    const forceBeforeNotice=settings.audio_force_notifications;
    texts.length=0;settings.audio_force_notifications='on';changeHandler('audio_force_notifications');await settle();
    assert(texts.some(t=>t.includes('Внимание! Включен принудительный режим')),'Notification settings explain the engineering override');save('05-warning-settings-force');
    texts.length=0;settings.audio_force_notifications='off';changeHandler('audio_force_notifications');await settle();
    assert(!texts.some(t=>t.includes('Внимание! Включен принудительный режим')),'Disabled engineering mode must not show an active-mode warning');
    settings.audio_force_notifications=forceBeforeNotice;
    tapHandler(400,100);await settle();save('notification-banner-types');
    assert(texts.some(t=>t.includes('БАННЕР — ТИПЫ ТОЧЕК')));
    if(native)assert(pageTargets.some(t=>t.key==='type-banner-school'),'School checkbox available to joystick');
    tapHandler(1000,366);await settle();assert.strictEqual(settings.notification_banner_type_school,'on');
    tapHandler(1000,366);await settle();assert.strictEqual(settings.notification_banner_type_school,'off');
    tapHandler(1380,500);await settle();
    tapHandler(400,132);await settle();save('notification-voice-types');
    if(native)assert(pageTargets.some(t=>t.key==='type-voice-bump'),'Bump voice checkbox available to joystick');
    tapHandler(1000,400);await settle();assert.strictEqual(settings.notification_voice_type_bump,'on');
    tapHandler(1000,400);await settle();assert.strictEqual(settings.notification_voice_type_bump,'off');
    tapHandler(1380,500);await settle();
    const voiceBefore=settings.mapcam_voice;
    tapHandler(280,140);tapHandler(400,118);await settle();assert.strictEqual(settings.mapcam_voice,voiceBefore,'Padding and row gaps must not change settings');
    tapHandler(400,164);await settle();assert.strictEqual(settings.mapcam_voice,'off','Voice defaults to speeding; next option is off');
    tapHandler(400,196);await settle();assert.strictEqual(settings.notification_beeper,'off','Touch disables beeper independently of voice');
    assert.strictEqual(settings.mapcam_voice,'off');
    tapHandler(400,196);await settle();assert.strictEqual(settings.notification_beeper,'auto');
    assert.strictEqual(settings.notification_volume,'40','Fresh startup selects volume level 2');
    tapHandler(1400,257);await settle();assert.strictEqual(settings.notification_volume,'20','Volume minus selects the first of five levels');
    tapHandler(1500,257);await settle();assert.strictEqual(settings.notification_volume,'40');
    for(let i=0;i<3;i++)tapHandler(1500,257);
    tapHandler(1500,257);assert.strictEqual(settings.notification_volume,'100','Volume maximum clamps');
    for(let i=0;i<11;i++)tapHandler(1400,257);
    assert.strictEqual(settings.notification_volume,'20','Volume minimum clamps at the first of five levels');
    for(let i=0;i<2;i++)tapHandler(1500,257);
    await settle();save('14-volume-settings');
    settings.mapcam_voice='always';
    tapHandler(100,50);await settle();
    texts.length=0;tapHandler(100,20);await settle();assert.strictEqual(texts.length,0,'Area above sidebar does not switch pages');
    buttons.BTN_ZOOM(); // map zoom still works
    // Leave warning settings on the display page for subsequent controller checks.
    tapHandler(100,459);buttons.BTN_ZOOM();tapHandler(100,50);await settle();
    settings.city='yoshkar-ola';changeHandler('city');await new Promise(resolve=>setTimeout(resolve,30));
    settings.city='russia';changeHandler('city');
    // gpsChanged expects a state object; use the actual module's public shape.
    gpsHandler({fix:{lat:55.75,lon:37.62,headingDeg:0,accuracyM:5,speedKmh:36,timeMs:Date.now()},state:'fixed'});
    loopHandler();buttons.BTN_CAM_NEXT();await new Promise(resolve=>setTimeout(resolve,30));
    assert(!warnings.some(w=>/UI_RENDER_FAILED|render:|ReferenceError|TypeError/.test(w)),warnings.join('\n'));
    assert(images>=3,'Switching views and GPS update must still render');
    tapHandler(100,459);
    await new Promise(resolve=>setTimeout(resolve,30));
    buttons.BTN_ZOOM();await new Promise(resolve=>setTimeout(resolve,30));
    assert(texts.some(t=>t.includes('УВЕДОМЛЕНИЯ')));
    texts.length=0;buttons.BTN_REFRESH();await settle();assert(texts.includes('ВЫБЕРИТЕ ДИСПЛЕЙ'),'Button 4 opens displays');assert.strictEqual(settings.mapcam_voice,'always','Opening displays preserves voice settings');buttons.BTN_ZOOM();await settle();tapHandler(400,164);assert.strictEqual(settings.mapcam_voice,'speeding');
    buttons.BTN_CAM_NEXT();tapHandler(400,288);assert.strictEqual(settings.mapcam_excess,'10');
    assert(texts.includes('Авто: база + скорость'),'Automatic distance is visible in settings');
    buttons.BTN_CAM_NEXT();tapHandler(400,319);assert.strictEqual(settings.mapcam_distance,'base');
    tapHandler(400,319);assert.strictEqual(settings.mapcam_distance,'500');
    tapHandler(400,350);assert.strictEqual(settings.auto_monitor,'off');
    tapHandler(400,350);assert.strictEqual(settings.auto_monitor,'on');
    tapHandler(400,381);assert.strictEqual(settings.mapcam_repeat200,'off');tapHandler(400,381);assert.strictEqual(settings.mapcam_repeat200,'on');
    if(native)assert(!pageTargets.some(t=>/warning-setting-(central_notifications|radar_no_duplicate)/.test(t.key)),'Removed preferences have no joystick targets');
    tapHandler(400,226);await settle();assert.equal(audioDiagnostic.screen,'beeper-sounds');save('beeper-sounds-list');
    tapHandler(1100,270);await settle();assert.equal(audioDiagnostic.beeperPanel.id,'7');assert(!audioDiagnostic.savedSound);
    tapHandler(900,454);await settle();assert.equal(audioDiagnostic.savedSound,'7');save('beeper-sounds-saved');
    tapHandler(1350,454);await settle();assert(texts.includes('УВЕДОМЛЕНИЯ'));save('beeper-notification-settings');
    tapHandler(1020,34);await settle();assert.equal(audioDiagnostic.screen,'mixer');assert.equal(audioRequests.slice(-1)[0].action,'audio-mixer-get');
    tapHandler(1400,454);await settle();assert(texts.includes('УВЕДОМЛЕНИЯ'),'Mixer Back returns to notification settings');
    gpsHandler({state:'lost',fix:null});loopHandler();
    await new Promise(resolve=>setTimeout(resolve,30));
    assert(!warnings.some(w=>/UI_RENDER_FAILED|render:|ReferenceError|TypeError/.test(w)),warnings.join('\n'));
    tapHandler(100,50);await settle();texts.length=0;
    for(let i=0;i<9;i++)tapHandler(100,459);
    await settle();assert(!texts.includes('ИНЖЕНЕРНОЕ МЕНЮ'),'Nine settings taps must not unlock engineering');
    texts.length=0;tapHandler(100,459);await settle();assert(texts.includes('ИНЖЕНЕРНОЕ МЕНЮ'),'Tenth settings tap opens engineering');save('08-engineering');
    const settingsBefore=JSON.stringify(settings),voiceBeforeEngineering=voiceTests;
    buttons.BTN_CAM_NEXT();buttons.BTN_ZOOM();buttons.BTN_REFRESH();await settle();
    assert.strictEqual(JSON.stringify(settings),settingsBefore,'Unused engineering keys must not change user settings');
    tapHandler(500,397);await settle();assert.strictEqual(voiceTests,voiceBeforeEngineering+1,'Engineering test button uses the existing output test');
    texts.length=0;tapHandler(1200,397);await settle();assert(!texts.includes('ИНЖЕНЕРНОЕ МЕНЮ'),'Back button exits engineering');
    tapHandler(100,50);texts.length=0;
    for(let i=0;i<9;i++)tapHandler(100,459);
    await settle();assert(!texts.includes('ИНЖЕНЕРНОЕ МЕНЮ'),'Leaving resets unlock sequence');
    await new Promise(resolve=>setTimeout(resolve,3100));texts.length=0;tapHandler(100,459);await settle();
    assert(!texts.includes('ИНЖЕНЕРНОЕ МЕНЮ'),'A pause over three seconds resets unlock sequence');
    texts.length=0;for(let i=0;i<9;i++)tapHandler(100,459);await settle();
    assert(texts.includes('ИНЖЕНЕРНОЕ МЕНЮ'));texts.length=0;buttons.BTN_CAM_PREV();await settle();
    assert(!texts.includes('ИНЖЕНЕРНОЕ МЕНЮ'),'Controller back exits engineering');
    assert(!warnings.some(w=>/UI_RENDER_FAILED|render:|ReferenceError|TypeError/.test(w)),warnings.join('\n'));
    texts.length=0;tapHandler(100,165);await settle();
    assert(texts.includes('РАДАР')&&texts.includes('🛰 GPS: НЕТ СИГНАЛА'),'Radar waits for GPS instead of using a map default');save('09-radar-no-gps');
    for(const [lat,lon] of [[55.75,37.62],[56.63,47.928]]){
      const radarFix={lat,lon,headingDeg:0,accuracyM:5,speedKmh:81,timeMs:Date.now()};
      const previous=Object.assign({},radarFix,{lat:lat-20/111320,timeMs:radarFix.timeMs-1000});
      const nearby=activeStore.current.nearWarnings(radarFix);
      const {MapcamWarnings}=appRequire('./mapcam-warnings');
      const detector=new MapcamWarnings({distanceM:Number(settings.mapcam_distance)||0,excessKmh:Number(settings.mapcam_excess)||0});
      detector.update(previous,nearby,radarFix.timeMs);detector.update(radarFix,nearby,radarFix.timeMs);
      const active=Object.values(detector.states).sort((a,b)=>a.distanceM-b.distanceM)[0];
      const expected=appRequire('./notification-session').selectRadar(active,nearby,radarFix,0,null);
      changeHandler('mapcam_distance');texts.length=0;gpsHandler({fix:previous,state:'fix'});gpsHandler({fix:radarFix,state:'fix'});await settle();
      if(expected){
       const d=expected.distanceM,label=appRequire('./camera-label').hudLabels(expected.camera);
       assert(texts.some(t=>/^\d+ М$/.test(t)&&Math.abs(parseInt(t,10)-d)<20)&&texts.includes(label.control),'Radar displays the same eligible camera, with a bounded presentation correction: '+d+' / '+texts.join('|'));
      }else assert(texts.includes('ВПЕРЕДИ НЕТ КАМЕР'));
      const catalog=activeStore.current,originalNear=catalog.nearWarnings;let redrawQueries=0;
      catalog.nearWarnings=function(...args){redrawQueries++;return originalNear.apply(this,args);};
      loopHandler();await settle();catalog.nearWarnings=originalNear;
      assert.strictEqual(redrawQueries,0,'Radar redraw must reuse GPS selection while background loading continues');
      if(lat===56.63)save('10-radar-camera');
    }
    texts.length=0;gpsHandler({fix:{lat:0,lon:0,accuracyM:5,speedKmh:0,timeMs:Date.now()},state:'fix'});await settle();
    assert(texts.includes('ОЖИДАНИЕ ДВИЖЕНИЯ'),'Radar does not invent a travel direction at rest');save('11-radar-empty');
    texts.length=0;gpsHandler({fix:{lat:55.75,lon:37.62,accuracyM:5,speedKmh:0,timeMs:Date.now()-4000},state:'fix'});await settle();
    assert(texts.includes('🛰 GPS: НЕТ СИГНАЛА'),'Radar rejects stale GPS');
    texts.length=0;gpsHandler({fix:{lat:55.75,lon:37.62,accuracyM:25,speedKmh:60,timeMs:Date.now()},state:'fix'});await settle();assert(texts.includes('🛰 GPS: ТОЧНОСТЬ СНИЖЕНА'));save('13-radar-poor-gps');
    texts.length=0;buttons.BTN_CAMERA_MENU();await settle();assert(texts.includes('ДОБАВИТЬ КАМЕРУ'),'Controller cycles past Radar to Add');
    assert(!warnings.some(w=>/UI_RENDER_FAILED|render:|ReferenceError|TypeError/.test(w)),warnings.join('\n'));
    const sample=activeStore.current.near({lat:55.75,lon:37.62},25000,500).find(c=>c.source==='еСтрелка'&&c.camera_family==='fixed'&&!c.averageControl&&c.mapcamDirectionType===1&&Number.isFinite(c.mapcamApproachHeadingDeg)&&c.mapcamWarningDistanceM>=300);
    assert(sample,'Real directional camera required for central notification regression');
    settings.mapcam_voice='always';settings.mapcam_distance='2000';changeHandler('mapcam_voice');
    tapHandler(100,165);await settle();
    gpsHandler({state:'lost',fix:null}); // Independent scenario, not a teleport during accuracy recovery.
    const centralBefore=centralWarnings,voiceDispatchBefore=voiceWarnings,clusterBefore=clusterWarnings,now=Date.now();
    const heading=sample.mapcamApproachHeadingDeg*Math.PI/180;
    const approach=(d,t)=>({lat:sample.lat-Math.cos(heading)*d/111320,lon:sample.lon-Math.sin(heading)*d/(111320*Math.cos(sample.lat*Math.PI/180)),accuracyM:5,speedKmh:100,headingDeg:sample.mapcamApproachHeadingDeg,timeMs:t});
    gpsHandler({fix:approach(220,now-1000),state:'fix'});gpsHandler({fix:approach(200,now),state:'fix'});await settle();
    assert(voiceWarnings>voiceDispatchBefore&&clusterWarnings>clusterBefore,'Radar must retain voice and HUD/KOMBI warning dispatch');
    assert.strictEqual(centralWarnings,centralBefore,'Visible Radar must suppress the central camera overlay');save('12-radar-active-warning');
    tapHandler(100,50);await settle();assert(centralWarnings>centralBefore,'Returning to Map restores a still-active central warning');
    visibleHandler('MAIN',false);const hiddenCount=centralWarnings;loopHandler();await settle();
    assert.strictEqual(centralWarnings,hiddenCount,'Hidden app screen must not render a central banner');
    assert(!systemPopupCalls.includes('open'),'Hidden app must not request the map-only banner');
    visibleHandler('MAIN',true);await settle();assert(centralWarnings>hiddenCount,'Visibility restoration must not leave central warnings disabled');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(lastCentralBounds)),{x:266,y:74,w:850},'Banner matches map bounds');
    for(const y of [260,365,465]){const count=centralWarnings;tapHandler(100,y);await settle();assert.equal(centralWarnings,count,'Other tabs must not show the central banner');}
    tapHandler(100,50);await settle();
    const restoredCount=centralWarnings;tapHandler(100,165);await settle();assert.strictEqual(centralWarnings,restoredCount,'Switching back to Radar hides an existing banner');
    const opens=systemPopupCalls.filter(x=>x==='open').length;
    visibleHandler('MAIN',false);await settle();
    assert(systemPopupCalls.filter(x=>x==='open').length===opens,'Hidden Radar must not request the map-only banner');
    settings.central_notifications='off';changeHandler('central_notifications');await settle();
    assert(!systemPopupCalls.includes('open'),'Legacy settings cannot enable background banner');
    visibleHandler('MAIN',true);settings.central_notifications='always';changeHandler('central_notifications');await settle();
    settings.radar_no_duplicate='off';changeHandler('radar_no_duplicate');await settle();assert.strictEqual(centralWarnings,restoredCount,'Radar never duplicates even with legacy preference off');
    settings.radar_no_duplicate='on';changeHandler('radar_no_duplicate');
    assert(!warnings.some(w=>/UI_RENDER_FAILED|render:|ReferenceError|TypeError/.test(w)),warnings.join('\n'));
    if(native){
      gpsHandler({state:'lost',fix:null});tapHandler(100,50);await settle();
      const {Display}=appRequire('./kit/display');
      const controller=Object.create(Display.prototype);let knob=0;
      Object.assign(controller,{pageTargets,ccuLast:null,focusKey:null,sheet:null,place:{scale:1,ox:0,oy:0,x:0,y:0,w:1600,h:520},log:{info:()=>{},error:e=>{throw e;}},_repaint:()=>{},_tabList:()=>({tabs:[],sel:-1,settings:-1}),buttons:()=>[]});
      assert(appRequire('./controller-navigation').install(controller));
      const input=(pb=0,df=0)=>controller._ccu({frontRotaryEncoderOperation:knob,frontRotaryEncoderPushButton:pb,frontRotaryEncoderDeflection:df});
      const focus=key=>{controller.pageTargets=pageTargets;const ring=controller._ring(),target=ring.findIndex(p=>p.k==='tgt:'+key);assert(target>=0,'Joystick target '+key);let current=ring.findIndex(p=>p.k===controller.focusKey);if(current<0){knob++;input();current=0;}knob+=target-current;input();assert.strictEqual(controller.focusKey,'tgt:'+key);};
      const press=async key=>{focus(key);input(1);input(0);await settle();};
      input();
      for(const id of ['MAP','RADAR','ADD','MY','SETTINGS'])assert(pageTargets.some(t=>t.key==='nav-'+id));
      for(const id of ['BTN_CAM_PREV','BTN_CAM_NEXT','BTN_ZOOM','BTN_REFRESH'])assert(pageTargets.some(t=>t.key==='action-'+id));
      for(const [id,title] of [['RADAR','РАДАР'],['ADD','ДОБАВИТЬ КАМЕРУ'],['MY','МОИ КАМЕРЫ'],['SETTINGS','НАСТРОЙКИ'],['MAP','КАРТА КАМЕР']]){texts.length=0;await press('nav-'+id);assert(texts.includes(title)||(id==='SETTINGS'&&texts.includes('УВЕДОМЛЕНИЯ')),'Knob + press opens '+id);}
      const beforeCounter=cameraCounter();await press('action-BTN_CAM_NEXT');assert.notStrictEqual(cameraCounter(),beforeCounter);
      await press('action-BTN_CAM_PREV');assert.strictEqual(cameraCounter(),beforeCounter);
      const beforeScale=scale();await press('action-BTN_ZOOM');assert.notStrictEqual(scale(),beforeScale);
      await press('action-BTN_REFRESH');await activeStore.pending;
      assert(!pageTargets.some(t=>['action-BTN_VOICE_TEST','action-BTN_CAMERA_MENU'].includes(t.key)),'Map must have no focusable buttons 5 or 6');
      assert.strictEqual(nativeButtonState.BTN_VOICE_TEST,false);assert.strictEqual(nativeButtonState.BTN_CAMERA_MENU,false);
      const voiceCount=voiceTests;buttons.BTN_VOICE_TEST();buttons.BTN_CAMERA_MENU();await settle();
      assert.strictEqual(voiceTests,voiceCount,'Hidden map test action must not run');assert(pageTargets.some(t=>t.key==='action-BTN_CAM_PREV'),'Hidden section action must not leave Map');
      const navigationOrder=['nav-MAP','nav-RADAR','nav-ADD','nav-MY','nav-SETTINGS','action-BTN_CAM_PREV','action-BTN_CAM_NEXT','action-BTN_ZOOM','action-BTN_REFRESH'];
      const selectionBeforeNavigation=cameraCounter();
      focus(navigationOrder[0]);
      for(const key of navigationOrder.slice(1)){knob++;input();assert.strictEqual(controller.focusKey,'tgt:'+key,'Clockwise order');}
      for(const key of navigationOrder.slice(0,-1).reverse()){knob--;input();assert.strictEqual(controller.focusKey,'tgt:'+key,'Counterclockwise order');}
      for(const key of navigationOrder.slice(1)){input(0,7);assert.strictEqual(controller.focusKey,'tgt:'+key,'Down tilt follows sidebar then numbered actions');input();}
      for(const key of navigationOrder.slice(0,-1).reverse()){input(0,1);assert.strictEqual(controller.focusKey,'tgt:'+key,'Up tilt follows numbered actions then sidebar');input();}
      assert.strictEqual(cameraCounter(),selectionBeforeNavigation,'Moving focus must not activate camera selection');
      focus('nav-MAP');input(0,7);assert.strictEqual(controller.focusKey,'tgt:nav-RADAR','Tilt down moves among sidebar tiles');input();
      focus('nav-SETTINGS');input(0,4);assert.strictEqual(controller.focusKey,'tgt:action-BTN_CAM_PREV','Tilt right reaches action row');input();
      input(0,10);assert.strictEqual(controller.focusKey,'tgt:nav-SETTINGS','Tilt left returns to sidebar');input();
      texts.length=0;for(let i=0;i<10;i++)await press('nav-SETTINGS');assert(texts.includes('ИНЖЕНЕРНОЕ МЕНЮ'),'Ten joystick presses also unlock engineering');
      for(const id of ['BTN_CAM_PREV','BTN_CAM_NEXT','BTN_ZOOM','BTN_REFRESH','BTN_VOICE_TEST','BTN_CAMERA_MENU'])assert.strictEqual(nativeButtonState[id],false,'Engineering hides native numbered button '+id);
      assert(!pageTargets.some(t=>t.key.startsWith('action-')),'Engineering has no numbered action targets');
      focus('nav-SETTINGS');
      for(const key of ['engineering-test','engineering-back']){knob++;input();assert.strictEqual(controller.focusKey,'tgt:'+key,'Engineering rotation order');}
      for(const key of ['engineering-test','nav-SETTINGS']){knob--;input();assert.strictEqual(controller.focusKey,'tgt:'+key,'Engineering reverse rotation');}
      for(const key of ['engineering-test','engineering-back']){input(0,7);assert.strictEqual(controller.focusKey,'tgt:'+key,'Engineering downward navigation');input();}
      for(const key of ['engineering-test','nav-SETTINGS']){input(0,1);assert.strictEqual(controller.focusKey,'tgt:'+key,'Engineering upward navigation');input();}
      assert(!pageTargets.some(t=>t.key==='engineering-overlay'),'Separate Overlay entry removed');
      await press('motion-diagnostics');assert(texts.includes('GPS / СКОРОСТЬ'),'Joystick opens the motion diagnostics page');
      await press('motion-back');assert(texts.includes('ИНЖЕНЕРНОЕ МЕНЮ'),'Joystick returns from motion diagnostics');
      await press('engineering-back');await press('settings-hud-position');assert(texts.includes('ПОЛОЖЕНИЕ HUD'));
      const hudKeys=['hud-left','hud-right','hud-up','hud-down','hud-test','hud-stripe','hud-full','hud-short','hud-save','hud-reset','hud-back'];
      for(const key of hudKeys)assert(pageTargets.some(t=>t.key===key),'Focusable HUD control: '+key);
      focus('hud-left');for(const key of hudKeys.slice(1)){input(0,7);assert.equal(controller.focusKey,'tgt:'+key);input();}
      for(const key of hudKeys.slice(0,-1).reverse()){input(0,1);assert.equal(controller.focusKey,'tgt:'+key);input();}
      await press('hud-right');await press('hud-right');await press('hud-down');await press('hud-test');assert.equal(clusterFixture.current.camera.id,'hud-position-test');backgroundTick();motionTick();assert.equal(clusterFixture.current.camera.id,'hud-position-test','GPS loss/background timers must not erase the HUD position test');save('hud-position-adjusted');
      await press('hud-stripe');assert.equal(clusterFixture.position.stripe,false,'Joystick hides stripe in active test');
      await press('hud-save');assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(tmp,'hud-position.json'),'utf8')).hud,{x:200,y:187,stripe:false,banner:'full'});
      await press('hud-back');await press('settings-hud-position');assert(texts.includes('ГОРИЗОНТАЛЬ: 10 / ВЕРТИКАЛЬ: 5'));
      await press('hud-reset');await press('hud-save');save('hud-position-default');await press('hud-back');
      for(let i=0;i<10;i++)await press('nav-SETTINGS');
      await press('engineering-audio');assert(texts.includes('ПРОВЕРКА АУДИОКАНАЛОВ'));save('audio-channels-empty');
      assert(!pageTargets.some(t=>t.key.startsWith('action-')),'Audio page hides native actions');
      assert.deepStrictEqual(pageTargets.filter(t=>t.key.startsWith('audio-')).map(t=>t.key),['audio-overlay','audio-force-notifications','audio-converter','audio-alsa','audio-file','audio-pulse','audio-converter-hold','audio-converter-reset','audio-converter-period','audio-report-phone','audio-back','audio-mixer']);
      await press('audio-mixer');assert.equal(audioDiagnostic.screen,'mixer');save('mixer-default');
      for(const key of ['mixer-voice-down','mixer-voice-up','mixer-beeper-down','mixer-beeper-up','mixer-duck-down','mixer-duck-up','mixer-music-duck','mixer-listen','mixer-save','mixer-reset','mixer-back'])assert(pageTargets.some(t=>t.key===key),'Joystick '+key);
      await press('mixer-voice-down');await press('mixer-beeper-down');await press('mixer-duck-up');await press('mixer-music-duck');assert.equal(audioDiagnostic.mixerPanel.values.musicDuck,false);save('mixer-draft');
      assert.equal(audioDiagnostic.savedMix.voice,100);await press('mixer-listen');assert.equal(audioRequests.slice(-1)[0].action,'audio-mixer-listen');
      await press('mixer-save');assert.equal(audioDiagnostic.savedMix.voice,80);save('mixer-saved');await press('mixer-reset');assert.equal(audioDiagnostic.savedMix.voice,80);
      await press('mixer-back');assert.equal(audioDiagnostic.screen,'channels');
      focus('audio-file');
      for(const key of ['audio-pulse','audio-converter-hold','audio-converter-reset','audio-converter-period','audio-report-phone','audio-back']){knob++;input();assert.equal(controller.focusKey,'tgt:'+key);}
      for(const key of ['audio-report-phone','audio-converter-period','audio-converter-reset','audio-converter-hold','audio-pulse','audio-file']){knob--;input();assert.equal(controller.focusKey,'tgt:'+key);}
      save('converter-profiles');
      const savedRoute=audioDiagnostic.backend;await press('audio-force-notifications');assert.equal(settings.audio_force_notifications,'on');assert.equal(audioDiagnostic.backend,savedRoute);save('audio-always');await press('audio-force-notifications');assert.equal(settings.audio_force_notifications,'off');
      focus('audio-overlay');knob++;input();assert.equal(controller.focusKey,'tgt:audio-force-notifications');knob++;input();assert.equal(controller.focusKey,'tgt:audio-converter');
      await press('audio-overlay');assert(audioDiagnostic.overlay);save('audio-overlay-enabled');
      await press('audio-overlay');assert(!audioDiagnostic.overlay);
      const simpleStart=audioRequests.length;
      for(const pair of [['audio-converter','converter'],['audio-alsa','alsa'],['audio-file','file']]){
       await press(pair[0]);await new Promise(resolve=>setImmediate(resolve));
       assert.equal(audioRequests.slice(-1)[0].backend,pair[1]);assert.equal(audioRequests.slice(-1)[0].kind,'both');
      }
      assert(!audioRequests.slice(simpleStart).some(r=>/save|reset/.test(r.action)));
      focus('audio-converter');knob++;input();assert.equal(controller.focusKey,'tgt:audio-alsa');
      knob++;input();assert.equal(controller.focusKey,'tgt:audio-file');
      knob--;input();assert.equal(controller.focusKey,'tgt:audio-alsa');
      save('audio-channels-simulated');
      await press('audio-save');assert(audioDiagnostic.confirming);save('audio-save-confirm');
      focus('audio-cancel');knob++;input();assert.equal(controller.focusKey,'tgt:audio-confirm');
      await press('audio-cancel');assert(!audioDiagnostic.confirming);
      await press('audio-save');await press('audio-confirm');await new Promise(resolve=>setImmediate(resolve));
      assert.equal(audioRequests.slice(-1)[0].action,'audio-save');assert.equal(audioRequests.slice(-1)[0].backend,'file');assert(!audioDiagnostic.confirmable);save('audio-mode-saved');
      await press('audio-overlay');
      for(const backend of ['converter','alsa','file']){
       await press('audio-'+backend);await new Promise(resolve=>setImmediate(resolve));assert(audioDiagnostic.confirmable);
       await press('audio-save');save('audio-overlay-'+backend+'-confirm');
       focus('audio-cancel');knob++;input();assert.equal(controller.focusKey,'tgt:audio-confirm');
       await press('audio-confirm');await new Promise(resolve=>setImmediate(resolve));
       assert(audioDiagnostic.message.includes('сохранён'));assert(audioRequests.slice(-1)[0].overlay);assert.equal(audioRequests.slice(-1)[0].backend,backend);save('audio-overlay-'+backend+'-saved');
      }
      for(const backend of ['converter-hold','converter-reset','converter-period','pulse']){
       await press('audio-'+backend);await new Promise(resolve=>setImmediate(resolve));assert(audioDiagnostic.confirmable&&audioDiagnostic.overlay);
       await press('audio-save');assert(audioDiagnostic.confirming);await press('audio-confirm');await new Promise(resolve=>setImmediate(resolve));
       assert.equal(audioRequests.slice(-1)[0].backend,backend);assert(audioRequests.slice(-1)[0].overlay);save(backend+'-saved');
      }
      await press('audio-back');assert(texts.includes('ИНЖЕНЕРНОЕ МЕНЮ'));
      assert(!pageTargets.some(t=>['engineering-carplay-duck','engineering-audio-wizard'].includes(t.key)));
      assert(pageTargets.some(t=>t.key==='engineering-displays'));save('engineering-current');
      const engineeringVoiceCount=voiceTests;
      await press('engineering-test');assert.strictEqual(voiceTests,engineeringVoiceCount+1,'Joystick activates engineering output test');
      texts.length=0;await press('engineering-back');assert(!texts.includes('ИНЖЕНЕРНОЕ МЕНЮ'),'Joystick back exits engineering');
      assert.strictEqual(nativeButtonState.BTN_CAM_PREV,true,'Settings actions restore on leaving engineering');
      await press('action-BTN_REFRESH');assert(!pageTargets.some(t=>t.key==='warning-setting-auto_monitor'),'Joystick button 4 opens displays');await press('action-BTN_ZOOM');assert(pageTargets.some(t=>t.key==='warning-setting-auto_monitor'),'Joystick button 3 opens notifications');
      const volumeBefore=Number(settings.notification_volume);
      await press('volume-down');assert.strictEqual(Number(settings.notification_volume),volumeBefore-20,'Joystick decreases volume');
      await press('volume-up');assert.strictEqual(Number(settings.notification_volume),volumeBefore,'Joystick increases volume');
      for(const key of ['auto_monitor','notification_beeper']){
        const before=settings[key];await press('warning-setting-'+key);
        assert.notStrictEqual(settings[key],before,'Joystick changes '+key);
        if(key==='notification_beeper')await press('warning-setting-'+key);
      }
      for(const entry of native.atlasList){assert(entry.f.atlasW<=1024,'MGU atlas width limit');assert(entry.f.atlasH<=4096,'MGU atlas height limit');}
    }
    // Both police categories reach Radar and Map; the hidden app has no central popup.
    const oldNear=activeStore.current.near,oldNearWarnings=activeStore.current.nearWarnings;
    for(const [kind,fields] of [['post',{typeNamespace:'estrelka',typeCode:206}],['stationary',{typeNamespace:'mapcam',typeCode:20,mapcamTypeCode:20}]]){
      const police=Object.assign({},sample,fields,{id:'dps-integration-'+kind,camera_model:null,camera_family:'road_warning',mapcamPath:[],averageControl:false,limit:20,warningEnabled:true,mapcamApproachHeadingDeg:0,mapcamDirectionType:0,mapcamAngleDeg:60,mapcamTravel:[]});
      activeStore.current.near=()=>[police];activeStore.current.nearWarnings=()=>[police];
      gpsHandler({state:'lost',fix:null});settings.auto_monitor='on';settings.central_notifications='always';settings.radar_no_duplicate='on';settings.mapcam_distance='2000';changeHandler('mapcam_distance');
      tapHandler(100,165);await settle();texts.length=0;
      const time=Date.now(),dpsFix=(d,t)=>({lat:police.lat-d/111320,lon:police.lon,accuracyM:5,speedKmh:100,headingDeg:0,timeMs:t});
      const clusterCount=clusterWarnings,bannerCount=centralWarnings;
      gpsHandler({fix:dpsFix(320,time-1000),state:'fix'});gpsHandler({fix:dpsFix(300,time),state:'fix'});await settle();
      assert(texts.includes('ПОСТ ДПС')&&texts.includes('ДО ПОСТА'),'DPS Radar labels');
      assert(!texts.includes('МОДЕЛЬ НЕ УКАЗАНА')&&!texts.includes('ЛИМИТ'),'Police must not look like an unidentified speed camera');
      if(kind==='stationary')assert(texts.includes('СТАЦИОНАРНЫЙ'));
      assert(clusterWarnings>clusterCount,'Police events dispatch to configured cluster/HUD output');
      assert.strictEqual(centralWarnings,bannerCount,'Radar suppresses duplicate DPS banner');save('dps-'+kind+'-radar');
      tapHandler(100,50);await settle();assert(centralWarnings>bannerCount,'DPS central banner when leaving Radar');save('dps-'+kind+'-map-banner');
      const opened=systemPopupCalls.filter(x=>x==='open').length;
      visibleHandler('MAIN',false);await settle();assert(systemPopupCalls.filter(x=>x==='open').length===opened,'No DPS popup with app hidden');
      visibleHandler('MAIN',true);await settle();
    }
    // A nearer police post must not steal any visual destination from speed control.
    const speedPoint=Object.assign({},sample,{id:'priority-speed',lat:55,lon:37,typeNamespace:'mapcam',typeCode:1,mapcamTypeCode:1,camera_model:'ТЕСТ СКОРОСТИ',camera_family:'fixed',mapcamPath:[],averageControl:false,limit:60,mapcamDirectionType:0,mapcamTravel:[],mapcamAngleDeg:60,warningEnabled:true,mapcamWarningDistanceM:2000});
    const nearPost=Object.assign({},speedPoint,{id:'priority-police',lat:55-400/111320,typeCode:20,mapcamTypeCode:20,camera_model:null,camera_family:'road_warning',limit:null});
    activeStore.current.near=()=>[nearPost,speedPoint];activeStore.current.nearWarnings=()=>[nearPost,speedPoint];
    gpsHandler({state:'lost',fix:null});tapHandler(100,165);await settle();texts.length=0;
    const priorityTime=Date.now(),priorityFix=(d,t)=>({lat:55-d/111320,lon:37,accuracyM:5,speedKmh:70,headingDeg:0,timeMs:t});
    gpsHandler({fix:priorityFix(520,priorityTime-1000),state:'fix'});gpsHandler({fix:priorityFix(500,priorityTime),state:'fix'});await settle();
    assert(texts.includes('ТЕСТ СКОРОСТИ')&&!texts.includes('ПОСТ ДПС'),'Radar prefers speed control at 500m over police at 100m');
    assert.strictEqual(lastClusterCamera,'priority-speed','HUD/KOMBI dispatch the speed camera');save('speed-priority');
    tapHandler(100,50);await settle();assert.strictEqual(lastCentralCamera,'priority-speed','Central banner uses the same priority');
    visibleHandler('MAIN',false);await settle();assert(!systemPopupCalls.includes('paint:priority-speed'),'No background banner; HUD and voice retain speed priority');
    gpsHandler({fix:Object.assign(priorityFix(450,Date.now()),{speedKmh:81}),state:'fix'});await settle();backgroundTick();
    assert(beeperState&&beeperState.cameraId==='priority-speed','Beeper works with the central app hidden');
    assert.strictEqual(beeperState.intervalMs,1100,'450 m uses the new 50 m cadence step');
    const activeBeforeMute=beeperState.cameraId,forceBeforeMute=settings.audio_force_notifications;
    settings.notification_beeper='off';settings.audio_force_notifications='off';changeHandler('notification_beeper');
    assert.strictEqual(beeperState,null,'Beeper off stops an active lease in normal mode');
    backgroundTick();assert.strictEqual(beeperState,null,'Background tick respects saved off');
    settings.audio_force_notifications='on';changeHandler('audio_force_notifications');backgroundTick();
    assert(beeperState&&beeperState.cameraId===activeBeforeMute,'Engineering always overrides saved beeper off');
    settings.audio_force_notifications='off';changeHandler('audio_force_notifications');backgroundTick();
    assert.strictEqual(beeperState,null,'Disabling engineering mode restores saved beeper off');
    assert.strictEqual(settings.notification_beeper,'off','Engineering override does not overwrite preference');
    settings.notification_beeper='auto';changeHandler('notification_beeper');
    assert(beeperState&&beeperState.cameraId===activeBeforeMute,'Auto resumes the current eligible camera');
    settings.audio_force_notifications=forceBeforeMute;
    gpsHandler({fix:Object.assign(priorityFix(440,Date.now()),{speedKmh:80}),state:'fix'});await settle();backgroundTick();
    assert.strictEqual(beeperState,null,'Beeper stops at exactly +20');
    gpsHandler({fix:Object.assign(priorityFix(430,Date.now()),{speedKmh:81}),state:'fix'});await settle();backgroundTick();assert(beeperState);
    const approachVoiceCount=voiceWarnings,confirmedId=beeperState.cameraId;
    gpsHandler({fix:Object.assign(priorityFix(420,Date.now()),{speedKmh:81,accuracyM:23}),state:'fix'});await settle();backgroundTick();
    assert(beeperState&&beeperState.cameraId===confirmedId,'Moderate accuracy retains the confirmed camera in the real app');
    assert.equal(lastGpsOutput,'degraded');assert.equal(voiceWarnings,approachVoiceCount,'Accuracy degradation does not replay initial speech');
    gpsHandler({fix:Object.assign(priorityFix(410,Date.now()),{speedKmh:81,accuracyM:60}),state:'fix'});await settle();backgroundTick();
    assert.equal(beeperState,null,'Severe uncertainty suspends audio');assert.equal(lastGpsOutput,'unreliable');
    gpsHandler({state:'lost',fix:null});
    const moderateTime=Date.now(),voiceBeforeModerate=voiceWarnings;
    const moderatePoint=Object.assign({},speedPoint,{id:'moderate-new-camera'});
    activeStore.current.near=()=>[moderatePoint];activeStore.current.nearWarnings=()=>[moderatePoint];
    gpsHandler({fix:Object.assign(priorityFix(520,moderateTime-1000),{speedKmh:81,accuracyM:35}),state:'fix'});
    gpsHandler({fix:Object.assign(priorityFix(500,moderateTime),{speedKmh:81,accuracyM:35}),state:'fix'});await settle();backgroundTick();
    assert(beeperState&&beeperState.cameraId==='moderate-new-camera','Acquire a new warning at 35 m without a precise anchor');
    assert(voiceWarnings>voiceBeforeModerate,'Normal speech works for a newly acquired moderate-accuracy camera');
    assert(clusterFixture.current.accuracyDegraded,'Pass accuracy flag to HUD/KOMBI');
    visibleHandler('MAIN',true);tapHandler(100,165);await settle();
    assert(texts.includes('🛰 GPS: ТОЧНОСТЬ СНИЖЕНА'),'Radar shows the small accuracy note');save('gps-moderate-radar');
    tapHandler(100,50);await settle();save('gps-moderate-map-banner');
    activeStore.current.near=()=>[nearPost,speedPoint];activeStore.current.nearWarnings=()=>[nearPost,speedPoint];
    gpsHandler({state:'lost',fix:null});assert.strictEqual(beeperState,null,'GPS loss stops beeper immediately');assert.strictEqual(lastGpsOutput,'lost','GPS loss without reserve reaches HUD/KOMBI');
    visibleHandler('MAIN',true);await settle();
    // Real presentation estimator + real detector/session, mocked vehicle transport only.
    tapHandler(100,165);motionClock=Date.now();vehicleFixture.accept({speedVehicleCentreOfGravity:81*64});
    gpsHandler({fix:Object.assign(priorityFix(520,motionClock-1000),{speedKmh:81}),state:'fix'});
    gpsHandler({fix:Object.assign(priorityFix(500,motionClock),{speedKmh:81}),state:'fix'});await settle();
    // Central banner shares the presentation clock, not the 1 Hz GPS distance.
    tapHandler(100,50);await settle();const centralStart=lastCentralDistance,voiceBeforeSmooth=voiceWarnings;
    const originalQuery=activeStore.current.nearWarnings;let centralQueries=0;
    activeStore.current.nearWarnings=()=>{centralQueries++;return [nearPost,speedPoint];};
    for(let i=0;i<3;i++){motionClock+=100;vehicleFixture.accept({speedVehicleCentreOfGravity:81*64});motionTick();await settle();assert(lastCentralDistance<centralStart,'Central banner advances between GPS packets');}
    assert(lastCentralDistance<centralStart-5,'Central banner uses integrated vehicle speed');
    assert.equal(centralQueries,0,'Smoothing performs no database queries');assert.equal(voiceWarnings,voiceBeforeSmooth,'Smoothing does not trigger speech');
    activeStore.current.nearWarnings=originalQuery;save('central-smooth-distance');tapHandler(100,165);await settle();
    const voiceAtLoss=voiceWarnings,clusterAtLoss=clusterWarnings;
    let reserveReads=0;activeStore.current.nearWarnings=()=>{reserveReads++;return [nearPost,speedPoint];};
    texts.length=0;gpsHandler({state:'lost',fix:null});motionTick();await settle();
    assert.strictEqual(lastGpsOutput,'reserve','HUD/KOMBI preserve reserve status');assert(texts.includes('🛰 GPS: НЕТ СИГНАЛА / РАСЧЁТ'),'GPS loss must visibly mark estimated distance');save('motion-reserve-radar');
    assert(clusterWarnings>clusterAtLoss,'Already active HUD target continues with an estimated marker');
    for(let i=0;i<6;i++){motionClock+=100;vehicleFixture.accept({speedVehicleCentreOfGravity:81*64});motionTick();}
    await settle();assert.strictEqual(voiceWarnings,voiceAtLoss,'Estimated progress never dispatches new speech');
    assert.strictEqual(beeperState,null,'No beeper based on estimated positions');assert.strictEqual(reserveReads,0,'No database re-selection while advancing estimated distance');
    for(let i=0;i<50;i++){motionClock+=100;vehicleFixture.accept({speedVehicleCentreOfGravity:81*64});motionTick();}assert.strictEqual(lastGpsOutput,'lost','Expired reserve shows persistent GPS loss');
    texts.length=0;loopHandler();await settle();assert(!texts.includes('🛰 GPS: НЕТ СИГНАЛА / РАСЧЁТ'),'Expired reserve must disappear');
    for(let i=0;i<10;i++)tapHandler(100,459);await settle();
    tapHandler(1400,34);await settle();assert(texts.includes('GPS / СКОРОСТЬ'));save('motion-diagnostics');
    tapHandler(923,470);await settle();
    motionClock=null;
    // Real app settings must reach the detector, not merely change the UI label.
    settings.mapcam_voice='always';settings.auto_monitor='on';
    for(const [mode,speed,expected] of [['base',200,false],['0',100,false],['0',200,true]]){
      const dynamicPoint=Object.assign({},speedPoint,{id:'dynamic-'+mode+'-'+speed,mapcamWarningDistanceM:800});
      activeStore.current.near=()=>[dynamicPoint];activeStore.current.nearWarnings=()=>[dynamicPoint];
      gpsHandler({state:'lost',fix:null});settings.mapcam_distance=mode;changeHandler('mapcam_distance');
      const before=voiceWarnings,clock=Date.now();
      const at=(d,t)=>({lat:55-d/111320,lon:37,accuracyM:5,speedKmh:speed,headingDeg:0,timeMs:t});
      gpsHandler({fix:at(1655,clock-1000),state:'fix'});gpsHandler({fix:at(1600,clock),state:'fix'});await settle();
      assert.strictEqual(voiceWarnings>before,expected,'Dynamic app dispatch: '+mode+' '+speed+' km/h');
    }
    const sourceBeforeSleep=activeStore.current,settingsBeforeSleep=JSON.stringify(settings),beforeSleepVoice=voiceWarnings;
    const oldVehicle=vehicleFixture;
    visibleHandler('MAIN',false);recoveryClock+=3600000;recoveryFixture.tick();await settle();
    assert.strictEqual(recoveryFixture.failed,false,'Wake recovery must not throw');
    assert.strictEqual(gpsStarts,2);assert.strictEqual(gpsStops,1);
    assert(oldVehicle.closed,'Previous speed subscription is closed');assert.notStrictEqual(vehicleFixture,oldVehicle);
    assert.strictEqual(beeperState,null,'Sleep discards active beeper');assert.strictEqual(voiceWarnings,beforeSleepVoice,'No warning from pre-sleep positions');
    assert.strictEqual(JSON.stringify(settings),settingsBeforeSleep,'Wake preserves user settings');assert.strictEqual(activeStore.current,sourceBeforeSleep,'Wake reuses disk database / region cache');
    backgroundTick();assert.strictEqual(beeperState,null,'Background tick does not reuse stale GPS');
    activeStore.current.near=()=>[speedPoint];activeStore.current.nearWarnings=()=>[speedPoint];
    const resumedAt=Date.now();gpsHandler({fix:Object.assign(priorityFix(500,resumedAt-1000),{speedKmh:90}),state:'fix'});
    gpsHandler({fix:Object.assign(priorityFix(475,resumedAt),{speedKmh:90}),state:'fix'});await settle();backgroundTick();
    assert(beeperState&&beeperState.cameraId===speedPoint.id,'Fresh GPS resumes monitoring with app hidden');
    assert(voiceWarnings>beforeSleepVoice,'Fresh GPS resumes voice without user action');
    recoveryFixture.stop();
    visibleHandler('MAIN',true);tapHandler(100,459);await settle();buttons.BTN_REFRESH();await settle();
    assert(texts.includes('ЗАКРЫТЬ ПРОГРАММУ'),'Close button shown on settings');
    tapHandler(1020,34);await settle();assert.equal(manualCloses,1,'Touch closes through lifecycle bridge');
    tapHandler(1020,34);await settle();assert.equal(manualCloses,1,'Close is idempotent');
    activeStore.current.near=oldNear;activeStore.current.nearWarnings=oldNearWarnings;
    assert(!warnings.some(w=>/UI_RENDER_FAILED|render:|ReferenceError|TypeError/.test(w)),warnings.join('\n'));
    console.log('App startup/render smoke test passed; images:',images,'RSS MiB:',Math.round(process.memoryUsage().rss/1048576));
}
run().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{if(activeStore)activeStore.close();fs.rmSync(tmp,{recursive:true,force:true});});
