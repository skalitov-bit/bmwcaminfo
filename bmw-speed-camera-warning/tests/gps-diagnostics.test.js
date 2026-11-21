'use strict';
const assert=require('assert');
const {NmeaAssembler,diagnosticSentence,BmwGps}=require('../apps/aurelm_speed_camera_warning/gps');
const {GpsDiagnostics,decision}=require('../apps/aurelm_speed_camera_warning/gps-diagnostics');
const {GpsQuality}=require('../apps/aurelm_speed_camera_warning/gps-quality');
const {collect}=require('../native/bmwcaminfo-voice/audio-report');
const {ReportShare}=require('../native/bmwcaminfo-voice/report-share');
const {AudioDiagnostics}=require('../apps/aurelm_speed_camera_warning/audio-diagnostics');
const http=require('http');
const now=Date.UTC(2026,10,20,14,51,39);
function sentence(body){let sum=0;for(let i=0;i<body.length;i++)sum^=body.charCodeAt(i);return '$'+body+'*'+('0'+sum.toString(16)).slice(-2);}
const rmc=sentence('GPRMC,145139.000,A,5545.0000,N,03737.0000,E,0,90,201126,,,A');
const gga=sentence('GNGGA,145139.000,5545.0000,N,03737.0000,E,1,10,1.0,100,M,0,M,,');
const gst=sentence('GPGST,145139.000,1,1,1,0,38.5,38.5,3');
const a=new NmeaAssembler(),trace=new GpsDiagnostics(diagnosticSentence),q=new GpsQuality();
let effective=null;
function push(lines,t){const p={nmeaString:lines.join('\r\n')},f=a.push(p,t);trace.observe(p,t,a,f);if(f)effective=q.update(f,t);return f;}
function snapshot(t){return trace.snapshot(t,{eventsReceived:3},effective);}
async function run(){
 push([rmc],now);assert.equal(snapshot(now).assembly.pendingReason,'missing_valid_fresh_gga');
 push([gga],now+20);assert.equal(snapshot(now+20).assembly.selected.accuracySource,'HDOP_ESTIMATE');assert.equal(effective.accuracyM,8);
 push([gst],now+40);let report=snapshot(now+50);
 assert.equal(report.decision.reason,'accuracy_above_35m');assert(report.decision.blocked);assert.equal(Math.round(report.decision.accuracyM),109);
 assert.equal(report.lastAssembledFix.ageMs,50);assert.equal(report.receiptAgeMs,10);
 assert.equal(report.lastAssembledFix.satellites,10);assert.equal(report.lastAssembledFix.hdop,1);
 assert.equal(report.assembly.selected.accuracySource,'GST');assert.equal(report.latest.GST.fields.latitudeSigmaM,38.5);
 assert.equal(report.assembly.selected.rmc.raw,rmc);assert.equal(report.latest.GGA.raw,gga);
 assert.equal(report.latest.RMC.checksumValid,true);assert.equal(report.history.length,3);
 assert.equal(decision(effective,now+3001).reason,'fix_stale');
 assert.equal(decision(null,now).reason,'no_current_fix');
 for(const accuracyM of [7,20,35])assert(!decision(Object.assign({},effective,{accuracyM}),now).blocked);
 for(const pair of [[{timeMs:now+501},'fix_in_future'],[{accuracyM:null},'accuracy_unavailable'],[{lat:181},'invalid_coordinates']])assert.equal(decision(Object.assign({},effective,pair[0]),now).reason,pair[1]);
 push([gst.slice(0,-2)+'XX'],now+60);assert.equal(trace.latest.GST.reason,'invalid_sentence_or_checksum');assert.equal(trace.lastFix.accuracyM,effective.accuracyM);
 const stale=diagnosticSentence(rmc,now+3001);assert.equal(stale.ageAtReceiptMs,3001);assert(!stale.freshAtReceipt);
 for(let i=0;i<1000;i++)push([rmc,gga,gst],now+100);
 assert.equal(trace.history.length,12);assert.equal(snapshot(now+101).assembly.status,'duplicate');
 const byteSize=Buffer.byteLength(JSON.stringify(snapshot(now+101)));assert(byteSize<24576,byteSize);
 const oversized={nmeaString:'x'.repeat(4097)};a.push(oversized,now+102);trace.observe(oversized,now+102,a,null);assert.equal(snapshot(now+103).assembly.pendingReason,'payload_too_large');
 a.reset();assert.equal(snapshot(now+3100).lastAssembledFix.ageMs,3100,'Evidence survives assembler reset and fixes expire by measurement time');
 const bridge=new BmwGps();bridge.diagnostics=trace;assert.equal(bridge.diagnosticReport(now+3100,null).decision.reason,'fix_stale');
 report=trace.snapshot(now+100,{running:true},effective);
 const d={s:{audioBackend:'file',fileFallback:true,audioOverlay:true,inventoryError:'test-no-SDK'},alsa:{}};
 const opts={exec:(bin,args,options,cb)=>setImmediate(()=>cb(null,'{}',''))};
 const body=await collect(d,{appVersion:'local',gps:report},opts);
 assert.deepStrictEqual(body.gps,report);assert.equal(body.active.backend,'file');assert(body.active.overlay);
 assert.equal((await collect(d,{},opts)).gps.reason,'app_did_not_supply_gps_snapshot');
 assert.equal((await collect(d,{gps:{schema:99}},opts)).gps.reason,'invalid_gps_snapshot');
 assert.equal((await collect(d,{gps:Object.assign({},report,{padding:'x'.repeat(24576)})},opts)).gps.reason,'gps_snapshot_exceeds_24kib');
 const server=new ReportShare(request=>collect(d,request,opts),{simulated:true,addresses:()=>['127.0.0.1'],ttlMs:3000});
 const ui=new AudioDiagnostics(()=>{},{appVersion:'local',gpsReport:()=>report});ui.backend='file';ui.overlay=true;
 ui.request=request=>request.action==='audio-report-share-start'?server.start(request):Promise.resolve(server.status());
 try{
  await ui.shareReport();assert(ui.share,ui.shareMessage);
  const downloaded=await new Promise((resolve,reject)=>http.get(ui.share.urls[0]+'report.json',res=>{let s='';assert.equal(res.statusCode,200);res.setEncoding('utf8');res.on('data',c=>s+=c);res.on('end',()=>resolve(JSON.parse(s)));}).on('error',reject));
  assert.deepStrictEqual(downloaded.gps,report);assert.equal(downloaded.gps.decision.reason,'accuracy_above_35m');
  assert.equal(ui.backend,'file');assert(ui.overlay);
 }finally{clearTimeout(ui.sharePollTimer);clearTimeout(ui.shareExpiryTimer);await server.stop();}
 const fs=require('fs'),path=require('path');
 const main=fs.readFileSync(path.join(__dirname,'../apps/aurelm_speed_camera_warning/main.js'),'utf8');assert(main.includes('gpsReport:()=>gps.diagnosticReport(Date.now(),fix)'));
 console.log('PASS GPS diagnostics: split RMC/GGA/GST, 109 m, age, satellites/HDOP, bounded history '+byteSize+' bytes, invalid checksum/stale/size, retained evidence, absent/invalid client, unchanged audio, real HTTP JSON download. Vehicle hardware mocked.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
