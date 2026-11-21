'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const {OverlayTest}=require('../apps/aurelm_speed_camera_warning/overlay-test');
async function run(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'overlay-ui-'));try{
  let moving=false;const d=new OverlayTest(()=>{},{dataDir:dir,moving:()=>moving}),calls=[];
  d.request=async r=>{calls.push(r.action);return r.action==='audio-overlay-scan'?{overlayProbeSupported:true,sourceID:1048,sinkID:1024,carplayConnected:true}:{overlay:{accepted:true,duckingConfirmed:false}};};
  await d.run(true);assert.equal(calls.length,0);
  await d.run(false);assert(d.ready);moving=true;await d.run(true);assert.equal(calls.length,1);moving=false;
  await d.run(true);assert(d.result);d.record('ducked');assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'overlay-test-latest.json'))).userConfirmedDucking,true);
  assert(calls.every(s=>s==='audio-overlay-scan'||s==='audio-overlay-test'),'No settings save/reset or M4A fallback');
  const targets=[],cv={fillRect(){},strokeRoundRect(){}};
  d.draw(cv,{colors:{},text(){},heading(){}},(c,x,y,w,h,fn,key)=>targets.push(key),()=>{});
  assert.deepStrictEqual(targets,['overlay-scan','overlay-play','overlay-answer-ducked','overlay-answer-paused','overlay-answer-unchanged','overlay-answer-silent','overlay-back']);
  let resolve;d.request=()=>new Promise(r=>{resolve=r;});const pending=d.run(true);d.stop();resolve({overlay:{accepted:true}});await pending;assert(!d.result,'Late response after exit must be ignored');
  d.request=async()=>{throw Error('Unknown action or audio file');};await d.run(false);assert(/нет Overlay/.test(d.message));assert(!d.ready);
  console.log('PASS Overlay UI: ordered scan/play, movement gate, joystick targets, user report, old service, cancellation; no mode changes.');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
