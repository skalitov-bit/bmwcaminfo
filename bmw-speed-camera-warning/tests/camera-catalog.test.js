'use strict';
// Exhaustive record comparison on the build host. The MGU never loads this JSON.
const assert=require('assert'),fs=require('fs'),path=require('path');
const base=path.join(__dirname,'../apps/aurelm_speed_camera_warning');
const {openCatalog}=require(path.join(base,'camera-catalog'));
const {validateCamera}=require(path.join(base,'camera-store'));
const {CameraIndex}=require(path.join(base,'camera-index'));
const {MapcamWarnings,pathSegments}=require(path.join(base,'mapcam-warnings'));
async function run(){
    const source=JSON.parse(fs.readFileSync(path.join(base,'camera-db.json'),'utf8')),catalog=await openCatalog(base);
    try{
        const rows=source.cities.russia;
        for(let i=0;i<rows.length;i++)assert.deepStrictEqual(catalog.record(i),validateCamera(rows[i],source.datasetId),'Record '+i);
        for(const name of Object.keys(source.cities).filter(n=>n!=='russia'))assert.deepStrictEqual(catalog.recordsFor(name),source.cities[name].map(c=>validateCamera(c,source.datasetId)));
        const index=new CameraIndex(rows),fixes=[{lat:56.63,lon:47.928},{lat:55.75,lon:37.62},{lat:43.12,lon:131.9},{lat:53.02,lon:158.65},{lat:54.7,lon:20.5}];
        for(let i=0;i<rows.length;i+=701)fixes.push(rows[i]);
        for(const fix of fixes)assert.deepStrictEqual(catalog.near(fix,2100).map(c=>c.id),index.near(fix,2100).map(c=>c.id));
        for(const fix of fixes.slice(0,5))assert.deepStrictEqual(catalog.near(fix,25000,500).map(c=>c.id),index.near(fix,25000,500).map(c=>c.id));
        const long=rows.find(c=>c.id==='mapcam-959188'),segments=pathSegments(long).segments,s=segments.find(x=>x.len>250);
        const f=(d,t)=>({lat:s.a.lat+(s.b.lat-s.a.lat)*d/s.len,lon:s.a.lon+(s.b.lon-s.a.lon)*d/s.len,headingDeg:s.heading,speedKmh:72,accuracyM:5,timeMs:t});
        const w=new MapcamWarnings();w.update(f(100,1000),catalog.near(f(100,1000),2100),1000);w.update(f(120,2000),catalog.near(f(120,2000),2100),2000);
        assert(w.states[long.id]&&w.states[long.id].phase==='section');
        assert(catalog.cache.size<=512&&catalog.cacheBytes<=2*1048576);
        console.log('PASS '+rows.length+' records and regional views identical; '+fixes.length+' spatial comparisons; real section warning; bounded cache');
    }finally{catalog.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
