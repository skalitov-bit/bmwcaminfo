'use strict';
const assert = require('assert'), path = require('path');
const base = path.resolve(process.argv[2] || path.join(__dirname, '../apps/aurelm_speed_camera_warning'));
const {CameraVoiceAlerts, cameraVoiceFile} = require(path.join(base, 'voice-alert'));

async function run() {
  for (const model of ['СТРЕЛКА', 'Стрелка-СТ', 'Стрелка / СТ', 'STRELKA-ST']) {
    assert.strictEqual(cameraVoiceFile(1, {camera_model: model}), 'strelka.m4a');
    assert.strictEqual(cameraVoiceFile(2, {camera_model: model}), 'strelka-200.m4a');
  }
  for (const model of ['Автодория', 'АВТОДОРИЯ', 'Avtodoria', 'Autodoria']) {
    assert.strictEqual(cameraVoiceFile(1, {camera_model: model}), 'avtodoria.m4a');
    assert.strictEqual(cameraVoiceFile(2, {camera_model: model}), 'avtodoria-200.m4a');
  }
  for (const fields of [{typeNamespace:'estrelka',typeCode:227}, {typeNamespace:'mapcam',typeCode:4}, {mapcamTypeCode:4}, {averageControl:true}]) {
    assert.strictEqual(cameraVoiceFile(1, Object.assign({camera_model:'АВТОДОРИЯ'}, fields)), 'avtodoria-average.m4a');
    assert.strictEqual(cameraVoiceFile(2, Object.assign({camera_model:'АВТОДОРИЯ'}, fields)), 'avtodoria-average-200.m4a');
  }
  assert.strictEqual(cameraVoiceFile(1, {camera_model:'АВТОДОРИЯ',typeNamespace:'estrelka',typeCode:68,averageControl:true}), 'avtodoria.m4a', 'Explicit source code wins over inconsistent average flag');
  for (const c of [null, {}, {name:'СТРЕЛКА'}, {description:'Автодория'}, {camera_model:'КОРДОН'}, {camera_model:'НЕ СТРЕЛКА'}, {camera_model:'Стрелка2'}, {camera_model:'СТРЕЛКА',camera_family:'dummy'}, {camera_model:'АВТОДОРИЯ',typeNamespace:'estrelka',typeCode:155}]) {
    assert.strictEqual(cameraVoiceFile(1,c), 'camera-500.m4a');
    assert.strictEqual(cameraVoiceFile(2,c), 'camera-200.m4a');
  }

  const voice = new CameraVoiceAlerts({}), played = [], strelka={camera_model:'СТРЕЛКА'};
  voice._request=async file=>{played.push(file);return {ok:true};};
  assert.strictEqual(await voice.camera(1,()=>true,strelka),true);
  assert.deepStrictEqual(played.splice(0),['strelka.m4a']);
  assert.strictEqual(await voice.camera(1,()=>false,strelka),false);
  assert.deepStrictEqual(played,[]);
  for (const error of ['Unknown action or audio file','Unsupported voice asset','Voice asset missing: /audio/strelka.m4a']) {
    voice._request=async file=>{played.push(file);return file==='strelka.m4a'?{ok:false,error}:{ok:true};};
    assert.strictEqual(await voice.camera(1,()=>true,strelka),true);
    assert.deepStrictEqual(played.splice(0),['strelka.m4a','camera-500.m4a']);
  }
  voice._request=async file=>{played.push(file);return {ok:false,error:'BMW MediaPlayer rejected audio'};};
  assert.strictEqual(await voice.camera(1,()=>true,strelka),false);
  assert.deepStrictEqual(played.splice(0),['strelka.m4a'],'Do not retry ambiguous playback failures');
  voice._request=async file=>{played.push(file);throw new Error('timeout');};
  assert.strictEqual(await voice.camera(1,()=>true,strelka),false);
  assert.deepStrictEqual(played.splice(0),['strelka.m4a']);
  voice._request=async file=>{played.push(file);voice.cancel();return {ok:false,error:'Unknown action or audio file'};};
  assert.strictEqual(await voice.camera(1,()=>true,strelka),false);
  assert.deepStrictEqual(played.splice(0),['strelka.m4a'],'Cancellation also prevents generic fallback');

  const cat=await require(path.join(base,'hybrid-catalog')).openCatalog(base), counts={strelka:0,avtodoria:0,dummy:0};
  try {
    for(let i=0;i<cat.index.blocks.length;i++)for(const c of cat.block(i)) {
      if(!/^(СТРЕЛКА|АВТОДОРИЯ)$/.test(c.camera_model||''))continue;
      const file=cameraVoiceFile(1,c);
      if(c.camera_family==='dummy'){assert.strictEqual(file,'camera-500.m4a');counts.dummy++;}
      else if(c.camera_model==='СТРЕЛКА'){assert.strictEqual(file,'strelka.m4a');counts.strelka++;}
      else {assert.strictEqual(file,c.averageControl?'avtodoria-average.m4a':'avtodoria.m4a');counts.avtodoria++;}
    }
  } finally {cat.close();}
  assert(counts.strelka>0&&counts.avtodoria>0&&counts.dummy>0);
  console.log('PASS: model selection, source control codes, both stages, safe fallback, cancellation and real catalog '+JSON.stringify(counts));
}
run().catch(e=>{console.error(e);process.exitCode=1;});
