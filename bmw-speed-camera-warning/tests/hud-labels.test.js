'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const base=path.resolve(process.argv[2]||path.join(__dirname,'../apps/aurelm_speed_camera_warning'));
const {hudLabels}=require(path.join(base,'camera-label'));
const text=require(path.join(base,'cluster-text'));
const source=fs.readFileSync(path.join(base,'cluster-output.js'),'utf8');
const calls=[];
const {makeFrame:frame,DISTANCE_RECT,S}=vm.runInNewContext(source+'\n({makeFrame,DISTANCE_RECT,S});',{Buffer,module:{exports:{}},require:n=>
 n==='./cluster_render_client'?{ClusterRender:class{}}:n==='./cluster-text'?Object.assign({},text,{draw:(...args)=>{calls.push(args);return text.draw(...args);}}):require(path.join(base,n))});
async function run(){
 const cat=await require(path.join(base,'hybrid-catalog')).openCatalog(base);
 const samples={};
 for(let i=0;i<cat.index.blocks.length;i++)for(const c of cat.block(i)){
  if(c.typeNamespace==='estrelka'&&[192,68,194].includes(c.typeCode)&&c.camera_model&&!samples[c.typeCode])samples[c.typeCode]=c;
 }
 cat.close();
 for(const [code,label] of [[192,'СКОРОСТЬ'],[68,'СТОП-ЛИНИЯ'],[194,'КРАСНЫЙ СВЕТ']]){
  const c=samples[code];assert(c,'Real named sample for '+code);assert.strictEqual(hudLabels(c).control,label+(require(path.join(base,'mapcam-warnings')).hasRearControl(c)?' / В СПИНУ':''));
  for(const phase of ['point','section','rear']){
   calls.length=0;
   const px=frame({camera:c,type:'speeding',phase,distanceM:2000,useAverage:phase==='section',averageKmh:72});
   assert.strictEqual(px.length,840*232*4);
   assert.strictEqual(calls[0][4],hudLabels(c).control);assert.strictEqual(calls[1][4],hudLabels(c).model);
   const absoluteY=a=>a[6]+(a[2]===DISTANCE_RECT.h?DISTANCE_RECT.y/S:0);
   assert(absoluteY(calls[0])<absoluteY(calls[1])&&absoluteY(calls[1])<absoluteY(calls[2]),'Control, model, distance order, including partial-buffer origin');
   for(const a of calls){const s=text.fittedSize(a[4],a[7],a[9]&&a[9].maxWidth);assert(absoluteY(a)+text.capHeight(s)<116);for(const ch of a[4])assert(text.hasGlyph(ch),ch);}
   assert(calls.some(a=>/ПРЕВЫШЕНИЕ|СРЕДНЯЯ/.test(a[4])),'Preserve warning status');
  }
 }
 assert.strictEqual(hudLabels({typeNamespace:'mapcam',typeCode:3,camera_model:'СТРЕЛКА'}).control,'КРАСНЫЙ СВЕТ');
 assert.strictEqual(hudLabels({typeNamespace:'estrelka',typeCode:16}).control,'ПОЛОСА ОТ');
 assert.strictEqual(hudLabels({typeNamespace:'mapcam',typeCode:16}).control,'ОСТАНОВКА/СТОЯНКА');
 assert.strictEqual(hudLabels({camera_model:'СТРЕЛКА'}).control,'КАМЕРА','Do not infer function from model');
 assert.strictEqual(hudLabels({mapcamTypeCode:1}).model,'');
 assert.strictEqual(hudLabels({typeNamespace:'estrelka',typeCode:155,camera_model:'КОРДОН'}).control,'МУЛЯЖ');
 console.log('PASS: real database speed/stop-line/red-light records; separate control/model rows; three phases, glyphs, source namespaces, unknown model and dummy.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
