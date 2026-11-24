'use strict';
const assert=require('assert'),http=require('http'),fs=require('fs'),path=require('path');
const {ReportShare}=require('../native/bmwcaminfo-voice/report-share');
const {AudioDiagnostics}=require('../apps/aurelm_speed_camera_warning/audio-diagnostics');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const get=(url,method)=>new Promise((resolve,reject)=>{
 const req=http.request(Object.assign(require('url').parse(url),{method:method||'GET'}),res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({code:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString()}));});req.on('error',reject);req.end();
});
async function rejects(p){let failed=false;try{await p;}catch(e){failed=true;}assert(failed);}
async function run(){
 const report={format:'SpeedCAM-audio-diagnostics',createdAt:'test',readOnly:true,active:{backend:'file',overlay:true}},o={simulated:true,addresses:()=>['127.0.0.1'],ttlMs:3000};
 const server=new ReportShare(async()=>report,o);
 try{
  const a=await server.start({}),url=a.urls[0];assert(a.active);assert(/\/r\/[a-f0-9]{32}\/$/.test(url));
  let r=await get(url);assert.equal(r.code,200);assert(r.body.includes('Скачать отчёт'));assert.equal(r.headers['cache-control'],'no-store');assert(r.headers['content-security-policy'].includes("default-src 'none'"));
  r=await get(url+'report.json');assert.equal(r.code,200);assert.deepStrictEqual(JSON.parse(r.body),report);assert.equal(Number(r.headers['content-length']),Buffer.byteLength(r.body));assert(r.headers['content-disposition'].includes('attachment;'));assert.equal(server.status().downloads,1);
  r=await get(url+'report.json','HEAD');assert.equal(r.code,200);assert.equal(r.body,'');assert.equal(server.status().downloads,1);
  for(const tail of ['../report.json','../../etc/passwd','report.json?x=1','%2e%2e/voice.js'])assert.equal((await get(url+tail)).code,404);
  assert.equal((await get(url.replace(/\/r\/.*$/,'/r/wrong/'))).code,404);
  assert.equal((await get(url,'POST')).code,405);
  const b=await server.start({language:'en'});assert.notEqual(url,b.urls[0]);await rejects(get(url));
  r=await get(b.urls[0]);assert(r.body.includes('lang="en"'));assert(r.body.includes('Download JSON report'));assert(!/[А-Яа-яЁё]/.test(r.body),'English phone report has no untranslated Russian UI');
  await server.stop();assert(!server.status().active);await rejects(get(b.urls[0]));
  server.o.ttlMs=70;const c=await server.start({});await wait(140);assert(!server.status().active);await rejects(get(c.urls[0]));
  server.collect=async()=>{await wait(50);return report;};const pending=server.start({});await rejects(server.start({}));server.stop();await rejects(pending);assert(!server.status().active);
  server.collect=async()=>({large:'a'.repeat(262144)});await rejects(server.start({}));assert(!server.status().active);
  server.o.addresses=()=>[];await rejects(server.start({}));
  server.o=o;server.o.addresses=()=>['127.0.0.1'];server.o.ttlMs=3000;server.collect=async()=>report;
  const ui=new AudioDiagnostics(()=>{},{appVersion:'preview'});ui.backend='file';ui.overlay=true;
  ui.request=r=>r.action==='audio-report-share-start'?server.start(r):r.action==='audio-report-share-status'?Promise.resolve(server.status()):server.stop();
  await ui.shareReport();assert.equal(ui.screen,'share');assert(ui.shareQr);assert(ui.overlay&&ui.backend==='file');
  const keys=[],labels=[],cv={fillRect(){},strokeRoundRect(){},text(){},line(){}};
  const style={colors:{},heading(){},text(c,t){labels.push(t);}};
  ui.draw(cv,style,(c,x,y,w,h,run,key)=>keys.push(key));assert(keys.includes('share-toggle')&&keys.includes('share-back'));assert(!keys.includes('share-address'));
  const count=ui.shareQr.getModuleCount(),matrix=[];for(let y=0;y<count;y++){matrix[y]=[];for(let x=0;x<count;x++)matrix[y].push(ui.shareQr.isDark(y,x)?1:0);}
  if(process.env.SPEEDCAM_QR_EVIDENCE)fs.writeFileSync(process.env.SPEEDCAM_QR_EVIDENCE,JSON.stringify({url:ui.share.urls[0],matrix}));
  await ui.stopShare();assert(!ui.share);assert(!server.status().active);assert(ui.overlay&&ui.backend==='file');
  ui.request=async()=>{throw Error('Unknown action');};await ui.shareReport();assert(ui.shareMessage.includes('Обновите звуковой компонент'));assert(!ui.shareQr);
  const moving=new AudioDiagnostics(()=>{},{moving:()=>true});moving.request=()=>{throw Error('Must not run');};await moving.shareReport();assert(!moving.share);
  console.log('PASS: HTTP download/HEAD, byte length, token, routes, no writes, stop, expiry, rotation, concurrent/cancelled collection, size/no-network failures, QR, joystick actions, old service, unchanged audio mode');
 }finally{await server.stop();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
