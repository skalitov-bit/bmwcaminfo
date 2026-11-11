#!/usr/bin/env python3
"""Build offline camera-to-road geometry from a regional OSM PBF extract.

No Overpass API calls are used. Road matching remains map-matched to the
actual road geometry; there is deliberately no radial alert fallback.
"""
import json, math, os, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, "apps", "aurelm_speed_camera_warning")
DATA = os.path.join(ROOT, "data")
DB_PATH = os.path.join(APP, "camera-db.json")
OUT_PATH = os.path.join(APP, "road-zones.json")
PBF_PATH = os.path.join(DATA, "mari_el_republic.osm.pbf")
PBF_URL = "https://geo2day.com/russia/volga_federal_district/mari_el_republic.pbf"
ROAD_TYPES = {"motorway","trunk","primary","secondary","tertiary","unclassified","residential","service","living_street","road","track"}
RADIUS_M = 800
CAMERA_SNAP_M = 30
ROAD_NEAR_CAMERA_M = RADIUS_M + 50

def ensure_pbf():
    os.makedirs(DATA, exist_ok=True)
    if os.path.exists(PBF_PATH) and os.path.getsize(PBF_PATH) > 1_000_000:
        return
    tmp = PBF_PATH + ".part"
    req = urllib.request.Request(PBF_URL, headers={"User-Agent":"BMW-Speed-Camera-Warning/0.7.0"})
    with urllib.request.urlopen(req, timeout=180) as response, open(tmp, "wb") as out:
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk: break
            out.write(chunk)
    if os.path.getsize(tmp) < 1_000_000:
        raise RuntimeError("Mari El OSM PBF download is unexpectedly small")
    os.replace(tmp, PBF_PATH)

def load_roads():
    try:
        import osmium
    except ImportError as exc:
        raise RuntimeError("Python package 'osmium' is required (pip install osmium)") from exc
    roads = []
    class Handler(osmium.SimpleHandler):
        def way(self, w):
            highway = w.tags.get("highway")
            if highway not in ROAD_TYPES:
                return
            pts = []
            for n in w.nodes:
                if not n.location.valid(): return
                pts.append((n.location.lon, n.location.lat))
            if len(pts) >= 2:
                roads.append({"id":str(w.id),"highway":highway,"oneway":w.tags.get("oneway",""),
                              "pts":pts})
    Handler().apply_file(PBF_PATH, locations=True)
    if len(roads) < 1000:
        raise RuntimeError("Regional PBF contains too few road ways (%d)" % len(roads))
    return roads

def local(lon, lat, origin):
    return ((lon-origin["lon"])*111320*math.cos(math.radians(origin["lat"])), (lat-origin["lat"])*111320)

def project(points):
    best = None
    cumulative = 0.0
    for i in range(1, len(points)):
        ax, ay = points[i-1]; bx, by = points[i]
        dx, dy = bx-ax, by-ay
        length = math.hypot(dx, dy)
        if length <= 0: continue
        t = max(0.0, min(1.0, -(ax*dx+ay*dy)/(length*length)))
        error = math.hypot(ax+t*dx, ay+t*dy)
        item = {"error":error,"s":cumulative+t*length,
                "bearing":(math.degrees(math.atan2(dx,dy))+360)%360}
        if best is None or error < best["error"]: best = item
        cumulative += length
    return best

