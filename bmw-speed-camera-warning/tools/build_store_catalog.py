#!/usr/bin/env python3
"""Build MGU Store schema-2 catalogs from the actual release artifacts.

Publish artifacts first, then catalog.json in a GitHub release tagged catalog.
No firmware hooks, installer EXE, keys, or credentials are required.
"""
import argparse
import hashlib
import json
import re
import shutil
import tarfile
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
APP_ID = 'aurelm_speed_camera_warning'
VOICE_ID = 'bmwcaminfo-voice'


def read_json_member(file, member):
    with tarfile.open(file, 'r:gz') as archive:
        entries = [m for m in archive.getmembers() if m.name == member]
        if len(entries) != 1 or not entries[0].isfile():
            raise ValueError('Missing/duplicate manifest: ' + member)
        return json.load(archive.extractfile(entries[0]))


def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def build(artifacts, out, repo='skalitov-bit/bmwcaminfo'):
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repo):
        raise ValueError('Expected GitHub owner/repository')
    app = json.loads((ROOT / 'apps' / APP_ID / 'app.json').read_text(encoding='utf-8'))
    voice = json.loads((ROOT / 'native' / VOICE_ID / 'component.json').read_text(encoding='utf-8'))
    appfile = artifacts / (APP_ID + '@' + app['version'] + '.tgz')
    voicefile = artifacts / (VOICE_ID + '@' + voice['version'] + '.tgz')
    pkg = read_json_member(appfile, 'package/package.json')
    svc = read_json_member(voicefile, 'component.json')
    if (pkg['name'], pkg['version']) != (APP_ID, app['version']):
        raise ValueError('Application package does not match source')
    if (svc['id'], svc['kind'], svc['version']) != (VOICE_ID, 'tool', voice['version']):
        raise ValueError('Voice package does not match source')
    if svc.get('requires') != voice.get('requires'):
        raise ValueError('Voice artifact is missing its installer requirements; rebuild it')
    tag = APP_ID + '@' + app['version']
    base = 'https://github.com/' + repo + '/releases/download/' + quote(tag, safe='') + '/'
    def entry(file, id, version, kind, title, description, requires, optional=False):
        return dict(id=id, kind=kind, version=version, title=title,
                    description=description, author='skalitov-bit',
                    artifact=dict(name=file.name, size=file.stat().st_size,
                                  sha256=digest(file), url=base + quote(file.name, safe='')),
                    requires=requires, optional=optional, uninstallable=True, mguHmi=['ID7'])
    rows = [
        entry(appfile, APP_ID, app['version'], 'app', 'SpeedCAM',
              'Камеры, HUD, приборная панель и голосовые уведомления. Звуковой сервис устанавливается автоматически.',
              {VOICE_ID: voice['version']}),
        entry(voicefile, VOICE_ID, voice['version'], 'tool', 'SpeedCAM — звуковой сервис',
              'Голосовые уведомления и бипер SpeedCAM. Устанавливается магазином вместе с приложением.',
              voice.get('requires', {}), True),
    ]
    icon = ROOT / 'apps' / APP_ID / 'icon.png'
    if not icon.is_file() or icon.stat().st_size > 128 * 1024 or icon.read_bytes()[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('Store icon must be a PNG of at most 128 KiB')
    rows[0].update(icon='SpeedCAM.png', iconSha256=digest(icon))
    out.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(icon, out / 'SpeedCAM.png')
    catalog = dict(schema=2, components=rows)
    (out / 'catalog.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    # USB is an offline copy of the same source, so later online updates keep their origin.
    usb = out / 'usb' / 'mgu-repo' / 'speedcam'
    usb.mkdir(parents=True, exist_ok=True)
    local = json.loads(json.dumps(catalog))
    for row, file in zip(local['components'], (appfile, voicefile)):
        row['artifact']['url'] = file.name
        shutil.copyfile(file, usb / file.name)
    shutil.copyfile(icon, usb / 'SpeedCAM.png')
    (usb / 'catalog.json').write_text(json.dumps(local, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (usb / 'mgu-copy.json').write_text(json.dumps({'copyOf': 'github:' + repo}) + '\n', encoding='utf-8')
    return catalog


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifacts', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--repo', default='skalitov-bit/bmwcaminfo')
    args = parser.parse_args()
    catalog = build(args.artifacts, args.out, args.repo)
    print(json.dumps({'catalog': str(args.out / 'catalog.json'),
                      'components': [(c['id'], c['version']) for c in catalog['components']]}, ensure_ascii=False))
