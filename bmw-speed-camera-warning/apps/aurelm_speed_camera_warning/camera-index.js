'use strict';
// Only nearby cells are searched on a GPS tick; no nationwide scan on each frame.
const CELL = 0.1, EARTH = 111320;
class CameraIndex {
    constructor(cameras, options) {
        const o=options||{};this.cell=o.cellSize||CELL;this.maxReferences=o.maxReferences||Infinity;this.references=0;
        this.cells = Object.create(null);
        this.bounds={minY:Infinity,maxY:-Infinity,minX:Infinity,maxX:-Infinity};
        this.longPaths = [];
        (cameras || []).forEach(c => this.add(c));
    }
    add(c) {
            const CELL=this.cell;
            if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon)) return;
            const keys = Object.create(null);let keyCount=0;
            const addKey=key=>{if(!keys[key]){if(++keyCount+this.references>this.maxReferences)throw new Error('REGION_REFERENCE_LIMIT');keys[key]=true;}};
            addKey(Math.floor(c.lat / CELL) + ':' + Math.floor(c.lon / CELL));
            const pts=c.mapcamPath||[];
            for(let i=1;i<pts.length;i++){
                const a=pts[i-1],b=pts[i],y0=Math.floor(Math.min(a[0],b[0])/CELL),y1=Math.floor(Math.max(a[0],b[0])/CELL);
                const x0=Math.floor(Math.min(a[1],b[1])/CELL),x1=Math.floor(Math.max(a[1],b[1])/CELL);
                if((y1-y0+1)*(x1-x0+1)>2000){this.longPaths.push(c);break;}
                for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)addKey(y+':'+x);
            }
            const list=Object.keys(keys);this.references+=list.length;
            if(this.references>this.maxReferences)throw new Error('REGION_REFERENCE_LIMIT');
            list.forEach(key=>{
                (this.cells[key]||(this.cells[key]=[])).push(c);
                const p=key.split(':'),y=Number(p[0]),x=Number(p[1]),b=this.bounds;
                b.minY=Math.min(b.minY,y);b.maxY=Math.max(b.maxY,y);b.minX=Math.min(b.minX,x);b.maxX=Math.max(b.maxX,x);
            });
    }
    near(fix, radius, limit) {
        const CELL=this.cell;
        if (!fix || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lon)) return [];
        const cos = Math.max(0.01, Math.cos(fix.lat * Math.PI / 180));
        const dy = radius / EARTH, dx = dy / cos, hits = [], seen=Object.create(null);
        const add=c=>{
            if(seen[c.id])return;seen[c.id]=true;
            const distance=distanceToCamera(fix,c);
            if(distance<=radius)hits.push({c,distance});
        };
        const b=this.bounds;
        for (let y = Math.max(b.minY,Math.floor((fix.lat-dy)/CELL)); y <= Math.min(b.maxY,Math.floor((fix.lat+dy)/CELL)); y++) {
            for (let x = Math.max(b.minX,Math.floor((fix.lon-dx)/CELL)); x <= Math.min(b.maxX,Math.floor((fix.lon+dx)/CELL)); x++) {
                (this.cells[y+':'+x] || []).forEach(add);
            }
        }
        this.longPaths.forEach(add);
        hits.sort((a,b) => a.distance-b.distance || a.c.id.localeCompare(b.c.id));
        return hits.slice(0, limit === undefined ? hits.length : limit).map(h => h.c);
    }
}
function distanceToCamera(fix,c){
    const cos=Math.cos(fix.lat*Math.PI/180);
    let best=Math.hypot((c.lat-fix.lat)*EARTH,(c.lon-fix.lon)*EARTH*cos);
    const pts=c.mapcamPath||[];
    for(let i=1;i<pts.length;i++){
        const a=pts[i-1],b=pts[i],x=(a[1]-fix.lon)*EARTH*cos,y=(a[0]-fix.lat)*EARTH;
        const dx=(b[1]-a[1])*EARTH*cos,dy=(b[0]-a[0])*EARTH,len2=dx*dx+dy*dy;
        const t=len2?Math.max(0,Math.min(1,-(x*dx+y*dy)/len2)):0;
        best=Math.min(best,Math.hypot(x+t*dx,y+t*dy));
    }return best;
}
module.exports = { CameraIndex, distanceToCamera };
