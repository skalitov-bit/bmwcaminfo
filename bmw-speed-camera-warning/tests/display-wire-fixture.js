'use strict';
// Use the packaged Display AND RenderClient. Only the Unix socket/vehicle is fake.
const fs=require('fs'),vm=require('vm'),EventEmitter=require('events');
function make(root,ui,options){
 const opts=options||{};
 class Clock extends Date{static now(){return opts.now?opts.now():Date.now();}}
 const later=opts.setTimeout||setTimeout;
 const packets=[],timers=[];let socket;
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(root+'/kit/renderd.js','utf8'),{
  module,exports:module.exports,Buffer,Uint32Array,process,console,setImmediate,Date:Clock,
  setTimeout:later,clearTimeout,setInterval:fn=>{timers.push(fn);return {unref(){}};},clearInterval(){},
  require:p=>p==='net'?{createConnection(){socket=new EventEmitter();socket.write=b=>{packets.push(Buffer.from(b));return true;};socket.destroy=()=>socket.emit('close');return socket;}}:p==='./record'?require(root+'/kit/record'):require(p)
 });
 const dm={exports:{}};
 vm.runInNewContext(fs.readFileSync(root+'/kit/display.js','utf8'),{
  module:dm,exports:dm.exports,Buffer,Uint32Array,process,console,Date:Clock,setTimeout:later,clearTimeout,
  setInterval:fn=>{timers.push(fn);return {unref(){}};},clearInterval(){},
  require:p=>p==='./renderd'?module.exports:require(root+'/kit/'+p)
 });
 const d=Object.create(dm.exports.Display.prototype);
 Object.assign(d,{ui,spec:{id:'wire-test',responsiveMain:true,nativeHeader:true},screen:{name:'MAIN',buttons:[]},
  settings:{get:()=> 'full'},theme:()=>({bg:'#000000'}),log:{info(){},warn(){},error(e){throw e;}},
  recorders:new Map(),tickHandlers:[],layoutHandlers:[],ownHidden:new Set(),labels:{},barOff:0,
  frames:0,statT:Date.now(),_hmiBar(){}});
 d._startGpu();socket.emit('connect');
 function packet(type,p){const h=Buffer.alloc(8);h.writeUInt32LE(type,0);h.writeUInt32LE(p.length,4);socket.emit('data',Buffer.concat([h,p]));}
 function words(type,values){const p=Buffer.alloc(values.length*4);values.forEach((v,i)=>p.writeUInt32LE(v,i*4));packet(type,p);}
 function ready(caps=7,modes=1){words(0x4d520101,[1,modes,caps]);words(101,[4,1920,720,caps&1?1:0]);words(0x4d520102,[1,1,1]);}
 function touch(phase,x,y){const p=Buffer.alloc(12);p.writeUInt32LE(phase,0);p.writeFloatLE(x,4);p.writeFloatLE(y,8);packet(105,p);}
 function ccu(knob,press=0,tilt=0){const p=Buffer.alloc(5);p.writeUInt16BE(knob,1);p[3]=press;p[4]=tilt;packet(0x4d520103,p);}
 return {d,packets,timers,ready,touch,ccu,words,reconnect(){d.gpu.connect();socket.emit('connect');},tap(x,y){touch(1,x,y);touch(3,x,y);},ack(){words(102,[1,1]);}};
}
module.exports={make};
