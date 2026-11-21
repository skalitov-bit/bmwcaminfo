'use strict';
const assert=require('assert'),path=require('path'),{EventEmitter}=require('events'),{PassThrough,Writable}=require('stream');
const {AlsaDiagnostics}=require('../native/bmwcaminfo-voice/alsa-diagnostics');
function fakeOutput(fail,converter){
 const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.bytes=0;child.nonzero=false;let dead=false,writes=0;
 child.kill=()=>{if(!dead){dead=true;process.nextTick(()=>child.emit('close',null,'SIGTERM'));}};
 child.stdin=new Writable({write(b,enc,cb){child.bytes+=b.length;child.nonzero=child.nonzero||b.some(x=>x!==0);writes++;if(fail&&writes===3)return cb(Error('simulated broken ALSA pipe'));cb();}});
 child.stdin.on('finish',()=>{if(dead)return;child.stdout.write(JSON.stringify(Object.assign({streamCompleted:true,framesWritten:child.bytes/(converter?2:4),pendingFrames:0,xruns:0},converter?{rate:24000,channels:1,device:'plug:smartx:Media_Overlay_Converter_Source_CF_24_MONO'}:{})));process.nextTick(()=>child.emit('close',0,null));});
 return child;
}
async function run(){
 let output;
 const d=new AlsaDiagnostics({}, {root:path.resolve(__dirname,'../native/bmwcaminfo-voice'),spawn:()=>output=fakeOutput(false)});
 let result=await d.stream('both',()=>true);
 assert.equal(result.framesWritten,384000);assert.equal(output.bytes,48000*2*2*8);assert(output.nonzero);assert.equal(d.child,null);
 d.spawn=(bin,args)=>{assert.deepStrictEqual(args,['--play-converter']);return output=fakeOutput(false,true);};
 result=await d.stream('both',()=>true,'converter');
 assert.equal(result.framesWritten,192000);assert.equal(output.bytes,24000*2*8);assert(output.nonzero);assert.equal(d.child,null);
 assert.equal(d.s.audioBufferHistory.lastProbe.backend,'converter');assert.equal(d.s.audioBufferHistory.lastProbe.overlay,false);assert.equal(d.s.audioBufferHistory.lastProbe.origin,'probe');
 let checks=0;d.spawn=()=>fakeOutput(false);
 await assert.rejects(d.stream('beeper',()=>++checks<6),/cancelled/);assert.equal(d.child,null);
 d.spawn=()=>fakeOutput(true);await assert.rejects(d.stream('voice',()=>true),/broken ALSA pipe/);assert.equal(d.child,null);
 console.log('PASS ALSA streaming: 8 s mixed 48 kHz stereo, writable backpressure callbacks, disconnect/cancel and broken-pipe termination. Native process mocked.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
