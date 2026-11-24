'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const app=path.resolve(process.argv[4]||path.resolve(__dirname,'../apps/aurelm_speed_camera_warning'));
const data=path.resolve(process.argv[2]),old=path.resolve(process.argv[3]);
const {openCatalog,validateManifest,canonical}=require(path.join(app,'hybrid-catalog'));
const {validateChannel}=require(path.join(app,'database-channel'));
const oldChannel=require(path.join(old,'database-channel')).validateChannel;
const oldManifest=require(path.join(old,'hybrid-catalog')).validateManifest;
const m=JSON.parse(fs.readFileSync(path.join(data,'hybrid-manifest-v1.json'),'utf8'));
const clone=()=>JSON.parse(JSON.stringify(m));
assert(m.count>500000&&m.count<=1000000);
assert.throws(()=>oldManifest(m),/HYBRID_CATALOG_INVALID/);
const ch={schemaVersion:1,minAppVersion:'0.9.96',manifest:m,files:{}};
for(const k of ['index','records'])ch.files[k]='https://github.com/skalitov-bit/speedcam-db/releases/download/db-'+m.revision+'-'+m.contentHash.slice(0,12)+'/'+m[k].file;
assert.throws(()=>oldChannel(ch),/DB_REQUIRES_APP_UPDATE/);
validateChannel(ch);
let test=clone();test.count=1000000;validateManifest(test);
test.count=1000001;assert.throws(()=>validateManifest(test));
for(const [key,max] of [['index',4194304],['records',33554432]]){test=clone();test[key].bytes=max+1;assert.throws(()=>validateManifest(test));}
(async()=>{
 if(global.gc)global.gc();const before=process.memoryUsage().heapUsed,t0=Date.now();
 const cat=await openCatalog(data),openMs=Date.now()-t0;
 assert.equal(cat.readBlocks,0,'Opening must not decode the full database');
 if(global.gc)global.gc();const openHeap=process.memoryUsage().heapUsed-before;
 const hash=crypto.createHash('sha256');let count=0;const seen=new Set();
 for(let i=0;i<cat.index.blocks.length;i++)for(const row of cat.block(i)){
   assert(!seen.has(row.id),'Duplicate ID');seen.add(row.id);count++;hash.update(JSON.stringify(canonical(row))+'\n');
 }
 assert.equal(count,m.count);assert.equal(hash.digest('hex'),m.contentHash);
 assert(cat.cache.size<=8&&cat.cacheBytes<=131072&&cat.cacheRecords<=1024);
 const queryStart=Date.now(),queries=[];
 for(const fix of [{lat:55.75,lon:37.62},{lat:25.2,lon:55.27},{lat:41.72,lon:44.79},{lat:52.52,lon:13.4}]){
   const rows=cat.near(fix,10000,500);assert(rows.length>0&&rows.length<=500);queries.push(rows.length);
 }
 const report={ok:true,records:count,uniqueIds:seen.size,allFieldsHashVerified:true,oldAppRequiresUpdate:true,maxRecords:1000000,byteLimitsUnchanged:true,openMs,openHeapMiB:Math.round(openHeap/1048576*100)/100,decodedBlocksOnOpen:0,mapCacheRecords:cat.cacheRecords,mapCacheBytes:cat.cacheBytes,mapCacheBlocks:cat.cache.size,queryCounts:queries,fourQueriesMs:Date.now()-queryStart};
 cat.close();console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});

