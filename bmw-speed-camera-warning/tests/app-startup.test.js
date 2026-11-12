'use strict';
// Exercise real app code and data while replacing only vehicle services/rendering.
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm'),os=require('os');
const {createRequire}=require('module');
const file=process.argv[2]||path.join(__dirname,'../apps/aurelm_speed_camera_warning/main.js');
const appRequire=createRequire(path.resolve(file));
const {CameraStore:RealStore}=appRequire('./disk-camera-store');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-startup-'));
const warnings=[],texts=[],buttons={};let images=0,startPromise,gpsHandler,changeHandler,loopHandler,expectedCameras,tapHandler,lastCanvas,visibleHandler,pageTargets=[];
const cv=new Proxy({}, {get:(_,key)=>(...args)=>{if(key==='text')texts.push(String(args[0]));return cv;}});
const nativeButtonState={};
const settings={city:'russia',camera_display:'off'};
const previewDir=process.env.BMW_PREVIEW_DIR;
const Canvas=previewDir?appRequire('./kit/canvas').Canvas:null;
const native=process.env.BMW_NATIVE_PREVIEW==='1'?appRequire('./kit/record'):null;
if(previewDir)fs.mkdirSync(previewDir,{recursive:true});
const ctx={dataDir:tmp,canvas:()=>native?new native.Recorder(1600,520):previewDir?new Canvas(1600,520):cv,onTap:fn=>{tapHandler=fn;},loop:(name,ms,fn)=>{loopHandler=fn;},
    log:{info:()=>{},warn:s=>warnings.push(String(s))},
    settings:{get:k=>settings[k],set:(k,v)=>{settings[k]=v;},onChange:fn=>{changeHandler=fn;}},
    ui:{visible:(id,on)=>{nativeButtonState[id]=on;},enabled:()=>{},image:(id,image)=>{images++;pageTargets=image.targets||[];lastCanvas=native?native.play(image.words(),new Canvas(1600,520)):image;},onClick:(k,fn)=>{buttons[k]=fn;},isVisible:()=>true,onVisible:fn=>{visibleHandler=fn;}}};
let nextRefreshFailure=null,activeStore,pulseTime=0,voiceTests=0,voiceWarnings=0,clusterWarnings=0,centralWarnings=0;
const systemPopupCalls=[];
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
class GPS {on(k,fn){gpsHandler=fn;}start(){}}
class Voice {cancel(){}camera(stage,relevant,camera){assert(camera&&camera.id,'Voice dispatch includes the database camera for model selection');assert.strictEqual(typeof relevant,'function');voiceWarnings++;return Promise.resolve(true);}test(){voiceTests++;return Promise.resolve(true);}}
let lastClusterCamera=null,lastCentralCamera=null;
class Cluster {setMode(){}show(e){clusterWarnings++;lastClusterCamera=e.camera.id;}clear(){}sync(){}}
const replacements={
    './background-notification':Object.assign({},appRequire('./background-notification'),{RhmiPopupTransport:TestPopupTransport}),
    './central-alert':{drawCentralAlert:(...args)=>{centralWarnings++;lastCentralCamera=args[1].camera.id;return appRequire('./central-alert').drawCentralAlert(...args);}},
    './ring-pulse':Object.assign({},appRequire('./ring-pulse'),{monotonicMs:()=>pulseTime}),
    './kit/mgu':{run:o=>{startPromise=o.start(ctx);}},
    './screen-style':Object.assign({},appRequire('./screen-style'),{heading:(cv,s,...args)=>{texts.push(String(s));return appRequire('./screen-style').heading(cv,s,...args);},text:(cv,s,...args)=>{texts.push(String(s));return appRequire('./screen-style').text(cv,s,...args);}}),
    './uplink':{init:()=>{},describe:()=> 'test',checkInternet:()=>Promise.resolve(false)},
    './disk-camera-store':{CameraStore},'./gps':{BmwGps:GPS},
    './voice-alert':{CameraVoiceAlerts:Voice},'./cluster-output':{CameraClusterOutput:Cluster}
};
vm.runInNewContext(fs.readFileSync(file,'utf8'),{require:n=>replacements[n]||appRequire(n),
    __dirname:path.dirname(path.resolve(file)),console,Buffer,process,setTimeout:fn=>setTimeout(fn,0),setInterval:()=>0}, {filename:file});
