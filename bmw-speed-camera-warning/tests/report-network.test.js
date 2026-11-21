'use strict';
const assert=require('assert'),http=require('http'),fs=require('fs'),path=require('path');
const {ReportNetwork,addresses,PORT,TAG}=require('../native/bmwcaminfo-voice/report-network');
const {ReportShare}=require('../native/bmwcaminfo-voice/report-share');
const {AudioDiagnostics}=require('../apps/aurelm_speed_camera_warning/audio-diagnostics');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function failure(p,re){try{await p;}catch(e){if(re)assert(re.test(e.message),e.message);return;}throw Error('Expected failure');}
function fakeNft(){
 const state={rules:['iifname "wlan_bridge" tcp dport 8470 accept comment "mgu-updater-web" # handle 7'],calls:[],next:8,fail:false};
 state.run=async args=>{
  state.calls.push(args.slice());if(state.fail)throw Error('nft: permission denied');
  if(args[0]==='-a')return state.rules.join('\n');
  if(args[0]==='delete'){assert(!args.includes('7'),'must not remove Store rule');state.rules=state.rules.filter(l=>!l.endsWith('# handle '+args[args.length-1]));return '';}
  assert.equal(args[0],'insert');assert.deepStrictEqual(args.slice(1,5),['rule','ip','filter','input']);
  state.rules.push(args.slice(5).join(' ')+' # handle '+state.next++);return '';
 };return state;
}
const fetch=url=>new Promise((resolve,reject)=>{http.get(url,r=>{let body='';r.on('data',b=>{body+=b;});r.on('end',()=>resolve({code:r.statusCode,body}));}).on('error',reject);});
async function run(){
 assert.deepStrictEqual(addresses({eth0:[{family:'IPv4',address:'192.168.1.1'}],wlan0:[{family:'IPv4',address:'10.0.0.1'}],wlan_bridge:[{family:'IPv6',address:'::1'},{family:'IPv4',address:'172.16.222.97'},{family:4,address:'172.16.222.97'}]}),['172.16.222.97']);
 assert.deepStrictEqual(addresses({eth0:[{family:'IPv4',address:'192.168.1.1'}]}),[]);
 assert.equal(PORT,8471);
 const nft=fakeNft(),network=new ReportNetwork({run:nft.run});
 nft.rules.push('tcp dport 10000 accept comment "'+TAG+'" # handle 99');
 await network.close();assert.equal(nft.rules.length,1);
 await network.ensure('172.16.222.97',PORT);const inserts=nft.calls.filter(a=>a[0]==='insert').length;
 await network.ensure('172.16.222.97',PORT);assert.equal(nft.calls.filter(a=>a[0]==='insert').length,inserts);
 assert(nft.rules[1].includes('iifname "wlan_bridge" ip daddr 172.16.222.97 tcp dport 8471 accept'));
 nft.rules=nft.rules.slice(0,1);await network.ensure('172.16.222.97',PORT);assert.equal(nft.rules.length,2);
 await network.close();assert.equal(nft.rules.length,1);
 await failure(network.ensure('1.2.3.4; anything',8471),/адрес/);
 let ips=['127.0.0.1'];const report={format:'SpeedCAM-audio-diagnostics',readOnly:true};
 const share=new ReportShare(async()=>report,{network,port:0,addresses:()=>ips,ttlMs:10000,pollMs:20,ruleMs:30});
 try{
  await share.initialize();let s=await share.start({});assert.equal(s.firewall,'ready');assert.equal(s.interface,'wlan_bridge');assert.equal(s.urls.length,1);
  assert.equal((await fetch(s.urls[0])).code,200);
  assert.deepStrictEqual(JSON.parse((await fetch(s.urls[0]+'report.json')).body),report);
  assert.equal(share.status().downloads,1);
  nft.rules=nft.rules.slice(0,1);await wait(80);assert.equal(nft.rules.length,2,'rule restored after firewall reload');
  ips=[];await wait(60);assert(!share.status().active);assert(/изменился|исчез/.test(share.status().error));assert.equal(nft.rules.length,1);
  await failure(fetch(s.urls[0]));
  await failure(share.start({}),/wlan_bridge/);assert(!share.status().active);
  ips=['127.0.0.1'];share.o.ttlMs=60;s=await share.start({});await wait(120);assert(!share.status().active);assert.equal(nft.rules.length,1);
  share.o.ttlMs=10000;const originalEnsure=network.ensure.bind(network);
  network.ensure=async()=>{throw Error('nft: failed to allow port');};await failure(share.start({}),/failed to allow/);assert(!share.status().active);assert.equal(nft.rules.length,1);network.ensure=originalEnsure;
  s=await share.start({});nft.fail=true;await wait(80);assert(!share.status().active);assert(/permission denied/.test(share.status().error));nft.fail=false;await share.stop();assert.equal(nft.rules.length,1);
  // Cancellation while an asynchronous firewall operation is completing leaves no listener/rule.
  let entered,release;const enteredP=new Promise(r=>{entered=r;});const gate=new Promise(r=>{release=r;});
  network.ensure=async(ip,port)=>{entered();await gate;return originalEnsure(ip,port);};
  const pending=share.start({});const pendingCheck=failure(pending,/отменена/);await enteredP;
  const stopping=share.stop();release();await Promise.all([stopping,pendingCheck]);assert(!share.status().active);assert.equal(nft.rules.length,1);network.ensure=originalEnsure;
  // Port conflicts must not disturb the other server or leave an allow rule.
  const occupied=http.createServer((q,r)=>r.end('other'));
  await new Promise(r=>occupied.listen(0,'127.0.0.1',r));share.o.port=occupied.address().port;
  try{await failure(share.start({}),/занят/);assert.equal((await fetch('http://127.0.0.1:'+occupied.address().port)).body,'other');assert.equal(nft.rules.length,1);}finally{await new Promise(r=>occupied.close(r));share.o.port=0;}
  // UI must retire a QR code when the backend reports network failure.
  const ui=new AudioDiagnostics(()=>{},{});ui.request=async r=>r.action==='audio-report-share-start'?share.start(r):r.action==='audio-report-share-stop'?share.stop():share.status();
  await ui.shareReport();assert(ui.shareQr);ips=[];await wait(3200);assert(!ui.shareQr);assert(!ui.share);assert(/изменился|исчез/.test(ui.shareMessage));ui.stop();
 }finally{nft.fail=false;await share.stop();}
 const root=path.resolve(__dirname,'../native/bmwcaminfo-voice'),manifest=JSON.parse(fs.readFileSync(root+'/component.json','utf8'));
 assert(manifest.files.some(f=>f.path==='report-network.js'));
 assert(fs.readFileSync(root+'/systemd/bmwcaminfo-voice.service','utf8').includes('ExecStopPost=/usr/bin/node /var/opt/bmwcaminfo-voice/current/report-network.js cleanup'));
 console.log('PASS: hotspot-only address, scoped nft rule, Store isolation, stale cleanup, recheck/repair, real HTTP/JSON, network loss, expiry, firewall failure, cancellation, port conflict, UI QR withdrawal, packaged cleanup');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
