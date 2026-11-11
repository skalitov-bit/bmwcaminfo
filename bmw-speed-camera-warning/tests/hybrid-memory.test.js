'use strict';
// Run separately with --max-old-space-size=64; do not retain all database rows.
const assert=require('assert'),path=require('path');
const {openCatalog}=require('../apps/aurelm_speed_camera_warning/hybrid-catalog');
async function run(){
 const c=await openCatalog(path.join(__dirname,'../apps/aurelm_speed_camera_warning'));
 const opened=process.memoryUsage();assert.strictEqual(c.readBlocks,0);
 const cities=[{lat:55.75,lon:37.62},{lat:56.63,lon:47.928},{lat:43.12,lon:131.9}];
 for(let i=0;i<150;i++){const rows=c.near(cities[i%3],i%10===0?25000:2100,500);assert(rows.length<=500);assert(c.cacheRecords<=1024&&c.cacheBytes<=131072&&c.cache.size<=8);}
 const final=process.memoryUsage();console.log(JSON.stringify({openedHeapMiB:opened.heapUsed/1048576,finalHeapMiB:final.heapUsed/1048576,finalRssMiB:final.rss/1048576,cacheRecords:c.cacheRecords,cacheRawBytes:c.cacheBytes,decodedBlocks:c.readBlocks,oldSpaceLimitMiB:64},null,2));c.close();
}
run().catch(e=>{console.error(e);process.exitCode=1;});
