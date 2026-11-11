#!/usr/bin/env python3
"""Build updated MGU/TGZ on Windows or Linux, reusing the pinned 0.7.57 runtime/fonts.

No BMW SDK or vehicle access is required for packaging. This is not an on-car test.
"""
import argparse
import hashlib
import importlib.util
import io
import json
from pathlib import Path, PurePosixPath
import sys
import tarfile
import urllib.request

ROOT=Path(__file__).resolve().parents[1]
APP=ROOT/'apps/aurelm_speed_camera_warning'

def build(out, cache):
    cache.mkdir(parents=True,exist_ok=True)
    inputs=json.loads((ROOT/'tools/build-inputs.json').read_text(encoding='utf-8'))
    for item in inputs['inputs']:
        p=cache/item['name']
        if not p.exists():
            req=urllib.request.Request(item['url'],headers={'User-Agent':'BMWCamInfo-local-build/0.9.1'})
            raw=urllib.request.urlopen(req,timeout=60).read()
            if hashlib.sha256(raw).hexdigest()!=item['sha256']:raise ValueError('Download hash mismatch: '+item['name'])
            p.write_bytes(raw)
        if hashlib.sha256(p.read_bytes()).hexdigest()!=item['sha256']:raise ValueError('Cache hash mismatch: '+item['name'])
    spec=importlib.util.spec_from_file_location('pinned_mgu_builder',cache/'build.py')
    builder=importlib.util.module_from_spec(spec)
    sys.path.insert(0,str(cache))
    spec.loader.exec_module(builder)
    from pack_camera_catalog import pack
    pack(ROOT)
    app=json.loads((APP/'app.json').read_text(encoding='utf-8'))
    db=json.loads((APP/'camera-db.json').read_text(encoding='utf-8'))
    if db.get('datasetId')!='mapcam-rus-v2' or db.get('warningSchemaVersion')!=1:
        raise ValueError('Import a compatible MapCam database before building')
    xml,ui,strings,state_ids=builder.build_ui(app)
    builder.unicode_resources(ui,strings)
    blobs={};modes={}
    with tarfile.open(cache/'upstream.mgu','r:gz') as t:
        for m in t.getmembers():
            p=PurePosixPath(m.name)
            if p.is_absolute() or '..' in p.parts or m.issym() or m.islnk():raise ValueError('Unsafe runtime template')
            if m.isfile():blobs[m.name]=t.extractfile(m).read();modes[m.name]=m.mode
    def put_json(name,value):blobs[name]=json.dumps(value,ensure_ascii=False,indent=1).encode('utf-8')
    pkg=json.loads(blobs['source/package.json'])
    pkg.update(version=app['version'],description=app['description'])
    pkg['oapAppSettings'].update(maxDiskUsage=app['maxDiskUsage'],memoryThresholdKB=app['memoryKB'])
    put_json('source/package.json',pkg)
    meta=json.loads(blobs['meta.json']);meta['version']=app['version'];put_json('meta.json',meta)
    lock=json.loads(blobs['source/npm-shrinkwrap.json']);lock['version']=app['version'];put_json('source/npm-shrinkwrap.json',lock)
    for p in APP.iterdir():
        if p.is_file() and p.suffix in ('.js','.json','.jsonl') and p.name not in ('app.json','camera-db.json'):
            blobs['source/javascript/'+('app.js' if p.name=='main.js' else p.name)]=p.read_bytes()
    blobs.pop('source/javascript/camera-db.json',None)
    rt={k:app.get(k) for k in ('id','title','version','screens','settings','config','startWidget')}
    rt['stateIds']=state_ids;put_json('source/javascript/kit/app-spec.json',rt)
    for name in list(blobs):
        if name in ('source/rhmiData/application.json','rhmiData/application.json'):
            value=json.loads(blobs[name]);value['application']['version']=app['version'];put_json(name,value)
        elif name.endswith('/application.xml'):
            blobs[name]=xml.encode('utf-8')
        elif name.endswith('/uiDescription.json'):
            put_json(name,ui)
        elif (name.startswith('rhmiData/strings/') or name.startswith('source/rhmiData/variantGroups/Common/texts/')):
            put_json(name,strings)
    # Include the project licence and camera/OSM attribution in both installation formats.
    blobs['source/LICENSE']= (ROOT.parent/'LICENSE').read_bytes()
    blobs['source/DATA-NOTICE.txt']=(ROOT/'DATA-NOTICE.txt').read_bytes()
    out.mkdir(parents=True,exist_ok=True)
    manifest={}
    for extension in ('mgu','tgz'):
        target=out/(app['id']+'@'+app['version']+'.'+extension)
        with tarfile.open(target,'w:gz') as t:
            for name,raw in sorted(blobs.items()):
                if extension=='tgz':
                    if not name.startswith('source/'):continue
                    archive_name='package/'+name[len('source/'):]
                else:archive_name=name
                item=tarfile.TarInfo(archive_name);item.size=len(raw);item.mode=modes.get(name,0o644)
                item.mtime=db['revision'];t.addfile(item,io.BytesIO(raw))
        manifest[target.name]={'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'bytes':target.stat().st_size}
    (out/'BUILD-CHECKSUMS.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    print(json.dumps(manifest,indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--out',type=Path,default=ROOT.parent/'release-local')
    p.add_argument('--cache',type=Path,default=ROOT.parent/'.build-cache')
    a=p.parse_args();build(a.out,a.cache)
