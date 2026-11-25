'use strict';
// Road packages only. Camera databases and application settings stay in dataDir.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),child=require('child_process');
const {CityRoads}=require('./city-roads');
const mounts=require('./hdd-mounts');
const SHARE='/var/opt/hdshare',RESERVE=64*1024*1024;
function regular(file){try{const s=fs.lstatSync(file);return s.isFile()&&!s.isSymbolicLink()?s:null;}catch(e){return null;}}
function unescapeMount(s){return s.replace(/\\([0-7]{3})/g,(_,n)=>String.fromCharCode(parseInt(n,8)));}
function mountedShare(text,share){return text.split('\n').some(line=>{const a=line.split(' '),cut=a.indexOf('-');return cut>5&&unescapeMount(a[4])===share&&a[2].split(':')[0]!=='0'&&a[5].split(',').includes('rw');});}
function diskFree(dir){return new Promise((resolve,reject)=>child.execFile('df',['-Pk',dir],{timeout:3000,maxBuffer:16384},(err,out)=>{
 if(err)return reject(err);const lines=String(out).trim().split('\n'),cols=lines[lines.length-1].trim().split(/\s+/),n=Number(cols[cols.length-3]);
 if(cols.length<5||!Number.isFinite(n)||n<0)return reject(Error('MAP_HDD_FREE_UNKNOWN'));resolve(n*1024);
}));}
function syncDirectory(dir){if(process.platform!=='linux')return;const fd=fs.openSync(dir,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function atomicJson(file,obj){const temp=file+'.tmp',fd=fs.openSync(temp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(obj));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,file);
 // Persist the rename before deleting a source package. Windows cannot fsync dirs.
 syncDirectory(path.dirname(file));
}
async function verify(file,e,checkPackage){const st=regular(file);if(!st||st.size!==e.bytes)throw Error('MAP_SIZE');
 const hash=crypto.createHash('sha256');let bytes=0;
 await new Promise((resolve,reject)=>{const input=fs.createReadStream(file,{highWaterMark:128*1024});input.on('error',reject);input.on('data',b=>{bytes+=b.length;hash.update(b);});input.on('end',resolve);});
 if(bytes!==e.bytes||hash.digest('hex')!==e.sha256)throw Error('MAP_HASH');if(checkPackage===false)return;let reader;
 try{reader=await new CityRoads(file).open();if(reader.meta.id!==e.id||reader.meta.revision!==e.revision)throw Error('MAP_PACKAGE_ID');}finally{if(reader)reader.close();}
}
function copy(source,target,alive,progress){return new Promise((resolve,reject)=>{
 let settled=false,err=null,bytes=0;const out=fs.createWriteStream(target,{flags:'wx',mode:0o600}),input=fs.createReadStream(source,{highWaterMark:128*1024});
 const fail=e=>{if(err)return;err=e;input.destroy();out.destroy();};
 input.on('error',fail);out.on('error',fail);
 input.on('data',b=>{if(!alive())return fail(Error('MAP_MIGRATION_INTERRUPTED'));bytes+=b.length;if(progress)progress(bytes);});
 out.on('close',()=>{if(settled)return;settled=true;if(err)return reject(err);let fd;
  try{fd=fs.openSync(target,'r+');fs.fsyncSync(fd);resolve(bytes);}catch(e){reject(e);}finally{if(fd!==undefined)fs.closeSync(fd);}
 });input.pipe(out);
});}
class CityMapStorage{
 constructor(local,options){this.local=local;this.o=options||{};this.uid=typeof process.getuid==='function'?process.getuid():0;this.shares=this.o.shares||(this.o.share?[this.o.share]:mounts.SHARES);this.share=this.shares[0];this.root=path.join(this.share,'speedcam-city-maps-'+this.uid);this.device=null;this.reason='';this.active=false;this.attempts=[];this.pin=null;
  try{const p=JSON.parse(fs.readFileSync(path.join(local,'hdd-location.json'),'utf8'));if(this.shares.indexOf(p.share)>=0&&typeof p.realPath==='string')this.pin=p;}catch(e){}
  if(!this.pin)try{const entries=JSON.parse(fs.readFileSync(path.join(local,'installed.json'),'utf8'));if(Object.keys(entries).some(k=>entries[k]._storage==='hdd'))this.pin={share:this.share,legacy:true};}catch(e){}
  if(this.pin){this.share=this.pin.share;this.root=path.join(this.pin.realPath||this.share,'speedcam-city-maps-'+this.uid);}
 }
 inspect(share){if(this.o.inspect)return this.o.inspect(share);if(this.o.mounted){try{return this.o.mounted(share)?{path:share,ok:true,realPath:fs.realpathSync(share),device:fs.statSync(share).dev}:{path:share,ok:false,reason:'MAP_HDD_NOT_MOUNTED'};}catch(e){return {path:share,ok:false,reason:e.code||e.message};}}return process.platform==='linux'?mounts.inspect(share,this.local):{path:share,ok:false,reason:'MAP_HDD_PLATFORM'};}
 mounted(){const r=this.inspect(this.share);return r.ok&&r.realPath===path.dirname(this.root)&&(this.device===null||r.device===this.device);}
 available(force){const now=Date.now();if(!force&&this.checkedAt&&now-this.checkedAt<1000)return this.cachedAvailable;
  this.checkedAt=now;try{this.cachedAvailable=this.active&&this.mounted()&&fs.realpathSync(this.root)===this.root&&fs.statSync(this.root).dev===this.device;}catch(e){this.cachedAvailable=false;}return this.cachedAvailable;}
 probeWrite(){
  try{fs.mkdirSync(this.root,0o700);syncDirectory(this.share);}catch(e){if(e.code!=='EEXIST')throw e;}
  if(fs.realpathSync(this.root)!==this.root||fs.statSync(this.root).dev!==fs.statSync(this.share).dev)throw Error('MAP_HDD_PATH');
  const probe=path.join(this.root,'.write-'+process.pid+'-'+crypto.randomBytes(6).toString('hex')),fd=fs.openSync(probe,'wx',0o600);try{fs.writeSync(fd,'ok');fs.fsyncSync(fd);}finally{fs.closeSync(fd);fs.unlinkSync(probe);}
 }
 async prepare(){this.active=false;this.checkedAt=0;this.reason='';this.attempts=this.shares.map(p=>this.inspect(p));const seen=new Set();
  const candidates=this.attempts.slice().sort((a,b)=>(b.path===this.share?1:0)-(a.path===this.share?1:0));
  for(const r of candidates){if(!r.ok)continue;if(this.pin&&(this.pin.realPath?r.realPath!==this.pin.realPath:r.path!==this.pin.share)){r.reason='MAP_HDD_OTHER_DISK';continue;}if(seen.has(r.realPath))continue;seen.add(r.realPath);
   this.share=r.path;this.root=path.join(r.realPath,'speedcam-city-maps-'+this.uid);this.device=r.device;
   try{
    try{this.probeWrite();r.access='direct';}catch(e){if(!/^(EACCES|EPERM)$/.test(e.code||''))throw e;r.directError=e.code;r.helper='requested';
     const result=await (this.o.helper||require('./map-storage-helper').prepare)(this.share);
     if(!result||result.mapStorageProtocol!==1||result.uid!==this.uid||result.root!==this.root)throw Error('MAP_HDD_HELPER_IDENTITY');
     if(!this.mounted())throw Error('MAP_HDD_CHANGED');this.probeWrite();r.access='helper';r.helper='ready';
    }
    this.active=true;if(!this.available(true))throw Error('MAP_HDD_CHANGED');
    const pin={share:this.share,realPath:r.realPath};atomicJson(path.join(this.local,'hdd-location.json'),pin);this.pin=pin;this.reason='';this.lastOperationError='';return true;
   }catch(e){r.reason=String(e.code||e.message);r.ok=false;this.reason=r.reason;this.active=false;this.checkedAt=0;}
  }
  this.reason=this.reason||(this.attempts.find(r=>r.reason&&r.reason!=='MAP_HDD_NOT_FOUND')||this.attempts[0]||{}).reason||'MAP_HDD_NOT_FOUND';return false;
 }
 diagnostic(){const active=this.available(),current=this.active&&!active?this.inspect(this.share):null;return {schema:1,capturedAt:new Date().toISOString(),active,share:this.share,root:this.root,reason:current?current.reason||'MAP_HDD_CHANGED':this.reason||null,operationError:this.lastOperationError||null,freeBytes:this.lastFreeBytes===undefined?null:this.lastFreeBytes,reserveBytes:RESERVE,selected:this.pin,attempts:this.attempts.map(r=>Object.assign({},r))};}
 async space(bytes){try{if(!this.available(true))throw Error('MAP_HDD_UNAVAILABLE');const free=await (this.o.freeBytes?this.o.freeBytes(this.root):diskFree(this.root));this.lastFreeBytes=free;if(!Number.isFinite(free))throw Error('MAP_HDD_FREE_UNKNOWN');if(free<bytes+RESERVE)throw Error('MAP_HDD_ENOSPC');if(!this.available(true))throw Error('MAP_HDD_UNAVAILABLE');}catch(e){this.lastOperationError=String(e.code||e.message);throw e;}}
 path(e){if(e._storage==='hdd'&&this.available()){const p=path.join(this.root,e.file);if(regular(p))return p;}return path.join(this.local,e.file);}
 readable(e){const p=this.path(e),s=regular(p);return !!s&&s.size===e.bytes;}
 async migrate(e,alive,progress){if(!this.available(true))throw Error('MAP_HDD_UNAVAILABLE');const source=path.join(this.local,e.file),target=path.join(this.root,e.file),temp=target+'.migrating';
  // Reuse an intact target left by a crash before the local manifest commit.
  if(regular(target)){try{await verify(target,e);if(!alive()||!this.available(true))throw Error('MAP_MIGRATION_INTERRUPTED');syncDirectory(this.root);return target;}catch(err){if(!this.available(true))throw err;}}
  await verify(source,e);await this.space(e.bytes);if(!alive())throw Error('MAP_MIGRATION_INTERRUPTED');
  try{fs.unlinkSync(temp);}catch(err){if(err.code!=='ENOENT')throw err;}
  // Copies with the same full hash have the already validated source header.
  try{await copy(source,temp,()=>alive()&&this.available(),progress);await verify(temp,e,false);if(!alive()||!this.available(true))throw Error('MAP_MIGRATION_INTERRUPTED');fs.renameSync(temp,target);syncDirectory(this.root);await verify(target,e,false);if(!alive()||!this.available(true))throw Error('MAP_MIGRATION_INTERRUPTED');return target;
  }finally{if(this.available(true)){try{fs.unlinkSync(temp);}catch(err){}}}
 }
}
module.exports={CityMapStorage,atomicJson,verify,regular,mountedShare,diskFree,RESERVE,syncDirectory};
