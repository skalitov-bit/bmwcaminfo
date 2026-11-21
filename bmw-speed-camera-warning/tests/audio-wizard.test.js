'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os');
const {AudioWizard,candidates,recommend,reportText}=require('../apps/aurelm_speed_camera_warning/audio-wizard');
const tick=()=>new Promise(r=>setImmediate(r));
async function run(){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'speedcam-survey-'));
 try{
  const scan={ok:true,sinks:[{id:1024,name:'Media'},{id:1024},{id:-1},{id:1025,name:'Second'}],sources:[{id:999,name:'Unknown'}],alsa:{available:true},errors:{}};
  assert.deepStrictEqual(candidates(scan).map(c=>c.id),['file-1024','pcm-1024','file-1025','pcm-1025','alsa-287-1024']);
  assert(!candidates(scan).some(c=>c.sourceID===999),'Other sources must not be probed by guessing');
  const requests=[];let active=0,maxActive=0,moving=false,fail=false;
  const d={request:async r=>{requests.push(r);active++;maxActive=Math.max(maxActive,active);await tick();active--;if(r.action==='audio-scan')return scan;if(fail)throw Error('ALSA cleanup: blocked');return {ok:true};},stop:()=>{}};
  const w=new AudioWizard(d,()=>{},{dataDir:temp,appVersion:'test',moving:()=>moving});
  moving=true;await w.start();assert.equal(requests.length,0);moving=false;
  await w.start();await tick();assert.equal(w.phase,'rate');assert.equal(requests[1].kind,'voice');
  // Visit all modes, all discovered sinks, each of the three samples exactly once.
  for(let i=0;i<5;i++){
   for(let k=0;k<3;k++){
    assert.equal(w.kindIndex,k);assert.equal(w.phase,'rate');w.rate(3);await tick();
   }
   assert.equal(w.phase,'mix');w.mix('ducked');assert.equal(w.phase,'independence');
   w.independence(i===0?'dependent':'independent');assert.equal(w.phase,'preference');w.prefer(i===4);await tick();
  }
  assert.equal(w.phase,'done');assert.equal(w.report.status,'complete');assert.equal(maxActive,1);
  assert.equal(requests.filter(r=>r.action==='audio-test').length,15);assert(!requests.some(r=>/save|reset/.test(r.action)),'Survey never persists a route');
  const saved=JSON.parse(fs.readFileSync(path.join(temp,'audio-survey-latest.json'),'utf8'));
  assert.equal(saved.preferred,'alsa-287-1024');assert.equal(saved.recommendation.candidateId,'alsa-287-1024');
  assert(saved.recommendation.lines.some(s=>s.includes('Проверить ALSA в длительном проезде')));assert.equal(saved.savedSettingsChanged,false);
  assert(fs.readFileSync(path.join(temp,'audio-survey-latest.txt'),'utf8').includes('ALSA'));
  const reloaded=new AudioWizard(d,()=>{},{dataDir:temp});assert.equal(reloaded.previous.preferred,'alsa-287-1024');
  // A clean recording never qualifies as a live beeper. Unknown is not independence.
  const file=JSON.parse(JSON.stringify(saved.candidates[0]));file.independence='independent';
  let r={status:'complete',candidates:[file],preferred:file.id};assert.equal(recommend(r).candidateId,null);assert(reportText(r).includes('запись бипера'));
  const pcm=JSON.parse(JSON.stringify(saved.candidates[1]));pcm.independence='unknown';r.candidates=[pcm];r.preferred=pcm.id;assert.equal(recommend(r).candidateId,null);
  pcm.independence='independent';pcm.mix='voice-only';assert.equal(recommend(r).candidateId,null);
  pcm.mix='ducked';pcm.samples[0].quality=0;assert.equal(recommend(r).candidateId,null);
  pcm.samples.forEach(s=>s.quality=0);assert.equal(recommend(r).preferredId,null);
  // Backend failure pauses until an explicit skip/retry, never asks to rate nonexistent audio.
  fail=true;await w.start();await tick();assert.equal(w.phase,'error');const n=requests.length;w.rate(3);await tick();assert.equal(requests.length,n);assert.equal(w.current().samples[0].quality,null);
  w.skip();await tick();assert.equal(w.phase,'error');assert.equal(w.index,1);w.stop();assert.equal(w.report.status,'interrupted');assert(recommend(w.report).lines[0].includes('НЕ ЗАВЕРШЁН'));
  // Cancellation fences late network completions, including a pending discovery.
  let finish,stops=0;const deferred={request:()=>new Promise(r=>{finish=r;}),stop:()=>{stops++;}};
  const late=new AudioWizard(deferred,()=>{},{dataDir:temp});const start=late.start();late.stop();finish(scan);await start;assert.equal(late.phase,'intro');assert.equal(late.report,null);assert.equal(stops,1);
  deferred.request=async()=>scan;await late.start();await tick(); // request also accepted as test fixture
  deferred.request=()=>new Promise(r=>{finish=r;});const pending=late.play();late.stop();finish({ok:true});await pending;assert.equal(late.phase,'done');assert.equal(late.report.status,'interrupted');
  // Changed vehicle speed refuses a next sample.
  fail=false;await w.start();await tick();moving=true;w.rate(3);await tick();assert.equal(w.report.status,'interrupted');moving=false;
  // Persist failure remains visible; no false 'saved' claim.
  w.file=path.join(temp,'missing','report.json');w.persist();assert(w.saveError.includes('НЕ СОХРАНЁН'));
  console.log('PASS audio wizard: 15 serial probes, quality/preference, recommendation limits, no route writes, persistence, failure pause, cancellation and movement. Audio mocked.');
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
