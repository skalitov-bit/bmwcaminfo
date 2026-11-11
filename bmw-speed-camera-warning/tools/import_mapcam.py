#!/usr/bin/env python3
"""Replace the app database with a verified MapCam BMW Updater export, offline."""
import argparse
import hashlib
import json
import math
from pathlib import Path, PurePosixPath
import sqlite3
import struct
import tempfile
import zipfile
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / 'apps' / 'aurelm_speed_camera_warning'
NAMES = {1: 'Стационарная камера скорости', 2: 'Встроенная камера',
         3: 'Контроль проезда на красный', 4: 'Контроль средней скорости',
         5: 'Мобильная камера', 6: 'Мобильный пост контроля скорости',
         7: 'Мобильный пост контроля обгона', 8: 'Мобильный пост контроля STOP',
         9: 'Мобильный пост контроля перехода', 11: 'Камера полосы транспорта',
         13: 'Комплекс контроля ПДД', 15: 'Камера оплаты проезда',
         16: 'Камера остановки и стоянки'}

def decode_geometry(encoded, lat, lon):
    """MC85 uses signed latitude/longitude deltas from a float32 origin (1e-5 deg).

    Verified against native 3bd60 -> 3b164/3b1b0 -> 3c818/3c95c.
    Reject malformed records rather than inventing a road or dropping their path.
    """
    if not encoded:
        return []
    if not isinstance(encoded, str) or len(encoded) > 4095:
        raise ValueError('Invalid MapCam geometry length')
    f32 = lambda n: struct.unpack('<f', struct.pack('<f', n))[0]
    latitude, longitude = int(f32(lat)*100000), int(f32(lon)*100000)
    points, pos = [[lat, lon]], 0
    def delta():
        nonlocal pos
        value, shift = 0, 0
        while True:
            if pos >= len(encoded) or shift > 30:
                raise ValueError('Truncated MapCam geometry')
            byte = ord(encoded[pos])-63
            pos += 1
            if not 0 <= byte <= 63:
                raise ValueError('Invalid MapCam geometry character')
            value |= (byte & 31) << shift
            if byte < 32:
                return ~(value >> 1) if value & 1 else value >> 1
            shift += 5
    while pos < len(encoded):
        latitude += delta()
        longitude += delta()
        point = [latitude/100000, longitude/100000]
        if not -90 <= point[0] <= 90 or not -180 <= point[1] <= 180:
            raise ValueError('MapCam geometry coordinate out of bounds')
        if point != points[-1]:
            points.append(point)
    return points if len(points) >= 2 else []

def inside_ring(lon, lat, ring):
    inside = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > lat) != (y2 > lat) and lon < (x2-x1)*(lat-y1)/(y2-y1)+x1:
            inside = not inside
    return inside

def inside(lon, lat, geometry):
    polys = geometry['coordinates'] if geometry['type'] == 'MultiPolygon' else [geometry['coordinates']]
    if '_bounds' not in geometry:
        geometry['_bounds'] = [(min(x for x,y in p[0]), min(y for x,y in p[0]),
                                max(x for x,y in p[0]), max(y for x,y in p[0])) for p in polys]
    return any(w <= lon <= e and s <= lat <= n and inside_ring(lon, lat, p[0]) and
               not any(inside_ring(lon, lat, h) for h in p[1:])
               for p, (w,s,e,n) in zip(polys, geometry['_bounds']))

def load_export(archive_path):
    with zipfile.ZipFile(archive_path) as z:
        names = z.namelist()
        current = [n for n in names if PurePosixPath(n).name == 'current.json']
        if len(current) == 1:
            manifest = json.loads(z.read(current[0]))
            relative = PurePosixPath(manifest['sqlite'])
            if relative.is_absolute() or '..' in relative.parts:
                raise ValueError('Unsafe current.json path')
            member = str(PurePosixPath(current[0]).parent / relative)
        else:
            candidates = [n for n in names if PurePosixPath(n).name == 'manifest.json']
            databases = [n for n in names if n.endswith('.sqlite')]
            if current or len(candidates) != 1 or len(databases) != 1:
                raise ValueError('Export must select exactly one database')
            manifest = json.loads(z.read(candidates[0]))
            member = databases[0]
        if z.getinfo(member).file_size > 256 * 1024 * 1024:
            raise ValueError('SQLite exceeds size limit')
        raw = z.read(member)
    if manifest.get('schema_version') != 2:
        raise ValueError('Unsupported Updater manifest')
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp) / 'input.sqlite'
        p.write_bytes(raw)
        con = sqlite3.connect(p.as_uri() + '?mode=ro', uri=True)
        try:
            if con.execute('PRAGMA integrity_check').fetchone() != ('ok',):
                raise ValueError('SQLite integrity failure')
            meta = dict(con.execute('SELECT key,value FROM metadata'))
            count = con.execute('SELECT count(*) FROM poi').fetchone()[0]
            con.row_factory = sqlite3.Row
            rows = [dict(r) for r in con.execute("SELECT * FROM poi WHERE camera_family IN ('fixed','mobile') ORDER BY id")]
        finally:
            con.close()
    timestamp = datetime.fromisoformat(manifest['revision_utc'].replace('Z', '+00:00'))
    meta_timestamp = datetime.fromisoformat(meta['base_revision_utc'].replace('Z', '+00:00'))
    if timestamp.tzinfo is None or timestamp != meta_timestamp:
        raise ValueError('Revision mismatch')
    if (meta.get('file_is_truncated') != 'false' or count != manifest['count_all'] or
            len(rows) != manifest['count_cameras'] or count < 100000 or len(rows) < 50000):
        raise ValueError('Incomplete export or count mismatch')
    if timestamp > datetime.now(timezone.utc):
        raise ValueError('Future database revision')
    return rows, manifest, hashlib.sha256(raw).hexdigest()

