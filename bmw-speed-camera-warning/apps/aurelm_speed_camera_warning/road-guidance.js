'use strict';
// Road-matched camera approach, adapted from istt1899/bmw-kaluga-cameras.
// Uses bundled OSM road geometry only; OSM maxspeed tags are never read.
const {warningRange,isSpeeding}=require('./notification-rules');
const EARTH_M = 111320;
const MAX_FIX_AGE_MS = 3000;
const MAX_ACCURACY_M = 15;
const MIN_ENTRY_SPEED_KMH = 15;
const MIN_TRACK_SPEED_KMH = 3;
const MAX_HEADING_DELTA_DEG = 32;
const FIRST_WARNING_M = 500;
const FAST_WARNING_M = 700;
const SECOND_WARNING_M = 200;
const FAST_SPEED_KMH = 90;

function angle(x, y) { return (Math.atan2(x, y) * 180 / Math.PI + 360) % 360; }
function diff(a, b) { return Math.abs((a - b + 540) % 360 - 180); }
function prepare(zone) {
    return Object.assign({}, zone, { roads: (zone.roads || []).map(road => {
        const segments = [], lengths = [0];
        for (let i = 1; i < road.pts.length; i++) {
            const a = road.pts[i - 1], b = road.pts[i];
            const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
            lengths.push(lengths[lengths.length - 1] + len);
            if (len > 0) segments.push({ x: a[0], y: a[1], dx, dy, len,
                s: lengths[lengths.length - 2], bearing: angle(dx, dy) });
        }
        const cam = Number.isFinite(road.camM) ? road.camM :
            Number.isInteger(road.cam) && road.cam >= 0 ? lengths[road.cam] : null;
        return { id: String(road.id), segments, cam, dir: road.dir || 0 };
    }) });
}
function project(road, x, y) {
    let nearest = null;
    for (const seg of road.segments) {
        const t = Math.max(0, Math.min(1, ((x - seg.x) * seg.dx + (y - seg.y) * seg.dy) / (seg.len * seg.len)));
        const error = Math.hypot(x - seg.x - t * seg.dx, y - seg.y - t * seg.dy);
        if (!nearest || error < nearest.error) nearest = { road, error, s: seg.s + t * seg.len, bearing: seg.bearing };
    }
    return nearest;
}
function candidate(zone, fix, rangeM, tracking) {
    if (!Number.isFinite(fix.accuracyM) || fix.accuracyM <= 0 || fix.accuracyM > MAX_ACCURACY_M ||
        !Number.isFinite(fix.headingDeg) || fix.headingDeg < 0 || fix.headingDeg >= 360 ||
        !Number.isFinite(fix.speedKmh) || (tracking ? fix.speedKmh < MIN_TRACK_SPEED_KMH : fix.speedKmh <= MIN_ENTRY_SPEED_KMH)) return null;
    const dx = (fix.lon - zone.lon) * EARTH_M * Math.cos(zone.lat * Math.PI / 180);
    const dy = (fix.lat - zone.lat) * EARTH_M;
    if (Math.hypot(dx, dy) > rangeM + 25) return null;
    const hits = zone.roads.map(road => project(road, dx, dy)).filter(Boolean).sort((a, b) => a.error - b.error);
    const hit = hits[0];
    if (!hit || hit.error > Math.min(12, Math.max(6, fix.accuracyM))) return null;
    if (hits.slice(1).some(other => other.error - hit.error < Math.max(8, fix.accuracyM + 3))) return null;
    if (hit.road.cam === null) return null;
    if (tracking && (hit.road.id !== tracking.way || hit.road.dir !== tracking.dir)) return null;
    const offset = hit.road.cam - hit.s;
    const sign = tracking ? tracking.sign : offset >= 0 ? 1 : -1;
    const signed = offset * sign;
    if (signed < (tracking ? -0.001 : 8) || signed > rangeM) return null;
    if (hit.road.dir && hit.road.dir !== sign) return null;
    if (diff((hit.bearing + (sign < 0 ? 180 : 0)) % 360, fix.headingDeg) > MAX_HEADING_DELTA_DEG) return null;
    if (Array.isArray(zone.travel) && zone.travel.length &&
        !zone.travel.some(h => diff(h, (hit.bearing + (sign < 0 ? 180 : 0)) % 360) <= 35)) return null;
    return { id: zone.id, way: hit.road.id, dir: hit.road.dir, sign,
        distanceM: Math.max(0, signed), lateralErrorM: hit.error, roadConfirmed: true };
}
function freshFix(fix, now) {
    return !!fix && [fix.lat, fix.lon, fix.speedKmh, fix.headingDeg, fix.accuracyM, fix.timeMs, now].every(Number.isFinite) &&
        Math.abs(fix.lat) <= 90 && Math.abs(fix.lon) <= 180 && fix.accuracyM > 0 &&
        fix.accuracyM < MAX_ACCURACY_M && fix.headingDeg >= 0 && fix.headingDeg < 360 &&
        now - fix.timeMs <= MAX_FIX_AGE_MS && fix.timeMs <= now + 500;
}
function plausible(previous, next, fix, dt) {
    return previous && dt > 0 && dt <= 3 &&
        Math.abs(previous.distanceM - next.distanceM) <= Math.max(8, fix.speedKmh / 3.6 * dt * 2 + 6);
}
class RoadGuidanceWarnings {
    constructor(zones,options) {
        this.options=Object.assign({excessKmh:0,distanceM:0},options||{});
        this.zones = Object.create(null);
        (zones || []).forEach(z => { if (z && typeof z.id === 'string') this.zones[z.id] = prepare(z); });
        this.prior = Object.create(null);
        this.states = Object.create(null);
        this.lastTime = null;
        this.lastSource = null;
    }
    configure(options) { Object.assign(this.options,options);this.reset(); }
    preview(camera,fix,range) {
        const zone=this.zones[camera.id];
        if(!zone||!freshFix(fix,fix.timeMs)||Math.abs(camera.lat-zone.lat)>.0000001||Math.abs(camera.lon-zone.lon)>.0000001)return null;
        return candidate(zone,fix,range,null);
    }
    update(fix, cameras, now) {
        now = Number.isFinite(now) ? now : Date.now();
        if (!freshFix(fix, now) || (this.lastTime !== null && fix.timeMs < this.lastTime)) return [];
        const fresh = this.lastTime === null || fix.timeMs > this.lastTime;
        const dt = this.lastTime === null ? 0 : (fix.timeMs - this.lastTime) / 1000;
        if (!fresh && this.lastSource && Math.hypot((fix.lat-this.lastSource.lat)*EARTH_M,
            (fix.lon-this.lastSource.lon)*EARTH_M*Math.cos(fix.lat*Math.PI/180)) > Math.max(6,fix.accuracyM*2)) return [];
        if (fresh) { this.lastTime = fix.timeMs; this.lastSource = { lat: fix.lat, lon: fix.lon }; }
        const byId = Object.create(null), seen = Object.create(null), events = [];
        (cameras || []).forEach(camera => { if (camera && typeof camera.id === 'string') byId[camera.id] = camera; });
        Object.keys(this.zones).forEach(id => {
            const camera = byId[id], zone = this.zones[id];
            if (!camera || !Number.isFinite(camera.lat) || !Number.isFinite(camera.lon)) return;
            // A downloaded camera may have moved since the bundled roads were generated.
            // Never attach its old road geometry to a new location or control direction.
            if (Math.abs(camera.lat-zone.lat)>0.0000001 || Math.abs(camera.lon-zone.lon)>0.0000001) return;
            if (Array.isArray(camera.mapcamTravel) && camera.mapcamTravel.length &&
                !camera.mapcamTravel.some(h => diff(h, fix.headingDeg) <= 35)) return;
            seen[id] = true;
            let previousState = this.states[id];
            if (previousState && now - previousState.lastSeenAt > 5000) {
                delete this.states[id]; previousState = null;
            }
            const range = warningRange(camera,this.options,fix.speedKmh);
            let next = candidate(zone, fix, range, previousState);
            if (previousState && fresh && (!next || !plausible(previousState, next, fix, dt))) {
                delete this.states[id]; previousState = null;
                next = candidate(zone, fix, range, null);
            }
            const prior = this.prior[id];
            const approaching = fresh && next && plausible(prior, next, fix, dt) &&
                prior.distanceM - next.distanceM > 0.5 && prior.way === next.way && prior.sign === next.sign;
            if (fresh) {
                if (next) this.prior[id] = next;
                else delete this.prior[id];
            }
            if (!next) {
                if (previousState) {
                    const radial = Math.hypot((fix.lat-camera.lat)*EARTH_M,
                        (fix.lon-camera.lon)*EARTH_M*Math.cos(fix.lat*Math.PI/180));
                    if (radial > range + 150 || previousState.lastSeenAt < now - 5000) delete this.states[id];
                }
                return;
            }
            let state = previousState;
            if (!state && approaching) {
                state = this.states[id] = { stage: 0, speedingAlerted: false, way: next.way,
                    sign: next.sign, dir: next.dir, distanceM: next.distanceM, lastSeenAt: now };
            }
            if (!state) return;
            state.camera=camera;state.phase='point';state.speedKmh=fix.speedKmh;state.useAverage=false;
            state.lastSeenAt = now;
            state.way = next.way; state.sign = next.sign; state.dir = next.dir;
            state.distanceM = next.distanceM;
            const d = Math.round(next.distanceM);
            if (state.stage === 0 && next.distanceM <= range) {
                state.stage = 1;
                events.push({ type: 'camera', stage: 1, distanceM: d, thresholdM: range,
                    camera, speedKmh: Math.round(fix.speedKmh), roadConfirmed: true, way: next.way });
            } else if (fresh && state.stage === 1 && next.distanceM <= SECOND_WARNING_M) {
                state.stage = 2;
                events.push({ type: 'camera', stage: 2, distanceM: d, thresholdM: SECOND_WARNING_M,
                    camera, speedKmh: Math.round(fix.speedKmh), roadConfirmed: true, way: next.way });
            }
            const limit = camera.limit;
            state.speeding=isSpeeding(camera,fix.speedKmh,this.options,state.speeding,false);
            if(state.speeding&&!state.speedingAlerted){
                state.speedingAlerted=true;
                events.push({type:'speeding',stage:state.stage,distanceM:d,camera,speedKmh:fix.speedKmh,
                    limitKmh:limit,limitSource:'camera',excessKmh:fix.speedKmh-limit,roadConfirmed:true});
            }
            if(!state.speeding)state.speedingAlerted=false;
        });
        Object.keys(this.states).forEach(id => { if (!seen[id]) delete this.states[id]; });
        return events;
    }
    reset() { this.prior = Object.create(null); this.states = Object.create(null); this.lastTime = null; this.lastSource = null; }
}
module.exports = { RoadGuidanceWarnings, candidate, prepare, freshFix, FIRST_WARNING_M,
    FAST_WARNING_M, SECOND_WARNING_M, MAX_ACCURACY_M, MAX_HEADING_DELTA_DEG };
