'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),zlib=require('zlib'),crypto=require('crypto');
const app=path.resolve(__dirname,'../apps/aurelm_speed_camera_warning');
const {CityMapStore}=require(app+'/city-map-store'),{verify,mountedShare,RESERVE}=require(app+'/city-map-storage');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function fixture(id,revision){id=id||'moscow';revision=revision||1;const rows=[[2,'Road',0,0,0,0,[37610100,55750100,37619000,55759000]]],raw=Buffer.from(JSON.stringify(rows)),body=zlib.gzipSync(raw),meta={schema:1,id,revision,bbox:[37,55,38,56],cellMicrodegrees:10000,cells:{'3761,5575':[0,body.length,raw.length,1]}},h=Buffer.from(JSON.stringify(meta)),prefix=Buffer.alloc(12);prefix.write('SCROAD01');prefix.writeUInt32LE(h.length,8);const bytes=Buffer.concat([prefix,h,body]),sha256=hash(bytes),file=id+'-'+sha256.slice(0,16)+'.scroads';return {bytes,entry:{id,name:id,coverage:id,revision,bbox:meta.bbox,createdAt:'2026-11-25T00:00:00Z',license:'ODbL-1.0',bytes:bytes.length,sha256,file,url:'https://raw.githubusercontent.com/skalitov-bit/speedcam-db/main/maps/'+file}};}
function setup(o){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'speedcam-hdd-')),local=path.join(dir,'city-maps'),share=path.join(dir,'disk');fs.mkdirSync(local);fs.mkdirSync(share);const f=fixture();fs.writeFileSync(path.join(local,f.entry.file),f.bytes);fs.writeFileSync(path.join(local,'installed.json'),JSON.stringify({moscow:f.entry}));fs.writeFileSync(path.join(local,'catalog.json'),JSON.stringify({schema:1,cities:[f.entry]}));fs.writeFileSync(path.join(dir,'hybrid-records-v1.bin'),'unchanged camera database');const options={storage:Object.assign({share,mounted:()=>true,freeBytes:async()=>1024*1024*1024},o||{})};return {dir,local,share,f,options};}
const exists=(s,e)=>fs.existsSync(path.join(s,e.file));
const passed=[];
async function test(name,fn){await fn();passed.push(name);console.log('PASS '+name);}
(async()=>{
 await test('Only an actual writable block-device mount qualifies',async()=>{
  assert(mountedShare('22 1 8:1 / /var/opt/hdshare rw,relatime - ext4 /dev/sda1 rw','/var/opt/hdshare'));
  assert(!mountedShare('22 1 8:1 / /var/opt/hdshare ro - ext4 /dev/sda1 ro','/var/opt/hdshare'));
  assert(!mountedShare('22 1 0:5 / /var/opt/hdshare rw - tmpfs tmpfs rw','/var/opt/hdshare'));
  assert(!mountedShare('22 1 8:1 / /var/opt rw - ext4 /dev/sda1 rw','/var/opt/hdshare'));
 });
 await test('Verified migration, restart, viewport, delete; camera DB unchanged',async()=>{
  const x=setup(),s=new CityMapStore(x.dir,x.options);await s.ready;assert.equal(s.installed.moscow._storage,'hdd',s.lastError+' '+s.storage.reason);assert(!exists(x.local,x.f.entry));await verify(path.join(s.storage.root,x.f.entry.file),x.f.entry);await s.ensure({lat:55.755,lon:37.615},1000);assert.equal(s.reader.rows.length,1);s.close();
  const again=new CityMapStore(x.dir,x.options);await again.ready;assert.equal(again.state('moscow'),'УСТАНОВЛЕНА');await again.ensure({lat:55.755,lon:37.615},1000);assert(again.reader.file.startsWith(again.storage.root));assert(await again.remove('moscow'));assert(!exists(again.storage.root,x.f.entry));assert.equal(fs.readFileSync(path.join(x.dir,'hybrid-records-v1.bin'),'utf8'),'unchanged camera database');again.close();
 });
 await test('Second HDD path plus permission helper migrates real package and reopens after restart',async()=>{
  const x=setup(),missing=path.join(x.dir,'missing'),{CityMapStorage}=require(app+'/city-map-storage'),original=CityMapStorage.prototype.probeWrite;let denied=true,calls=0;
  x.options.storage={shares:[missing,x.share],mounted:p=>p===x.share,freeBytes:async()=>1e9,helper:async share=>{assert.equal(share,x.share);calls++;denied=false;return {mapStorageProtocol:1,uid:typeof process.getuid==='function'?process.getuid():0,root:path.join(x.share,'speedcam-city-maps-'+(typeof process.getuid==='function'?process.getuid():0))};}};
  CityMapStorage.prototype.probeWrite=function(){if(denied)throw Object.assign(Error('permission'),{code:'EACCES'});return original.call(this);};let s;
  try{s=new CityMapStore(x.dir,x.options);await s.ready;assert.equal(s.installed.moscow._storage,'hdd',s.storage.reason);assert.equal(calls,1);await verify(path.join(s.storage.root,x.f.entry.file),x.f.entry);assert(!exists(x.local,x.f.entry));s.close();s=new CityMapStore(x.dir,x.options);await s.ready;assert.equal(s.storage.share,x.share);assert.equal(calls,1);await s.ensure({lat:55.755,lon:37.615},1000);assert.equal(s.reader.rows.length,1);assert.equal(fs.readFileSync(path.join(x.dir,'hybrid-records-v1.bin'),'utf8'),'unchanged camera database');}
  finally{CityMapStorage.prototype.probeWrite=original;if(s)s.close();}
 });
 await test('Shared-volume helper shows consent, migrates after confirmation and does not repeat after restart',async()=>{
  const x=setup(),{CityMapStorage}=require(app+'/city-map-storage'),original=CityMapStorage.prototype.probeWrite;
  const host=require('../native/bmwcaminfo-voice/hdd-mounts');let denied=true,calls=0,s;
  x.options.requireHddNotice=true;
  x.options.storage.helper=async()=>{
   const io={realpathSync:()=>'/var/opt/hdshare',statSync:()=>({dev:3,isDirectory:()=>true}),readFileSync:()=> '28 1 8:3 / /var/opt rw - ext4 /dev/sda3 rw'};
   const checked=host.inspect('/mnt/share','/var/opt',io);assert(checked.ok,checked.reason);assert(checked.sameDevice);
   calls++;denied=false;return {mapStorageProtocol:1,uid:s.storage.uid,root:s.storage.root};
  };
  CityMapStorage.prototype.probeWrite=function(){if(denied)throw Object.assign(Error('denied'),{code:'EACCES'});return original.call(this);};
  try{
   s=new CityMapStore(x.dir,x.options);await s.ready;assert.equal(calls,1);assert.equal(s.notice.kind,'found');assert(exists(x.local,x.f.entry));assert.notEqual(s.installed.moscow._storage,'hdd');
   await s.respondToHddNotice(true);assert.equal(s.notice.kind,'success');assert.equal(s.notice.count,1);assert.equal(s.installed.moscow._storage,'hdd');await verify(path.join(s.storage.root,x.f.entry.file),x.f.entry);assert(!exists(x.local,x.f.entry));
   await s.respondToHddNotice(true);s.close();s=new CityMapStore(x.dir,x.options);await s.ready;assert.equal(s.notice,null);assert.equal(calls,1);assert.equal(fs.readFileSync(path.join(x.dir,'hybrid-records-v1.bin'),'utf8'),'unchanged camera database');
  }finally{CityMapStorage.prototype.probeWrite=original;if(s)s.close();}
 });
 await test('Absent HDD uses local maps; mounted HDD is retried later',async()=>{
  let online=false;const x=setup({mounted:()=>online}),s=new CityMapStore(x.dir,x.options);await s.ready;assert(exists(x.local,x.f.entry));assert(!fs.existsSync(s.storage.root));await s.ensure({lat:55.755,lon:37.615},1000);assert.equal(s.reader.rows.length,1);online=true;await s.prepareStorage();assert.equal(s.installed.moscow._storage,'hdd');s.close();
 });
 await test('No space, read-only directory and unknown free space preserve local source',async()=>{
  for(const opts of [{freeBytes:async()=>RESERVE},{freeBytes:async()=>{throw Error('df failed');}}]){const x=setup(opts),s=new CityMapStore(x.dir,x.options);await s.ready;assert(exists(x.local,x.f.entry));assert.notEqual(s.installed.moscow._storage,'hdd');s.close();}
  const x=setup(),s=new CityMapStore(x.dir,x.options);fs.writeFileSync(s.storage.root,'not a directory');await s.ready;assert(exists(x.local,x.f.entry));assert(!s.storage.available());s.close();
 });
 await test('Corruption of equal size rejected before source deletion',async()=>{
  const x=setup();const bytes=Buffer.from(x.f.bytes);bytes[bytes.length-1]^=1;fs.writeFileSync(path.join(x.local,x.f.entry.file),bytes);const s=new CityMapStore(x.dir,x.options);await s.ready;assert.equal(s.lastError,'MAP_HASH');assert(exists(x.local,x.f.entry));assert.notEqual(s.installed.moscow._storage,'hdd');s.close();
 });
 await test('Shutdown during copy retains source and cleans partial target',async()=>{
  const x=setup(),s=new CityMapStore(x.dir,x.options);s.on('change',()=>{if(s.progress>0&&s.progress<100)s.close();});await s.ready;assert(s.closed);assert(exists(x.local,x.f.entry));assert.notEqual(s.installed.moscow._storage,'hdd');assert(!fs.readdirSync(s.storage.root).some(n=>n.endsWith('.migrating')));
 });
 await test('Disk disappears during copy; local map stays usable',async()=>{
  let online=true;const x=setup({mounted:()=>online}),s=new CityMapStore(x.dir,x.options);s.on('change',()=>{if(s.progress>0&&s.progress<100)online=false;});await s.ready;assert(exists(x.local,x.f.entry));assert.notEqual(s.installed.moscow._storage,'hdd');await s.ensure({lat:55.755,lon:37.615},1000);assert.equal(s.reader.rows.length,1);s.close();
 });
 await test('Commit failure keeps original; next startup reuses verified orphan',async()=>{
  const x=setup(),original=fs.renameSync;fs.renameSync=function(a,b){if(b===path.join(x.local,'installed.json'))throw Error('SIMULATED_COMMIT_FAILURE');return original.apply(fs,arguments);};let s;
  try{s=new CityMapStore(x.dir,x.options);await s.ready;assert(exists(x.local,x.f.entry));assert(exists(s.storage.root,x.f.entry));assert.notEqual(s.installed.moscow._storage,'hdd');s.close();}finally{fs.renameSync=original;}
  s=new CityMapStore(x.dir,x.options);await s.ready;assert.equal(s.installed.moscow._storage,'hdd');assert(!exists(x.local,x.f.entry));s.close();
 });
 await test('Corrupt orphan is replaced from intact original',async()=>{
  const x=setup(),s=new CityMapStore(x.dir,x.options);fs.mkdirSync(s.storage.root);fs.writeFileSync(path.join(s.storage.root,x.f.entry.file),Buffer.alloc(x.f.bytes.length));await s.ready;assert.equal(s.installed.moscow._storage,'hdd');await verify(path.join(s.storage.root,x.f.entry.file),x.f.entry);s.close();
 });
 await test('Unavailable migrated HDD does not erase manifest; reconnect restores map',async()=>{
  let online=true;const x=setup({mounted:()=>online});let s=new CityMapStore(x.dir,x.options);await s.ready;s.close();online=false;s=new CityMapStore(x.dir,x.options);await s.ready;assert.equal(s.state('moscow'),'HDD НЕДОСТУПЕН');assert.equal(await s.remove('moscow'),false);await s.ensure({lat:55.755,lon:37.615},1000);assert.equal(s.reader,null);online=true;await s.prepareStorage();await s.ensure({lat:55.755,lon:37.615},1000);assert.equal(s.reader.rows.length,1);s.close();
 });
 await test('Install/update/delete work on HDD; download failure retains installed map',async()=>{
  const x=setup(),next=fixture('moscow',2);let bad=true;x.options.download=async(url,file)=>{if(!file)return Buffer.from(JSON.stringify({schema:1,cities:[next.entry]}));const bytes=Buffer.from(next.bytes);if(bad)bytes[bytes.length-1]^=1;fs.writeFileSync(file,bytes);return {bytes:bytes.length,sha256:next.entry.sha256};};const s=new CityMapStore(x.dir,x.options);await s.ready;assert.equal(await s.update('moscow'),false);assert.equal(s.installed.moscow.revision,1);assert(exists(s.storage.root,x.f.entry));bad=false;assert(await s.update('moscow'),s.lastError);assert.equal(s.installed.moscow.revision,2);assert(!exists(s.storage.root,x.f.entry));assert(exists(s.storage.root,next.entry));assert(await s.remove('moscow'));s.close();
 });
 await test('Downloads fall back locally, then migrate; no camera file relocation',async()=>{
  let online=false;const x=setup({mounted:()=>online}),next=fixture('moscow',2);x.options.download=async(url,file)=>{if(!file)return Buffer.from(JSON.stringify({schema:1,cities:[next.entry]}));fs.writeFileSync(file,next.bytes);return {bytes:next.bytes.length,sha256:next.entry.sha256};};const s=new CityMapStore(x.dir,x.options);await s.ready;assert(await s.update('moscow'));assert.equal(s.installed.moscow._storage,'local');assert(exists(x.local,next.entry));online=true;s.storageCheck=0;s.retryStorage();await s.ready;assert.equal(s.installed.moscow._storage,'hdd');assert(!exists(x.local,next.entry));assert(!fs.existsSync(path.join(s.storage.root,'hybrid-records-v1.bin')));s.close();
 });
 await test('HDD space reservation does not make existing HDD maps unreadable',async()=>{
  let free=1e9;const x=setup({freeBytes:async()=>free}),s=new CityMapStore(x.dir,x.options);await s.ready;free=0;await s.prepareStorage();await s.ensure({lat:55.755,lon:37.615},1000);assert.equal(s.reader.rows.length,1);s.close();
 });
 await test('Shutdown before deferred initialization never moves files',async()=>{
  const x=setup(),s=new CityMapStore(x.dir,x.options);s.close();await s.ready;assert(exists(x.local,x.f.entry));assert(!fs.existsSync(s.storage.root));
 });
 await test('Actual ENOSPC in copy retains source and manifest',async()=>{
  const x=setup(),s=new CityMapStore(x.dir,x.options),create=fs.createWriteStream;
  fs.createWriteStream=function(file,options){if(/\.migrating$/.test(file))throw Object.assign(Error('ENOSPC'),{code:'ENOSPC'});return create.apply(fs,arguments);};
  try{await s.ready;assert(exists(x.local,x.f.entry));assert.notEqual(s.installed.moscow._storage,'hdd');assert(/ENOSPC/.test(s.lastError));}finally{fs.createWriteStream=create;s.close();}
 });
 await test('Discovery dialog precedes copy; success persists until acknowledged, without repeats',async()=>{
  const x=setup();x.options.requireHddNotice=true;let s=new CityMapStore(x.dir,x.options);await s.ready;
  assert.equal(s.notice.kind,'found');assert(exists(x.local,x.f.entry));assert(!exists(s.storage.root,x.f.entry));assert.equal(s.limitLabel(),'ЛИМИТ КАРТ: 128 МБ');
  assert(await s.respondToHddNotice(true));assert.equal(s.notice.kind,'success');assert.equal(s.notice.count,1);assert.equal(s.limitLabel(),'ЛИМИТ КАРТ HDD: 4 ГБ');s.close();
  s=new CityMapStore(x.dir,x.options);await s.ready;assert.equal(s.notice.kind,'success');assert(await s.respondToHddNotice(true));assert.equal(s.notice,null);s.close();
  s=new CityMapStore(x.dir,x.options);await s.ready;assert.equal(s.notice,null);s.close();
 });
 await test('Later keeps local maps and suppresses repeat dialogs for this session',async()=>{
  const x=setup();x.options.requireHddNotice=true;let s=new CityMapStore(x.dir,x.options);await s.ready;assert(await s.respondToHddNotice(false));await s.prepareStorage();assert.equal(s.notice,null);assert(exists(x.local,x.f.entry));assert.equal(s.hddState.accepted,false);s.close();
  s=new CityMapStore(x.dir,x.options);await s.ready;assert.equal(s.notice.kind,'found');s.close();
 });
 await test('Corruption shows failure, never the all-maps success dialog',async()=>{
  const x=setup();x.options.requireHddNotice=true;const b=Buffer.from(x.f.bytes);b[b.length-1]^=1;fs.writeFileSync(path.join(x.local,x.f.entry.file),b);const s=new CityMapStore(x.dir,x.options);await s.ready;await s.respondToHddNotice(true);assert.equal(s.notice.kind,'failure');assert.equal(s.notice.remaining,1);assert(exists(x.local,x.f.entry));s.close();
 });
 await test('Empty installation gets a truthful HDD-ready dialog',async()=>{
  const x=setup();x.options.requireHddNotice=true;fs.writeFileSync(path.join(x.local,'installed.json'),'{}');const s=new CityMapStore(x.dir,x.options);await s.ready;assert.equal(s.notice.kind,'found');await s.respondToHddNotice(true);assert.equal(s.notice.kind,'success');assert(s.notice.empty);await s.respondToHddNotice(true);await s.prepareStorage();assert.equal(s.notice,null);s.close();
 });
 await test('HDD accepts more than 128 MiB, caps at 4 GiB; local fallback keeps its own quota',async()=>{
  let online=true;const x=setup({mounted:()=>online}),next=fixture('berlin',2);x.options.download=async(url,file)=>{fs.writeFileSync(file,next.bytes);return {bytes:next.bytes.length,sha256:next.entry.sha256};};const s=new CityMapStore(x.dir,x.options);await s.ready;
  s.catalog.cities.push(next.entry);for(let i=0;i<3;i++)s.installed['large-'+i]=Object.assign({},x.f.entry,{id:'large-'+i,bytes:64*1024*1024,_storage:'hdd'});
  assert(await s.install('berlin'),s.lastError);assert.equal(s.installed.berlin._storage,'hdd');await s.remove('berlin');
  for(let i=3;i<64;i++)s.installed['large-'+i]=Object.assign({},x.f.entry,{id:'large-'+i,bytes:64*1024*1024,_storage:'hdd'});
  assert.equal(await s.install('berlin'),false);assert.equal(s.lastError,'MAP_QUOTA');
  online=false;s.storage.available(true);assert(await s.install('berlin'),s.lastError);assert.equal(s.installed.berlin._storage,'local');await s.remove('berlin');
  s.installed['local-limit']=Object.assign({},x.f.entry,{id:'local-limit',bytes:128*1024*1024,_storage:'local'});assert.equal(await s.install('berlin'),false);assert.equal(s.lastError,'MAP_QUOTA');s.close();
 });
 console.log(JSON.stringify({ok:true,scenarios:passed.length,tests:passed}));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
