'use strict';
const assert=require('assert'),path=require('path');
const base=path.resolve(process.argv[2]);
const {openCatalog}=require(path.join(base,'hybrid-catalog'));
async function run(){
 const c=await openCatalog(base),f={lat:55.75,lon:37.62},ids=rows=>rows.map(r=>r.id).sort();
 const expected=c.near(f,4200),initial=c.nearWarnings(f);
 assert.deepStrictEqual(ids(initial),ids(expected));assert(c.warningCache.cache.size>0);
 await c.region.pending.promise;
 assert.equal(c.warningCache.cache.size,0);assert.equal(c.cache.size,0);assert.equal(c.warningCache.cacheRecords,0);
 assert.deepStrictEqual(ids(c.nearWarnings(f)),ids(expected));
 const version=c.region.version,reads=c.readBlocks;
 const shifted={lat:f.lat+4900/111320,lon:f.lon};
 c.nearWarnings(shifted);assert.equal(c.region.version,version);assert.equal(c.readBlocks,reads);
 // Failure at the next region must retain the old region and complete fallback.
 c.region.load=async()=>{throw Error('test-preload-failed');};
 c.nearWarnings({lat:f.lat+5100/111320,lon:f.lon});await c.region.pending.promise;
 assert.equal(c.region.version,version);assert.equal(c.region.error,'test-preload-failed');
 const edge={lat:f.lat+6100/111320,lon:f.lon};
 assert.deepStrictEqual(ids(c.nearWarnings(edge)),ids(c.near(edge,4200)));
 assert(c.warningCache.cache.size>0,'Fallback remains available outside safe coverage');
 c.close();console.log('PASS activation frees duplicate cache; 10/5 coverage and failed-preload fallback preserved');
}
run().catch(e=>{console.error(e.stack);process.exitCode=1;});
