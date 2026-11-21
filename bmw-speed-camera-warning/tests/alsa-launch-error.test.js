'use strict';
const assert=require('assert');
const {launchError,LOADER}=require('../native/bmwcaminfo-voice/alsa-launch-error');
const error={code:'ENOENT',message:'spawn ENOENT'},binary='/voice/alsa-probe';
assert(/executable missing/.test(launchError(error,binary,{existsSync:()=>false})));
assert(launchError(error,binary,{existsSync:p=>p===binary}).includes('ELF loader missing: '+LOADER));
assert(/exists but cannot start/.test(launchError(error,binary,{existsSync:()=>true})));
assert.equal(launchError({code:'EACCES',message:'permission denied'},binary),'permission denied');
console.log('PASS ALSA ENOENT distinguishes missing executable and loader without hiding other errors.');
