'use strict';
// Real package validation on a simulated HDD; no claim about vehicle disk latency.
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert');
const app=path.resolve(process.argv[3]||path.join(__dirname,'../apps/aurelm_speed_camera_warning'));
const {CityMapStore}=require(app+'/city-map-store'),{verify}=require(app+'/city-map-storage');
(async()=>{
 const maps=path.resolve(process.argv[2]),c=JSON.parse(fs.readFileSync(path.join(maps,'catalog.json'),'utf8'));
 const entries=c.cities.concat(c.extendedCities||[]).filter(e=>fs.existsSync(path.join(maps,e.file))).sort((a,b)=>b.bytes-a.bytes),e=entries[0];assert(e);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'speedcam-hdd-package-')),local=path.join(dir,'city-maps'),share=path.join(dir,'hdd');fs.mkdirSync(local);fs.mkdirSync(share);fs.copyFileSync(path.join(maps,e.file),path.join(local,e.file));fs.writeFileSync(path.join(local,'installed.json'),JSON.stringify({[e.id]:e}));fs.writeFileSync(path.join(local,'catalog.json'),JSON.stringify({schema:1,cities:[e]}));
 const start=Date.now(),baseline=process.memoryUsage();let peak=baseline.rss,beats=0,maxDelay=0,last=start;
 const timer=setInterval(()=>{const now=Date.now();maxDelay=Math.max(maxDelay,now-last);last=now;peak=Math.max(peak,process.memoryUsage().rss);beats++;},20);
 const s=new CityMapStore(dir,{storage:{share,mounted:()=>true,freeBytes:async()=>1e9}});
 try{await s.ready;assert.equal(s.installed[e.id]._storage,'hdd',s.lastError);assert(!fs.existsSync(path.join(local,e.file)));await verify(path.join(s.storage.root,e.file),e);assert.equal(s.installed[e.id].sha256,e.sha256);assert(beats>0,'migration yields to the event loop');console.log(JSON.stringify({ok:true,id:e.id,bytes:e.bytes,sha256:e.sha256,migrationAndVerificationMs:Date.now()-start,eventLoopTicks:beats,maxTickGapMs:maxDelay,rssDeltaPeakMiB:(peak-baseline.rss)/1048576,node:process.version,simulatedHdd:true}));
 }finally{clearInterval(timer);s.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
