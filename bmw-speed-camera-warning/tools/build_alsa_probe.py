"""Build the x86_64 Linux probe with Zig's Clang/LLD and a glibc sysroot.

Uses Clang/LLD directly (Zig's compiler cache fails in the Windows sandbox).
No compiler, sysroot, or replacement glibc is installed on the vehicle.
"""
from pathlib import Path
import argparse, subprocess, tempfile
p=argparse.ArgumentParser()
p.add_argument('--zig',type=Path,required=True)
p.add_argument('--sysroot',type=Path,required=True)
a=p.parse_args()
zig=a.zig.resolve();sysroot=a.sysroot.resolve();lib=zig.parent/'lib'
root=Path(__file__).resolve().parents[1]/'native/bmwcaminfo-voice'
with tempfile.TemporaryDirectory(prefix='speedcam-alsa-') as tmp:
 obj=Path(tmp)/'alsa-probe.o'
 cmd=[str(zig),'clang','-target','x86_64-linux-gnu','-O2','-Wall','-Wextra','-Werror']
 for h in [lib/'include',sysroot/'usr/include/x86_64-linux-gnu',sysroot/'usr/include',lib/'libc/include/x86-linux-any',lib/'libc/include/any-linux-any']:
  cmd+=['-isystem',str(h)]
 subprocess.run(cmd+['-c',str(root/'alsa-probe.c'),'-o',str(obj)],check=True)
 crt=sysroot/'usr/lib/x86_64-linux-gnu';runtime=sysroot/'lib/x86_64-linux-gnu'
 subprocess.run([str(zig),'ld.lld','-o',str(root/'alsa-probe'),'-dynamic-linker','/lib/ld-linux-x86-64.so.2',
  str(crt/'crt1.o'),str(crt/'crti.o'),str(obj),str(runtime/'libc-2.19.so'),str(crt/'libc_nonshared.a'),str(runtime/'libdl-2.19.so'),str(crt/'crtn.o')],check=True)
from elf_check import verify_mgu_elf
verify_mgu_elf((root/'alsa-probe').read_bytes())
print(root/'alsa-probe')
