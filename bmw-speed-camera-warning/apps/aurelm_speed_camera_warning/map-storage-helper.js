'use strict';
const net=require('net');
// Fixed operation on the existing local system-service socket; no file paths,
// owners or shell commands can be supplied by the application.
function prepare(share){return new Promise((resolve,reject)=>{
 const index=require('./hdd-mounts').SHARES.indexOf(share);if(index<0)return reject(Error('MAP_HDD_HELPER_PATH'));
 let done=false,buffer='';const socket=net.createConnection('/run/bmwcaminfo-voice/ctl.sock');
 const finish=(err,r)=>{if(done)return;done=true;clearTimeout(timer);socket.destroy();err?reject(err):resolve(r);};
 const timer=setTimeout(()=>finish(Error('MAP_HDD_HELPER_TIMEOUT')),5000);
 socket.setEncoding('utf8');socket.on('connect',()=>socket.write(JSON.stringify({action:'map-storage-prepare',share:index})+'\n'));
 socket.on('data',chunk=>{buffer+=chunk;if(buffer.length>8192)return finish(Error('MAP_HDD_HELPER_RESPONSE'));const n=buffer.indexOf('\n');if(n<0)return;try{const r=JSON.parse(buffer.slice(0,n));if(!r.ok)throw Error(/Unknown action/.test(r.error)?'MAP_HDD_HELPER_UPDATE':r.error||'MAP_HDD_HELPER_FAILED');if(r.mapStorageProtocol!==1||r.uid!==process.getuid())throw Error('MAP_HDD_HELPER_IDENTITY');finish(null,r);}catch(e){finish(e);}});
 socket.on('error',()=>finish(Error('MAP_HDD_HELPER_UNAVAILABLE')));socket.on('close',()=>{if(!done)finish(Error('MAP_HDD_HELPER_UNAVAILABLE'));});
});}
module.exports={prepare};
