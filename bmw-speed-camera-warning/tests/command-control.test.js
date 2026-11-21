'use strict';
const assert=require('assert');
const {readList,decode}=require('../native/bmwcaminfo-voice/command-control');
async function run(){
 const calls=[],cc={getValue(){throw Error('Wrong API');},callMethod:async(m,a,t)=>{calls.push([m,a,t]);return {amError:'E_OK',listConnections:[{mainConnectionID:4,sourceID:100,sinkID:1024}]};}};
 assert.equal((await readList(cc,'listOfMainConnections'))[0].sourceID,100);
 assert.deepStrictEqual(calls,[['getListMainConnections',{},3000]]);
 assert.deepStrictEqual(decode({amError:0,listMainSources:[{sourceID:287}]},'listOfMainSources'),[{sourceID:287}]);
 assert.deepStrictEqual(decode({listMainSinks:[]},'listOfMainSinks'),[]);
 assert.deepStrictEqual(decode({listConnections:[]},'listOfMainConnections'),[]);
 for(const r of [undefined,{}, {amError:'E_DATABASE_ERROR',listConnections:[]},{listConnections:[{}]},{listConnections:[{mainConnectionID:2,sourceID:287}]}])assert.throws(()=>decode(r,'listOfMainConnections'));
 await assert.rejects(readList({callMethod:()=>new Promise(()=>{})},'listOfMainConnections',5),/timeout/);
 await assert.rejects(readList({callMethod(){throw Error('Unavailable');}},'listOfMainSources'),/Unavailable/);
 console.log('PASS BMW method inventories: response shapes, explicit empty routes, rejected/malformed/missing replies, timeout and synchronous failure. BMW mocked.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
