'use strict';
const mgu=require('./kit/mgu');
const uplink=require('./uplink');
const cityMap=require('./city-map.json');
const {CameraStore}=require('./disk-camera-store');
const {BmwGps}=require('./gps');
const {RoadGuidanceWarnings,prepare}=require('./road-guidance');
const {LocalCameraStore}=require('./local-camera-store');
const {CameraVoiceAlerts}=require('./voice-alert');
const {CameraClusterOutput}=require('./cluster-output');
const {MapcamWarnings,freshFix:mapcamFreshFix}=require('./mapcam-warnings');
const {category,hudLabels}=require('./camera-label');
const style=require('./screen-style');
const cameraIcon=require('./camera-icon');
const {drawCentralAlert}=require('./central-alert');
const {NotificationPolicy}=require('./notification-policy');
const {NotificationSession,selectRadar}=require('./notification-session');
const {gpsHealth}=require('./notification-rules');
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
 const {ui,settings,log,dataDir}=ctx;uplink.init(dataDir);log.info('UPLINK '+uplink.describe());uplink.checkInternet({timeout:3500}).then(ok=>log.info('UPLINK_HTTPS_PROBE '+(ok?'online':'offline')+'; '+uplink.describe())).catch(e=>log.warn('UPLINK_PROBE_ERROR '+e));let city=String(settings.get('city')||'russia'),view='MAP',index=0,zoom=.75,zoomIndex=1,fix=null,cameraDisplayMode=String(settings.get('camera_display')||'kombi'),gpsStatus={state:'starting',errorCode:null,eventsReceived:0,invalidEvents:0},lastAlert='Нет предупреждений',alertUntil=0,activeAlert=null;
 const store=new CameraStore({dataDir,bundledDir:__dirname,log:m=>log.info(m)});let database=(await store.loadLocal()).database;
 let cameraIndex=database,displayCache=null,mapPulseVisible=false,radarCamera=null;
 let mainScreenVisible=typeof ui.isVisible==='function'&&ui.isVisible('MAIN');
 const notificationPolicy=new NotificationPolicy(k=>settings.get(k),mainScreenVisible);
 const backgroundNotification=new BackgroundNotification(new RhmiPopupTransport(ui,m=>log.warn(m)),m=>log.info(m));
 const presentImage=ui.image.bind(ui);
 ui.image=(name,cv)=>{if(name==='MAIN_GFX'){
  drawAlertBanner(cv);
  if(!mapcamFreshFix(fix,Date.now())){cv.roundRect(1060,12,520,40,6,C.bg);style.text(cv,gpsHealth(fix,Date.now()),1566,40,18,C.yellow,{align:'right',maxWidth:495});}
 }return presentImage(name,cv);};
 const actionHandlers=Object.create(null);let nativeButtonView=null;
 require('./controller-navigation').install(ctx.display);
 function bindAction(id,fn){actionHandlers[id]=fn;ui.onClick(id,fn);}
 function pageTarget(cv,x,y,w,h,run,key){if(cv.recording===true&&typeof cv.target==='function')cv.target(x,y,w,h,run,key,8);}
 // The page owns these controls in the GPU layout; keep native HMI buttons as fallback.
 if(typeof ctx.hideButton==='function')ACTION_IDS.forEach(id=>ctx.hideButton(id));
 if(!database.cities[city])city='russia';
 const localStore=new LocalCameraStore(dataDir);let localCameras=localStore.load(),addScreenActive=false,captureFixes=[],cameraDraft=null,captureStatus='Ожидание GPS...',cameraLimit=60,cameraType=0,cameraDirection='forward',gpsTrack=[];
 const gps=new BmwGps(),roadGuidance=new RoadGuidanceWarnings([]),voice=new CameraVoiceAlerts({assetDir:__dirname,log:(m)=>log.warn(m)});
 const clusterOutput=new CameraClusterOutput({mode:cameraDisplayMode,log:(m)=>log.info(m)});let refreshInFlight=null,refreshBusy=false,refreshStartedAt=0,refreshError=false,refreshStatus='База готова';
 const mapcamOptions=()=>({voice:String(settings.get('mapcam_voice')||'always'),excessKmh:Number(settings.get('mapcam_excess')||0),distanceM:Number(settings.get('mapcam_distance')||0),repeat200:settings.get('mapcam_repeat200')!=='off'});
 const mapcamWarnings=new MapcamWarnings(mapcamOptions());
 roadGuidance.configure(mapcamOptions());
 const notificationSession=new NotificationSession(voice,mapcamOptions);
 localCameras.forEach(c=>{if(c.road)roadGuidance.zones[c.id]=prepare({id:c.id,lat:c.lat,lon:c.lon,roads:[{id:'user-road-'+c.id,pts:c.road.pts,camM:c.road.camM,dir:c.direction==='forward'?1:0}]});});
 let warningSettings=false,warningSettingIndex=0,settingsTaps=0,lastSettingsTap=0;
 const warningRows=[
  {key:'mapcam_voice',label:'Голос',values:['always','speeding','off'],labels:['Каждая камера','При превышении','Выключен']},
  {key:'mapcam_excess',label:'Порог превышения',values:['0','10','18','20'],labels:['Лимит камеры','Лимит + 10 км/ч','Лимит + 18 км/ч','Лимит + 20 км/ч']},
  {key:'mapcam_distance',label:'Дистанция',values:['0','500','700','1000','2000'],labels:['Из базы','500 м','700 м','1000 м','2000 м']},
  {key:'auto_monitor',label:'Автозапуск контроля',values:['on','off'],labels:['Включён','После открытия SpeedCAM']},
  {key:'central_notifications',label:'Центральный дисплей',values:['always','foreground','off'],labels:['В приложении и в фоне','Только в приложении','Выключен']},
  {key:'radar_no_duplicate',label:'Без дубля на «Радаре»',values:['on','off'],labels:['Включено','Выключено']},
  {key:'mapcam_repeat200',label:'Повтор за 200 м',values:['on','off'],labels:['Включён','Выключен']}
 ];
 function warningValue(r){const value=String(settings.get(r.key)||r.values[0]);return Math.max(0,r.values.indexOf(value));}
 function changeWarningSetting(){const r=warningRows[warningSettingIndex];settings.set(r.key,r.values[(warningValue(r)+1)%r.values.length]);if(r.key.indexOf('mapcam_')===0){mapcamWarnings.configure(mapcamOptions());roadGuidance.configure(mapcamOptions());clearLiveAlerts();}else syncBackgroundNotification();renderSafe();}
 function clearLiveAlerts(){activeAlert=null;alertUntil=0;backgroundNotification.clear();clusterOutput.clear();notificationSession.suspend();}
 function drawWarningSettings(){
  const cv=ctx.canvas(W,H).clear(C.bg);style.heading(cv,'УВЕДОМЛЕНИЯ','ГИБРИД · РОССИЯ');
  cv.roundRect(266,74,1314,398,10,C.panel);
  warningRows.forEach((r,i)=>{const y=88+i*51,on=i===warningSettingIndex;
   cv.roundRect(288,y,1270,46,8,on?'#251318':'#19212a');
   if(on)cv.strokeRoundRect(288,y,1270,46,8,2,C.red);
   txt(cv,r.label,310,y+31,23,C.text,{maxWidth:570});txt(cv,r.labels[warningValue(r)],900,y+31,23,C.text,{maxWidth:630});
  });
  txt(cv,'ФОНОВЫЙ БАННЕР: '+({unavailable:'НЕДОСТУПЕН',unverified:'ТРЕБУЕТ ПРОВЕРКИ НА MGU',requested:'ЗАПРОШЕН',visible:'ПОКАЗ ПОДТВЕРЖДЁН',hidden:'СКРЫТ',error:'ОШИБКА СВЯЗИ'}[backgroundNotification.status]||'ОЖИДАНИЕ'),290,458,17,C.muted,{maxWidth:1250});
  drawTabs(cv,'SETTINGS');drawActionLegend(cv,'SETTINGS');
  warningRows.forEach((r,i)=>pageTarget(cv,288,88+i*51,1270,46,()=>{warningSettingIndex=i;changeWarningSetting();},'warning-setting-'+r.key));
  return ui.image('MAIN_GFX',cv);
 }
 const cameras=()=>{
  if(city!=='russia')return database.recordsFor(city).concat(localCameras);
  const center=fix||{lat:56.630,lon:47.928};
  const key=center.lat+','+center.lon;
  if(!displayCache||displayCache.key!==key)displayCache={key,rows:cameraIndex.near(center,25000,500)};
  return displayCache.rows.concat(localCameras);
 };
 const monitoringCameras=()=>fix?(cameraIndex.nearWarnings?cameraIndex.nearWarnings(fix):cameraIndex.near(fix,4200)).concat(localCameras):localCameras;
 const mapped=()=>cameras().filter(c=>c&&typeof c.lat==='number'&&typeof c.lon==='number');
 const selected=()=>{const rows=cameras();index=Math.max(0,Math.min(index,rows.length-1));return rows[index]||null;};
 const txt=style.text;
 const ln=(cv,a,b,w,c)=>cv.line(a[0],a[1],b[0],b[1],w,c);
 function xy(lat,lon,center,scale){return [MAP.x+MAP.w/2+(lon-center.lon)*111320*Math.cos(center.lat*Math.PI/180)*scale,MAP.y+MAP.h/2+(center.lat-lat)*111320*scale];}
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
 function drawMap(cv){
  cv.roundRect(MAP.x,MAP.y,MAP.w,MAP.h,14,'#0d1219');
  const center=fix?{lat:fix.lat,lon:fix.lon}:(city==='mari-el'?{lat:56.58,lon:48.05}:{lat:56.630,lon:47.928}),scale=.145*zoom*(city==='mari-el'?.045:1);
  for(let x=MAP.x+40;x<MAP.x+MAP.w;x+=80)ln(cv,[x,MAP.y+8],[x,MAP.y+MAP.h-8],1,C.grid);
  for(let y=MAP.y+30;y<MAP.y+MAP.h;y+=60)ln(cv,[MAP.x+8,y],[MAP.x+MAP.w-8,y],1,C.grid);
  (city==='yoshkar-ola'?cityMap.roads:[]).forEach(r=>{
   const a=xy(r[1],r[2],center,scale),b=xy(r[3],r[4],center,scale);
   if(Math.max(a[0],b[0])<MAP.x||Math.min(a[0],b[0])>MAP.x+MAP.w||Math.max(a[1],b[1])<MAP.y||Math.min(a[1],b[1])>MAP.y+MAP.h)return;
   const clipped=clipMapLine(a,b);if(clipped){ln(cv,clipped[0],clipped[1],9,C.edge);ln(cv,clipped[0],clipped[1],5,C.road);}
  });
  const selectedId=(selected()||{}).id;let selectedPoint=null;
  mapped().forEach(c=>{const p=xy(c.lat,c.lon,center,scale);if(p[0]>=MAP.x+14&&p[0]<=MAP.x+MAP.w-14&&p[1]>=MAP.y+54&&p[1]<=MAP.y+MAP.h-14){if(c.id===selectedId)selectedPoint=p;else pin(cv,p[0],p[1],false);}});
  mapPulseVisible=!!selectedPoint;
  // Draw selection last so nearby cameras cannot hide its pulse.
  if(selectedPoint)pin(cv,selectedPoint[0],selectedPoint[1],true);
  if(fix){const p=xy(fix.lat,fix.lon,center,scale);cv.circle(p[0],p[1],17,'#303a46');cv.circle(p[0],p[1],9,C.blue);const h=(fix.headingDeg||0)*Math.PI/180;cv.line(p[0],p[1],p[0]+Math.sin(h)*25,p[1]-Math.cos(h)*25,4,'#fff');}
  cv.strokeRoundRect(MAP.x,MAP.y,MAP.w,MAP.h,14,1,'#303a46');
  txt(cv,'МАСШТАБ '+String(zoom)+'×',MAP.x+18,MAP.y+25,15,C.muted);
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
   cv.roundRect(b.x,b.y,b.w,b.h,9,C.panel);
   cv.strokeRoundRect(b.x,b.y,b.w,b.h,9,2,enabled?'#a9becf':'#303a46');
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
   cv.roundRect(b.x,b.y,b.w,b.h,9,C.panel);
   cv.strokeRoundRect(b.x,b.y,b.w,b.h,9,2,enabled?'#a9becf':'#303a46');
   cv.line(x-b.step*6,y-12,x+b.step*6,y,4,color);
   cv.line(x+b.step*6,y,x-b.step*6,y+12,4,color);
  });
 }
 function drawPanel(cv){
  cv.roundRect(P.x,P.y,P.w,P.h,10,C.panel);const c=selected();
  txt(cv,'ВЫБРАННАЯ КАМЕРА',P.x+22,P.y+32,19,C.muted,{maxWidth:400});
  if(c){const labels=hudLabels(c);
   cameraIcon.drawCanvas(cv,P.x+24,P.y+56,54,45,[245,249,252]);
   txt(cv,labels.control,P.x+100,P.y+78,27,C.text,{maxWidth:320});
   txt(cv,labels.model||'МОДЕЛЬ НЕ УКАЗАНА',P.x+100,P.y+109,23,C.muted,{maxWidth:320});
   if(Number.isFinite(c.limit)&&c.limit>0)style.speedSign(cv,c.limit,P.x+71,P.y+189,49);
   else txt(cv,'ЛИМИТ Н/Д',P.x+24,P.y+192,19,C.muted,{maxWidth:105});
   txt(cv,(index+1)+' / '+cameras().length,P.x+283,P.y+181,25,C.text,{align:'center',maxWidth:149});
   txt(cv,'КАМЕР В ОБЛАСТИ КАРТЫ',P.x+145,P.y+235,16,C.muted,{maxWidth:275});
  }else txt(cv,'КАМЕРЫ НЕ НАЙДЕНЫ',P.x+22,P.y+130,25,C.text,{maxWidth:400});
  drawCameraButtons(cv);
  ln(cv,[P.x+22,P.y+252],[P.x+P.w-22,P.y+252],1,'#303a46');
  txt(cv,gpsHealth(fix,Date.now()),P.x+22,P.y+285,22,mapcamFreshFix(fix,Date.now())?C.text:C.yellow,{maxWidth:400});
  txt(cv,fix?(Number.isFinite(fix.speedKmh)?Math.round(fix.speedKmh)+' КМ/Ч':'СКОРОСТЬ Н/Д')+' · ТОЧНОСТЬ '+(Number.isFinite(fix.accuracyM)?Math.round(fix.accuracyM)+' М':'Н/Д'):'ПРЕДУПРЕЖДЕНИЯ ЖДУТ КООРДИНАТ',P.x+22,P.y+317,18,C.muted,{maxWidth:400});
  const installedDate=new Date(Number(database.revision)*1000);
  const dateLabel=Number(database.revision)>0&&Number.isFinite(installedDate.getTime())?installedDate.toISOString().slice(0,10).split('-').reverse().join('.'):'НЕ УКАЗАНА';
  txt(cv,'ДАТА БАЗЫ: '+dateLabel,P.x+22,P.y+P.h-55,20,C.text,{maxWidth:400});
  if(refreshBusy){
   const baseline=P.y+P.h-25,phase=Math.floor((monotonicMs()-refreshStartedAt)/300)%4;
   txt(cv,'ОБНОВЛЕНИЕ',P.x+22,baseline,18,C.muted,{maxWidth:170});
   // Fixed dot positions: disappear left to right, then all three return.
   for(let i=0;i<3;i++)if(i>=phase)cv.circle(P.x+150+i*12,baseline-2,2,C.muted);
  }else txt(cv,refreshStatus,P.x+22,P.y+P.h-25,17,refreshError?C.red:C.muted,{maxWidth:400});
 }
 function drawAlertBanner(cv){
  // Suppress only the central overlay; retain live warning state, voice and HUD/KOMBI.
  notificationPolicy.view=view;
  if(notificationPolicy.destination()!=='canvas'||!activeAlert||Date.now()>=alertUntil)return;
  drawCentralAlert(cv,activeAlert,fix&&fix.speedKmh,{x:282,y:92,w:1282});
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
 function drawSettings(){
  if(warningSettings)return drawWarningSettings();
  const cv=ctx.canvas(W,H).clear(C.bg);style.heading(cv,'НАСТРОЙКИ','ВЫВОД ПРЕДУПРЕЖДЕНИЙ');
  cv.roundRect(266,74,1314,398,10,C.panel);
  txt(cv,'ВЫБЕРИТЕ ДИСПЛЕЙ',290,116,24,C.muted,{maxWidth:1230});
  [['kombi','KOMBI'],['hud','HUD'],['both','KOMBI + HUD'],['off','ВЫКЛ.']].forEach((entry,i)=>{
   const x=290+i*319,on=cameraDisplayMode===entry[0];cv.roundRect(x,142,295,104,8,on?'#251318':'#19212a');
   cv.strokeRoundRect(x,142,295,104,8,on?2:1,on?C.red:'#303a46');txt(cv,entry[1],x+147,195,30,on?C.text:C.muted,{align:'center',maxWidth:260});
   if(on)txt(cv,'ВЫБРАНО',x+147,225,16,C.text,{align:'center',maxWidth:260});
  });
  txt(cv,'ТЕКУЩИЙ РЕЖИМ: '+displayModeLabel(cameraDisplayMode),290,296,25,C.text,{maxWidth:1230});
  txt(cv,'3 — ПАРАМЕТРЫ УВЕДОМЛЕНИЙ',290,346,20,C.muted,{maxWidth:1230});
  txt(cv,'ТЕСТ ГОЛОСА И ДИСПЛЕЕВ — В ИНЖЕНЕРНОМ МЕНЮ',290,391,20,C.muted,{maxWidth:1230});
  txt(cv,'HUD · ЭКСПЕРИМЕНТАЛЬНО · ЗАВИСИТ ОТ КОНФИГУРАЦИИ АВТОМОБИЛЯ',290,433,17,C.muted,{maxWidth:1230});
  drawTabs(cv,'SETTINGS');drawActionLegend(cv,'SETTINGS');return ui.image('MAIN_GFX',cv);
 }
 function drawEngineering(){
  const cv=ctx.canvas(W,H).clear(C.bg),mem=process.memoryUsage(),wc=database.warningCache;
  style.heading(cv,'ИНЖЕНЕРНОЕ МЕНЮ','SPEEDCAM 0.9.29');
  cv.roundRect(266,74,650,274,10,C.panel);cv.roundRect(936,74,644,274,10,C.panel);
  const age=fix&&Number.isFinite(fix.timeMs)?Math.max(0,Date.now()-fix.timeMs):null;
  const left=[
   'GPS: '+(fix?'ЕСТЬ КООРДИНАТЫ':'НЕТ КООРДИНАТ'),
   'ТОЧНОСТЬ: '+(fix&&Number.isFinite(fix.accuracyM)?fix.accuracyM.toFixed(1)+' М':'Н/Д'),
   'ВОЗРАСТ КООРДИНАТ: '+(age===null?'Н/Д':(age/1000).toFixed(1)+' С'),
   'СОБЫТИЯ GPS: '+(gpsStatus.eventsReceived||0)+' / ОШИБКИ: '+(gpsStatus.invalidEvents||0),
   'ВЫВОД: '+displayModeLabel(cameraDisplayMode),
   'ГОЛОС: '+(voice.lastError?'ОШИБКА': 'ОШИБОК НЕ ЗАРЕГИСТРИРОВАНО')
  ];
  const right=[
   'ОБЪЕКТЫ БАЗЫ: '+(database.manifest&&database.manifest.count||'Н/Д'),
   'ДЛЯ ПРЕДУПРЕЖДЕНИЙ: '+(database.cities.russia||{}).length,
   'РАДИУС ПОДГРУЗКИ: 4.2 КМ',
   'КЭШ ПРЕДУПРЕЖДЕНИЙ: '+(wc?wc.cache.size+' / '+wc.maxBlocks+' БЛОКОВ':'Н/Д'),
   'ПРОЧИТАНО БЛОКОВ: '+(database.readBlocks||0),
   'ПАМЯТЬ HEAP / RSS: '+Math.round(mem.heapUsed/1048576)+' / '+Math.round(mem.rss/1048576)+' МБ'
  ];
  left.forEach((s,i)=>txt(cv,s,288,112+i*42,21,C.text,{maxWidth:606}));
  right.forEach((s,i)=>txt(cv,s,958,112+i*42,21,C.text,{maxWidth:600}));
  [['ТЕСТ ГОЛОСА И ДИСПЛЕЕВ',266,650],['НАЗАД В НАСТРОЙКИ',936,644]].forEach(([label,x,w])=>{
   cv.roundRect(x,366,w,64,8,C.panel);cv.strokeRoundRect(x,366,w,64,8,2,'#a9becf');txt(cv,label,x+w/2,406,23,C.text,{align:'center',maxWidth:w-40});
  });
  txt(cv,Date.now()<alertUntil?lastAlert:'ДИАГНОСТИКА ОБНОВЛЯЕТСЯ АВТОМАТИЧЕСКИ',288,455,16,C.muted,{maxWidth:1260});
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
  style.heading(cv,'РАДАР','КАМЕРА ПО ХОДУ ДВИЖЕНИЯ');
  cv.roundRect(266,74,1314,436,12,C.panel);
  const valid=mapcamFreshFix(fix,Date.now()),hit=valid?radarCamera:null;
  if(!hit){
   cameraIcon.drawCanvas(cv,863,122,120,99,[169,190,207]);
   txt(cv,!valid?gpsHealth(fix,Date.now()):!notificationPolicy.monitoring()?'КОНТРОЛЬ ВЫКЛЮЧЕН':fix.speedKmh<=5?'ОЖИДАНИЕ ДВИЖЕНИЯ':'ВПЕРЕДИ НЕТ КАМЕР',923,307,50,C.text,{align:'center',maxWidth:1200});
   txt(cv,valid?'В РАДИУСЕ 4.2 КМ':'НУЖНЫ СВЕЖИЕ И ТОЧНЫЕ КООРДИНАТЫ',923,374,26,C.muted,{align:'center',maxWidth:1200});
  }else{
   const c=hit.camera,labels=hudLabels(c);
   cameraIcon.drawCanvas(cv,306,109,96,79,[245,249,252]);
   txt(cv,labels.control,434,156,54,C.text,{maxWidth:770});
   txt(cv,labels.model||'МОДЕЛЬ НЕ УКАЗАНА',434,216,42,C.muted,{maxWidth:770});
   if(Number.isFinite(c.limit)&&c.limit>0)style.speedSign(cv,c.limit,1386,262,145);
   else{txt(cv,'ЛИМИТ',1386,245,30,C.muted,{align:'center',maxWidth:290});txt(cv,'Н/Д',1386,315,66,C.text,{align:'center',maxWidth:290});}
   const distance=hit.distanceM<1000?Math.round(hit.distanceM)+' М':(hit.distanceM/1000).toFixed(1)+' КМ';
   txt(cv,distance,320,378,112,C.text,{maxWidth:865});
   txt(cv,hit.state&&hit.state.phase==='section'?'ДО КОНЦА УЧАСТКА':hit.state&&hit.state.phase==='rear'?'ЗА КАМЕРОЙ':'ДО КАМЕРЫ',322,422,25,C.muted,{maxWidth:860});
   cv.line(294,451,1552,451,1,'#303a46');
   const st=hit.state,measured=st&&st.useAverage?st.averageKmh:fix.speedKmh;
   txt(cv,(st&&st.useAverage?(st.partialSection?'ЧАСТ. СРЕДНЯЯ ':'СРЕДНЯЯ '):'СКОРОСТЬ ')+(Number.isFinite(measured)?Math.round(measured):'—')+' КМ/Ч',320,489,28,st&&st.speeding?C.red:C.text,{maxWidth:620});
   txt(cv,hit.active?'АКТИВНОЕ УВЕДОМЛЕНИЕ':'ВПЕРЕДИ · РАДИУС 4.2 КМ',1550,487,20,C.muted,{align:'right',maxWidth:600});
  }
  drawTabs(cv,'RADAR');return ui.image('MAIN_GFX',cv);
 }
 function drawMainMap(){
  const cv=ctx.canvas(W,H).clear(C.bg);style.heading(cv,'КАРТА КАМЕР',CITY_LABELS[city]||city);
  drawMap(cv);drawPanel(cv);drawZoomButtons(cv);drawTabs(cv,'MAP');drawActionLegend(cv,'MAP');
  return ui.image('MAIN_GFX',cv);
 }
 function syncNativeButtons(){
  if(view===nativeButtonView)return;nativeButtonView=view;
  for(const id of ACTION_IDS)for(const method of ['visible','enabled']){
   const extra=['BTN_REFRESH','BTN_VOICE_TEST','BTN_CAMERA_MENU'].includes(id);
   const hidden=view==='ENGINEERING'||extra&&(view==='SETTINGS'||view==='MAP'&&id!=='BTN_REFRESH'||id==='BTN_CAMERA_MENU'&&(view==='ADD'||view==='MY'));
   if(typeof ui[method]==='function')Promise.resolve(ui[method](id,!hidden)).catch(e=>log.warn('BUTTON_STATE_FAILED '+id+' '+String(e)));
  }
 }
 function render(){syncBackgroundNotification();if(!mainScreenVisible)return;syncNativeButtons();if(view==='RADAR')return drawRadar();if(view==='ENGINEERING')return drawEngineering();if(view==='ADD')return drawAddCamera();if(view==='MY')return drawMyCameras();if(view==='SETTINGS')return drawSettings();return drawMainMap();}
 let renderQueued=false,renderRunning=false,renderTimer=null,lastRenderAt=0,renderCount=0;
 function renderSafe(){
  renderQueued=true;
  if(renderRunning||renderTimer)return;
  const frameMs=view==='MAP'&&(mapPulseVisible||refreshBusy)?100:500;
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
 function gpsChanged(s){gpsStatus=s||gpsStatus;fix=s&&s.fix?s.fix:null;if(fix){
  if(Number.isFinite(fix.accuracyM)&&fix.accuracyM<=15&&Number.isFinite(fix.speedKmh)&&fix.speedKmh>=8&&Number.isFinite(fix.headingDeg)){
   let prev=gpsTrack[gpsTrack.length-1];let dx=prev?(fix.lon-prev.lon)*111320*Math.cos(fix.lat*Math.PI/180):Infinity,dy=prev?(fix.lat-prev.lat)*111320:Infinity;
   if(prev&&(fix.timeMs-prev.timeMs>5000||Math.hypot(dx,dy)>80)){gpsTrack=[];prev=null;dx=Infinity;dy=Infinity;}
   if(!prev||Math.hypot(dx,dy)>=4){gpsTrack.push({lat:fix.lat,lon:fix.lon,headingDeg:fix.headingDeg,timeMs:fix.timeMs});while(gpsTrack.length>160)gpsTrack.shift();while(gpsTrack.length>2){const a=gpsTrack[0],b=gpsTrack[gpsTrack.length-1],dist=Math.hypot((b.lon-a.lon)*111320*Math.cos(b.lat*Math.PI/180),(b.lat-a.lat)*111320);if(dist<=900)break;gpsTrack.shift();}}
  }
  if(addScreenActive&&Number.isFinite(fix.timeMs)&&(!captureFixes.length||fix.timeMs>captureFixes[captureFixes.length-1].timeMs)){
   if(!Number.isFinite(fix.accuracyM)||fix.accuracyM>15){captureStatus='Ожидаем точность GPS не хуже 15 м';captureFixes=[];}
   else if(!Number.isFinite(fix.speedKmh)||fix.speedKmh>5){captureStatus='Остановитесь рядом с камерой';captureFixes=[];}
   else {captureFixes.push({lat:fix.lat,lon:fix.lon,accuracyM:fix.accuracyM,timeMs:fix.timeMs});if(captureFixes.length>5)captureFixes.shift();captureStatus='Сбор координат: '+captureFixes.length+'/5';if(captureFixes.length===5){const lat=captureFixes.reduce((a,x)=>a+x.lat,0)/5,lon=captureFixes.reduce((a,x)=>a+x.lon,0)/5,accuracy=Math.max(...captureFixes.map(x=>x.accuracyM)),spread=Math.max(...captureFixes.map(x=>Math.hypot((x.lat-lat)*111320,(x.lon-lon)*111320*Math.cos(lat*Math.PI/180))));if(spread>15){cameraDraft=null;captureStatus='GPS нестабилен · ждём более точные координаты';captureFixes.shift();}else{cameraDraft={lat,lon,accuracyM:accuracy};captureStatus='Координаты получены';}}}
  }
  updateWarnings();}else{radarCamera=null;mapcamWarnings.suspend();roadGuidance.reset();clearLiveAlerts();}renderSafe();}
 function updateWarnings(){
  if(!notificationPolicy.monitoring()){radarCamera=null;mapcamWarnings.suspend();roadGuidance.reset();clearLiveAlerts();return;}
  const now=Date.now(),near=monitoringCameras();
  if(!mapcamFreshFix(fix,now)){radarCamera=null;mapcamWarnings.suspend();roadGuidance.reset();clearLiveAlerts();return;}
  const events=mapcamWarnings.update(fix,near,now).concat(roadGuidance.update(fix,localCameras,now));
  const states=Object.assign({},roadGuidance.states,mapcamWarnings.states);
  const current=notificationSession.update(states,fix,mapcamWarnings.heading);
  radarCamera=selectRadar(current,near,fix,mapcamWarnings.heading,roadGuidance);
  events.forEach(e=>{
   if(e.type==='end')lastAlert='КОНТРОЛЬ ЗАВЕРШЁН · '+e.camera.name;
   if(e.type!=='voice')log.info('WARNING '+e.type+' camera='+e.camera.id+' distance='+e.distanceM);
  });
  if(current){
   const st=current,c=st.camera;
   if(c){const e={camera:c,distanceM:st.distanceM,type:st.speeding?'speeding':'camera',speeding:st.speeding,
    phase:st.phase,speedKmh:Number.isFinite(st.speedKmh)?Math.round(st.speedKmh):null,measuredSpeedKmh:st.speedKmh,averageKmh:st.averageKmh,
    useAverage:st.useAverage,partialSection:st.partialSection};
    activeAlert=e;alertUntil=now+3500;lastAlert=(e.phase==='section'?'ДО КОНЦА УЧАСТКА ':e.phase==='rear'?'ЗА КАМЕРОЙ ':'КАМЕРА ЧЕРЕЗ ')+Math.round(e.distanceM)+' м';
    if(!clusterOutput.current||clusterOutput.current.camera.id!==c.id)clusterOutput.show(e);
   }
   clusterOutput.sync(states);
  }else if(activeAlert){clearLiveAlerts();}
  syncBackgroundNotification();
 }
 function syncBackgroundNotification(){
  notificationPolicy.view=view;
  const live=activeAlert&&Date.now()<alertUntil&&mapcamFreshFix(fix,Date.now());
  backgroundNotification.update(live&&notificationPolicy.destination()==='system'?activeAlert:null,fix&&fix.speedKmh);
 }

 async function refresh(){if(refreshInFlight)return refreshInFlight;refreshBusy=true;refreshStartedAt=monotonicMs();refreshError=false;refreshStatus='Проверка обновлений...';renderSafe();refreshInFlight=store.refresh((state)=>{refreshStatus=state;renderSafe();}).then(r=>{database=r.database;if(r.updated){cameraIndex=database;displayCache=null;radarCamera=null;index=0;roadGuidance.reset();mapcamWarnings.reset();notificationSession.clear();clearLiveAlerts();refreshStatus='База обновлена';refreshError=false;}else if(r.error){refreshStatus='Ошибка: '+String(r.error).slice(0,42);refreshError=true;}else{refreshStatus=r.message||'База актуальна';refreshError=false;}renderSafe();return r;}).catch(e=>{refreshStatus='Ошибка: '+String(e&&e.message||e).slice(0,42);refreshError=true;log.warn('DB refresh '+e);renderSafe();return {error:String(e)};}).then(r=>{refreshBusy=false;refreshInFlight=null;renderSafe();return r;});return refreshInFlight;}
 const CAMERA_TYPES=['Камера скорости','Контроль светофора','Скорость + светофор'];
 function drawTabs(cv,active){
  style.drawNav(cv,active);
  style.tabs.forEach(([id],i)=>{const n=style.nav,y=n.y+i*(n.h+n.gap);
   pageTarget(cv,n.x,y,n.w,n.h,()=>handlePageTap(n.x+n.w/2,y+n.h/2),'nav-'+id);
  });
 }
 function drawActionLegend(cv,mode){
  const items=mode==='ADD'?['ЛИМИТ −','ЛИМИТ +','ТИП','НАПРАВЛЕНИЕ','СОХРАНИТЬ']:
   mode==='MAP'?['НАЗАД','ВПЕРЁД','МАСШТАБ','ОБНОВИТЬ БД']:
   mode==='SETTINGS'?(warningSettings?['НАЗАД','ВПЕРЁД','ДИСПЛЕИ']:['НАЗАД','ВПЕРЁД','УВЕДОМЛЕНИЯ']):
   ['НАЗАД','ВПЕРЁД','УДАЛИТЬ','ПОДТВЕРДИТЬ','ДОБАВИТЬ'];
  const mapRow=mode==='MAP',centered=mapRow||mode==='ADD'||mode==='MY'||mode==='SETTINGS',gap=mapRow?10:12,rowWidth=mapRow?MAP.w:style.content.w,width=centered?(rowWidth-gap*(items.length-1))/items.length:207;
  items.forEach((label,i)=>{const x=(mapRow?MAP.x:266)+i*(width+gap);cv.roundRect(x,ACTION_BAR.y,width,ACTION_BAR.h,6,C.panel);txt(cv,(i+1)+'  '+label,centered?x+width/2:x+14,ACTION_BAR.baseline,17,C.muted,{align:centered?'center':'left',maxWidth:width-28});
   if(label!=='—')pageTarget(cv,x,ACTION_BAR.y,width,ACTION_BAR.h,()=>{settingsTaps=0;lastSettingsTap=0;const run=actionHandlers[ACTION_IDS[i]];if(run)run();},'action-'+ACTION_IDS[i]);
  });
 }
 function openView(target){
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
  const tab=style.tabAt(x,y);
  if(tab==='SETTINGS'){
   const now=Date.now();settingsTaps=now-lastSettingsTap<=3000?settingsTaps+1:1;lastSettingsTap=now;
   if(settingsTaps===10){settingsTaps=0;lastSettingsTap=0;addScreenActive=false;view='ENGINEERING';renderSafe();return;}
   openView(tab);return;
  }
  settingsTaps=0;lastSettingsTap=0;
  if(tab){openView(tab);return;}
  if(view==='ENGINEERING'){
   if(y>=366&&y<430){if(x>=266&&x<916)testCameraOutputs();else if(x>=936&&x<1580)openView('SETTINGS');}
   return;
  }
  if(view==='MAP'){
   const button=ZOOM_BUTTONS.find(b=>x>=b.x&&x<b.x+b.w&&y>=b.y&&y<b.y+b.h);
   if(button){changeZoom(button.step,false);return;}
   // Alert overlay hides this part of the panel; hidden arrows must not react.
   if(notificationPolicy.destination()==='canvas'&&activeAlert&&Date.now()<alertUntil)return;
   const cameraButton=CAMERA_BUTTONS.find(b=>x>=b.x&&x<b.x+b.w&&y>=b.y&&y<b.y+b.h);
   if(cameraButton){changeSelectedCamera(cameraButton.step);return;}
  }
  if(view==='SETTINGS'&&warningSettings&&x>=288&&x<1558){
   const row=Math.floor((y-88)/51);
   if(row>=0&&row<warningRows.length&&y<88+row*51+46){warningSettingIndex=row;changeWarningSetting();}return;
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
 function beginAddCamera(){addScreenActive=true;captureFixes=[];cameraDraft=null;captureStatus='Ожидание пяти точных GPS-измерений...';cameraLimit=60;cameraType=0;cameraDirection='forward';}
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
  cv.roundRect(266,74,1314,398,10,C.panel);
  txt(cv,'КООРДИНАТЫ GPS',290,113,21,C.muted,{maxWidth:1230});
  txt(cv,cameraDraft?cameraDraft.lat.toFixed(6)+' , '+cameraDraft.lon.toFixed(6):'ОЖИДАНИЕ GPS',290,156,31,cameraDraft?C.text:C.yellow,{maxWidth:1230});
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
  const cv=ctx.canvas(W,H).clear(C.bg);style.heading(cv,'МОИ КАМЕРЫ','СОХРАНЕНО: '+localCameras.length);cv.roundRect(266,74,1314,398,10,C.panel);
  if(!localCameras.length){
   cameraIcon.drawCanvas(cv,880,124,86,71,[245,249,252]);
   txt(cv,'ПОКА НЕТ СОХРАНЁННЫХ КАМЕР',923,265,34,C.text,{align:'center',maxWidth:1180});
   txt(cv,'ВЫБЕРИТЕ «ДОБАВИТЬ» В МЕНЮ СЛЕВА',923,319,23,C.muted,{align:'center',maxWidth:1180});
  }else{
   localCameraIndex=Math.max(0,Math.min(localCameraIndex,localCameras.length-1));const c=localCameras[localCameraIndex];
   txt(cv,(localCameraIndex+1)+' / '+localCameras.length,290,113,22,C.muted,{maxWidth:1020});
   txt(cv,c.type||c.name||'КАМЕРА',290,166,34,C.text,{maxWidth:1060});
   txt(cv,c.lat.toFixed(6)+' , '+c.lon.toFixed(6),290,216,28,C.text,{maxWidth:1060});
   if(Number.isFinite(c.limit)&&c.limit>0)style.speedSign(cv,c.limit,1476,166,54);
   else txt(cv,'ЛИМИТ Н/Д',1420,173,18,C.muted,{maxWidth:135});
   txt(cv,'НАПРАВЛЕНИЕ: '+(c.direction==='both'?'ОБА НАПРАВЛЕНИЯ':'ПО ДВИЖЕНИЮ'),290,277,24,C.muted,{maxWidth:1230});
   txt(cv,c.road?'ДОРОЖНАЯ ПРИВЯЗКА: ЕСТЬ':'ДОРОЖНАЯ ПРИВЯЗКА: НЕТ',290,328,24,C.muted,{maxWidth:1230});
   txt(cv,'ДОБАВЛЕНА ВРУЧНУЮ',290,408,19,C.muted,{maxWidth:1230});
  }
  if(deletePending){cv.roundRect(326,165,1194,190,12,'#251318');cv.strokeRoundRect(326,165,1194,190,12,2,C.red);txt(cv,'УДАЛИТЬ ЭТУ КАМЕРУ?',923,232,34,C.text,{align:'center',maxWidth:1120});txt(cv,'4 — ПОДТВЕРДИТЬ УДАЛЕНИЕ ЛОКАЛЬНОЙ ЗАПИСИ',923,289,23,C.muted,{align:'center',maxWidth:1120});}
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
 bindAction('BTN_ZOOM',()=>{if(view==='RADAR')return;if(view==='ENGINEERING'){return;}if(view==='SETTINGS'){warningSettings=!warningSettings;renderSafe();return;}if(view==='ADD'){cameraType=(cameraType+1)%CAMERA_TYPES.length;renderSafe();}else if(view==='MY'){if(localCameras.length){deletePending=true;renderSafe();}}else{changeZoom(1,true);}});
 bindAction('BTN_REFRESH',()=>{if(view==='ENGINEERING'){return;}if(view==='SETTINGS')return;if(view==='ADD'){cameraDirection=cameraDirection==='forward'?'both':'forward';renderSafe();}else if(view==='MY'){removeSelectedCamera();}else refresh();});
 bindAction('BTN_VOICE_TEST',()=>{if(view==='MAP'||view==='SETTINGS')return;if(view==='ADD'){saveLocalCamera();return;}if(view==='MY'){deletePending=false;beginAddCamera();view='ADD';renderSafe();return;}testCameraOutputs();});
 settings.onChange(k=>{if(['auto_monitor','central_notifications','radar_no_duplicate'].includes(k)){if(k==='auto_monitor'&&!notificationPolicy.monitoring()){radarCamera=null;mapcamWarnings.suspend();roadGuidance.reset();clearLiveAlerts();}syncBackgroundNotification();renderSafe();return;}if(k.indexOf('mapcam_')===0){mapcamWarnings.configure(mapcamOptions());roadGuidance.configure(mapcamOptions());clearLiveAlerts();renderSafe();return;}if(k==='city'){city=String(settings.get('city')||'russia');index=0;roadGuidance.reset();renderSafe();}else if(k==='camera_display'){cameraDisplayMode=String(settings.get('camera_display')||'kombi');clusterOutput.setMode(cameraDisplayMode);renderSafe();}});
 gps.on('change',gpsChanged);gps.start();ui.onVisible((n,v)=>{if(n==='MAIN'){mainScreenVisible=!!v;notificationPolicy.setVisible(v);syncBackgroundNotification();if(v)renderSafe();}});
 // This timer is independent of ctx.loop(), which stops when MAIN is hidden.
 const backgroundTimer=setInterval(()=>{if(fix&&!mapcamFreshFix(fix,Date.now())){mapcamWarnings.suspend();roadGuidance.reset();clearLiveAlerts();}syncBackgroundNotification();},250);
 if(ctx.app&&typeof ctx.app.on==='function')ctx.app.on('shutdown',()=>{clearInterval(backgroundTimer);gps.stop();clearLiveAlerts();});
 renderSafe();refresh();setInterval(refresh,REFRESH_INTERVAL_MS);ctx.loop('MAIN',10,()=>{if(fix&&Date.now()-fix.timeMs>3000){mapcamWarnings.suspend();roadGuidance.reset();clearLiveAlerts();}renderSafe();});
 log.info('SpeedCAM 0.9.33 started; camera sectors and control paths; GPS accuracy <15 m; KOMBI/HUD mode='+cameraDisplayMode);
}});
