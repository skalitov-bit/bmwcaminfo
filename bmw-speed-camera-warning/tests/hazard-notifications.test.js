'use strict';
const assert=require('assert'),path=require('path'),fs=require('fs');
const A=path.resolve(__dirname,'../apps/aurelm_speed_camera_warning');
const {TYPES,typeOf,enabled,key,allowed,hazardKind}=require(A+'/notification-types');
const {NotificationSession}=require(A+'/notification-session');
const {NotificationTypePanel}=require(A+'/notification-type-panel');
const {cameraVoiceFile,CameraVoiceAlerts}=require(A+'/voice-alert');
const {hudLabels}=require(A+'/camera-label'),{isSpeeding}=require(A+'/notification-rules');
const {MapcamWarnings}=require(A+'/mapcam-warnings');
const school={id:'school',typeNamespace:'mapcam',typeCode:22,mapcamTypeCode:22,lat:55,lon:37,limit:30,warningEnabled:true,warningProfile:'hybrid-v1',camera_family:'road_warning',mapcamDirectionType:0,mapcamAngleDeg:60,mapcamWarningDistanceM:500};
const bump=Object.assign({},school,{id:'bump',typeNamespace:'estrelka',typeCode:200,mapcamTypeCode:null});
const camera=Object.assign({},school,{id:'camera',typeCode:1,mapcamTypeCode:1,camera_family:'fixed',limit:60});
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
async function main(){
 const values={},get=k=>values[k];
 for(const t of TYPES)for(const channel of ['voice','banner'])assert.equal(enabled(get,channel,t.id),!['school','bump'].includes(t.id));
 assert.equal(typeOf(bump),'bump');assert.equal(typeOf({...bump,typeNamespace:'mapcam',typeCode:200}),'other');
 assert.equal(hazardKind({...camera,camera_model:'ШКОЛА'}),null,'Models cannot change category');
 for(const c of [school,bump]){
  assert(!isSpeeding(c,130,{excessKmh:0},false,false));assert.equal(hudLabels(c).model,'');
  assert(cameraVoiceFile(1,c).includes(c===school?'school':'speed-bump'));
  assert(cameraVoiceFile(2,c).endsWith('-200.m4a'));
 }
 let now=Date.now();const fix=d=>({lat:55-d/111320,lon:37,speedKmh:40,accuracyM:5,headingDeg:0,timeMs:now});
 const options={voice:'speeding',repeat200:true,bannerEnabled:c=>enabled(get,'banner',c),voiceEnabled:c=>enabled(get,'voice',c)};
 const calls=[],voice={cancel(){},cameraResult:async(stage,relevant,c)=>{if(relevant())calls.push(c.id+':'+stage);return {ok:true};}};
 const session=new NotificationSession(voice,()=>options,()=>now);
 const states={school:{camera:school,phase:'point',distanceM:400,speedKmh:40,speeding:false},bump:{camera:bump,phase:'point',distanceM:450,speedKmh:40,speeding:false}};
 session.update(states,fix(400),0);await flush();assert.equal(session.visualCurrent,null);assert.deepEqual(calls,[]);
 options.forceAudio=true;session.update(states,fix(400),0);await flush();assert.deepEqual(calls,[],'Explicit per-type mute overrides forced diagnostic audio');options.forceAudio=false;
 values[key('voice','school')]='on';session.update(states,fix(400),0);await flush();assert.deepEqual(calls,['school:1']);assert.equal(session.visualCurrent,null,'Voice only must not show banner');
 values[key('banner','bump')]='on';session.update(states,fix(400),0);await flush();assert.equal(session.visualCurrent.camera.id,'bump');assert.deepEqual(calls,['school:1'],'Banner only must not speak');
 now+=6000;states.school.distanceM=200;session.update(states,fix(200),0);await flush();assert.deepEqual(calls,['school:1','school:2']);
 values[key('voice','school')]='off';session.clear();session.update(states,fix(200),0);await flush();assert.deepEqual(calls,['school:1','school:2']);
 values[key('banner','school')]='on';states.camera={camera,phase:'point',distanceM:600,speeding:true,speedKmh:90};session.update(states,fix(200),0);assert.equal(session.current.camera.id,'camera');assert.equal(session.visualCurrent.camera.id,'camera','Speed camera priority preserved');
 values[key('banner','speed')]='off';session.update(states,fix(200),0);assert.equal(session.visualCurrent.camera.id,'school','Hidden camera cannot hide enabled hazard');
 // Real trajectory engine must acquire and release both hazard codes.
 for(const c of [school,bump]){const engine=new MapcamWarnings(options);let found=false;for(let d=650;d>=-150;d-=10){now+=1000;engine.update(fix(d),[c],now);found=found||!!engine.states[c.id];}assert(found,'Hazard acquired');assert(!engine.states[c.id],'Hazard released after pass');}
 // Checkbox and touch actions share callback; renderer exposes each target to joystick.
 let changed=0,back=0;const panel=new NotificationTypePanel({get,set:(k,v)=>values[k]=v},()=>changed++,()=>back++),targets=[];
 const cv=new Proxy({}, {get:()=>()=>cv}),style={colors:{},text(){},heading(){}};
 panel.open('voice');panel.draw(cv,style,(_c,x,y,w,h,run,id)=>targets.push({x,y,w,h,run,id}));
 assert.equal(targets.length,TYPES.length+1);const t=targets.find(t=>t.id==='type-voice-school');panel.tap(t.x+3,t.y+3);assert(enabled(get,'voice',school));assert.equal(changed,1);targets.find(t=>t.id==='type-back').run();assert.equal(back,1);
 const ring=[{k:'tgt:nav-SETTINGS'}].concat(targets.map(t=>({k:'tgt:'+t.id}))),display={focusKey:'tgt:nav-SETTINGS',_ring:()=>ring,_toward:()=>null};
 require(A+'/controller-navigation').install(display);
 for(let i=1;i<ring.length;i++){const next=display._toward('S');assert.equal(next.k,ring[i].k);display.focusKey=next.k;}
 for(let i=ring.length-2;i>=0;i--){const next=display._toward('N');assert.equal(next.k,ring[i].k);display.focusKey=next.k;}
 const client=new CameraVoiceAlerts({});let requested=[];client._request=async file=>{requested.push(file);return {ok:false,error:'Unsupported voice asset'};};await client.cameraResult(1,()=>true,school);assert.deepEqual(requested,['school.m4a'],'Never call a school a camera when service is old');
 const cat=await require(A+'/hybrid-catalog').openCatalog(A);const found={};
 for(let i=0;i<cat.index.blocks.length&&Object.keys(found).length<3;i++)for(const c of cat.block(i)){const h=hazardKind(c);if(h){const id=c.typeNamespace+':'+c.typeCode;found[id]=c;assert(c.warningEnabled);}}
 assert(found['mapcam:22']&&found['mapcam:102']&&found['estrelka:200'],'All three real source categories decoded');
 for(const c of Object.values(found))assert(cat.nearWarnings(c).some(x=>x.id===c.id),'Old binary index cannot hide hazards');
 cat.close();
 for(const name of ['school','speed-bump'])for(const suffix of ['','-200']){
  const file=name+suffix+'.m4a',m=require('../native/bmwcaminfo-voice/audio-manifest.json')[file];assert(m&&m.durationSeconds>1);assert(fs.existsSync(path.resolve(__dirname,'../native/bmwcaminfo-voice/audio',file)));
 }
 console.log('PASS hazard defaults, independent banner/voice filters, forced-mode veto, repeats, priority, pass release, touch/joystick targets, source codes and offline audio assets');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
