'use strict';
const fs=require('fs'),path=require('path'),https=require('https'),crypto=require('crypto'),EventEmitter=require('events');
const {ensureDirectory}=require('./camera-store'),{CityRoads}=require('./city-roads');
const PREFIX='https://raw.githubusercontent.com/skalitov-bit/speedcam-db/',CATALOG_URL=PREFIX+'main/maps/catalog.json',MAX_FILE=64*1024*1024,MAX_INSTALLED=128*1024*1024;
function validEntry(e){if(!e||!/^[a-z0-9-]{2,40}$/.test(e.id)||typeof e.name!=='string'||e.name.length>60||typeof e.coverage!=='string'||e.coverage.length>160||!Number.isSafeInteger(e.revision)||e.revision<1||!Number.isInteger(e.bytes)||e.bytes<100||e.bytes>MAX_FILE||!/^\d{4}-\d\d-\d\dT/.test(e.createdAt)||!Number.isFinite(Date.parse(e.createdAt))||!/^[a-f0-9]{64}$/.test(e.sha256)||e.file!==e.id+'-'+e.sha256.slice(0,16)+'.scroads'||e.url!==PREFIX+'main/maps/'+e.file||!Array.isArray(e.bbox)||e.bbox.length!==4||!e.bbox.every(Number.isFinite)||e.bbox[0]>=e.bbox[2]||e.bbox[1]>=e.bbox[3]||e.bbox.some((v,i)=>Math.abs(v)>(i%2?90:180))||e.license!=='ODbL-1.0')throw Error('MAP_CATALOG_INVALID');return e;}
function validateCatalog(c){
 if(!c||c.schema!==1||!Array.isArray(c.cities)||c.extendedCities!==undefined&&!Array.isArray(c.extendedCities))throw Error('MAP_CATALOG_INVALID');
 // Older releases read only cities. Keep oversized packages out of that list
 // until a reader with country-index support is installed.
 const cities=c.cities.concat(c.extendedCities||[]);if(cities.length>300)throw Error('MAP_CATALOG_INVALID');
 const ids=new Set();cities.forEach(e=>{validEntry(e);if(ids.has(e.id))throw Error('MAP_CATALOG_DUPLICATE');ids.add(e.id);});return {schema:1,cities};
}
function atomicJson(file,obj){const t=file+'.tmp';fs.writeFileSync(t,JSON.stringify(obj));fs.renameSync(t,file);}
function download(url,file,limit,progress){return new Promise((resolve,reject)=>{
 if(!url.startsWith(PREFIX)||url.indexOf('..')>=0)return reject(Error('MAP_URL_NOT_ALLOWED'));
 let done=false,out=null,req,timer,bytes=0;const chunks=[],hash=crypto.createHash('sha256');
 const finish=(err,value)=>{if(done)return;done=true;clearTimeout(timer);if(err){if(req)req.destroy();if(out&&!out.closed){out.once('close',()=>{try{fs.unlinkSync(file);}catch(e){}reject(err);});out.destroy();}else{if(file){try{fs.unlinkSync(file);}catch(e){}}reject(err);}}else resolve(value);};
 timer=setTimeout(()=>finish(Error('MAP_TIMEOUT')),180000);
 // MGU runs Node 8: URL + options + callback is not supported there.
 req=https.get(Object.assign(require('url').parse(url),{headers:{'User-Agent':'SpeedCAM-City-Maps/1','Cache-Control':'no-cache'}}),res=>{
  if(res.statusCode!==200){res.resume();return finish(Error('MAP_HTTP_'+res.statusCode));}
  if(Number(res.headers['content-length'])>limit){res.resume();return finish(Error('MAP_SIZE'));}
  if(file){out=fs.createWriteStream(file,{flags:'wx'});out.on('error',e=>finish(e));let written=false;out.on('finish',()=>{written=true;});out.on('close',()=>{if(written&&!done)finish(null,{bytes,sha256:hash.digest('hex')});});}
  res.on('data',b=>{if(done)return;bytes+=b.length;if(bytes>limit)return finish(Error('MAP_SIZE'));hash.update(b);if(out){if(!out.write(b)){res.pause();out.once('drain',()=>res.resume());}}else chunks.push(b);if(progress)progress(bytes);});
  res.on('aborted',()=>finish(Error('MAP_TRUNCATED')));res.on('error',e=>finish(e));res.on('end',()=>{if(done)return;if(out)out.end();else finish(null,Buffer.concat(chunks));});
 });req.setTimeout(20000,()=>finish(Error('MAP_TIMEOUT')));req.on('error',e=>finish(e));
});}
function message(e){const s=String(e&&e.message||e);if(/ENOTFOUND|EAI_AGAIN|ENET|EHOST|ECONN|TIMEOUT|CERT|TLS/.test(s))return 'НЕТ СВЯЗИ С СЕРВЕРОМ. ПРОВЕРЬТЕ ИНТЕРНЕТ.';if(/ENOSPC|QUOTA/.test(s))return 'НЕДОСТАТОЧНО МЕСТА ДЛЯ КАРТЫ.';if(/MAP_OLDER/.test(s))return 'ОТКЛОНЕНО ОБНОВЛЕНИЕ НА БОЛЕЕ СТАРУЮ КАРТУ.';if(/MAP_HASH|MAP_SIZE|MAP_TRUNCATED/.test(s))return 'ФАЙЛ НЕ ПРОШЁЛ ПРОВЕРКУ. ПРЕЖНЯЯ КАРТА СОХРАНЕНА.';return 'ОШИБКА КАРТЫ: '+s.slice(0,130);}
class CityMapStore extends EventEmitter{
 constructor(dataDir,o){super();this.dir=path.join(dataDir,'city-maps');this.o=o||{};this.fetch=this.o.download||download;this.catalog={schema:1,cities:[]};this.installed={};this.busy=false;this.status='ВЫБЕРИТЕ ГОРОД И ЗАГРУЗИТЕ КАРТУ';this.progress=0;this.reader=null;this.readerId='';this.generation=0;this.closed=false;this.lastError='';this.opening=null;ensureDirectory(this.dir);this.load();}
 load(){for(const n of fs.readdirSync(this.dir)){if(/\.part$|\.tmp$/.test(n)){try{fs.unlinkSync(path.join(this.dir,n));}catch(e){}}}
  try{this.catalog=validateCatalog(JSON.parse(fs.readFileSync(path.join(this.dir,'catalog.json'),'utf8')));}catch(e){}
  try{const v=JSON.parse(fs.readFileSync(path.join(this.dir,'installed.json'),'utf8'));Object.keys(v).forEach(id=>{const e=validEntry(v[id]);if(id===e.id&&fs.statSync(path.join(this.dir,e.file)).size===e.bytes)this.installed[id]=e;});}catch(e){this.lastError=String(e.message);}
 }
 change(){if(!this.closed)this.emit('change');}
 async action(fn){if(this.busy||this.closed)return false;this.busy=true;this.lastError='';this.progress=0;this.change();try{return await fn();}catch(e){this.lastError=String(e.message||e);this.status=message(e);return false;}finally{this.busy=false;this.change();}}
 async refresh(){return this.action(async()=>{this.status='ЗАГРУЗКА СПИСКА ГОРОДОВ...';this.change();const c=validateCatalog(JSON.parse((await this.fetch(CATALOG_URL,null,256*1024)).toString('utf8')));atomicJson(path.join(this.dir,'catalog.json'),c);this.catalog=c;this.status='СПИСОК ГОРОДОВ ОБНОВЛЁН';return true;});}
 entry(id){return this.catalog.cities.find(e=>e.id===id)||this.installed[id];}
 state(id){const e=this.entry(id),i=this.installed[id];return !i?'НЕ УСТАНОВЛЕНА':e&&e.sha256!==i.sha256&&e.revision>i.revision?'ЕСТЬ ОБНОВЛЕНИЕ':'УСТАНОВЛЕНА';}
 async update(id){if(this.busy||this.closed)return false;if(!await this.refresh())return false;return this.install(id);}
 async install(id){return this.action(async()=>{const e=validEntry(this.entry(id)),old=this.installed[id];if(old&&(e.revision<old.revision||e.revision===old.revision&&e.sha256!==old.sha256))throw Error('MAP_OLDER');if(old&&old.sha256===e.sha256){this.status='КАРТА УЖЕ АКТУАЛЬНА';return true;}
  const used=Object.keys(this.installed).reduce((n,k)=>n+this.installed[k].bytes,0);if(used+e.bytes>MAX_INSTALLED)throw Error('MAP_QUOTA');
  const target=path.join(this.dir,e.file),temp=target+'.part';try{fs.unlinkSync(temp);}catch(x){}this.status='ЗАГРУЗКА: '+e.name;let last=-1;
  try{const r=await this.fetch(e.url,temp,e.bytes,n=>{const pct=Math.min(99,Math.floor(n/e.bytes*100));if(pct!==last){last=pct;this.progress=pct;this.change();}});if(r.bytes!==e.bytes)throw Error('MAP_SIZE');if(r.sha256!==e.sha256)throw Error('MAP_HASH');
   this.status='ПРОВЕРКА КАРТЫ...';this.change();const probe=await new CityRoads(temp).open();if(probe.meta.id!==id||probe.meta.revision!==e.revision)throw Error('MAP_PACKAGE_ID');probe.close();
   fs.renameSync(temp,target);const next=Object.assign({},this.installed,{[id]:e});atomicJson(path.join(this.dir,'installed.json'),next);this.installed=next;this.resetReader();if(old&&old.file!==e.file){try{fs.unlinkSync(path.join(this.dir,old.file));}catch(x){}}
   this.progress=100;this.status='КАРТА '+e.name.toUpperCase()+' УСТАНОВЛЕНА';return true;
  }finally{try{fs.unlinkSync(temp);}catch(x){}}
 });}
 async remove(id){return this.action(async()=>{const old=this.installed[id];if(!old)return true;const next=Object.assign({},this.installed);delete next[id];this.resetReader();atomicJson(path.join(this.dir,'installed.json'),next);this.installed=next;try{fs.unlinkSync(path.join(this.dir,old.file));}catch(e){if(e.code!=='ENOENT')throw e;}this.status='КАРТА УДАЛЕНА. БАЗА КАМЕР СОХРАНЕНА.';return true;});}
 resetReader(){this.generation++;if(this.reader)this.reader.close();this.reader=null;this.readerId='';this.opening=null;}
 async choose(p){
  const candidates=Object.keys(this.installed).filter(k=>{const b=this.installed[k].bbox;return p.lon>=b[0]&&p.lon<=b[2]&&p.lat>=b[1]&&p.lat<=b[3];});
  if(candidates.length<2)return candidates[0];
  // Administrative extracts have overlapping rectangular bounds. Select by
  // actual indexed roads near the car, not installation order. Cache only four
  // headers; do not load road payloads merely to choose a region.
  if(!this.indexCache)this.indexCache=new Map();
  const x=Math.floor(p.lon*100),y=Math.floor(p.lat*100),fx=Math.cos(p.lat*Math.PI/180);
  let best=null,bestScore=Infinity;
  for(const id of candidates){const e=this.installed[id];let cells;
   if(this.readerId===id&&this.reader)cells=this.reader.meta.cells;
   else if(this.indexCache.has(e.file))cells=this.indexCache.get(e.file);
   else{let r;try{r=await new CityRoads(path.join(this.dir,e.file)).open();if(this.closed)return;cells=r.meta.cells;this.indexCache.set(e.file,cells);while(this.indexCache.size>4)this.indexCache.delete(this.indexCache.keys().next().value);}catch(err){this.lastError=String(err.message);continue;}finally{if(r)r.close();}}
   let score=Infinity;
   for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){const v=cells[(x+dx)+','+(y+dy)];if(!v||!v[3])continue;const ex=(x+dx+.5-p.lon*100)*fx,ey=y+dy+.5-p.lat*100;score=Math.min(score,ex*ex+ey*ey);}
   if(score<bestScore||score===bestScore&&id===this.readerId){best=id;bestScore=score;}
  }
  return best||candidates.find(id=>id===this.readerId)||candidates[0];
 }
 async ensure(p,radius,bounds){if(this.closed||this.selecting)return;const generation=this.generation;this.selecting=true;let id;try{id=await this.choose(p);}finally{this.selecting=false;}if(this.closed||generation!==this.generation)return;
  if(!id){if(this.reader)this.resetReader();return;}
  if(this.readerId!==id){if(this.opening)return;this.resetReader();const gen=this.generation;this.opening=id;try{const r=await new CityRoads(path.join(this.dir,this.installed[id].file)).open();if(this.closed||gen!==this.generation){r.close();return;}this.reader=r;this.readerId=id;}catch(e){this.lastError=String(e.message);return;}finally{if(gen===this.generation)this.opening=null;}}
  const r=this.reader;if(!r)return;try{const changed=await r.ensure(p,radius,bounds);if(changed&&r===this.reader)this.change();}catch(e){this.lastError=String(e.message);}
 }
 close(){this.closed=true;this.resetReader();if(this.indexCache)this.indexCache.clear();this.removeAllListeners();}
}
module.exports={CityMapStore,validateCatalog,validEntry,download,message,CATALOG_URL};
