'use strict';
const net = require('net');
const {policeKind,isDummy}=require('./point-kind');

const SOCKET = '/run/bmwcaminfo-voice/ctl.sock';
const FILES = {
  1: 'camera-500.m4a',
  2: 'camera-200.m4a'
};

// Model is an explicit database field. Never infer it from an address or display name.
function cameraVoiceFile(stage, camera, forceAudio) {
  const c = camera || {}, generic = stage === 2 ? FILES[2] : FILES[1];
  const hazard=require('./notification-types').hazardKind(c);
  if(hazard)return (hazard==='school'?'school':'speed-bump')+(stage===2?'-200':'')+'.m4a';
  if(isDummy(c))return forceAudio===true?generic:null; // Explicit diagnostic mode only.
  const police = policeKind(c);
  if (police) return (police === 'stationary' ? 'dps-stationary' : 'dps-post') + (stage === 2 ? '-200.m4a' : '.m4a');
  const model = typeof c.camera_model === 'string' ? c.camera_model.trim().toUpperCase() : '';
  const suffix = stage === 2 ? '-200.m4a' : '.m4a';
  if (/^(СТРЕЛКА|STRELKA)(?:$|[\s\-/+(])/.test(model)) return 'strelka' + suffix;
  if (/^(АВТОДОРИЯ|AVTODORIA|AVTODORIYA|AUTODORIA)(?:$|[\s\-/+(])/.test(model)) {
    // The hardware model alone does not identify an average-speed section.
    const average = c.typeNamespace === 'estrelka' ? Number(c.typeCode) === 227 :
      c.typeNamespace === 'mapcam' ? Number(c.typeCode) === 4 :
      c.mapcamTypeCode != null ? Number(c.mapcamTypeCode) === 4 : c.averageControl === true;
    return 'avtodoria' + (average ? '-average' : '') + suffix;
  }
  return generic;
}

function unsupportedAsset(result) {
  // These responses happen before playback. Never retry on timeouts or audio-route errors.
  return result && result.ok === false && /^(Unknown action or audio file|Unsupported voice asset|Voice asset missing:.*)$/.test(result.error || '');
}

class CameraVoiceAlerts {
  constructor(options) {
    this.log = options.log || function () {};
    this.queue = Promise.resolve();
    this.lastError = null;
    this.generation = 0;
    this.pending = 0;
    this.serial=0;this.activeRequests=new Set();
    this.getVolume = options.getVolume || function () { return 100; };
  }

  camera(stage, relevant, camera, forceAudio) {
    const generic = (policeKind(camera)||require('./notification-types').hazardKind(camera)) ? null : stage === 2 ? FILES[2] : FILES[1];
    return this._send(cameraVoiceFile(stage, camera, forceAudio), relevant, generic);
  }

  cameraResult(stage,relevant,camera,forceAudio) {
    const generic=(policeKind(camera)||require('./notification-types').hazardKind(camera))?null:stage===2?FILES[2]:FILES[1];
    return this._send(cameraVoiceFile(stage,camera,forceAudio),relevant,generic,true);
  }

  test() {
    return this._send(FILES[1]);
  }

  sectionEndResult(relevant) {
    // Never fall back to an approaching-camera message for a completed section.
    return this._send('average-end.m4a', relevant, null, true);
  }

  cancel() { this.generation++;for(const cancel of this.activeRequests)cancel(); }

  _send(file, relevant, fallback, detailed) {
    const output=r=>detailed?r:r.ok===true;
    if(!file)return Promise.resolve(output({ok:true,visualOnly:true}));
    if(this.pending>=2)return Promise.resolve(output({ok:false,skipped:true}));
    file=require('./i18n').voiceFile(file);fallback=fallback&&require('./i18n').voiceFile(fallback);
    this.pending++;
    const generation=this.generation,created=Date.now();
    const expired=()=>generation!==this.generation||Date.now()-created>8000||(relevant&&!relevant());
    const task=this.queue.then(async()=>{
      if(expired())return {ok:false,skipped:true};
      let result=await this._request(file,expired);
      if(fallback&&file!==fallback&&unsupportedAsset(result)){
        if(expired())return {ok:false,skipped:true};
        this.log('BMW voice service: model recording unavailable; using generic warning');
        result=await this._request(fallback,expired);
      }
      if(result&&result.skipped)return {ok:false,skipped:true};
      if(result&&result.ok){this.lastError=null;return {ok:true};}
      if(file==='average-end.m4a'&&unsupportedAsset(result)){
        this.lastError='Для оповещения о конце участка установите звуковой компонент 0.1.15';
        this.log('BMW VOICE SERVICE ERROR: '+this.lastError);
        return {ok:false,retryable:false};
      }
      if(/^dps-(post|stationary)(-200)?\.m4a$/.test(file)&&unsupportedAsset(result)){
        this.lastError='Установите звуковой компонент с озвучкой постов ДПС';
        this.log('BMW VOICE SERVICE ERROR: '+this.lastError);
        return {ok:false,retryable:false};
      }
      this.lastError=result&&result.error||'BMW voice service rejected request';
      this.log('BMW VOICE SERVICE ERROR: '+this.lastError);
      return {ok:false,retryable:!!unsupportedAsset(result)};
    }).catch(error=>{
      this.lastError=error&&error.message||String(error);this.log('BMW VOICE SERVICE ERROR: '+this.lastError);
      return {ok:false,retryable:error&&error.retryable===true};
    }).then(result=>{this.pending--;return result;});
    this.queue=task;
    return task.then(output);
  }

  _request(file,expired) {
    const raw=this.getVolume(), number=raw===undefined||raw===null||raw===''?100:Number(raw);
    const volume=Number.isFinite(number)?Math.max(0,Math.min(100,Math.round(number/10)*10)):100;
    // Mute must not acquire an audio route or interrupt music.
    if(volume===0)return Promise.resolve({ok:true,muted:true});
    return new Promise((resolve, reject) => {
      let settled = false;
      let buffer = '';let sent=false,started=false,watch=null;
      const id=Date.now().toString(36)+'-'+(++this.serial);
      const cancel=()=>{if(!started)finish(null,{ok:false,skipped:true});};
      const socket = net.createConnection(SOCKET);
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);clearTimeout(watch);this.activeRequests.delete(cancel);
        try { socket.destroy(); } catch (e) {}
        if (error) reject(error);
        else resolve(result);
      };
      const timer = setTimeout(() => finish(new Error('BMW voice service timeout (35 s)')), 35000);
      this.activeRequests.add(cancel);
      const check=()=>{if(settled||started)return;if(expired&&expired()){cancel();return;}watch=setTimeout(check,100);};check();
      socket.setEncoding('utf8');
      socket.on('connect', () => {
        // Older services ignore extra fields on play. A separate action prevents
        // them from playing at full volume when a quieter level was requested.
        if(settled)return;
        sent=true;socket.write(JSON.stringify({action:'play-v3',id,file,volume,ttlMs:8000,language:require('./i18n').language()}) + '\n');
      });
      socket.on('data', (chunk) => {
        buffer += chunk;
        if(buffer.length>4096){finish(new Error('Invalid response from BMW voice service'));return;}
        let end;
        while((end=buffer.indexOf('\n'))>=0){
          let result;try{result=JSON.parse(buffer.slice(0,end));}catch(e){finish(new Error('Invalid response from BMW voice service'));return;}
          buffer=buffer.slice(end+1);
          if(result.event==='started'&&result.id===id){started=true;clearTimeout(watch);continue;}
          if(result.error==='Unknown action or audio file')result={ok:false,error:'Для безопасной озвучки установите звуковой компонент 0.1.17'};
          finish(null,result);return;
        }
      });
      socket.on('error', (error) => {
        const message=error&&error.code==='ENOENT'?'BMW voice service is not installed or not running':
          error&&error.code==='EACCES'?'Access denied to BMW voice service socket':'BMW voice service connection failed';
        finish(Object.assign(new Error(message),{retryable:!sent}));
      });
      socket.on('close', () => {
        if (!settled) finish(new Error('BMW voice service closed connection without a response'));
      });
    });
  }
}

module.exports = { CameraVoiceAlerts, cameraVoiceFile };
