"""Verify the release against locally tested files, then prepare its assets."""
from pathlib import Path
import hashlib, json, shutil, subprocess, tarfile, zipfile, os
root=Path(__file__).resolve().parents[1]
meta=root/'.release/0.9.29'
out=Path(os.environ.get('SPEEDCAM_RELEASE_OUT',str(root/'release0929')))
project=root/'bmw-speed-camera-warning'
expected=json.loads((meta/'expected-package-files.json').read_text(encoding='utf-8'))
extract=root/'verify-release0929'
extract.mkdir(exist_ok=True)
for filename,wanted in expected.items():
    with tarfile.open(out/filename,'r:gz') as archive:
        actual={}
        for m in archive.getmembers():
            if not m.isfile():raise ValueError('Unexpected archive entry: '+m.name)
            actual[m.name]={'sha256':hashlib.sha256(archive.extractfile(m).read()).hexdigest(),'mode':m.mode,'size':m.size}
        if actual!=wanted:
            raise ValueError(filename+' differs from tested files: '+str([k for k in actual.keys()|wanted.keys() if actual.get(k)!=wanted.get(k)]))
        if filename.endswith('.mgu'):archive.extractall(extract,filter='data')
results={'version':'0.9.29','voice_service':'0.1.10','hardware_test':False,'native_popup_sdk_contract':'unverified without vehicle SDK','package_file_hashes':'MGU, TGZ and voice service match locally tested files','tests':{}}
base=extract/'source/javascript'
tests=[('background-notification',base),('rhmi-popup-transport',base),('app-startup',base/'app.js'),('mapcam-warnings',None),('road-guidance',None),('voice-queue',None),('voice-models',base),('voice-service-assets',None),('hud-blink',base),('hud-labels',base),('hybrid-catalog',base),('notification-types',base),('hybrid-memory',None)]
for name,arg in tests:
    cmd=['node']+(['--max-old-space-size=64'] if name=='hybrid-memory' else [])+[str(project/f'tests/{name}.test.js')]+([str(arg)] if arg else [])
    r=subprocess.run(cmd,check=True,text=True,capture_output=True,encoding='utf-8')
    results['tests'][name]=r.stdout.strip();print(name+': '+r.stdout.strip(),flush=True)
native_env=dict(os.environ,BMW_NATIVE_PREVIEW='1',BMW_PREVIEW_DIR=str(out/'previews'))
r=subprocess.run(['node',str(project/'tests/app-startup.test.js'),str(base/'app.js')],check=True,text=True,capture_output=True,encoding='utf-8',env=native_env)
results['tests']['native-renderer-controller']=r.stdout.strip();print(r.stdout,flush=True)
pkg=json.loads((extract/'source/package.json').read_text())
assert pkg['version']=='0.9.29' and pkg['productName']=='SpeedCAM' and pkg['mguAppStartType']=='autostart'
ui=json.loads((extract/'source/rhmiData/uiDescriptions/ID7/uiDescription.json').read_text())
assert ui['containers']['9000']['name']=='SPEEDCAM_POPUP'
assert (extract/'rhmiData/resources/aurelm_speed_camera_warning_icon.png').read_bytes()==(project/'apps/aurelm_speed_camera_warning/icon.png').read_bytes()
app_text=(base/'app.js').read_text(encoding='utf-8')
assert 'demoFrame' not in app_text and 'emulator-strelka-200' not in app_text
voice=project/'native/bmwcaminfo-voice'
audio_manifest=json.loads((voice/'audio-manifest.json').read_text(encoding='utf-8'))
for filename in audio_manifest:
    subprocess.run([os.environ.get('FFMPEG','ffmpeg'),'-v','error','-xerror','-i',str(voice/'audio'/filename),'-f','null','-'],check=True,capture_output=True)
results['audio_decode']='All eight AAC recordings decoded without errors'
for image in (out/'previews').glob('*.png'):shutil.copy2(image,out/image.name)
for filename in ['strelka.m4a','avtodoria.m4a','avtodoria-average.m4a']:shutil.copy2(voice/'audio'/filename,out/filename)
shutil.copy2(meta/'INSTRUCTION_RU.txt',out/'INSTRUCTION_RU.txt')
shutil.copy2(project/'DATA-NOTICE.txt',out/'DATA-NOTICE.txt')
files=json.loads((meta/'source-files.json').read_text(encoding='utf-8'))
with zipfile.ZipFile(out/'SpeedCAM_0.9.29_Source.zip','w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for name in sorted(files):z.write(root/name,name)
with zipfile.ZipFile(out/'SpeedCAM_0.9.29_Source.zip') as z:assert z.testzip() is None
(out/'TEST-RESULTS.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
checks={p.name:{'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size} for p in sorted(out.iterdir()) if p.is_file() and p.name!='BUILD-CHECKSUMS.json'}
(out/'BUILD-CHECKSUMS.json').write_text(json.dumps(checks,indent=2),encoding='utf-8')
print('Release packages, source archive and checksums verified.',flush=True)
