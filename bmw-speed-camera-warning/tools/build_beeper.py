"""Encode the approved single pulse #21 and its notification-volume profiles."""
import argparse, hashlib, json, subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
SERVICE=ROOT/'native/bmwcaminfo-voice'
def build(ffmpeg):
    manifest={}
    for volume in range(10,101,10):
        relative='audio/'+('' if volume==100 else f'volume-{volume}/')+'beeper-21.m4a'
        dest=SERVICE/relative;dest.parent.mkdir(parents=True,exist_ok=True)
        subprocess.run([ffmpeg,'-v','error','-y','-i',str(ROOT/'assets/beeper-21.wav'),'-map_metadata','-1','-af',f'volume={volume/100}','-c:a','aac','-b:a','128k',str(dest)],check=True)
        manifest[relative]={'volume':volume,'sha256':hashlib.sha256(dest.read_bytes()).hexdigest()}
    (SERVICE/'beeper-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
    p=SERVICE/'component.json';c=json.loads(p.read_text(encoding='utf-8'))
    c['version']='0.1.12'
    c['description']='Camera voice and adaptive overspeed beeper with independent notification volume'
    additions=['beeper.js','beeper-manifest.json']+list(manifest)
    c['files']=[f for f in c['files'] if f['path'] not in additions]
    c['files'] += [{'path':name,'from':name,'mode':'0644'} for name in additions]
    p.write_text(json.dumps(c,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print('Encoded and registered 10 beeper volume profiles')
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--ffmpeg',required=True);build(p.parse_args().ffmpeg)
