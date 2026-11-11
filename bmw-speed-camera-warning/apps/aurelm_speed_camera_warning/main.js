'use strict';
const mgu=require('./kit/mgu');
const uplink=require('./uplink');
const bundlePath=require('path').join(__dirname,'camera-db.json');
const cityMap=require('./city-map.json');
const {CameraStore}=require('./camera-store');
const {CameraIndex}=require('./camera-index');
const {BmwGps}=require('./gps');
const {RoadGuidanceWarnings,prepare}=require('./road-guidance');
const {LocalCameraStore}=require('./local-camera-store');
const {CameraVoiceAlerts}=require('./voice-alert');
const {CameraClusterOutput}=require('./cluster-output');
const {MapcamWarnings,freshFix:mapcamFreshFix}=require('./mapcam-warnings');
const CITY_LABELS={russia:'Россия · рядом с GPS','yoshkar-ola':'Йошкар-Ола','mari-el':'Республика Марий Эл',moscow:'Москва',sochi:'Сочи'};
const REFRESH_INTERVAL_MS=21600000,W=1600,H=520;
const MAP={x:24,y:66,w:1120,h:420},P={x:1170,y:66,w:406,h:420};
const C={bg:'#080d13',panel:'#101923',road:'#334252',edge:'#637487',text:'#e9f0f6',muted:'#91a2b5',blue:'#58b6ff',red:'#ff525e',green:'#5de0a1',yellow:'#ffd166',grid:'#172430'};
mgu.run({async start(ctx){
 const {ui,settings,log,dataDir}=ctx;uplink.init(dataDir);log.info('UPLINK '+uplink.describe());uplink.checkInternet({timeout:3500}).then(ok=>log.info('UPLINK_HTTPS_PROBE '+(ok?'online':'offline')+'; '+uplink.describe())).catch(e=>log.warn('UPLINK_PROBE_ERROR '+e));let city=String(settings.get('city')||'russia'),view='MAP',index=0,zoom=.75,zoomIndex=1,fix=null,cameraDisplayMode=String(settings.get('camera_display')||'kombi'),gpsStatus={state:'starting',errorCode:null,eventsReceived:0,invalidEvents:0},lastAlert='Нет предупреждений',alertUntil=0,activeAlert=null;
 const store=new CameraStore({dataDir,bundled:JSON.parse(require('fs').readFileSync(bundlePath,'utf8'))});let database=store.loadLocal().database;
 let cameraIndex=new CameraIndex(database.cities.russia||[]),displayCache=null;
 if(!database.cities[city])city='russia';
 const localStore=new LocalCameraStore(dataDir);let localCameras=localStore.load(),addScreenActive=false,captureFixes=[],cameraDraft=null,captureStatus='Ожидание GPS...',cameraLimit=60,cameraType=0,cameraDirection='forward',gpsTrack=[];
 const gps=new BmwGps(),roadGuidance=new RoadGuidanceWarnings([]),voice=new CameraVoiceAlerts({assetDir:__dirname,log:(m)=>log.warn(m)});
 const clusterOutput=new CameraClusterOutput({mode:cameraDisplayMode,log:(m)=>log.info(m)});let refreshInFlight=null,refreshBusy=false,refreshError=false,refreshStatus='База готова · '+store.source;
 const mapcamOptions=()=>({voice:String(settings.get('mapcam_voice')||'always'),excessKmh:Number(settings.get('mapcam_excess')||0),distanceM:Number(settings.get('mapcam_distance')||0)});
 const mapcamWarnings=new MapcamWarnings(mapcamOptions());
 localCameras.forEach(c=>{if(c.road)roadGuidance.zones[c.id]=prepare({id:c.id,lat:c.lat,lon:c.lon,roads:[{id:'user-road-'+c.id,pts:c.road.pts,camM:c.road.camM,dir:c.direction==='forward'?1:0}]});});
 let warningSettings=false,warningSettingIndex=0;
 const warningRows=[
  {key:'mapcam_voice',label:'Голос',values:['always','speeding','off'],labels:['Каждая камера','При превышении','Выключен']},
  {key:'mapcam_excess',label:'Порог превышения',values:['0','10','18','20'],labels:['Лимит камеры','Лимит + 10 км/ч','Лимит + 18 км/ч','Лимит + 20 км/ч']},
  {key:'mapcam_distance',label:'Дистанция',values:['0','500','700','1000','2000'],labels:['Из базы MapCam','500 м','700 м','1000 м','2000 м']}
 ];
 function warningValue(r){const value=String(settings.get(r.key)||r.values[0]);return Math.max(0,r.values.indexOf(value));}
 function changeWarningSetting(){const r=warningRows[warningSettingIndex];settings.set(r.key,r.values[(warningValue(r)+1)%r.values.length]);mapcamWarnings.configure(mapcamOptions());clearLiveAlerts();renderSafe();}
 function clearLiveAlerts(){activeAlert=null;alertUntil=0;clusterOutput.clear();if(voice.cancel)voice.cancel();}
 function drawWarningSettings(){
  const cv=ctx.canvas(W,H).clear(C.bg);cv.roundRect(48,72,W-96,400,16,C.panel);
  txt(cv,'ПРЕДУПРЕЖДЕНИЯ MAPCAM · РОССИЯ',82,115,24,C.blue);
  warningRows.forEach((r,i)=>{const y=145+i*70;cv.roundRect(76,y,1448,58,9,i===warningSettingIndex?'#17496a':'#172431');txt(cv,r.label,98,y+37,22,C.text);txt(cv,r.labels[warningValue(r)],780,y+37,22,C.green);});
  txt(cv,'1 / 2 — выбрать настройку · 4 — изменить · 3 — настройки KOMBI/HUD',82,392,18,C.text);
  txt(cv,'Участки: расстояние до конца и средняя скорость. Голос камеры — не чаще раза в 20 минут.',82,428,16,C.muted);
  drawTabs(cv,'SETTINGS');drawActionLegend(cv,'SETTINGS');return ui.image('MAIN_GFX',cv);
 }
 const cameras=()=>{
  if(city!=='russia')return (database.cities[city]||[]).concat(localCameras);
  const center=fix||{lat:56.630,lon:47.928};
  const key=center.lat+','+center.lon;
  if(!displayCache||displayCache.key!==key)displayCache={key,rows:cameraIndex.near(center,25000,500)};
  return displayCache.rows.concat(localCameras);
 };
 const monitoringCameras=()=>fix?cameraIndex.near(fix,2100).concat(localCameras):localCameras;
 const mapped=()=>cameras().filter(c=>c&&typeof c.lat==='number'&&typeof c.lon==='number');
 const selected=()=>cameras()[Math.max(0,Math.min(index,cameras().length-1))]||null;
 const txt=(cv,s,x,y,z,col,o)=>cv.text(String(s),x,y,z,col,Object.assign({font:'label',literal:true},o||{}));
 const ln=(cv,a,b,w,c)=>cv.line(a[0],a[1],b[0],b[1],w,c);
 function xy(lat,lon,center,scale){return [MAP.x+MAP.w/2+(lon-center.lon)*111320*Math.cos(center.lat*Math.PI/180)*scale,MAP.y+MAP.h/2+(center.lat-lat)*111320*scale];}
 function pin(cv,x,y,sel){cv.circle(x,y,sel?13:10,'#071019');cv.circle(x,y,sel?9:7,C.red);cv.circle(x,y,2.8,'#fff');}
 function drawMap(cv){
  cv.roundRect(MAP.x,MAP.y,MAP.w,MAP.h,14,'#0b151e');
  const center=fix?{lat:fix.lat,lon:fix.lon}:(city==='mari-el'?{lat:56.58,lon:48.05}:{lat:56.630,lon:47.928}),scale=.145*zoom*(city==='mari-el'?.045:1);
  for(let x=MAP.x+40;x<MAP.x+MAP.w;x+=80)ln(cv,[x,MAP.y+8],[x,MAP.y+MAP.h-8],1,C.grid);
  for(let y=MAP.y+30;y<MAP.y+MAP.h;y+=60)ln(cv,[MAP.x+8,y],[MAP.x+MAP.w-8,y],1,C.grid);
  (city==='yoshkar-ola'?cityMap.roads:[]).forEach(r=>{
   const a=xy(r[1],r[2],center,scale),b=xy(r[3],r[4],center,scale);
   if(Math.max(a[0],b[0])<MAP.x||Math.min(a[0],b[0])>MAP.x+MAP.w||Math.max(a[1],b[1])<MAP.y||Math.min(a[1],b[1])>MAP.y+MAP.h)return;
   ln(cv,a,b,9,C.edge);ln(cv,a,b,5,C.road);
  });
  mapped().forEach(c=>{const p=xy(c.lat,c.lon,center,scale);if(p[0]>=MAP.x-20&&p[0]<=MAP.x+MAP.w+20&&p[1]>=MAP.y-20&&p[1]<=MAP.y+MAP.h+20)pin(cv,p[0],p[1],c.id===(selected()||{}).id);});
  if(fix){const p=xy(fix.lat,fix.lon,center,scale);cv.circle(p[0],p[1],17,'#173b5a');cv.circle(p[0],p[1],9,C.blue);const h=(fix.headingDeg||0)*Math.PI/180;cv.line(p[0],p[1],p[0]+Math.sin(h)*25,p[1]-Math.cos(h)*25,4,'#fff');}
  cv.strokeRoundRect(MAP.x,MAP.y,MAP.w,MAP.h,14,1,'#314252');
  txt(cv,'МАСШТАБ '+zoom.toFixed(1)+'×',MAP.x+18,MAP.y+25,15,C.muted);
  txt(cv,'На карте: '+mapped().length+' · Россия: '+(database.cities.russia||[]).length,MAP.x+MAP.w-18,MAP.y+25,15,C.text,{align:'right'});
 }
 function drawPanel(cv){
  cv.roundRect(P.x,P.y,P.w,P.h,14,C.panel);const c=selected();
  txt(cv,'BMW SPEED CAMERA WARNING',P.x+22,P.y+30,16,C.blue);txt(cv,CITY_LABELS[city]||city,P.x+22,P.y+62,24,C.text);
  txt(cv,'GPS: '+(fix?'координаты получены':gpsStatus.state)+(gpsStatus.errorCode?' / '+gpsStatus.errorCode:''),P.x+22,P.y+95,16,fix?C.green:C.yellow);
  if(!fix)txt(cv,'События: '+gpsStatus.eventsReceived+' · некорректные: '+gpsStatus.invalidEvents,P.x+22,P.y+119,13,C.muted);
  if(fix){txt(cv,fix.lat.toFixed(6)+'  '+fix.lon.toFixed(6),P.x+22,P.y+120,15,C.muted);txt(cv,'Точность '+(fix.accuracyM===null?'нет GST':fix.accuracyM.toFixed(1)+' м')+' · '+(fix.speedKmh===null?'—':Math.round(fix.speedKmh)+' км/ч'),P.x+22,P.y+143,14,C.muted);}
  ln(cv,[P.x+20,P.y+160],[P.x+P.w-20,P.y+160],1,'#2a3948');txt(cv,'ВЫБРАННАЯ КАМЕРА',P.x+22,P.y+188,13,C.muted);
  if(c){txt(cv,(index+1)+' / '+cameras().length,P.x+22,P.y+216,15,C.blue);txt(cv,c.name,P.x+22,P.y+246,17,C.text);txt(cv,'Лимит: '+(c.limit?c.limit+' км/ч':'не указан'),P.x+22,P.y+272,15,C.muted);txt(cv,'Источник: '+(c.sourceLabel||c.source||'не указан'),P.x+22,P.y+296,13,typeof c.lat==='number'?C.green:C.yellow);}
  ln(cv,[P.x+20,P.y+316],[P.x+P.w-20,P.y+316],1,'#2a3948');txt(cv,'ПОСЛЕДНЕЕ ПРЕДУПРЕЖДЕНИЕ',P.x+22,P.y+342,13,C.muted);txt(cv,lastAlert,P.x+22,P.y+370,14,C.yellow);txt(cv,refreshStatus+' · rev.'+database.revision,P.x+22,P.y+397,13,refreshError?C.red:(refreshBusy?C.yellow:C.muted));
 }
 function drawAlertBanner(cv){
  if(!activeAlert||Date.now()>=alertUntil)return;
  const e=activeAlert,c=e.camera||{},speed=Number.isFinite(e.speedKmh)?e.speedKmh:(fix&&Number.isFinite(fix.speedKmh)?Math.round(fix.speedKmh):null);
  const limit=typeof c.limit==='number'&&Number.isFinite(c.limit)?c.limit:null;
  const speeding=e.type==='speeding'||e.speeding===true;
  const x=72,y=86,w=1456,h=142;
  cv.roundRect(x,y,w, h,18,'#07111d');
  cv.strokeRoundRect(x,y,w,h,18,2,speeding?C.red:'#67bfff');
  cv.roundRect(x+18,y+18,150,106,14,speeding?'#3a1118':'#142b3d');
  cv.circle(x+93,y+71,34,speeding?C.red:'#ffcf52');
  cv.circle(x+93,y+71,22,'#07111d');
  cv.roundRect(x+77,y+61,32,21,5,'#eaf2f8');
  cv.circle(x+93,y+71,7,'#07111d');
  txt(cv,e.phase==='section'?'КОНТРОЛЬ НА УЧАСТКЕ':e.phase==='rear'?'КОНТРОЛЬ ПОСЛЕ КАМЕРЫ':'КАМЕРА ВПЕРЕДИ',x+194,y+43,24,C.text);
  txt(cv,(e.phase==='section'?'До конца ':e.phase==='rear'?'За камерой ':'Через ')+Math.max(0,Math.round(e.distanceM||0))+' м',x+194,y+86,26,C.text);if(e.useAverage)txt(cv,e.partialSection?'Средняя с момента подключения':'Средняя на участке',x+194,y+116,16,C.muted);
  if(limit!==null){
    cv.circle(x+755,y+72,37,'#f4f6f8');
    cv.circle(x+755,y+72,29,C.red);
    cv.circle(x+755,y+72,24,'#ffffff');
    txt(cv,String(limit),x+755,y+81,25,'#101820',{align:'center'});
    txt(cv,'ОГРАНИЧЕНИЕ '+limit+' км/ч',x+810,y+80,21,C.text);
  }else{
    txt(cv,'Ограничение скорости не указано',x+730,y+80,20,C.muted);
  }
  if(speeding){
    cv.roundRect(x+1110,y+17,320,108,14,'#35121a');
    txt(cv,'ПРЕВЫШЕНИЕ',x+1130,y+48,17,'#ff9ca3');
    txt(cv,'+'+(speed-limit)+' км/ч',x+1130,y+91,34,C.red);
  }else if(speed!==null){
    txt(cv,(e.useAverage?'Средняя ':'Скорость ')+speed+' км/ч',x+1140,y+81,19,C.muted);
  }
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
  const cv=ctx.canvas(W,H).clear(C.bg);cv.roundRect(18,12,W-36,40,10,'#111c27');
  txt(cv,'НАСТРОЙКИ ВЫВОДА ПРЕДУПРЕЖДЕНИЙ',660,39,19,C.text);cv.roundRect(48,72,W-96,420,16,C.panel);
  txt(cv,'КУДА ВЫВОДИТЬ ПРЕДУПРЕЖДЕНИЯ О КАМЕРАХ',82,122,17,C.muted);
  [['kombi','KOMBI'],['hud','HUD'],['both','KOMBI + HUD'],['off','ВЫКЛ.']].forEach((entry,i)=>{
   const x=82+i*365,active=cameraDisplayMode===entry[0];cv.roundRect(x,164,330,88,12,active?'#17496a':'#172431');
   cv.strokeRoundRect(x,164,330,88,12,active?2:1,active?C.blue:'#344556');txt(cv,entry[1],x+165,217,23,active?C.text:C.muted,{align:'center'});
   if(active)txt(cv,'ВЫБРАНО',x+165,240,11,C.green,{align:'center'});
  });
  txt(cv,'Текущий режим: '+displayModeLabel(cameraDisplayMode),82,304,21,C.green);
  txt(cv,'1 / 2 — режим вывода · 3 — предупреждения MapCam',82,352,17,C.text);
  txt(cv,'Кнопка 5 — голосовая проверка и тестовая карточка камеры',82,384,17,C.text);
  txt(cv,cameraDisplayMode==='off'?'В режиме «Выкл.» тестовая карточка не появится, голос будет проверен.':'Тестовая карточка появится на выбранном дисплее на 10 секунд.',82,420,16,C.yellow);
  txt(cv,'HUD — экспериментальный режим; результат зависит от cluster-render и конфигурации автомобиля.',82,458,14,C.muted);
  drawTabs(cv,'SETTINGS');drawActionLegend(cv,'SETTINGS');return ui.image('MAIN_GFX',cv);
 }
 function testCameraOutputs(){
  lastAlert='ТЕСТ КАМЕРЫ · '+displayModeLabel(cameraDisplayMode);alertUntil=Date.now()+10000;
  if(cameraDisplayMode!=='off'){
   clusterOutput.show({type:'camera',stage:1,distanceM:500,camera:{id:'camera-output-test',name:'ТЕСТОВАЯ КАМЕРА',limit:60},speedKmh:0});
   setTimeout(()=>{if(clusterOutput.current&&clusterOutput.current.camera&&clusterOutput.current.camera.id==='camera-output-test')clusterOutput.clear();},10000);
  }
  renderSafe();
  voice.test().then(ok=>{if(!ok)log.warn('VOICE TEST FAILED: '+String(voice.lastError||'unknown'));
   lastAlert=(ok?'ГОЛОС: OK':'ГОЛОС: ОШИБКА · '+String(voice.lastError||'неизвестная ошибка').slice(0,55))+' · ВЫВОД: '+displayModeLabel(cameraDisplayMode);
   alertUntil=Date.now()+10000;renderSafe();
  });
 }
 function drawMainMap(){const cv=ctx.canvas(W,H).clear(C.bg);cv.roundRect(18,12,W-36,40,10,Date.now()<alertUntil?'#7b1820':'#111c27');txt(cv,Date.now()<alertUntil?'⚠ '+lastAlert:'КАРТА КАМЕР · '+(CITY_LABELS[city]||city),660,39,Date.now()<alertUntil?16:18,Date.now()<alertUntil?'#ffffff':C.text);txt(cv,city==='russia'?'До 500 камер в радиусе 25 км':'Локальная схема · без интернета',W-38,39,15,C.muted,{align:'right'});drawMap(cv);drawPanel(cv);drawAlertBanner(cv);txt(cv,'MapCam · предупреждения по всей России · секторы и участки из базы',MAP.x+2,H-8,12,C.muted);drawTabs(cv,'MAP');drawActionLegend(cv,'MAP');return ui.image('MAIN_GFX',cv);}
 function render(){if(view==='ADD')return drawAddCamera();if(view==='MY')return drawMyCameras();if(view==='SETTINGS')return drawSettings();return drawMainMap();}
 let renderQueued=false,renderRunning=false,renderTimer=null,lastRenderAt=0,renderCount=0;
 function renderSafe(){
  renderQueued=true;
  if(renderRunning||renderTimer)return;
  const delay=Math.max(0,500-(Date.now()-lastRenderAt));
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
  updateWarnings();}else{mapcamWarnings.suspend();roadGuidance.reset();clearLiveAlerts();}renderSafe();}
 function updateWarnings(){
  const now=Date.now(),near=monitoringCameras();
  if(!mapcamFreshFix(fix,now)){mapcamWarnings.suspend();roadGuidance.reset();clearLiveAlerts();return;}
  const events=mapcamWarnings.update(fix,near,now).concat(roadGuidance.update(fix,localCameras,now));
  const states=Object.assign({},roadGuidance.states,mapcamWarnings.states);
  events.forEach(e=>{
   if(e.type==='end')lastAlert='КОНТРОЛЬ ЗАВЕРШЁН · '+e.camera.name;
   if(e.type==='voice'||e.type==='camera'&&e.camera.source==='local-user'){
    voice.camera(e.stage,()=>!!states[e.camera.id]&&!!fix&&Date.now()-fix.timeMs<=3000&&!!(mapcamWarnings.states[e.camera.id]||roadGuidance.states[e.camera.id]))
     .then(ok=>{if(!ok)log.warn('VOICE_NOT_PLAYED camera='+e.camera.id+' '+(voice.lastError||'expired'));});
   }
   if(e.type!=='voice')log.info('WARNING '+e.type+' camera='+e.camera.id+' distance='+e.distanceM);
  });
  const current=Object.keys(states).map(id=>({id,state:states[id]})).sort((a,b)=>a.state.distanceM-b.state.distanceM)[0];
  if(current){
   const st=current.state,c=st.camera||localCameras.find(c=>c.id===current.id);
   if(c){const e={camera:c,distanceM:st.distanceM,type:st.speeding?'speeding':'camera',speeding:st.speeding,
    phase:st.phase,speedKmh:Number.isFinite(st.speedKmh)?Math.round(st.speedKmh):null,averageKmh:st.averageKmh,
    useAverage:st.useAverage,partialSection:st.partialSection};
    activeAlert=e;alertUntil=now+3500;lastAlert=(e.phase==='section'?'ДО КОНЦА УЧАСТКА ':e.phase==='rear'?'ЗА КАМЕРОЙ ':'КАМЕРА ЧЕРЕЗ ')+Math.round(e.distanceM)+' м';
    if(!clusterOutput.current||clusterOutput.current.camera.id!==c.id)clusterOutput.show(e);
   }
   clusterOutput.sync(states);
  }else if(activeAlert){clearLiveAlerts();}
 }

 async function refresh(){if(refreshInFlight)return refreshInFlight;refreshBusy=true;refreshError=false;refreshStatus='Проверка обновлений...';renderSafe();refreshInFlight=store.refresh((state)=>{refreshStatus=state;renderSafe();}).then(r=>{database=r.database;if(r.updated){cameraIndex=new CameraIndex(database.cities.russia||[]);displayCache=null;index=0;roadGuidance.reset();mapcamWarnings.reset();clearLiveAlerts();refreshStatus='Обновлено успешно';refreshError=false;}else if(r.error){refreshStatus='Ошибка: '+String(r.error).slice(0,42);refreshError=true;}else{refreshStatus='Обновлений нет';refreshError=false;}renderSafe();return r;}).catch(e=>{refreshStatus='Ошибка: '+String(e&&e.message||e).slice(0,42);refreshError=true;log.warn('DB refresh '+e);renderSafe();return {error:String(e)};}).then(r=>{refreshBusy=false;refreshInFlight=null;renderSafe();return r;});return refreshInFlight;}
 const CAMERA_TYPES=['Камера скорости','Контроль светофора','Скорость + светофор'];
 function drawTabs(cv,active){
  const tabs=[['MAP','КАРТА'],['ADD','ДОБАВИТЬ'],['MY','МОИ КАМЕРЫ'],['SETTINGS','НАСТРОЙКИ']];
  let x=24;tabs.forEach(([id,label])=>{const w=id==='MY'?210:190;cv.roundRect(x,8,w,42,9,active===id?'#17496a':'#172431');if(active===id)cv.strokeRoundRect(x,8,w,42,9,2,C.blue);txt(cv,label,x+w/2,35,17,active===id?C.text:C.muted,{align:'center'});x+=w+10;});
 }
 function drawActionLegend(cv,mode){
  const items=mode==='ADD'?['Лимит −','Лимит +','Тип камеры','Направление','Сохранить','Следующая вкладка']:
    mode==='MAP'?['Камера назад','Камера вперёд','Масштаб','Обновить базу','Голос + тест HUD/KOMBI','Следующая вкладка']:
    mode==='SETTINGS'?(warningSettings?['Настройка назад','Настройка вперёд','KOMBI/HUD','Изменить','Голос + тест вывода','Следующая вкладка']:['Режим назад','Режим вперёд','MapCam','—','Голос + тест вывода','Следующая вкладка']):
    ['Предыдущая','Следующая','Удалить','Подтвердить','Добавить камеру','Следующая вкладка'];
  txt(cv,'КНОПКИ УПРАВЛЕНИЯ',30,482,12,C.muted);
  items.forEach((label,i)=>txt(cv,label,220+i*225,482,14,C.text));
 }
 function openView(target){
  if(['MAP','ADD','MY','SETTINGS'].indexOf(target)<0)return;
  if(target!=='ADD')addScreenActive=false;
  if(target==='MAP'){view='MAP';}
  else if(target==='MY'){view='MY';localCameraIndex=0;deletePending=false;}
  else if(target==='ADD'){view='ADD';deletePending=false;beginAddCamera();}
  else{view='SETTINGS';}
  log.info('TOUCH_TAB_OPEN '+target);
  renderSafe();
 }
 function handlePageTap(x,y){
  if(!Number.isFinite(x)||!Number.isFinite(y))return;
  // These four tabs are drawn into MAIN_GFX, so route their touchscreen taps
  // explicitly. Coordinates are in the app's 1600x520 drawing space.
  if(view==='SETTINGS'&&warningSettings&&x>=76&&x<=1524&&y>=145&&y<355){warningSettingIndex=Math.floor((y-145)/70);changeWarningSetting();return;}
  if(y<6||y>54)return;
  if(x>=24&&x<214)openView('MAP');
  else if(x>=224&&x<414)openView('ADD');
  else if(x>=424&&x<634)openView('MY');
  else if(x>=644&&x<834)openView('SETTINGS');
 }
 function cycleView(){
  if(view==='MAP')openView('MY');
  else if(view==='MY')openView('ADD');
  else if(view==='ADD')openView('SETTINGS');
  else openView('MAP');
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
  const cv=ctx.canvas(W,H).clear(C.bg);cv.roundRect(18,12,W-36,40,10,'#111c27');
  txt(cv,'ДОБАВЛЕНИЕ КАМЕРЫ',660,39,19,C.text);txt(cv,'GPS автомобиля · локальное сохранение',W-38,39,15,C.muted,{align:'right'});
  cv.roundRect(48,72,W-96,420,16,C.panel);
  txt(cv,'КООРДИНАТЫ',82,116,15,C.muted);
  if(cameraDraft){txt(cv,cameraDraft.lat.toFixed(6)+' , '+cameraDraft.lon.toFixed(6),82,158,27,C.green);txt(cv,'Точность GPS: '+cameraDraft.accuracyM.toFixed(1)+' м',82,190,18,C.text);}
  else {txt(cv,'Ожидание GPS...',82,158,25,C.yellow);txt(cv,captureStatus,82,190,17,C.muted);}
  txt(cv,captureStatus,82,228,16,cameraDraft?C.green:C.yellow);
  ln(cv,[82,252],[W-82,252],1,'#2a3948');
  txt(cv,'ОГРАНИЧЕНИЕ СКОРОСТИ',82,292,15,C.muted);txt(cv,cameraLimit+' км/ч',82,338,34,C.text);
  txt(cv,'ТИП',520,292,15,C.muted);txt(cv,CAMERA_TYPES[cameraType],520,328,21,C.text);
  txt(cv,'НАПРАВЛЕНИЕ',1000,292,15,C.muted);txt(cv,cameraDirection==='forward'?'По последнему проезду':'Оба направления',1000,328,19,C.text);
  ln(cv,[82,366],[W-82,366],1,'#2a3948');
  const road= cameraDraft?addCameraRoad(cameraDraft.lat,cameraDraft.lon):null;
  txt(cv,road?'Дорожная траектория записана · предупреждения будут привязаны к ней':'Для дорожной привязки нужна запись GPS-траектории при подъезде',82,405,17,road?C.green:C.yellow);
  txt(cv,'Добавляйте камеру на стоянке. Текущая база камер не изменяется.',82,448,15,C.muted);
  drawTabs(cv,'ADD');drawActionLegend(cv,'ADD');return ui.image('MAIN_GFX',cv);
 }
 let localCameraIndex=0,deletePending=false;
 function drawCameraMenu(){const cv=ctx.canvas(W,H).clear(C.bg);cv.roundRect(18,12,W-36,40,10,'#111c27');txt(cv,'УПРАВЛЕНИЕ КАМЕРАМИ',36,39,20,C.text);cv.roundRect(260,100,1080,310,18,C.panel);txt(cv,'Мои камеры',800,190,34,C.text,{align:'center'});txt(cv,'Добавляйте новые камеры или просматривайте и удаляйте сохранённые.',800,240,20,C.muted,{align:'center'});txt(cv,'Сохранено вручную: '+localCameras.length,800,300,24,C.green,{align:'center'});drawTabs(cv,'MENU');return ui.image('MAIN_GFX',cv);}
 function renderMenuSafe(){Promise.resolve().then(drawCameraMenu).catch(e=>log.warn('camera menu render: '+e));}
 function drawMyCameras(){const cv=ctx.canvas(W,H).clear(C.bg);cv.roundRect(18,12,W-36,40,10,'#111c27');txt(cv,'МОИ КАМЕРЫ',660,39,20,C.text);cv.roundRect(48,72,W-96,420,16,C.panel);
  if(!localCameras.length){txt(cv,'Пользовательских камер пока нет',800,220,28,C.muted,{align:'center'});txt(cv,'Добавленные вручную камеры появятся здесь',800,265,18,C.muted,{align:'center'});}
  else{localCameraIndex=Math.max(0,Math.min(localCameraIndex,localCameras.length-1));const c=localCameras[localCameraIndex];txt(cv,(localCameraIndex+1)+' / '+localCameras.length,82,120,18,C.blue);txt(cv,c.type||c.name||'Камера',82,178,32,C.text);txt(cv,c.lat.toFixed(6)+' , '+c.lon.toFixed(6),82,225,22,C.green);txt(cv,'Ограничение: '+(c.limit===null?'не указано':c.limit+' км/ч'),82,270,20,C.text);txt(cv,'Направление: '+(c.direction==='both'?'Оба направления':'По направлению движения'),82,310,18,C.muted);txt(cv,c.road?'Дорожная привязка: есть':'Дорожная привязка: нет',82,350,18,c.road?C.green:C.yellow);txt(cv,'Источник: добавлена вручную',82,390,17,C.muted);}
  if(deletePending){cv.roundRect(300,165,1000,190,18,'#35121a');cv.strokeRoundRect(300,165,1000,190,18,2,C.red);txt(cv,'УДАЛИТЬ ЭТУ КАМЕРУ?',800,225,30,C.text,{align:'center'});txt(cv,'Нажми «Подтвердить», чтобы удалить только эту локальную запись.',800,275,18,C.muted,{align:'center'});}
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
 ui.onClick('BTN_CAMERA_MENU',cycleView);
 ui.onClick('BTN_CAM_PREV',()=>{if(view==='SETTINGS'){if(warningSettings){warningSettingIndex=(warningSettingIndex+2)%3;renderSafe();}else cycleDisplayMode(-1);return;}if(view==='ADD'){cameraLimit=Math.max(20,cameraLimit-10);renderSafe();}else if(view==='MY'){deletePending=false;localCameraIndex=Math.max(0,localCameraIndex-1);renderSafe();}else{index=Math.max(0,index-1);renderSafe();}});
 ui.onClick('BTN_CAM_NEXT',()=>{if(view==='SETTINGS'){if(warningSettings){warningSettingIndex=(warningSettingIndex+1)%3;renderSafe();}else cycleDisplayMode(1);return;}if(view==='ADD'){cameraLimit=Math.min(130,cameraLimit+10);renderSafe();}else if(view==='MY'){deletePending=false;localCameraIndex=Math.min(Math.max(0,localCameras.length-1),localCameraIndex+1);renderSafe();}else{index=Math.min(Math.max(0,cameras().length-1),index+1);renderSafe();}});
 ui.onClick('BTN_ZOOM',()=>{if(view==='SETTINGS'){warningSettings=!warningSettings;renderSafe();return;}if(view==='ADD'){cameraType=(cameraType+1)%CAMERA_TYPES.length;renderSafe();}else if(view==='MY'){if(localCameras.length){deletePending=true;renderSafe();}}else{const steps=[.55,.75,1,1.25,1.6,2,2.5];zoomIndex=(zoomIndex+1)%steps.length;zoom=steps[zoomIndex];renderSafe();}});
 ui.onClick('BTN_REFRESH',()=>{if(view==='SETTINGS'){if(warningSettings)changeWarningSetting();return;}if(view==='ADD'){cameraDirection=cameraDirection==='forward'?'both':'forward';renderSafe();}else if(view==='MY'){removeSelectedCamera();}else refresh();});
 ui.onClick('BTN_VOICE_TEST',()=>{if(view==='ADD'){saveLocalCamera();return;}if(view==='MY'){deletePending=false;beginAddCamera();view='ADD';renderSafe();return;}testCameraOutputs();});
 settings.onChange(k=>{if(k.indexOf('mapcam_')===0){mapcamWarnings.configure(mapcamOptions());clearLiveAlerts();renderSafe();return;}if(k==='city'){city=String(settings.get('city')||'russia');index=0;roadGuidance.reset();renderSafe();}else if(k==='camera_display'){cameraDisplayMode=String(settings.get('camera_display')||'kombi');clusterOutput.setMode(cameraDisplayMode);renderSafe();}});
 gps.on('change',gpsChanged);gps.start();ui.onVisible((n,v)=>{if(n==='MAIN'&&v)renderSafe();});
 renderSafe();refresh();setInterval(refresh,REFRESH_INTERVAL_MS);ctx.loop('MAIN',1000,()=>{if(fix&&Date.now()-fix.timeMs>3000){mapcamWarnings.suspend();roadGuidance.reset();clearLiveAlerts();}renderSafe();});
 log.info('Speed Camera Warning 0.9.0 started; MapCam sectors and control paths; GPS accuracy <15 m; KOMBI/HUD mode='+cameraDisplayMode);
}});