def camera(row, revision):
    ident, lat, lon = row['id'], row['latitude'], row['longitude']
    limit, dt, heading = row['speed_limit_kmh'], row['direction_type'], row['approach_heading_deg']
    if (type(ident) is not int or ident < 1 or not all(math.isfinite(x) for x in (lat, lon)) or
            not -90 <= lat <= 90 or not -180 <= lon <= 180 or dt not in (0, 1, 2, 3) or
            (limit is not None and (type(limit) is not int or not 5 <= limit <= 250)) or
            (heading is not None and (not math.isfinite(heading) or not 0 <= heading < 360))):
        raise ValueError('Invalid camera record: ' + str(ident))
    travel = ([heading] if dt == 1 and heading is not None else
              [heading, (heading+180) % 360] if dt == 2 and heading is not None else [])
    name = NAMES[row['type_code']]
    sector = row.get('angle_code_raw', 60)
    if type(sector) is not int or not 0 <= sector <= 255:
        raise ValueError('Invalid MapCam sector width')
    return dict(id='mapcam-'+str(ident), name=name, type=name, limit=limit, lat=lat, lon=lon,
                source='MapCam.info', sourceLabel='MapCam.info · '+revision[:10], sourceUrl='https://mapcam.info/',
                mapcamId=ident, mapcamType=row['type_key'], mapcamDirectionType=dt,
                mapcamApproachHeadingDeg=heading, mapcamTravel=travel,
                mapcamWarningDistanceM=row['warning_distance_m'],
                mapcamTypeCode=row['type_code'], mapcamAngleDeg=sector,
                mapcamPath=decode_geometry(row.get('encoded_geometry', ''), lat, lon),
                mapcamControlDirection=row.get('control_direction'),
                mapcamHours=([row['hour_start'], row['hour_end']] if 'hour_start' in row else None),
                direction=';'.join(map(str, travel)))

def convert(archive_path, root=ROOT):
    rows, manifest, sqlite_hash = load_export(archive_path)
    stamp = datetime.fromisoformat(manifest['revision_utc'].replace('Z', '+00:00'))
    revision = int(stamp.timestamp())
    records = [camera(r, manifest['revision_utc']) for r in rows]
    if len({r['id'] for r in records}) != len(records):
        raise ValueError('Duplicate camera IDs')
    boundaries = json.loads((root/'data/region-boundaries.json').read_text(encoding='utf-8'))
    cities = {'russia': records}
    for key, geometry in boundaries['regions'].items():
        cities[key] = [r for r in records if inside(r['lon'], r['lat'], geometry)]
    payload = dict(schemaVersion=1, datasetId='mapcam-rus-v2', warningSchemaVersion=1, revision=revision,
                   updatedAt=stamp.isoformat().replace('+00:00', 'Z'), cities=cities,
                   attribution='MapCam.info; user-provided subscription export. Regional boundaries: © OpenStreetMap contributors, ODbL 1.0.',
                   provenance=dict(archive=Path(archive_path).name, sqliteSha256=sqlite_hash,
                                   sourceMc85Sha256=manifest['sha256'], totalObjects=manifest['count_all']),
                   sourceCounts={key: len(value) for key, value in cities.items()})
    # The canonical camera payload fingerprint binds cache updates to their geometry.
    payload['contentHash'] = hashlib.sha256(json.dumps(cities, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
    encoded = json.dumps(payload, ensure_ascii=False, separators=(',', ':'))
    destinations = [root/'data/camera-db.json', root/'apps/aurelm_speed_camera_warning/camera-db.json']
    for dest in destinations:
        if dest.exists():
            old = json.loads(dest.read_text(encoding='utf-8'))
            if old.get('datasetId') == payload['datasetId'] and old['revision'] > revision:
                raise ValueError('Refusing database rollback')
    for dest in destinations:
        temp = dest.with_suffix('.json.tmp')
        temp.write_text(encoded, encoding='utf-8')
        temp.replace(dest)
    print(json.dumps({'revision': revision, 'updatedAt': payload['updatedAt'], 'counts': payload['sourceCounts'],
                      'bytes': len(encoded.encode()), 'sqliteSha256': sqlite_hash}, ensure_ascii=False))
    from pack_camera_catalog import pack
    pack(root)
    return payload

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', nargs='?', type=Path, default=ROOT.parent/'BMW MapCam.zip')
    args = parser.parse_args()
    convert(args.archive)
