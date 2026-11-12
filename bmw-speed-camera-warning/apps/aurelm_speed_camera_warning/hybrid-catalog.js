'use strict';
const {policeKind}=require('./point-kind');
const fs=require('fs'),path=require('path'),zlib=require('zlib');
const {verifyFile}=require('./camera-catalog');
const {distanceToCamera}=require('./camera-index');
const MANIFEST='hybrid-manifest-v1.json',INDEX='hybrid-index-v1.bin',RECORDS='hybrid-records-v1.bin';
const MAX_INDEX=4*1048576,MAX_RECORDS=32*1048576,MAX_RAW=262144,SIZE=52;
const MONITOR_RADIUS_M=4200;
function cacheState(multiplier){return {cache:new Map(),cacheBytes:0,cacheRecords:0,maxBlocks:8*multiplier,maxBytes:131072*multiplier,maxRecords:1024*multiplier};}
function fail(){throw new Error('HYBRID_CATALOG_INVALID');}
function validateManifest(m){
 if(!m||m.schemaVersion!==1||m.datasetId!=='hybrid-rus-v1'||m.format!=='hybrid-blocks-v1'||m.warningSchemaVersion!==1||m.cellSize!==.05||m.recordSize!==SIZE||
 !Number.isSafeInteger(m.revision)||m.revision<1||!Number.isInteger(m.count)||m.count<1||m.count>500000||!Number.isInteger(m.warningCount)||m.warningCount<0||m.warningCount>m.count||
 !m.cityCounts||m.cityCounts.russia!==m.warningCount||typeof m.contentHash!=='string'||!/^[a-f0-9]{64}$/.test(m.contentHash)||m.maxRawBlockBytes!==MAX_RAW)fail();
 for(const [key,file,max] of [['index',INDEX,MAX_INDEX],['records',RECORDS,MAX_RECORDS]]){const d=m[key];if(!d||d.file!==file||!Number.isSafeInteger(d.bytes)||d.bytes<1||d.bytes>max||!/^[a-f0-9]{64}$/.test(d.sha256))fail();}
 for(const city of Object.keys(m.cityCounts))if(!['russia','mari-el','yoshkar-ola'].includes(city)||!Number.isInteger(m.cityCounts[city])||m.cityCounts[city]<0||m.cityCounts[city]>m.warningCount)fail();
 return m;
}
function readManifest(dir){const f=path.join(dir,MANIFEST);if(fs.statSync(f).size>16384)fail();return validateManifest(JSON.parse(fs.readFileSync(f,'utf8')));}
function readIndex(dir,m){
 const b=fs.readFileSync(path.join(dir,INDEX));if(b.length!==m.index.bytes||b.length<24||b.slice(0,8).toString('binary')!=='BHYIDX1\x00'||b.readUInt16LE(8)!==1||b.readUInt16LE(10)!==SIZE||b.readUInt32LE(16)!==m.count)fail();
 const n=b.readUInt32LE(12),extra=b.readUInt32LE(20);if(n<1||n>m.count||24+n*28+extra!==b.length)fail();
 const blocks=[],cells=Object.create(null);let end=0,count=0,warnings=0;
 for(let i=0;i<n;i++){
  const p=24+i*28,y=b.readInt16LE(p),x=b.readInt16LE(p+2),d={y,x,offset:b.readUInt32LE(p+4),bytes:b.readUInt32LE(p+8),raw:b.readUInt32LE(p+12),count:b.readUInt16LE(p+16),warnings:b.readUInt16LE(p+18),cities:b.readUInt32LE(p+20)};
  if(y<-1800||y>1800||x<-3600||x>3600||d.offset!==end||d.bytes<1||d.bytes>MAX_RAW+1024||d.raw<d.count*SIZE||d.raw>MAX_RAW||d.count<1||d.count>256||d.warnings>d.count||d.cities>6||b.readUInt32LE(p+24)!==0)fail();
  end+=d.bytes;count+=d.count;warnings+=d.warnings;blocks.push(d);(cells[y+':'+x]||(cells[y+':'+x]=[])).push(i);
 }
 if(end!==m.records.bytes||count!==m.count||warnings!==m.warningCount)fail();
 const meta=JSON.parse(b.slice(24+n*28).toString('utf8'));
 if(!meta.types||!meta.models||!meta.pathCells||!Array.isArray(meta.longBlocks)||!meta.sourceRevisions||!meta.cityBits)fail();
 for(const key of Object.keys(meta.types)){const t=meta.types[key];if(!/^[em]\d{1,3}$/.test(key)||!Array.isArray(t)||t.length!==3||t.some(v=>typeof v!=='string'||v.length>180))fail();}
 for(const key of Object.keys(meta.models)){const v=meta.models[key];if(!/^\d{1,3}$/.test(key)||!v||v.code!==Number(key)||(v.name!==null&&typeof v.name!=='string')||(v.name&&v.name.length>100))fail();}
 let refs=0;
 for(const key of Object.keys(meta.pathCells)){
  const a=meta.pathCells[key];if(!/^-?\d{1,4}:-?\d{1,4}$/.test(key)||!Array.isArray(a))fail();refs+=a.length;
  if(refs>200000)fail();for(const i of a){if(!Number.isInteger(i)||i<0||i>=n)fail();(cells[key]||(cells[key]=[])).push(i);}
 }
 if(meta.longBlocks.some(i=>!Number.isInteger(i)||i<0||i>=n))fail();
 return {blocks,cells,meta};
}
function geometry(s,lat,lon){
 if(!s)return [];let p=0,y=Math.trunc(Math.fround(lat)*100000),x=Math.trunc(Math.fround(lon)*100000),pts=[[lat,lon]];
 function delta(){let v=0,shift=0;while(true){if(p>=s.length||shift>30)fail();const b=s.charCodeAt(p++)-63;if(b<0||b>63)fail();v|=(b&31)<<shift;if(b<32)return v&1?~(v>>>1):v>>>1;shift+=5;}}
 while(p<s.length){y+=delta();x+=delta();if(Math.abs(y/100000)>90||Math.abs(x/100000)>180||pts.length>2050)fail();if(y/100000!==pts[pts.length-1][0]||x/100000!==pts[pts.length-1][1])pts.push([y/100000,x/100000]);}
 return pts.length>1?pts:[];
}
function nullable(v,sentinel,scale){return v===sentinel?null:v/(scale||1);}
function decodeRecord(b,p,count,meta){
 const latI=b.readInt32LE(p),lonI=b.readInt32LE(p+4),sourceId=b.readUInt32LE(p+8),code=b.readUInt16LE(p+12),model=b[p+14],flags=b[p+15],e=!!(flags&1),source=e?'estrelka':'mapcam',type=meta.types[(e?'e':'m')+code],mod=meta.models[model];
 const limit=b.readUInt16LE(p+16)||null,dt=b[p+18],heading=nullable(b.readUInt16LE(p+20),65535,100),warning=b.readUInt16LE(p+22),rawFlags=nullable(b.readUInt16LE(p+24),65535),additional=nullable(b.readUInt32LE(p+26),4294967295),off=b.readUInt32LE(p+30),len=b.readUInt16LE(p+34),angle=nullable(b.readUInt16LE(p+36),65535),azimuth=nullable(b.readUInt16LE(p+38),65535,100);
 if(!type||!mod||Math.abs(latI)>900000000||Math.abs(lonI)>1800000000||dt>3||flags>7||b[p+19]!==0||(limit!==null&&(limit<5||limit>250))||(heading!==null&&heading>=360)||(azimuth!==null&&azimuth>511)||(angle!==null&&angle>255)||warning>2047||off<count*SIZE||off+len>b.length)fail();
 if(!e&&len>0&&len<8)fail();
 const id=e?'estrelka-'+b.slice(p+40,p+52).toString('hex'):'mapcam-'+sourceId,geo=b.slice(off,off+len),encoded=e?null:geo.slice(8).toString('utf8')||null,extra=e?geo.toString('hex')||null:null;
 const lat=latI/1e7,lon=lonI/1e7,family=type[2],name=mod.name||null,warningEnabled=['fixed','mobile','dummy','weight_control'].includes(family)||!!policeKind({typeNamespace:source,typeCode:code});
 const c={id,name:name||type[1],type:type[1],lat,lon,limit,source:e?'еСтрелка':'MapCam.info',sourceLabel:(e?'еСтрелка':'MapCam.info')+' · '+String(meta.sourceRevisions[source]).slice(0,10),sourceRecordId:sourceId,typeNamespace:source,typeCode:code,camera_model:name,camera_model_code:model||null,camera_model_kind:mod.kind,camera_family:family,warningProfile:'hybrid-v1',warningEnabled,averageControl:e?code===227:code===4,cityMask:flags&6,
  mapcamTypeCode:e?null:code,mapcamType:type[0],mapcamDirectionType:dt,mapcamApproachHeadingDeg:heading,mapcamTravel:heading===null?[]:dt===1?[heading]:dt===2?[heading,(heading+180)%360]:[],mapcamWarningDistanceM:warning,mapcamAngleDeg:angle===null?60:angle,mapcamControlDirection:null,mapcamHours:null,mapcamPath:encoded?geometry(encoded,geo.readFloatLE(0),geo.readFloatLE(4)):[],
  originalAngleDeg:angle,originalAzimuthDeg:azimuth,estrelkaFlagsRaw:rawFlags,estrelkaAdditionalDistanceM:additional,encodedGeometry:encoded,estrelkaGeometryHex:extra};
 if(c.mapcamPath.length)c.mapcamPath[0]=[lat,lon];return c;
}
function canonical(c){return [c.id,Math.round(c.lat*1e7),Math.round(c.lon*1e7),c.sourceRecordId,c.typeNamespace,c.typeCode,c.camera_model,c.camera_model_code,c.limit,c.mapcamDirectionType,c.mapcamApproachHeadingDeg===null?null:Math.round(c.mapcamApproachHeadingDeg*100),c.mapcamWarningDistanceM,c.estrelkaFlagsRaw,c.estrelkaAdditionalDistanceM,c.originalAngleDeg,c.originalAzimuthDeg===null?null:Math.round(c.originalAzimuthDeg*100),c.encodedGeometry,c.estrelkaGeometryHex];}
class HybridCatalog{
 constructor(dir,m,index){this.dir=dir;this.manifest=m;this.index=index;this.revision=m.revision;this.contentHash=m.contentHash;this.datasetId=m.datasetId;this.cities={};for(const k of Object.keys(m.cityCounts))this.cities[k]={length:m.cityCounts[k]};this.fd=fs.openSync(path.join(dir,RECORDS),'r');Object.assign(this,cacheState(1));this.warningCache=cacheState(2);this.readBlocks=0;}
 block(i,cache=this){
  if(this.fd===null)throw new Error('HYBRID_CATALOG_CLOSED');if(cache.cache.has(i)){const v=cache.cache.get(i);cache.cache.delete(i);cache.cache.set(i,v);return v.records;}
  const d=this.index.blocks[i];if(!d)fail();const compressed=Buffer.allocUnsafe(d.bytes);let n=0;
  while(n<d.bytes){const got=fs.readSync(this.fd,compressed,n,d.bytes-n,d.offset+n);if(!got)throw new Error('HYBRID_CATALOG_TRUNCATED');n+=got;}
  const raw=zlib.inflateSync(compressed,{maxOutputLength:d.raw,chunkSize:Math.max(64,Math.min(16384,d.raw))});if(raw.length!==d.raw)fail();const records=[];
  for(let p=0;p<d.count*SIZE;p+=SIZE)records.push(decodeRecord(raw,p,d.count,this.index.meta));
  this.readBlocks++;if(d.raw<=cache.maxBytes){cache.cache.set(i,{records,bytes:d.raw});cache.cacheBytes+=d.raw;cache.cacheRecords+=records.length;
   while(cache.cache.size>cache.maxBlocks||cache.cacheBytes>cache.maxBytes||cache.cacheRecords>cache.maxRecords){const key=cache.cache.keys().next().value,v=cache.cache.get(key);cache.cache.delete(key);cache.cacheBytes-=v.bytes;cache.cacheRecords-=v.records.length;}}
  return records;
 }
 // Map and regional browsing never evict blocks reserved for warnings.
 nearWarnings(fix){return this.near(fix,MONITOR_RADIUS_M,undefined,this.warningCache);}
 near(fix,radius,limit,cache=this){
  if(!fix||!Number.isFinite(fix.lat)||!Number.isFinite(fix.lon)||Math.abs(fix.lat)>90||Math.abs(fix.lon)>180)return [];
  if(!Number.isFinite(radius)||radius<0||radius>25000)throw new Error('HYBRID_RADIUS');
  if(limit!==undefined&&(!Number.isInteger(limit)||limit<0||limit>10000))throw new Error('HYBRID_LIMIT');if(limit===0)return [];
  const dy=radius/111320,dx=dy/Math.max(.01,Math.cos(fix.lat*Math.PI/180)),blocks=new Set(this.index.meta.longBlocks),hits=[];
  for(let y=Math.floor((fix.lat-dy)/.05);y<=Math.floor((fix.lat+dy)/.05);y++)for(let x=Math.floor((fix.lon-dx)/.05);x<=Math.floor((fix.lon+dx)/.05);x++)for(const i of this.index.cells[y+':'+x]||[])blocks.add(i);
  const compare=(a,b)=>a.d-b.d||a.c.id.localeCompare(b.c.id);
  // Old indices count only cameras; a zero-warning block can contain a police post.
  for(const i of blocks){for(const c of this.block(i,cache)){if(!c.warningEnabled)continue;const d=distanceToCamera(fix,c);if(d>radius)continue;const hit={c,d};
   if(limit===undefined){hits.push(hit);continue;}
   // The 25km map view retains only the requested nearest 500 objects, not all
   // decoded cameras in a large city. Monitoring's 4.2km query remains complete.
   if(hits.length===limit&&compare(hit,hits[hits.length-1])>=0)continue;
   let lo=0,hi=hits.length;while(lo<hi){const mid=(lo+hi)>>1;if(compare(hits[mid],hit)<=0)lo=mid+1;else hi=mid;}
   hits.splice(lo,0,hit);if(hits.length>limit)hits.pop();
  }}
  if(limit===undefined)hits.sort(compare);return hits.map(h=>h.c);
 }
 recordsFor(city){const bit=this.index.meta.cityBits[city];if(!bit)return [];const result=[];for(let i=0;i<this.index.blocks.length;i++){const d=this.index.blocks[i];if(d.cities&bit)for(const c of this.block(i))if(c.warningEnabled&&(c.cityMask&bit))result.push(c);}return result;}
 close(){if(this.fd!==null){fs.closeSync(this.fd);this.fd=null;}for(const cache of [this,this.warningCache]){cache.cache.clear();cache.cacheBytes=0;cache.cacheRecords=0;}this.index=null;}
}
async function openCatalog(dir,manifest){const m=validateManifest(manifest||readManifest(dir));await verifyFile(path.join(dir,INDEX),m.index);await verifyFile(path.join(dir,RECORDS),m.records);return new HybridCatalog(dir,m,readIndex(dir,m));}
module.exports={HybridCatalog,openCatalog,readManifest,validateManifest,decodeRecord,canonical,geometry,MANIFEST,INDEX,RECORDS,MONITOR_RADIUS_M};
