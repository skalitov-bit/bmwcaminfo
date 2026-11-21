'use strict';
const assert=require('assert'),path=require('path');
const base=path.resolve(process.argv[2]||path.join(__dirname,'../apps/aurelm_speed_camera_warning'));
const {install,focusTab}=require(path.join(base,'controller-navigation'));
const style=require(path.join(base,'screen-style'));
const target={key:'volume-up',x:1470,y:132,w:70,h:40};
const calls=[],seen=[];
const surface={fillRect:(...args)=>calls.push(args)};
const display={_toward:()=>{},_ring:()=>[],pageTargets:[target],focusKey:'tgt:volume-up',pressed:'tgt:volume-up',pressedT:Date.now(),
 _drawChrome(){seen.push([this.focusKey,this.pressed]);}};
assert(install(display));assert(!install(display),'Install is idempotent');
display._drawChrome(surface);
assert.deepStrictEqual(seen.pop(),[null,null],'Native rounded focus/press are suppressed for page targets');
assert.strictEqual(display.focusKey,'tgt:volume-up');assert.strictEqual(display.pressed,'tgt:volume-up');
assert(calls.length>0);
for(const [x,y,w,h,color] of calls){
 assert(x>=target.x&&y>=target.y&&x+w<=target.x+target.w&&y+h<=target.y+target.h,'Focus stays within target');
 if(h===target.h&&Array.isArray(color))assert(color[3]<=28,'Focus tint cannot obscure labels');
}
assert(calls.length>4,'Focus uses the tile gradient');
assert(!calls.some(c=>c[4]===style.colors.text||c[4]===style.colors.red),'No white outline or red focus');
assert(!calls.some(c=>c[0]===target.x+target.w-2&&c[2]===2&&c[3]===target.h),'No right frame edge');
calls.length=0;style.drawNavFocus(surface,'MAP',{active:'MAP'});
assert.strictEqual(calls.length,0,'Active red tile is not painted over by gray focus');
calls.length=0;display.sheet={};display._drawChrome(surface);
assert.deepStrictEqual(seen.pop(),['tgt:volume-up','tgt:volume-up']);assert.strictEqual(calls.length,0,'System sheets keep original chrome');
display.sheet=null;display.focusKey='bar:OTHER';display.pressed=null;display._drawChrome(surface);
assert.deepStrictEqual(seen.pop(),['bar:OTHER',null]);assert.strictEqual(calls.length,0,'Native controls keep original chrome');
const broken={_toward:()=>{},_ring:()=>[],pageTargets:[target],focusKey:'tgt:volume-up',pressed:null,_drawChrome(){throw Error('paint');}};
install(broken);assert.throws(()=>broken._drawChrome(surface),/paint/);assert.strictEqual(broken.focusKey,'tgt:volume-up','Restore focus even when chrome fails');
calls.length=0;style.drawSelection(surface,0,0,222,98);
const top=calls.filter(c=>c[1]===0&&c[3]===1);
assert.strictEqual(top[0][4][3],255);assert.strictEqual(top.at(-1)[4][3],0,'Red line fades only to the right');
display.focusKey='tgt:nav-SETTINGS';display.pressed='tgt:nav-SETTINGS';display.focused='OLD';display.focusTab=4;
assert(focusTab(display,'MAP'));assert.strictEqual(display.focusKey,'tgt:nav-MAP');
assert.strictEqual(display.focused,null);assert.strictEqual(display.focusTab,null);assert.strictEqual(display.pressed,null);
assert(!focusTab(display,'INVALID'));assert.strictEqual(display.focusKey,'tgt:nav-MAP');assert(!focusTab(null,'MAP'));
console.log('PASS: gray gradient focus without frame, active red priority, touch focus sync, native chrome delegation and restoration.');
