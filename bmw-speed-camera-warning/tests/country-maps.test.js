'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os'),zlib=require('zlib');
const {CityRoads}=require('../apps/aurelm_speed_camera_warning/city-roads');
const {validateCatalog}=require('../apps/aurelm_speed_camera_warning/city-map-store');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'speedcam-country-'));
function entry(id){const file=id+'-'+ 'a'.repeat(16)+'.scroads';return {id,name:id,coverage:'country',revision:1,createdAt:'2026-11-24T00:00:00Z',bytes:100,sha256:'a'.repeat(64),file,url:'https://raw.githubusercontent.com/skalitov-bit/speedcam-db/main/maps/'+file,bbox:[22,50,34,57],license:'ODbL-1.0'};}
function write(meta,payload){const h=Buffer.from(JSON.stringify(meta)),prefix=Buffer.alloc(12);prefix.write('SCROAD01');prefix.writeUInt32LE(h.length,8);const f=path.join(dir,'map-'+Object.keys(meta.cells).length+'.scroads');fs.writeFileSync(f,Buffer.concat([prefix,h,payload||Buffer.alloc(0)]));return f;}
async function fails(file,code){try{await new CityRoads(file).open();assert.fail('accepted invalid package');}catch(e){assert.equal(e.message,code);}}
async function run(){
 const a=entry('moscow'),b=entry('belarus'),cat={schema:1,cities:[a],extendedCities:[b]};
 assert.deepEqual(validateCatalog(cat).cities.map(e=>e.id),['moscow','belarus']);assert.equal(cat.cities.length,1);
 assert.deepEqual(validateCatalog(validateCatalog(cat)).cities,[a,b],'cached normalized catalog is idempotent');
 assert.throws(()=>validateCatalog({schema:1,cities:[a],extendedCities:[a]}),/MAP_CATALOG_DUPLICATE/);
 assert.throws(()=>validateCatalog({schema:1,cities:[a],extendedCities:{}}),/MAP_CATALOG_INVALID/);
 assert.throws(()=>validateCatalog({schema:1,cities:[a],extendedCities:[Object.assign({},b,{url:'https://invalid.test/file'})]}),/MAP_CATALOG_INVALID/);
 const rows=[[5,'Street',0,0,0,0,[27000000,53000000,27000100,53000100]]],raw=Buffer.from(JSON.stringify(rows)),chunk=zlib.gzipSync(raw),cells={};
 // A country-sized index above both old limits, with a block per cell.
 for(let i=0;i<140000;i++)cells[(2300+i%1000)+','+(5100+Math.floor(i/1000))]=[i*chunk.length,chunk.length,raw.length,1];
 const meta={schema:1,id:'country-test',revision:1,cellMicrodegrees:10000,bbox:[22,50,34,57],cells};
 const f=write(meta,Buffer.concat(Array(140000).fill(chunk))),r=await new CityRoads(f).open();assert.equal(Object.keys(r.meta.cells).length,140000);assert(r.start>2*1024*1024);r.close();fs.unlinkSync(f);
 for(let i=140000;i<=200000;i++)cells[(2300+i%1000)+','+(5100+Math.floor(i/1000))]=[0,chunk.length,raw.length,1];
 const tooMany=write(meta);await fails(tooMany,'MAP_HEADER_INVALID');fs.unlinkSync(tooMany);
 const prefix=Buffer.alloc(12);prefix.write('SCROAD01');prefix.writeUInt32LE(8*1024*1024+1,8);const huge=path.join(dir,'huge.scroads');fs.writeFileSync(huge,prefix);await fails(huge,'MAP_HEADER_SIZE');fs.unlinkSync(huge);
 fs.rmdirSync(dir);console.log('country maps: extended catalog, legacy isolation, large index and hard limits OK');
}
run().catch(e=>{console.error(e.stack);process.exitCode=1;});
