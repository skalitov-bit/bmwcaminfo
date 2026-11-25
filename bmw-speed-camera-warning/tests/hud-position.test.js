'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const EventEmitter=require('events');
const base=path.resolve(process.argv[2]||path.join(__dirname,'../apps/aurelm_speed_camera_warning'));
const {normalize,HudPositionStore,HudPositionEditor}=require(path.join(base,'hud-position'));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'speedcam-hud-'));
try{
 const store=new HudPositionStore(dir);assert.deepStrictEqual(store.load(),{x:190,y:182,stripe:true,banner:'full'});
 assert.deepStrictEqual(normalize({x:-200,y:1000}),{x:0,y:364,stripe:true,banner:'full'});
 assert.deepStrictEqual(normalize({x:NaN,y:'50'}),{x:190,y:182,stripe:true,banner:'full'});
 store.save({x:215,y:162,stripe:true,banner:'full'});assert.deepStrictEqual(new HudPositionStore(dir).load(),{x:215,y:162,stripe:true,banner:'full'});
 // Old saved positions retain the visible stripe; explicit false survives reload.
 fs.writeFileSync(store.file,JSON.stringify({schema:1,hud:{x:215,y:162}}));assert.equal(store.load().stripe,true);
 let apply=null,moving=false,shows=0,changes=0,now=0;
 const client=new EventEmitter();client.ready=true;client.targets='map:1088x480,hud:800x480';
 const output={mode:'both',gpsStatus:'lost',cr:client,layers:{hud:'hud-card'},current:null,
 setMode(mode){this.mode=mode;this.current=null;},setGpsStatus(s){this.gpsStatus=s;},clear(){this.current=null;},setHudPosition(p){this.position=p;},show(e){this.current=e;shows++;}};
 const editor=new HudPositionEditor({store,output,now:()=>now,change:()=>changes++,apply:p=>apply=p,moving:()=>moving,back:()=>editor.stop()});
 editor.open();editor.move(5,-5);assert.deepStrictEqual(store.load(),{x:215,y:162,stripe:true,banner:'full'},'Draft must not overwrite persistent preferences');
 editor.test();assert.strictEqual(output.mode,'hud');assert.strictEqual(shows,1);assert.strictEqual(output.current.camera.id,'hud-position-test');
 editor.move(5,0);assert.deepStrictEqual(output.position,{x:225,y:157,stripe:true,banner:'full'});
 moving=true;editor.tick();assert.strictEqual(output.mode,'both');editor.test();assert.strictEqual(shows,1,'Moving vehicle cannot start the test');
 moving=false;editor.save();assert.deepStrictEqual(apply,{x:225,y:157,stripe:true,banner:'full'});assert.deepStrictEqual(store.load(),apply);
 editor.reset();assert.deepStrictEqual(editor.draft,{x:190,y:182,stripe:true,banner:'full'});editor.stop();editor.open();assert.deepStrictEqual(editor.draft,apply,'Back discards an unsaved reset');
 editor.reset();editor.save();assert.deepStrictEqual(store.load(),{x:190,y:182,stripe:true,banner:'full'});
 editor.test();editor.stop();assert.strictEqual(output.mode,'both','Leaving restores the normal output mode');assert.equal(output.gpsStatus,'lost');assert.deepStrictEqual(output.position,store.load());

 // Ready, refusal, timeout and cancellation all release the single production client.
 editor.open();client.ready=false;const before=shows;editor.test();assert(editor.busy);assert.equal(shows,before);
 now+=3501;editor.tick();assert(!editor.busy);assert(editor.message.includes('НЕ ОТВЕТИЛ'));assert.equal(output.mode,'both');
 editor.test();client.ready=true;client.emit('ready');assert.equal(shows,before+1);assert.equal(output.mode,'hud');
 client.emit('refused','layer','hud-card','no slot');assert(!editor.busy);assert(editor.message.includes('no slot'));assert.equal(output.mode,'both');
 editor.test();client.emit('target','hud','blocked','','BMW lock',false,true);assert(editor.message.includes('BMW lock'));assert(!editor.busy);
 editor.test();client.emit('disconnected');assert(editor.message.includes('СВЯЗЬ'));assert(!editor.busy);
 editor.test();now+=45001;editor.tick();assert(editor.message.includes('ЗАВЕРШЁН'));assert.equal(output.mode,'both');
 client.ready=false;editor.test();editor.stop();client.ready=true;const cancelled=shows;client.emit('ready');assert.equal(shows,cancelled);
 assert.equal(client.listenerCount('ready'),0);assert.equal(client.listenerCount('refused'),0);
 client.targets='map:1088x480';editor.open();editor.test();assert(editor.message.includes('НЕ ОБЪЯВИЛ'));assert(!editor.busy);
 client.targets='hud:800x480';output.mode='off';editor.test();editor.stop();assert.equal(output.mode,'off','Disabled production output is restored too');
 editor.open();const toggle=editor.buttons().find(b=>b.key==='hud-stripe');assert(toggle);
 editor.tap(toggle.x+5,toggle.y+5);assert.equal(editor.draft.stripe,false);editor.move(5,0);assert.equal(editor.draft.stripe,false);
 editor.test();assert.equal(output.position.stripe,false);editor.toggleStripe();assert.equal(output.position.stripe,true);editor.toggleStripe();
 editor.save();editor.stop();editor.open();assert.equal(editor.draft.stripe,false);assert.equal(new HudPositionStore(dir).load().stripe,false);
 editor.toggleStripe();editor.stop();editor.open();assert.equal(editor.draft.stripe,false,'Unsaved stripe change is discarded');editor.reset();assert.equal(editor.draft.stripe,true);
 fs.writeFileSync(store.file,'broken');assert.deepStrictEqual(store.load(),{x:190,y:182,stripe:true,banner:'full'});
 const save=store.save;store.save=()=>{throw Error('disk full');};editor.save();assert(editor.message.includes('ОШИБКА'));store.save=save;
 console.log('PASS HUD position: clamping, corrupt config, atomic overwrite, reopen persistence, draft/save/reset, save failure, live test movement and stop');
}finally{for(const f of fs.readdirSync(dir))fs.unlinkSync(path.join(dir,f));fs.rmdirSync(dir);}
