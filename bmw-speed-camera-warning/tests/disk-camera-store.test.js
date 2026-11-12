'use strict';
// Real HTTP streaming + published-format files. No MapCam/GitHub API is mocked as successful.
// Run this entire scenario in a separate process with --max-old-space-size=64.
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),http=require('http'),crypto=require('crypto');
const {Transform}=require('stream');
const base=process.argv[2]||path.join(__dirname,'../apps/aurelm_speed_camera_warning');
const {CameraStore,POINTER}=require(path.resolve(base,'disk-camera-store'));
const {MANIFEST,INDEX,RECORDS,readManifest,validateManifest,validateIndex}=require(path.resolve(base,'camera-catalog'));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-disk-test-')),manifest=readManifest(base);
// Exercise backward compatibility using a genuine legacy-only bundle.
const legacyBundle=path.join(tmp,'legacy-bundle');fs.mkdirSync(legacyBundle);
for(const file of [MANIFEST,INDEX,RECORDS])fs.copyFileSync(path.join(base,file),path.join(legacyBundle,file));
let served=JSON.parse(JSON.stringify(manifest)),fault='',requests=[],stores=[],port,peak=0;
function memory(stage){const rss=process.memoryUsage().rss/1048576;peak=Math.max(peak,rss);console.log(stage+' RSS MiB='+rss.toFixed(2));}
const server=http.createServer((req,res)=>{
    const name=path.basename(req.url);requests.push(name);
    if(fault==='offline'){res.writeHead(503);res.end();return;}
    if(name===MANIFEST){res.end(JSON.stringify(served));return;}
    if([INDEX,RECORDS].indexOf(name)<0){res.writeHead(404);res.end();return;}
    const file=path.join(base,name);
    if(fault==='truncated'&&name===RECORDS){res.setHeader('Content-Length',served.records.bytes);res.write(Buffer.alloc(1024));setTimeout(()=>res.destroy(),10);return;}
    if(fault==='bad-index'&&name===INDEX){res.end('{"schemaVersion":999}');return;}
    if(fault==='oversize'&&name===INDEX){res.setHeader('Content-Length',served.index.bytes+1);res.end();return;}
    const stream=fs.createReadStream(file,{highWaterMark:32768});res.on('close',()=>stream.destroy());
    if(fault==='hash'&&name===RECORDS){let first=true;stream.pipe(new Transform({transform(b,e,cb){if(first){b[0]^=1;first=false;}cb(null,b);}})).pipe(res);}
    else stream.pipe(res);
});
const request=(options,cb)=>http.get({hostname:'127.0.0.1',port,path:options.path},cb);
function store(dir){const s=new CameraStore({dataDir:dir,bundledDir:legacyBundle,request,log:m=>{if(m.indexOf('rssMiB')>=0)memory(m);}});stores.push(s);return s;}
async function run(){
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));port=server.address().port;
    const s=store(tmp);await s.loadLocal();assert.strictEqual(s.current.cities.russia.length,manifest.count);
    assert.strictEqual(s.current.recordsFor('mari-el').length,manifest.cityCounts['mari-el']);assert.strictEqual(s.current.recordsFor('yoshkar-ola').length,manifest.cityCounts['yoshkar-ola']);
    const nearby=s.current.near({lat:55.75,lon:37.62},25000,500);assert(nearby.length>0&&nearby.length<=500);
    assert(s.current.cache.size<=512&&s.current.cacheBytes<=2*1048576);memory('cold + nearby map');
    let r=await s.refresh();assert(!r.updated&&!r.error,JSON.stringify(r.error));assert.deepStrictEqual(requests,[MANIFEST]);
    assert(!fs.existsSync(path.join(tmp,POINTER)),'Same revision must not create duplicate cache');
    served.revision++;requests=[];
    const pair=await Promise.all([s.refresh(),s.refresh()]);r=pair[0];assert(r.updated&&!r.error,JSON.stringify(r.error));
    assert.strictEqual(pair[0],pair[1]);assert.deepStrictEqual(requests,[MANIFEST,INDEX,RECORDS]);
    assert.strictEqual(s.current.revision,served.revision);assert(s.current.near({lat:55.75,lon:37.62},2100).length>0);
    memory('first successful streamed update');
    const pointer=fs.readFileSync(path.join(tmp,POINTER),'utf8');const savedRevision=s.current.revision;
    s.close();const warm=store(tmp);await warm.loadLocal();assert.strictEqual(warm.source,'cache');assert.strictEqual(warm.current.revision,savedRevision);
    requests=[];r=await warm.refresh();assert(!r.updated&&!r.error);assert.deepStrictEqual(requests,[MANIFEST]);
    for(const failure of ['offline','truncated','hash','oversize','bad-index']){
        fault=failure;served=JSON.parse(JSON.stringify(manifest));served.revision=savedRevision+1;
        if(fault==='bad-index'){const raw=Buffer.from('{"schemaVersion":999}');served.index.bytes=raw.length;served.index.sha256=crypto.createHash('sha256').update(raw).digest('hex');}
        r=await warm.refresh();assert(r.error,failure+' must fail');assert.strictEqual(warm.current.revision,savedRevision);
        assert.strictEqual(fs.readFileSync(path.join(tmp,POINTER),'utf8'),pointer);assert(warm.current.near({lat:55.75,lon:37.62},2100).length>0);
        assert(!fs.existsSync(path.join(tmp,'camera-catalog-staging')),failure+' staging must be cleaned');
        console.log('PASS preserve active database on '+failure+': '+r.error);
    }
    fault='';served=JSON.parse(JSON.stringify(manifest));served.revision=savedRevision-1;r=await warm.refresh();assert.strictEqual(r.error,'CAMERA_DB_OLDER_REVISION');
    served.revision=savedRevision;served.contentHash='0'.repeat(64);r=await warm.refresh();assert.strictEqual(r.error,'CAMERA_DB_REVISION_CONFLICT');
    served=JSON.parse(JSON.stringify(manifest));served.revision=savedRevision+1;
    const rename=fs.renameSync;fs.renameSync=(a,b)=>{if(b===path.join(tmp,POINTER))throw new Error('SIMULATED_POINTER_WRITE_FAILURE');return rename(a,b);};
    try{r=await warm.refresh();assert.strictEqual(r.error,'SIMULATED_POINTER_WRITE_FAILURE');}finally{fs.renameSync=rename;}
    assert.strictEqual(warm.current.revision,savedRevision);assert.strictEqual(fs.readFileSync(path.join(tmp,POINTER),'utf8'),pointer);
    r=await warm.refresh();assert(r.updated&&!r.error,r.error);memory('second successful update after failed activation');
    // Complete cached index corruption must fall back to the bundle, not crash startup.
    const corruptDir=warm.current.dir;warm.close();fs.writeFileSync(path.join(corruptDir,INDEX),'{}');
    const fallback=store(tmp);await fallback.loadLocal();assert.strictEqual(fallback.source,'bundle');
    // An old huge JSON cache is deliberately never parsed by the new runtime.
    const oldPath=path.join(tmp,'camera-db-cache.json');const fd=fs.openSync(oldPath,'w');fs.ftruncateSync(fd,55729232);fs.closeSync(fd);
    fallback.close();const read=fs.readFileSync;fs.readFileSync=function(p,...args){assert(!/camera-db(?:-cache)?\.json$/.test(String(p)),'Legacy full JSON must never be loaded');return read.call(fs,p,...args);};
    try{const legacy=store(tmp);await legacy.loadLocal();assert.strictEqual(legacy.current.cities.russia.length,manifest.count);legacy.close();}finally{fs.readFileSync=read;}
    assert.throws(()=>validateManifest(Object.assign({},manifest,{count:1})),/INVALID/);
    assert.throws(()=>validateManifest(Object.assign({},manifest,{records:Object.assign({},manifest.records,{file:'../settings.json'})})),/INVALID/);
    const idx=JSON.parse(fs.readFileSync(path.join(base,INDEX),'utf8'));idx.records[0][0]=10;assert.throws(()=>validateIndex(idx,manifest),/INVALID/);
    memory('complete');assert(process.resourceUsage().maxRSS/1024<256,'Database-only test exceeded 256 MiB RSS');console.log('PASS disk store: cold/warm/unchanged/update/rollback/hash/partial/atomic recovery; Node '+process.version+' '+process.arch+'; peak observed RSS MiB='+Math.max(peak,process.resourceUsage().maxRSS/1024).toFixed(2));
}
run().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{stores.forEach(s=>s.close());server.close();fs.rmSync(tmp,{recursive:true,force:true});});
