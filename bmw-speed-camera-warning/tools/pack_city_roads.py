"""Build independent, indexed OSM road packages. Requires pyosmium; no camera data.
SCROAD01 | u32 JSON header bytes | header | individually gzipped 0.01-degree cells.
Coordinates are integer microdegrees. Cell offsets are relative to payload start.
"""
import argparse, gzip, hashlib, json, math, struct, time, re, os
from pathlib import Path
from datetime import datetime, timezone
import osmium

KINDS = {'motorway':0,'motorway_link':0,'trunk':1,'trunk_link':1,'primary':2,'primary_link':2,
         'secondary':3,'secondary_link':3,'tertiary':4,'tertiary_link':4,'residential':5,
         'unclassified':5,'living_street':6,'service':6}
STEP=10000
def encode(obj): return json.dumps(obj,ensure_ascii=False,separators=(',',':')).encode()
def clip(a,b,box):
    lo,hi=0.,1.;dx=b[0]-a[0];dy=b[1]-a[1]
    for p,q in [(-dx,a[0]-box[0]),(dx,box[2]-a[0]),(-dy,a[1]-box[1]),(dy,box[3]-a[1])]:
        if p==0:
            if q<0:return
        elif p<0:lo=max(lo,q/p)
        else:hi=min(hi,q/p)
        if lo>hi:return
    if hi-lo<1e-8:return
    return tuple(round(a[i]+lo*(b[i]-a[i])) for i in (0,1)),tuple(round(a[i]+hi*(b[i]-a[i])) for i in (0,1))

def simplify(pts,tol=2):
    # Iterative RDP, two metres in a local tangent plane; preserve endpoints.
    if len(pts)<3:return pts
    fx=111320*math.cos(pts[0][1]/1e6*math.pi/180)/1e6;fy=111320/1e6
    keep={0,len(pts)-1};stack=[(0,len(pts)-1)]
    while stack:
        lo,hi=stack.pop();a=pts[lo];b=pts[hi];dx=(b[0]-a[0])*fx;dy=(b[1]-a[1])*fy;den=dx*dx+dy*dy;best=tol*tol;at=None
        for i in range(lo+1,hi):
            x=(pts[i][0]-a[0])*fx;y=(pts[i][1]-a[1])*fy;t=max(0,min(1,(x*dx+y*dy)/den)) if den else 0
            d=(x-t*dx)**2+(y-t*dy)**2
            if d>best:best=d;at=i
        if at is not None:keep.add(at);stack.extend([(lo,at),(at,hi)])
    return [pts[i] for i in sorted(keep)]

