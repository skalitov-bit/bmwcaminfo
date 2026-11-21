from pathlib import Path
import argparse,subprocess
p=argparse.ArgumentParser();p.add_argument('--zig',type=Path,required=True);p.add_argument('--node',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();r=Path(__file__).resolve().parents[1];z=a.zig.resolve();o=a.out.resolve();o.mkdir(exist_ok=True)
for name in ['direct-pcm','stable-audio-compare']:
 obj=o/(name+'.o');wasm=o/(name+'.wasm');src=r/'tests'/(name+('.test.c' if name=='direct-pcm' else '.c'))
 subprocess.run([str(z),'clang','-target','wasm32','-mcpu=mvp','-isystem',str(z.parent/'lib/include'),'-I'+str(r/'tests/freestanding'),'-O2','-fno-builtin','-Wall','-Wextra','-Werror','-c',str(src),'-o',str(obj)],check=True)
 exports=['main'] if name=='direct-pcm' else ['pulse_ptr','voice_ptr','output_ptr','init','render','peak','limited','saturated','pulses']
 subprocess.run([str(z),'wasm-ld','--no-entry','--export-memory','--allow-undefined',*[f'--export={e}' for e in exports],str(obj),'-o',str(wasm)],check=True)
 if name=='direct-pcm':
  subprocess.run([str(a.node.resolve()),'-e',"WebAssembly.instantiate(require('fs').readFileSync(process.argv[1]),{env:{test_failure:n=>{throw Error('Direct PCM assertion '+n);}}}).then(w=>{w.instance.exports.main();console.log('PASS negotiated format/rate/channels/access, missing API rejection, no leak; ALSA mocked');}).catch(e=>{console.error(e);process.exitCode=1;});",str(wasm)],check=True)
 else:subprocess.run([str(a.node.resolve()),str(r/'tests/stable-audio-compare.js'),str(wasm),str(o)],check=True)
 obj.unlink()
