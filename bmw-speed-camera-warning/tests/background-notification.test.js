'use strict';
const assert=require('assert'),path=require('path');
const app=path.resolve(process.argv[2]||path.join(__dirname,'../apps/aurelm_speed_camera_warning'));
const {NotificationPolicy}=require(path.join(app,'notification-policy'));
const {BackgroundNotification}=require(path.join(app,'background-notification'));
const settings={},policy=new NotificationPolicy(k=>settings[k],false);
assert(policy.monitoring());assert.strictEqual(policy.destination(),'system');
policy.view='RADAR';assert.strictEqual(policy.destination(),'system','Remembered Radar must not suppress a hidden app');
policy.setVisible(true);assert.strictEqual(policy.destination(),'none');
settings.radar_no_duplicate='off';assert.strictEqual(policy.destination(),'canvas');
settings.central_notifications='off';assert.strictEqual(policy.destination(),'none');
settings.central_notifications='foreground';policy.setVisible(false);assert.strictEqual(policy.destination(),'none');
settings.auto_monitor='off';
const afterRestart=new NotificationPolicy(k=>settings[k],false);
assert(!afterRestart.monitoring(),'Manual control must wait after process restart');
afterRestart.setVisible(true);afterRestart.setVisible(false);assert(afterRestart.monitoring(),'Manual opening starts monitoring for this process session');
settings.auto_monitor='on';assert(new NotificationPolicy(k=>settings[k],false).monitoring());
function event(id){return {camera:{id,limit:60},distanceM:300,type:'speeding',speedKmh:85};}
async function run(){
 let now=10000,calls=[],logs=[];
 const transport={available:true,paint:async e=>{calls.push('paint:'+e.camera.id);},open:async()=>{calls.push('open');},close:async()=>{calls.push('close');}};
 const output=new BackgroundNotification(transport,s=>logs.push(s),()=>now);
 output.update(event('a'),85);await output.pending;
 assert.deepStrictEqual(calls,['paint:a','open']);assert.strictEqual(output.status,'requested','API return is not proof of visibility');
 transport.onVisible(true);assert.strictEqual(output.status,'visible');
 for(let i=0;i<10;i++){now+=10;output.update(event('a'),85);await output.pending;}
 assert.strictEqual(calls.filter(x=>x==='paint:a').length,1,'Rate-limit frame uploads');
 now+=750;output.update(event('a'),85);await output.pending;assert.strictEqual(calls.filter(x=>x==='open').length,1,'Updates must not reopen popup');
 transport.onVisible(false);now+=750;output.update(event('a'),85);await output.pending;
 assert.strictEqual(calls.filter(x=>x==='open').length,1,'Respect user dismissal for this encounter');
 output.clear();await output.pending;output.update(event('b'),85);await output.pending;
 assert.strictEqual(calls.filter(x=>x==='open').length,2,'Next encounter opens normally');
 now+=3600;output.update(event('b'),85);await output.pending;assert.strictEqual(calls[calls.length-1],'close','Transient popup has a bounded lifetime');
 now+=1000;output.update(event('b'),85);await output.pending;assert.strictEqual(calls.filter(x=>x==='open').length,2);
 // A late completion may never leave an alert shown after disable/GPS loss.
 let resolveOpen;const slow=Object.assign({},transport,{open:()=>new Promise(r=>{calls.push('slow-open');resolveOpen=r;})});
 const late=new BackgroundNotification(slow,()=>{},()=>now);late.update(event('c'),85);
 await new Promise(r=>setImmediate(r));late.clear();resolveOpen();await late.pending;
 assert.strictEqual(calls[calls.length-1],'close');assert(!late.opened);
 slow.onVisible(true);await late.pending;
 assert(!late.opened,'A delayed visible event after cancellation is closed too');
 // Errors stay local and retries are bounded; other warning outputs stay alive.
 let attempts=0;
 const failed=new BackgroundNotification({available:true,paint:async()=>{attempts++;throw new Error('HMI offline');}},()=>{},()=>now);
 failed.update(event('d'),85);await failed.pending;
 for(let i=0;i<20;i++){failed.update(event('d'),85);await failed.pending;}
 assert.strictEqual(attempts,1);assert.strictEqual(failed.status,'error');
 now+=5000;failed.update(event('d'),85);await failed.pending;assert.strictEqual(attempts,2);
 const absent=new BackgroundNotification({available:false},()=>{},()=>now);absent.update(event('x'),85);assert.strictEqual(absent.status,'unavailable');
 console.log('Background notification policy, throttling, dismissal, expiry, late completion and failure tests passed. RHMI hardware not tested.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
