'use strict';
// Only the spatial index is resident. Camera records are read by byte offset.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {validateCamera}=require('./camera-store');
const {distanceToCamera}=require('./camera-index');
const MANIFEST='camera-manifest-v1.json',INDEX='camera-index-v1.json',RECORDS='camera-records-v1.jsonl';
const MAX_INDEX=12*1048576,MAX_CATALOG=64*1048576,MAX_RECORD=256*1024;
function fail(){throw new Error('CAMERA_CATALOG_INVALID');}
function validateManifest(m){
    if(!m||m.schemaVersion!==1||m.format!=='mapcam-indexed-v1'||m.datasetId!=='mapcam-rus-v2'||m.warningSchemaVersion!==1||
       !Number.isSafeInteger(m.revision)||m.revision<1||!Number.isInteger(m.count)||m.count<50000||m.count>200000||
       typeof m.contentHash!=='string'||!/^[a-f0-9]{64}$/.test(m.contentHash)||!m.cityCounts||m.cityCounts.russia!==m.count)fail();
    Object.keys(m.cityCounts).forEach(k=>{if(!/^[a-z0-9-]{2,40}$/.test(k)||!Number.isInteger(m.cityCounts[k])||m.cityCounts[k]<0||m.cityCounts[k]>m.count)fail();});
    [['index',INDEX,MAX_INDEX],['records',RECORDS,MAX_CATALOG]].forEach(([key,file,max])=>{
        const f=m[key];if(!f||f.file!==file||!Number.isSafeInteger(f.bytes)||f.bytes<1||f.bytes>max||typeof f.sha256!=='string'||!/^[a-f0-9]{64}$/.test(f.sha256))fail();
    });
    if(m.index.bytes+m.records.bytes>MAX_CATALOG)fail();
    return m;
}
function readSmall(file,max){if(fs.statSync(file).size>max)fail();return JSON.parse(fs.readFileSync(file,'utf8'));}
function readManifest(dir){return validateManifest(readSmall(path.join(dir,MANIFEST),16384));}
function verifyFile(file,descriptor){
    return new Promise((resolve,reject)=>{
        let size=0;const hash=crypto.createHash('sha256'),stream=fs.createReadStream(file,{highWaterMark:65536});
        stream.on('data',b=>{size+=b.length;if(size>descriptor.bytes)stream.destroy(new Error('CAMERA_CATALOG_SIZE'));else hash.update(b);});
        stream.on('error',reject);stream.on('end',()=>{
            if(size!==descriptor.bytes||hash.digest('hex')!==descriptor.sha256)reject(new Error('CAMERA_CATALOG_HASH'));else resolve();
        });
    });
}
function validateIndex(v,m){
    if(!v||v.schemaVersion!==1||v.cellSize!==0.1||!Array.isArray(v.records)||v.records.length!==m.count||
       !v.cells||typeof v.cells!=='object'||Array.isArray(v.cells)||!Array.isArray(v.longPaths)||!v.cities||typeof v.cities!=='object')fail();
    let end=0,refs=0;const covered=new Uint8Array(m.count);
    v.records.forEach(r=>{if(!Array.isArray(r)||r.length!==2||!Number.isSafeInteger(r[0])||r[0]!==end||!Number.isInteger(r[1])||r[1]<2||r[1]>MAX_RECORD)fail();end+=r[1];});
    if(end!==m.records.bytes)fail();
    const list=(rows,coverage)=>{if(!Array.isArray(rows)||rows.length>m.count)fail();refs+=rows.length;if(refs>1500000)fail();rows.forEach(i=>{if(!Number.isInteger(i)||i<0||i>=m.count)fail();if(coverage)covered[i]=1;});};
    Object.keys(v.cells).forEach(k=>{if(!/^-?\d{1,4}:-?\d{1,4}$/.test(k))fail();const parts=k.split(':').map(Number);if(parts[0]<-900||parts[0]>900||parts[1]<-1800||parts[1]>1800)fail();list(v.cells[k],true);});
    list(v.longPaths,true);if(covered.some(x=>!x))fail();
    if(Object.keys(v.cities).length!==Object.keys(m.cityCounts).length-1)fail();
    Object.keys(v.cities).forEach(k=>{if(k==='russia'||!Object.prototype.hasOwnProperty.call(m.cityCounts,k))fail();list(v.cities[k],false);if(v.cities[k].length!==m.cityCounts[k]||new Set(v.cities[k]).size!==v.cities[k].length)fail();});
    return v;
}
class CameraCatalog{
    constructor(dir,manifest,index){
        this.dir=dir;this.manifest=manifest;this.index=index;this.revision=manifest.revision;this.contentHash=manifest.contentHash;this.datasetId=manifest.datasetId;
        this.cities=Object.create(null);Object.keys(manifest.cityCounts).forEach(k=>{this.cities[k]={length:manifest.cityCounts[k]};});
        this.fd=fs.openSync(path.join(dir,RECORDS),'r');this.cache=new Map();this.cacheBytes=0;
    }
    record(i){
        if(this.fd===null)throw new Error('CAMERA_CATALOG_CLOSED');
        if(this.cache.has(i)){const entry=this.cache.get(i);this.cache.delete(i);this.cache.set(i,entry);return entry.camera;}
        const r=this.index.records[i];if(!r)fail();
        const bytes=Buffer.allocUnsafe(r[1]);let n=0;
        while(n<bytes.length){const got=fs.readSync(this.fd,bytes,n,bytes.length-n,r[0]+n);if(!got)throw new Error('CAMERA_CATALOG_TRUNCATED');n+=got;}
        const camera=validateCamera(JSON.parse(bytes.toString('utf8')),this.datasetId);
        this.cache.set(i,{camera,bytes:r[1]});this.cacheBytes+=r[1];
        while(this.cache.size>512||this.cacheBytes>2*1048576){const key=this.cache.keys().next().value;this.cacheBytes-=this.cache.get(key).bytes;this.cache.delete(key);}
        return camera;
    }
    recordsFor(city){return (this.index.cities[city]||[]).map(i=>this.record(i));}
    near(fix,radius,limit){
        if(!fix||!Number.isFinite(fix.lat)||!Number.isFinite(fix.lon)||Math.abs(fix.lat)>90||Math.abs(fix.lon)>180)return [];
        if(!Number.isFinite(radius)||radius<0||radius>25000)throw new Error('CAMERA_CATALOG_RADIUS');
        const dy=radius/111320,dx=dy/Math.max(0.01,Math.cos(fix.lat*Math.PI/180)),seen=new Set(),hits=[];
        const add=i=>{if(seen.has(i))return;seen.add(i);const c=this.record(i),distance=distanceToCamera(fix,c);if(distance<=radius)hits.push({c,distance});};
        const y0=Math.floor(Math.max(-90,fix.lat-dy)/0.1),y1=Math.floor(Math.min(90,fix.lat+dy)/0.1);
        const x0=Math.floor(Math.max(-180,fix.lon-dx)/0.1),x1=Math.floor(Math.min(180,fix.lon+dx)/0.1);
        for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)(this.index.cells[y+':'+x]||[]).forEach(add);
        this.index.longPaths.forEach(add);
        hits.sort((a,b)=>a.distance-b.distance||a.c.id.localeCompare(b.c.id));
        return hits.slice(0,limit===undefined?hits.length:limit).map(h=>h.c);
    }
    close(){if(this.fd!==null){fs.closeSync(this.fd);this.fd=null;}this.cache.clear();this.cacheBytes=0;this.index=null;}
}
async function openCatalog(dir,manifest){
    const m=manifest||readManifest(dir);
    await verifyFile(path.join(dir,INDEX),m.index);await verifyFile(path.join(dir,RECORDS),m.records);
    return new CameraCatalog(dir,m,validateIndex(readSmall(path.join(dir,INDEX),MAX_INDEX),m));
}
module.exports={CameraCatalog,openCatalog,readManifest,validateManifest,validateIndex,verifyFile,MANIFEST,INDEX,RECORDS};
