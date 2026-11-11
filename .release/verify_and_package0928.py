"""Verify rebuilt packages against tested local files, then prepare release assets."""
from pathlib import Path
import hashlib, json, shutil, subprocess, tarfile, zipfile, os

root=Path(__file__).resolve().parents[1]
meta=root/'.release/0.9.28'
out=Path(os.environ.get('SPEEDCAM_RELEASE_OUT',str(root/'release0928')))
project=root/'bmw-speed-camera-warning'
expected=json.loads((meta/'expected-package-files.json').read_text(encoding='utf-8'))
extract=root/'verify0928'
extract.mkdir(exist_ok=True)
for ext,wanted in expected.items():
    with tarfile.open(out/f'aurelm_speed_camera_warning@0.9.28.{ext}', 'r:gz') as archive:
        actual={}
        for m in archive.getmembers():
            if not m.isfile():
                raise ValueError('Unexpected non-file tar entry: '+m.name)
            actual[m.name]={'sha256':hashlib.sha256(archive.extractfile(m).read()).hexdigest(),'mode':m.mode,'size':m.size}
        if actual!=wanted:
            differences=[k for k in actual.keys()|wanted.keys() if actual.get(k)!=wanted.get(k)]
            raise ValueError(f'{ext} differs from tested package: {differences}')
        if ext=='mgu':
            archive.extractall(extract, filter='data')
results={'version':'0.9.28','hardware_test':False,'package_file_hashes':'match locally tested MGU and TGZ','packaged_tests':{}}
base=extract/'source/javascript'
for name,arg in [('hud-blink',base),('hud-labels',base),('app-startup',base/'app.js'),('hybrid-catalog',base),('notification-types',base)]:
    result=subprocess.run(['node',str(project/f'tests/{name}.test.js'),str(arg)],check=True,text=True,capture_output=True)
    print(name+': '+result.stdout)
    results['packaged_tests'][name]={'status':'passed','output':result.stdout.strip()}
native_env=dict(os.environ,BMW_NATIVE_PREVIEW='1',BMW_PREVIEW_DIR=str(root/'native-previews'))
native_result=subprocess.run(['node',str(project/'tests/app-startup.test.js'),str(base/'app.js')],check=True,text=True,capture_output=True,env=native_env)
results['packaged_tests']['native-renderer']={'status':'passed','output':native_result.stdout.strip()}
print(native_result.stdout)
for name in ['hybrid-memory','mapcam-warnings','road-guidance','voice-queue']:
    command=['node']+(['--max-old-space-size=64'] if name=='hybrid-memory' else [])+[str(project/f'tests/{name}.test.js')]
    result=subprocess.run(command,check=True,text=True,capture_output=True)
    results['packaged_tests'][name]={'status':'passed','output':result.stdout.strip()}
    print(name+': '+result.stdout)
assert json.loads((extract/'meta.json').read_text())['title']=='SpeedCAM'
assert json.loads((extract/'source/package.json').read_text())['productName']=='SpeedCAM'
assert (extract/'rhmiData/resources/aurelm_speed_camera_warning_icon.png').read_bytes()==(project/'apps/aurelm_speed_camera_warning/icon.png').read_bytes()
app_text=(base/'app.js').read_text(encoding='utf-8')
assert 'demoFrame' not in app_text and 'emulator-strelka-200' not in app_text
for image in (root/'native-previews').glob('*.png'): shutil.copy2(image,out/image.name)
shutil.copy2(meta/'INSTRUCTION_RU.txt',out/'INSTRUCTION_RU.txt')
shutil.copy2(project/'DATA-NOTICE.txt',out/'DATA-NOTICE.txt')
files=json.loads((meta/'source-files.json').read_text())
with zipfile.ZipFile(out/'SpeedCAM_0.9.28_Source.zip','w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for name in sorted(n for n in files if n and (n.startswith('bmw-speed-camera-warning/') or n.startswith('.release/0.9.28/') or n in ('.release/verify_and_package0928.py','.release/publish0928.py') or n=='.github/workflows/release-0.9.28.yml' or n=='LICENSE')):
        z.write(root/name,name)
with zipfile.ZipFile(out/'SpeedCAM_0.9.28_Source.zip') as z:
    assert z.testzip() is None
(out/'TEST-RESULTS.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
checks={p.name:{'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size} for p in sorted(out.iterdir()) if p.is_file() and p.name!='BUILD-CHECKSUMS.json'}
(out/'BUILD-CHECKSUMS.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(checks,ensure_ascii=False,indent=2))
