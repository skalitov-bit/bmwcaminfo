'use strict';
// Exercise the built kit code: preserve the OEM title and never claim its touch strip.
const assert=require('assert'),path=require('path');
const root=path.resolve(process.argv[2]),spec=require(root+'/kit/app-spec.json');
const {Display,FULL,HMI}=require(root+'/kit/display');
const {Recorder,OP}=require(root+'/kit/record');
const G=require(root+'/kit/gauges');
// Cover the legacy opt-in separately; responsive-display.test covers the new MAIN path.
spec.responsiveMain=false;
assert.strictEqual(spec.nativeHeader,true);assert.strictEqual(spec.title,'SpeedCAM');assert.strictEqual(spec.screens[0].title,'SpeedCAM');
let headerCalls=0,claims=null;const original=G.header;
G.header=()=>{headerCalls++;return 500;};
try{
 const d=Object.create(Display.prototype);
 Object.assign(d,{spec,screen:spec.screens[0],place:{x:0,y:0,w:1920,h:720,scale:1,ox:0,oy:80},theme:()=>({bg:'#000000',accent:'#ff0000'}),own:()=>true,_tabList:()=>({tabs:[],sel:-1,badges:[]}),barH:()=>0,headH:()=>80,buttons:()=>[],gpu:{claim:r=>{claims=r;}},pageTargets:[],pressedT:0});
 const r=new Recorder(1600,520);r.chrome={};d._drawChrome(r);assert.equal(headerCalls,0,'No overlay title renderer');assert.equal(d.headEnd,HMI.left);assert.deepStrictEqual(d.chromeRec.tabRects,[]);
 const words=d.chromeRec.words(),f=new Float32Array(words.buffer,words.byteOffset,words.length);let i=0,clip=null,fullHeaderClear=false;
 while(i<words.length){const op=words[i++];if(op===OP.CLIP){clip=Array.from(f.slice(i,i+4));i+=4;}else if(op===OP.NOCLIP){clip=null;}else if(op===OP.CLEAR){if(words[i]===0&&clip&&clip[0]===0&&clip[1]===0&&clip[2]===1920&&clip[3]===FULL.headH)fullHeaderClear=true;i++;}else if(op===OP.RECT)i+=5;else throw Error('Unexpected chrome operation '+op);}
 assert(fullHeaderClear,'Whole overlay title strip must be cleared to alpha zero');
 d._claimTabs([],null);assert.equal(claims.length,1);assert.equal(claims[0].y,0);assert.equal(claims[0].h,640,'Only page area, with logical origin below OEM header');
 // The opt-in patch must not change unrelated kit applications.
 d.spec=Object.assign({},spec,{nativeHeader:false});d._drawChrome(r);assert.equal(headerCalls,1);
 console.log('PASS native header: OEM name retained, overlay title omitted, entire header transparent, OEM touch area unclaimed, legacy kit behavior retained. GPU hardware not tested.');
}finally{G.header=original;}
