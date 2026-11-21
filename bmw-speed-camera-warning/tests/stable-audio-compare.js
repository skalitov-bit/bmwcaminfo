'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
async function main(){const dir=process.argv[3],N=path.resolve(__dirname,'../native/bmwcaminfo-voice');const w=(await WebAssembly.instantiate(fs.readFileSync(process.argv[2]),{})).instance.exports;
 const pulse=fs.readFileSync(path.join(N,'pcm/beeper-sonar.pcm')),voice=fs.readFileSync(path.join(N,'pcm/camera-500.pcm'));
 new Uint8Array(w.memory.buffer,w.pulse_ptr(),pulse.length).set(pulse);new Uint8Array(w.memory.buffer,w.voice_ptr(),voice.length).set(voice);
 const result={realMGU:false,note:'Production native mixer, original PCM assets. Offline samples exclude ALSA/SmartX and cannot establish audibility on MGU.',samples:[]};
 for(const beep of [0,1]){assert.equal(w.init(pulse.length,voice.length,beep),0);const chunks=[];
  for(let f=0;f<144000;f+=480){w.render(f,beep);chunks.push(Buffer.from(new Uint8Array(w.memory.buffer,w.output_ptr(),960)));}
  const pcm=Buffer.concat(chunks),head=Buffer.alloc(44);head.write('RIFF');head.writeUInt32LE(36+pcm.length,4);head.write('WAVEfmt ',8);head.writeUInt32LE(16,16);head.writeUInt16LE(1,20);head.writeUInt16LE(1,22);head.writeUInt32LE(24000,24);head.writeUInt32LE(48000,28);head.writeUInt16LE(2,32);head.writeUInt16LE(16,34);head.write('data',36);head.writeUInt32LE(pcm.length,40);
  const name=beep?'voice-with-beeper.wav':'voice-only.wav';fs.writeFileSync(path.join(dir,name),Buffer.concat([head,pcm]));assert.equal(w.saturated(),0);assert.equal(w.limited(),0);assert.equal(w.pulses()>0,!!beep);
  result.samples.push({file:name,peak:w.peak(),limitedSamples:w.limited(),saturatedSamples:w.saturated(),pulses:w.pulses()});
 }
 fs.writeFileSync(path.join(dir,'offline-audio-comparison.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