class Roads(osmium.SimpleHandler):
    def __init__(self,bbox):super().__init__();self.cells={};self.bbox=[round(x*1e6) for x in bbox];self.ways=0;self.points=0;self.seen=set();self.duplicates=0
    def way(self,w):
        kind=w.tags.get('highway');
        if kind not in KINDS:return
        if w.id in self.seen:self.duplicates+=1;return
        pts=[(round(n.lon*1e6),round(n.lat*1e6)) for n in w.nodes if n.location.valid()]
        if len(pts)<2:return
        pts=simplify(pts);t=w.tags;one={'yes':1,'1':1,'-1':-1}.get(t.get('oneway'),0)
        if t.get('junction')=='roundabout' and t.get('oneway')!='no':one=1
        try:layer=max(-10,min(10,int(t.get('layer','0'))))
        except ValueError:layer=0
        meta=[KINDS[kind],t.get('name','')[:100],one,layer,int(t.get('bridge','no')!='no'),int(t.get('tunnel','no')!='no')]
        fragments={}
        for a,b in zip(pts,pts[1:]):
            clipped=clip(a,b,self.bbox)
            if not clipped:continue
            a,b=clipped
            for x in range(min(a[0],b[0])//STEP,max(a[0],b[0])//STEP+1):
                for y in range(min(a[1],b[1])//STEP,max(a[1],b[1])//STEP+1):
                    c=clip(a,b,(x*STEP,y*STEP,(x+1)*STEP,(y+1)*STEP))
                    if not c or c[0]==c[1]:continue
                    key=str(x)+','+str(y);lines=fragments.setdefault(key,[])
                    if lines and lines[-1][-2:]==list(c[0]):lines[-1].extend(c[1])
                    else:lines.append(list(c[0])+list(c[1]))
        if fragments:self.ways+=1;self.seen.add(w.id)
        for key,lines in fragments.items():
            for line in lines:self.cells.setdefault(key,[]).append(meta+[line]);self.points+=len(line)//2

def main():
    ap=argparse.ArgumentParser();ap.add_argument('pbf',type=Path);ap.add_argument('--out',type=Path,required=True);ap.add_argument('--bbox')
    ap.add_argument('--extra-pbf',type=Path,action='append',default=[])
    ap.add_argument('--id',default='moscow');ap.add_argument('--name');ap.add_argument('--coverage');ap.add_argument('--source');ap.add_argument('--source-url');args=ap.parse_args()
    defaults={'bbox':'37.32,55.57,37.88,55.92','name':'Москва','coverage':'Основная часть города; без Новой Москвы и области','source':'OpenStreetMap / BBBike Moscow','source_url':'https://download.bbbike.org/osm/bbbike/Moscow/'}
    for key,value in defaults.items():
        if getattr(args,key) is None:
            if args.id!='moscow':ap.error('--'+key.replace('_','-')+' is required for a new city')
            setattr(args,key,value)
    if not re.fullmatch('[a-z0-9-]{2,40}',args.id) or len(args.name)>60 or len(args.coverage)>160:ap.error('Invalid city metadata')
    bbox=list(map(float,args.bbox.split(',')))
    if len(bbox)!=4 or not all(math.isfinite(v) and abs(v)<=(90 if i%2 else 180) for i,v in enumerate(bbox)) or bbox[0]>=bbox[2] or bbox[1]>=bbox[3]:ap.error('Invalid bounding box')
    catalog_file=args.out/'catalog.json'
    catalog=json.loads(catalog_file.read_text(encoding='utf-8')) if catalog_file.exists() else {'schema':1,'cities':[]}
    if catalog.get('schema')!=1 or not isinstance(catalog.get('cities'),list):ap.error('Invalid existing catalog')
    start=time.monotonic();h=Roads(bbox)
    for pbf in [args.pbf]+args.extra_pbf:h.apply_file(str(pbf),locations=True,idx='flex_mem')
    if not h.cells:raise ValueError('No roads in selected area')
    rawsource=hashlib.file_digest(args.pbf.open('rb'),'sha256').hexdigest();stamp=datetime.now(timezone.utc).isoformat();revision=int(time.time())
    blocks=[];index={};offset=0
    for key,roads in sorted(h.cells.items()):
        raw=encode(roads);chunk=gzip.compress(raw,compresslevel=9,mtime=0);index[key]=[offset,len(chunk),len(raw),len(roads)];blocks.append(chunk);offset+=len(chunk)
    header={'schema':1,'id':args.id,'name':args.name,'coverage':args.coverage,'bbox':bbox,'revision':revision,'createdAt':stamp,'source':args.source,'sourceUrl':args.source_url,'sourceSha256':rawsource,'license':'ODbL-1.0','attribution':'© OpenStreetMap contributors','cellMicrodegrees':STEP,'ways':h.ways,'points':h.points,'cells':index}
    if args.extra_pbf:header['sourceFiles']=[{'file':p.name,'sha256':hashlib.file_digest(p.open('rb'),'sha256').hexdigest()} for p in [args.pbf]+args.extra_pbf]
    headerbytes=encode(header)
    if len(headerbytes)>2*1024*1024 or len(index)>50000:raise ValueError('Road index exceeds supported reader limits')
    if any(v[1]>1024*1024 or v[2]>1024*1024 or v[3]>16000 for v in index.values()):raise ValueError('Road cell exceeds supported reader limits')
    package=b'SCROAD01'+struct.pack('<I',len(headerbytes))+headerbytes+b''.join(blocks)
    if len(package)>64*1024*1024:raise ValueError('Road package exceeds download limit')
    digest=hashlib.sha256(package).hexdigest();name=args.id+'-'+digest[:16]+'.scroads'
    args.out.mkdir(parents=True,exist_ok=True);(args.out/name).write_bytes(package)
    entry={k:header[k] for k in ('id','name','coverage','bbox','revision','createdAt','attribution','license')};entry.update(bytes=len(package),sha256=digest,file=name,url='https://raw.githubusercontent.com/skalitov-bit/speedcam-db/main/maps/'+name)
    catalog['cities']=[c for c in catalog['cities'] if c['id']!=args.id]+[entry]
    temp=catalog_file.with_suffix('.json.tmp');temp.write_bytes(encode(catalog));os.replace(temp,catalog_file)
    (args.out/'build-report.json').write_bytes(encode({'inputBytes':sum(p.stat().st_size for p in [args.pbf]+args.extra_pbf),'packageBytes':len(package),'headerBytes':len(headerbytes),'payloadBytes':offset,'ways':h.ways,'duplicateWaysSkipped':h.duplicates,'points':h.points,'cells':len(index),'maxCellRawBytes':max(v[2] for v in index.values()),'seconds':time.monotonic()-start,'sha256':digest,'sourceSha256':rawsource,'bbox':bbox}))
    print((args.out/'build-report.json').read_text(),flush=True)
if __name__=='__main__':main()
