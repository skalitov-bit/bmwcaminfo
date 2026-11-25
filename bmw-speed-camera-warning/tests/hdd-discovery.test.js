'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os');
const a=path.resolve(__dirname,'../apps/aurelm_speed_camera_warning'),n=path.resolve(__dirname,'../native/bmwcaminfo-voice');
const mounts=require(a+'/hdd-mounts'),{CityMapStorage}=require(a+'/city-map-storage'),helper=require(n+'/map-storage-helper');
const passed=[];async function test(name,fn){await fn();passed.push(name);console.log('PASS '+name);}
function environment(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hdd-discovery-')),local=path.join(dir,'local'),one=path.join(dir,'first'),two=path.join(dir,'second');[local,one,two].forEach(p=>fs.mkdirSync(p));return {dir,local,one,two};}
(async()=>{
 await test('Both MGU mount paths, same-volume shares, read-only/tmpfs rejection',()=>{
  let mount='28 1 8:3 / /mnt/share rw,relatime - ext4 /dev/sda3 rw',same=false;
  const io={realpathSync:p=>p==='/var/opt/hdshare'?'/mnt/share':p,statSync:p=>({dev:p==='/app'&&!same?1:3,isDirectory:()=>true}),readFileSync:()=>mount};
  for(const p of mounts.SHARES)assert(mounts.inspect(p,'/app',io).ok);
  same=true;assert(mounts.inspect('/mnt/share','/app',io).ok);assert(mounts.inspect('/mnt/share','/app',io).sameDevice);same=false;
  mount=mount.replace('rw,relatime','ro');assert.equal(mounts.inspect('/mnt/share','/app',io).reason,'MAP_HDD_READ_ONLY');
  mount='28 1 0:5 / /mnt/share rw - tmpfs tmpfs rw';assert.equal(mounts.inspect('/mnt/share','/app',io).reason,'MAP_HDD_NOT_MOUNTED');
  mount='28 1 8:3 / /mnt/share rw - ext4 /dev/sda3 ro';assert.equal(mounts.inspect('/mnt/share','/app',io).reason,'MAP_HDD_READ_ONLY');
  assert.equal(mounts.mountFor('28 1 8:3 / /mnt/share rw - ext4 /dev/sda3 rw','/mnt/shared'),null);
 });
 await test('Host helper accepts hdshare on /var/opt volume; unexpected aliases and root stay rejected',()=>{
  let real='/var/opt/hdshare',mount='28 1 8:3 / /var/opt rw,relatime - ext4 /dev/sda3 rw';
  const io={realpathSync:()=>real,statSync:()=>({dev:3,isDirectory:()=>true}),readFileSync:()=>mount};
  const host=require(n+'/hdd-mounts');
  for(const p of mounts.SHARES){const r=host.inspect(p,'/var/opt',io);assert(r.ok,r.reason);assert(r.sameDevice);assert.equal(r.mount.point,'/var/opt');assert.equal(r.realPath,'/var/opt/hdshare');}
  real='/var/opt/unrelated';assert.equal(host.inspect('/mnt/share','/var/opt',io).reason,'MAP_HDD_SAME_DEVICE');
  real='/var/opt/hdshare';mount='28 1 8:3 / / rw - ext4 /dev/sda3 rw';assert.equal(host.inspect('/mnt/share','/var/opt',io).reason,'MAP_HDD_NOT_MOUNTED');
 });
 await test('Aliases report the same helper refusal instead of an apparently usable second disk',async()=>{
  const e=environment();let calls=0;
  const s=new CityMapStorage(e.local,{shares:[e.one,e.two],inspect:p=>({path:p,ok:true,realPath:e.one,device:fs.statSync(e.one).dev}),helper:async()=>{calls++;throw Error('MAP_HDD_SAME_DEVICE');}});
  s.probeWrite=()=>{throw Object.assign(Error('denied'),{code:'EACCES'});};
  assert.equal(await s.prepare(),false);assert.equal(calls,1);
  const attempts=s.diagnostic().attempts;assert.equal(attempts[1].aliasOf,e.one);
  for(const r of attempts){assert.equal(r.reason,'MAP_HDD_SAME_DEVICE');assert.equal(r.ok,false);assert.equal(r.helper,'failed');}
 });
 await test('Second path succeeds; saved selection survives restart and never switches to another disk',async()=>{
  const e=environment();let first=false,second=true;const o={shares:[e.one,e.two],mounted:p=>p===e.one?first:second};let s=new CityMapStorage(e.local,o);
  assert(await s.prepare());assert.equal(s.share,e.two);assert.equal(s.diagnostic().attempts[0].reason,'MAP_HDD_NOT_MOUNTED');
  first=true;s=new CityMapStorage(e.local,o);assert(await s.prepare());assert.equal(s.share,e.two);
  second=false;assert.equal(await s.prepare(),false);assert(!s.available());assert(!fs.existsSync(path.join(e.one,path.basename(s.root))));
 });
 await test('Permission failure invokes helper once, rechecks actual write; other failures do not invoke helper',async()=>{
  const e=environment();let denied=true,calls=0;const s=new CityMapStorage(e.local,{share:e.one,mounted:()=>true,helper:async share=>{assert.equal(share,e.one);calls++;denied=false;return {mapStorageProtocol:1,uid:s.uid,root:s.root};}}),probe=s.probeWrite;
  s.probeWrite=function(){if(denied)throw Object.assign(Error('denied'),{code:'EACCES'});return probe.call(this);};
  assert(await s.prepare());assert.equal(calls,1);assert.equal(s.diagnostic().attempts[0].access,'helper');
  s.probeWrite=()=>{throw Object.assign(Error('read-only'),{code:'EROFS'});};assert.equal(await s.prepare(),false);assert.equal(calls,1);assert.equal(s.reason,'EROFS');
 });
 await test('Unavailable/old helper and access still denied remain explicit failures',async()=>{
  for(const reason of ['MAP_HDD_HELPER_UPDATE','MAP_HDD_HELPER_UNAVAILABLE','MAP_HDD_HELPER_TIMEOUT']){
   const e=environment(),s=new CityMapStorage(e.local,{share:e.one,mounted:()=>true,helper:async()=>{throw Error(reason);}});s.probeWrite=()=>{throw Object.assign(Error('denied'),{code:'EPERM'});};assert.equal(await s.prepare(),false);assert.equal(s.reason,reason);assert(!s.active);
  }
  const e=environment(),s=new CityMapStorage(e.local,{share:e.one,mounted:()=>true,helper:async()=>({mapStorageProtocol:1,uid:s.uid,root:s.root})});s.probeWrite=()=>{throw Object.assign(Error('denied'),{code:'EACCES'});};assert.equal(await s.prepare(),false);assert.equal(s.reason,'EACCES');
 });
 await test('Helper has no arbitrary path or owner API; app identity must be unique',()=>{
  for(const request of [{action:'map-storage-prepare',share:2},{action:'map-storage-prepare',share:0,uid:0},{action:'map-storage-prepare',share:'/tmp'},{action:'map-storage-prepare',share:0,path:'/etc'}])assert.throws(()=>helper.prepare(request),/MAP_HDD_HELPER_REQUEST/);
  const root='/var/opt/public/oap';let users=[12345];const io={readdirSync:()=>users.map(u=>'oap_'+u),readFileSync:p=>{p=p.replace(/\\/g,'/');return JSON.stringify(p.indexOf('/source/')>=0?{name:'aurelm_speed_camera_warning'}:{userId:Number(p.slice(root.length+5).split('/')[0])});}};
  assert.equal(helper.appUid(io),12345);users=[12345,12346];assert.throws(()=>helper.appUid(io),/IDENTITY/);users=[];assert.throws(()=>helper.appUid(io),/IDENTITY/);
 });
 await test('Privileged helper pins descriptors, rejects links/other owners, only changes own directory',()=>{
  for(const scenario of ['ok','symlink','other-owner','root-nonempty','changed']){
   const ops=[];let probes=0;const io={constants:{O_RDONLY:0,O_DIRECTORY:65536,O_NOFOLLOW:131072},
    openSync:(p,flags)=>{ops.push(['open',p,flags]);if(p==='/mnt/share')return 10;if(scenario==='symlink')throw Error('ELOOP');return 11;},
    fstatSync:fd=>({dev:3,uid:fd===10?0:scenario==='other-owner'?12346:0,isDirectory:()=>true}),mkdirSync:p=>{ops.push(['mkdir',p]);if(scenario==='root-nonempty')throw Object.assign(Error('exists'),{code:'EEXIST'});},
    readdirSync:()=>['existing.scroads'],fchownSync:(...v)=>ops.push(['chown'].concat(v)),fchmodSync:(...v)=>ops.push(['chmod'].concat(v)),fsyncSync:()=>{},closeSync:fd=>ops.push(['close',fd])};
   const probe=()=>({ok:true,realPath:'/mnt/share',device:scenario==='changed'&&++probes>1?4:3});
   if(scenario==='ok'){const r=helper.provision('/mnt/share',12345,io,probe);assert.equal(r.root,'/mnt/share/speedcam-city-maps-12345');assert.deepEqual(ops.filter(o=>o[0]==='chown'),[['chown',11,12345,12345]]);assert.deepEqual(ops.filter(o=>o[0]==='chmod'),[['chmod',11,448]]);}
   else assert.throws(()=>helper.provision('/mnt/share',12345,io,probe));
   assert(ops.some(o=>o[0]==='close'&&o[1]===10));assert(!ops.some(o=>(o[0]==='chmod'||o[0]==='chown')&&o[1]===10));
  }
 });
 await test('Service package contains both helper modules with matching mount validation',()=>{
  const c=JSON.parse(fs.readFileSync(n+'/component.json'));for(const f of ['map-storage-helper.js','hdd-mounts.js'])assert(c.files.some(x=>x.path===f));assert.equal(fs.readFileSync(a+'/hdd-mounts.js','utf8'),fs.readFileSync(n+'/hdd-mounts.js','utf8'));
 });
 console.log(JSON.stringify({ok:true,scenarios:passed.length,tests:passed,physicalMgu:false}));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
