#!/usr/bin/env python3
"""Build attenuated voice assets; do not alter the BMW master/music volume."""
import argparse, array, hashlib, json, math, subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]/'native/bmwcaminfo-voice'

def build(ffmpeg):
    def rms(path):
        raw=subprocess.check_output([ffmpeg,'-v','error','-i',str(path),'-f','s16le','-acodec','pcm_s16le','-ac','1','-ar','24000','-'])
        samples=array.array('h',raw)
        return math.sqrt(sum(float(x)*x for x in samples)/len(samples))
    manifest={}
    for file in json.loads((ROOT/'audio-manifest.json').read_text(encoding='utf-8')):
        source=ROOT/'audio'/file
        original=rms(source)
        for volume in range(10,100,10):
            relative=f'audio/volume-{volume}/{file}'
            target=ROOT/relative;target.parent.mkdir(parents=True,exist_ok=True)
            subprocess.run([ffmpeg,'-v','error','-y','-i',str(source),'-map_metadata','-1','-af',f'volume={volume/100}', '-c:a','aac','-b:a','128k',str(target)],check=True)
            ratio=rms(target)/original
            assert abs(ratio-volume/100)<0.025,(relative,ratio)
            manifest[relative]={'volume':volume,'source':file,'rmsRatio':round(ratio,5),'sha256':hashlib.sha256(target.read_bytes()).hexdigest()}
    (ROOT/'volume-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
    p=ROOT/'component.json';component=json.loads(p.read_text(encoding='utf-8'))
    component['version']='0.1.11'
    component['description']='Camera voice notifications with independent 0–100% volume and audio route restoration'
    component['files']=[f for f in component['files'] if not f['path'].startswith('audio/volume-') and f['path']!='volume-manifest.json']
    component['files'] += [{'path':name,'from':name,'mode':'0644'} for name in ['volume-manifest.json']+list(manifest)]
    p.write_text(json.dumps(component,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(f'PASS: {len(manifest)} attenuated recordings; decoded RMS agrees with requested gain within 2.5 percentage points')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--ffmpeg',default='ffmpeg')
    build(parser.parse_args().ffmpeg)
