"""Recreate the private experimental PulseAudio payload from SHA-256 pinned Debian packages.

No package scripts are run. Nothing is installed into the host/system directories.
The original binaries are unchanged except PT_INTERP; system ALSA/libc are never bundled.
"""
import argparse,hashlib,io,json,tarfile,urllib.request
from pathlib import Path
from pulse_bundle import patch_loader,verify

def build(root,cache):
    lock=json.loads((root/'provenance.json').read_text());cache.mkdir(parents=True,exist_ok=True);files={}
    for pkg in lock['packages']:
        dest=cache/Path(pkg['Filename']).name
        if not dest.exists():
            with urllib.request.urlopen('https://archive.debian.org/debian/'+pkg['Filename'],timeout=60) as r:
                if r.status!=200:raise ValueError('Download failed')
                dest.write_bytes(r.read())
        raw=dest.read_bytes();assert hashlib.sha256(raw).hexdigest()==pkg['SHA256'],dest
        pos=8;assert raw[:8]==b'!<arch>\n'
        while pos+60<=len(raw):
            header=raw[pos:pos+60];size=int(header[48:58]);payload=raw[pos+60:pos+60+size];pos+=60+size+(size%2)
            if not header[:16].decode().strip().rstrip('/').startswith('data.tar'):continue
            with tarfile.open(fileobj=io.BytesIO(payload)) as t:
                for m in t.getmembers():
                    if m.isfile():files[(pkg['Package'],m.name.lstrip('./'))]=t.extractfile(m).read()
    for f in lock['files']:
        name=Path(f['path']).name
        candidates=[b for (pkg,n),b in files.items() if pkg==f['package'] and (Path(n).name==name or Path(n).name.startswith(name+'.'))]
        matches=[]
        for b in candidates:
            if b[:4]!=b'\x7fELF':continue
            if f['path'].startswith('bin/'):b=patch_loader(b)
            if hashlib.sha256(b).hexdigest()==f['sha256']:matches.append(b)
        assert len(matches)==1,(f['path'],len(matches))
        dest=root/f['path'];dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(matches[0])
    for pkg in lock['packages']:
        license=next(b for (p,n),b in files.items() if p==pkg['Package'] and n.endswith('/copyright'))
        (root/'licenses'/pkg['Package']).write_bytes(license)
    return verify(root)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1]/'native/bmwcaminfo-voice/pulse');p.add_argument('--cache',required=True,type=Path);a=p.parse_args();print(json.dumps(build(a.root,a.cache),indent=2))
