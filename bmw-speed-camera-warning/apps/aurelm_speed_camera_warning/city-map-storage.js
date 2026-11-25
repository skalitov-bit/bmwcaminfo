'use strict';
// Road packages only. Camera databases and application settings stay in dataDir.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),child=require('child_process');
const {CityRoads}=require('./city-roads');
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
 constructor(local,options){this.local=local;this.o=options||{};this.share=this.o.share||SHARE;this.root=path.join(this.share,'speedcam-city-maps-'+(typeof process.getuid==='function'?process.getuid():0));this.device=null;this.reason='';this.active=false;}
 mounted(){try{
  if(this.o.mounted)return !!this.o.mounted();
  if(process.platform!=='linux'||fs.realpathSync(this.share)!==this.share||!mountedShare(fs.readFileSync('/proc/self/mountinfo','utf8'),this.share))return false;
  return fs.statSync(this.share).dev!==fs.statSync(this.local).dev;
 }catch(e){return false;}}
 available(force){const now=Date.now();if(!force&&this.checkedAt&&now-this.checkedAt<1000)return this.cachedAvailable;
  this.checkedAt=now;try{this.cachedAvailable=this.active&&this.mounted()&&fs.realpathSync(this.root)===this.root&&fs.statSync(this.root).dev===this.device;}catch(e){this.cachedAvailable=false;}return this.cachedAvailable;}
 async prepare(){this.active=false;this.checkedAt=0;try{
  if(!this.mounted())throw Error('MAP_HDD_NOT_MOUNTED');
  try{fs.mkdirSync(this.root,0o700);syncDirectory(this.share);}catch(e){if(e.code!=='EEXIST')throw e;}
  if(fs.realpathSync(this.root)!==this.root||fs.statSync(this.root).dev!==fs.statSync(this.share).dev)throw Error('MAP_HDD_PATH');
  const probe=path.join(this.root,'.write-'+process.pid+'-'+crypto.randomBytes(6).toString('hex')),fd=fs.openSync(probe,'wx',0o600);try{fs.writeSync(fd,'ok');fs.fsyncSync(fd);}finally{fs.closeSync(fd);fs.unlinkSync(probe);}
  this.device=fs.statSync(this.root).dev;this.active=true;this.reason='';return this.available(true);
 }catch(e){this.reason=String(e.code||e.message);this.active=false;this.checkedAt=0;return false;}}
 async space(bytes){if(!this.available(true))throw Error('MAP_HDD_UNAVAILABLE');const free=await (this.o.freeBytes?this.o.freeBytes(this.root):diskFree(this.root));if(!Number.isFinite(free)||free<bytes+RESERVE)throw Error('MAP_HDD_ENOSPC');if(!this.available(true))throw Error('MAP_HDD_UNAVAILABLE');}
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
