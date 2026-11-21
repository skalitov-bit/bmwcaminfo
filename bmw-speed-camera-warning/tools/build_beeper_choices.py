"""Prepare the eight user supplied one-second beeps, preserving pitch and tails."""
import argparse,array,hashlib,json,subprocess,shutil,math
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
N=ROOT/'native/bmwcaminfo-voice'
NAMES=['Create_soft_speed_ra_#1-1794955964002.mp3','Create_soft_speed_ra_#1-1794955987357.mp3','Create_soft_speed_ra_#1-1794956048729.mp3','Create_soft_speed_ra_#1-1794956070873.mp3','Create_soft_speed_ra_#2-1794955931171.mp3','Create_soft_speed_ra_#2-1794956014933.mp3','Create_soft_speed_ra_#3-1794956025486.mp3','Create_soft_speed_ra_#4-1794956265970.mp3']
def build(source,ffmpeg):
    assets=ROOT/'assets/beeper-choices';assets.mkdir(exist_ok=True)
    def run(args):return subprocess.check_output([ffmpeg,'-nostdin','-v','error',*args])
    manifest={};added=[]
    audio=json.loads((N/'audio-manifest.json').read_text(encoding='utf-8'))
    pcms=json.loads((N/'pcm-manifest.json').read_text(encoding='utf-8'))
    levels=json.loads((N/'volume-manifest.json').read_text(encoding='utf-8'))
    for i,name in enumerate(NAMES,1):
        src=source/name;shutil.copy2(src,assets/name)
        raw=run(['-i',str(src),'-ac','1','-ar','24000','-f','s16le','-'])
        samples=array.array('h',raw);peak=max(abs(v) for v in samples);assert peak>0
        # Equal peak levels, with headroom for overlapping one-second tails at 300ms.
        gain=8192/peak;count=len(samples)
        samples=array.array('h',(round(v*gain*min(1,j/120,(count-1-j)/240)) for j,v in enumerate(samples)))
        data=samples.tobytes();stem=f'beeper-choice-{i}';rel=f'pcm/{stem}.pcm';(N/rel).write_bytes(data);added.append(rel)
        info={'sha256':hashlib.sha256(data).hexdigest(),'durationSeconds':count/24000,'peak':max(abs(v) for v in samples)/32768}
        pcms[rel]=info
        manifest[str(i)]={**info,'source':name,'sourceSha256':hashlib.sha256(src.read_bytes()).hexdigest(),'gain':gain,'label':f'Бипер {i}'}
        measured={}
        for volume in [100,*range(10,100,10)]:
            rel='audio/'+('' if volume==100 else f'volume-{volume}/')+stem+'.m4a';out=N/rel;out.parent.mkdir(exist_ok=True)
            factor=volume/100;low=0;high=1.5;best=None
            for attempt in range(16):
                input_args=['-f','s16le','-ar','24000','-ac','1','-i',str(N/f'pcm/{stem}.pcm')] if volume==100 else ['-i',str(N/f'audio/{stem}.m4a')]
                run(['-y',*input_args,'-map_metadata','-1','-af',f'volume={factor}','-c:a','aac','-b:a','128k',str(out)])
                decoded=array.array('h',run(['-i',str(out),'-ar','24000','-ac','1','-f','s16le','-']));assert max(abs(v) for v in decoded)<32767
                rms=math.sqrt(sum(v*v for v in decoded)/len(decoded))
                error=0 if volume==100 else abs(rms/measured[100][1]-volume/100)
                if best is None or error<best[0]:best=(error,out.read_bytes(),decoded,rms)
                if error<.01:break
                if rms/measured[100][1]<volume/100:low=factor
                else:high=factor
                factor=(low+high)/2
            out.write_bytes(best[1]);decoded=best[2];rms=best[3]
            assert volume==100 or abs(rms/measured[100][1]-volume/100)<.025,(stem,volume,rms/measured[100][1])
            added.append(rel)
            measured[volume]=(rel,math.sqrt(sum(v*v for v in decoded)/len(decoded)))
            if volume==100:audio[stem+'.m4a']={'durationSeconds':len(decoded)/24000,'sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'text':f'Бипер {i}','provider':'user audio'}
        for volume,(rel,rms) in measured.items():
            if volume!=100:levels[rel]={'volume':volume,'source':stem+'.m4a','sha256':hashlib.sha256((N/rel).read_bytes()).hexdigest(),'rmsRatio':round(rms/measured[100][1],5)}
    for name,data in [('beeper-choices.json',manifest),('audio-manifest.json',audio),('pcm-manifest.json',pcms),('volume-manifest.json',levels)]:
        (N/name).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    added+=['beeper-choices.json','beeper-sounds.js']
    cp=N/'component.json';c=json.loads(cp.read_text(encoding='utf-8'));existing={f['path'] for f in c['files']}
    c['files'] += [{'path':p,'from':p,'mode':'0644'} for p in added if p not in existing]
    cp.write_text(json.dumps(c,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print('Prepared eight full-length beeps, PCM + ten AAC volume levels each; no release.')
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--ffmpeg',required=True);a=p.parse_args();build(a.source,a.ffmpeg)
