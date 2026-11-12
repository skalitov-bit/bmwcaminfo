'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const {createRequire}=require('module');
const base=path.resolve(process.argv[2]||path.join(__dirname,'../apps/aurelm_speed_camera_warning'));
const req=createRequire(path.join(base,'cluster-output.js'));
const {category,hudLabels}=req('./camera-label');
const textRenderer=req('./cluster-text');
const source=fs.readFileSync(path.join(base,'cluster-output.js'),'utf8');
const frame=vm.runInNewContext(source+'\n({makeFrame});',{
 require:n=>n==='./cluster_render_client'?{ClusterRender:class{}}:req(n),module:{exports:{}},Buffer
});
const bannerSource=fs.readFileSync(path.join(base,'central-alert.js'),'utf8');
const texts=[];
const drawBanner=vm.runInNewContext(bannerSource+'\ndrawCentralAlert;',{
 Buffer,module:{exports:{}},require:n=>n==='./hud-canvas'?{text:(_cv,value)=>texts.push(String(value))}:n==='./point-kind'?{...req(n),iconFor:()=>({drawCanvas:()=>{}})}:n==='./camera-icon'?{drawCanvas:()=>{}}:req(n)
});
async function run(){
const types=new Map();let count=0;
const catalog=await req('./hybrid-catalog').openCatalog(base);
for(let i=0;i<catalog.index.blocks.length;i++)for(const c of catalog.block(i)){
 count++;types.set(c.typeNamespace+':'+c.typeCode,c);
}
catalog.close();assert(types.size>=13);
for(const c of [...types.values(),{camera_model:'СТРЕЛКА',camera_family:'fixed',type:'Камера'},{camera_model:'КОРДОН',camera_family:'dummy',type:'Муляж'},{camera_model:'HIKVISION',camera_family:'fixed',type:'Камера'},{type:'Скорость + светофор'},{type:'Камера с Ёжом XYZ'},{}, {type:' '.repeat(80)}, {type:'Я'.repeat(200)}]){
 const label=category(c);assert(label.full.length<=48);assert(label.short.length<=17);
 for(const char of label.short)assert(textRenderer.hasGlyph(char), 'Missing glyph: '+char);
 const size=textRenderer.fittedSize(label.short,19,207);assert(textRenderer.width(label.short,size)<=207.001,'Header overlaps limit sign');
 for(const phase of ['point','section','rear']){
  const e={camera:c,distanceM:500,speedKmh:72,type:'speeding',speeding:true,phase,useAverage:phase==='section',averageKmh:72};
  const pixels=frame.makeFrame(e);assert.strictEqual(pixels.length,1680*464*4);
  texts.length=0;const cv=new Proxy({}, {get:(_,key)=>key==='recording'?true:()=>cv});
  drawBanner(cv,e,null,{x:282,y:92,w:1282});
  assert(texts.includes(hudLabels(c).control),'Control type must appear in the actual alert banner');
  if(hudLabels(c).model)assert(texts.includes(hudLabels(c).model),'Model must appear separately');
  assert(!texts.includes('КАМЕРА ВПЕРЕДИ'),'Generic title must not replace type');
  assert(texts.some(s=>s.startsWith(phase==='section'?'ДО КОНЦА ':phase==='rear'?'ЗА КАМЕРОЙ ':'ЧЕРЕЗ ')),'Preserve phase/distance');
 }
}
assert.strictEqual(category({type:'Скорость + светофор'}).full,'Скорость + светофор');
assert.strictEqual(category({}).short,'КАМЕРА');
// The font is self-contained and every string is rendered in uppercase.
const lower=Buffer.alloc(840*232*4),upper=Buffer.alloc(lower.length);
textRenderer.draw(lower,840,232,2,'Красный свет',10,10,19,[255,255,255,255]);
textRenderer.draw(upper,840,232,2,'КРАСНЫЙ СВЕТ',10,10,19,[255,255,255,255]);
assert(lower.equals(upper),'Mixed case input must render identically to uppercase');
assert(lower.some((value,i)=>i%4===3&&value>0&&value<255),'Smooth anti-aliased contours');
assert.strictEqual(lower[lower.length-1],0,'Background outside text stays transparent');
// More than two-digit limits and long distances must remain within their own area.
for(const value of ['20','60','110','250'])assert(textRenderer.width(value,textRenderer.fittedSize(value,32,44))<=44.001);
assert(textRenderer.width('2000 М',textRenderer.fittedSize('2000 М',40,207))<=207.001);
console.log('Notification types passed: '+count+' real records, '+types.size+' source categories, 3 phases, Cyrillic glyph coverage, header bounds and fallbacks.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
