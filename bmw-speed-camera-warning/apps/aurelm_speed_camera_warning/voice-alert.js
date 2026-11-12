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
  }

  camera(stage, relevant, camera) {
    const generic = stage === 2 ? FILES[2] : FILES[1];
    return this._send(cameraVoiceFile(stage, camera), relevant, generic);
  }

  test() {
    return this._send(FILES[1]);
  }

  cancel() { this.generation++; }

  _send(file, relevant, fallback) {
    if(this.pending>=2)return Promise.resolve(false);
    this.pending++;
    const generation=this.generation,created=Date.now();
    const expired = () => generation!==this.generation||Date.now()-created>8000||(relevant&&!relevant());
    const task = this.queue.then(async () => {
      if(expired())return {ok:true,skipped:true};
      const result = await this._request(file);
      if (fallback && file !== fallback && unsupportedAsset(result)) {
        if(expired())return {ok:true,skipped:true};
        this.log('BMW voice service: model recording unavailable; using generic warning');
        return this._request(fallback);
      }
      return result;
    }).then((result) => {
      if(result&&result.skipped)return false;
      if (!result || result.ok !== true) {
        throw new Error(result && result.error ? result.error : 'BMW voice service rejected the request');
      }
      this.lastError = null;
      this.log('BMW voice service: ' + (result.message || 'playback accepted'));
      return true;
    });
    this.queue = task.catch((error) => {
      this.lastError = error && error.message ? error.message : String(error);
      this.log('BMW VOICE SERVICE ERROR: ' + this.lastError);
      return false;
    }).then(result=>{this.pending--;return result;});
    return this.queue;
  }

  _request(file) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let buffer = '';
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
        socket.write(JSON.stringify({ action: 'play', file: file }) + '\n');
      });
      socket.on('data', (chunk) => {
        buffer += chunk;
        const end = buffer.indexOf('\n');
        if (end < 0) return;
        let result;
        try { result = JSON.parse(buffer.slice(0, end)); }
        catch (error) { finish(new Error('Invalid response from BMW voice service')); return; }
        finish(null, result);
      });
      socket.on('error', (error) => {
        if (error && error.code === 'ENOENT') finish(new Error('BMW voice service is not installed or not running'));
        else if (error && error.code === 'EACCES') finish(new Error('Access denied to BMW voice service socket'));
        else finish(new Error('BMW voice service connection failed: ' + (error.message || error)));
      });
      socket.on('close', () => {
        if (!settled) finish(new Error('BMW voice service closed connection without a response'));
      });
    });
  }
}

module.exports = { CameraVoiceAlerts, cameraVoiceFile };
