'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const base=path.resolve(process.argv[2]||path.join(__dirname,'../apps/aurelm_speed_camera_warning'));
const api=vm.runInNewContext(fs.readFileSync(path.join(base,'cluster-output.js'),'utf8')+'\n({hudGeometry,makeFrame,HUD_LAYOUT,DISTANCE_RECT,S});',{Buffer,module:{exports:{}},require:n=>require(path.join(base,n))});
const text=require(path.join(base,'cluster-text'));
for(const distanceM of [0,1,8,9,10,11,88,99,100,111,888,999,1000,10000]){
 const e={distanceM,camera:{mapcamTypeCode:1,camera_model:'СТРЕЛКА',limit:60},type:'camera'},g=api.hudGeometry(e);
 assert(Math.abs(g.titleCenter-Math.round(g.stripeWidth)/2)<=0.25,'Title axis matches the displayed stripe centre for every distance');
 const w=api.HUD_LAYOUT.textWidth;
 assert.strictEqual(JSON.stringify(g),JSON.stringify(api.hudGeometry({distanceM:300})),"Geometry is fixed for all digit counts");
 assert(Math.abs((g.signX-32)-(108+w)-(108-(25+60)))<1e-8,'Equal camera/number and metre/sign gaps');
 assert(Math.abs(g.stripeWidth/2-(108+w/2))<1e-8,'Stripe is centred on the distance label');
 assert(g.distanceRect.x/api.S+g.distanceRect.w/api.S<g.signX-32,'Distance patch never clears sign');
 assert(g.textWidth+108<g.signX-32,'Titles never intersect sign');
 for(const limit of [null,30,60,120])assert.strictEqual(api.makeFrame({...e,camera:{...e.camera,limit}}).length,840*232*4);
}
const labels=require(path.join(base,'camera-label')).hudLabels;
assert(labels({mapcamTypeCode:1,rearCapture:true}).control.endsWith(' / В СПИНУ'));
assert(!labels({mapcamTypeCode:1,rearCapture:false}).control.includes('В СПИНУ'));
assert(!labels({typeNamespace:'estrelka',typeCode:155,rearCapture:true}).control.includes('В СПИНУ'));

console.log('PASS HUD spacing: fixed sign and stripe across all distances, early rear-control label, equal slot gaps, safe title and distance bounds, tabular digits, known/unknown limits');
