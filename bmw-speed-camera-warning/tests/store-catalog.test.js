'use strict';
// Real Store dependency planner; official component manifests are read-only fixtures.
// argv: upstream native/mgu-updater folder, local build folder.
const assert=require('assert'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const {URL}=require('url');
const upstream=path.resolve(process.argv[2]), release=path.resolve(process.argv[3]);
const lib=require(path.join(upstream,'js/catalog'));
const Updater=require(path.join(upstream,'js/updater')).Updater;
const app='aurelm_speed_camera_warning',voice='bmwcaminfo-voice',renderer='idrive7-renderd',gate='mgu-inputgate';
const text=fs.readFileSync(path.join(release,'store/catalog.json'),'utf8');
const entries=lib.parse(text).components;
// Mirror source-tree enrichment (drop-ins need deploy >=0.3.2; manifest overrides),
// then use Store's real catalog normalization. Gate's needs comes from mgu-repo.json.
const external=require('./fixtures/idrive7-components.json').components.map(e=>lib.checkExtras(Object.assign({},e,{
 requires:Object.assign({},e.dropins?{'mgu-deploy':'0.3.2'}:{},e.requires||{}),
 mguNeeds:e.id===gate?['renderer']:undefined
})));
const all=entries.concat(external);
const checks=[];
function check(name,fn){fn();checks.push(name);}
function planner(have,list=all,providers=[]){
 const u=Object.create(Updater.prototype);
 const rows=new Map(list.map(entry=>[entry.id,{entry,source:entries.some(e=>e.id===entry.id)?'speedcam':'idrive7'}]));
 u.installedOf=id=>have[id]?{id,version:have[id]}:null;
 u.resolved=()=>rows;
 u.src=new Map([['speedcam',{}],['idrive7',{}],['builtin',{}]]);
 u.defs=()=>[{id:'speedcam'},{id:'idrive7'},{id:'builtin'}];
 u.providerIds=cap=>cap==='renderer'?providers:[];
 u.incompatible=entry=>lib.compat(entry.mguHmi,'ID7')==='no'?'wrong HMI':null;
 return {u,rows,plan:()=>u.installPlan(rows.get(app),[]).map(s=>s.id)};
}
const deploy={'mgu-deploy':'0.8.16'};
const graphics=Object.assign({},deploy,{[renderer]:'2.1.18',[gate]:'1.1.0'});
const ready=Object.assign({},graphics,{[voice]:'0.1.50'});
check('catalog has only our app and voice; exact external requirements',()=>{
 assert.deepStrictEqual(entries.map(e=>e.id),[app,voice]);
 assert.deepStrictEqual(entries.find(e=>e.id===app).requires,{[renderer]:'2.1.18',[gate]:'1.1.0',[voice]:'0.1.50'});
 assert.equal(entries.find(e=>e.id===voice).kind,'tool');
});
check('fresh install resolves both sources before SpeedCAM',()=>{
 const p=planner(deploy);assert.deepStrictEqual(p.plan(),[renderer,gate,voice,app]);
 assert.equal(p.rows.get(renderer).source,'idrive7');assert.equal(p.rows.get(gate).source,'idrive7');
});
check('matching graphics and voice reused',()=>assert.deepStrictEqual(planner(ready).plan(),[app]));
check('newer graphics/voice not downgraded',()=>{
 assert.deepStrictEqual(planner(Object.assign({},ready,{[renderer]:'2.2.0',[gate]:'1.2.0',[voice]:'0.1.51'})).plan(),[app]);
});
check('old renderer upgraded',()=>{
 assert.deepStrictEqual(planner(Object.assign({},ready,{[renderer]:'1.9.0'})).plan(),[renderer,app]);
});
check('old controller gate upgraded',()=>{
 assert.deepStrictEqual(planner(Object.assign({},ready,{[gate]:'1.0.0'})).plan(),[gate,app]);
});
check('old voice upgraded without touching graphics',()=>{
 assert.deepStrictEqual(planner(Object.assign({},ready,{[voice]:'0.1.48',[app]:'0.9.90'})).plan(),[voice,app]);
});
check('already installed requirements work even without external source rows',()=>{
 assert.deepStrictEqual(planner(ready,entries).plan(),[app]);
});
check('missing upstream source fails clearly',()=>{
 assert.throws(()=>planner(deploy,entries).plan(),/needs idrive7-renderd .*no source has/);
});
check('older installed engine with missing upstream source fails clearly',()=>{
 assert.throws(()=>planner(Object.assign({},ready,{[renderer]:'2.0.0'}),entries).plan(),/needs idrive7-renderd .*no source has/);
});
check('old Store renderer is not a substitute for idrive7 or a new dependency',()=>{
 const p=planner(Object.assign({},deploy,{'mgu-render':'0.6.21'}),all,['mgu-render']);
 assert.deepStrictEqual(p.plan(),[renderer,gate,voice,app]);
 assert.equal(p.u.requirementMet(renderer,'2.1.18'),false);
});
check('missing gate fails explicitly',()=>assert.throws(()=>planner(deploy,all.filter(e=>e.id!==gate)).plan(),/needs mgu-inputgate .*no source has/));
check('missing voice fails explicitly',()=>assert.throws(()=>planner(graphics,all.filter(e=>e.id!==voice)).plan(),/needs bmwcaminfo-voice .*no source has/));
check('voice install failure still blocks application',()=>assert.equal(planner(graphics).u.requirementMet(voice,'0.1.50'),false));
check('insufficient deploy rejected',()=>assert.throws(()=>planner({'mgu-deploy':'0.6.0'}).plan(),/mgu-deploy/));
check('own packages remain ID7',()=>entries.forEach(e=>assert.equal(lib.compat(e.mguHmi,'ID8'),'no')));
check('our artifact sizes, hashes and URLs match packages',()=>{
 entries.forEach(e=>{
  const bytes=fs.readFileSync(path.join(release,e.artifact.name));
  assert.equal(bytes.length,e.artifact.size);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),e.artifact.sha256);
  const url=new URL(e.artifact.url);assert.equal(url.hostname,'github.com');
  const tag=app+'@'+entries.find(r=>r.id===app).version;
  assert.equal(decodeURIComponent(url.pathname),'/skalitov-bit/bmwcaminfo/releases/download/'+tag+'/'+e.artifact.name);
 });
});
check('USB copy has only our packages and keeps GitHub origin',()=>{
 const dir=path.join(release,'store/usb/mgu-repo/speedcam');
 const local=lib.parse(fs.readFileSync(path.join(dir,'catalog.json'),'utf8')).components;
 assert.deepStrictEqual(local.map(e=>e.id),[app,voice]);
 assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'mgu-copy.json'),'utf8')).copyOf,'github:skalitov-bit/bmwcaminfo');
 assert.deepStrictEqual(fs.readdirSync(dir).filter(n=>n.endsWith('.tgz')).sort(),entries.map(e=>e.artifact.name).sort());
 local.forEach(e=>{
  const online=entries.find(r=>r.id===e.id);assert.deepStrictEqual(e.requires,online.requires);
  assert.equal(e.artifact.url,e.artifact.name);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,e.artifact.name))).digest('hex'),online.artifact.sha256);
 });
 assert(fs.readFileSync(path.join(dir,'INSTALL_RU.txt'),'utf8').includes('cauliflowermossgrape/idrive7-apps'));
});
check('bounded PNG store icon matches hash',()=>{
 const raw=JSON.parse(text).components.find(e=>e.id===app);
 const bytes=fs.readFileSync(path.join(release,'store',raw.icon));
 assert(bytes.length<=128*1024);assert.equal(bytes.slice(0,8).toString('hex'),'89504e470d0a1a0a');
 assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),raw.iconSha256);
});
console.log(JSON.stringify({upstreamCommit:'407f13e2091a028f7855568c51ba36f10dfab40d',realMguTest:false,passed:checks.length,checks},null,2));
