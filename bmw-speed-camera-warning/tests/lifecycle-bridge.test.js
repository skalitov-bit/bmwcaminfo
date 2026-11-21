'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm'),EventEmitter=require('events');
const base=path.resolve(process.argv[2]);
const source=fs.readFileSync(path.join(base,'kit/mgu.js'),'utf8');
const start=source.indexOf('    const app = new OnlineApp();'),end=source.indexOf('    // home-screen widget:',start);
assert(start>0&&end>start);let active=0,shutdowns=0,sent=[],exits=[],timers=[];
class App extends EventEmitter{registerActive(){active++;return Promise.resolve();}}
const proc=new EventEmitter();proc.env={SPEEDCAM_SUPERVISED_WORKER:'1'};proc.connected=true;proc.send=m=>sent.push(m);proc.exit=n=>exits.push(n);
const app=vm.runInNewContext('(function(){'+source.slice(start,end)+';return app;})()',{
 OnlineApp:App,process:proc,SPEC:{id:'test',version:'local'},log:{info(){},warn(){}},fs:{readFileSync(){throw Error('No missing interfaces');}},path,__dirname:base,setTimeout:(f,ms)=>{timers.push({f,ms});}
});
app.on('shutdown',()=>shutdowns++);
async function run(){
 app.emit('appStatusProxyReady');await Promise.resolve();await Promise.resolve();assert.equal(active,1,'BMW ACTIVE contract preserved');
 proc.emit('message',{speedcamLifecycle:1,event:'stop'});assert.equal(shutdowns,1);assert.equal(sent[0].event,'shutdown');
 proc.emit('message',{speedcamLifecycle:1,event:'stop'});proc.emit('SIGTERM');assert.equal(shutdowns,1,'Only one teardown');
 timers.find(t=>t.ms===200).f();assert.equal(exits[0],0);
 assert(source.includes('await impl.start(ctx)'),'Startup failures reach worker instead of silent initialization');
 assert(source.includes('!(Number(process.env.SPEEDCAM_RESTART_COUNT) > 0)'),'Recovery does not reopen a stale foreground entry');
 const pkg=require(path.join(base,'../package.json'));assert.equal(pkg.mguAppStartType,'autostart');
 assert.equal(pkg.main,'javascript/app.js');assert(fs.existsSync(path.join(base,'speedcam-main.js')));
 console.log('PASS packaged lifecycle bridge: ACTIVE, shutdown IPC, idempotent stop, startup failure, background restart, autostart metadata');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
