'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const {fixture}=require('./stable-shared-output.test');
(async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'removed-comparison-')),file=path.join(dir,'route.json');
try {for(const profile of ['plug-stable','smartx-direct'])for(const kind of ['voice','both']){
 const f=fixture(file);await assert.rejects(f.d.handle({action:'audio-overlay-test',backend:'converter-stable',probeProfile:profile,kind},()=>true),/removed/);
 assert.equal(f.commands.length,0);assert.equal(f.routes.length,1);assert(!f.d.last);assert(!fs.existsSync(file));await f.s.mixer.close();
} console.log('PASS removed comparison endpoints reject before audio spawn, routing or save authorization');
}finally{fs.rmdirSync(dir);}})().catch(e=>{console.error(e);process.exitCode=1;});

