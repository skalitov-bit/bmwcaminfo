'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto');
const {AudioReport,mountedUsb}=require('../native/bmwcaminfo-voice/audio-report');
const {AudioDiagnostics}=require('../apps/aurelm_speed_camera_warning/audio-diagnostics');
async function run(){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'speedcam-report-')),root=temp.replace(/\\/g,'/'),stick=path.join(temp,'Stick');fs.mkdirSync(stick);
 const mounts=path.join(temp,'mounts'),reportDir=path.join(temp,'reports'),commands=[];
 const s={audioBackend:'pcm-fifo',fileFallback:true,audioOverlay:true,routeSinkId:1024,init(){throw Error('Must not initialize a player');},cc:{callMethod:async key=>{commands.push(key);if(key==='getListMainSources')return {listMainSources:[{sourceID:8,name:'OapGenericOverlay',secret:'excluded'}]};if(key==='getListMainSinks')return {listMainSinks:[{sinkID:1024,name:'MediaSink_Front'}]};if(key==='getListMainConnections')return {listConnections:[]};throw Error('Mutation forbidden');}}};
 const d={s,saved:{backend:'file',overlay:true},alsa:{lastOverlayDiscovery:{reason:'no-advertised-output'}}};
 s.audioComparisons=[{probeProfile:'smartx-direct',kind:'voice',accepted:false,error:'unsupported format'}];
 const telemetry=require('../native/bmwcaminfo-voice/buffer-telemetry');
 const runtime=telemetry.start(s,{converter:true,overlay:true});telemetry.native(runtime,{bufferParamsKnown:true,bufferMs:64,underruns:2,recoveries:2,untrusted:'not-copied'});telemetry.finish(s,runtime,Error('simulated underrun failure'));
 for(let i=0;i<30;i++){const probe=telemetry.start(s,{diagnosticOrigin:'probe'});telemetry.finish(s,probe,null);}
 assert.equal(s.audioBufferHistory.streams.length,16);assert.equal(s.audioBufferHistory.lastFailure.origin,'runtime');assert.equal(s.audioBufferHistory.lastFailure.native.underruns,2);
 assert.equal(s.audioBufferHistory.lastRuntime.native.underruns,2);assert.equal(s.audioBufferHistory.lastRuntimeFailure.native.underruns,2);
 const brokenProbe=telemetry.start(s,{diagnosticOrigin:'probe'});telemetry.finish(s,brokenProbe,Error('probe failed'));assert.equal(s.audioBufferHistory.lastRuntimeFailure.native.underruns,2);assert.equal(s.audioBufferHistory.lastProbeFailure.origin,'probe');
 for(let i=0;i<100;i++)telemetry.event(brokenProbe,'test','bounded');assert.equal(brokenProbe.events.length,12);
 const exec=(bin,args,options,cb)=>{assert(options.timeout<=3500);assert(['--check','--check-overlay'].includes(args[0]));setImmediate(()=>cb(args[0]==='--check-overlay'?{code:7,message:'missing overlay'}:null,JSON.stringify({library:true,overlay:false,outputs:['default','null','smartx'],reason:'no-advertised-output'}),''));};
 const o={reportDir,mountsFile:mounts,mediaRoot:root,serviceVersion:'test',exec};
 const reporter=new AudioReport(d,o),request={appVersion:'0.9.65',backend:'alsa',overlay:true,lastMessage:'Ошибка Overlay',mapStorage:{schema:1,active:false,reason:'MAP_HDD_HELPER_UPDATE',attempts:[{path:'/mnt/share',directError:'EACCES'}]}};
 assert.deepStrictEqual(mountedUsb('/dev/sda1 /media/My\\040Stick vfat rw 0 0\n/dev/sdb1 /media/ReadOnly vfat ro 0 0\n/dev/sdc1 /mnt/no vfat rw 0 0\n'),['/media/My Stick']);
 fs.writeFileSync(mounts,'');let result=await reporter.run(request);assert(result.local&&!result.usb);assert(result.usbError.includes('Нет доступной'));let report=JSON.parse(fs.readFileSync(result.local));assert(report.overlay.result.outputs.length===3);assert(!report.overlay.ok);assert(report.readOnly);assert(!report.audibilityTested);assert(!JSON.stringify(report).includes('excluded'));assert(report.alsaFiles['/proc/asound/cards']);
 assert.equal(report.schema,2);assert.equal(report.bufferDiagnostics.lastRuntimeFailure.native.underruns,2);assert(!JSON.stringify(report.bufferDiagnostics).includes('not-copied'));assert.equal(report.bufferDiagnostics.streams.length,16);
 assert.deepStrictEqual(report.audioComparisons,s.audioComparisons);assert.deepStrictEqual(report.mapStorage,request.mapStorage);
 const reportView=require('../apps/aurelm_speed_camera_warning/diagnostic-report-view');const screen=reportView.pages(reportView.audioReport(report)).map(p=>p.join('\n')).join('\n');assert(screen.includes('Буфер: 64 мс / underrun: 2'));assert(screen.includes('БУФЕР: ОШИБКА УВЕДОМЛЕНИЙ'));assert(screen.includes('probe failed'));
 fs.writeFileSync(mounts,'/dev/sda1 '+root+'/Stick vfat rw 0 0\n');
 const pending=reporter.run(request);let rejected=false;try{await reporter.run(request);}catch(e){rejected=true;}assert(rejected);result=await pending;assert(result.usb,result.usbError);assert(fs.readFileSync(result.local).equals(fs.readFileSync(result.usb)));assert.equal(result.sha256,crypto.createHash('sha256').update(fs.readFileSync(result.usb)).digest('hex'));
 fs.writeFileSync(mounts,'/dev/sda1 '+root+'/Stick vfat rw 0 0\n/dev/sdb1 '+root+'/Other vfat rw 0 0\n');result=await reporter.run(request);assert(!result.usb&&result.usbError.includes('несколько'));
 fs.writeFileSync(mounts,'');s.inventoryError='unavailable';result=await reporter.run(request);report=JSON.parse(fs.readFileSync(result.local));assert(!report.bmw.listOfMainSources.ok);assert(report.bmw.listOfMainSources.error.includes('unavailable'));
 for(let i=0;i<9;i++)await reporter.run(request);assert.equal(fs.readdirSync(reportDir).filter(n=>n.endsWith('.json')).length,10,'Retention bounds local disk usage');
 const bad=new AudioReport(d,Object.assign({},o,{reportDir:mounts}));let failed=false;try{await bad.run(request);}catch(e){failed=true;}assert(failed,'Local write error must not report success');
 assert(s.audioOverlay&&s.fileFallback);assert.equal(s.routeSinkId,1024);assert(commands.every(k=>/^getListMain/.test(k)));
 const ui=new AudioDiagnostics(()=>{},{appVersion:'0.9.65'});ui.backend='file';ui.overlay=true;ui.confirmable=true;ui.message='ALSA discovery failed';let payload;
 ui.request=async r=>{payload=r;return result;};await ui.saveReport();assert.equal(payload.action,'audio-report');assert.equal(payload.lastMessage,'ALSA discovery failed');assert.equal(ui.backend,'file');assert(ui.overlay&&ui.confirmable);assert(ui.message.includes('СОХРАНЁН В MGU'));
 ui.request=async()=>Object.assign({},result,{usb:'/media/Stick/SpeedCAM-Diagnostics/test.json'});await ui.saveReport();assert(ui.message.includes('ОТЧЁТ НА USB'));
 ui.request=async()=>{throw Error('Unknown action or audio file');};await ui.saveReport();assert(ui.message.includes('Обновите звуковой компонент'));
 const targets=[],cv={fillRect(){},strokeRoundRect(){},line(){}};ui.draw(cv,{colors:{},text(){},heading(){},drawSelection(){}},(cv,x,y,w,h,run,key)=>targets.push({key,x,y,w,h,run}));assert(!targets.some(t=>['audio-report','audio-report-screen'].includes(t.key)),'Removed report buttons have no navigation targets');const button=targets.find(t=>t.key==='audio-report-phone');assert(button);let taps=0;ui.shareReport=()=>taps++;button.run();ui.tap(button.x+5,button.y+5);assert.equal(taps,2,'Joystick and touch share the phone report action');
 const moving=new AudioDiagnostics(()=>{},{moving:()=>true});moving.request=()=>{throw Error('Must not request');};await moving.saveReport();assert(moving.message.includes('остановите'));
 console.log('PASS report: partial discovery, exact read-only methods, USB verified bytes/hash, absent/multiple media, parallel guard, saved M4A Overlay, touch and joystick. Hardware mocked.');
 // Keep fixtures in the OS temporary directory for inspection; no recursive removal.
}
run().catch(e=>{console.error(e);process.exitCode=1;});
