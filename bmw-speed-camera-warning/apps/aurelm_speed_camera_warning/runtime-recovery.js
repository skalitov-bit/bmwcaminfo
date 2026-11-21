'use strict';
// Sleep is not a crash. Rebind sources once after a long timer gap, and never
// revive a process that MainApp has deliberately shut down.
class RuntimeRecovery {
 constructor(options) {
  const o=options||{};this.now=o.now||Date.now;this.every=o.setInterval||setInterval;this.cancel=o.clearInterval||clearInterval;
  this.resume=o.resume||(()=>{});this.log=o.log||(()=>{});this.gapMs=o.gapMs||15000;
  this.timer=null;this.stopped=false;this.busy=false;this.last=this.now();this.lastRecovery=null;this.count=0;this.reason='ЗАПУСК';this.failed=false;
 }
 start(){if(this.timer!==null||this.stopped)return;this.last=this.now();this.timer=this.every(()=>this.tick(),2000);}
 tick(){const now=this.now(),gap=now-this.last;this.last=now;if(gap>this.gapMs||gap< -this.gapMs)return this.recover('ПАУЗА MGU');}
 recover(reason){
  const now=this.now();if(this.stopped||this.busy||this.lastRecovery!==null&&now>=this.lastRecovery&&now-this.lastRecovery<5000)return Promise.resolve(false);
  this.busy=true;this.lastRecovery=now;this.reason=reason;this.count++;this.failed=false;
  this.log('RUNTIME_RECOVERY '+reason+' count='+this.count);
  return Promise.resolve().then(()=>{if(!this.stopped)return this.resume(reason);}).then(()=>true,e=>{this.failed=true;this.log('RUNTIME_RECOVERY_ERROR '+String(e));return false;}).then(ok=>{this.busy=false;return ok;});
 }
 stop(){this.stopped=true;if(this.timer!==null)this.cancel(this.timer);this.timer=null;}
 label(){return 'ВОССТАНОВЛЕНИЕ: '+this.count+' / '+(this.failed?'ОШИБКА':this.busy?'ПОДКЛЮЧЕНИЕ':this.reason);}
}
module.exports={RuntimeRecovery};
