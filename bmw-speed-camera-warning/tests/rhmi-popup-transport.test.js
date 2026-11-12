'use strict';
// Resource/API contract test with a fake HMI, not evidence of on-car popup support.
const assert=require('assert'),path=require('path'),fs=require('fs'),os=require('os');
const app=path.resolve(process.argv[2]);
const {RhmiPopupTransport}=require(path.join(app,'background-notification'));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'speedcam-rhmi-'));
async function run(){
 let cb,opened,closed,writes=0,releases=0;
 const rb={createResourceHandles:async files=>{assert(fs.existsSync(files[0]));},getResourceHandle:f=>f,destroyResourceHandles:async()=>{releases++;}};
 const graphic={setValue:async(row,cell,file,type)=>{assert.strictEqual(row,0);assert.strictEqual(cell,'Graphic');assert.strictEqual(type,'Asset');const png=fs.readFileSync(file);assert.strictEqual(png.readUInt32BE(16),1456);assert.strictEqual(png.readUInt32BE(20),174);writes++;}};
 const rhmi={getByName:n=>n==='SPEEDCAM_POPUP'?{on:(event,fn)=>{assert.strictEqual(event,'visible');cb=fn;}}:graphic,
 getResourceBundle:()=>rb,openState:async name=>{opened=name;},closeState:async name=>{closed=name;}};
 const t=new RhmiPopupTransport({rhmi},()=>{});t.dir=dir;assert(t.available);
 const e={camera:{id:'test',limit:60,type:'Камера скорости',name:'СТРЕЛКА'},distanceM:300,type:'speeding',speedKmh:85};
 for(let i=0;i<3;i++)await t.paint(e,85);
 assert.strictEqual(writes,3);assert.strictEqual(releases,1);assert.strictEqual(fs.readdirSync(dir).filter(f=>f.endsWith('.tmp')).length,0);
 await t.open();await t.close();assert.strictEqual(opened,'SPEEDCAM_POPUP');assert.strictEqual(closed,opened);
 let visible=false;t.onVisible=on=>{visible=on;};cb({visible:true});assert(visible);
 assert(!new RhmiPopupTransport({},()=>{}).available);
 assert(!new RhmiPopupTransport({rhmi:{getByName:()=>{throw new Error('No such component');}}},()=>{}).available,'Missing popup must not crash the app');
 console.log('RHMI popup image/resource contract passed with fake HMI; native popup layout/openState compatibility is NOT hardware-verified.');
}
run().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>fs.rmSync(dir,{recursive:true,force:true}));
