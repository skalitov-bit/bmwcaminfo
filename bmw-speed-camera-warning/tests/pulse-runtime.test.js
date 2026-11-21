'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os'),EventEmitter=require('events');
const {PulseRuntime}=require('../native/bmwcaminfo-voice/pulse-runtime');
const ROOT=path.join(__dirname,'../native/bmwcaminfo-voice');
async function run(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pulse-process-')),calls=[],children=[];
 const options={root:ROOT,platform:'linux',arch:'x64',pulseRunDir:dir,pulseExec(bin,args,opts,cb){calls.push({bin,args,opts});assert(!opts.shell);assert(opts.env.LD_LIBRARY_PATH.indexOf(path.join(ROOT,'pulse','lib'))===0);setImmediate(()=>cb(null,args[0]==='--version'?path.basename(bin)+' 5.0':'0\tspeedcam_overlay\tmodule-alsa-sink.c\ts16le 1ch 24000Hz\tIDLE\n',''));},pulseSpawn(bin,args,opts){const p=new EventEmitter();p.stdin=new EventEmitter();p.stderr=new EventEmitter();p.kill=sig=>{p.killed=sig;setImmediate(()=>p.emit('close',null,sig));};p.stdin.write=(b,cb)=>setImmediate(()=>cb());p.stdin.end=()=>setImmediate(()=>p.emit('close',0,null));children.push({p,bin,args,opts});return p;}};
 // Windows paths are not valid Linux PA configuration. Exercise the lifecycle
 // with a controlled POSIX socket while retaining real private temp files.
 const runtime=new PulseRuntime(options); // start's path validation is tested separately; run this test on Linux only
 // for full filesystem/socket launch construction. On Windows exercise actual
 // child/stdin/error/drain/termination handlers without inventing a Linux path.
 try{
  const checked=await runtime.check();assert(checked.available&&!checked.hardwareTested);
  runtime.socket='/run/bmwcaminfo-voice/pulse-test/native';runtime.server=runtime.child('pulseaudio',['--version']);
  runtime.streams=[runtime.child('pacat',[]),runtime.child('pacat',[])];
  await runtime.writePair(Buffer.alloc(960),Buffer.alloc(960));await runtime.drain();assert(runtime.stats.drained);
  await Promise.all([runtime.close(),runtime.close()]);assert.equal(children[0].p.killed,'SIGTERM');assert(!children[1].p.killed);assert(runtime.children.every(c=>c.done));
  const bad=new PulseRuntime(Object.assign({},options,{pulseExec(bin,args,o,cb){cb(Error('loader failed'),'','libasound.so.2 missing');}}));let error;try{await bad.check();}catch(e){error=e;}assert(error.message.includes('libasound.so.2'));assert.equal(bad.children.length,0);
  const broken=new PulseRuntime(options);broken.streams=[broken.child('pacat',[]),broken.child('pacat',[])];broken.streams[0].p.emit('close',1,null);assert.throws(()=>broken.assert(),/exited/);await broken.close();
  console.log('PASS PulseAudio child lifecycle: dependency rejection, two pipes, successful drain, unexpected exit, owned-PID termination and idempotent cleanup. Child processes mocked; no BMW audio claim.');
 }finally{fs.rmdirSync(dir);}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