async function run(){
    await startPromise;await activeStore.pending;await new Promise(resolve=>setTimeout(resolve,30));
    assert(images>0,'Initial app screen must render: '+warnings.join('\n'));
    assert(expectedCameras>=50000&&texts.some(t=>t.includes(String(expectedCameras))),'Nationwide database count must be visible');
    const settle=()=>new Promise(resolve=>setTimeout(resolve,40));
    const save=name=>{if(previewDir)fs.writeFileSync(path.join(previewDir,name+'.png'),lastCanvas.png());};
    const scale=()=>texts.filter(t=>t.startsWith('МАСШТАБ ')).slice(-1)[0];
    assert.strictEqual(scale(),'МАСШТАБ 0.75×');
    tapHandler(1068,352);await settle();assert.strictEqual(scale(),'МАСШТАБ 1×','Plus zooms in');
    tapHandler(1068,424);await settle();assert.strictEqual(scale(),'МАСШТАБ 0.75×','Minus zooms out');
    tapHandler(1068,388);await settle();assert.strictEqual(scale(),'МАСШТАБ 0.75×','Gap is not a button');
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
    for(const [y,title,fileName] of [[263,'ОЖИДАНИЕ GPS','02-add'],[361,'ПОКА НЕТ СОХРАНЁННЫХ КАМЕР','03-my-cameras'],[459,'ВЫБЕРИТЕ ДИСПЛЕЙ','04-settings']]){
      texts.length=0;tapHandler(100,y);await settle();assert(texts.some(t=>t.includes(title)),'Sidebar opens '+title);save(fileName);
    }
    tapHandler(980,180);await settle();assert.strictEqual(settings.camera_display,'both','Display tile selects KOMBI + HUD');
    buttons.BTN_ZOOM();await settle();save('05-warning-settings');
    const voiceBefore=settings.mapcam_voice;
    tapHandler(280,140);tapHandler(400,130);await settle();assert.strictEqual(settings.mapcam_voice,voiceBefore,'Padding and row gaps must not change settings');
    tapHandler(400,110);await settle();assert.strictEqual(settings.mapcam_voice,'speeding','Warning row remains clickable');
    tapHandler(1400,150);await settle();assert.strictEqual(settings.notification_volume,'80','Volume minus selects the fourth of five levels');
    tapHandler(1500,150);await settle();assert.strictEqual(settings.notification_volume,'100');
    tapHandler(1500,150);assert.strictEqual(settings.notification_volume,'100','Volume maximum clamps');
    for(let i=0;i<11;i++)tapHandler(1400,150);
    assert.strictEqual(settings.notification_volume,'20','Volume minimum clamps at the first of five levels');
    for(let i=0;i<2;i++)tapHandler(1500,150);
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
    buttons.BTN_REFRESH();assert.strictEqual(settings.mapcam_voice,'always','Removed button 4 must not change settings');tapHandler(400,110);assert.strictEqual(settings.mapcam_voice,'speeding');
    buttons.BTN_CAM_NEXT();tapHandler(400,196);assert.strictEqual(settings.mapcam_excess,'10');
    buttons.BTN_CAM_NEXT();tapHandler(400,230);assert.strictEqual(settings.mapcam_distance,'500');
    tapHandler(400,284);assert.strictEqual(settings.auto_monitor,'off');
    tapHandler(400,284);assert.strictEqual(settings.auto_monitor,'on');
    tapHandler(400,315);assert.strictEqual(settings.central_notifications,'foreground');
    tapHandler(400,315);assert.strictEqual(settings.central_notifications,'off');
    tapHandler(400,315);assert.strictEqual(settings.central_notifications,'always');
    tapHandler(400,365);assert.strictEqual(settings.radar_no_duplicate,'off');
    tapHandler(400,365);assert.strictEqual(settings.radar_no_duplicate,'on');
    tapHandler(400,420);assert.strictEqual(settings.mapcam_repeat200,'off');tapHandler(400,420);assert.strictEqual(settings.mapcam_repeat200,'on');
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
    assert(texts.includes('РАДАР')&&texts.includes('НЕТ GPS'),'Radar waits for GPS instead of using a map default');save('09-radar-no-gps');
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
       assert(texts.includes(d<1000?Math.round(d)+' М':(d/1000).toFixed(1)+' КМ')&&texts.includes(label.control),'Radar displays the same eligible camera as notifications');
      }else assert(texts.includes('ВПЕРЕДИ НЕТ КАМЕР'));
      const reads=activeStore.current.readBlocks;loopHandler();await settle();assert.strictEqual(activeStore.current.readBlocks,reads,'Radar redraw must reuse GPS selection');
      if(lat===56.63)save('10-radar-camera');
    }
    texts.length=0;gpsHandler({fix:{lat:0,lon:0,accuracyM:5,speedKmh:0,timeMs:Date.now()},state:'fix'});await settle();
    assert(texts.includes('ОЖИДАНИЕ ДВИЖЕНИЯ'),'Radar does not invent a travel direction at rest');save('11-radar-empty');
    texts.length=0;gpsHandler({fix:{lat:55.75,lon:37.62,accuracyM:5,speedKmh:0,timeMs:Date.now()-4000},state:'fix'});await settle();
    assert(texts.includes('НЕТ GPS'),'Radar rejects stale GPS');
    texts.length=0;gpsHandler({fix:{lat:55.75,lon:37.62,accuracyM:25,speedKmh:60,timeMs:Date.now()},state:'fix'});await settle();assert(texts.includes('НИЗКАЯ ТОЧНОСТЬ GPS'));save('13-radar-poor-gps');
    texts.length=0;buttons.BTN_CAMERA_MENU();await settle();assert(texts.includes('ДОБАВИТЬ КАМЕРУ'),'Controller cycles past Radar to Add');
    assert(!warnings.some(w=>/UI_RENDER_FAILED|render:|ReferenceError|TypeError/.test(w)),warnings.join('\n'));
    const sample=activeStore.current.near({lat:55.75,lon:37.62},25000,500).find(c=>c.source==='еСтрелка'&&c.camera_family==='fixed'&&!c.averageControl&&c.mapcamDirectionType===1&&Number.isFinite(c.mapcamApproachHeadingDeg)&&c.mapcamWarningDistanceM>=300);
    assert(sample,'Real directional camera required for central notification regression');
    settings.mapcam_voice='always';settings.mapcam_distance='2000';changeHandler('mapcam_voice');
    tapHandler(100,165);await settle();
    const centralBefore=centralWarnings,voiceDispatchBefore=voiceWarnings,clusterBefore=clusterWarnings,now=Date.now();
    const heading=sample.mapcamApproachHeadingDeg*Math.PI/180;
    const approach=(d,t)=>({lat:sample.lat-Math.cos(heading)*d/111320,lon:sample.lon-Math.sin(heading)*d/(111320*Math.cos(sample.lat*Math.PI/180)),accuracyM:5,speedKmh:100,headingDeg:sample.mapcamApproachHeadingDeg,timeMs:t});
    gpsHandler({fix:approach(220,now-1000),state:'fix'});gpsHandler({fix:approach(200,now),state:'fix'});await settle();
    assert(voiceWarnings>voiceDispatchBefore&&clusterWarnings>clusterBefore,'Radar must retain voice and HUD/KOMBI warning dispatch');
    assert.strictEqual(centralWarnings,centralBefore,'Visible Radar must suppress the central camera overlay');save('12-radar-active-warning');
    tapHandler(100,50);await settle();assert(centralWarnings>centralBefore,'Returning to Map restores a still-active central warning');
    visibleHandler('MAIN',false);const hiddenCount=centralWarnings;loopHandler();await settle();
    assert.strictEqual(centralWarnings,hiddenCount,'Hidden app screen must not render a central banner');
    assert(systemPopupCalls.includes('open'),'Hidden app must request its separate system popup');
    visibleHandler('MAIN',true);await settle();assert(centralWarnings>hiddenCount,'Visibility restoration must not leave central warnings disabled');
    assert(systemPopupCalls.includes('close'),'Returning to the app closes the separate popup');
    const restoredCount=centralWarnings;tapHandler(100,165);await settle();assert.strictEqual(centralWarnings,restoredCount,'Switching back to Radar hides an existing banner');
    const opens=systemPopupCalls.filter(x=>x==='open').length;
    visibleHandler('MAIN',false);await settle();
    assert(systemPopupCalls.filter(x=>x==='open').length>opens,'Hidden app on remembered Radar must still notify');
    settings.central_notifications='off';changeHandler('central_notifications');await settle();
    assert.strictEqual(systemPopupCalls[systemPopupCalls.length-1],'close','Disable closes a live system popup');
    visibleHandler('MAIN',true);settings.central_notifications='always';changeHandler('central_notifications');await settle();
    settings.radar_no_duplicate='off';changeHandler('radar_no_duplicate');await settle();assert(centralWarnings>restoredCount,'Radar duplicate preference can be switched off');
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
      const engineeringVoiceCount=voiceTests;
      await press('engineering-test');assert.strictEqual(voiceTests,engineeringVoiceCount+1,'Joystick activates engineering output test');
      texts.length=0;await press('engineering-back');assert(!texts.includes('ИНЖЕНЕРНОЕ МЕНЮ'),'Joystick back exits engineering');
      assert.strictEqual(nativeButtonState.BTN_CAM_PREV,true,'Settings actions restore on leaving engineering');
      if(!pageTargets.some(t=>t.key==='warning-setting-auto_monitor'))await press('action-BTN_ZOOM');
      const volumeBefore=Number(settings.notification_volume);
      await press('volume-down');assert.strictEqual(Number(settings.notification_volume),volumeBefore-20,'Joystick decreases volume');
      await press('volume-up');assert.strictEqual(Number(settings.notification_volume),volumeBefore,'Joystick increases volume');
      for(const key of ['auto_monitor','central_notifications','radar_no_duplicate']){
        const before=settings[key];await press('warning-setting-'+key);
        assert.notStrictEqual(settings[key],before,'Joystick changes '+key);
      }
      for(const entry of native.atlasList){assert(entry.f.atlasW<=1024,'MGU atlas width limit');assert(entry.f.atlasH<=4096,'MGU atlas height limit');}
    }
    // Both police categories must reach Radar, the visible banner and the hidden-app popup.
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
      visibleHandler('MAIN',false);await settle();assert(systemPopupCalls.filter(x=>x==='open').length>opened,'DPS popup with app hidden');
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
    visibleHandler('MAIN',false);await settle();assert(systemPopupCalls.includes('paint:priority-speed'),'Background popup uses speed priority');
    visibleHandler('MAIN',true);await settle();
    activeStore.current.near=oldNear;activeStore.current.nearWarnings=oldNearWarnings;
    assert(!warnings.some(w=>/UI_RENDER_FAILED|render:|ReferenceError|TypeError/.test(w)),warnings.join('\n'));
    console.log('App startup/render smoke test passed; images:',images,'RSS MiB:',Math.round(process.memoryUsage().rss/1048576));
}
run().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{if(activeStore)activeStore.close();fs.rmSync(tmp,{recursive:true,force:true});});
