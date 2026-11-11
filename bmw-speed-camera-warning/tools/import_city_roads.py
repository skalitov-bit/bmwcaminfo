#!/usr/bin/env python3
"""Build offline Yoshkar-Ola street geometry from the cached regional OSM PBF."""
import json, os, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(ROOT, "apps", "aurelm_speed_camera_warning")
MAP_PATH = os.path.join(BASE, "city-map.json")
PBF_PATH = os.path.join(ROOT, "data", "mari_el_republic.osm.pbf")
ROAD_TYPES = {"motorway","trunk","primary","secondary","tertiary","unclassified","residential","living_street","service","pedestrian","road"}

def inside(lon, lat, ring):
    hit, j = False, len(ring)-1
    for i,p in enumerate(ring):
        x1,y1=p[0],p[1]; x2,y2=ring[j][0],ring[j][1]
        if ((y1>lat)!=(y2>lat)) and lon < (x2-x1)*(lat-y1)/(y2-y1+1e-30)+x1: hit=not hit
        j=i
    return hit

def main():
    if not os.path.exists(PBF_PATH):
        raise RuntimeError("Regional OSM PBF is missing; run import_road_zones.py first")
    try:
        import osmium
    except ImportError as exc:
        raise RuntimeError("Python package 'osmium' is required (pip install osmium)") from exc
    with open(MAP_PATH,encoding="utf-8") as f: data=json.load(f)
    with open(os.path.join(ROOT,'data','region-boundaries.json'),encoding='utf-8') as f:
        geom=json.load(f)['regions']['yoshkar-ola']
    polygons=geom["coordinates"] if geom["type"]=="MultiPolygon" else [geom["coordinates"]]
    rings=[poly[0] for poly in polygons]
    bbox=(min(x for ring in rings for x,y in ring),min(y for ring in rings for x,y in ring),
          max(x for ring in rings for x,y in ring),max(y for ring in rings for x,y in ring))
    roads=[]; seen=set()
    class Handler(osmium.SimpleHandler):
        def way(self,w):
            if w.tags.get("highway") not in ROAD_TYPES: return
            pts=[]
            for n in w.nodes:
                if not n.location.valid(): return
                pts.append((n.location.lon,n.location.lat))
            if len(pts)<2: return
            name=(w.tags.get("name") or w.tags.get("ref") or w.tags.get("highway") or "Улица")[:100]
            for a,b in zip(pts,pts[1:]):
                midlon=(a[0]+b[0])/2; midlat=(a[1]+b[1])/2
                if not (bbox[0]<=midlon<=bbox[2] and bbox[1]<=midlat<=bbox[3]): continue
                if not any(inside(midlon,midlat,ring) for ring in rings): continue
                if abs(a[0]-b[0])+abs(a[1]-b[1])>0.02: continue
                row=[name,float(a[1]),float(a[0]),float(b[1]),float(b[0])]
                key=tuple(round(v,6) if isinstance(v,float) else v for v in row[1:])
                if key not in seen: seen.add(key); roads.append(row)
    Handler().apply_file(PBF_PATH,locations=True)
    if len(roads)<100: raise RuntimeError("OSM street layer unexpectedly small (%d); preserving previous map"%len(roads))
    data["roads"]=roads
    data["source"]="OpenStreetMap contributors (ODbL); offline street geometry from regional PBF extract."
    data["roadSegments"]=len(roads)
    with open(MAP_PATH,"w",encoding="utf-8") as f: json.dump(data,f,ensure_ascii=False,separators=(",",":"))
    print("Imported",len(roads),"OSM street segments for Yoshkar-Ola")

if __name__=="__main__": main()
