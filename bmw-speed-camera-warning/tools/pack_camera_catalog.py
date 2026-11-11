#!/usr/bin/env python3
"""Prepare a disk-backed camera catalog on the build host, never on the MGU."""
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FILES = ('camera-records-v1.jsonl', 'camera-index-v1.json', 'camera-manifest-v1.json')

def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')

def pack(root=ROOT):
    source = json.loads((root/'data/camera-db.json').read_text(encoding='utf-8'))
    if source.get('datasetId') != 'mapcam-rus-v2' or source.get('warningSchemaVersion') != 1:
        raise ValueError('Incompatible MapCam source')
    cameras = source['cities']['russia']
    if not 50000 <= len(cameras) <= 200000:
        raise ValueError('Incomplete or oversized Russia database')
    app = root/'apps/aurelm_speed_camera_warning'
    records_path = app/FILES[0]
    offsets, cells, long_paths, ids = [], {}, [], {}
    with records_path.open('wb') as out:
        for i, camera in enumerate(cameras):
            if camera['id'] in ids:
                raise ValueError('Duplicate camera id')
            ids[camera['id']] = i
            raw = encode(camera) + b'\n'
            if len(raw) > 256*1024:
                raise ValueError('Camera record too large')
            offsets.append([out.tell(), len(raw)])
            out.write(raw)
            keys = {(math.floor(camera['lat']/0.1), math.floor(camera['lon']/0.1))}
            points = camera.get('mapcamPath', [])
            for a, b in zip(points, points[1:]):
                y0, y1 = math.floor(min(a[0], b[0])/0.1), math.floor(max(a[0], b[0])/0.1)
                x0, x1 = math.floor(min(a[1], b[1])/0.1), math.floor(max(a[1], b[1])/0.1)
                if (y1-y0+1)*(x1-x0+1) > 2000:
                    long_paths.append(i)
                    break
                keys.update((y, x) for y in range(y0, y1+1) for x in range(x0, x1+1))
            for y, x in sorted(keys):
                cells.setdefault(f'{y}:{x}', []).append(i)
    cities = {name: [ids[c['id']] for c in rows] for name, rows in source['cities'].items() if name != 'russia'}
    index = dict(schemaVersion=1, cellSize=0.1, records=offsets, cells=cells, longPaths=long_paths, cities=cities)
    index_raw = encode(index)
    (app/FILES[1]).write_bytes(index_raw)
    manifest = {key: source[key] for key in ('datasetId', 'warningSchemaVersion', 'revision', 'contentHash', 'updatedAt', 'attribution')}
    manifest.update(schemaVersion=1, format='mapcam-indexed-v1', count=len(cameras),
                    cityCounts={k: len(v) for k, v in source['cities'].items()})
    for key, filename in [('records', FILES[0]), ('index', FILES[1])]:
        raw = (app/filename).read_bytes()
        manifest[key] = dict(file=filename, bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest())
    if len(index_raw) > 12*1024*1024 or sum(manifest[k]['bytes'] for k in ('records', 'index')) > 64*1024*1024:
        raise ValueError('Catalog exceeds MGU disk/memory budget')
    (app/FILES[2]).write_bytes(encode(manifest))
    for filename in FILES:
        (root/'data'/filename).write_bytes((app/filename).read_bytes())
    return manifest

if __name__ == '__main__':
    print(json.dumps(pack(), ensure_ascii=False, indent=2))
