"""Build the user-selected wood pulse with bounded decay and verified AAC levels."""
import argparse, hashlib, json, math, subprocess, array, wave
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
SERVICE=ROOT/'native/bmwcaminfo-voice'
def digest(data):return hashlib.sha256(data).hexdigest()
def build(ffmpeg):
    source=ROOT/'assets/beeper-wood-source.mp3'
    pulse=ROOT/'assets/beeper-wood.wav'
    def run(args):return subprocess.run([ffmpeg,'-nostdin','-v','error',*args],check=True,capture_output=True).stdout
    # Keep the attack and pitch; shorten the long decay to permit discrete rapid pulses.
    run(['-y','-i',str(source),'-map_metadata','-1','-ac','1','-ar','24000',
         '-af','atrim=duration=0.24,asetpts=PTS-STARTPTS,afade=t=out:st=0.18:d=0.06',
         '-c:a','pcm_s16le',str(pulse)])
    with wave.open(str(pulse),'rb') as w: samples=array.array('h',w.readframes(w.getnframes()))
    peak=max(abs(n) for n in samples)/32768
    gain=min(1,10**(-3/20)/peak)
    manifest={};rms={}
    for volume in range(10,101,10):
        relative='audio/'+('' if volume==100 else f'volume-{volume}/')+'beeper-wood.m4a'
        dest=SERVICE/relative;dest.parent.mkdir(parents=True,exist_ok=True)
        run(['-y','-i',str(pulse),'-map_metadata','-1','-af',f'volume={gain*volume/100}',
             '-c:a','aac','-b:a','128k','-movflags','+faststart',str(dest)])
        decoded=array.array('h',run(['-i',str(dest),'-ac','1','-ar','24000','-f','s16le','-']))
        duration=len(decoded)/24000
        assert 0.24<=duration<=0.28 and max(abs(n) for n in decoded)<32767
        rms[volume]=math.sqrt(sum(n*n for n in decoded)/len(decoded))
        manifest[relative]={'volume':volume,'sha256':digest(dest.read_bytes()),'durationSeconds':duration}
    for info in manifest.values():
        ratio=rms[info['volume']]/rms[100]
        assert abs(ratio-info['volume']/100)<0.025
        info['rmsRatio']=ratio
    (SERVICE/'beeper-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
    p=SERVICE/'component.json';c=json.loads(p.read_text(encoding='utf-8'))
    assert c['version'] in ('0.1.15','0.1.16')
    c['version']='0.1.16'
    c['description']='Camera voice and wood overspeed beeper accelerating every 50 metres'
    additions=['beeper.js','beeper-manifest.json']+list(manifest)
    c['files']=[f for f in c['files'] if f['path'] not in additions and not f['path'].endswith('/beeper-21.m4a')]
    c['files'] += [{'path':name,'from':name,'mode':'0644'} for name in additions]
    p.write_text(json.dumps(c,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    proof={'sourceSha256':digest(source.read_bytes()),'pulseSha256':digest(pulse.read_bytes()),
           'pulseSeconds':0.24,'fadeOutSeconds':0.06,'pitchChanged':False,'headroomGain':gain,
           'volumeProfiles':10,'aacDecoded':True,'realMGUTested':False}
    (ROOT/'assets/beeper-wood-processing.json').write_text(json.dumps(proof,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(proof,indent=2))
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--ffmpeg',required=True);build(p.parse_args().ffmpeg)
