'use strict';
// app-spec is generated from app.json by build_local; source tests use app.json.
let spec;
try { spec=require('./app.json'); }
catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;spec=require('./kit/app-spec.json');}
if(!spec||!/^\d+\.\d+\.\d+$/.test(spec.version))throw Error('APP_VERSION_INVALID');
module.exports=spec.version;
