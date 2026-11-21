'use strict';
// The browser emulator injects its SDK in-process; preserve that fixture.
if(process.env.SPEEDCAM_SUPERVISED_WORKER==='1'||process.env.SPEEDCAM_EMULATOR==='1'||process.platform==='win32'&&module.parent){
 require('./speedcam-main');
}else{
 const guard=new (require('./process-supervisor').Supervisor)(__filename);
 process.on('SIGTERM',()=>guard.stop());process.on('SIGINT',()=>guard.stop());
 guard.start();
}
