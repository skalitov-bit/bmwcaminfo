'use strict';
const fs=require('fs'),zlib=require('zlib');
// Country packages retain the same cell format and viewport cache budgets.
const MAGIC='SCROAD01',MAX_HEADER=8*1024*1024,MAX_CELLS=200000,MAX_RAW=1024*1024;
function range(file,offset,size){return new Promise((resolve,reject)=>{
 fs.open(file,'r',(e,fd)=>{if(e)return reject(e);const b=Buffer.alloc(size);let pos=0;
  const end=(err)=>fs.close(fd,()=>err?reject(err):resolve(b));
  const next=()=>fs.read(fd,b,pos,size-pos,offset+pos,(err,n)=>{if(err)return end(err);if(!n)return end(Error('MAP_TRUNCATED'));pos+=n;if(pos===size)end();else next();});next();
 });
});}
function inflate(b,size){return new Promise((resolve,reject)=>{const z=zlib.createGunzip(),parts=[];let n=0,done=false;
 const fail=e=>{if(done)return;done=true;z.destroy();reject(e);};z.on('error',fail);z.on('data',p=>{n+=p.length;if(n>size||n>MAX_RAW)return fail(Error('MAP_CELL_TOO_LARGE'));parts.push(p);});z.on('end',()=>{if(done)return;if(n!==size)return fail(Error('MAP_CELL_SIZE'));done=true;resolve(Buffer.concat(parts));});z.end(b);
});}
function validateRoads(rows){if(!Array.isArray(rows)||rows.length>16000)throw Error('MAP_CELL_INVALID');
 rows.forEach(r=>{if(!Array.isArray(r)||r.length!==7||!Number.isInteger(r[0])||r[0]<0||r[0]>6||typeof r[1]!=='string'||r[1].length>100||![-1,0,1].includes(r[2])||!Number.isInteger(r[3])||Math.abs(r[3])>10||![0,1].includes(r[4])||![0,1].includes(r[5])||!Array.isArray(r[6])||r[6].length<4||r[6].length>16000||r[6].length%2||r[6].some((v,i)=>!Number.isInteger(v)||Math.abs(v)>(i%2?90e6:180e6)))throw Error('MAP_ROAD_INVALID');});return rows;
}
class CityRoads{
 constructor(file){this.file=file;this.cache=new Map();this.cacheBytes=0;this.version=0;this.generation=0;this.stats={reads:0,bytes:0,cacheBytes:0,loadMs:0};this.rows=[];this.wanted='';this.pending=null;this.closed=false;}
 async open(){const h=await range(this.file,0,12);if(h.slice(0,8).toString()!==MAGIC)throw Error('MAP_FORMAT');const n=h.readUInt32LE(8);if(n<50||n>MAX_HEADER)throw Error('MAP_HEADER_SIZE');this.start=12+n;
  const meta=JSON.parse((await range(this.file,12,n)).toString('utf8'));const total=fs.statSync(this.file).size;
  if(total>64*1024*1024||meta.schema!==1||!/^[a-z0-9-]{2,40}$/.test(meta.id)||meta.cellMicrodegrees!==10000||!meta.cells||Array.isArray(meta.cells)||Object.keys(meta.cells).length>MAX_CELLS||!Array.isArray(meta.bbox)||meta.bbox.length!==4||!meta.bbox.every(Number.isFinite)||meta.bbox[0]>=meta.bbox[2]||meta.bbox[1]>=meta.bbox[3])throw Error('MAP_HEADER_INVALID');
  Object.keys(meta.cells).forEach(k=>{const v=meta.cells[k];if(!/^-?\d+,-?\d+$/.test(k)||!Array.isArray(v)||v.length!==4||v.some(x=>!Number.isInteger(x)||x<0)||v[1]<1||v[1]>MAX_RAW||v[2]>MAX_RAW||v[2]<2||v[3]>16000||this.start+v[0]+v[1]>total)throw Error('MAP_INDEX_INVALID');});this.meta=meta;return this;
 }
 contains(p){const b=this.meta.bbox;return p&&p.lon>=b[0]&&p.lon<=b[2]&&p.lat>=b[1]&&p.lat<=b[3];}
 keys(p,radius,bounds){const dx=radius/(111320*Math.max(.1,Math.cos(p.lat*Math.PI/180))),dy=radius/111320,b=this.meta.bbox,keys=[],q=bounds||[p.lon-dx,p.lat-dy,p.lon+dx,p.lat+dy];
  for(let x=Math.floor(Math.max(b[0],q[0])*100);x<=Math.floor(Math.min(b[2],q[2])*100);x++)for(let y=Math.floor(Math.max(b[1],q[1])*100);y<=Math.floor(Math.min(b[3],q[3])*100);y++){const k=x+','+y;if(this.meta.cells[k])keys.push(k);}
  return keys.sort((a,b)=>{const aa=a.split(',').map(Number),bb=b.split(',').map(Number);return Math.pow(aa[0]-p.lon*100,2)+Math.pow(aa[1]-p.lat*100,2)-Math.pow(bb[0]-p.lon*100,2)-Math.pow(bb[1]-p.lat*100,2);}).slice(0,320);
 }
 async ensure(p,radius,bounds){if(this.closed)return false;const keys=this.contains(p)?this.keys(p,Math.min(6500,radius),bounds):[],sig=keys.slice().sort().join('|');if(sig===this.wanted)return this.pending||false;
  // One reader at a time: callers retry the newest viewport after this batch.
  if(this.pending)return this.pending;this.wanted=sig;const gen=this.generation,start=Date.now();
  this.pending=(async()=>{for(const k of keys){if(this.closed||gen!==this.generation)return false;if(this.cache.has(k))continue;const v=this.meta.cells[k],b=await range(this.file,this.start+v[0],v[1]),raw=await inflate(b,v[2]);if(this.closed||gen!==this.generation)return false;
    const rows=validateRoads(JSON.parse(raw.toString('utf8')));if(rows.length!==v[3])throw Error('MAP_CELL_COUNT');this.cache.set(k,{rows,bytes:v[2]});this.cacheBytes+=v[2];this.stats.reads++;this.stats.bytes+=v[1];}
   if(this.closed||gen!==this.generation)return false;const want=new Set(keys);for(const [k,v] of this.cache){if(!want.has(k)){this.cache.delete(k);this.cacheBytes-=v.bytes;}}
   // Budget is decoded JSON bytes, not an RSS promise. Dense views keep nearest cells.
   let bytes=0;this.rows=[];for(const k of keys){const v=this.cache.get(k);if(!v)continue;if(bytes+v.bytes>12*1024*1024){this.cache.delete(k);this.cacheBytes-=v.bytes;continue;}bytes+=v.bytes;this.rows.push.apply(this.rows,v.rows);}
   this.stats.cacheBytes=this.cacheBytes;this.stats.loadMs=Date.now()-start;this.version++;return true;
  })().catch(e=>{this.wanted='';throw e;}).then(v=>{this.pending=null;return v;},e=>{this.pending=null;throw e;});return this.pending;
 }
 close(){this.closed=true;this.generation++;this.cache.clear();this.rows=[];this.cacheBytes=0;this.version++;}
}
module.exports={CityRoads,range,inflate,validateRoads};
