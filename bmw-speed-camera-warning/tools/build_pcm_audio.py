"""Prepare offline PCM for the live mixer. No encoder or network needed on MGU."""
import argparse, array, hashlib, json, subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def build(ffmpeg,beeper_only=False):
    native=ROOT/'native/bmwcaminfo-voice'; dest=native/'pcm';dest.mkdir(exist_ok=True)
    files=[] if beeper_only else [(native/'audio'/f,f.replace('.m4a','.pcm'),None) for f in json.loads((native/'audio-manifest.json').read_text())]
    # Retain the installed asset name shared by runtime, diagnostics and emulator.
    # The selected source is now the wood signal; preserve its complete two-second tail.
    files.append((ROOT/'assets/beeper-wood-source.mp3','beeper-sonar.pcm','afade=t=out:st=1.85:d=0.15,volume=0.8'))
    manifest=json.loads((native/'pcm-manifest.json').read_text()) if beeper_only else {}
    for source,name,filters in files:
        cmd=[ffmpeg,'-nostdin','-v','error','-y','-i',str(source),'-ac','1','-ar','24000']
        if filters:cmd+=['-af',filters]
        subprocess.run(cmd+['-f','s16le',str(dest/name)],check=True)
        data=(dest/name).read_bytes();samples=array.array('h',data)
        assert 0<len(samples)<24000*20
        manifest['pcm/'+name]={'sha256':hashlib.sha256(data).hexdigest(),'durationSeconds':len(samples)/24000,'peak':max(abs(x) for x in samples)/32768}
    (native/'pcm-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
    print('Prepared',len(files),'PCM assets; manifest contains',len(manifest))
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--ffmpeg',required=True);p.add_argument('--beeper-only',action='store_true');a=p.parse_args();build(a.ffmpeg,a.beeper_only)
