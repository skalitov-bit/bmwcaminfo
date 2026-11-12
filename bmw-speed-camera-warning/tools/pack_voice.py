#!/usr/bin/env python3
"""Pack the native service using the MGU Store tool-artifact format, with file hashes."""
import argparse
import hashlib
import io
import json
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / 'native/bmwcaminfo-voice'

def pack(out):
    c = json.loads((ROOT / 'component.json').read_text(encoding='utf-8'))
    manifest = {k: c[k] for k in ('id', 'kind', 'version', 'title', 'description', 'enable', 'restart', 'mguHmi', 'crashNames')}
    manifest.update(files=[], units=[], recmgr=[])
    entries = {}
    for f in c['files']:
        data = (ROOT / f.get('from', f['path'])).read_bytes()
        manifest['files'].append({'path': f['path'], 'mode': f['mode'], 'sha256': hashlib.sha256(data).hexdigest()})
        entries['files/' + f['path']] = (data, int(f['mode'], 8))
    for unit in c['units']:
        manifest['units'].append({'name': unit['name']})
        entries['units/' + unit['name']] = ((ROOT / unit['from']).read_bytes(), 0o644)
    entries['component.json'] = ((json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode(), 0o644)
    out.mkdir(parents=True, exist_ok=True)
    target = out / (c['id'] + '@' + c['version'] + '.tgz')
    with tarfile.open(target, 'w:gz', format=tarfile.USTAR_FORMAT) as archive:
        for name, (data, mode) in sorted(entries.items()):
            info = tarfile.TarInfo(name)
            info.size, info.mode, info.mtime = len(data), mode, 0
            archive.addfile(info, io.BytesIO(data))
    with tarfile.open(target) as archive:
        for f in manifest['files']:
            assert hashlib.sha256(archive.extractfile('files/' + f['path']).read()).hexdigest() == f['sha256']
    print(target)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True, type=Path)
    pack(parser.parse_args().out)
