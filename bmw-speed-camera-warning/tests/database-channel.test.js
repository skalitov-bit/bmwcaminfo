'use strict';
const assert=require('assert'),path=require('path'),fs=require('fs');
const base=path.resolve(process.argv[2]||path.join(__dirname,'../apps/aurelm_speed_camera_warning'));
const {validateChannel,CHANNEL_URL}=require(path.join(base,'database-channel'));
const {fetchResource}=require(path.join(base,'disk-camera-store'));
const m=JSON.parse(fs.readFileSync(path.join(base,'hybrid-manifest-v1.json'),'utf8'));
const tag='db-'+m.revision+'-'+m.contentHash.slice(0,12);
const channel={schemaVersion:1,minAppVersion:'0.9.32',manifest:m,files:{}};
for(const k of ['index','records'])channel.files[k]='https://github.com/skalitov-bit/speedcam-db/releases/download/'+tag+'/'+m[k].file;
assert.strictEqual(validateChannel(channel),channel);
const copy=()=>JSON.parse(JSON.stringify(channel));
let c=copy();c.minAppVersion='1.0.0';assert.throws(()=>validateChannel(c),/REQUIRES_APP_UPDATE/);
c=copy();c.minAppVersion='0.9.33';assert.throws(()=>validateChannel(c),/REQUIRES_APP_UPDATE/);
c=copy();c.minAppVersion='0.8.99';validateChannel(c);
c=copy();c.files.records=c.files.records.replace('speedcam-db','another-repository');assert.throws(()=>validateChannel(c),/ASSET_URL/);
c=copy();c.files.records=c.files.records.replace(tag,'db-1-000000000000');assert.throws(()=>validateChannel(c),/MIXED_RELEASE/);
c=copy();c.files.index+='?redirect=other';assert.throws(()=>validateChannel(c),/ASSET_URL/);
async function run(){
 for(const address of ['http://github.com/skalitov-bit/speedcam-db/releases/latest/download/channel.json','https://github.com.evil.test/a','https://user:password@raw.githubusercontent.com/a','https://github.com/skalitov-bit/other/releases/latest/download/channel.json','https://release-assets.githubusercontent.com/not-release']){
  await assert.rejects(fetchResource(address,null,100,()=>{throw Error('must not connect');},0),/URL_NOT_ALLOWED/);
 }
 assert(CHANNEL_URL.endsWith('/speedcam-db/releases/latest/download/channel.json'));
 console.log('PASS: channel compatibility, exact release/file identity, mixed releases, credential URLs, insecure scheme and untrusted redirect hosts rejected.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
