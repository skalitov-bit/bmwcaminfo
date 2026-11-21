'use strict';
const assert = require('assert');
const Module = require('module');
const {NmeaAssembler, nmeaFix, BmwGps} = require('../apps/aurelm_speed_camera_warning/gps');
const now = Date.UTC(2026,10,20,12,0,0);
let count=0;
function sentence(body) { let sum=0; for(let i=0;i<body.length;i++)sum^=body.charCodeAt(i); return '$'+body+'*'+('0'+sum.toString(16)).slice(-2); }
function rmc(t='120000.000',status='A',date='201126',talker='GP') {return sentence(talker+'RMC,'+t+','+status+',5545.0000,N,03737.0000,E,20.0,90.0,'+date+',,,A');}
function gga(t='120000.000',quality='1',lat='5545.0000') {return sentence('GNGGA,'+t+','+lat+',N,03737.0000,E,'+quality+',10,1.0,100.0,M,0.0,M,,');}
function gst(t='120000.000') {return sentence('GPGST,'+t+',1,1,1,0,2,2,3');}
const p=(...lines)=>({nmeaString:lines.join('\r\n')});
function test(name,fn){fn(); count++; console.log('PASS '+name);}
test('Complete pair unchanged',()=>{const f=nmeaFix(p(rmc(),gga()),now);assert.equal(f.accuracyM,8);assert.equal(f.timeMs,now);assert.equal(f.speedKmh,37.04);});
test('Separate events both orders and mixed GN/GP talkers',()=>{
 for(const pair of [[rmc(),gga()],[gga(),rmc()]]){const a=new NmeaAssembler();assert.equal(a.push(p(pair[0]),now),null);assert.equal(a.status,'pending');assert.equal(a.push(p(pair[1]),now+100).timeMs,now);}
});
test('All six RMC/GGA/GST delivery orders',()=>{
 const lines=[rmc(),gga(),gst()];
 for(const order of [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]]){
  const a=new NmeaAssembler();let fix;order.forEach((k,i)=>{fix=a.push(p(lines[k]),now+i*50)||fix;});
  assert(Math.abs(fix.accuracyM-Math.sqrt(32))<1e-9);assert.equal(fix.timeMs,now);
 }
});
test('Late GST refines accuracy without refreshing epoch',()=>{const a=new NmeaAssembler();a.push(p(rmc(),gga()),now);const f=a.push(p(gst()),now+2000);assert.equal(f.timeMs,now);assert(Math.abs(f.accuracyM-Math.sqrt(32))<1e-9);});
test('Unrelated GST cannot relabel old fix',()=>{const a=new NmeaAssembler();a.push(p(rmc(),gga()),now);assert.equal(a.push(p(gst('120001.000')),now+1000),null);});
test('GST tolerance 100ms',()=>{assert(Math.abs(nmeaFix(p(rmc(),gga(),gst('120000.100')),now+100).accuracyM-Math.sqrt(32))<1e-9);assert.equal(nmeaFix(p(rmc(),gga(),gst('120000.101')),now+101).accuracyM,8);});
test('RMC/GGA tolerance 500ms',()=>{assert(nmeaFix(p(rmc(),gga('120000.500')),now+500));assert.equal(nmeaFix(p(rmc(),gga('120000.501')),now+501),null);});
test('Coordinate disagreement rejected',()=>{assert.equal(nmeaFix(p(rmc(),gga('120000.000','1','5545.0600')),now),null);});
test('Several epochs in one event choose matching pair, not last GGA',()=>{assert(nmeaFix(p(rmc(),gga(),gga('120001.000')),now+1000));});
test('Closest matching GGA chosen',()=>{const f=nmeaFix(p(rmc(),gga('120000.000'),gga('120000.400','1','5545.0010')),now+400);assert.equal(f.lat,55.75);});
test('Later less precise time match cannot replace an exact pair',()=>{const a=new NmeaAssembler();a.push(p(rmc(),gga()),now);assert.equal(a.push(p(gga('120000.400','1','5545.0010')),now+400),null);});
test('Old and future RMC rejected',()=>{assert.equal(nmeaFix(p(rmc(),gga()),now+3001),null);assert.equal(nmeaFix(p(rmc(),gga()),now-501),null);});
test('No stale cached GGA paired with fresh RMC',()=>{const a=new NmeaAssembler();a.push(p(gga()),now);assert.equal(a.push(p(rmc('120000.500')),now+3100),null);});
test('No stale cached RMC paired with new GGA',()=>{const a=new NmeaAssembler();a.push(p(rmc()),now);assert.equal(a.push(p(gga('120000.500')),now+3100),null);});
test('Midnight pairing uses nearest UTC day',()=>{const t=Date.UTC(2026,10,21);const a=new NmeaAssembler();a.push(p(gga('000000.100')),t+100);assert.equal(a.push(p(rmc('235959.900','A','201126')),t+200).timeMs,t-100);});
test('RMC wrong date rejected despite matching time of day',()=>{assert.equal(nmeaFix(p(rmc('120000.000','A','191126'),gga()),now),null);});
test('Explicit no-fix epochs do not reuse valid cached data',()=>{
 const a=new NmeaAssembler();a.push(p(rmc()),now);a.push(p(rmc('120000.000','V')),now+10);assert.equal(a.push(p(gga()),now+20),null);
 const b=new NmeaAssembler();b.push(p(gga()),now);b.push(p(gga('120000.000','0')),now+10);assert.equal(b.push(p(rmc()),now+20),null);
});
test('Checksum failure cannot enter cache',()=>{const a=new NmeaAssembler();assert.equal(a.push(p(rmc().slice(0,-2)+'XX'),now),null);assert.equal(a.status,'invalid');assert.equal(a.push(p(gga()),now+50),null);});
test('Malformed/oversize payload does not emit old cached fix',()=>{const a=new NmeaAssembler();a.push(p(rmc(),gga()),now);for(const x of [null,{},p('x'.repeat(4097)),p('\u0000')])assert.equal(a.push(x,now+100),null);});
test('Repeated pair does not emit twice or become fresh again',()=>{const a=new NmeaAssembler();a.push(p(rmc(),gga()),now);assert.equal(a.push(p(rmc(),gga()),now+100),null);assert.equal(a.status,'duplicate');assert.equal(a.push(p(rmc(),gga()),now+3001),null);});
test('Older completed epoch cannot move position backward',()=>{const a=new NmeaAssembler();a.push(p(rmc('120001.000'),gga('120001.000')),now+1000);assert.equal(a.push(p(rmc(),gga()),now+1100),null);});
test('Unknown valid NMEA does not produce coordinates',()=>{const a=new NmeaAssembler();a.push(p(rmc(),gga()),now);assert.equal(a.push(p(sentence('GPVTG,90,T,,M,20,N,37,K,A')),now+50),null);assert.equal(a.status,'pending');});
test('Buffer bounded and reset clears unmatched messages',()=>{const a=new NmeaAssembler();for(let i=0;i<200;i++)a.push(p(gga('120000.'+('00'+i).slice(-3))),now+200);assert(a.parts.GGA.length<=32);a.reset();assert.equal(a.push(p(rmc()),now+200),null);});
test('Wall clock correction discards old cache',()=>{const a=new NmeaAssembler();a.push(p(gga()),now);assert.equal(a.push(p(rmc()),now-100),null);});

