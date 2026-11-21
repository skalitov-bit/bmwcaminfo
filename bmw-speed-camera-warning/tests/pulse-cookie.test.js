'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os'),vm=require('vm'),EventEmitter=require('events');
const source=fs.readFileSync(path.join(__dirname,'../native/bmwcaminfo-voice/pulse-runtime.js'),'utf8');
const bundle=path.join(__dirname,'../native/bmwcaminfo-voice/pulse');
// Run unchanged runtime code with POSIX paths mapped to real private temp files.
// Only the child processes and filesystem path translation are simulated.
async function trial(failure){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'pulse-cookie-')),writes=[],children=[],commands=[];
 let cookieBytes=null,virtualDir=null;
 function local(p){if(p.indexOf('/bundle/pulse/')===0)return path.join(bundle,p.slice('/bundle/pulse/'.length));assert(p.indexOf('/run/speedcam/')===0,p);return path.join(temp,p.slice('/run/speedcam/'.length));}
 const disk=Object.create(fs);
 disk.mkdtempSync=p=>{const real=fs.mkdtempSync(local(p));virtualDir='/run/speedcam/'+path.basename(real);return virtualDir;};
 disk.chmodSync=(p,mode)=>{assert.equal(mode,0o700);fs.chmodSync(local(p),mode);};
 disk.writeFileSync=(p,b,o)=>{writes.push({p,mode:o.mode,flag:o.flag});assert.equal(o.mode,0o600);if(/\/cookie$/.test(p)){assert.equal(o.flag,'wx');if(failure==='cookie')throw Error('cookie EACCES');cookieBytes=Buffer.from(b);assert.equal(b.length,256);}return fs.writeFileSync(local(p),b,o);};
 ['existsSync','readdirSync','lstatSync','unlinkSync','rmdirSync'].forEach(k=>disk[k]=p=>fs[k](local(p)));
 const mod={exports:{}};
 vm.runInNewContext('(function(require,module,exports){'+source+'\n})',{Buffer,process,setTimeout,clearTimeout})(name=>name==='fs'?disk:name==='path'?path.posix:require(name),mod,mod.exports);
 function checkAuth(opts){
  assert(cookieBytes,'cookie must exist before any non-version command');
  assert.equal(opts.env.PULSE_COOKIE,virtualDir+'/cookie');assert.equal(fs.readFileSync(local(opts.env.PULSE_COOKIE)).compare(cookieBytes),0);
  assert(fs.readFileSync(local(opts.env.PULSE_CLIENTCONFIG),'utf8').includes('cookie-file = '+opts.env.PULSE_COOKIE+'\n'));
  assert.equal(opts.env.PULSE_SERVER,'unix:'+virtualDir+'/native');
 }
 const r=new mod.exports.PulseRuntime({root:'/bundle',platform:'linux',arch:'x64',pulseRunDir:'/run/speedcam',
  pulseExec(bin,args,opts,cb){commands.push({bin,args});if(args[0]==='--version')return cb(null,path.posix.basename(bin)+' 5.0','');checkAuth(opts);cb(null,'0\tspeedcam_overlay\tmodule-alsa-sink.c\ts16le 1ch 24000Hz\tIDLE\n','');},
  pulseSpawn(bin,args,opts){
   checkAuth(opts);const p=new EventEmitter();p.stdin=new EventEmitter();p.stderr=new EventEmitter();p.kill=sig=>setImmediate(()=>p.emit('close',null,sig));
   p.stdin.write=(b,cb)=>setImmediate(cb);p.stdin.end=()=>setImmediate(()=>p.emit('close',0,null));children.push({bin,args,p});
   if(bin.endsWith('/pulseaudio')){
    const cfg=fs.readFileSync(local(virtualDir+'/private.pa'),'utf8');
    assert(cfg.includes('auth-cookie='+virtualDir+'/cookie'));assert(cfg.includes('auth-anonymous=0 auth-cookie-enabled=1'));
    assert(!cfg.includes('/root'));assert(args.includes('--system=no'));assert(args.includes('--daemonize=no'));
   }
   return p;
  }
 });
 try{
  if(failure==='cookie'){let error;try{await r.start(()=>true);}catch(e){error=e;}assert(error&&/EACCES/.test(error.message));assert.equal(children.length,0);assert.equal(r.stats.stage,'private-cookie');}
  else{
   await r.start(()=>true);assert.equal(children.length,3);assert.equal(r.stats.stage,'streams-started');assert.equal(r.stats.authentication,'private-cookie');
   assert.equal(commands.filter(c=>c.args[0]!=='--version').length,1);
   await r.writePair(Buffer.alloc(960),Buffer.alloc(960));
   if(failure==='client'){children[1].p.emit('close',1,null);assert.throws(()=>r.assert(),/exited/);}
   else{await r.drain();assert(r.stats.drained);}
   const report=JSON.stringify(r.stats);assert(!report.includes(cookieBytes.toString('hex')));assert(!report.includes(cookieBytes.toString('base64')));
   if(process.platform!=='win32'){assert.equal(fs.statSync(local(virtualDir)).mode&0o777,0o700);assert.equal(fs.statSync(local(virtualDir+'/cookie')).mode&0o777,0o600);}
  }
  await Promise.all([r.close(),r.close()]);assert.deepEqual(fs.readdirSync(temp),[],'owned directory and cookie removed');
  assert(r.children.every(c=>c.done));return cookieBytes;
 }finally{await r.close();fs.rmdirSync(temp);}
}
(async()=>{
 const a=await trial(),b=await trial();assert(!a.equals(b),'new random cookie for each session');await trial('cookie');await trial('client');
 console.log('PASS private PulseAudio cookie: full start with real config/cookie files, 256 random bytes, shared server/client authentication, permissions, two streams/drain, distinct sessions, write/child failures and cleanup. POSIX paths and processes simulated; no real MGU playback claimed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
