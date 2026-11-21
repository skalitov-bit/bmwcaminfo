'use strict';
const assert=require('assert');
const {CameraVoiceAlerts,cameraVoiceFile}=require('../apps/aurelm_speed_camera_warning/voice-alert');
async function run(){
 const voice=new CameraVoiceAlerts({}),played=[];
 for(const [camera,prefix] of [[{typeNamespace:'estrelka',typeCode:206},'dps-post'],[{typeNamespace:'mapcam',typeCode:20},'dps-stationary'],[{mapcamTypeCode:20},'dps-stationary']]){
  for(const stage of [1,2]){
   const file=prefix+(stage===2?'-200':'')+'.m4a';
   assert.strictEqual(cameraVoiceFile(stage,{...camera,camera_model:'СТРЕЛКА'}),file);
   voice._request=async f=>{played.push(f);return {ok:true};};
   assert.deepStrictEqual(await voice.cameraResult(stage,()=>true,camera),{ok:true});
   assert.deepStrictEqual(played.splice(0),[file]);
   assert.strictEqual(await voice.camera(stage,()=>false,camera),false);
   assert.deepStrictEqual(played,[]);
   for(const error of ['Unsupported voice asset','Unknown action or audio file','Voice asset missing: /audio/'+file]){
    voice._request=async f=>{played.push(f);return {ok:false,error};};
    assert.deepStrictEqual(await voice.cameraResult(stage,()=>true,camera),{ok:false,retryable:false});
    assert.deepStrictEqual(played.splice(0),[file],'Never call a police post a camera');
    assert(/ДПС/.test(voice.lastError));
   }
   voice._request=async f=>{played.push(f);return {ok:true};};
   const pending=voice.cameraResult(stage,()=>true,camera);voice.cancel();
   assert.deepStrictEqual(await pending,{ok:false,skipped:true});assert.deepStrictEqual(played,[]);
  }
 }
 assert.strictEqual(cameraVoiceFile(1,{typeNamespace:'estrelka',typeCode:20}),'camera-500.m4a');
 assert.strictEqual(cameraVoiceFile(1,{typeNamespace:'mapcam',typeCode:206}),'camera-500.m4a');
 console.log('PASS: DPS stages, explicit types, expired/cancelled encounters and old-service behavior');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
