'use strict';
const net = require('net');

const SOCKET = '/run/bmwcaminfo-voice/ctl.sock';
const FILES = {
  1: 'camera-500.m4a',
  2: 'camera-200.m4a'
};

// Model is an explicit database field. Never infer it from an address or display name.
function cameraVoiceFile(stage, camera) {
  const c = camera || {}, generic = stage === 2 ? FILES[2] : FILES[1];
  if (c.camera_family === 'dummy' || c.typeNamespace === 'estrelka' && Number(c.typeCode) === 155) return generic;
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
    this.getVolume = options.getVolume || function () { return 100; };
  }

  camera(stage, relevant, camera) {
    const generic = stage === 2 ? FILES[2] : FILES[1];
    return this._send(cameraVoiceFile(stage, camera), relevant, generic);
  }

  cameraResult(stage,relevant,camera) {
    const generic=stage===2?FILES[2]:FILES[1];
    return this._send(cameraVoiceFile(stage,camera),relevant,generic,true);
  }

  test() {
    return this._send(FILES[1]);
  }

  cancel() { this.generation++; }

  _send(file, relevant, fallback, detailed) {
    const output=r=>detailed?r:r.ok===true;
    if(this.pending>=2)return Promise.resolve(output({ok:false,skipped:true}));
    this.pending++;
    const generation=this.generation,created=Date.now();
    const expired=()=>generation!==this.generation||Date.now()-created>8000||(relevant&&!relevant());
    const task=this.queue.then(async()=>{
      if(expired())return {ok:false,skipped:true};
      let result=await this._request(file);
      if(fallback&&file!==fallback&&unsupportedAsset(result)){
        if(expired())return {ok:false,skipped:true};
        this.log('BMW voice service: model recording unavailable; using generic warning');
        result=await this._request(fallback);
      }
      if(result&&result.ok){this.lastError=null;return {ok:true};}
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

  _request(file) {
    const raw=this.getVolume(), number=raw===undefined||raw===null||raw===''?100:Number(raw);
    const volume=Number.isFinite(number)?Math.max(0,Math.min(100,Math.round(number/10)*10)):100;
    // Mute must not acquire an audio route or interrupt music.
    if(volume===0)return Promise.resolve({ok:true,muted:true});
    return new Promise((resolve, reject) => {
      let settled = false;
      let buffer = '';let sent=false;
      const socket = net.createConnection(SOCKET);
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { socket.destroy(); } catch (e) {}
        if (error) reject(error);
        else resolve(result);
      };
      const timer = setTimeout(() => finish(new Error('BMW voice service timeout (35 s)')), 35000);
      socket.setEncoding('utf8');
      socket.on('connect', () => {
        // Older services ignore extra fields on play. A separate action prevents
        // them from playing at full volume when a quieter level was requested.
        sent=true;socket.write(JSON.stringify(volume===100?{action:'play',file:file}:{action:'play-volume',file:file,volume:volume}) + '\n');
      });
      socket.on('data', (chunk) => {
        buffer += chunk;
        const end = buffer.indexOf('\n');
        if (end < 0) return;
        let result;
        try { result = JSON.parse(buffer.slice(0, end)); }
        catch (error) { finish(new Error('Invalid response from BMW voice service')); return; }
        if(volume<100&&result&&result.error==='Unknown action or audio file'){
          result={ok:false,error:'Для регулировки громкости установите звуковой компонент 0.1.11'};
        }
        finish(null, result);
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
