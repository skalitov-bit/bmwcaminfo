"""Verify rebuilt packages against tested local files, then prepare release assets."""
from pathlib import Path
import hashlib, json, shutil, subprocess, tarfile, zipfile

root=Path(__file__).resolve().parents[1]
meta=root/'.release/0.9.7'
out=root/'release097'
project=root/'bmw-speed-camera-warning'
expected=json.loads((meta/'expected-package-files.json').read_text(encoding='utf-8'))
extract=root/'verify097'
extract.mkdir(exist_ok=True)
for ext,wanted in expected.items():
    with tarfile.open(out/f'aurelm_speed_camera_warning@0.9.7.{ext}', 'r:gz') as archive:
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
results={'version':'0.9.7','hardware_test':False,'package_file_hashes':'match locally tested MGU and TGZ','packaged_tests':{}}
base=extract/'source/javascript'
for name,arg in [('hud-blink',base),('hud-labels',base),('app-startup',base/'app.js'),('hybrid-catalog',base)]:
    result=subprocess.run(['node',str(project/f'tests/{name}.test.js'),str(arg)],check=True,text=True,capture_output=True)
    print(name+': '+result.stdout)
    results['packaged_tests'][name]={'status':'passed','output':result.stdout.strip()}
for name in ['HUD_Strelka.png','HUD_Strelka_Blink.gif','Инструкция_0.9.7.txt']:
    shutil.copy2(meta/name,out/name)
shutil.copy2(project/'DATA-NOTICE.txt',out/'DATA-NOTICE.txt')
files=subprocess.check_output(['git','ls-files','-z'],cwd=root).decode().split('\0')
with zipfile.ZipFile(out/'BMWCamInfo_0.9.7_Source.zip','w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for name in sorted(n for n in files if n and (n.startswith('bmw-speed-camera-warning/') or n.startswith('.release/') or n=='.github/workflows/release-0.9.7.yml' or n=='LICENSE')):
        z.write(root/name,name)
with zipfile.ZipFile(out/'BMWCamInfo_0.9.7_Source.zip') as z:
    assert z.testzip() is None
(out/'TEST-RESULTS.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
checks={p.name:{'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size} for p in sorted(out.iterdir()) if p.is_file() and p.name!='BUILD-CHECKSUMS.json'}
(out/'BUILD-CHECKSUMS.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(checks,ensure_ascii=False,indent=2))
