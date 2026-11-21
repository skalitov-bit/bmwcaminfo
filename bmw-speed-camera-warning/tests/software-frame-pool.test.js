'use strict';
const assert=require('assert'),path=require('path');
const root=path.resolve(process.argv[2]),{Canvas}=require(root+'/kit/canvas');
const {SoftwareFrames,softwareImage}=require(root+'/kit/responsive-display');
async function run(){
 const pool=new SoftwareFrames(),screen={w:1920,h:720};let a,b,finishA,finishB;
 const cv=pool.canvas(1600,520).clear('#d32c36'),reference=softwareImage(cv,screen);
 const pa=pool.image(cv,screen,out=>{a=out;return new Promise(r=>finishA=r);});
 assert.deepStrictEqual(a.d,reference.d);
 assert.strictEqual(pool.canvas(1600,520),cv,'Reuse scratch image');cv.clear('#ffffff');
 const pb=pool.image(cv,screen,out=>{b=out;return new Promise(r=>finishB=r);});
 assert.notStrictEqual(a,b,'Pending outputs must not alias');assert.deepStrictEqual(a.d,reference.d,'Next draw must not alter pending frame');
 finishA();await pa;let c;
 await pool.image(cv,screen,out=>{c=out;});assert.strictEqual(c,a,'Released output is reused');
 assert.deepStrictEqual(b.d,c.d);finishB();await pb;
 await assert.rejects(pool.image(cv,screen,()=>Promise.reject(Error('upload failed'))),/upload failed/);
 for(const s of [{w:1280,h:480},{w:2560,h:960},{w:1920,h:1080}]){
  await pool.image(cv,s,out=>assert.deepStrictEqual(out.d,softwareImage(cv,s).d,'Resolution changes preserve original pixels'));
 }
 assert(pool.free.length<=2);assert.notStrictEqual(pool.canvas(800,260),cv,'Different scratch dimensions reallocate');
 console.log('PASS frame pool: exact pixels, pending uploads isolated, reuse after completion/failure, resize, bounded retention');
}run().catch(e=>{console.error(e.stack);process.exitCode=1;});
