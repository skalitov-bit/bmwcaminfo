'use strict';
const {RADIUS:REGION_RADIUS_M}=require('./region-cache');
const mgu=require('./kit/mgu');
const i18n=require('./i18n');
const uplink=require('./uplink');
const cityMap=require('./city-map.json');
const {CityMapStore}=require('./city-map-store');
const {CityMapRenderer,viewportBounds}=require('./city-map-renderer');
const {CityMapPanel}=require('./city-map-panel');
const {CameraStore}=require('./disk-camera-store');
const {updateFailure}=require('./database-update-status');
const {BmwPosition}=require('./bmw-position');
const {trustedPosition}=require('./gps-quality');
const {GpsQuality}=require('./gps-quality');
const {VehicleSpeed}=require('./vehicle-speed');
const {RuntimeRecovery}=require('./runtime-recovery');
const {MotionDistance}=require('./motion-distance');
const {RoadGuidanceWarnings,prepare}=require('./road-guidance');
const {LocalCameraStore}=require('./local-camera-store');
const {CameraVoiceAlerts}=require('./voice-alert');
const {AudioHealth}=require('./audio-health');
const APP_VERSION=require('./app-version');
const {OverspeedBeeper,beepState}=require('./overspeed-beeper');
const {CameraClusterOutput}=require('./cluster-output');
const {GpsOutputStatus}=require('./gps-output-status');
const {HudPositionStore,HudPositionEditor}=require('./hud-position');
const {ApproachTrajectory,alignment:trajectoryAlignment,halfWidth:trajectoryWidth,point:trajectoryPoint,withDensity}=require('./approach-trajectory');
const {project:projectMap,MapPosition}=require('./map-projection');
const {MapcamWarnings,freshFix:mapcamFreshFix}=require('./mapcam-warnings');
const {category,hudLabels}=require('./camera-label');
const style=require('./screen-style');
const cameraIcon=require('./camera-icon');
const {policeKind,iconFor}=require('./point-kind');
const {drawCentralAlert}=require('./central-alert');
const {centralDistance}=require('./central-distance');
const {NotificationPolicy}=require('./notification-policy');
const {NotificationSession,selectRadar}=require('./notification-session');
const {gpsHealth}=require('./notification-rules');
const {gpsMessage}=require('./gps-message');
const {BackgroundNotification,RhmiPopupTransport}=require('./background-notification');
const {monotonicMs}=require('./ring-pulse');
const {distanceToCamera}=require('./camera-index');
const CITY_LABELS={russia:'Россия · рядом с GPS','yoshkar-ola':'Йошкар-Ола','mari-el':'Республика Марий Эл',moscow:'Москва',sochi:'Сочи'};
const REFRESH_INTERVAL_MS=21600000,W=1600,H=520;
const ACTION_BAR={y:H-40,h:38,baseline:H-15};
const MAP={x:266,y:74,w:850,h:398},P={x:1136,y:74,w:444,h:H-76};
const ZOOM_STEPS=[.55,.75,1,1.25,1.6,2,2.5];
const ZOOM_BUTTONS=[{step:1,x:MAP.x+MAP.w-80,y:MAP.y+MAP.h-152,w:64,h:64},{step:-1,x:MAP.x+MAP.w-80,y:MAP.y+MAP.h-80,w:64,h:64}];
const CAMERA_BUTTONS=[{step:-1,x:P.x+145,y:P.y+140,w:56,h:64},{step:1,x:P.x+366,y:P.y+140,w:56,h:64}];
const C=style.colors;
const ACTION_IDS=['BTN_CAM_PREV','BTN_CAM_NEXT','BTN_ZOOM','BTN_REFRESH','BTN_VOICE_TEST','BTN_CAMERA_MENU'];
mgu.run({async start(ctx){
 const {ui,settings,log,dataDir}=ctx;
 i18n.setLanguage(settings.get('ui_language'));
 let languageFirst=!['ru','en'].includes(settings.get('ui_language')),languageReturn='SETTINGS';
uplink.init(dataDir);log.info('UPLINK '+uplink.describe());uplink.checkInternet({timeout:3500}).then(ok=>log.info('UPLINK_HTTPS_PROBE '+(ok?'online':'offline')+'; '+uplink.describe())).catch(e=>log.warn('UPLINK_PROBE_ERROR '+e));let city=String(settings.get('city')||'russia'),view='MAP',index=0,zoom=2.5,zoomIndex=ZOOM_STEPS.indexOf(2.5),fix=null,cameraDisplayMode=String(settings.get('camera_display')||'kombi'),gpsStatus={state:'starting',errorCode:null,eventsReceived:0,invalidEvents:0},lastAlert='Нет предупреждений',alertUntil=0,activeAlert=null;
 const store=new CameraStore({dataDir,bundledDir:__dirname,log:m=>log.info(m),canActivate:()=>!notificationSession.pendingEnd&&!Object.values(mapcamWarnings.states).some(s=>s.phase==='section'&&(s.camera.averageControl||s.camera.mapcamTypeCode===4))});let database=(await store.loadLocal()).database;
 let cameraIndex=database,displayCache=null,mapPulseVisible=false,radarCamera=null;
 let mainScreenVisible=typeof ui.isVisible==='function'&&ui.isVisible('MAIN');
 let mapPreview=null;
 const cityMaps=new CityMapStore(dataDir,{requireHddNotice:true}),cityRoadRenderer=new CityMapRenderer();
 const cityMapPanel=new CityMapPanel(cityMaps,renderSafe,()=>openView('SETTINGS'),e=>{
  // Preview never replaces a live fix or moves the warning database cache.
  mapPreview={lat:(e.bbox[1]+e.bbox[3])/2,lon:(e.bbox[0]+e.bbox[2])/2,name:e.name};view='MAP';renderSafe();
 });
 const hddDialog=new (require('./city-map-hdd-dialog').CityMapHddDialog)(cityMaps);
 cityMaps.on('change',()=>{if(mainScreenVisible)renderSafe();});
 function drawHddDialog(){const cv=ctx.canvas(W,H).clear(C.bg);hddDialog.draw(cv,style,pageTarget);return presentImage('MAIN_GFX',cv);}
 cityMapPanel.bindNavigation(ctx.display,()=>!cityMaps.notice&&view==='CITY_MAPS'&&mainScreenVisible);
 if(typeof ctx.onScroll==='function')ctx.onScroll(dy=>!cityMaps.notice&&view==='CITY_MAPS'&&cityMapPanel.scrollPixels(dy));
 function openCityMaps(){view='CITY_MAPS';cityMapPanel.open();renderSafe();}
 function drawCityMaps(){const cv=ctx.canvas(W,H).clear(C.bg);cityMapPanel.draw(cv,style,pageTarget);drawTabs(cv,'SETTINGS');return ui.image('MAIN_GFX',cv);}
 const notificationPolicy=new NotificationPolicy(k=>settings.get(k),mainScreenVisible);
 const backgroundNotification=new BackgroundNotification(new RhmiPopupTransport(ui,m=>log.warn(m)),m=>log.info(m));
 const presentImage=ui.image.bind(ui);
 ui.image=(name,cv)=>{if(name==='MAIN_GFX'){
  drawAlertBanner(cv);
  if(!['ENGINEERING','MOTION_DIAGNOSTICS','HUD_POSITION','SETTINGS','CITY_MAPS'].includes(view)&&(!mapcamFreshFix(fix,Date.now())||fix&&fix.warningAccuracyState==='degraded')){cv.roundRect(1060,12,520,40,0,C.bg);style.text(cv,view==='MAP'&&mapOrientation.position&&!fix?gpsMessage('lost'):presentation&&presentation.estimated?gpsMessage('reserve'):gpsHealth(fix,Date.now()),1566,40,18,C.yellow,{align:'right',maxWidth:495});}
 }return presentImage(name,cv);};
 function applyNativeLanguage(){
  if(typeof ui.text!=='function')return;
  [['DISPLAY_RETRY','Повторить подключение графики'],['DISPLAY_SETTINGS','Открыть настройки уведомлений'],['DISPLAY_EXIT','Закрыть экран приложения']].forEach(pair=>{
   try{Promise.resolve(ui.text(pair[0],i18n.t(pair[1]))).catch(()=>{});}catch(e){}
  });
 }
 applyNativeLanguage();
 const languagePanel=new (require('./language-panel').LanguagePanel)(language=>{
  settings.set('ui_language',language);i18n.setLanguage(language);languageFirst=false;
  voice.cancel();clusterOutput.frameKey=null;clusterOutput.footerKey=null;
  if(clusterOutput.current&&typeof clusterOutput._draw==='function')clusterOutput._draw(clusterOutput.current);
  else if(typeof clusterOutput._drawGpsStatus==='function')clusterOutput._drawGpsStatus();
  applyNativeLanguage();view=languageReturn;renderSafe();
 },()=>{if(!languageFirst){view=languageReturn;renderSafe();}});
 function openLanguage(){languageReturn='SETTINGS';view='LANGUAGE';renderSafe();}
 function drawLanguage(){const cv=ctx.canvas(W,H).clear(C.bg);languagePanel.draw(cv,style,pageTarget,languageFirst);return presentImage('MAIN_GFX',cv);}
 const actionHandlers=Object.create(null);let nativeButtonView=null;
 const nativeActionIds=ctx.display?((ctx.display.screen&&ctx.display.screen.buttons)||[]).map(b=>b[0]):ACTION_IDS;
 require('./controller-navigation').install(ctx.display);
 require('./display-recovery-menu').install(ctx);
 function bindAction(id,fn){const guarded=()=>{if(!cityMaps.notice)return fn();};actionHandlers[id]=guarded;if(nativeActionIds.includes(id))ui.onClick(id,guarded);}
 function pageTarget(cv,x,y,w,h,run,key){if(cv.recording===true&&typeof cv.target==='function')cv.target(x,y,w,h,()=>{if(!cityMaps.notice||key.indexOf('hdd-transfer-')===0)return run();},key,0);}
 // Actions live on the page. MAIN has no native RHMI bar in app.json.
 // Only bind/hide controls actually declared by an older runtime, if present.
 if(typeof ctx.hideButton==='function')nativeActionIds.forEach(id=>ctx.hideButton(id));
 if(!database.cities[city])city='russia';
 const localStore=new LocalCameraStore(dataDir);let localCameras=localStore.load(),addScreenActive=false,captureFixes=[],cameraDraft=null,captureStatus=gpsMessage('searching'),cameraLimit=60,cameraType=0,cameraDirection='forward',gpsTrack=[];
 // Migrate the old percentage setting without re-enabling muted notifications.
 const VOLUME_LEVELS=['20','40','60','80','100'];
 const savedVolume=settings.get('notification_volume');
 if(savedVolume!==undefined&&savedVolume!==null&&savedVolume!==''&&Number(savedVolume)===0)settings.set('mapcam_voice','off');
 const volumeNumber=savedVolume===undefined||savedVolume===null||savedVolume===''||!Number.isFinite(Number(savedVolume))?40:Number(savedVolume);
 const migratedVolume=VOLUME_LEVELS.reduce((best,value)=>Math.abs(Number(value)-volumeNumber)<Math.abs(Number(best)-volumeNumber)?value:best,VOLUME_LEVELS[0]);
 if(String(savedVolume)!==migratedVolume)settings.set('notification_volume',migratedVolume);
 const gps=new BmwPosition(ctx,{vehicle:()=>vehicleSpeed.snapshot()}),roadGuidance=new RoadGuidanceWarnings([]),voice=new CameraVoiceAlerts({assetDir:__dirname,getVolume:()=>settings.get('notification_volume'),log:(m)=>log.warn(m)});
 let vehicleSpeed=new VehicleSpeed(ctx);const motion=new MotionDistance({vehicle:()=>vehicleSpeed.snapshot()});
 const approachTrajectory=new ApproachTrajectory();
 const mapOrientation=new MapPosition();
 const recovery=new RuntimeRecovery({resume:resumeMonitoring,log:m=>log.info(m)});
 function resumeMonitoring(){
  // Stale positions/section progress must never survive a sleep interval.
  // Keep the disk catalog, 10/5 region cache, settings and audio backend intact.
  hudEditor.stop();audioWizard.stop('Восстановление после паузы');audioDiagnostics.stop();
  if(audioPage()||view==='HUD_POSITION')view='ENGINEERING';
  fix=null;gpsQuality.reset();approachTrajectory.reset();radarCamera=null;gpsTrack=[];captureFixes=[];cameraDraft=null;
  clearLiveAlerts();notificationSession.clear();mapcamWarnings.reset();roadGuidance.reset();
  motion.lastGps=null;motion.previousGps=null;motion.gpsEvents=[];gpsSuspended=false;
  vehicleSpeed.close();vehicleSpeed=new VehicleSpeed(ctx);
  vehicleSpeed.on('change',()=>motion.vehicleChanged());vehicleSpeed.start();
  gps.stop();gps.start();audioHealth.poll();
  lastAlert=gpsMessage('waiting');syncBackgroundNotification();renderSafe();
 }
 let gpsSuspended=false,presentation=null,lastMotionPaintKey=null;
 vehicleSpeed.on('change',()=>motion.vehicleChanged());
 vehicleSpeed.start();
 const hudPositionStore=new HudPositionStore(dataDir);
 const clusterOutput=new CameraClusterOutput({mode:cameraDisplayMode,hudPosition:hudPositionStore.load(),log:(m)=>log.info(m)});
 const displayProbe=new (require('./display-output-probe').DisplayOutputProbe)(clusterOutput,{appVersion:APP_VERSION,moving:()=>!!(mapcamFreshFix(fix,Date.now())&&fix.speedKmh>3||vehicleSpeed.snapshot().valid&&vehicleSpeed.snapshot().speedKmh>3)});
 const gpsOutputStatus=new GpsOutputStatus();
 function syncGpsOutput(){
  if(displayProbe.busy||hudEditor.busy)return;
  clusterOutput.setGpsStatus(gpsOutputStatus.update(fix,Date.now(),presentation&&presentation.estimated,notificationPolicy.monitoring()&&!audioPage()&&view!=='HUD_POSITION'));
 }
 const hudEditor=new HudPositionEditor({store:hudPositionStore,output:clusterOutput,change:()=>renderSafe(),apply:p=>clusterOutput.setHudPosition(p),back:()=>{hudEditor.stop();view='SETTINGS';warningSettings=true;renderSafe();},moving:()=>!!(mapcamFreshFix(fix,Date.now())&&fix.speedKmh>3||vehicleSpeed.snapshot().valid&&vehicleSpeed.snapshot().speedKmh>3)});let refreshInFlight=null,refreshBusy=false,refreshStartedAt=0,refreshError=false,refreshDetails=[],refreshStatus='База готова';
 const notificationTypes=require('./notification-types');
 const bannerEnabled=c=>notificationTypes.enabled(k=>settings.get(k),'banner',c);
 const voiceEnabled=c=>notificationTypes.enabled(k=>settings.get(k),'voice',c);
 const forceAudioEnabled=()=>settings.get('audio_force_notifications')==='on';
 const mapcamOptions=()=>({bannerEnabled,voiceEnabled,forceAudio:forceAudioEnabled(),voice:String(settings.get('mapcam_voice')||'speeding'),excessKmh:Number(settings.get('mapcam_excess')||0),distanceM:Number(settings.get('mapcam_distance'))||0,dynamicDistance:String(settings.get('mapcam_distance')||'0')==='0',repeat200:settings.get('mapcam_repeat200')!=='off'});
 const mapcamWarnings=new MapcamWarnings(mapcamOptions());
 const gpsQuality=new GpsQuality();
 roadGuidance.configure(mapcamOptions());
 const notificationSession=new NotificationSession(voice,mapcamOptions);
 const audioDiagnostics=new (require('./audio-diagnostics').AudioDiagnostics)(()=>renderSafe(),{dataDir,appVersion:APP_VERSION,moving:()=>!!(mapcamFreshFix(fix,Date.now())&&fix.speedKmh>3||vehicleSpeed.snapshot().valid&&vehicleSpeed.snapshot().speedKmh>3),
  gpsReport:()=>gps.diagnosticReport(Date.now(),fix),
  storageReport:()=>cityMaps.storage.diagnostic(),
  testDisplays:()=>displayProbe.run(),stopDisplays:()=>displayProbe.stop(),closeDisplayReport:()=>{view='ENGINEERING';renderSafe();},back:()=>{view='ENGINEERING';renderSafe();},
  getVolume:()=>Number(settings.get('notification_volume')),getForceAudio:forceAudioEnabled,setForceAudio:enabled=>settings.set('audio_force_notifications',enabled?'on':'off'),
  displayReport:()=>require('./diagnostic-report-view').displayReport(clusterOutput.cr,{appVersion:APP_VERSION,outputMode:cameraDisplayMode,
   lastCombinedTest:displayProbe.last,
   banner:require('./kombi-backplate').layout(clusterOutput.cr&&clusterOutput.cr.targets),
   note:'Только чтение. Таблица слотов не содержит экранных координат. Свободный нижний слой не подтверждён.'})});
 const audioWizard=new (require('./audio-wizard').AudioWizard)(audioDiagnostics,()=>renderSafe(),{dataDir,appVersion:APP_VERSION,serviceVersion:()=>audioHealth.state&&audioHealth.state.version||null,moving:()=>!!(mapcamFreshFix(fix,Date.now())&&fix.speedKmh>3)});
 const audioPage=()=>view==='AUDIO_CHANNELS'||view==='AUDIO_WIZARD';
 const audioHealth=new AudioHealth();audioHealth.poll();
 const audioHealthTimer=setInterval(()=>audioHealth.poll(),15000);
 const beeper=new OverspeedBeeper({log:m=>log.warn(m)});
 function syncBeeper(){if(gpsSuspended||audioPage()){beeper.stop();return;}beeper.update(beepState(notificationSession.current,fix,Date.now(),notificationPolicy.monitoring(),voice.pending>0||notificationSession.busy,settings.get('notification_volume'),forceAudioEnabled(),settings.get('notification_beeper')));}
 localCameras.forEach(c=>{if(c.road)roadGuidance.zones[c.id]=prepare({id:c.id,lat:c.lat,lon:c.lon,roads:[{id:'user-road-'+c.id,pts:c.road.pts,camM:c.road.camM,dir:c.direction==='forward'?1:0}]});});
 let warningSettings=false,warningSettingIndex=0,settingsTaps=0,lastSettingsTap=0;
 const WARNING_ROW_STEP=31,WARNING_ROW_HEIGHT=29;
 const typePanel=new (require('./notification-type-panel').NotificationTypePanel)(settings,()=>renderSafe(),()=>{view='SETTINGS';warningSettings=true;renderSafe();});
 function openTypes(channel){typePanel.open(channel);view='NOTIFICATION_TYPES';renderSafe();}
 function drawTypes(){const cv=ctx.canvas(W,H).clear(C.bg);typePanel.draw(cv,style,pageTarget);drawTabs(cv,'SETTINGS');return ui.image('MAIN_GFX',cv);}
 const warningRows=[
  {key:'banner_types',label:'Баннер',values:['select'],labels:['Выбрать типы']},
  {key:'voice_types',label:'Голосовые уведомления',values:['select'],labels:['Выбрать типы']},
  {key:'mapcam_voice',label:'Голос',default:'speeding',values:['always','speeding','off'],labels:['Каждая камера','Только при превышении','Выключен']},
  {key:'notification_beeper',label:'Бипер',default:'auto',values:['auto','off'],labels:['Авто','Выключен']},
  {key:'beeper_sound',label:'Звук бипера',values:['select'],labels:['Выбрать из списка']},
  {key:'notification_volume',label:'Громкость',values:VOLUME_LEVELS,labels:['Тихо','Умеренно','Средне','Громко','Максимум']},
  {key:'mapcam_excess',label:'Порог превышения',values:['0','10','18','20'],labels:['Лимит камеры','Лимит + 10 км/ч','Лимит + 18 км/ч','Лимит + 20 км/ч']},
  {key:'mapcam_distance',label:'Дистанция',values:['0','base','500','700','1000','2000'],labels:['Авто: база + скорость','Из базы: фиксированная','500 м','700 м','1000 м','2000 м']},
  {key:'auto_monitor',label:'Автозапуск контроля',values:['on','off'],labels:['Включён','После открытия SpeedCAM']},
  {key:'mapcam_repeat200',label:'Повтор за 200 м',values:['on','off'],labels:['Включён','Выключен']}
 ];
 function warningValue(r){const value=String(settings.get(r.key)||r.default||r.values[0]);return Math.max(0,r.values.indexOf(value));}
 function changeWarningSetting(){const r=warningRows[warningSettingIndex];if(r.key==='banner_types'||r.key==='voice_types'){openTypes(r.key==='banner_types'?'banner':'voice');return;}if(r.key==='beeper_sound'){openBeeperSounds();return;}settings.set(r.key,r.values[(warningValue(r)+1)%r.values.length]);if(r.key.indexOf('mapcam_')===0){mapcamWarnings.configure(mapcamOptions());roadGuidance.configure(mapcamOptions());clearLiveAlerts();}else syncBackgroundNotification();renderSafe();}
 function changeVolume(delta){const r=warningRows.find(r=>r.key==='notification_volume');const next=Math.max(0,Math.min(r.values.length-1,warningValue(r)+delta));settings.set(r.key,r.values[next]);renderSafe();}
 function clearLiveAlerts(keepSession,keepMotion){if(!keepMotion){motion.reset();presentation=null;}const hadAlert=!!activeAlert;beeper.stop();activeAlert=null;alertUntil=0;backgroundNotification.clear();if(!displayProbe.busy&&!hudEditor.busy)clusterOutput.clear();if(!keepSession)notificationSession.suspend();if(hadAlert&&mainScreenVisible)renderSafe();}
 function drawWarningSettings(){
  const cv=ctx.canvas(W,H).clear(C.bg);style.heading(cv,'УВЕДОМЛЕНИЯ','');hudPositionButton(cv);
  cv.strokeRoundRect(850,12,340,44,0,2,C.muted);txt(cv,'МИКШЕР ЗВУКА',1020,42,22,C.text,{align:'center'});pageTarget(cv,850,12,340,44,openMixerSettings,'settings-mixer');
  cv.roundRect(266,74,1314,398,0,C.panel);
  warningRows.forEach((r,i)=>{const y=88+i*WARNING_ROW_STEP,on=i===warningSettingIndex;
   if(on)style.drawSelection(cv,288,y,1270,WARNING_ROW_HEIGHT);
   else cv.roundRect(288,y,1270,WARNING_ROW_HEIGHT,0,'#111214');
   txt(cv,r.label,310,y+23,21,C.text,{maxWidth:570});if(r.key!=='notification_volume')txt(cv,r.labels[warningValue(r)],900,y+23,21,C.text,{maxWidth:630});
   if(r.key==='notification_volume'){
    for(let step=0;step<5;step++){
     const h=8+step*5,x=900+step*38;
     cv.fillRect(x,y+28-h,26,h,step<=warningValue(r)?C.red:'#24262a');
    }
    for(const b of [{x:1370,t:'−'},{x:1470,t:'+'}]){cv.roundRect(b.x,y,70,WARNING_ROW_HEIGHT,0,'#24262a');txt(cv,b.t,b.x+35,y+24,26,C.text,{align:'center'});}
   }
  });
  if(forceAudioEnabled()){
   cv.fillRect(288,405,1270,48,'#000000');
   txt(cv,'Внимание! Включен принудительный режим тестирования голосовых уведомлений!',310,424,18,C.yellow,{maxWidth:1226});
   txt(cv,'Для отключения зайдите в инж. меню, нажав настройки 10 раз. > Каналы звука',310,446,18,C.yellow,{maxWidth:1226});
  }
  drawTabs(cv,'SETTINGS');drawActionLegend(cv,'SETTINGS');
  warningRows.forEach((r,i)=>{const y=88+i*WARNING_ROW_STEP;pageTarget(cv,288,y,r.key==='notification_volume'?1060:1270,WARNING_ROW_HEIGHT,()=>{warningSettingIndex=i;changeWarningSetting();},'warning-setting-'+r.key);if(r.key==='notification_volume'){pageTarget(cv,1370,y,70,WARNING_ROW_HEIGHT,()=>{warningSettingIndex=i;changeVolume(-1);},'volume-down');pageTarget(cv,1470,y,70,WARNING_ROW_HEIGHT,()=>{warningSettingIndex=i;changeVolume(1);},'volume-up');}});
  return ui.image('MAIN_GFX',cv);
 }
 const cameras=()=>{
  if(mapPreview)return []; // Road preview cannot steal the live 10/5 camera cache.
  if(city!=='russia'&&!cameraIndex.nearMap)return database.recordsFor(city).concat(localCameras);
  const center=mapOrientation.position||(city==='mari-el'?{lat:56.58,lon:48.05}:{lat:56.630,lon:47.928});
  const now=Date.now();
  if(cameraIndex.region)cameraIndex.region.ensure(center);
  const regionVersion=cameraIndex.region?cameraIndex.region.version:0;
  if(!require('./map-view-cache').reusable(displayCache,center,now)||displayCache.regionVersion!==regionVersion)displayCache={center:{lat:center.lat,lon:center.lon},time:now,regionVersion,rows:cameraIndex.nearMap?cameraIndex.nearMap(center,500):cameraIndex.near(center,25000,500)};
  return displayCache.rows.concat(localCameras);
 };
 const monitoringCameras=()=>fix?(cameraIndex.nearWarnings?cameraIndex.nearWarnings(fix):cameraIndex.near(fix,4200)).concat(localCameras):localCameras;
 const mapped=()=>cameras().filter(c=>c&&typeof c.lat==='number'&&typeof c.lon==='number');
 const selected=()=>{const rows=cameras();index=Math.max(0,Math.min(index,rows.length-1));return rows[index]||null;};
 const txt=style.text;
 const ln=(cv,a,b,w,c)=>cv.line(a[0],a[1],b[0],b[1],w,c);
 function xy(lat,lon,center,scale){return projectMap(lat,lon,center,scale,MAP,mapOrientation.position&&!mapPreview?mapOrientation.heading:0,!!mapOrientation.position&&!mapPreview);}
 function clipMapLine(a,b){
  let lo=0,hi=1;const dx=b[0]-a[0],dy=b[1]-a[1];
  for(const [p,q] of [[-dx,a[0]-MAP.x-12],[dx,MAP.x+MAP.w-12-a[0]],[-dy,a[1]-MAP.y-42],[dy,MAP.y+MAP.h-12-a[1]]]){
   if(p===0){if(q<0)return null;continue;}const t=q/p;
   if(p<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);if(lo>hi)return null;
  }
  return [[a[0]+lo*dx,a[1]+lo*dy],[a[0]+hi*dx,a[1]+hi*dy]];
 }
 function pin(cv,x,y,sel){
  const pulse=sel?(1-Math.cos(monotonicMs()*2*Math.PI/1400))/2:0;
  if(sel){
   const room=Math.min(x-MAP.x-2,MAP.x+MAP.w-x-2,y-MAP.y-40,MAP.y+MAP.h-y-2);
   const radius=Math.min(15+9*pulse,room);
   if(radius>12)cv.arc(x,y,radius-2.5,radius,0,360,C.red);
  }
  cv.circle(x,y,sel?13:10,'#071019');cv.circle(x,y,sel?8+3*pulse:7,C.red);cv.circle(x,y,2.8,'#fff');
 }
 function drawGpsPointer(cv,x,y,live){
  const color=live?C.text:'#777b80';
  // Fixed-size heading-up chevron: two shaded faces, with no animation.
  // Use convex quads supported by both the GPU recorder and PNG canvas.
  const tip=[x,y-29],left=[x-21,y+19],notch=[x,y+8],right=[x+21,y+19],ridge=[x,y-8];
  const shift=p=>[p[0],p[1]+3];
  cv.quad([tip,left,notch,ridge].map(shift),'#000000b0');
  cv.quad([tip,ridge,notch,right].map(shift),'#000000b0');
  cv.quad([tip,left,notch,ridge],color);
  cv.quad([tip,ridge,notch,right],color);
  cv.quad([tip,ridge,notch,right],'#00000020');
  cv.line(x,y-26,x,y+7,1,color);
  const outline=[tip,left,notch,right,tip];
  for(let i=1;i<outline.length;i++)ln(cv,outline[i-1],outline[i],1.7,'#08090b');
 }
 function drawMap(cv){
  cv.roundRect(MAP.x,MAP.y,MAP.w,MAP.h,0,'#040506');
  const center=mapPreview||(mapOrientation.position|| (city==='mari-el'?{lat:56.58,lon:48.05}:{lat:56.630,lon:47.928})),scale=.145*zoom*(city==='mari-el'&&!mapPreview?.045:1);
  cityMaps.ensure(center,6500,viewportBounds(center,scale,mapOrientation.position&&!mapPreview?mapOrientation.heading:0,MAP,!!mapOrientation.position&&!mapPreview));
  for(let x=MAP.x+40;x<MAP.x+MAP.w;x+=80)ln(cv,[x,MAP.y+8],[x,MAP.y+MAP.h-8],1,C.grid);
  for(let y=MAP.y+30;y<MAP.y+MAP.h;y+=60)ln(cv,[MAP.x+8,y],[MAP.x+MAP.w-8,y],1,C.grid);
  const roadReader=cityMaps.reader&&cityMaps.reader.contains(center)?cityMaps.reader:null;
  if(roadReader)cityRoadRenderer.draw(cv,roadReader,center,scale,mapOrientation.position&&!mapPreview?mapOrientation.heading:0,MAP,(lat,lon)=>xy(lat,lon,center,scale),clipMapLine,txt);
  (city==='yoshkar-ola'?cityMap.roads:[]).forEach(r=>{
   const a=xy(r[1],r[2],center,scale),b=xy(r[3],r[4],center,scale);
   if(Math.max(a[0],b[0])<MAP.x||Math.min(a[0],b[0])>MAP.x+MAP.w||Math.max(a[1],b[1])<MAP.y||Math.min(a[1],b[1])>MAP.y+MAP.h)return;
   const clipped=clipMapLine(a,b);if(clipped){ln(cv,clipped[0],clipped[1],9,C.edge);ln(cv,clipped[0],clipped[1],5,C.road);}
  });
  const trajectory=mapPreview?null:approachTrajectory.value(Date.now());
  // Schematic road: observed GPS track behind and measured-trajectory forecast
  // ahead. No invented neighbouring roads or inferred map geometry.
  const road=(a,b,predicted)=>{const clipped=clipMapLine(a,b);if(!clipped)return;
   ln(cv,clipped[0],clipped[1],16,predicted?'#354b59':'#4c545b');
   ln(cv,clipped[0],clipped[1],12,predicted?'#14232e':'#252c32');
  };
  if(mapOrientation.position&&!mapPreview){for(let i=1;i<gpsTrack.length;i++)road(xy(gpsTrack[i-1].lat,gpsTrack[i-1].lon,center,scale),xy(gpsTrack[i].lat,gpsTrack[i].lon,center,scale),false);}
  if(trajectory){
   const project=(along,side)=>{const p=trajectoryPoint(trajectory,along,side);return xy(p.lat,p.lon,center,scale);};
   const draw=(a,b,w,color)=>{const clipped=clipMapLine(a,b);if(clipped)ln(cv,clipped[0],clipped[1],w,color);};
   // Extend only the drawing; the camera-selection horizon stays unchanged.
   // Bound the segment count so zoom and speed cannot inflate drawing work.
   const length=trajectory.lengthM*2,segments=64,step=length/segments;
   const color=trajectory.trusted?[72,136,174]:[104,96,75];
   for(let i=0;i<segments;i++){
    const d=i*step,end=(i+1)*step,t=i/(segments-1);
    const alpha=Math.round(255*(1-t*t*(3-2*t)));
    if(!alpha)continue;
    const a=project(d,0),b=project(end,0);
    if(trajectory.trusted){
     draw(a,b,16,[53,75,89,alpha]);
     draw(a,b,12,[20,35,46,alpha]);
    }
    const middle=(d+end)/2,w=trajectoryWidth(trajectory,middle);
    draw(project(middle,-w),project(middle,w),Math.max(1,step*scale),[16,29,40,alpha]);
    const faded=[color[0],color[1],color[2],alpha];
    for(const side of [-1,1])draw(project(d,side*trajectoryWidth(trajectory,d)),project(end,side*trajectoryWidth(trajectory,end)),1,faded);
    draw(a,b,2,faded);
   }
  }
  const selectedId=(selected()||{}).id;let selectedPoint=null;const visiblePoints=[];
  mapped().forEach(c=>{const p=xy(c.lat,c.lon,center,scale);if(p[0]>=MAP.x+14&&p[0]<=MAP.x+MAP.w-14&&p[1]>=MAP.y+54&&p[1]<=MAP.y+MAP.h-14){visiblePoints.push({camera:c,p});if(c.id===selectedId)selectedPoint=p;else pin(cv,p[0],p[1],false);}});
  mapPulseVisible=!!selectedPoint;
  // Draw selection last so nearby cameras cannot hide its pulse.
  if(selectedPoint)pin(cv,selectedPoint[0],selectedPoint[1],true);
  const current=notificationSession.current,labels=[];
  const priority=c=>current&&current.camera.id===c.id?0:c.id===selectedId?1:2;
  visiblePoints.sort((a,b)=>priority(a.camera)-priority(b.camera)||b.p[1]-a.p[1]);
  visiblePoints.forEach(({camera:c,p})=>{
   const active=current&&current.camera.id===c.id;
   if(active)cv.arc(p[0],p[1],16,18,0,360,C.yellow);
   if(!Number.isFinite(c.limit)||c.limit<=0||labels.length>=48)return;
   // Keep all points, but avoid overlapping labels in dense clusters.
   for(const side of [active?-1:1,active?1:-1]){
    const x=p[0]+(side<0?-58:18),y=p[1]-26,w=40,h=25;
    if(x<MAP.x+12||x+w>MAP.x+MAP.w-12||y<MAP.y+45||y+h>MAP.y+MAP.h-12)continue;
    if(labels.some(r=>x<r.x+r.w&&x+w>r.x&&y<r.y+r.h&&y+h>r.y))continue;
    labels.push({x,y,w,h});cv.fillRect(x,y,w,h,'#080d12');txt(cv,String(c.limit),x+w/2,y+21,21,active?C.yellow:C.text,{align:'center'});break;
   }
  });
  if(mapOrientation.position&&!mapPreview){const position=mapOrientation.position,p=xy(position.lat,position.lon,center,scale);drawGpsPointer(cv,p[0],p[1],mapcamFreshFix(fix,Date.now()));}
  cv.strokeRoundRect(MAP.x,MAP.y,MAP.w,MAP.h,0,1,'#303a46');
  txt(cv,'МАСШТАБ '+String(zoom)+'×',MAP.x+18,MAP.y+25,15,C.muted);
  txt(cv,roadReader?'OpenStreetMap contributors / ODbL 1.0':mapOrientation.position?'СХЕМА ТРАЕКТОРИИ / КАРТА ГОРОДА НЕ УСТАНОВЛЕНА':'КАРТЫ ГОРОДОВ: НАСТРОЙКИ',MAP.x+18,MAP.y+MAP.h-15,14,C.muted,{maxWidth:650});
  if(mapPreview){cv.fillRect(MAP.x+190,MAP.y+5,230,30,C.panel);txt(cv,'ПРОСМОТР / К GPS',MAP.x+305,MAP.y+26,16,C.yellow,{align:'center'});pageTarget(cv,MAP.x+190,MAP.y+5,230,30,()=>{mapPreview=null;renderSafe();},'maps-exit-preview');}
  txt(cv,'На карте: '+mapped().length+' · Россия: '+(database.cities.russia||[]).length,MAP.x+MAP.w-18,MAP.y+25,15,C.text,{align:'right'});
 }
 function changeZoom(step,cycle){
  const next=cycle?(zoomIndex+1)%ZOOM_STEPS.length:Math.max(0,Math.min(ZOOM_STEPS.length-1,zoomIndex+step));
  if(next===zoomIndex)return;
  zoomIndex=next;zoom=ZOOM_STEPS[next];renderSafe();
 }
 function drawZoomButtons(cv){
  ZOOM_BUTTONS.forEach(b=>{
   const enabled=b.step>0?zoomIndex<ZOOM_STEPS.length-1:zoomIndex>0;
   cv.roundRect(b.x,b.y,b.w,b.h,0,C.panel);
   cv.strokeRoundRect(b.x,b.y,b.w,b.h,0,2,enabled?'#a9becf':'#303a46');
   const x=b.x+b.w/2,y=b.y+b.h/2,color=enabled?C.text:'#56616d';
   cv.line(x-13,y,x+13,y,4,color);
   if(b.step>0)cv.line(x,y-13,x,y+13,4,color);
  });
 }
 function changeSelectedCamera(step){
  const count=cameras().length;
  index=Math.max(0,Math.min(index,Math.max(0,count-1)));
  const next=Math.max(0,Math.min(Math.max(0,count-1),index+step));
  if(next===index)return;
  index=next;renderSafe();
 }
 function drawCameraButtons(cv){
  const count=cameras().length;
  CAMERA_BUTTONS.forEach(b=>{
   const enabled=count>0&&(b.step<0?index>0:index<count-1);
   const color=enabled?C.text:'#56616d',x=b.x+b.w/2,y=b.y+b.h/2;
   cv.roundRect(b.x,b.y,b.w,b.h,0,C.panel);
   cv.strokeRoundRect(b.x,b.y,b.w,b.h,0,2,enabled?'#a9becf':'#303a46');
   cv.line(x-b.step*6,y-12,x+b.step*6,y,4,color);
   cv.line(x+b.step*6,y,x-b.step*6,y+12,4,color);
  });
 }
 function drawPanel(cv){
  cv.roundRect(P.x,P.y,P.w,P.h,0,C.panel);const c=selected();
  txt(cv,policeKind(c)?'ВЫБРАННЫЙ ПОСТ ДПС':'ВЫБРАННАЯ КАМЕРА',P.x+22,P.y+32,19,C.muted,{maxWidth:400});
  if(c){const labels=hudLabels(c);
   iconFor(c).drawCanvas(cv,P.x+24,P.y+56,54,45,[245,249,252]);
   txt(cv,labels.control,P.x+100,P.y+78,27,C.text,{maxWidth:320});
   txt(cv,labels.model||(policeKind(c)||notificationTypes.hazardKind(c)?'':'МОДЕЛЬ НЕ УКАЗАНА'),P.x+100,P.y+109,23,C.muted,{maxWidth:320});
   if(!notificationTypes.hazardKind(c)&&!policeKind(c)&&Number.isFinite(c.limit)&&c.limit>0)style.speedSign(cv,c.limit,P.x+71,P.y+189,49);
   else if(!policeKind(c))txt(cv,'ЛИМИТ Н/Д',P.x+24,P.y+192,19,C.muted,{maxWidth:105});
   txt(cv,(index+1)+' / '+cameras().length,P.x+283,P.y+181,25,C.text,{align:'center',maxWidth:149});
   txt(cv,'КАМЕР В ОБЛАСТИ КАРТЫ',P.x+145,P.y+235,16,C.muted,{maxWidth:275});
  }else txt(cv,'КАМЕРЫ НЕ НАЙДЕНЫ',P.x+22,P.y+130,25,C.text,{maxWidth:400});
  drawCameraButtons(cv);
  ln(cv,[P.x+22,P.y+252],[P.x+P.w-22,P.y+252],1,'#303a46');
  txt(cv,mapOrientation.position&&!fix?gpsMessage('lost'):gpsHealth(fix,Date.now()),P.x+22,P.y+285,22,mapcamFreshFix(fix,Date.now())?C.text:C.yellow,{maxWidth:400});
  txt(cv,fix?(Number.isFinite(fix.speedKmh)?Math.round(fix.speedKmh)+' КМ/Ч':'СКОРОСТЬ Н/Д')+' · ТОЧНОСТЬ '+(Number.isFinite(fix.accuracyM)?Math.round(fix.accuracyM)+' М':'Н/Д'):gpsMessage('waiting'),P.x+22,P.y+317,18,C.muted,{maxWidth:400});
  const installedDate=new Date(Number(database.revision)*1000);
  const dateLabel=Number(database.revision)>0&&Number.isFinite(installedDate.getTime())?installedDate.toISOString().slice(0,10).split('-').reverse().join('.'):'НЕ УКАЗАНА';
  txt(cv,'ДАТА БАЗЫ: '+dateLabel,P.x+22,P.y+P.h-(refreshError?88:55),20,C.text,{maxWidth:400});
  if(refreshBusy){
   const baseline=P.y+P.h-25,phase=Math.floor((monotonicMs()-refreshStartedAt)/300)%4;
   txt(cv,'ОБНОВЛЕНИЕ',P.x+22,baseline,18,C.muted,{maxWidth:170});
   // Fixed dot positions: disappear left to right, then all three return.
   for(let i=0;i<3;i++)if(i>=phase)cv.circle(P.x+150+i*12,baseline-2,2,C.muted);
  }else if(refreshError){
   txt(cv,refreshStatus,P.x+22,P.y+P.h-61,20,C.red,{maxWidth:400});
   refreshDetails.forEach((line,i)=>txt(cv,line,P.x+22,P.y+P.h-37+i*22,17,C.muted,{maxWidth:400}));
  }else txt(cv,refreshStatus,P.x+22,P.y+P.h-25,17,C.muted,{maxWidth:400});
 }
 function drawAlertBanner(cv){
  // Suppress only the central overlay; retain live warning state, voice and HUD/KOMBI.
  notificationPolicy.view=view;
  if(view!=='MAP'||notificationPolicy.destination()!=='canvas'||!activeAlert||Date.now()>=alertUntil)return;
  drawCentralAlert(cv,centralDistance(activeAlert,presentation),fix&&fix.speedKmh,{x:MAP.x,y:MAP.y,w:MAP.w});
}
function displayModeLabel(mode){return ({kombi:'KOMBI',hud:'HUD (экспериментально)',both:'KOMBI + HUD',off:'Выкл.'})[mode]||'KOMBI';}
 const DISPLAY_MODES=['kombi','hud','both','off'];
 function setDisplayMode(mode){
  if(DISPLAY_MODES.indexOf(mode)<0)return;
  cameraDisplayMode=mode;
  try{if(typeof settings.set==='function')settings.set('camera_display',mode);}catch(e){log.warn('DISPLAY_SETTING_SAVE_FAILED '+String(e&&e.message||e));}
  clusterOutput.setMode(mode);lastAlert='РЕЖИМ ВЫВОДА: '+displayModeLabel(mode);alertUntil=Date.now()+5000;
  log.info('CAMERA_DISPLAY_MODE '+mode);renderSafe();
 }
 function cycleDisplayMode(step){let i=DISPLAY_MODES.indexOf(cameraDisplayMode);if(i<0)i=0;setDisplayMode(DISPLAY_MODES[(i+step+DISPLAY_MODES.length)%DISPLAY_MODES.length]);}
 function openHudPosition(){hudEditor.open();view='HUD_POSITION';renderSafe();}
 function drawHudPosition(){const cv=ctx.canvas(W,H).clear(C.bg);hudEditor.draw(cv,style,pageTarget);drawTabs(cv,'SETTINGS');return ui.image('MAIN_GFX',cv);}
 function hudPositionButton(cv){cv.strokeRoundRect(1220,12,360,44,0,2,C.muted);txt(cv,'ПОЛОЖЕНИЕ HUD',1400,42,22,C.text,{align:'center'});pageTarget(cv,1220,12,360,44,openHudPosition,'settings-hud-position');}
 function drawSettings(){
  if(warningSettings)return drawWarningSettings();
  const cv=ctx.canvas(W,H).clear(C.bg);style.heading(cv,'НАСТРОЙКИ','');hudPositionButton(cv);
  cv.strokeRoundRect(850,12,340,44,0,1,C.red);
  txt(cv,'ЗАКРЫТЬ ПРОГРАММУ',1020,42,21,C.text,{align:'center',maxWidth:320});
  pageTarget(cv,850,12,340,44,closeProgram,'settings-close');
  cv.roundRect(266,74,1314,398,0,C.panel);
  txt(cv,'ВЫБЕРИТЕ ДИСПЛЕЙ',290,116,24,C.muted,{maxWidth:1230});
  [['kombi','KOMBI'],['hud','HUD'],['both','KOMBI + HUD'],['off','ВЫКЛ.']].forEach((entry,i)=>{
   const x=290+i*319,on=cameraDisplayMode===entry[0];
   if(on)style.drawSelection(cv,x,142,295,104);
   else{cv.roundRect(x,142,295,104,0,'#111214');cv.strokeRoundRect(x,142,295,104,0,1,'#303a46');}
   txt(cv,entry[1],x+147,195,30,on?C.text:C.muted,{align:'center',maxWidth:260});
   if(on)txt(cv,'ВЫБРАНО',x+147,225,16,C.text,{align:'center',maxWidth:260});
  });
  txt(cv,'ТЕКУЩИЙ РЕЖИМ: '+displayModeLabel(cameraDisplayMode),290,296,25,C.text,{maxWidth:880});
  cv.strokeRoundRect(1220,270,340,50,0,1,C.muted);txt(cv,'КАРТЫ ГОРОДОВ',1390,302,22,C.text,{align:'center'});pageTarget(cv,1220,270,340,50,openCityMaps,'settings-city-maps');
  cv.strokeRoundRect(1220,330,340,50,0,1,C.muted);txt(cv,'SET LANGUAGE',1390,362,22,C.text,{align:'center'});pageTarget(cv,1220,330,340,50,openLanguage,'settings-language');
  txt(cv,closeError||'ПОСЛЕ ЗАКРЫТИЯ: ЗАПУСК ТОЛЬКО ЧЕРЕЗ ЯРЛЫК SPEEDCAM',290,346,20,closeError?C.yellow:C.muted,{maxWidth:880});
  const audioLines=audioHealth.lines(voice.lastError,beeper.lastError);
  txt(cv,audioLines[0],290,391,20,C.text,{maxWidth:1230});
  txt(cv,audioLines[1],290,433,17,C.muted,{maxWidth:1230});
  drawTabs(cv,'SETTINGS');drawActionLegend(cv,'SETTINGS');return ui.image('MAIN_GFX',cv);
 }
 let closeError='',closeRequested=false;
 function closeProgram(){
  if(closeRequested)return;
  try{
   if(typeof ctx.requestUserClose!=='function')throw Error('Обработчик закрытия недоступен в этой среде');
   ctx.requestUserClose();closeRequested=true;
   log.info('MANUAL_CLOSE_REQUESTED');
  }catch(e){closeError='НЕ УДАЛОСЬ ЗАКРЫТЬ: '+String(e.message||e);renderSafe();}
 }
 function drawAudioChannels(){const cv=ctx.canvas(W,H).clear(C.bg);audioDiagnostics.draw(cv,style,pageTarget,()=>{view='ENGINEERING';renderSafe();});drawTabs(cv,'SETTINGS');return ui.image('MAIN_GFX',cv);}
 function openBeeperSounds(){clearLiveAlerts();audioDiagnostics.beeperBack=()=>{view='SETTINGS';warningSettings=true;renderSafe();};view='AUDIO_CHANNELS';audioDiagnostics.beeperPanel.open();}
 function openMixerSettings(){clearLiveAlerts();audioDiagnostics.mixerBack=()=>{view='SETTINGS';warningSettings=true;renderSafe();};view='AUDIO_CHANNELS';audioDiagnostics.mixerPanel.open();}
 function openAudioChannels(){clearLiveAlerts();audioDiagnostics.mixerBack=null;audioDiagnostics.reportHome='audio';audioDiagnostics.screen='channels';view='AUDIO_CHANNELS';renderSafe();audioDiagnostics.loadSaved();}
 function openDisplayDiagnostics(){clearLiveAlerts();audioDiagnostics.reportHome='engineering';view='AUDIO_CHANNELS';audioDiagnostics.testDisplays();}
 function engineeringTools(){return [['КАНАЛЫ ЗВУКА',openAudioChannels,'engineering-audio'],['ЛОГ HUD + ПРИБОРКА',openDisplayDiagnostics,'engineering-displays']];}
 function openCarplayDucking(){clearLiveAlerts();view='AUDIO_CHANNELS';audioDiagnostics.openDuck();renderSafe();}
 function openAudioWizard(){clearLiveAlerts();view='AUDIO_WIZARD';audioWizard.open();renderSafe();}
 function drawAudioWizard(){const cv=ctx.canvas(W,H).clear(C.bg);audioWizard.draw(cv,style,pageTarget,()=>{view='ENGINEERING';renderSafe();});drawTabs(cv,'SETTINGS');return ui.image('MAIN_GFX',cv);}
 function openMotionDiagnostics(){view='MOTION_DIAGNOSTICS';renderSafe();}
 function drawMotionDiagnostics(){
  const cv=ctx.canvas(W,H).clear(C.bg),d=motion.diagnostics(),v=d.vehicle;
  const n=(x,suffix)=>Number.isFinite(x)?x.toFixed(1)+(suffix||''):'Н/Д';
  style.heading(cv,'GPS / СКОРОСТЬ','ДИАГНОСТИКА МЕТРАЖА');
  cv.roundRect(266,74,650,350,0,C.panel);cv.roundRect(936,74,644,350,0,C.panel);
  const left=['GPS: '+n(d.gpsSpeed,' КМ/Ч'),'ВОЗРАСТ GPS: '+n(d.gpsAgeMs===null?null:d.gpsAgeMs/1000,' С'),
   'ЧАСТОТА GPS: '+n(d.gpsHz,' ГЦ'),'АВТОМОБИЛЬ: '+n(v.speedKmh,' КМ/Ч'),
   'ВОЗРАСТ СКОРОСТИ: '+n(v.ageMs===null?null:v.ageMs/1000,' С'),
   'СОБЫТИЯ / ОПРОС: '+n(v.eventHz)+' / '+n(v.readHz)+' ГЦ',
   'СИГНАЛ: '+(v.valid?'ДОСТОВЕРЕН':v.error||'НЕТ ДАННЫХ'),'ОШИБКИ СИГНАЛА: '+v.invalid];
  const right=['РЕЖИМ: '+d.mode,'АВТО − GPS: '+n(d.delta,' КМ/Ч'),
   'НЕОПРЕДЕЛЁННОСТЬ: '+n(d.uncertaintyM,' М'),
   'ОСТАТОК РЕЗЕРВА: '+n(presentation&&presentation.estimated?d.reserveRemainingMs/1000:null,' С'),
   'ПРЕДЕЛ: 5 С / 80 М / ПОГРЕШНОСТЬ 25 М',
   gpsHealth(fix,Date.now()),trustedPosition(fix)?'ТОЧНОСТЬ: НЕ СООБЩАЕТСЯ BMW':'ПОИСК КАМЕР: ТОЧНОСТЬ ДО 35 М',
   'МЕТРАЖ: 10 ГЦ / РЕЗЕРВ PNG: ДО 4 ГЦ'];
  left.forEach((s,i)=>txt(cv,s,288,108+i*39,21,C.text,{maxWidth:606}));
  right.forEach((s,i)=>txt(cv,s,958,108+i*39,21,i===0?C.yellow:C.text,{maxWidth:600}));
  cv.strokeRoundRect(266,442,1314,60,0,2,'#a9becf');txt(cv,'НАЗАД',923,480,24,C.text,{align:'center'});
  pageTarget(cv,266,442,1314,60,()=>{view='ENGINEERING';renderSafe();},'motion-back');
  drawTabs(cv,'SETTINGS');return ui.image('MAIN_GFX',cv);
 }
 function drawEngineering(){
  const cv=ctx.canvas(W,H).clear(C.bg),mem=process.memoryUsage(),wc=database.warningCache;
  const rendering=require('./render-diagnostics').read(ctx.display);
  style.heading(cv,'ИНЖЕНЕРНОЕ МЕНЮ','');
  cv.strokeRoundRect(1220,12,360,44,0,2,'#a9becf');txt(cv,'GPS / СКОРОСТЬ',1400,42,22,C.text,{align:'center'});
  pageTarget(cv,1220,12,360,44,openMotionDiagnostics,'motion-diagnostics');
  cv.roundRect(266,74,650,274,0,C.panel);cv.roundRect(936,74,644,274,0,C.panel);
  const age=fix&&Number.isFinite(fix.timeMs)?Math.max(0,Date.now()-fix.timeMs):null;
  const left=[
   (fix?'ИСТОЧНИК: '+(fix.positionSource==='nav'?'НАВИГАЦИЯ BMW':fix.positionSource==='can'?'BMW GPSDATA':'NMEA'):gpsMessage('waiting')),
   (fix&&fix.warningAccuracyState==='degraded'?gpsMessage('degraded')+' / ':'ТОЧНОСТЬ: ')+(fix&&Number.isFinite(fix.accuracyM)?fix.accuracyM.toFixed(1)+' М':'Н/Д'),
   'ВОЗРАСТ КООРДИНАТ: '+(age===null?'Н/Д':(age/1000).toFixed(1)+' С'),
   'СОБЫТИЯ GPS: '+(gpsStatus.eventsReceived||0)+' / ОШИБКИ: '+(gpsStatus.invalidEvents||0),
   'ВЫВОД: '+displayModeLabel(cameraDisplayMode),
   'ГОЛОС: '+(voice.lastError?'ОШИБКА': 'ОШИБОК НЕ ЗАРЕГИСТРИРОВАНО')
  ];
  const right=[
   'ОБЪЕКТЫ БАЗЫ: '+(database.manifest&&database.manifest.count||'Н/Д'),
   'КАМЕР В БАЗЕ: '+(database.cities.russia||{}).length,
   database.region?'ОБЛАСТЬ: 10 КМ / ОБНОВЛЕНИЕ: 5 КМ':'РАДИУС ПОИСКА: 4.2 КМ',
   database.region?'КЭШ ОБЛАСТИ: '+(database.region.pending?'ЗАГРУЗКА':database.region.error?'РЕЗЕРВНЫЙ ПОИСК':database.region.active?'ГОТОВ':'ОЖИДАНИЕ')+' / '+(database.region.active?database.region.active.count:0):'КЭШ ПРЕДУПРЕЖДЕНИЙ: '+(wc?wc.cache.size+' / '+wc.maxBlocks+' БЛОКОВ':'Н/Д'),
   'ПРОЧИТАНО БЛОКОВ: '+(database.readBlocks||0),
   'ПАМЯТЬ HEAP / RSS: '+Math.round(mem.heapUsed/1048576)+' / '+Math.round(mem.rss/1048576)+' МБ'
  ];
  left.concat(rendering.left,['БАННЕР В ФОНЕ: '+(backgroundNotification.transport.available?'ДОСТУПЕН':'ОТКЛЮЧЁН / RHMI')]).forEach((s,i)=>txt(cv,s,288,100+i*26,19,i>=6?C.yellow:C.text,{maxWidth:606}));
  right.concat(rendering.right,[recovery.label()+' / ПЕРЕЗАПУСКИ: '+(Number(process.env.SPEEDCAM_RESTART_COUNT)||0)]).forEach((s,i)=>txt(cv,s,958,100+i*26,19,i>=6?C.yellow:C.text,{maxWidth:600}));
  [['ТЕСТ ГОЛОСА И ДИСПЛЕЕВ',266,650],['НАЗАД В НАСТРОЙКИ',936,644]].forEach(([label,x,w])=>{
   cv.roundRect(x,366,w,64,0,C.panel);cv.strokeRoundRect(x,366,w,64,0,2,'#a9becf');txt(cv,label,x+w/2,406,23,C.text,{align:'center',maxWidth:w-40});
  });
  engineeringTools().forEach(([label,run,key],i)=>{const x=266+i*670;cv.fillRect(x,442,644,60,C.panel);txt(cv,label,x+322,481,22,C.text,{align:'center',maxWidth:620});pageTarget(cv,x,442,644,60,run,key);});
  drawTabs(cv,'SETTINGS');
  pageTarget(cv,266,366,650,64,()=>{settingsTaps=0;lastSettingsTap=0;testCameraOutputs();},'engineering-test');
  pageTarget(cv,936,366,644,64,()=>{settingsTaps=0;lastSettingsTap=0;openView('SETTINGS');},'engineering-back');
  return ui.image('MAIN_GFX',cv);
 }
 function testCameraOutputs(){
  lastAlert='ТЕСТ КАМЕРЫ · '+displayModeLabel(cameraDisplayMode);alertUntil=Date.now()+10000;
  if(cameraDisplayMode!=='off'){
   clusterOutput.show({type:'camera',stage:1,distanceM:500,camera:{id:'camera-output-test',name:'ТЕСТОВАЯ КАМЕРА',type:'Стационарная камера скорости',mapcamTypeCode:1,limit:60},speedKmh:0});
   setTimeout(()=>{if(clusterOutput.current&&clusterOutput.current.camera&&clusterOutput.current.camera.id==='camera-output-test')clusterOutput.clear();},10000);
  }
  renderSafe();
  voice.test().then(ok=>{if(!ok)log.warn('VOICE TEST FAILED: '+String(voice.lastError||'unknown'));
   lastAlert=(ok?'ГОЛОС: OK':'ГОЛОС: ОШИБКА · '+String(voice.lastError||'неизвестная ошибка').slice(0,55))+' · ВЫВОД: '+displayModeLabel(cameraDisplayMode);
   alertUntil=Date.now()+10000;renderSafe();
  });
 }
 function drawRadar(){
  const cv=ctx.canvas(W,H).clear(C.bg);
  style.heading(cv,'РАДАР',radarCamera&&mapcamFreshFix(fix,Date.now())&&policeKind(radarCamera.camera)?'ПОСТ ДПС ПО ХОДУ ДВИЖЕНИЯ':'КАМЕРА ПО ХОДУ ДВИЖЕНИЯ');
  cv.roundRect(266,74,1314,436,0,C.panel);
  const valid=mapcamFreshFix(fix,Date.now()),p=presentation,hit=p?p.hit:valid?radarCamera:null;
  if(!hit){
   cameraIcon.drawCanvas(cv,863,122,120,99,[169,190,207]);
   txt(cv,!valid||fix.warningAccuracyState==='degraded'?gpsHealth(fix,Date.now()):!notificationPolicy.monitoring()?'КОНТРОЛЬ ВЫКЛЮЧЕН':fix.speedKmh<=5?'ОЖИДАНИЕ ДВИЖЕНИЯ':'ВПЕРЕДИ НЕТ КАМЕР',923,307,50,C.text,{align:'center',maxWidth:1200});
   txt(cv,valid?(database.region?'ОБЛАСТЬ БАЗЫ: '+(REGION_RADIUS_M/1000)+' КМ':'В РАДИУСЕ 4.2 КМ'):gpsMessage('waiting'),923,374,26,C.muted,{align:'center',maxWidth:1200});
  }else{
   const c=hit.camera,labels=hudLabels(c);
   iconFor(c).drawCanvas(cv,306,109,96,79,[245,249,252]);
   txt(cv,labels.control,434,156,54,C.text,{maxWidth:770});
   txt(cv,labels.model||(policeKind(c)||notificationTypes.hazardKind(c)?'':'МОДЕЛЬ НЕ УКАЗАНА'),434,216,42,C.muted,{maxWidth:770});
   if(!notificationTypes.hazardKind(c)&&!policeKind(c)&&Number.isFinite(c.limit)&&c.limit>0)style.speedSign(cv,c.limit,1386,262,145);
   else if(!notificationTypes.hazardKind(c)&&!policeKind(c)){txt(cv,'ЛИМИТ',1386,245,30,C.muted,{align:'center',maxWidth:290});txt(cv,'Н/Д',1386,315,66,C.text,{align:'center',maxWidth:290});}
   const distance=Math.round(p?p.distanceM:hit.distanceM)+' М';
   txt(cv,distance,320,378,112,C.text,{maxWidth:865});
   txt(cv,p&&p.estimated?gpsMessage('reserve'):hit.state&&hit.state.phase==='section'?'ДО КОНЦА УЧАСТКА':hit.state&&hit.state.phase==='rear'?(policeKind(c)?'ЗА ПОСТОМ':'ЗА КАМЕРОЙ'):(notificationTypes.hazardKind(c)?'ДО ТОЧКИ':policeKind(c)?'ДО ПОСТА':'ДО КАМЕРЫ'),322,422,25,C.muted,{maxWidth:860});
   cv.line(294,451,1552,451,1,'#303a46');
   const st=p&&p.estimated?null:hit.state,measured=st&&st.useAverage?st.averageKmh:p?p.speedKmh:fix&&fix.speedKmh;
   txt(cv,(st&&st.useAverage?(st.partialSection?'ЧАСТ. СРЕДНЯЯ ':'СРЕДНЯЯ '):'СКОРОСТЬ ')+(Number.isFinite(measured)?Math.round(measured):'—')+' КМ/Ч',320,489,28,st&&st.speeding?C.red:C.text,{maxWidth:620});
   const lowAccuracy=valid&&fix.warningAccuracyState==='degraded'&&!(p&&p.estimated);
   txt(cv,lowAccuracy?gpsMessage('degraded'):hit.active?'АКТИВНОЕ УВЕДОМЛЕНИЕ':'ВПЕРЕДИ · РАДИУС 4.2 КМ',1550,487,20,lowAccuracy?C.yellow:C.muted,{align:'right',maxWidth:600});
  }
  drawTabs(cv,'RADAR');return ui.image('MAIN_GFX',cv);
 }
 function drawMainMap(){
  const cv=ctx.canvas(W,H).clear(C.bg);style.heading(cv,'КАРТА КАМЕР',CITY_LABELS[city]||city);
  drawMap(cv);drawPanel(cv);drawZoomButtons(cv);drawTabs(cv,'MAP');drawActionLegend(cv,'MAP');
  return ui.image('MAIN_GFX',cv);
 }
 function syncNativeButtons(){
  const buttonView=cityMaps.notice?'HDD_DIALOG':view;if(buttonView===nativeButtonView)return;nativeButtonView=buttonView;
  for(const id of nativeActionIds)for(const method of ['visible','enabled']){
   const extra=['BTN_REFRESH','BTN_VOICE_TEST','BTN_CAMERA_MENU'].includes(id);
   const hidden=!!cityMaps.notice||(view==='ENGINEERING'||view==='MOTION_DIAGNOSTICS'||view==='HUD_POSITION'||view==='NOTIFICATION_TYPES'||audioPage())||extra&&(view==='SETTINGS'&&id!=='BTN_REFRESH'||view==='MAP'&&id!=='BTN_REFRESH'||id==='BTN_CAMERA_MENU'&&(view==='ADD'||view==='MY'));
   if(typeof ui[method]==='function')Promise.resolve(ui[method](id,!hidden)).catch(e=>log.warn('BUTTON_STATE_FAILED '+id+' '+String(e)));
  }
 }
 function render(){syncBackgroundNotification();if(!mainScreenVisible)return;if(languageFirst||view==='LANGUAGE')return drawLanguage();syncNativeButtons();if(cityMaps.notice)return drawHddDialog();if(view==='NOTIFICATION_TYPES')return drawTypes();if(view==='CITY_MAPS')return drawCityMaps();if(view==='HUD_POSITION')return drawHudPosition();if(view==='MOTION_DIAGNOSTICS')return drawMotionDiagnostics();if(view==='AUDIO_WIZARD')return drawAudioWizard();if(view==='AUDIO_CHANNELS')return drawAudioChannels();if(view==='RADAR')return drawRadar();if(view==='ENGINEERING')return drawEngineering();if(view==='ADD')return drawAddCamera();if(view==='MY')return drawMyCameras();if(view==='SETTINGS')return drawSettings();return drawMainMap();}
 let renderQueued=false,renderRunning=false,renderTimer=null,lastRenderAt=0,renderCount=0;
 function animatedScreen(){return mainScreenVisible&&((notificationPolicy.destination()==='canvas'&&activeAlert&&Date.now()<alertUntil)||view==='MAP'&&(mapPulseVisible||refreshBusy));}
 function softwareScreen(){return !!(ctx.display&&typeof ctx.display.active==='function'&&!ctx.display.active('MAIN'));}
 function renderSafe(){
  renderQueued=true;
  if(renderRunning||renderTimer)return;
  // HMI must encode a whole PNG per frame. Keep animation but cap that path at 4 fps.
  const frameMs=(animatedScreen()||view==='RADAR'&&presentation)?(softwareScreen()?250:100):500;
  const delay=Math.max(0,frameMs-(Date.now()-lastRenderAt));
  renderTimer=setTimeout(()=>{
   renderTimer=null;
   if(renderRunning)return;
   renderQueued=false;renderRunning=true;
   const started=Date.now();
   Promise.resolve().then(render).catch(e=>log.warn('UI_RENDER_FAILED '+String(e&&e.stack||e))).then(()=>{
    const elapsed=Date.now()-started;lastRenderAt=Date.now();renderRunning=false;renderCount++;
    if(elapsed>250)log.warn('UI_RENDER_SLOW ms='+elapsed+' count='+renderCount+' view='+view);
    if(renderQueued)renderSafe();
   });
  },delay);
 }
 function gpsChanged(s){if(recovery.tick())return;const previousHealth=gpsHealth(fix,Date.now()),hadAlert=!!activeAlert;const nextSource=s&&s.fix&&(s.fix.positionSource||'nmea');
  if(nextSource&&gps.lastAppliedSource&&nextSource!==gps.lastAppliedSource){gpsQuality.reset();approachTrajectory.reset();gpsTrack=[];captureFixes=[];cameraDraft=null;motion.reset();motion.lastGps=null;motion.previousGps=null;clearLiveAlerts();notificationSession.clear();mapcamWarnings.reset();roadGuidance.reset();}
  if(nextSource)gps.lastAppliedSource=nextSource;
  gpsStatus=s||gpsStatus;fix=gpsQuality.update(s&&s.fix?s.fix:null,Date.now());motion.observeGps(fix);if(fix){
  mapOrientation.update(fix);
  if((trustedPosition(fix)||Number.isFinite(fix.accuracyM)&&fix.accuracyM<=15)&&Number.isFinite(fix.speedKmh)&&fix.speedKmh>=8&&Number.isFinite(fix.headingDeg)){
   let prev=gpsTrack[gpsTrack.length-1];let dx=prev?(fix.lon-prev.lon)*111320*Math.cos(fix.lat*Math.PI/180):Infinity,dy=prev?(fix.lat-prev.lat)*111320:Infinity;
   if(prev&&(fix.timeMs-prev.timeMs>5000||Math.hypot(dx,dy)>80)){gpsTrack=[];prev=null;dx=Infinity;dy=Infinity;}
   if(!prev||Math.hypot(dx,dy)>=4){gpsTrack.push({lat:fix.lat,lon:fix.lon,headingDeg:fix.headingDeg,timeMs:fix.timeMs});while(gpsTrack.length>160)gpsTrack.shift();while(gpsTrack.length>2){const a=gpsTrack[0],b=gpsTrack[gpsTrack.length-1],dist=Math.hypot((b.lon-a.lon)*111320*Math.cos(b.lat*Math.PI/180),(b.lat-a.lat)*111320);if(dist<=900)break;gpsTrack.shift();}}
  }
  const capturePosition=trustedPosition(fix)?gps.captureFix():fix;
  if(addScreenActive&&!capturePosition){captureStatus=gpsMessage('capture');captureFixes=[];}
  if(addScreenActive&&capturePosition&&Number.isFinite(capturePosition.timeMs)&&(!captureFixes.length||capturePosition.timeMs>captureFixes[captureFixes.length-1].timeMs)){
   if(!Number.isFinite(capturePosition.accuracyM)||capturePosition.accuracyM>15){captureStatus=gpsMessage('capture');captureFixes=[];}
   else if(!Number.isFinite(capturePosition.speedKmh)||capturePosition.speedKmh>5){captureStatus='Остановитесь рядом с камерой';captureFixes=[];}
   else {captureFixes.push({lat:capturePosition.lat,lon:capturePosition.lon,accuracyM:capturePosition.accuracyM,timeMs:capturePosition.timeMs});if(captureFixes.length>5)captureFixes.shift();captureStatus='Сбор координат: '+captureFixes.length+'/5';if(captureFixes.length===5){const lat=captureFixes.reduce((a,x)=>a+x.lat,0)/5,lon=captureFixes.reduce((a,x)=>a+x.lon,0)/5,accuracy=Math.max(...captureFixes.map(x=>x.accuracyM)),spread=Math.max(...captureFixes.map(x=>Math.hypot((x.lat-lat)*111320,(x.lon-lon)*111320*Math.cos(lat*Math.PI/180))));if(spread>15){cameraDraft=null;captureStatus=gpsMessage('unstable');captureFixes.shift();}else{cameraDraft={lat,lon,accuracyM:accuracy};captureStatus='Координаты получены';}}}
  }
  updateWarnings();}else{handleGpsLoss();}
  if(['MAP','RADAR','ADD','ENGINEERING','MOTION_DIAGNOSTICS'].includes(view)||animatedScreen()||hadAlert!==!!activeAlert||previousHealth!==gpsHealth(fix,Date.now()))renderSafe();}
 function updateWarnings(){
  if(hudEditor.busy)return;
  if(audioPage()){if(view==='AUDIO_CHANNELS'&&audioDiagnostics.moving()&&audioDiagnostics.busy)audioDiagnostics.stop();if(view==='AUDIO_WIZARD'&&audioWizard.moving()&&(audioWizard.busy||audioWizard.report&&audioWizard.report.status==='running'))audioWizard.stop('Движение: тест остановлен');clearLiveAlerts();return;}
  if(!notificationPolicy.monitoring()){radarCamera=null;mapcamWarnings.suspend();roadGuidance.reset();clearLiveAlerts();return;}
  const now=Date.now();
  if(!mapcamFreshFix(fix,now)){handleGpsLoss();return;}
  syncGpsOutput();
  if(gpsSuspended){gpsSuspended=false;clusterOutput.clear();}
  const near=monitoringCameras().filter(c=>!notificationTypes.hazardKind(c)||bannerEnabled(c)||voiceEnabled(c));
  const trajectory=withDensity(approachTrajectory.update(fix,now),near);
  // Moderate accuracy changes the display label, not acquisition or audio rules.
  const events=mapcamWarnings.update(fix,near,now,trajectory).concat(roadGuidance.update(fix,localCameras,now));
  const states=Object.assign({},roadGuidance.states,mapcamWarnings.states);
  Object.keys(states).forEach(id=>{states[id].accuracyDegraded=fix.warningAccuracyState==='degraded';states[id].trajectory=trajectoryAlignment(states[id].camera,trajectory,states[id]);});
  const current=notificationSession.update(states,fix,mapcamWarnings.heading,events);
  const visualCurrent=notificationSession.visualCurrent;
  radarCamera=selectRadar(visualCurrent,near.filter(bannerEnabled),fix,mapcamWarnings.heading,roadGuidance,trajectory);
  motion.anchor(radarCamera,fix);presentation=motion.value();
  events.forEach(e=>{
   if(e.type==='end')lastAlert='КОНТРОЛЬ ЗАВЕРШЁН · '+e.camera.name;
   if(e.type!=='voice')log.info('WARNING '+e.type+' camera='+e.camera.id+' distance='+e.distanceM);
  });
  if(visualCurrent){
   const st=visualCurrent,c=st.camera;
   if(c){const e={camera:c,distanceM:st.distanceM,type:st.speeding?'speeding':'camera',speeding:st.speeding,
    phase:st.phase,speedKmh:Number.isFinite(st.speedKmh)?Math.round(st.speedKmh):null,measuredSpeedKmh:st.speedKmh,averageKmh:st.averageKmh,
    useAverage:st.useAverage,partialSection:st.partialSection,accuracyDegraded:st.accuracyDegraded};
    activeAlert=e;alertUntil=now+3500;lastAlert=(e.phase==='section'?'ДО КОНЦА УЧАСТКА ':e.phase==='rear'?'ЗА КАМЕРОЙ ':'КАМЕРА ЧЕРЕЗ ')+Math.round(e.distanceM)+' м';
    if(!clusterOutput.current||clusterOutput.current.camera.id!==c.id)clusterOutput.show(e);
   }
   clusterOutput.sync(states);
  }else if(activeAlert){clearLiveAlerts(true,true);}
  syncBackgroundNotification();
 }
 function handleGpsLoss(){
  if(hudEditor.busy)return;
  const repaintLostMap=!gpsSuspended&&mainScreenVisible&&view==='MAP';
  if(!gpsSuspended){
   approachTrajectory.reset();
   gpsSuspended=true;mapcamWarnings.suspend();roadGuidance.reset();
   // Cancel queued announcements and endpoint confirmation; calculated positions
   // are NEVER passed to the warning engines or the database query.
   clearLiveAlerts(false,true);
  }
  presentation=notificationPolicy.monitoring()&&!audioPage()?motion.value():null;
  if(presentation&&presentation.estimated){
   const p=presentation;
   if(!clusterOutput.current)clusterOutput.show({camera:p.hit.camera,distanceM:p.distanceM,
    type:'camera',estimated:true,phase:p.hit.state&&p.hit.state.phase,speedKmh:p.speedKmh});
  }else{radarCamera=null;if(clusterOutput.current&&clusterOutput.current.camera.id!=='camera-output-test')clusterOutput.clear();}
  syncGpsOutput();
  if(repaintLostMap)renderSafe();
 }
 function motionTick(){
  if(hudEditor.busy)return;
  if(!mapcamFreshFix(fix,Date.now()))handleGpsLoss();
  else presentation=motion.value();
  const p=presentation,c=clusterOutput.current;
  if(p&&c&&c.camera.id===p.hit.camera.id&&typeof clusterOutput.updateDistance==='function')clusterOutput.updateDistance(p.distanceM,p.estimated);
  const key=p?[p.hit.camera.id,Math.round(p.distanceM),Math.round(p.speedKmh),p.estimated].join(':'):'';
  if(key!==lastMotionPaintKey&&mainScreenVisible&&(view==='RADAR'||notificationPolicy.destination()==='canvas'&&activeAlert&&Date.now()<alertUntil))renderSafe();
  lastMotionPaintKey=key;
 }
 function syncBackgroundNotification(){
  syncBeeper();
  notificationPolicy.view=view;
  const live=activeAlert&&Date.now()<alertUntil&&mapcamFreshFix(fix,Date.now());
  backgroundNotification.update(live&&notificationPolicy.destination()==='system'?centralDistance(activeAlert,presentation):null,fix&&fix.speedKmh);
 }

 function showRefreshError(error){
  const message=updateFailure(error);refreshStatus=message.title;refreshDetails=message.lines;refreshError=true;
  log.warn('DB refresh '+String(error&&error.message||error));
 }
 async function refresh(){if(refreshInFlight)return refreshInFlight;refreshBusy=true;refreshStartedAt=monotonicMs();refreshError=false;refreshDetails=[];refreshStatus='Проверка обновлений...';renderSafe();refreshInFlight=store.refresh((state)=>{refreshStatus=state;renderSafe();}).then(r=>{database=r.database;if(r.updated){cameraIndex=database;displayCache=null;radarCamera=null;index=0;roadGuidance.reset();mapcamWarnings.reset();notificationSession.clear();clearLiveAlerts();refreshStatus='База обновлена';refreshError=false;}else if(r.error){showRefreshError(r.error);}else{refreshStatus=r.message||'База актуальна';refreshError=false;}renderSafe();return r;}).catch(e=>{showRefreshError(e);renderSafe();return {error:String(e)};}).then(r=>{refreshBusy=false;refreshInFlight=null;renderSafe();return r;});return refreshInFlight;}
 const CAMERA_TYPES=['Камера скорости','Контроль светофора','Скорость + светофор'];
 let displayedRenderMode=null;
 function currentRenderMode(){return ctx.display&&typeof ctx.display.active==='function'&&ctx.display.active('MAIN')?'GPU':'PNG';}
 function drawTabs(cv,active){
  displayedRenderMode=currentRenderMode();
  if(ctx.display)ctx.display.cameraNavState={active,version:APP_VERSION,renderMode:displayedRenderMode};
  style.drawNav(cv,active,APP_VERSION,displayedRenderMode);
  if(forceAudioEnabled()){const n=style.nav;txt(cv,'ТЕСТ ЗВУКА: ВСЕГДА',n.x+12,n.y+4*(n.h+n.gap)+20,15,C.yellow,{maxWidth:n.w-24});}
  style.tabs.forEach(([id],i)=>{const n=style.nav,y=n.y+i*(n.h+n.gap);
   pageTarget(cv,n.x,y,n.w,n.h,()=>handlePageTap(n.x+n.w/2,y+n.h/2),'nav-'+id);
  });
 }
 function drawActionLegend(cv,mode){
  const items=mode==='ADD'?['ЛИМИТ −','ЛИМИТ +','ТИП','НАПРАВЛЕНИЕ','СОХРАНИТЬ']:
   mode==='MAP'?['НАЗАД','ВПЕРЁД','МАСШТАБ','ОБНОВИТЬ БД']:
   mode==='SETTINGS'?['НАЗАД','ВПЕРЁД','УВЕДОМЛЕНИЯ','ДИСПЛЕИ']:
   ['НАЗАД','ВПЕРЁД','УДАЛИТЬ','ПОДТВЕРДИТЬ','ДОБАВИТЬ'];
  const mapRow=mode==='MAP',centered=mapRow||mode==='ADD'||mode==='MY'||mode==='SETTINGS',gap=mapRow?10:12,rowWidth=mapRow?MAP.w:style.content.w,width=centered?(rowWidth-gap*(items.length-1))/items.length:207;
  items.forEach((label,i)=>{const x=(mapRow?MAP.x:266)+i*(width+gap);cv.roundRect(x,ACTION_BAR.y,width,ACTION_BAR.h,0,C.panel);txt(cv,(i+1)+'  '+label,centered?x+width/2:x+14,ACTION_BAR.baseline,17,C.muted,{align:centered?'center':'left',maxWidth:width-28});
   if(label!=='—')pageTarget(cv,x,ACTION_BAR.y,width,ACTION_BAR.h,()=>{settingsTaps=0;lastSettingsTap=0;const run=actionHandlers[ACTION_IDS[i]];if(run)run();},'action-'+ACTION_IDS[i]);
  });
 }
 function openView(target){
  if(view==='HUD_POSITION')hudEditor.stop();
  if(view==='AUDIO_CHANNELS')audioDiagnostics.stop();
  if(view==='AUDIO_WIZARD')audioWizard.stop();
  if(['MAP','RADAR','ADD','MY','SETTINGS'].indexOf(target)<0)return;
  if(target!=='ADD')addScreenActive=false;
  if(target==='MAP'||target==='RADAR'){view=target;}
  else if(target==='MY'){view='MY';localCameraIndex=0;deletePending=false;}
  else if(target==='ADD'){view='ADD';deletePending=false;beginAddCamera();}
  else{view='SETTINGS';}
  log.info('TOUCH_TAB_OPEN '+target);
  renderSafe();
 }
 function handlePageTap(x,y){
  if(!Number.isFinite(x)||!Number.isFinite(y))return;
  if(languageFirst||view==='LANGUAGE'){languagePanel.tap(x,y,languageFirst);return;}
  if(cityMaps.notice){hddDialog.tap(x,y);return;}
  const tab=style.tabAt(x,y);
  if(tab)require('./controller-navigation').focusTab(ctx.display,tab);
  if(tab==='SETTINGS'){
   const now=Date.now();settingsTaps=now-lastSettingsTap<=3000?settingsTaps+1:1;lastSettingsTap=now;
   if(settingsTaps===10){if(view==='HUD_POSITION')hudEditor.stop();if(view==='AUDIO_WIZARD')audioWizard.stop();if(view==='AUDIO_CHANNELS')audioDiagnostics.stop();settingsTaps=0;lastSettingsTap=0;addScreenActive=false;view='ENGINEERING';renderSafe();return;}
   openView(tab);return;
  }
  settingsTaps=0;lastSettingsTap=0;
  if(tab){openView(tab);return;}
  if(view==='AUDIO_CHANNELS'){audioDiagnostics.tap(x,y);return;}
  if(view==='AUDIO_WIZARD'){audioWizard.tap(x,y);return;}
  if(view==='HUD_POSITION'){hudEditor.tap(x,y);return;}
  if(view==='NOTIFICATION_TYPES'){typePanel.tap(x,y);return;}
  if(view==='CITY_MAPS'){cityMapPanel.tap(x,y);return;}
  if(view==='SETTINGS'&&!warningSettings&&x>=1220&&x<1560&&y>=330&&y<380){openLanguage();return;}
  if(view==='SETTINGS'&&!warningSettings&&x>=1220&&x<1560&&y>=270&&y<320){openCityMaps();return;}
  if(view==='SETTINGS'&&warningSettings&&x>=850&&x<1190&&y>=12&&y<56){openMixerSettings();return;}
  if(view==='SETTINGS'&&!warningSettings&&x>=850&&x<1190&&y>=12&&y<56){closeProgram();return;}
  if(view==='SETTINGS'&&x>=1220&&x<1580&&y>=12&&y<56){openHudPosition();return;}
  if(view==='MOTION_DIAGNOSTICS'){if(x>=266&&x<1580&&y>=442&&y<502){view='ENGINEERING';renderSafe();}return;}
  if(view==='ENGINEERING'){
   if(x>=1220&&x<1580&&y>=12&&y<56){openMotionDiagnostics();return;}
   if(y>=442&&y<502&&x>=266&&x<1580){const i=Math.floor((x-266)/670);if((x-266)%670<644)engineeringTools()[i][1]();return;}
   if(y>=366&&y<430){if(x>=266&&x<916)testCameraOutputs();else if(x>=936&&x<1580)openView('SETTINGS');}
   return;
  }
  if(view==='MAP'){
   if(mapPreview&&x>=MAP.x+190&&x<MAP.x+420&&y>=MAP.y+5&&y<MAP.y+35){mapPreview=null;renderSafe();return;}
   const button=ZOOM_BUTTONS.find(b=>x>=b.x&&x<b.x+b.w&&y>=b.y&&y<b.y+b.h);
   if(button){changeZoom(button.step,false);return;}
   const cameraButton=CAMERA_BUTTONS.find(b=>x>=b.x&&x<b.x+b.w&&y>=b.y&&y<b.y+b.h);
   if(cameraButton){changeSelectedCamera(cameraButton.step);return;}
  }
  if(view==='SETTINGS'&&warningSettings&&x>=288&&x<1558){
   const row=Math.floor((y-88)/WARNING_ROW_STEP);
   if(row>=0&&row<warningRows.length&&y<88+row*WARNING_ROW_STEP+WARNING_ROW_HEIGHT){warningSettingIndex=row;if(warningRows[row].key==='notification_volume'&&x>=1370){if(x<1440)changeVolume(-1);else if(x>=1470&&x<1540)changeVolume(1);}else changeWarningSetting();}return;
  }
  if(view==='SETTINGS'&&!warningSettings&&y>=142&&y<246){
   const column=Math.floor((x-290)/319);
   if(column>=0&&column<4&&x<290+column*319+295)setDisplayMode(DISPLAY_MODES[column]);
  }
 }
 function cycleView(){
  const tabs=style.tabs.map(t=>t[0]),i=tabs.indexOf(view);
  settingsTaps=0;lastSettingsTap=0;openView(tabs[(i+1)%tabs.length]);
 }
 const renderAddSafe=()=>Promise.resolve().then(drawAddCamera).catch(e=>log.warn('add-camera render: '+e));
 function beginAddCamera(){addScreenActive=true;captureFixes=[];cameraDraft=null;captureStatus=gpsMessage('waiting');cameraLimit=60;cameraType=0;cameraDirection='forward';}
 function addCameraRoad(lat,lon){
  const pts=[];const cos=Math.cos(lat*Math.PI/180);
  gpsTrack.forEach(p=>{const q=[(p.lon-lon)*111320*cos,(p.lat-lat)*111320];const prev=pts[pts.length-1];if(!prev||Math.hypot(q[0]-prev[0],q[1]-prev[1])>=3)pts.push(q);});
  const last=pts[pts.length-1],gap=last?Math.hypot(last[0],last[1]):Infinity;
  if(gap>40)return null;
  if(!last||gap>1)pts.push([0,0]);
  if(pts.length<3)return null;
  let length=0;for(let i=1;i<pts.length;i++)length+=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);
  if(length<80||length>1100)return null;
  return {pts,camM:length};
 }
 function drawAddCamera(){
  const cv=ctx.canvas(W,H).clear(C.bg);style.heading(cv,'ДОБАВИТЬ КАМЕРУ','ЛОКАЛЬНОЕ СОХРАНЕНИЕ');
  cv.roundRect(266,74,1314,398,0,C.panel);
  txt(cv,'КООРДИНАТЫ GPS',290,113,21,C.muted,{maxWidth:1230});
  txt(cv,cameraDraft?cameraDraft.lat.toFixed(6)+' , '+cameraDraft.lon.toFixed(6):gpsMessage('waiting'),290,156,31,cameraDraft?C.text:C.yellow,{maxWidth:1230});
  txt(cv,captureStatus,290,192,20,C.muted,{maxWidth:1230});
  ln(cv,[290,216],[1556,216],1,'#303a46');
  style.speedSign(cv,cameraLimit,345,291,51);
  txt(cv,'ОГРАНИЧЕНИЕ',416,278,20,C.muted,{maxWidth:250});txt(cv,cameraLimit+' КМ/Ч',416,315,30,C.text,{maxWidth:250});
  txt(cv,'ТИП КАМЕРЫ',710,265,20,C.muted,{maxWidth:390});txt(cv,CAMERA_TYPES[cameraType],710,306,27,C.text,{maxWidth:390});
  txt(cv,'НАПРАВЛЕНИЕ',1140,265,20,C.muted,{maxWidth:395});txt(cv,cameraDirection==='forward'?'ПО ПРОЕЗДУ':'ОБА НАПРАВЛЕНИЯ',1140,306,25,C.text,{maxWidth:395});
  ln(cv,[290,357],[1556,357],1,'#303a46');
  const road=cameraDraft?addCameraRoad(cameraDraft.lat,cameraDraft.lon):null;
  txt(cv,road?'ДОРОЖНАЯ ТРАЕКТОРИЯ ЗАПИСАНА':'ДЛЯ ПРИВЯЗКИ НУЖНА GPS-ТРАЕКТОРИЯ ПОДЪЕЗДА',290,394,20,C.muted,{maxWidth:1230});
  txt(cv,'ДОБАВЛЯЙТЕ КАМЕРУ НА СТОЯНКЕ',290,432,20,C.muted,{maxWidth:1230});
  drawTabs(cv,'ADD');drawActionLegend(cv,'ADD');return ui.image('MAIN_GFX',cv);
 }
 let localCameraIndex=0,deletePending=false;
 function drawMyCameras(){
  const cv=ctx.canvas(W,H).clear(C.bg);style.heading(cv,'МОИ КАМЕРЫ','СОХРАНЕНО: '+localCameras.length);cv.roundRect(266,74,1314,398,0,C.panel);
  if(!localCameras.length){
   cameraIcon.drawCanvas(cv,880,124,86,71,[245,249,252]);
   txt(cv,'ПОКА НЕТ СОХРАНЁННЫХ КАМЕР',923,265,34,C.text,{align:'center',maxWidth:1180});
   txt(cv,'ВЫБЕРИТЕ «ДОБАВИТЬ» В МЕНЮ СЛЕВА',923,319,23,C.muted,{align:'center',maxWidth:1180});
  }else{
   localCameraIndex=Math.max(0,Math.min(localCameraIndex,localCameras.length-1));const c=localCameras[localCameraIndex];
   txt(cv,(localCameraIndex+1)+' / '+localCameras.length,290,113,22,C.muted,{maxWidth:1020});
   txt(cv,c.type||c.name||'КАМЕРА',290,166,34,C.text,{maxWidth:1060});
   txt(cv,c.lat.toFixed(6)+' , '+c.lon.toFixed(6),290,216,28,C.text,{maxWidth:1060});
   if(!notificationTypes.hazardKind(c)&&!policeKind(c)&&Number.isFinite(c.limit)&&c.limit>0)style.speedSign(cv,c.limit,1476,166,54);
   else if(!policeKind(c))txt(cv,'ЛИМИТ Н/Д',1420,173,18,C.muted,{maxWidth:135});
   txt(cv,'НАПРАВЛЕНИЕ: '+(c.direction==='both'?'ОБА НАПРАВЛЕНИЯ':'ПО ДВИЖЕНИЮ'),290,277,24,C.muted,{maxWidth:1230});
   txt(cv,c.road?'ДОРОЖНАЯ ПРИВЯЗКА: ЕСТЬ':'ДОРОЖНАЯ ПРИВЯЗКА: НЕТ',290,328,24,C.muted,{maxWidth:1230});
   txt(cv,'ДОБАВЛЕНА ВРУЧНУЮ',290,408,19,C.muted,{maxWidth:1230});
  }
  if(deletePending){cv.roundRect(326,165,1194,190,0,'#1d0d10');cv.strokeRoundRect(326,165,1194,190,0,2,C.red);txt(cv,'УДАЛИТЬ ЭТУ КАМЕРУ?',923,232,34,C.text,{align:'center',maxWidth:1120});txt(cv,'4 — ПОДТВЕРДИТЬ УДАЛЕНИЕ ЛОКАЛЬНОЙ ЗАПИСИ',923,289,23,C.muted,{align:'center',maxWidth:1120});}
  drawTabs(cv,'MY');drawActionLegend(cv,'MY');return ui.image('MAIN_GFX',cv);
 }
 function renderMyCamerasSafe(){Promise.resolve().then(drawMyCameras).catch(e=>log.warn('my cameras render: '+e));}
 function removeSelectedCamera(){if(!deletePending)return;const c=localCameras[localCameraIndex];if(!c){deletePending=false;renderMyCamerasSafe();return;}try{if(!localStore.remove(c.id))throw new Error('Камера не найдена в локальном хранилище');localCameras=localCameras.filter(x=>x.id!==c.id);delete roadGuidance.zones[c.id];roadGuidance.reset();deletePending=false;localCameraIndex=Math.max(0,Math.min(localCameraIndex,localCameras.length-1));index=0;lastAlert='Пользовательская камера удалена';alertUntil=Date.now()+8000;log.info('LOCAL_CAMERA_REMOVED id='+c.id);renderMyCamerasSafe();}catch(e){log.warn('LOCAL_CAMERA_REMOVE_FAILED '+e);deletePending=false;renderMyCamerasSafe();}}
 function saveLocalCamera(){
  if(!cameraDraft||!Number.isFinite(cameraDraft.lat)||!Number.isFinite(cameraDraft.lon))return;
  const duplicate=monitoringCameras().find(c=>Number.isFinite(c.lat)&&Number.isFinite(c.lon)&&Math.hypot((c.lat-cameraDraft.lat)*111320,(c.lon-cameraDraft.lon)*111320*Math.cos(cameraDraft.lat*Math.PI/180))<20);
  if(duplicate){captureStatus='Рядом уже есть камера: '+duplicate.name;renderAddSafe();return;}
  const road=addCameraRoad(cameraDraft.lat,cameraDraft.lon);
  const id='local-'+Date.now().toString(36);
  const camera={id,lat:cameraDraft.lat,lon:cameraDraft.lon,limit:cameraType===1?null:cameraLimit,type:CAMERA_TYPES[cameraType],direction:cameraDirection,road};
  const saved=localStore.add(camera);localCameras.push(saved);
  if(road){roadGuidance.zones[id]=prepare({id,lat:saved.lat,lon:saved.lon,roads:[{id:'user-road-'+id,pts:road.pts,camM:road.camM,dir:cameraDirection==='forward'?1:0}]});roadGuidance.reset();}
  index=Math.max(0,cameras().length-1);lastAlert=road?'Камера добавлена · дорожная привязка готова':'Камера сохранена · дорожную траекторию нужно записать';alertUntil=Date.now()+10000;
  log.info('LOCAL_CAMERA_ADDED id='+id+' roadGeometry='+(road?'yes':'no')+' accuracy='+cameraDraft.accuracyM);
  addScreenActive=false;view='MY';renderSafe();
 }
 ctx.onTap(handlePageTap);
 bindAction('BTN_CAMERA_MENU',()=>{if(view!=='MAP'&&view!=='ADD'&&view!=='MY'&&view!=='SETTINGS')cycleView();});
 bindAction('BTN_CAM_PREV',()=>{if(view==='RADAR')return;if(view==='ENGINEERING'){openView('SETTINGS');return;}if(view==='SETTINGS'){if(warningSettings){warningSettingIndex=(warningSettingIndex+warningRows.length-1)%warningRows.length;renderSafe();}else cycleDisplayMode(-1);return;}if(view==='ADD'){cameraLimit=Math.max(20,cameraLimit-10);renderSafe();}else if(view==='MY'){deletePending=false;localCameraIndex=Math.max(0,localCameraIndex-1);renderSafe();}else{changeSelectedCamera(-1);}});
 bindAction('BTN_CAM_NEXT',()=>{if(view==='RADAR')return;if(view==='ENGINEERING'){return;}if(view==='SETTINGS'){if(warningSettings){warningSettingIndex=(warningSettingIndex+1)%warningRows.length;renderSafe();}else cycleDisplayMode(1);return;}if(view==='ADD'){cameraLimit=Math.min(130,cameraLimit+10);renderSafe();}else if(view==='MY'){deletePending=false;localCameraIndex=Math.min(Math.max(0,localCameras.length-1),localCameraIndex+1);renderSafe();}else{changeSelectedCamera(1);}});
 bindAction('BTN_ZOOM',()=>{if(view==='RADAR')return;if(view==='ENGINEERING'){return;}if(view==='SETTINGS'){warningSettings=true;renderSafe();return;}if(view==='ADD'){cameraType=(cameraType+1)%CAMERA_TYPES.length;renderSafe();}else if(view==='MY'){if(localCameras.length){deletePending=true;renderSafe();}}else{changeZoom(1,true);}});
 bindAction('BTN_REFRESH',()=>{if(view==='ENGINEERING'){return;}if(view==='SETTINGS'){warningSettings=false;renderSafe();return;}if(view==='ADD'){cameraDirection=cameraDirection==='forward'?'both':'forward';renderSafe();}else if(view==='MY'){removeSelectedCamera();}else refresh();});
 bindAction('BTN_VOICE_TEST',()=>{if(view==='MAP'||view==='SETTINGS')return;if(view==='ADD'){saveLocalCamera();return;}if(view==='MY'){deletePending=false;beginAddCamera();view='ADD';renderSafe();return;}testCameraOutputs();});
 settings.onChange(k=>{if(k==='ui_language'){i18n.setLanguage(settings.get(k));applyNativeLanguage();renderSafe();return;}if(k.indexOf('notification_banner_type_')===0||k.indexOf('notification_voice_type_')===0){notificationSession.clear();clearLiveAlerts();updateWarnings();renderSafe();return;}if(k==='audio_force_notifications'){notificationSession.clear();beeper.stop();updateWarnings();renderSafe();return;}if(k==='notification_volume'||k==='notification_beeper'){syncBeeper();renderSafe();return;}if(k==='auto_monitor'){if(k==='auto_monitor'&&!notificationPolicy.monitoring()){radarCamera=null;mapcamWarnings.suspend();roadGuidance.reset();clearLiveAlerts();}syncBackgroundNotification();renderSafe();return;}if(k.indexOf('mapcam_')===0){mapcamWarnings.configure(mapcamOptions());roadGuidance.configure(mapcamOptions());clearLiveAlerts();renderSafe();return;}if(k==='city'){city=String(settings.get('city')||'russia');index=0;roadGuidance.reset();renderSafe();}else if(k==='camera_display'){cameraDisplayMode=String(settings.get('camera_display')||'kombi');clusterOutput.setMode(cameraDisplayMode);renderSafe();}});
 gps.on('change',gpsChanged);gps.start();ui.onVisible((n,v)=>{if(n==='MAIN'){if(!v&&view==='HUD_POSITION'){hudEditor.stop();view='SETTINGS';warningSettings=true;}if(!v&&audioPage()){if(view==='AUDIO_WIZARD')audioWizard.stop('Приложение скрыто: тест остановлен');else audioDiagnostics.stop();view='ENGINEERING';}mainScreenVisible=!!v;notificationPolicy.setVisible(v);syncBackgroundNotification();if(v)renderSafe();}});
 // This timer is independent of ctx.loop(), which stops when MAIN is hidden.
 const motionTimer=setInterval(motionTick,100);
 const backgroundTimer=setInterval(()=>{hudEditor.tick();if(!mapcamFreshFix(fix,Date.now()))handleGpsLoss();syncBackgroundNotification();},250);
 recovery.start();
 if(ctx.app&&typeof ctx.app.on==='function'){
  ctx.app.on('appStatusProxyReady',()=>recovery.recover('СВЯЗЬ MGU'));
  ctx.app.on('shutdown',()=>{recovery.stop();hudEditor.stop();audioWizard.stop('Выключение приложения');audioDiagnostics.stop();clearInterval(motionTimer);vehicleSpeed.close();clearInterval(backgroundTimer);clearInterval(audioHealthTimer);clearInterval(refreshTimer);audioHealth.close();gps.stop();clearLiveAlerts();store.close();cityMaps.close();clusterOutput.close();});
 }
 if(typeof ctx.onLayout==='function')ctx.onLayout(()=>renderSafe());
 renderSafe();refresh();const refreshTimer=setInterval(refresh,REFRESH_INTERVAL_MS);ctx.loop('MAIN',10,()=>{if(fix&&Date.now()-fix.timeMs>3000)handleGpsLoss();
  // Keep a recovery repaint; static pages need neither 10 Hz drawing nor PNG work.
  if(displayedRenderMode!==currentRenderMode()||animatedScreen()||view==='ENGINEERING'||view==='MOTION_DIAGNOSTICS'||Date.now()-lastRenderAt>=5000)renderSafe();});
 log.info('SpeedCAM 0.9.102 started; camera sectors and control paths; GPS accuracy <=35 m; low-accuracy label >=15 m; KOMBI/HUD mode='+cameraDisplayMode);
}}).catch(e=>{
 console.error('SPEEDCAM_START_FAILED '+String(e&&e.stack||e));
 // Only the isolated worker may exit: the MainApp-owned supervisor stays alive.
 if(process.env.SPEEDCAM_SUPERVISED_WORKER==='1')process.exit(1);
});
