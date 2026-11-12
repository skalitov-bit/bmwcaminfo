'use strict';
const assert=require('assert'),path=require('path'),fs=require('fs'),vm=require('vm');
const {createRequire}=require('module');
const base=path.resolve(process.argv[2]||'work/sidebar-graphite-preview'),req=createRequire(path.join(base,'app.js'));
const {policeKind}=req('./point-kind'),{MapcamWarnings}=req('./mapcam-warnings');
const {hudLabels}=req('./camera-label'),{cameraVoiceFile,CameraVoiceAlerts}=req('./voice-alert');
const {Canvas}=req('./kit/canvas'),record=req('./kit/record');
const cluster=vm.runInNewContext(fs.readFileSync(path.join(base,'cluster-output.js'),'utf8')+'\n({makeFrame,shouldBlink});',{require:req,module:{exports:{}},Buffer});
const calls=[];
const draw=vm.runInNewContext(fs.readFileSync(path.join(base,'central-alert.js'),'utf8')+'\ndrawCentralAlert;',{
 require:n=>n==='./hud-canvas'?{text:(...args)=>{calls.push(args.slice(1));return req(n).text(...args);}}:req(n),module:{exports:{}},Buffer
});
async function run(){
 const cat=await req('./hybrid-catalog').openCatalog(base),posts=[],counts={post:0,stationary:0};let zeroWarningBlocks=0;
 for(let i=0;i<cat.index.blocks.length;i++)for(const c of cat.block(i))if(policeKind(c)){
  counts[policeKind(c)]++;posts.push(c);assert(c.warningEnabled);
  if(cat.index.blocks[i].warnings===0)zeroWarningBlocks++;
 }
 assert.strictEqual(posts.length,987);assert(zeroWarningBlocks>0);
 // Exhaustively verify that old index warning counts cannot hide a police post.
 for(const c of posts)assert(cat.nearWarnings(c).some(p=>p.id===c.id),'Missing post '+c.id);
 assert.strictEqual(policeKind({typeNamespace:'estrelka',typeCode:20}),null);
 assert.strictEqual(policeKind({typeNamespace:'mapcam',typeCode:206}),null);
 assert.strictEqual(policeKind({camera_model:'Пост ДПС',typeCode:192,typeNamespace:'estrelka'}),null);
 const dir=path.resolve('outputs/SpeedCAM_DPS');fs.mkdirSync(dir,{recursive:true});
 const voice=new CameraVoiceAlerts({});voice._request=()=>{throw new Error('DPS must not speak the generic camera phrase');};
 for(const kind of ['post','stationary']){
  const source=posts.find(c=>policeKind(c)===kind),c={...source,limit:20};
  const heading=Number.isFinite(c.mapcamApproachHeadingDeg)?c.mapcamApproachHeadingDeg:0,a=heading*Math.PI/180;
  const fix=(d,t)=>({lat:c.lat-Math.cos(a)*d/111320,lon:c.lon-Math.sin(a)*d/(111320*Math.cos(c.lat*Math.PI/180)),speedKmh:100,accuracyM:5,timeMs:t});
  const detector=new MapcamWarnings({distanceM:2000});detector.update(fix(320,1000),[c],1000);
  const events=detector.update(fix(300,2000),[c],2000),e=events.find(e=>e.type==='camera');
  assert(e,'Approaching DPS must notify');assert(!events.some(e=>e.type==='speeding'));assert(!detector.states[c.id].speeding);
  assert.strictEqual(cluster.shouldBlink({...e,type:'speeding',speedKmh:100}),false);
  assert.strictEqual(cameraVoiceFile(1,c),null);assert((await voice.cameraResult(1,()=>true,c)).visualOnly);
  assert.deepStrictEqual(hudLabels(c),{control:'ПОСТ ДПС',model:kind==='stationary'?'СТАЦИОНАРНЫЙ':''});
  calls.length=0;const cv=new record.Recorder(1600,520);
  draw(cv,e,100,undefined,0);
  const title=calls.find(x=>x[0]==='ПОСТ ДПС');assert.deepStrictEqual(title.slice(1,4),[266,99,30],'Keep banner text coordinates');
  assert(!calls.some(x=>/ЛИМИТ|ОГРАНИЧЕНИЕ|ПРЕВЫШЕНИЕ/.test(x[0])));
  const banner=record.play(cv.words(),new Canvas(1600,520).clear('#000000'));
  fs.writeFileSync(path.join(dir,kind+'-banner.png'),banner.png());
  const raw=cluster.makeFrame(e),card=new Canvas(1680,464).clear('#000000');card.blit({w:1680,h:464,d:raw},0,0);
  fs.writeFileSync(path.join(dir,kind+'-hud-kombi.png'),card.png());
  // Any synthetic speed limit must leave the speed-sign area transparent for police.
  for(let y=30*4;y<90*4;y++)for(let x=325*4;x<389*4;x++)assert.strictEqual(raw[(y*1680+x)*4+3],0);
  const ordinary=cluster.makeFrame({...e,camera:{type:'Камера',limit:60}});assert(!ordinary.equals(raw));
 }
 cat.close();console.log(JSON.stringify({counts,zeroWarningBlocks,allPostsReachable:true,approachAndNoOverspeed:true,textPositionsPreserved:true,nativeBannerAndHudRendered:true}));
}
run().catch(e=>{console.error(e);process.exitCode=1;});
