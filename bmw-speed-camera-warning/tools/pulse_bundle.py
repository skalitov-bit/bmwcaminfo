"""Static compatibility gate, not a claim of execution on BMW firmware."""
import hashlib,json,re,struct
from pathlib import Path
from elf_check import verify_mgu_elf

def needed(b):
    off=struct.unpack_from('<Q',b,40)[0];stride,count=struct.unpack_from('<HH',b,58)
    sections=[struct.unpack_from('<IIQQQQIIQQ',b,off+i*stride) for i in range(count)]
    result=[]
    for s in sections:
        if s[1]!=6:continue
        st=sections[s[6]];strings=b[st[4]:st[4]+st[5]]
        for pos in range(s[4],s[4]+s[5],16):
            tag,val=struct.unpack_from('<QQ',b,pos)
            if tag==1:result.append(strings[val:strings.index(b'\0',val)].decode())
    return result

def patch_loader(b):
    b=bytearray(b);off=struct.unpack_from('<Q',b,32)[0];stride,count=struct.unpack_from('<HH',b,54)
    for i in range(count):
        pos=off+i*stride
        if struct.unpack_from('<I',b,pos)[0]!=3:continue
        at=struct.unpack_from('<Q',b,pos+8)[0];length=struct.unpack_from('<Q',b,pos+32)[0]
        old=bytes(b[at:at+length]).rstrip(b'\0')
        assert old in [b'/lib64/ld-linux-x86-64.so.2',b'/lib/ld-linux-x86-64.so.2'],old
        new=b'/lib/ld-linux-x86-64.so.2\0';assert len(new)<=length
        b[at:at+length]=new+b'\0'*(length-len(new))
        struct.pack_into('<Q',b,pos+32,len(new));struct.pack_into('<Q',b,pos+40,len(new))
    verify_mgu_elf(b);return bytes(b)

def verify(root):
    root=Path(root);p=json.loads((root/'provenance.json').read_text());libs={Path(f['path']).name for f in p['files']};system=set(p['systemLibraries']);results=[]
    assert 'libasound.so.2' not in libs and 'libc.so.6' not in libs,'Never override system ALSA/loader/libc'
    for f in p['files']:
        b=(root/f['path']).read_bytes();assert hashlib.sha256(b).hexdigest()==f['sha256'],f['path']
        assert b[:6]==b'\x7fELF\x02\x01' and struct.unpack_from('<H',b,18)[0]==62
        if f['path'].startswith('bin/'):verify_mgu_elf(b)
        deps=needed(b);assert set(deps)<=libs|system,(f['path'],set(deps)-libs-system)
        versions=[tuple(map(int,v.decode().split('.'))) for v in re.findall(rb'GLIBC_([0-9]+\.[0-9]+(?:\.[0-9]+)?)\x00',b)]
        maximum=max(versions,default=(0,));assert maximum<=(2,19),(f['path'],maximum)
        results.append({'path':f['path'],'bytes':len(b),'maxGlibc':'.'.join(map(str,maximum))})
    assert (root/'licenses/pulseaudio').is_file()
    return {'elf':'x86_64 Linux','loader':'/lib/ld-linux-x86-64.so.2','glibcBuildBaseline':'2.19','files':results,'bytes':sum(f['bytes'] for f in results),'systemLibrariesRequired':p['systemLibraries'],'executedOnMGU':False}

if __name__=='__main__':
    import argparse
    a=argparse.ArgumentParser();a.add_argument('root',type=Path);args=a.parse_args();print(json.dumps(verify(args.root),indent=2))
