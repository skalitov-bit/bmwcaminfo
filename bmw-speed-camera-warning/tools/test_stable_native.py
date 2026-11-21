from pathlib import Path
import argparse,subprocess
p=argparse.ArgumentParser();p.add_argument('--zig',type=Path,required=True);p.add_argument('--node',type=Path,required=True);a=p.parse_args()
r=Path(__file__).resolve().parents[1];z=a.zig.resolve();obj=r/'tests/stable-native.test.o';wasm=r/'tests/stable-native.test.wasm'
try:
 subprocess.run([str(z),'clang','-target','wasm32','-mcpu=mvp','-isystem',str(z.parent/'lib/include'),'-I'+str(r/'tests/freestanding'),'-O2','-fno-builtin','-Wall','-Wextra','-Werror','-c',str(r/'tests/stable-native.test.c'),'-o',str(obj)],check=True)
 subprocess.run([str(z),'wasm-ld','--no-entry','--export=main','--allow-undefined',str(obj),'-o',str(wasm)],check=True)
 subprocess.run([str(a.node.resolve()),'-e',"WebAssembly.instantiate(require('fs').readFileSync(process.argv[1]),{env:{test_values:(...v)=>console.log('native case',v),test_failure:n=>{throw Error('Native stable assertion line '+n);}}}).then(w=>{if(w.instance.exports.main()!==0)throw Error('Native failure');console.log('PASS production native mixer AND stream: levels, edges, ducking, tails, lease expiry, 700ms no JS PCM, fragmented IPC, partial writes, XRUN recovery, wait failure. ALSA simulated.');}).catch(e=>{console.error(e);process.exitCode=1;});",str(wasm)],check=True)
finally:obj.unlink(missing_ok=True)
