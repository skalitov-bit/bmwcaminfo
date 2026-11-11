'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os');
const base=path.join(__dirname,'../apps/aurelm_speed_camera_warning');
const {CameraStore,validateDatabase,DATABASE_URL}=require(path.join(base,'camera-store'));
const {CameraIndex,distanceToCamera}=require(path.join(base,'camera-index'));
const {MapcamWarnings,bearing,pathSegments}=require(path.join(base,'mapcam-warnings'));
const data=require(path.join(base,'camera-db.json'));
const clean=validateDatabase(data), all=clean.cities.russia;
assert.strictEqual(all.length,data.sourceCounts.russia);
assert.strictEqual(new Set(all.map(c=>c.id)).size,all.length);
assert(all.some(c=>c.lon>150) && all.some(c=>c.lon<21),'The country must not be clipped to Mari El');
assert(all.some(c=>c.mapcamType==='average_speed'));
assert(all.some(c=>c.mapcamType==='mobile_speed'));
assert(all.some(c=>c.limit===null),'Unknown speed limits must remain unknown');
assert.strictEqual(clean.updatedAt,data.updatedAt);
assert(DATABASE_URL.includes('/skalitov-bit/bmwcaminfo/'));
const index=new CameraIndex(all);
const start=Date.now();
for(const fix of [{lat:56.63,lon:47.928},{lat:55.75,lon:37.62},{lat:43.12,lon:131.9},{lat:53.02,lon:158.65}]) {
    const actual=index.near(fix,1500).map(c=>c.id).sort();
    const expected=all.filter(c=>distanceToCamera(fix,c)<=1500).map(c=>c.id).sort();
    assert.deepStrictEqual(actual,expected,'Spatial index must retain every nearby camera');
    assert(index.near(fix,25000,500).length<=500);
}
const cellEdge=[{id:'a',lat:56.59999,lon:47.89999},{id:'b',lat:56.60001,lon:47.90001}];
assert.strictEqual(new CameraIndex(cellEdge).near(cellEdge[0],100).length,2);
const perf=Date.now();
for(let i=0;i<1000;i++)index.near({lat:55.75,lon:37.62},1500);
console.log('1000 nearby searches (ms):',Date.now()-perf);
assert.strictEqual(clean.datasetId,'mapcam-rus-v2');
assert.strictEqual(clean.warningSchemaVersion,1);
assert(all.filter(c=>c.mapcamPath.length>1).length>1000,'Nationwide control geometry must survive validation');
assert(all.every(c=>Number.isInteger(c.mapcamAngleDeg)));
const ids=new Map(all.map(c=>[c.id,c]));
// Actual database records, traversed with deterministic GPS fixes outside Mari El.
let pointChecked=false,pathChecked=false;
for(const c of all){
 if(!pointChecked && c.mapcamDirectionType===1 && c.mapcamWarningDistanceM>=300 && c.mapcamAngleDeg>=20 && c.mapcamPath.length===0 && c.lon<40){
  const h=c.mapcamApproachHeadingDeg*Math.PI/180;
  const fix=(d,t)=>({lat:c.lat-Math.cos(h)*d/111320,lon:c.lon-Math.sin(h)*d/(111320*Math.cos(c.lat*Math.PI/180)),headingDeg:c.mapcamApproachHeadingDeg,speedKmh:72,accuracyM:5,timeMs:t});
  const w=new MapcamWarnings();w.update(fix(220,1000),[c],1000);
  assert(w.update(fix(200,2000),[c],2000).some(e=>e.type==='camera'));
  console.log('Actual MapCam point approach:',c.id);pointChecked=true;
 }
 if(!pathChecked && c.mapcamTypeCode===4 && c.mapcamPath.length>1 && c.lon>60){
  const path=pathSegments(c),s=path.segments.find(s=>s.len>250);
  if(!s)continue;
  const f=(d,t)=>({lat:s.a.lat+(s.b.lat-s.a.lat)*d/s.len,lon:s.a.lon+(s.b.lon-s.a.lon)*d/s.len,headingDeg:s.heading,speedKmh:72,accuracyM:5,timeMs:t});
  const w=new MapcamWarnings(),a=f(100,1000),b=f(120,2000);
  w.update(a,index.near(a,2100),1000);w.update(b,index.near(b,2100),2000);
  assert(w.states[c.id]&&w.states[c.id].phase==='section');
  console.log('Actual MapCam section approach:',c.id);pathChecked=true;
 }
 if(pointChecked&&pathChecked)break;
}
assert(pointChecked&&pathChecked);
async function cacheTests(){
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-mapcam-'));
    try{
        const legacy={schemaVersion:1,revision:9999999999,cities:{'mari-el':[]}};
        fs.writeFileSync(path.join(tmp,'camera-db-cache.json'),JSON.stringify(legacy));
        const store=new CameraStore({dataDir:tmp,bundled:data,download:async()=>JSON.stringify(legacy)});
        assert.strictEqual(store.loadLocal().source,'bundle','Legacy cache cannot replace MapCam even with a high revision');
        let result=await store.refresh();assert.strictEqual(result.error,'CAMERA_DB_SOURCE_MISMATCH');
        assert.strictEqual(result.database.revision,data.revision);
        const old=Object.assign({},data,{datasetId:'mapcam-rus-v1',revision:data.revision+1});
        store.download=async()=>JSON.stringify(old);
        result=await store.refresh();assert.strictEqual(result.error,'CAMERA_DB_SOURCE_MISMATCH');
        assert.strictEqual(result.database.datasetId,'mapcam-rus-v2');
        const small={schemaVersion:1,revision:20,cities:{test:[{id:'c1',name:'Test',lat:1,lon:1,limit:60}]}};
        const folder=path.join(tmp,'small');fs.mkdirSync(folder);
        const s=new CameraStore({dataDir:folder,bundled:small,download:async()=>JSON.stringify(Object.assign({},small,{revision:19}))});
        result=await s.refresh();assert.strictEqual(result.error,'CAMERA_DB_OLDER_REVISION');assert(!fs.existsSync(s.cachePath));
        s.download=async()=>JSON.stringify(Object.assign({},small,{revision:21}));
        result=await s.refresh();assert(result.updated);assert.strictEqual(JSON.parse(fs.readFileSync(s.cachePath)).revision,21);
        const previous=fs.readFileSync(s.cachePath);
        s.download=async()=>'{broken';result=await s.refresh();assert(result.error);assert(fs.readFileSync(s.cachePath).equals(previous));
        assert.throws(()=>validateDatabase(Object.assign({},small,{cities:{test:[small.cities.test[0],small.cities.test[0]]}})),/DUPLICATE/);
    }finally{fs.rmSync(tmp,{recursive:true,force:true});}
}
cacheTests().then(()=>console.log('MapCam integration tests passed; RSS MiB:',Math.round(process.memoryUsage().rss/1048576)))
 .catch(e=>{console.error(e);process.exitCode=1;});
