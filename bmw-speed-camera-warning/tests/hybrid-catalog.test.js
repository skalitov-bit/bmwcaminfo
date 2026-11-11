'use strict';
const assert=require('assert'),path=require('path'),fs=require('fs'),os=require('os'),crypto=require('crypto');
const base=path.resolve(process.argv[2]||path.join(__dirname,'../apps/aurelm_speed_camera_warning'));
const {openCatalog,canonical,readManifest,validateManifest,INDEX,RECORDS,MANIFEST}=require(path.join(base,'hybrid-catalog'));
const {MapcamWarnings,pathSegments}=require(path.join(base,'mapcam-warnings'));
const {category}=require(path.join(base,'camera-label'));
const {distanceToCamera}=require(path.join(base,'camera-index'));
const {CameraStore}=require(path.join(base,'disk-camera-store'));
const queries=[{lat:56.63,lon:47.928},{lat:55.75,lon:37.62},{lat:43.12,lon:131.9},{lat:53.02,lon:158.65}];
async function run(){
 const initial=process.memoryUsage().heapUsed,c=await openCatalog(base),digest=crypto.createHash('sha256'),ids=new Set(),expected=queries.map(()=>[]),counts={},cityCounts={'yoshkar-ola':0,'mari-el':0};let count=0,named=0,warningCount=0,sample=null,sectionSample=null,unknownModel=false;
 assert.strictEqual(c.readBlocks,0,'Opening must not decode the nationwide database');
 for(let i=0;i<c.index.blocks.length;i++)for(const r of c.block(i)){
  count++;assert(!ids.has(r.id));ids.add(r.id);digest.update(JSON.stringify(canonical(r))+'\n');
  counts[r.camera_family]=(counts[r.camera_family]||0)+1;named+=!!r.camera_model;
  if(r.warningEnabled){warningCount++;for(const city of Object.keys(cityCounts))cityCounts[city]+=!!(r.cityMask&c.index.meta.cityBits[city]);queries.forEach((q,j)=>{if(distanceToCamera(q,r)<=2100)expected[j].push(r.id);});}
  if(r.source==='еСтрелка'&&r.camera_model==='СТРЕЛКА'&&r.camera_family==='fixed'&&r.mapcamDirectionType===1&&r.mapcamWarningDistanceM>=300&&!r.averageControl)sample=r;
  if(!sectionSample&&r.mapcamTypeCode===4&&r.mapcamPath.length>1){const segment=pathSegments(r).segments.find(s=>s.len>250);if(segment)sectionSample={camera:r,segment};}
  if(r.source==='еСтрелка'&&!r.camera_model){unknownModel=true;assert(category(r).full);}
  if(r.camera_family==='dummy')assert(category(r).full.toUpperCase().includes('МУЛЯЖ'),'A model name must not hide dummy status');
 }
 assert.strictEqual(count,c.manifest.count);assert.strictEqual(named,c.manifest.namedCount);assert.strictEqual(warningCount,c.manifest.warningCount);assert.deepStrictEqual(counts,c.manifest.familyCounts);
 assert.strictEqual(digest.digest('hex'),c.manifest.contentHash,'Every runtime field must agree with the SQLite export');
 for(const city of Object.keys(cityCounts)){assert.strictEqual(cityCounts[city],c.cities[city].length);assert.strictEqual(c.recordsFor(city).length,cityCounts[city]);}
 for(let j=0;j<queries.length;j++)assert.deepStrictEqual(c.near(queries[j],2100).map(r=>r.id).sort(),expected[j].sort(),'Spatial index must agree with exhaustive search');
 assert.deepStrictEqual(c.near(queries[1],25000,500).map(r=>r.id),c.near(queries[1],25000).slice(0,500).map(r=>r.id),'Bounded map selection must retain the true nearest objects');
 assert(c.cacheRecords<=1024&&c.cacheBytes<=131072&&c.cache.size<=8);
 assert(unknownModel&&sample);assert.strictEqual(category(sample).full,'СТРЕЛКА');assert.strictEqual(sample.mapcamTypeCode,null,'Estrelka category codes must never be treated as MapCam codes');
 const heading=sample.mapcamApproachHeadingDeg*Math.PI/180;
 const fix=(d,t)=>({lat:sample.lat-Math.cos(heading)*d/111320,lon:sample.lon-Math.sin(heading)*d/(111320*Math.cos(sample.lat*Math.PI/180)),accuracyM:5,speedKmh:100,timeMs:t});
 const w=new MapcamWarnings();w.update(fix(220,1000),[sample],1000);assert(w.update(fix(200,2000),[sample],2000).some(e=>e.type==='camera'),'Actual Estrelka point must trigger');
 assert(sectionSample,'A genuine MapCam average-control section must survive the hybrid');
 const sc=sectionSample.camera,sg=sectionSample.segment,sectionFix=(d,t)=>({lat:sg.a.lat+(sg.b.lat-sg.a.lat)*d/sg.len,lon:sg.a.lon+(sg.b.lon-sg.a.lon)*d/sg.len,accuracyM:5,speedKmh:72,timeMs:t});
 const sw=new MapcamWarnings(),fa=sectionFix(100,1000),fb=sectionFix(120,2000);sw.update(fa,c.near(fa,2100),1000);sw.update(fb,c.near(fb,2100),2000);
 assert(sw.states[sc.id]&&sw.states[sc.id].phase==='section'&&sw.states[sc.id].useAverage,'Actual binary MapCam geometry must enable section average control');
 for(const kind of ['dummy','average']){const a=Object.assign({},sample,{id:'test-'+kind,limit:20,camera_family:kind==='dummy'?'dummy':'fixed',averageControl:kind==='average'}),ww=new MapcamWarnings();ww.update(fix(220,1000),[a],1000);const events=ww.update(fix(200,2000),[a],2000);assert(events.some(e=>e.type==='camera'));assert(!events.some(e=>e.type==='speeding'),'No instantaneous speeding for dummy or unpaired average control');assert.strictEqual(ww.states[a.id].useAverage,false);}
 const nearStart=Date.now();for(let i=0;i<100;i++)c.near(queries[1],2100);const elapsed=Date.now()-nearStart;
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'hybrid-test-'));let store;
 try{
  store=new CameraStore({dataDir:tmp,bundledDir:base,request:()=>{throw new Error('Bundled channel must not contact an unpublished endpoint');}});
  const loaded=await store.loadLocal();assert.strictEqual(loaded.database.datasetId,'hybrid-rus-v1');assert.strictEqual(loaded.database.readBlocks,0);const refresh=await store.refresh();assert(!refresh.updated&&refresh.message&&refresh.database===loaded.database);
  const bad=JSON.parse(JSON.stringify(c.manifest));bad.records.file='../escape.bin';assert.throws(()=>validateManifest(bad));
  for(const f of [MANIFEST,INDEX,RECORDS])fs.copyFileSync(path.join(base,f),path.join(tmp,f));
  const fd=fs.openSync(path.join(tmp,RECORDS),'r+');fs.writeSync(fd,Buffer.from([0]),0,1,0);fs.closeSync(fd);
  await assert.rejects(openCatalog(tmp),/HASH/,'Corruption must be rejected before activation');
 }finally{if(store)store.close();fs.rmSync(tmp,{recursive:true,force:true});}
 const result={count,named,warningCount,cityCounts,binaryBytes:c.manifest.records.bytes+c.manifest.index.bytes,cacheRecords:c.cacheRecords,cacheBytes:c.cacheBytes,near100Ms:elapsed,desktopHeapMiB:Math.round(process.memoryUsage().heapUsed/1048576),allFieldsRoundtrip:'ok',spatialAgainstFullScan:'ok',corruptionRejected:true};
 c.close();assert.throws(()=>c.block(0),/CLOSED/);console.log(JSON.stringify(result,null,2));
}
run().catch(e=>{console.error(e);process.exitCode=1;});
