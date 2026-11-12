'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm'),crypto=require('crypto'),{createRequire}=require('module');
const root=path.resolve(__dirname,'..'),app=path.join(root,'apps/aurelm_speed_camera_warning');
const {beepState,intervalFor,OverspeedBeeper}=require(path.join(app,'overspeed-beeper'));
const {Beeper}=require(path.join(root,'native/bmwcaminfo-voice/beeper'));
let now=10000;
const fix={lat:56,lon:48,timeMs:now,speedKmh:81,accuracyM:5};
const state={camera:{id:'test',limit:60,typeNamespace:'estrelka',typeCode:192},phase:'point',distanceM:300};
const check=(s=state,f=fix,monitor=true,busy=false,volume=100)=>beepState(s,f,now,monitor,busy,volume);
assert.strictEqual(check().intervalMs,1000);
for(const speed of [79,80,80.0])assert.strictEqual(check(state,{...fix,speedKmh:speed}),null);
assert(check(state,{...fix,speedKmh:80.01}),'Use unrounded speed and strict >20 threshold');
for(const s of [null,{...state,phase:'rear'},{...state,distanceM:0},{...state,distanceM:NaN},
 {...state,camera:{...state.camera,limit:null}},{...state,camera:{...state.camera,typeCode:206}},
 {...state,camera:{...state.camera,typeCode:196}},{...state,camera:{...state.camera,camera_family:'dummy'}}])assert.strictEqual(check(s),null);
assert.strictEqual(check(state,{...fix,timeMs:now-4000}),null);
assert.strictEqual(check(state,{...fix,accuracyM:50}),null);
assert.strictEqual(check(state,fix,false),null);assert.strictEqual(check(state,fix,true,true),null);
assert.strictEqual(check(state,fix,true,false,0),null);
assert.strictEqual(check(state,fix,true,false,40).volume,40);
assert.strictEqual(check({...state,useAverage:true,speedKmh:80,phase:'section'}),null);
assert(check({...state,useAverage:true,speedKmh:81,phase:'section'}));
assert.deepStrictEqual([701,700,400,399,200,199,100,99].map(intervalFor),[2000,1500,1500,1000,1000,600,600,350]);

async function run(){
 // Actual service voice queue, BMW proxies mocked, virtual clock.
 const file=path.join(root,'native/bmwcaminfo-voice/voice.js');
 const context={require:n=>n==='fs'?{existsSync:()=>true}:createRequire(file)(n),console:{log(){}},Date:class extends Date{static now(){return now;}},setTimeout:fn=>fn()};
 vm.createContext(context);const source=fs.readFileSync(file,'utf8');
 vm.runInContext(source.slice(0,source.indexOf('var voice = new VoiceService();')),context);
 const svc=new context.VoiceService();const calls=[];
 svc.waitAvailable=async()=>{};svc.connectAudio=async()=>calls.push(['connect',now]);svc.release=async()=>calls.push(['release',now]);
 svc.mp={callMethod:async(name,args)=>{calls.push([path.basename(args.path),now]);return {EntError:'OK'};}};
 let hook=()=>{},beeper;
 beeper=new Beeper(svc,{now:()=>now,exists:()=>true,sleep:async ms=>{now+=ms;hook();}});
 const owner={},req={cameraId:'test',intervalMs:2000,volume:40};
 let start=now;
 hook=()=>{if(now-start<4600){req.intervalMs=now-start<2100?2000:350;beeper.set(req,owner);}else beeper.clear(owner);};
 beeper.set(req,owner);await svc.queue;
 const beats=calls.filter(x=>x[0]==='beeper-21.m4a').map(x=>x[1]);
 assert(beats.length>=6);assert(beats[1]-beats[0]>=2000);assert(beats.slice(3).every((t,i)=>t-beats[i+2]<=370));
 assert.strictEqual(calls.filter(x=>x[0]==='connect').length,1,'Hold one route across the whole beep train');
 assert.strictEqual(calls.filter(x=>x[0]==='release').length,1);
 calls.length=0;hook=()=>{};start=now;beeper.set({...req,intervalMs:350},owner);await svc.queue;
 assert(now-start<1600,'Lease expires without heartbeats');
 assert(calls.filter(x=>x[0]==='beeper-21.m4a').length<=4);
 calls.length=0;let speech=null;
 hook=()=>{if(!speech)speech=svc.play('camera-500.m4a');};
 beeper.set(req,owner);await svc.queue;await speech;
 assert.deepStrictEqual(calls.map(x=>x[0]),['connect','beeper-21.m4a','release','connect','camera-500.m4a','release'],'Finish pulse, release route, then speech without overlap');
 assert.strictEqual(svc.speechPending,0);
 hook=()=>beeper.clear(owner);calls.length=0;beeper.set(req,owner);await svc.queue;
 assert.strictEqual(calls[1][0],'beeper-21.m4a','Beeper resumes after voice');
 assert.throws(()=>beeper.set({...req,intervalMs:1},owner),/Invalid/);
 assert.throws(()=>beeper.set({...req,volume:55},owner),/Invalid/);
 calls.length=0;hook=()=>{};svc.waitAvailable=async()=>{now+=1300;};beeper.set(req,owner);await svc.queue;
 assert.strictEqual(calls.length,0,'Expired requests do not play after delayed service availability');
 svc.waitAvailable=async()=>{};svc.mp.callMethod=async()=>({EntError:'FAILED'});calls.length=0;
 beeper.set(req,owner);await svc.queue;assert(svc.lastError.includes('rejected'));assert(calls.some(x=>x[0]==='release'));
 const count=calls.length;beeper.set(req,owner);await svc.queue;assert.strictEqual(calls.length,count,'Backoff on playback failure');
 // App transport stops the connection and rejects unsupported services without loud fallback.
 const {EventEmitter}=require('events');let sock,connects=0,requests=[];
 const transport=new OverspeedBeeper({now:()=>now,net:{createConnection(){connects++;sock=new EventEmitter();sock.setEncoding=()=>{};sock.setTimeout=()=>{};sock.write=s=>requests.push(JSON.parse(s));sock.destroy=()=>sock.emit('close');return sock;}}});
 transport.update(req);sock.emit('connect');assert.strictEqual(requests[0].action,'beeper');
 transport.update({...req,intervalMs:600});assert.strictEqual(requests[1].intervalMs,600);
 transport.update(null);assert.strictEqual(transport.socket,null);
 transport.update(req);sock.emit('connect');sock.emit('data',JSON.stringify({ok:false,error:'Unknown action or audio file'})+'\n');
 assert(transport.lastError.includes('0.1.12'));transport.update(req);assert.strictEqual(connects,2);
 const native=path.join(root,'native/bmwcaminfo-voice'),manifest=require(path.join(native,'beeper-manifest.json')),component=require(path.join(native,'component.json'));
 assert.strictEqual(Object.keys(manifest).length,10);
 for(const [relative,entry] of Object.entries(manifest)){assert(component.files.some(f=>f.path===relative));assert.strictEqual(crypto.createHash('sha256').update(fs.readFileSync(path.join(native,relative))).digest('hex'),entry.sha256);}
 console.log('PASS: strict threshold, speed camera types, GPS validity, average speed, cadence acceleration, leased playback, voice priority, recovery, service errors, volume assets. BMW audio hardware mocked.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});

