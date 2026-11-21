"""Compact, independently compressed spatial blocks for the MGU (no SQLite runtime)."""
import argparse, collections, hashlib, json, math, sqlite3, struct, zlib
from pathlib import Path
from datetime import datetime,timezone
from import_mapcam import inside,decode_geometry
ROOT=Path(__file__).resolve().parents[1]
SIZE=52;CELL=.05;MAX_COUNT=256;MAX_RAW=262144
FILES=('hybrid-records-v1.bin','hybrid-index-v1.bin','hybrid-manifest-v1.json')
def enc(x):return json.dumps(x,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode()
def h(x):return hashlib.sha256(x).hexdigest()
def optional(v,sentinel,scale=1):return sentinel if v is None else round(v*scale)
def pack(database,root=ROOT):
    con=sqlite3.connect(Path(database).resolve().as_uri()+'?mode=ro',uri=True);con.row_factory=sqlite3.Row
    if con.execute('pragma integrity_check').fetchone()[0]!='ok':raise ValueError('Invalid source SQLite')
    types={};models={str(r['code']):dict(r) for r in con.execute('select * from model_dictionary')}
    boundaries=json.loads((root/'data/region-boundaries.json').read_text(encoding='utf-8'))['regions']
    citybits={'yoshkar-ola':2,'mari-el':4};citycounts={'russia':0,'yoshkar-ola':0,'mari-el':0}
    cells=collections.defaultdict(list);revisions={};familycounts=collections.Counter();named=0
    for raw in con.execute('select * from poi order by id'):
        r=dict(raw);e=r['source']=='estrelka';revisions[r['source']]=r['source_revision']
        key=('e' if e else 'm')+str(r['type_code']);info=[r['type_key'],r['type_name_ru'],r['camera_family']]
        if key in types and types[key]!=info:raise ValueError('Ambiguous type dictionary')
        types[key]=info;warning=r['camera_family'] in ('fixed','mobile','dummy','weight_control')
        familycounts[r['camera_family']]+=1;named+=bool(r['camera_model'])
        flags=int(e);mask=0
        for city,bit in citybits.items():
            if inside(r['longitude'],r['latitude'],boundaries[city]):mask|=bit
        flags|=mask
        if warning:
            citycounts['russia']+=1
            for city,bit in citybits.items():citycounts[city]+=bool(mask&bit)
        geom=bytes.fromhex(r['estrelka_geometry_hex'] or '') if e else (struct.pack('<ff',r['latitude'],r['longitude'])+r['encoded_geometry'].encode('utf-8') if r['encoded_geometry'] else b'')
        lat=round(r['latitude']*1e7);lon=round(r['longitude']*1e7)
        heading=optional(r['approach_heading_deg'],65535,100);azi=optional(r['azimuth_deg'],65535,100)
        model=r['camera_model_code'] or 0
        if r['camera_model'] and models[str(model)]['name']!=r['camera_model']:raise ValueError('Model dictionary mismatch')
        # Native source flags and geometry are retained, never relabelled as MapCam.
        fields=[lat,lon,int(r['source_record_id']),r['type_code'],model,flags,r['speed_limit_kmh'] or 0,r['direction_type'],0,heading,r['warning_distance_m'] or 0,optional(r['estrelka_flags_raw'],65535),optional(r['estrelka_additional_distance_m'],4294967295),0,len(geom),optional(r['angle_code_raw'],65535),azi]
        ident=bytes.fromhex(r['id'][9:]) if e else bytes(12)
        assert len(ident)==12
        canonical=[r['id'],lat,lon,int(r['source_record_id']),r['type_namespace'],r['type_code'],r['camera_model'],r['camera_model_code'],r['speed_limit_kmh'],r['direction_type'],None if heading==65535 else heading,r['warning_distance_m'],r['estrelka_flags_raw'],r['estrelka_additional_distance_m'],r['angle_code_raw'],None if azi==65535 else azi,r['encoded_geometry'] or None,r['estrelka_geometry_hex'] or None]
        path=decode_geometry(r['encoded_geometry'],r['latitude'],r['longitude']) if not e and r['encoded_geometry'] else []
        cells[(math.floor(lat/1e7/CELL),math.floor(lon/1e7/CELL))].append((fields,ident,geom,path,warning,canonical))
    con.close()
    app=root/'apps/aurelm_speed_camera_warning';app.mkdir(parents=True,exist_ok=True)
    descriptors=[];pathcells=collections.defaultdict(set);longblocks=set();digest=hashlib.sha256();total=0
    with (app/FILES[0]).open('wb') as f:
        for cell,items in sorted(cells.items()):
            for start in range(0,len(items),MAX_COUNT):
                batch=items[start:start+MAX_COUNT];records=bytearray();geometry=bytearray();mask=0;warnings=0
                for fields,ident,geom,path,warning,canon in batch:
                    fields[13]=SIZE*len(batch)+len(geometry)
                    packed=struct.pack('<iiIHBBHBBHHHIIHHH',*fields)+ident
                    assert len(packed)==SIZE
                    records.extend(packed);geometry.extend(geom);mask|=fields[5]&6;warnings+=warning
                    digest.update(enc(canon)+b'\n');total+=1
                    for a,b in zip(path,path[1:]):
                        y0,y1=math.floor(min(a[0],b[0])/CELL),math.floor(max(a[0],b[0])/CELL)
                        x0,x1=math.floor(min(a[1],b[1])/CELL),math.floor(max(a[1],b[1])/CELL)
                        if (y1-y0+1)*(x1-x0+1)>2000:longblocks.add(len(descriptors));continue
                        for y in range(y0,y1+1):
                            for x in range(x0,x1+1):pathcells[f'{y}:{x}'].add(len(descriptors))
                raw=bytes(records+geometry)
                if len(raw)>MAX_RAW:raise ValueError('Block exceeds decompression limit')
                packed=zlib.compress(raw,9)
                descriptors.append((*cell,f.tell(),len(packed),len(raw),len(batch),warnings,mask,0));f.write(packed)
    extra=enc(dict(types=types,models=models,pathCells={k:sorted(v) for k,v in pathcells.items()},longBlocks=sorted(longblocks),sourceRevisions=revisions,cityBits=citybits))
    index=struct.pack('<8sHHIII',b'BHYIDX1\0',1,SIZE,len(descriptors),total,len(extra))+b''.join(struct.pack('<hhIIIHHII',*d) for d in descriptors)+extra
    (app/FILES[1]).write_bytes(index)
    revision=int(datetime.now(timezone.utc).timestamp())
    manifest=dict(schemaVersion=1,datasetId='hybrid-rus-v1',format='hybrid-blocks-v1',warningSchemaVersion=1,revision=revision,updatedAt=datetime.fromtimestamp(revision,timezone.utc).isoformat(),count=total,warningCount=citycounts['russia'],cityCounts=citycounts,cellSize=CELL,recordSize=SIZE,contentHash=digest.hexdigest(),attribution='MapCam.info + еСтрелка; private user-provided databases. Regional boundaries: © OpenStreetMap contributors, ODbL 1.0.',familyCounts=dict(familycounts),namedCount=named,sourceSqliteSha256=h(Path(database).read_bytes()),updateChannel='bundled',maxRawBlockBytes=MAX_RAW)
    for name,filename in [('records',FILES[0]),('index',FILES[1])]:
        data=(app/filename).read_bytes();manifest[name]=dict(file=filename,bytes=len(data),sha256=h(data))
    if manifest['records']['bytes']>32*1048576 or len(index)>4*1048576:raise ValueError('Catalog exceeds runtime budgets')
    (app/FILES[2]).write_bytes(enc(manifest))
    for filename in FILES:(root/'data'/filename).write_bytes((app/filename).read_bytes())
    print(json.dumps(manifest,ensure_ascii=False,indent=2));return manifest
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('database',type=Path);a=p.parse_args();pack(a.database)
