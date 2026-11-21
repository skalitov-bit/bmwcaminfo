'use strict';
// Execute the packaged client, replacing only OS socket discovery/transport.
const assert=require('assert'),fs=require('fs'),vm=require('vm'),path=require('path'),EventEmitter=require('events');
const root=path.resolve(process.argv[2]);
const code=fs.readFileSync(root+'/kit/renderd.js','utf8');
const shared='/run/mgu-renderd/renderd.sock',other='/run/mgu-render/render.sock';
function client(paths,env){
 const m={exports:{}},opened=[];
 vm.runInNewContext(code,{module:m,exports:m.exports,Buffer,Uint32Array,process:{env:env||{}},console,setTimeout,clearTimeout,setImmediate,
  require:p=>p==='fs'?{statSync:n=>({isSocket:()=>paths.indexOf(n)>=0})}:p==='net'?{createConnection:n=>{
   opened.push(n);const s=new EventEmitter();s.write=()=>true;s.destroy=()=>{};return s;
  }}:p==='./record'?require(root+'/kit/record'):require(p)});
 return {C:m.exports.RenderClient,opened};
}
for(const paths of [[shared],[shared,other]]){
 const t=client(paths);assert(t.C.available());
 const c=new t.C('test',{info(){}},{native:true});c.connect();
 assert.deepStrictEqual(t.opened,[shared]);c.close();
}
for(const paths of [[],[other]]){const t=client(paths);assert(!t.C.available(),'no shared service -> PNG discovery');}
const t=client(['/tmp/test-renderer'],{MGU_RENDERD_SOCKET:'/tmp/test-renderer'});
assert(t.C.available());const c=new t.C('test',{info(){}},{native:true});c.connect();
assert.deepStrictEqual(t.opened,['/tmp/test-renderer']);c.close();
console.log('PASS idrive7 socket selection: shared only, both services, absent/shared absent, explicit diagnostic override.');
