'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),cp=require('child_process');
const base=path.join(__dirname,'../apps/aurelm_speed_camera_warning');
const db=require(path.join(base,'camera-db.json')),map=require(path.join(base,'city-map.json'));
assert(Number.isInteger(db.revision) && db.revision>=3);
assert(Array.isArray(db.cities['mari-el']));
assert(Array.isArray(db.cities['yoshkar-ola']));
assert(db.cities['yoshkar-ola'].filter(c=>typeof c.lat==='number'&&typeof c.lon==='number').length>=4);
assert.strictEqual(db.datasetId,'mapcam-rus-v2');
assert(db.cities.russia.length>=50000);
const {validateDatabase}=require('../apps/aurelm_speed_camera_warning/camera-store');
const validated=validateDatabase(db);
assert.strictEqual(validated.cities.russia.length,db.cities.russia.length);
assert(validated.cities.russia.every(c=>c.source==='MapCam.info'));
assert(validated.cities.russia.some(c=>c.mapcamTravel.length===2));
assert(map.roads.length>=20);
assert(map.source && map.source.includes('OpenStreetMap'));
for(const r of map.roads){assert.strictEqual(r.length,5);assert(r.slice(1).every(Number.isFinite));}
const app=JSON.parse(fs.readFileSync(path.join(base,'app.json'),'utf8'));
assert.strictEqual(app.version,'0.9.30');assert.strictEqual(app.screens.length,1,'Camera management must stay inside one MGU window');
assert.strictEqual(app.screens[0].name,'MAIN');
assert.strictEqual(app.screens[0].kind,'canvas');
for(const id of ['BTN_CAM_PREV','BTN_CAM_NEXT','BTN_ZOOM','BTN_REFRESH','BTN_VOICE_TEST','BTN_CAMERA_MENU'])assert(app.screens[0].buttons.some(b=>b[0]===id),'Missing main-window control '+id);
const mainSource=fs.readFileSync(path.join(base,'main.js'),'utf8');
assert(mainSource.includes("function drawTabs(cv,active)"),'In-window tabs must be rendered');
assert(mainSource.includes("function cycleView()"),'Tabs must switch views without opening another screen');
assert(mainSource.includes("view='MY';renderSafe()"),'Saving a camera must return to My Cameras tab');
assert(mainSource.includes("if(view==='MY'){if(localCameras.length){deletePending=true;renderSafe();}}"),'My Cameras tab must expose delete action');
assert(mainSource.includes("if(view==='MY'){deletePending=false;beginAddCamera();view='ADD';renderSafe();return;}"),'My Cameras tab must expose add action');
assert(mainSource.includes("if(view==='ADD'){saveLocalCamera();return;}"),'Add tab must expose save action');
const {LocalCameraStore}=require(path.join(base,'local-camera-store'));
const os=require('os'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'local-cameras-'));
try{const local=new LocalCameraStore(tmp);local.add({id:'local-test-1234',lat:56.63,lon:47.92,limit:60,type:'Камера скорости',direction:'both',road:null});
const reloaded=new LocalCameraStore(tmp).load();assert.strictEqual(reloaded.length,1);assert.strictEqual(reloaded[0].limit,60);assert.strictEqual(reloaded[0].source,'local-user');
local.add({id:'local-test-5678',lat:56.631,lon:47.921,limit:null,type:'Контроль светофора',direction:'forward',road:{pts:[[-100,0],[0,0]],camM:100}});
assert.strictEqual(new LocalCameraStore(tmp).load()[1].limit,null);
assert.strictEqual(local.remove('local-test-1234'),true);assert.strictEqual(new LocalCameraStore(tmp).load().length,1);
assert.strictEqual(local.remove('local-test-1234'),false);}
finally{fs.rmSync(tmp,{recursive:true,force:true});}
assert(app.settings[0].options.some(o=>o[0]==='mari-el'));
assert(app.screens[0].buttons.some(b=>b[0]==='BTN_VOICE_TEST'),'Voice test button must be present');
for(const [id,label] of Object.entries({BTN_CAM_PREV:'1',BTN_CAM_NEXT:'2',BTN_ZOOM:'3',BTN_REFRESH:'4',BTN_VOICE_TEST:'5'}))assert(app.screens[0].buttons.some(b=>b[0]===id&&b[1]===label),'Missing numbered button label '+id);
const {ProximityWarnings}=require(path.join(base,'proximity.js'));
const warnings=new ProximityWarnings();
const near={id:'test-camera',name:'Test',lat:56.63,lon:47.928};
const northFix={lat:56.629,lon:47.928,speedKmh:36,headingDeg:0,accuracyM:10};
assert.strictEqual(warnings.update(northFix,[near]).filter(e=>e.type==='camera').length,1,
  'Warn for a camera ahead on the current heading');
assert.strictEqual(new ProximityWarnings().update({lat:56.631,lon:47.928,speedKmh:36,headingDeg:0,accuracyM:10},[near]).length,0,
  'Do not warn for a camera behind the vehicle');
assert.strictEqual(new ProximityWarnings().update({lat:56.629,lon:47.931,speedKmh:36,headingDeg:0,accuracyM:10},[near]).length,0,
  'Do not warn for a camera far off the current road corridor');
assert.strictEqual(new ProximityWarnings().update({lat:56.629,lon:47.928,speedKmh:0,headingDeg:0,accuracyM:10},[near]).length,0,
  'Do not warn when course is unreliable at very low speed');
const limited={id:'limited-camera',name:'60 zone',lat:56.63,lon:47.928,limit:60};
const limitFix={lat:56.6264,lon:47.928,speedKmh:77,headingDeg:0,accuracyM:10};
let w=new ProximityWarnings();
assert(!w.update(limitFix,[limited]).some(e=>e.type==='speeding'), 'No speeding alert below +18 km/h');
w=new ProximityWarnings();
assert(w.update(Object.assign({},limitFix,{speedKmh:78}),[limited]).some(e=>e.type==='speeding'&&e.excessKmh===18), 'Speeding alert must trigger at exactly +18 km/h');
w=new ProximityWarnings();
const road={name:'Тестовая улица',limitKmh:40,a:[56.6299,47.928],b:[56.6301,47.928]};
const roadEvent=w.update({lat:56.629,lon:47.928,speedKmh:100,headingDeg:0,accuracyM:10},[near],[road]).find(e=>e.type==='speeding');
assert(!roadEvent,'OSM road-segment limits must not trigger speeding alerts');
w=new ProximityWarnings();
assert(!w.update({lat:56.629,lon:47.928,speedKmh:100,headingDeg:0,accuracyM:10},[{id:'unknown-limit',lat:56.63,lon:47.928}]).some(e=>e.type==='speeding'), 'Do not infer speeding when camera limit is unknown');
for(const f of ['notification-session.js','notification-rules.js','mapcam-warnings.js','main.js','gps.js','camera-store.js','local-camera-store.js','proximity.js','road-guidance.js','voice-alert.js','cluster-output.js','cluster_render_client.js'])cp.execFileSync(process.execPath,['--check',path.join(base,f)]);
cp.execFileSync(process.env.PYTHON || 'python3',['-m','py_compile',path.join(__dirname,'../tools/import_camera_sources.py')]);
cp.execFileSync(process.env.PYTHON || 'python3',['-m','py_compile',path.join(__dirname,'../tools/import_city_roads.py')]);
console.log('Speed Camera Warning 0.9.30 tests passed');
