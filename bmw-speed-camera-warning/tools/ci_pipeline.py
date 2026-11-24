"""Read-only CI: build checked-out code with pinned resources, verify separate maps.

No release, tag, catalog, database or audio generation/publishing operations.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
import tarfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
APP = ROOT / 'apps/aurelm_speed_camera_warning'
LOCK = ROOT / 'tools/ci-inputs.json'
MAX_DOWNLOAD = 128 * 1024 * 1024


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def verify(raw, item):
    if len(raw) != item['bytes'] or digest(raw) != item['sha256']:
        raise ValueError('Input size/SHA-256 mismatch')
    return raw


def download(url, limit):
    if not url.startswith(('https://github.com/skalitov-bit/', 'https://raw.githubusercontent.com/skalitov-bit/')):
        raise ValueError('Unexpected input origin')
    req = urllib.request.Request(url, headers={'User-Agent': 'SpeedCAM-CI', 'Cache-Control': 'no-cache'})
    with urllib.request.urlopen(req, timeout=120) as response:
        if response.status != 200:
            raise ValueError('HTTP status ' + str(response.status))
        raw = response.read(limit + 1)
    if len(raw) > limit:
        raise ValueError('Input exceeds limit')
    return raw


def cached(item, cache):
    cache.mkdir(parents=True, exist_ok=True)
    file = cache / item['sha256']
    if file.exists():
        # A corrupt cache is an error, never trusted just because it exists.
        verify(file.read_bytes(), item)
    else:
        raw = verify(download(item['url'], min(item['bytes'], MAX_DOWNLOAD)), item)
        temp = file.with_suffix('.part')
        temp.write_bytes(raw)
        temp.replace(file)
    return file


def resource_target(path):
    p = PurePosixPath(path)
    if p.is_absolute() or '..' in p.parts or '\\' in path or ':' in path:
        raise ValueError('Unsafe resource path')
    # Hydration must not overwrite source code or version/configuration.
    allowed = {
        'apps/aurelm_speed_camera_warning/' + name for name in
        ('city-map.json', 'road-zones.json', 'hybrid-index-v1.bin', 'hybrid-records-v1.bin', 'icon.png')
    } | {'assets/fonts/RobotoCondensed-OFL.txt'}
    if path not in allowed:
        raise ValueError('Not an approved binary/data resource')
    return ROOT / path


def hydrate(lock, cache):
    archive = cached(lock['source'], cache)
    with zipfile.ZipFile(archive) as z:
        for item in lock['resources']:
            destination = resource_target(item['path'])
            raw = verify(z.read(item['member']), item)
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(raw)


def payload(file):
    result = {}
    with tarfile.open(file) as t:
        for m in t:
            p = PurePosixPath(m.name)
            if p.is_absolute() or '..' in p.parts or m.issym() or m.islnk():
                raise ValueError('Unsafe package member')
            if m.isfile():
                if m.name in result:
                    raise ValueError('Duplicate package member')
                result[m.name] = t.extractfile(m).read()
    return result


def run(args, result, name, cwd=ROOT):
    p = subprocess.run([str(a) for a in args], cwd=cwd, capture_output=True,
                       text=True, encoding='utf8', errors='replace', timeout=240)
    result['checks'][name] = {'exit': p.returncode, 'stdout': p.stdout, 'stderr': p.stderr}
    print(('PASS ' if not p.returncode else 'FAIL ') + name, flush=True)
    if p.returncode:
        raise RuntimeError(name + '\n' + p.stdout + '\n' + p.stderr)


def build(lock, out, cache, node, node8, result):
    app = json.loads((APP / 'app.json').read_text('utf8'))
    component = json.loads((ROOT / 'native/bmwcaminfo-voice/component.json').read_text('utf8'))
    if app['version'] != lock['appVersion'] or component['version'] != lock['voiceVersion']:
        raise ValueError('Update the reviewed input lock when package versions change')
    hydrate(lock, cache)
    voice = cached(lock['voice'], cache)
    voice_out = out / ('bmwcaminfo-voice@' + lock['voiceVersion'] + '.tgz')
    shutil.copyfile(voice, voice_out)
    result['voiceReusedUnchanged'] = digest(voice_out.read_bytes()) == lock['voice']['sha256']
    # Regression fixtures use the approved PCM/M4A samples, never synthesized audio.
    voice_files = payload(voice)
    for name, raw in voice_files.items():
        p = PurePosixPath(name)
        if len(p.parts) >= 3 and p.parts[0] == 'files' and p.parts[1] in ('pcm', 'audio') and p.suffix in ('.pcm', '.m4a'):
            target = ROOT / 'native/bmwcaminfo-voice' / Path(*p.parts[1:])
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(raw)
    for file in sorted(APP.glob('*.js')):
        run([node8, '--check', file], result, 'node8-syntax-' + file.name)
    for test in ('bmw-position', 'gps-assembly', 'gps-diagnostics', 'map-projection', 'map-position-loss',
                 'road-guidance', 'approach-trajectory', 'adjacent-roads', 'trajectory-curve',
                 'vehicle-motion', 'region-cache', 'manual-launch', 'manual-supervisor',
                 'overspeed-beeper', 'notification-priority', 'hud-spacing', 'menu-selection',
                 'pulse-music-duck', 'mixer-settings', 'overlay-runtime'):
        run([node, 'tests/' + test + '.test.js'], result, test)
    run([node8, 'tests/country-maps.test.js'], result, 'country-maps-node8')
    run([sys.executable, 'tools/build_local.py', '--out', out, '--cache', cache / 'runtime'], result, 'build-app')
    run([sys.executable, 'tools/build_store_catalog.py', '--artifacts', out, '--out', out / 'store'], result, 'store-catalog')
    built = out / ('aurelm_speed_camera_warning@' + app['version'] + '.tgz')
    files = payload(built)
    pkg = json.loads(files['package/package.json'])
    assert pkg['version'] == app['version'] and pkg['mguInternet'] is True
    for name in ('city-roads.js', 'city-map-store.js', 'city-map-panel.js', 'city-map-renderer.js', 'hybrid-index-v1.bin', 'hybrid-records-v1.bin'):
        assert 'package/javascript/' + name in files, name
    assert not any(n.endswith('.scroads') for n in files), 'Regional maps must stay separate'
    assert 'package/javascript/camera-db.json' not in files
    # Compare payloads, not gzip timestamps. Record legitimate future code changes.
    reference = payload(cached(lock['referenceApp'], cache))
    result['payloadChangesVs092'] = [n for n in sorted(files.keys() | reference.keys()) if files.get(n) != reference.get(n)]
    js = out / 'unpacked/package/javascript'
    for name, raw in files.items():
        target = out / 'unpacked' / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
    run([node, 'tests/app-startup.test.js', js / 'app.js'], result, 'built-startup')
    for test in ('manual-bridge', 'region-integration', 'gpu-store-runtime', 'png-handoff',
                 'gpu-input-recovery', 'controller-recovery', 'display-recovery-menu',
                 'render-recovery', 'responsive-display', 'lifecycle-bridge'):
        run([node, 'tests/' + test + '.test.js', js], result, 'built-' + test)
    for test in ('city-map-overlap', 'city-map-scroll'):
        run([node8, 'tests/' + test + '.test.js', js], result, 'built-' + test)
    env_before = os.environ.get('BMW_GPU_WIRE')
    try:
        os.environ['BMW_GPU_WIRE'] = '1'
        run([node, 'tests/app-startup.test.js', js / 'app.js'], result, 'built-gpu-touch-joystick')
    finally:
        if env_before is None:
            os.environ.pop('BMW_GPU_WIRE', None)
        else:
            os.environ['BMW_GPU_WIRE'] = env_before
    run([sys.executable, 'tests/no-native-bar.py', out], result, 'no-native-bar')
    catalog = json.loads((out / 'store/catalog.json').read_text('utf8'))
    assert len(catalog['components']) == 2
    for row in catalog['components']:
        artifact = row['artifact']
        verify((out / artifact['name']).read_bytes(), {'bytes': artifact['size'], 'sha256': artifact['sha256']})
    assert catalog['components'][0]['requires']['bmwcaminfo-voice'] == lock['voiceVersion']
    result['version'] = app['version']


def maps(lock, out, node, result):
    raw = download(lock['mapsCatalog'], 512 * 1024)
    (out / 'catalog.json').write_bytes(raw)
    # Apply the application's real catalog URL, hash, filename and size validation.
    validator = "const fs=require('fs');require('./apps/aurelm_speed_camera_warning/city-map-store').validateCatalog(JSON.parse(fs.readFileSync(process.argv[1])));"
    run([node, '-e', validator, out / 'catalog.json'], result, 'app-catalog-validation')
    catalog = json.loads(raw)
    selected = [e for e in catalog['cities'] if e['id'] in ('moscow', 'saint-petersburg')]
    assert {e['id'] for e in selected} == {'moscow', 'saint-petersburg'}
    result['maps'] = []
    for entry in selected:
        data = verify(download(entry['url'], min(entry['bytes'], 64 * 1024 * 1024)), entry)
        (out / entry['file']).write_bytes(data)
        result['maps'].append({'id': entry['id'], 'http': 200, 'bytes': len(data), 'sha256': digest(data)})
    # Narrow the fixture catalog to downloaded entries; the original catalog SHA remains recorded.
    result['catalogSha256'] = digest(raw)
    catalog['cities'] = sorted(selected, key=lambda e: e['id'])
    (out / 'catalog.json').write_text(json.dumps(catalog), encoding='utf8')
    run([node, 'tests/city-maps.test.js', out], result, 'offline-install-update-delete')
    run([node, 'tests/city-maps-regions.test.js', out], result, 'regional-coverage')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('task', choices=('build', 'maps'))
    parser.add_argument('--node', default='node')
    parser.add_argument('--node8', default=os.environ.get('NODE8', 'node'))
    args = parser.parse_args()
    lock = json.loads(LOCK.read_text('utf8'))
    out = REPO / 'ci-output' / args.task
    out.mkdir(parents=True, exist_ok=True)
    result = {'allPassed': False, 'publicationEnabled': False, 'realMGUTested': False, 'checks': {}}
    try:
        if args.task == 'build':
            build(lock, out, REPO / '.ci-cache', args.node, args.node8, result)
        else:
            maps(lock, out, args.node, result)
        result['allPassed'] = True
    except Exception as e:
        result['error'] = str(e)
        raise
    finally:
        (out / 'CHECKS.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf8')


if __name__ == '__main__':
    main()
