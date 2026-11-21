#!/usr/bin/env python3
"""Pack the native service using the MGU Store tool-artifact format, with file hashes."""
import argparse
import hashlib
import io
import json
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / 'native/bmwcaminfo-voice'

def pack(out, root=ROOT):
    from elf_check import verify_mgu_elf
    if (root / 'pulse-runtime.js').exists():
        from pulse_bundle import verify
        verify(root / 'pulse')
    helper = (root / 'alsa-probe').read_bytes()
    verify_mgu_elf(helper)
    if (root / 'stable-output.js').exists() and b'--stream-converter-stable' not in helper:
        raise ValueError('Rebuild alsa-probe: stable output requires the native mixer')
    if '--stream-converter-direct' in (root / 'stable-output.js').read_text(encoding='utf-8') and b'--stream-converter-direct' not in helper:
        raise ValueError('Rebuild alsa-probe: direct SmartX test requires the updated native helper')
    if '--play-converter' in (root / 'alsa-diagnostics.js').read_text(encoding='utf-8'):
        if b'--stream-converter' not in helper or b'--check-converter' not in helper:
            raise ValueError('Rebuild alsa-probe: Converter UI requires the updated native helper')
    if b'--stream-converter-period' not in helper or b'converterProfilesProtocol' not in helper:
        raise ValueError('Rebuild alsa-probe: Converter profiles require the new native helper')
    if (root / 'mixer-settings.js').exists() and b'mixerSettingsProtocol' not in helper:
        raise ValueError('Rebuild alsa-probe: independent mixer gains require protocol 7')
    c = json.loads((root / 'component.json').read_text(encoding='utf-8'))
    import re
    runtime = (root/'voice.js').read_text(encoding='utf-8')
    declared = re.search(r"const SERVICE_VERSION='([^']+)';", runtime)
    if declared and declared.group(1) != c['version']:
        raise ValueError('Runtime/component version mismatch')
    manifest = {k: c[k] for k in ('id', 'kind', 'version', 'title', 'description', 'enable', 'restart', 'mguHmi', 'crashNames')}
    for key in ('requires', 'uninstallable', 'optional', 'license'):
        if key in c:
            manifest[key] = c[key]
    manifest.update(files=[], units=[], recmgr=[])
    entries = {}
    for f in c['files']:
        data = (root / f.get('from', f['path'])).read_bytes()
        manifest['files'].append({'path': f['path'], 'mode': f['mode'], 'sha256': hashlib.sha256(data).hexdigest()})
        entries['files/' + f['path']] = (data, int(f['mode'], 8))
    for unit in c['units']:
        manifest['units'].append({'name': unit['name']})
        entries['units/' + unit['name']] = ((root / unit['from']).read_bytes(), 0o644)
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
    return target

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True, type=Path)
    pack(parser.parse_args().out)
