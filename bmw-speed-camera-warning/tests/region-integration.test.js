'use strict';
const assert=require('assert'),path=require('path');
const base=path.resolve(process.argv[2]),{openCatalog}=require(base+'/hybrid-catalog');
const tick=()=>new Promise(r=>setImmediate(r));
async function run(){
 const db=await openCatalog(base),ids=a=>a.map(c=>c.id).sort();let heartbeats=0;
 const timer=setInterval(()=>heartbeats++,1),origin={lat:55.75,lon:37.62};
 const point=m=>({lat:origin.lat+m/111320,lon:origin.lon});
 db.nearWarnings(origin);const first=db.region.pending;assert(first);
 await first.promise;assert(db.region.active);assert(heartbeats>0,'Loading must yield to the event loop');
 assert(db.region.active.count>500,'Region must include all warnings, not map cap');
 const warm=db.readBlocks;
 for(let i=0;i<20;i++)db.nearWarnings(point(i*20));assert.equal(db.readBlocks,warm,'Warm queries do not reread blocks');
 let comparisons=0;
 for(const m of [0,100,4900,5100,5500,5800,6100,10000,15000,100000]){
  const p=point(m);assert.deepStrictEqual(ids(db.nearWarnings(p)),ids(db.near(p,4200,undefined,db.warningCache)));comparisons++;
  while(db.region.pending)await db.region.pending.promise;
  assert.deepStrictEqual(ids(db.nearWarnings(p)),ids(db.near(p,4200,undefined,db.warningCache)));comparisons++;
  assert(db.nearMap(p,500).length<=500);
 }
 assert(db.region.loads>=3);
 db.nearWarnings(point(200000));await tick();const pending=db.region.pending;db.close();
 if(pending)await pending.promise;assert(!db.region.active,'Closing/replacing database cannot activate an old region');
 clearInterval(timer);
 // Memory-budget failures keep the old disk query available.
 const limited=await openCatalog(base);limited.loadRegion=()=>Promise.reject(Error('REGION_CAMERA_LIMIT'));
 const baseline=ids(limited.near(origin,4200,undefined,limited.warningCache));
 assert.deepStrictEqual(ids(limited.nearWarnings(origin)),baseline);await limited.region.pending.promise;
 assert.equal(limited.region.error,'REGION_CAMERA_LIMIT');assert.deepStrictEqual(ids(limited.nearWarnings(origin)),baseline);limited.close();
 console.log(JSON.stringify({comparisons,heartbeats,asyncLoad:'ok',fullWarningCoverage:'ok',failureFallback:'ok',closeCancellation:'ok'}));
}run().catch(e=>{console.error(e.stack);process.exitCode=1;});