def main():
    db = json.load(open(DB_PATH, encoding="utf-8"))
    cameras = {}
    for section in ("mari-el", "yoshkar-ola"):
        for c in db.get("cities", {}).get(section, []):
            if isinstance(c.get("lat"),(int,float)) and isinstance(c.get("lon"),(int,float)):
                cameras.setdefault(c["id"],c)
    items = list(cameras.values())
    ensure_pbf()
    roads = load_roads()
    zones = []
    for index, camera in enumerate(items, 1):
        origin={"lat":camera["lat"],"lon":camera["lon"]}
        candidates=[]
        for way in roads:
            # Cheap geographic prefilter before local projection.
            if min(math.hypot((lon-origin["lon"])*111320*math.cos(math.radians(origin["lat"])),
                              (lat-origin["lat"])*111320) for lon,lat in (way["pts"][0],way["pts"][-1])) > RADIUS_M+250 and not any(
                abs(lon-origin["lon"]) < 0.012 and abs(lat-origin["lat"]) < 0.012 for lon,lat in way["pts"]):
                continue
            pts=[local(lon,lat,origin) for lon,lat in way["pts"]]
            # Split long ways into local fragments, preserving only points near this camera.
            kept=[]
            for p in pts:
                if math.hypot(*p) <= RADIUS_M+100:
                    kept.append(p)
            if len(kept)<2: continue
            hit=project(kept)
            if hit and hit["error"] <= ROAD_NEAR_CAMERA_M:
                candidates.append((hit["error"],way,kept,hit))
        candidates.sort(key=lambda x:x[0])
        if not candidates or candidates[0][0] > CAMERA_SNAP_M: continue
        if len(candidates)>1 and candidates[1][0]-candidates[0][0] < 8: continue
        main=candidates[0]
        main_id=main[1]["id"]
        direction=-1 if main[1]["oneway"]=="-1" else 1 if main[1]["oneway"] in ("yes","1","true") else 0
        road_rows=[]
        for error,way,pts,hit in candidates:
            if len(road_rows)>=8: break
            road_rows.append({"id":way["id"],"pts":[[int(round(x)),int(round(y))] for x,y in pts],
                              "camM":round(hit["s"],2) if way["id"]==main_id else None,
                              "dir":direction if way["id"]==main_id else 0})
        forward=main[3]["bearing"]
        road_travel=[round((forward+(180 if direction==-1 else 0))%360,1)]
        if direction==0: road_travel.append(round((forward+180)%360,1))
        mapcam_type=camera.get("mapcamDirectionType")
        mapcam_travel=camera.get("mapcamTravel") or []
        if mapcam_type in (1,2):
            # MapCam headings are directions of approaching traffic. Keep only headings
            # that agree with the matched OSM road; never widen a one-way camera to both sides.
            if not mapcam_travel:
                continue
            compatible=[round(float(h)%360,1) for h in mapcam_travel
                        if min(abs((float(h)-r+180)%360-180) for r in road_travel)<=35]
            if not compatible:
                continue
            travel=compatible
        else:
            travel=road_travel
        zones.append({"id":camera["id"],"lat":camera["lat"],"lon":camera["lon"],"roads":road_rows,"travel":travel})
        if index%25==0: print("Matched",index,"/",len(items),"cameras; zones:",len(zones))
    baseline_ids={c["id"] for c in items if c.get("mapcamId") is None}
    mapcam_ids={c["id"] for c in items if c.get("mapcamId") is not None}
    zone_ids={z.get("id") for z in zones}
    baseline_items=len(baseline_ids)
    baseline_zones=len(baseline_ids & zone_ids)
    if baseline_items and baseline_zones < max(1,int(baseline_items*0.20)):
        raise RuntimeError("Too few road-confirmed baseline camera zones (%d/%d); refusing to publish" % (baseline_zones,baseline_items))
    mapcam_items=len(mapcam_ids)
    mapcam_zones=len(mapcam_ids & zone_ids)
    if mapcam_items and mapcam_zones == 0:
        raise RuntimeError('No MapCam cameras matched to roads; refusing to publish')
    print("MapCam road-confirmed zones:",mapcam_zones,"/",mapcam_items)
    payload={"schemaVersion":1,"region":"RU-ME","source":"OpenStreetMap contributors (ODbL 1.0), regional PBF extract",
             "databaseRevision":db.get("revision"),"radiusM":RADIUS_M,"cameraCount":len(items),
             "zoneCount":len(zones),"zones":zones}
    encoded=json.dumps(payload,ensure_ascii=False,separators=(",",":"))
    if len(encoded.encode("utf-8"))>20*1024*1024: raise RuntimeError("Road geometry exceeds 20 MiB")
    with open(OUT_PATH,"w",encoding="utf-8") as f: f.write(encoded)
    print("Wrote",len(zones),"road-confirmed camera zones from",len(roads),"OSM roads")

if __name__=="__main__": main()
