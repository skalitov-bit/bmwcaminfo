'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm'),os=require('os'),EventEmitter=require('events');
const base=path.resolve(process.argv[2]),source=fs.readFileSync(path.join(base,'kit/mgu.js'),'utf8');
const start=source.indexOf('    const launchGate = '),end=source.indexOf('    const ui = new Ui(app);',start);
assert(start>0&&end>start);const code=source.slice(start,end);
assert(source.indexOf('await impl.start(ctx)')>end,'Gate is before camera startup');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'speedcam-gate-'));
const {ManualLaunchStore,ManualLaunchGate}=require(path.join(base,'manual-launch'));const store=new ManualLaunchStore(dir);
async function run(reason){let initialized=0,active=0;const app=new EventEmitter();app.startReason=reason;app.start=()=>Promise.resolve();app.initialized=()=>{initialized++;return Promise.resolve();};
 const result=await vm.runInNewContext('(async function(){'+code+'return {started:true};})()',{
  app,DATA_DIR:dir,active:()=>{active++;},log:{info(){}},require:()=>({ManualLaunchGate:class extends ManualLaunchGate{constructor(a,d,o){super(a,d,Object.assign({},o,{env:{},send:()=>{}}));}}})
 });return {result,initialized,active};}
(async()=>{store.save(true);let r=await run('AUTOSTART');assert(r.result.pausedByUser);assert.equal(r.initialized,1);assert.equal(r.active,1);assert(store.paused());
 r=await run('ENTRY_POINT');assert(r.result.started);assert(!store.paused());r=await run('AUTOSTART');assert(r.result.started);
 console.log('PASS packaged SDK gate: dormant boot acknowledged, no application start, explicit tile rearm, next boot enabled');
})().catch(e=>{console.error(e);process.exitCode=1;}).then(()=>{fs.readdirSync(dir).forEach(f=>fs.unlinkSync(path.join(dir,f)));fs.rmdirSync(dir);});
