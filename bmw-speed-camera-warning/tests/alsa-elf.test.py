from pathlib import Path
import sys, struct
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from elf_check import verify_mgu_elf
p=Path(__file__).resolve().parents[1]/'native/bmwcaminfo-voice/alsa-probe'
data=p.read_bytes()
assert verify_mgu_elf(data)['interpreter']=='/lib/ld-linux-x86-64.so.2'
# Reproduce the previous wrong loader in a synthetic ELF, not just a string match.
bad=bytearray(160);bad[:6]=b'\x7fELF\x02\x01';struct.pack_into('<H',bad,18,62)
struct.pack_into('<Q',bad,32,64);struct.pack_into('<HH',bad,54,56,1)
wrong=b'/lib64/ld-linux-x86-64.so.2\x00'
struct.pack_into('<I',bad,64,3);struct.pack_into('<Q',bad,72,120);struct.pack_into('<Q',bad,96,len(wrong));bad[120:120+len(wrong)]=wrong
try:verify_mgu_elf(bad)
except ValueError as e:assert 'MGU requires' in str(e)
else:raise AssertionError('Old /lib64 loader accepted')
print('PASS actual ELF x86_64 /lib loader; previous /lib64 regression rejected. No real MGU execution.')
