'use strict';
const fs=require('fs'),path=require('path'),https=require('https'),url=require('url');
const {ensureDirectory}=require('./camera-store');
const {openCatalog,readManifest,validateManifest,MANIFEST,INDEX,RECORDS}=require('./camera-catalog');
const BASE_URL='https://raw.githubusercontent.com/skalitov-bit/bmwcaminfo/main/bmw-speed-camera-warning/data/';
const POINTER='camera-catalog-active.json';
const {CHANNEL_URL,validateChannel}=require('./database-channel');
function allowedUrl(parsed){
    if(parsed.protocol!=='https:'||parsed.auth||(parsed.port&&parsed.port!=='443'))return false;
    if(parsed.hostname==='raw.githubusercontent.com')return true;
    if(parsed.hostname==='github.com')return /^\/skalitov-bit\/speedcam-db\/releases\/(?:latest\/download\/channel\.json|download\/db-[0-9]+-[a-f0-9]{12}\/(?:channel\.json|hybrid-index-v1\.bin|hybrid-records-v1\.bin))$/.test(parsed.pathname);
    return parsed.hostname==='release-assets.githubusercontent.com'&&parsed.pathname.startsWith('/github-production-release-asset/');
}
function fetchResource(requestUrl,destination,maxBytes,request,redirects){
    return new Promise((resolve,reject)=>{
        const parsed=url.parse(requestUrl);
        if(!allowedUrl(parsed)){reject(new Error('CAMERA_DB_URL_NOT_ALLOWED'));return;}
        let settled=false,response=null,output=null,ended=false,bytes=0,chunks=[],timer;
        function fail(error){
            if(settled)return;settled=true;clearTimeout(timer);
            if(response)response.destroy();req.destroy();
            if(output){output.once('close',()=>reject(error));output.destroy();}else reject(error);
        }
        const req=request({protocol:parsed.protocol,hostname:parsed.hostname,path:parsed.path,headers:{'User-Agent':'BMWCamInfo/0.9.3','Accept':'application/octet-stream'}},res=>{
            response=res;
            if([301,302,303,307,308].indexOf(res.statusCode)>=0){
                res.resume();settled=true;clearTimeout(timer);
                if(!res.headers.location||redirects>=3){reject(new Error('CAMERA_DB_REDIRECT_LIMIT'));return;}
                fetchResource(url.resolve(requestUrl,res.headers.location),destination,maxBytes,request,redirects+1).then(resolve,reject);return;
            }
            if(res.statusCode!==200){res.resume();fail(new Error('CAMERA_DB_HTTP_'+res.statusCode));return;}
            const length=Number(res.headers['content-length']);
            if(Number.isFinite(length)&&length>maxBytes){fail(new Error('CAMERA_DB_TOO_LARGE'));return;}
            if(destination){
                output=fs.createWriteStream(destination,{flags:'wx',highWaterMark:65536});
                output.on('error',fail);
                output.on('close',()=>{if(!settled&&ended){settled=true;clearTimeout(timer);resolve(bytes);}});
            }
            res.on('error',fail);res.on('aborted',()=>fail(new Error('CAMERA_DB_DOWNLOAD_ABORTED')));
            res.on('close',()=>{if(!ended&&!settled)fail(new Error('CAMERA_DB_DOWNLOAD_INTERRUPTED'));});
            res.on('data',chunk=>{
                bytes+=chunk.length;
                if(bytes>maxBytes){fail(new Error('CAMERA_DB_TOO_LARGE'));return;}
                if(!destination)chunks.push(chunk);
            });
            res.on('end',()=>{
                ended=true;
                if(!destination&&!settled){settled=true;clearTimeout(timer);resolve(Buffer.concat(chunks).toString('utf8'));chunks=[];}
            });
            if(output)res.pipe(output);
        });
        req.on('error',fail);req.setTimeout(15000,()=>fail(new Error('CAMERA_DB_TIMEOUT')));
        timer=setTimeout(()=>fail(new Error('CAMERA_DB_TOTAL_TIMEOUT')),300000);
    });
}
function generation(m){return (m.datasetId==='hybrid-rus-v1'?'hybrid-catalog-':'camera-catalog-')+m.revision+'-'+m.records.sha256.slice(0,20)+'-'+m.index.sha256.slice(0,20);}
function removeCatalog(dir){
    // Only fixed files in our own generation directories; never user cameras/settings.
    [MANIFEST,INDEX,RECORDS,'hybrid-manifest-v1.json','hybrid-index-v1.bin','hybrid-records-v1.bin'].forEach(f=>{try{fs.unlinkSync(path.join(dir,f));}catch(e){if(e.code!=='ENOENT')throw e;}});
    try{fs.rmdirSync(dir);}catch(e){if(e.code!=='ENOENT')throw e;}
}
class CameraStore{
    constructor(options){
        const o=options||{};this.dataDir=o.dataDir||process.cwd();this.bundledDir=o.bundledDir||__dirname;
        this.request=o.request||https.get;this.log=o.log||function(){};this.current=null;this.source='bundle';this.inFlight=null;
        this.hybrid=fs.existsSync(path.join(this.bundledDir,'hybrid-manifest-v1.json'));
        this.codec=require(this.hybrid?'./hybrid-catalog':'./camera-catalog');
        this.pointer=this.hybrid?'hybrid-catalog-active.json':POINTER;
        this.prefix=this.hybrid?'hybrid-catalog-':'camera-catalog-';
    }
    memory(stage){const m=process.memoryUsage();this.log('CAMERA_DB '+stage+' rssMiB='+Math.round(m.rss/1048576)+' heapMiB='+Math.round(m.heapUsed/1048576));}
    async loadLocal(){
        const {readManifest,openCatalog}=this.codec;
        const bundled=readManifest(this.bundledDir);let cachedDir=null,cached=null;
        try{
            const pointerPath=path.join(this.dataDir,this.pointer);if(fs.statSync(pointerPath).size>4096)throw new Error('CAMERA_DB_POINTER_SIZE');
            const p=JSON.parse(fs.readFileSync(pointerPath,'utf8'));
            if(!p||!new RegExp('^'+this.prefix+'[0-9]{1,16}-[a-f0-9]{20}-[a-f0-9]{20}$').test(p.directory))throw new Error('CAMERA_DB_POINTER');
            cachedDir=path.join(this.dataDir,p.directory);cached=readManifest(cachedDir);
            if(generation(cached)!==p.directory||cached.revision<bundled.revision||
                (cached.revision===bundled.revision&&cached.contentHash!==bundled.contentHash))cached=null;
        }catch(e){cached=null;}
        if(cached){try{this.current=await openCatalog(cachedDir,cached);this.source='cache';}catch(e){this.log('CAMERA_DB cache rejected: '+e.message);}}
        if(!this.current){this.current=await openCatalog(this.bundledDir,bundled);this.source='bundle';}
        this.memory('ready '+this.source);
        this.cleanup();return {database:this.current,source:this.source};
    }
    cleanup(){
        try{fs.readdirSync(this.dataDir).filter(n=>new RegExp('^'+this.prefix+'[0-9]{1,16}-[a-f0-9]{20}-[a-f0-9]{20}$').test(n)||n===this.prefix+'staging').forEach(n=>{
            const dir=path.join(this.dataDir,n);if(this.current&&dir!==this.current.dir)removeCatalog(dir);
        });}catch(e){this.log('CAMERA_DB cleanup: '+e.message);}
    }
    refresh(onStatus){
        if(this.inFlight)return this.inFlight;
        this.inFlight=this.doRefresh(onStatus).then(r=>{this.inFlight=null;return r;},e=>{this.inFlight=null;throw e;});return this.inFlight;
    }
    async doRefresh(onStatus){
        const {validateManifest,openCatalog,MANIFEST}=this.codec;
        const status=typeof onStatus==='function'?onStatus:function(){};let next=null,staging=null;
        try{
            if(!this.current)throw new Error('CAMERA_DB_NOT_LOADED');
            status('Проверка версии базы...');this.memory('manifest');
            const channel=this.hybrid?validateChannel(JSON.parse(await fetchResource(CHANNEL_URL,null,32768,this.request,0))):null;
            const m=channel?channel.manifest:validateManifest(JSON.parse(await fetchResource(BASE_URL+MANIFEST,null,16384,this.request,0)));
            if(m.revision<this.current.revision)throw new Error('CAMERA_DB_OLDER_REVISION');
            if(m.revision===this.current.revision){
                if(m.contentHash!==this.current.contentHash)throw new Error('CAMERA_DB_REVISION_CONFLICT');
                return {updated:false,database:this.current,source:this.source};
            }
            ensureDirectory(this.dataDir);this.cleanup();staging=path.join(this.dataDir,this.prefix+'staging');ensureDirectory(staging);
            for(const key of ['index','records']){
                status(key==='index'?'Загрузка индекса...':'Загрузка базы на диск...');
                await fetchResource(channel?channel.files[key]:BASE_URL+m[key].file,path.join(staging,m[key].file),m[key].bytes,this.request,0);
                this.memory(key+' downloaded');
            }
            fs.writeFileSync(path.join(staging,MANIFEST),JSON.stringify(m),'utf8');
            status('Проверка базы...');next=await openCatalog(staging,m);
            const target=path.join(this.dataDir,generation(m));next.close();next=null;
            // On Windows a live file handle prevents directory rename.
            fs.renameSync(staging,target);staging=null;
            next=await openCatalog(target,m);
            const pointer=path.join(this.dataDir,this.pointer),tmp=pointer+'.tmp';
            fs.writeFileSync(tmp,JSON.stringify({directory:path.basename(target)}),'utf8');
            const fd=fs.openSync(tmp,'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
            fs.renameSync(tmp,pointer);
            const old=this.current;this.current=next;next=null;this.source='download';old.close();
            this.cleanup();this.memory('activated');
            return {updated:true,database:this.current,source:this.source};
        }catch(e){
            if(next)next.close();if(staging){try{removeCatalog(staging);}catch(_) {}}
            this.log('CAMERA_DB update failed: '+(e.message||e));this.memory('update failed');
            return {updated:false,database:this.current,source:this.source,error:e.message||String(e)};
        }
    }
    close(){if(this.current)this.current.close();}
}
module.exports={CameraStore,fetchResource,BASE_URL,POINTER};
