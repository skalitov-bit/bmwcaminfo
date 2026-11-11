'use strict';
// Exercise real app code and data while replacing only vehicle services/rendering.
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm'),os=require('os');
const {createRequire}=require('module');
const file=process.argv[2]||path.join(__dirname,'../apps/aurelm_speed_camera_warning/main.js');
const appRequire=createRequire(path.resolve(file));
const {CameraStore:RealStore}=appRequire('./disk-camera-store');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-startup-'));
const warnings=[],texts=[],buttons={};let images=0,startPromise,gpsHandler,changeHandler,loopHandler,expectedCameras,tapHandler,lastCanvas;
const cv=new Proxy({}, {get:(_,key)=>(...args)=>{if(key==='text')texts.push(String(args[0]));return cv;}});
const settings={city:'russia',camera_display:'off'};
const previewDir=process.env.BMW_PREVIEW_DIR;
const Canvas=previewDir?appRequire('./kit/canvas').Canvas:null;
const native=process.env.BMW_NATIVE_PREVIEW==='1'?appRequire('./kit/record'):null;
if(previewDir)fs.mkdirSync(previewDir,{recursive:true});
const ctx={dataDir:tmp,canvas:()=>native?new native.Recorder(1600,520):previewDir?new Canvas(1600,520):cv,onTap:fn=>{tapHandler=fn;},loop:(name,ms,fn)=>{loopHandler=fn;},
    log:{info:()=>{},warn:s=>warnings.push(String(s))},
    settings:{get:k=>settings[k],set:(k,v)=>{settings[k]=v;},onChange:fn=>{changeHandler=fn;}},
    ui:{image:(id,image)=>{images++;lastCanvas=native?native.play(image.words(),new Canvas(1600,520)):image;},onClick:(k,fn)=>{buttons[k]=fn;},onVisible:()=>{}}};
let activeStore;
class CameraStore extends RealStore {constructor(o){super(o);activeStore=this;}async loadLocal(){const r=await super.loadLocal();expectedCameras=this.current.cities.russia.length;return r;}refresh(){this.pending=(async()=>{const old=this.current;this.current=await this.codec.openCatalog(path.dirname(path.resolve(file)));old.close();return {updated:true,database:this.current,source:this.source};})();return this.pending;}}
class GPS {on(k,fn){gpsHandler=fn;}start(){}}
class Voice {cancel(){}camera(){return Promise.resolve(true);}test(){return Promise.resolve(true);}}
class Cluster {setMode(){}show(){}clear(){}sync(){}}
const replacements={
    './kit/mgu':{run:o=>{startPromise=o.start(ctx);}},
    './screen-style':Object.assign({},appRequire('./screen-style'),{text:(cv,s,...args)=>{texts.push(String(s));return appRequire('./screen-style').text(cv,s,...args);}}),
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
    const settle=()=>new Promise(resolve=>setTimeout(resolve,40));
    const save=name=>{if(previewDir)fs.writeFileSync(path.join(previewDir,name+'.png'),lastCanvas.png());};
    save('01-map');
    if(previewDir){
      const alertCanvas=new Canvas(1600,520);alertCanvas.d.set(lastCanvas.d);
      const alertSurface=native?new native.Recorder(1600,520):alertCanvas;
      appRequire('./central-alert').drawCentralAlert(alertSurface,{camera:{mapcamTypeCode:1,camera_model:'СТРЕЛКА',limit:60},distanceM:500,speedKmh:81,type:'speeding'},81,{x:282,y:92,w:1282});
      if(native)native.play(alertSurface.words(),alertCanvas);
      for(let row=0;row<520;row++)assert.deepStrictEqual(alertCanvas.d.subarray(row*1600*4,(row*1600+266)*4),lastCanvas.d.subarray(row*1600*4,(row*1600+266)*4),'Warning must not cover sidebar');
      fs.writeFileSync(path.join(previewDir,'06-warning-example.png'),alertCanvas.png());
    }
    for(const [y,title,fileName] of [[170,'ОЖИДАНИЕ GPS','02-add'],[280,'ПОКА НЕТ СОХРАНЁННЫХ КАМЕР','03-my-cameras'],[394,'ВЫБЕРИТЕ ДИСПЛЕЙ','04-settings']]){
      texts.length=0;tapHandler(100,y);await settle();assert(texts.some(t=>t.includes(title)),'Sidebar opens '+title);save(fileName);
    }
    tapHandler(980,180);await settle();assert.strictEqual(settings.camera_display,'both','Display tile selects KOMBI + HUD');
    buttons.BTN_ZOOM();await settle();save('05-warning-settings');
    const voiceBefore=settings.mapcam_voice;
    tapHandler(280,140);tapHandler(400,176);await settle();assert.strictEqual(settings.mapcam_voice,voiceBefore,'Padding and row gaps must not change settings');
    tapHandler(400,130);await settle();assert.strictEqual(settings.mapcam_voice,'speeding','Warning row remains clickable');
    settings.mapcam_voice='always';
    tapHandler(100,50);await settle();
    texts.length=0;tapHandler(100,128);await settle();assert.strictEqual(texts.length,0,'Sidebar gap does not switch pages');
    buttons.BTN_ZOOM(); // map zoom still works
    // Leave warning settings on the display page for subsequent controller checks.
    tapHandler(100,394);buttons.BTN_ZOOM();tapHandler(100,50);await settle();
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
    assert(texts.some(t=>t.includes('ПРЕДУПРЕЖДЕНИЯ')));
    buttons.BTN_REFRESH();assert.strictEqual(settings.mapcam_voice,'speeding');
    buttons.BTN_CAM_NEXT();buttons.BTN_REFRESH();assert.strictEqual(settings.mapcam_excess,'10');
    buttons.BTN_CAM_NEXT();buttons.BTN_REFRESH();assert.strictEqual(settings.mapcam_distance,'500');
    gpsHandler({state:'lost',fix:null});loopHandler();
    await new Promise(resolve=>setTimeout(resolve,30));
    assert(!warnings.some(w=>/UI_RENDER_FAILED|render:|ReferenceError|TypeError/.test(w)),warnings.join('\n'));
    if(native)for(const entry of native.atlasList){assert(entry.f.atlasW<=1024,'MGU atlas width limit');assert(entry.f.atlasH<=4096,'MGU atlas height limit');}
    console.log('App startup/render smoke test passed; images:',images,'RSS MiB:',Math.round(process.memoryUsage().rss/1048576));
}
run().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{if(activeStore)activeStore.close();fs.rmSync(tmp,{recursive:true,force:true});});
