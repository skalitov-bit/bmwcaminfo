'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const base=path.resolve(process.argv[2]||path.join(__dirname,'../apps/aurelm_speed_camera_warning'));
const api=vm.runInNewContext(fs.readFileSync(path.join(base,'cluster-output.js'),'utf8')+'\n({hudGeometry,makeFrame,HUD_LAYOUT,DISTANCE_RECT,S});',{Buffer,module:{exports:{}},require:n=>require(path.join(base,n))});
const text=require(path.join(base,'cluster-text'));
for(const distanceM of [0,1,8,9,10,11,88,99,100,111,888,999,1000,10000,99999,100000,999999]){
 const e={distanceM,camera:{mapcamTypeCode:1,camera_model:'СТРЕЛКА',limit:60},type:'camera'},g=api.hudGeometry(e);
 assert(Math.abs(g.titleCenter-Math.round(g.stripeWidth)/2)<=0.25,'Title axis matches the displayed stripe centre for every distance');
 const w=api.HUD_LAYOUT.textWidth;
 assert.strictEqual(JSON.stringify(g),JSON.stringify(api.hudGeometry({distanceM:300})),"Geometry is fixed for all digit counts");
 assert.equal(g.signX,331-47,'Approved 47px shift is constant');
 assert.equal(g.stripeWidth,352,'Approved compact stripe stays fixed');
 assert.equal((g.signX-32)-(108+w),8,'Keep a clear gap beside the fixed text slot');
 assert(Math.abs(g.stripeWidth/2-(108+w/2))<1e-8,'Stripe is centred on the distance label');
 assert(g.distanceRect.x/api.S+g.distanceRect.w/api.S<g.signX-32,'Distance patch never clears sign');
 assert(g.textWidth+108<g.signX-32,'Titles never intersect sign');
 for(const limit of [null,30,60,120])assert.strictEqual(api.makeFrame({...e,camera:{...e.camera,limit}}).length,840*232*4);
}
// Long model/type labels and all digit counts must leave both icon areas intact.
const crop=(px,x,y,w,h)=>{const rows=[];for(let yy=y*api.S;yy<(y+h)*api.S;yy++)rows.push(px.slice((yy*840+x*api.S)*4,(yy*840+(x+w)*api.S)*4));return Buffer.concat(rows);};
for(const limit of [30,60,120,null]){
 const camera={mapcamTypeCode:1,camera_model:'СТРЕЛКА',limit};
 const reference=api.makeFrame({camera,distanceM:300,type:'camera'});
 for(const distanceM of [0,9,999,1000,99999,999999])for(const model of ['', 'АВТОУРАГАН-ВСМ2', 'МОДЕЛЬ С ПРЕДЕЛЬНО ДЛИННЫМ НАЗВАНИЕМ КОМПЛЕКСА']){
  const event={camera:{...camera,camera_model:model,rearCapture:true},distanceM,type:'camera',accuracyDegraded:true};
  const pixels=api.makeFrame(event);
  assert(crop(pixels,25,34,60,50).equals(crop(reference,25,34,60,50)),'Camera pixels stay at the same location');
  assert(crop(pixels,251,27,66,65).equals(crop(reference,251,27,66,65)),'Limit/unknown-limit pixels are untouched by long text');
 }
}
const labels=require(path.join(base,'camera-label')).hudLabels;
assert(labels({mapcamTypeCode:1,rearCapture:true}).control.endsWith(' / В СПИНУ'));
assert(!labels({mapcamTypeCode:1,rearCapture:false}).control.includes('В СПИНУ'));
assert(!labels({typeNamespace:'estrelka',typeCode:155,rearCapture:true}).control.includes('В СПИНУ'));

console.log('PASS compact HUD: approved 47px shift, fixed icons/stripe across labels and digit counts, safe partial bounds, rear label, known/unknown limits');
