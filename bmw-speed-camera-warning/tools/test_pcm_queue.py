"""Compile the production PCM pump test to portable WASM and run in Node.
ALSA/device callbacks and time are simulated; this is not an MGU test.
"""
from pathlib import Path
import argparse, subprocess
p=argparse.ArgumentParser()
p.add_argument('--zig',type=Path,required=True)
p.add_argument('--node',type=Path,required=True)
a=p.parse_args();r=Path(__file__).resolve().parents[1];zig=a.zig.resolve()
obj=r/'tests/pcm-queue.test.o';wasm=r/'tests/pcm-queue.test.wasm'
try:
 subprocess.run([str(zig),'clang','-target','wasm32','-mcpu=mvp','-isystem',str(zig.parent/'lib/include'),'-DSPEEDCAM_WASM','-I'+str(r/'tests/freestanding'),'-O2','-Wall','-Wextra','-Werror','-c',str(r/'tests/pcm-queue.test.c'),'-o',str(obj)],check=True)
 subprocess.run([str(zig),'wasm-ld','--no-entry','--export=main','--allow-undefined',str(obj),'-o',str(wasm)],check=True)
 subprocess.run([str(a.node.resolve()),str(r/'tests/audio-queue-telemetry.test.js')],cwd=r,check=True)
finally:
 obj.unlink(missing_ok=True)
