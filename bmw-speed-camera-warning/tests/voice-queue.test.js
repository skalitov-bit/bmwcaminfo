'use strict';
const assert=require('assert');
const {CameraVoiceAlerts}=require('../apps/aurelm_speed_camera_warning/voice-alert');
async function run(){
 const voice=new CameraVoiceAlerts({}),played=[];
 voice._request=async file=>{played.push(file);return {ok:true};};
 assert.strictEqual(await voice.camera(1,()=>false),false);
 assert.strictEqual(played.length,0,'A passed camera must never play from the queue');
 const pending=voice.camera(1,()=>true);voice.cancel();assert.strictEqual(await pending,false);
 assert.strictEqual(played.length,0,'GPS loss cancels queued speech');
 assert.strictEqual(await voice.camera(1,()=>true),true);assert.deepStrictEqual(played,['camera-500.m4a']);
 let release;voice._request=()=>new Promise(r=>{release=r;});
 const one=voice.camera(1);await Promise.resolve();const two=voice.camera(1);const three=voice.camera(1);
 assert.strictEqual(await three,false,'The voice queue must stay bounded');
 voice.cancel();release({ok:true});assert.strictEqual(await one,true);assert.strictEqual(await two,false);
 assert.strictEqual(voice.pending,0);
 console.log('Voice expiry/cancellation/queue tests passed');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
