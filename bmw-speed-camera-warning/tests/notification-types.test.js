'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const {createRequire}=require('module');
const base=path.resolve(process.argv[2]||path.join(__dirname,'../apps/aurelm_speed_camera_warning'));
const req=createRequire(path.join(base,'cluster-output.js'));
const {category}=req('./camera-label');
const textRenderer=req('./cluster-text');
const source=fs.readFileSync(path.join(base,'cluster-output.js'),'utf8');
const frame=vm.runInNewContext(source+'\n({makeFrame});',{
 require:n=>n==='./cluster_render_client'?{ClusterRender:class{}}:req(n),module:{exports:{}},Buffer
});
const main=fs.readFileSync(path.join(base,fs.existsSync(path.join(base,'main.js'))?'main.js':'app.js'),'utf8');
const banner=main.slice(main.indexOf(' function drawAlertBanner(cv){'),main.indexOf('function displayModeLabel'));
const C=vm.runInNewContext('('+main.match(/const C=(\{[^;]+\});/)[1]+')');
const types=new Map();let count=0;
for(const line of fs.readFileSync(path.join(base,'camera-records-v1.jsonl'),'utf8').trim().split('\n')){
 const c=JSON.parse(line);count++;assert.strictEqual(category(c).full,c.type,'Preserve real MapCam category');types.set(c.mapcamTypeCode,c);
}
assert.strictEqual(types.size,13);
for(const c of [...types.values(),{camera_model:'СТРЕЛКА',camera_family:'fixed',type:'Камера'},{camera_model:'КОРДОН',camera_family:'dummy',type:'Муляж'},{camera_model:'HIKVISION',camera_family:'fixed',type:'Камера'},{type:'Скорость + светофор'},{type:'Камера с Ёжом XYZ'},{}, {type:' '.repeat(80)}, {type:'Я'.repeat(200)}]){
 const label=category(c);assert(label.full.length<=48);assert(label.short.length<=17);
 for(const char of label.short)assert(textRenderer.hasGlyph(char), 'Missing glyph: '+char);
 const size=textRenderer.fittedSize(label.short,19,207);assert(textRenderer.width(label.short,size)<=207.001,'Header overlaps limit sign');
 for(const phase of ['point','section','rear']){
  const e={camera:c,distanceM:500,speedKmh:72,type:'speeding',speeding:true,phase,useAverage:phase==='section',averageKmh:72};
  const pixels=frame.makeFrame(e);assert.strictEqual(pixels.length,1680*464*4);
  const texts=[];const cv=new Proxy({}, {get:()=>()=>cv});
  vm.runInNewContext(banner+'\ndrawAlertBanner(cv);',{category,cv,C,activeAlert:e,alertUntil:Date.now()+60000,fix:null,txt:(canvas,text)=>texts.push(String(text))});
  assert(texts.includes(label.full.toUpperCase()),'Type must appear in the actual alert banner');
  assert(!texts.includes('КАМЕРА ВПЕРЕДИ'),'Generic title must not replace type');
  assert(texts.some(s=>s.startsWith(phase==='section'?'До конца ':phase==='rear'?'За камерой ':'Через ')),'Preserve phase/distance');
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
console.log('Notification types passed: '+count+' real records, 13 categories, 3 phases, Cyrillic glyph coverage, header bounds and fallbacks.');
