'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm'),zlib=require('zlib');
const base=path.resolve(process.argv[2]||path.join(__dirname,'../apps/aurelm_speed_camera_warning'));
const font=require(path.join(base,'cluster-text')),spec=require(path.join(base,'cluster-font.json'));
const raw=zlib.inflateSync(Buffer.from(spec.alpha,'base64'));
const pixels=ch=>{const g=spec.glyphs[ch];return raw.slice(g[0],g[0]+g[1]*g[2]);};
for(const ch of 'ҢӨҮңөүІЎіўʼČŲŪŚŠŽŻĖŁĀĪĻŅÓĘĶĄŃ'){
 assert(font.hasGlyph(ch),'Missing Kyrgyz glyph '+ch);
 assert(pixels(ch).some(v=>v>0),'Empty glyph '+ch);
 assert(!pixels(ch).equals(pixels('?')),'Question-mark replacement '+ch);
}
let gpuFont;
const record={OP:{GLYPHS:1},pack:()=>0,atlasId:f=>{gpuFont=f;return 1;}};
const gpu=vm.runInNewContext(fs.readFileSync(path.join(base,'hud-canvas.js'),'utf8')+'\nmodule.exports',{
 Buffer,module:{exports:{}},require:n=>n==='./kit/record'?record:n==='zlib'?zlib:require(path.join(base,n))
});
for(const label of ['Токтогул көчөсү','Чүй проспекти','Жибек Жолу көчөсү','Тоң району','Үмүт көчөсү','Көчөсү № 1 (түндүк)',
 'вуліца Ўладзіміра','праспект Незалежнасці','Карʼерная вуліца','вуліца Дзямʼяна Беднага','ČŲŪŚŠŽŻĖŁĀĪĻŅÓĘĶĄŃ']){
 for(const ch of label.toUpperCase())assert(font.hasGlyph(ch),'Unsupported label character '+ch);
 const rgba=Buffer.alloc(512*72*4);
 font.draw(rgba,512,72,1,label,256,8,28,[255,255,255],{align:'center'});
 assert(rgba.some(v=>v),'PNG text is blank');
 const cv={n:0,atlases:new Set(),_grow(n){this.buffer=new ArrayBuffer(n*4);this.u=new Uint32Array(this.buffer);this.f=new Float32Array(this.buffer);}};
 gpu.text(cv,label,256,8,28,'#ffffff',{align:'center'});
 assert(cv.n>4,'GPU text is blank');
 for(const ch of label.toUpperCase())assert(gpuFont.glyphs[ch],'GPU fallback '+ch);
 assert(gpuFont.atlasH<=2048,'Keep font texture within existing GPU budget');
}
console.log('PASS: Kyrgyz and Belarusian road names, border labels, native glyph masks, PNG and GPU text, atlas bounds');
