'use strict';
const assert=require('assert'),path=require('path'),fs=require('fs'),Module=require('module');
const after=path.resolve(process.argv[2]),before=path.resolve(process.argv[3]);
function load(base,name){return require(path.join(base,name));}
function transport(base){
 const c=new (load(base,'cluster_render_client').ClusterRender)('test');
 c.ready=c.connected=true;c.sock={write:b=>{c.messages.push(b);return true;}};c.messages=[];
 return c;
}
const old=transport(before),now=transport(after);
function both(fn){const a=fn(old),b=fn(now);assert.deepStrictEqual(a,b);assert.equal(old.messages.length,now.messages.length);old.messages.forEach((m,i)=>assert(m.equals(now.messages[i]),'Binary frame protocol remains identical at message '+i));}
both(c=>c.image({target:'hud',iw:64,ih:40,w:64,h:40}));
const full=Buffer.alloc(64*40*4);for(let i=0;i<full.length;i++)full[i]=(i*19)%251;
both(c=>c.pixels(1,null,full));
const first=Buffer.from(now.messages[now.messages.length-1]);
both(c=>c.pixels(1,[{x:3,y:4,w:8,h:6}],Buffer.alloc(8*6*4,147)));
assert(now.messages[now.messages.length-2].equals(first),'Queued packet owns its bytes');
both(c=>{c.blocked=true;return c.pixels(1,[{x:5,y:7,w:20,h:10}],Buffer.alloc(20*10*4,28));});
both(c=>c.pixels(1,[{x:11,y:12,w:5,h:9}],Buffer.alloc(5*9*4,56)));
both(c=>{c.blocked=false;c._pump();});
both(c=>{c.layers.get(1).whole=true;c._pump();});
// Simulate the real write(false)/drain contract: newest dirty image stays pending.
for(const c of [old,now])c.sock.write=b=>{c.messages.push(b);return false;};
both(c=>c.pixels(1,[{x:0,y:0,w:2,h:2}],Buffer.alloc(16,201)));
both(c=>c.pixels(1,[{x:0,y:0,w:2,h:2}],Buffer.alloc(16,202)));
for(const c of [old,now])c.sock.write=b=>{c.messages.push(b);return true;};
both(c=>{c.blocked=false;c._pump();});

const {PackedCells}=load(after,'packed-cells'),cells=Object.create(null);
for(let i=0;i<600;i++){const y=(i*37)%3601-1800,x=(i*71)%7201-3600;cells[y+':'+x]=[i,i,600-i];}
cells['-9999:9999']=[999];cells['0:0']=[0,3,8];cells['00:0']=[777];
const packed=new PackedCells(cells);
for(const key of Object.keys(cells)){
 const p=key.split(':').map(Number),s=new Set();packed.addTo(s,p[0],p[1]);
 assert.deepStrictEqual(Array.from(s),Array.from(new Set(cells[p[0]+':'+p[1]]||[])));
}
for(const p of [[90,90],[10000,0],[0,-10000]]){const s=new Set();packed.addTo(s,p[0],p[1]);assert.equal(s.size,0);}
// Compare native raster playback, including alpha edges and labels, against the
// prior release drawing code. Cached backgrounds must not alter any pixels.
const {Canvas}=load(after,'kit/canvas'),record=load(after,'kit/record');
function styleAt(base){const m=new Module(path.join(after,'screen-style-fixture.js'));m.filename=path.join(after,'screen-style-fixture.js');m.paths=Module._nodeModulePaths(after);m._compile(fs.readFileSync(path.join(base,'screen-style.js'),'utf8'),m.filename);return m.exports;}
const baseline=styleAt(before),optimized=styleAt(after);
function raster(style,draw){const r=new record.Recorder(1600,520);r.clear('#19232a');draw(style,r);const cv=new Canvas(1600,520);record.play(r.words(),cv);return {data:Buffer.from(cv.d),words:r.words().length};}
let comparisons=0,oldWords=0,newWords=0;
for(const active of ['MAP','RADAR','ADD','MY','SETTINGS']){
 const a=raster(baseline,(s,c)=>s.drawNav(c,active)),b=raster(optimized,(s,c)=>s.drawNav(c,active));
 assert(a.data.equals(b.data),'Navigation pixel identity '+active);comparisons++;oldWords+=a.words;newWords+=b.words;
}
for(const dims of [[266,80,1270,40],[0,0,728,87],[300,140,295,104],[100.5,20.5,222,99]])for(const overlay of [false,true]){
 const a=raster(baseline,(s,c)=>s.drawSelection(c,...dims,overlay)),b=raster(optimized,(s,c)=>s.drawSelection(c,...dims,overlay));
 assert(a.data.equals(b.data),'Selection pixel identity '+dims+' '+overlay);comparisons++;
}
assert(newWords<oldWords/4,'Cached navigation drastically reduces command count');
console.log(JSON.stringify({binaryFrames:'identical',socketBackpressure:'preserved',packedCells:'equivalent',pixelComparisons:comparisons,navWordsBefore:oldWords,navWordsAfter:newWords}));

