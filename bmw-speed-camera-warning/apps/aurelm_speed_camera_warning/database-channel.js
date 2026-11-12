'use strict';
const {validateManifest}=require('./hybrid-catalog');
const VERSION='0.9.40';
const CHANNEL_URL='https://github.com/skalitov-bit/speedcam-db/releases/latest/download/channel.json';
function version(v){if(typeof v!=='string'||!/^\d+\.\d+\.\d+$/.test(v))throw new Error('DB_CHANNEL_VERSION');return v.split('.').map(Number);}
function validateChannel(c){
 if(!c||c.schemaVersion!==1||!c.files)throw new Error('DB_CHANNEL_INVALID');
 const need=version(c.minAppVersion),have=version(VERSION);
 for(let i=0;i<3;i++){if(need[i]>have[i])throw new Error('DB_REQUIRES_APP_UPDATE');if(need[i]<have[i])break;}
 const m=validateManifest(c.manifest);
 const prefix='https://github.com/skalitov-bit/speedcam-db/releases/download/';
 let tag=null;
 for(const key of ['index','records']){
  const u=c.files[key];
  if(typeof u!=='string'||!u.startsWith(prefix))throw new Error('DB_CHANNEL_ASSET_URL');
  const parts=u.slice(prefix.length).split('/');
  if(parts.length!==2||!/^db-[0-9]+-[a-f0-9]{12}$/.test(parts[0])||parts[1]!==m[key].file)throw new Error('DB_CHANNEL_ASSET_URL');
  if(tag&&tag!==parts[0])throw new Error('DB_CHANNEL_MIXED_RELEASE');tag=parts[0];
 }
 if(tag!=='db-'+m.revision+'-'+m.contentHash.slice(0,12))throw new Error('DB_CHANNEL_RELEASE_ID');
 return c;
}
module.exports={CHANNEL_URL,validateChannel};
