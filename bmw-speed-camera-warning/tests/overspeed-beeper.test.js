'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm'),crypto=require('crypto'),{createRequire}=require('module');
const root=path.resolve(__dirname,'..'),app=path.join(root,'apps/aurelm_speed_camera_warning');
const {beepState,intervalFor,OverspeedBeeper}=require(path.join(app,'overspeed-beeper'));
const {Beeper}=require(path.join(root,'native/bmwcaminfo-voice/beeper'));
let now=10000;
const fix={lat:56,lon:48,timeMs:now,speedKmh:81,accuracyM:5};
const state={camera:{id:'test',limit:60,typeNamespace:'estrelka',typeCode:192},phase:'point',distanceM:300};
const check=(s=state,f=fix,monitor=true,busy=false,volume=100)=>beepState(s,f,now,monitor,busy,volume);
assert.strictEqual(check().intervalMs,800);
assert.strictEqual(beepState(state,fix,now,true,false,100,false,'off'),null);
assert(beepState(state,fix,now,true,false,100,true,'off'),'Engineering always overrides beeper off');
assert(beepState(state,{...fix,speedKmh:40},now,true,false,100,true,'off'),'Engineering override also bypasses excess threshold');
assert(beepState(state,fix,now,true,false,100,false,'auto'));
assert(beepState(state,{...fix,speedKmh:40},now,true,false,100,true,'auto'),'Auto retains diagnostic always');
assert.strictEqual(require(path.join(app,'app.json')).settings.find(s=>s.key==='notification_beeper').default,'auto');
for(const speed of [79,80,80.0])assert.strictEqual(check(state,{...fix,speedKmh:speed}),null);
assert(check(state,{...fix,speedKmh:80.01}),'Use unrounded speed and strict >20 threshold');
for(const s of [null,{...state,phase:'rear'},{...state,distanceM:-1},{...state,distanceM:NaN},
 {...state,camera:{...state.camera,limit:null}},{...state,camera:{...state.camera,typeCode:206}},
 {...state,camera:{...state.camera,typeCode:196}},{...state,camera:{...state.camera,camera_family:'dummy'}}])assert.strictEqual(check(s),null);
assert.strictEqual(check(state,{...fix,timeMs:now-4000}),null);
assert.strictEqual(check(state,{...fix,accuracyM:50}),null);
assert.strictEqual(check(state,fix,false),null);assert(check(state,fix,true,true),'Voice must not disable beeper state');
assert.strictEqual(check(state,fix,true,false,0),null);
assert.strictEqual(check(state,fix,true,false,40).volume,40);
assert.strictEqual(check({...state,useAverage:true,speedKmh:80,phase:'section'}),null);
assert(check({...state,useAverage:true,speedKmh:81,phase:'section'}));
assert.deepStrictEqual([500,450,400,350,300,250,200,150,100,50,0].map(intervalFor),[1200,1100,1000,900,800,700,600,500,400,300,300]);
assert.strictEqual(check({...state,distanceM:0}).intervalMs,300,'Still active at the target; crossing ends the state');
for(let d=50;d<=5000;d+=50){
 assert.strictEqual(intervalFor(d+0.001)-intervalFor(d),100,'One step exactly at '+d+' m');
 assert.strictEqual(intervalFor(d),intervalFor(d-0.001));
}
assert.strictEqual(intervalFor(1),300);

async function run(){
 const req={cameraId:'test',intervalMs:600,volume:40};
 // App transport stops the connection and rejects unsupported services without loud fallback.
 const {EventEmitter}=require('events');let sock,connects=0,requests=[];
 const transport=new OverspeedBeeper({now:()=>now,net:{createConnection(){connects++;sock=new EventEmitter();sock.setEncoding=()=>{};sock.setTimeout=()=>{};sock.write=s=>requests.push(JSON.parse(s));sock.destroy=()=>sock.emit('close');return sock;}}});
 transport.update(req);sock.emit('connect');assert.strictEqual(requests[0].action,'beeper-v3');
 transport.update({...req,intervalMs:600});assert.strictEqual(requests[1].intervalMs,600);
 transport.update(null);assert.strictEqual(transport.socket,null);
 transport.update(req);sock.emit('connect');sock.emit('data',JSON.stringify({ok:false,error:'Unknown action or audio file'})+'\n');
 assert(transport.lastError.includes('0.1.18'));transport.update(req);assert.strictEqual(connects,2);
 console.log('PASS: strict threshold, speed camera types, GPS validity, average speed, cadence acceleration, live transport during voice, protocol compatibility. BMW audio hardware mocked.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});

