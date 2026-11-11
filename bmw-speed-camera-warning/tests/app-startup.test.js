'use strict';
// Exercise real app code and data while replacing only vehicle services/rendering.
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm'),os=require('os');
const {createRequire}=require('module');
const file=process.argv[2]||path.join(__dirname,'../apps/aurelm_speed_camera_warning/main.js');
const appRequire=createRequire(path.resolve(file));
const {CameraStore:RealStore}=appRequire('./disk-camera-store');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-startup-'));
const warnings=[],texts=[],buttons={};let images=0,startPromise,gpsHandler,changeHandler,loopHandler,expectedCameras;
const cv=new Proxy({}, {get:(_,key)=>(...args)=>{if(key==='text')texts.push(String(args[0]));return cv;}});
const settings={city:'russia',camera_display:'off'};
const ctx={dataDir:tmp,canvas:()=>cv,onTap:()=>{},loop:(name,ms,fn)=>{loopHandler=fn;},
    log:{info:()=>{},warn:s=>warnings.push(String(s))},
    settings:{get:k=>settings[k],set:(k,v)=>{settings[k]=v;},onChange:fn=>{changeHandler=fn;}},
    ui:{image:()=>{images++;},onClick:(k,fn)=>{buttons[k]=fn;},onVisible:()=>{}}};
let activeStore;
class CameraStore extends RealStore {constructor(o){super(o);activeStore=this;}async loadLocal(){const r=await super.loadLocal();expectedCameras=this.current.cities.russia.length;return r;}refresh(){this.pending=(async()=>{const old=this.current;this.current=await appRequire('./camera-catalog').openCatalog(path.dirname(path.resolve(file)));old.close();return {updated:true,database:this.current,source:this.source};})();return this.pending;}}
class GPS {on(k,fn){gpsHandler=fn;}start(){}}
class Voice {cancel(){}camera(){return Promise.resolve(true);}test(){return Promise.resolve(true);}}
class Cluster {setMode(){}show(){}clear(){}sync(){}}
const replacements={
    './kit/mgu':{run:o=>{startPromise=o.start(ctx);}},
    './uplink':{init:()=>{},describe:()=> 'test',checkInternet:()=>Promise.resolve(false)},
    './disk-camera-store':{CameraStore},'./gps':{BmwGps:GPS},
    './voice-alert':{CameraVoiceAlerts:Voice},'./cluster-output':{CameraClusterOutput:Cluster}
};
vm.runInNewContext(fs.readFileSync(file,'utf8'),{require:n=>replacements[n]||appRequire(n),
    __dirname:path.dirname(path.resolve(file)),console,Buffer,process,setTimeout:fn=>setTimeout(fn,0),setInterval:()=>0}, {filename:file});
async function run(){
    await startPromise;await activeStore.pending;await new Promise(resolve=>setTimeout(resolve,30));
    assert(images>0,'Initial app screen must render: '+warnings.join('\n'));
    assert(expectedCameras>=50000&&texts.some(t=>t.includes(String(expectedCameras))),'Nationwide database count must be visible');
    assert(texts.some(t=>t.includes('предупреждения по всей России')),'Warning coverage must be visible');
    settings.city='yoshkar-ola';changeHandler('city');await new Promise(resolve=>setTimeout(resolve,30));
    settings.city='russia';changeHandler('city');
    // gpsChanged expects a state object; use the actual module's public shape.
    gpsHandler({fix:{lat:55.75,lon:37.62,headingDeg:0,accuracyM:5,speedKmh:36,timeMs:Date.now()},state:'fixed'});
    loopHandler();buttons.BTN_CAM_NEXT();await new Promise(resolve=>setTimeout(resolve,30));
    assert(!warnings.some(w=>/UI_RENDER_FAILED|render:|ReferenceError|TypeError/.test(w)),warnings.join('\n'));
    assert(images>=3,'Switching views and GPS update must still render');
    buttons.BTN_CAMERA_MENU();buttons.BTN_CAMERA_MENU();buttons.BTN_CAMERA_MENU();
    await new Promise(resolve=>setTimeout(resolve,30));
    buttons.BTN_ZOOM();await new Promise(resolve=>setTimeout(resolve,30));
    assert(texts.some(t=>t.includes('ПРЕДУПРЕЖДЕНИЯ MAPCAM')));
    buttons.BTN_REFRESH();assert.strictEqual(settings.mapcam_voice,'speeding');
    buttons.BTN_CAM_NEXT();buttons.BTN_REFRESH();assert.strictEqual(settings.mapcam_excess,'10');
    buttons.BTN_CAM_NEXT();buttons.BTN_REFRESH();assert.strictEqual(settings.mapcam_distance,'500');
    gpsHandler({state:'lost',fix:null});loopHandler();
    await new Promise(resolve=>setTimeout(resolve,30));
    assert(!warnings.some(w=>/UI_RENDER_FAILED|render:|ReferenceError|TypeError/.test(w)),warnings.join('\n'));
    console.log('App startup/render smoke test passed; images:',images,'RSS MiB:',Math.round(process.memoryUsage().rss/1048576));
}
run().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{if(activeStore)activeStore.close();fs.rmSync(tmp,{recursive:true,force:true});});