async function bridgeTest(){
 const originalLoad=Module._load,originalNow=Date.now;
 let time=now;const callbacks=[];
 Module._load=function(id){if(id==='oap-sdk')return {};return originalLoad.apply(this,arguments);};Date.now=()=>time;
 const gps=new BmwGps({builders:{buildAndInitTypedProxy:()=>Promise.resolve({updatePosition:{subscribe:cb=>{callbacks.push(cb);}}})}});
 const flush=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
 try{
  gps.start();await flush();const cb=callbacks[0];let emitted=0;gps.on('change',s=>{if(s.fix)emitted++;});
  cb(p(rmc()));time+=100;cb(p(gga()));assert(gps.snapshot().fix);assert.equal(gps.invalidEvents,0);assert.equal(gps.pendingEvents,1);assert.equal(emitted,1);
  cb(p(rmc(),gga()));assert.equal(emitted,1);assert.equal(gps.duplicateEvents,1);
  cb(p(gst()));assert.equal(emitted,2);assert.equal(gps.snapshot().fix.timeMs,now);
  const report=gps.diagnosticReport(time,gps.snapshot().fix);
  assert.equal(report.latest.GST.raw,gst());assert.equal(report.transport.eventsReceived,4);
  assert.equal(report.assembly.selected.accuracySource,'GST');assert.equal(report.decision.blocked,false);
  time=now+3100;cb(p(gst('120003.000')));assert.equal(gps.snapshot().fix,null);
  cb(p(rmc('120003.000')));cb(p(gga('120003.000')));assert.equal(gps.snapshot().fix.timeMs,now+3000);
  cb(p(rmc('120004.000'))); // Too far in future, must not be cached.
  gps.stop();gps.start();await flush();const cb2=callbacks[1];
  time=now+4000;cb2(p(gga('120004.000')));assert.equal(gps.snapshot().fix,null);
  cb(p(rmc('120004.000')));assert.equal(gps.snapshot().fix,null,'old callback ignored');
  cb2(p(rmc('120004.000')));assert(gps.snapshot().fix);
  time=now+5000;cb2(p(rmc('120005.000')));gps.connect(gps.generation);await flush();
  callbacks[2](p(gga('120005.000')));assert.equal(gps.snapshot().fix.timeMs,now+4000,'reconnect cleared unmatched RMC');
  callbacks[2](p(rmc('120005.000')));assert.equal(gps.snapshot().fix.timeMs,now+5000);
  count++;console.log('PASS real bridge subscription, partial counters, stale age, restart/reconnect and generation guards');
 }finally{gps.stop();Module._load=originalLoad;Date.now=originalNow;}
 console.log('GPS assembly: '+count+' tests passed');
}
bridgeTest().catch(err=>{console.error(err);process.exitCode=1;});
