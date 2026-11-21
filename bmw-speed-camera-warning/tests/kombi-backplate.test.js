'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const base=path.resolve(process.argv[2]||path.join(__dirname,'../apps/aurelm_speed_camera_warning'));
const backing=require(path.join(base,'kombi-backplate'));
const p=backing.makePixels(),at=(x,y)=>Array.from(p.slice((Math.floor(y*2)*backing.IW+Math.floor(x*2))*4,(Math.floor(y*2)*backing.IW+Math.floor(x*2))*4+4));
assert.strictEqual(p.length,920*268*4);
assert.strictEqual(at(0,0)[3],0);assert.strictEqual(at(230,60)[3],166,'35% transparent background (65% opacity)');
assert.deepStrictEqual(at(230,8),[211,44,54,255],'Red top');
assert(at(230,125)[0]<10,'No red bottom border');
assert(at(230,126.5)[0]<10,'No antialias red fringe at the open bottom edge');
assert.strictEqual(at(230,130)[3],0,'Agreed reduced height');
assert.strictEqual(at(20,60)[3],0,'Agreed reduced width');
assert.strictEqual(at(59,60)[3],166,'Side is translucent background without a red border');
assert(at(59,60)[0]<40,'No red accent on the side');
assert(at(120,8)[0]<at(140,8)[0]&&at(140,8)[0]<at(230,8)[0],'Upper accent fades towards the shoulder');
assert(at(110,9.5)[0]<40&&at(230,9.5)[0]>200,'Upper accent narrows at its ends');
assert.strictEqual(at(40,60)[3],0,'Upper shoulders are inset');
assert(at(45,120)[3]>0,'Backing widens towards the bottom');
for(const dims of [[1088,480],[1280,480],[1440,540]]){
 const pos=backing.layout('map:'+dims[0]+'x'+dims[1]+',hud:800x480');
 assert.strictEqual(pos.x+pos.w/2,dims[0]/2);assert.strictEqual(pos.y+pos.h,dims[1]);assert(pos.reported);
 assert(pos.contentX>=pos.x&&pos.contentY>=pos.y);
}
assert(!backing.layout('').reported);
let id=0;
class Render{
 constructor(){this.ready=true;this.targets='map:1088x480,hud:800x480';this.items={};this.uploads=[];this.events={};}
 on(k,fn){this.events[k]=fn;}connect(){}close(){}
 image(o){this.items[++id]={opts:Object.assign({},o),px:Buffer.alloc(o.iw*o.ih*4)};return id;}
 set(ref,o){Object.assign(this.items[ref].opts,o);}
 pixels(ref,rects,px){const item=this.items[ref];this.uploads.push({ref,partial:!!rects});
  if(!rects){assert.strictEqual(item.px.length,px.length);px.copy(item.px);return;}
  let off=0;rects.forEach(r=>{for(let y=0;y<r.h;y++){px.copy(item.px,((r.y+y)*item.opts.iw+r.x)*4,off,off+r.w*4);off+=r.w*4;}});
 }
}
const api=vm.runInNewContext(fs.readFileSync(path.join(base,'cluster-output.js'),'utf8')+'\n({CameraClusterOutput,makeFrame});',{
 Buffer,module:{exports:{}},require:n=>n==='./cluster_render_client'?{ClusterRender:Render}:require(path.join(base,n)),
 setTimeout:()=>1,clearTimeout:()=>{},setInterval:()=>2,clearInterval:()=>{}
});
const o=new api.CameraClusterOutput({mode:'both'});
const e={camera:{id:'camera',limit:60,camera_model:'СТРЕЛКА'},distanceM:1000,type:'speeding',speedKmh:90};
o.show(e);
const bg=o.backplate,snapshot=Buffer.from(o.cr.items[bg].px);
assert.strictEqual(Object.keys(o.cr.items).length,5);assert(bg<o.layers.map,'Backing is created before information');
assert(o.cr.items[bg].opts.visible);
for(let distance=999;distance>=0;distance--)o.updateDistance(distance,false);
assert.strictEqual(o.cr.uploads.filter(x=>x.ref===bg).length,1,'One static background upload, not 1000');
assert(o.cr.items[bg].px.equals(snapshot),'Distance erasure never changes the backing');
assert(o.cr.items[o.layers.hud].px.equals(api.makeFrame(Object.assign({},e,{distanceM:0}))),'HUD frame is unchanged');
const expected=api.makeFrame(Object.assign({},e,{distanceM:0}),true);
assert(o.cr.items[o.layers.map].px.equals(expected),'Centred KOMBI partial updates equal complete rendering');
o.cr.targets='map:1280x540,hud:800x480';o.cr.events.ready();
assert.strictEqual(o.cr.items[bg].opts.x,410);assert.strictEqual(o.cr.items[bg].opts.y,406);
assert.strictEqual(o.cr.items[o.layers.map].opts.x,430);assert.strictEqual(o.cr.items[o.layers.map].opts.y,415);
assert.strictEqual(Object.keys(o.cr.items).length,5,'No duplicate layers after reconnect');
o.clear();assert(!o.cr.items[bg].opts.visible);
o.setGpsStatus('lost');assert(o.cr.items[bg].opts.visible,'GPS status uses same backing');
o.setGpsStatus('');assert(!o.cr.items[bg].opts.visible);
o.setMode('hud');o.show(e);assert.strictEqual(o.backplate,null,'No backing on HUD');
o.close();
console.log('PASS: 35% transparent backing, tapered fading upper accent only, open bottom, centred target bounds, unchanged HUD/information, 1000 partial updates without backing upload, resize/reconnect/GPS/mode cleanup.');
