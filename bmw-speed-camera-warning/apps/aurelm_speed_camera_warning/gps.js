'use strict';

/*
 * BMW MGU GPS bridge, adapted from the public bmw-kaluga-cameras approach:
 * read-only SOME/IP SatellitePositioning.updatePosition -> NMEA decoder.
 * No shell daemon, external GPS, internet, or coordinate writes.
 */
const EventEmitter = require('events');

const INTERFACE = 'de.bmw.infotainment.SatellitePositioning';
const INSTANCE = '1';
const MAX_AGE_MS = 3000;
const MOTION_PAIR_MS = 500;
const ACCURACY_PAIR_MS = 100;

function num(v) {
    if (typeof v !== 'string' || v.trim() === '' || !isFinite(Number(v))) return null;
    return Number(v);
}
function fresh(t, now) {
    return typeof t === 'number' && isFinite(t) && t >= now - MAX_AGE_MS && t <= now + 500;
}
function tod(v) {
    if (!/^\d{6}(\.\d+)?$/.test(v || '')) return null;
    const h = Number(v.slice(0, 2)), m = Number(v.slice(2, 4)), s = Number(v.slice(4));
    return h < 24 && m < 60 && s < 60 ? ((h * 60 + m) * 60 + s) * 1000 : null;
}
function utc(date, time) {
    const ms = tod(time);
    if (!/^\d{6}$/.test(date || '') || ms === null) return null;
    let year = Number(date.slice(4, 6));
    year += year >= 80 ? 1900 : 2000;
    const month = Number(date.slice(2, 4)), day = Number(date.slice(0, 2));
    const base = Date.UTC(year, month - 1, day), d = new Date(base);
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
    return base + ms;
}
function coordinate(raw, hemi, longitude) {
    const v = num(raw), allowed = longitude ? /^[EW]$/ : /^[NS]$/;
    if (v === null || v < 0 || !allowed.test(hemi)) return null;
    const deg = Math.floor(v / 100), minutes = v % 100;
    const out = deg + minutes / 60;
    if (minutes >= 60 || out > (longitude ? 180 : 90)) return null;
    return hemi === 'S' || hemi === 'W' ? -out : out;
}
function delta(a, b) {
    const day = 86400000;
    return (a - b + day * 1.5) % day - day / 2;
}
function distance(a, b) {
    const rad = Math.PI / 180;
    const x = (b.lon - a.lon) * Math.cos((a.lat + b.lat) * rad / 2);
    const y = b.lat - a.lat;
    return Math.sqrt(x * x + y * y) * rad * 6371008.8;
}
function parseSentence(line) {
    const m = /^\$([A-Z]{2})([A-Z]{3}),([^*]*)\*([0-9A-Fa-f]{2})$/.exec(String(line || '').trim());
    if (!m || line.length > 512) return null;
    const body = m[1] + m[2] + ',' + m[3];
    let sum = 0;
    for (let i = 0; i < body.length; i++) sum ^= body.charCodeAt(i);
    if (sum !== parseInt(m[4], 16)) return null;
    return { kind: m[2], p: body.split(',') };
}
function assembledFix(r, g, gst) {
    let accuracyM = null;
    if (gst && Math.abs(delta(gst.tod, g.tod)) <= ACCURACY_PAIR_MS &&
        gst.latSigma > 0 && gst.lonSigma > 0) {
        accuracyM = 2 * Math.sqrt(gst.latSigma * gst.latSigma + gst.lonSigma * gst.lonSigma);
    } else if (typeof g.hdop === 'number' && isFinite(g.hdop) && g.hdop > 0) {
        // GST is not broadcast by every MGU software version; use a conservative HDOP estimate.
        accuracyM = Math.min(100, Math.max(5, g.hdop * 8));
    }
    return {
        lat: g.lat, lon: g.lon,
        speedKmh: r.speed !== null && r.speed >= 0 ? r.speed * 1.852 : 0,
        headingDeg: r.heading !== null && r.heading >= 0 && r.heading <= 360 ? r.heading % 360 : null,
        accuracyM: accuracyM, timeMs: r.time, quality: g.quality, hdop: g.hdop,
        satellites: g.satellites, source: 'BMW SatellitePositioning'
    };
}

function diagnosticSentence(line, now) {
    const match=/^\$[A-Z]{2}(RMC|GGA|GST),/.exec(line.trim());
    if(!match)return null;
    const s=parseSentence(line),entry={kind:match[1],receivedAtMs:now,raw:line.slice(0,512),truncated:line.length>512,checksumValid:!!s};
    if(!s){entry.reason='invalid_sentence_or_checksum';return entry;}
    const p=s.p,t=tod(p[1]);
    entry.measurementTimeMs=t===null?null:s.kind==='RMC'?utc(p[9],p[1]):now+delta(t,((now%86400000)+86400000)%86400000);
    entry.ageAtReceiptMs=entry.measurementTimeMs===null?null:now-entry.measurementTimeMs;
    entry.freshAtReceipt=fresh(entry.measurementTimeMs,now);
    if(s.kind==='RMC')entry.fields={utc:p[1],date:p[9],status:p[2],latitude:coordinate(p[3],p[4],false),longitude:coordinate(p[5],p[6],true),speedKnots:num(p[7]),headingDeg:num(p[8])};
    else if(s.kind==='GGA')entry.fields={utc:p[1],quality:num(p[6]),satellites:num(p[7]),hdop:num(p[8]),latitude:coordinate(p[2],p[3],false),longitude:coordinate(p[4],p[5],true)};
    else entry.fields={utc:p[1],rmsM:num(p[2]),semiMajorSigmaM:num(p[3]),semiMinorSigmaM:num(p[4]),orientationDeg:num(p[5]),latitudeSigmaM:num(p[6]),longitudeSigmaM:num(p[7]),altitudeSigmaM:num(p[8])};
    entry.reason=!entry.freshAtReceipt?'invalid_or_stale_measurement':s.kind==='RMC'&&p[2]!=='A'?'rmc_no_fix':s.kind==='GGA'&&[1,2,3,4,5].indexOf(num(p[6]))<0?'gga_no_supported_fix':'parsed';
    return entry;
}

// Keep complete sentences across updatePosition events, never partial text.
// At most 32 epochs of each kind; receipt time never refreshes measurement time.
class NmeaAssembler {
    constructor() { this.reset(); }
    reset() {
        this.parts = { RMC: [], GGA: [], GST: [] };
        this.lastTime = -Infinity;
        this.lastGgaTime = -Infinity;
        this.lastSignature = null;
        this.lastNow = null;
        this.status = 'pending';
        this.lastAssembly = null;
    }
    push(payload, now) {
        if (!Number.isFinite(now)) { this.status = 'invalid'; return null; }
        if (this.lastNow !== null && now < this.lastNow) this.reset();
        this.lastNow = now;
        Object.keys(this.parts).forEach(kind => {
            this.parts[kind] = this.parts[kind].filter(v => fresh(v.time, now));
        });
        this.status = 'pending';
        if (!payload || typeof payload.nmeaString !== 'string' ||
            !payload.nmeaString.length || payload.nmeaString.length > 4096 ||
            /[^\x20-\x7e\r\n]/.test(payload.nmeaString)) {
            this.status = 'invalid'; return null;
        }
        const touched = [], day = 86400000;
        let invalid = false;
        payload.nmeaString.split(/[\r\n]+/).forEach(line => {
            if (!line.trim()) return;
            const s = parseSentence(line);
            if (!s) { invalid = true; return; }
            if (!Object.prototype.hasOwnProperty.call(this.parts, s.kind)) return;
            const p = s.p, t = tod(p[1]);
            if (t === null) { invalid = true; return; }
            // GGA/GST have no date: resolve the closest UTC day, including midnight.
            const time = s.kind === 'RMC' ? utc(p[9], p[1]) : now + delta(t, ((now % day) + day) % day);
            if (!fresh(time, now)) { invalid = true; return; }
            const v = { tod: t, time, valid: true, raw: line, receivedAtMs: now };
            if (s.kind === 'RMC') {
                Object.assign(v, { lat: coordinate(p[3], p[4], false), lon: coordinate(p[5], p[6], true),
                    speed: num(p[7]), heading: num(p[8]) });
                v.valid = p[2] === 'A' && v.lat !== null && v.lon !== null;
            } else if (s.kind === 'GGA') {
                Object.assign(v, { lat: coordinate(p[2], p[3], false), lon: coordinate(p[4], p[5], true),
                    quality: num(p[6]), hdop: num(p[8]), satellites: num(p[7]) });
                v.valid = [1,2,3,4,5].indexOf(v.quality) >= 0 && v.lat !== null && v.lon !== null;
            } else {
                Object.assign(v, { latSigma: num(p[6]), lonSigma: num(p[7]) });
                v.valid = v.latSigma > 0 && v.lonSigma > 0;
            }
            if (!v.valid) invalid = true;
            // An explicit no-fix sentence replaces, rather than revives, its cached epoch.
            this.parts[s.kind] = this.parts[s.kind].filter(old => old.time !== time);
            this.parts[s.kind].push(v);
            this.parts[s.kind].sort((a, b) => b.time - a.time);
            this.parts[s.kind].length = Math.min(32, this.parts[s.kind].length);
            touched.push(v);
        });
        let best = null;
        this.parts.RMC.forEach(r => {
            if (!r.valid || r.time < this.lastTime) return;
            this.parts.GGA.forEach(g => {
                const separation = Math.abs(g.time - r.time);
                if (!g.valid || g.time < this.lastGgaTime || separation > MOTION_PAIR_MS || distance(r, g) > 50) return;
                const gst = this.parts.GST.filter(v => v.valid && Math.abs(v.time - g.time) <= ACCURACY_PAIR_MS)
                    .sort((a, b) => Math.abs(a.time - g.time) - Math.abs(b.time - g.time))[0];
                if (!best || r.time > best.r.time || (r.time === best.r.time && separation < best.separation)) {
                    best = { r, g, gst, separation };
                }
            });
        });
        if (!best || (touched.indexOf(best.r) < 0 && touched.indexOf(best.g) < 0 && touched.indexOf(best.gst) < 0)) {
            this.status = invalid ? 'invalid' : 'pending'; return null;
        }
        const fix = assembledFix(best.r, best.g, best.gst);
        this.lastAssembly={rmc:best.r,gga:best.g,gst:best.gst||null,
            rmcGgaDeltaMs:best.separation,rmcGgaDistanceM:distance(best.r,best.g),
            ggaGstDeltaMs:best.gst?Math.abs(best.g.time-best.gst.time):null,
            accuracySource:best.gst?'GST':fix.accuracyM!==null?'HDOP_ESTIMATE':'unavailable',
            accuracyFormula:best.gst?'2 * sqrt(latitudeSigmaM^2 + longitudeSigmaM^2)':'min(100, max(5, HDOP * 8))',accuracyM:fix.accuracyM};
        const signature = JSON.stringify(fix);
        if (signature === this.lastSignature) { this.status = 'duplicate'; return null; }
        this.lastTime = best.r.time;
        this.lastGgaTime = best.g.time;
        this.lastSignature = signature;
        this.status = 'fix';
        return fix;
    }
}
// Stateless convenience decoder retained for callers/tests with a complete payload.
function nmeaFix(payload, now) { return new NmeaAssembler().push(payload, now); }

class BmwGps extends EventEmitter {
    constructor(options) {
        super();
        const o = options || {};
        this.timeoutMs = o.timeoutMs || 10000;
        this.builders = o.builders || null;
        this.retryMs = o.retryMs || 10000;
        this.retryMaxMs = o.retryMaxMs || 60000;
        this.running = false;
        this.state = 'stopped';
        this.errorCode = null;
        this.fix = null;
        this.proxy = null;
        this.attempt = 0;
        this.retryTimer = null;
        this.staleTimer = null;
        this.generation = 0;
        this.eventsReceived = 0;
        this.invalidEvents = 0;
        this.pendingEvents = 0;
        this.duplicateEvents = 0;
        this.nmea = new NmeaAssembler();
        this.diagnostics = new (require('./gps-diagnostics').GpsDiagnostics)(diagnosticSentence);
        this.lastEventAt = 0;
        this.connecting = false;
        this.silenceMs = o.silenceMs || 15000;
        this.recoveryDelay = this.silenceMs;
    }
    setState(state, code) {
        this.state = state;
        this.errorCode = code || null;
        this.emit('change', this.snapshot());
    }
    snapshot() {
        const f = this.fix;
        const age = f ? Date.now() - f.timeMs : null;
        const valid = !!f && age >= -500 && age <= MAX_AGE_MS;
        return {
            state: valid ? 'fix' : this.state,
            errorCode: this.errorCode,
            fix: valid ? f : null,
            eventsReceived: this.eventsReceived,
            invalidEvents: this.invalidEvents,
            pendingEvents: this.pendingEvents,
            duplicateEvents: this.duplicateEvents,
            ageMs: age
        };
    }
    start() {
        if (this.running) return;
        this.running = true;
        this.generation++;
        this.attempt = 0;
        this.lastEventAt = Date.now();
        this.recoveryDelay = this.silenceMs;
        this.connect(this.generation);
        this.staleTimer = setInterval(() => {
            if (!this.running) return;
            if (this.fix && Date.now() - this.fix.timeMs > MAX_AGE_MS) {
                this.fix = null;
                this.setState('stale', 'GPS_FIX_STALE');
            }
            // Invalid fixes still count as incoming events (e.g. in a tunnel).
            if(!this.connecting&&!this.retryTimer&&Date.now()-this.lastEventAt>=this.recoveryDelay){
                this.lastEventAt=Date.now();
                this.recoveryDelay=Math.min(this.retryMaxMs,this.recoveryDelay*2);
                this.connect(this.generation);
            }
        }, 1000);
    }
    connect(generation) {
        if (!this.running || generation !== this.generation) return;
        if(this.connecting)return;
        this.connecting=true;
        this.nmea.reset();
        this.setState('connecting', null);
        const attempt = ++this.attempt;
        let proxy;
        Promise.resolve().then(() => {
            const sdk = require('oap-sdk');
            const builders = this.builders || (sdk && sdk.someipBuilders);
            if (!builders || typeof builders.buildAndInitTypedProxy !== 'function') {
                throw Object.assign(new Error('oap-sdk.someipBuilders is unavailable'), { code: 'GPS_SDK_API_MISSING' });
            }
            return builders.buildAndInitTypedProxy(INTERFACE, INSTANCE, this.timeoutMs);
        }).then((p) => {
            if (!this.running || generation !== this.generation || attempt !== this.attempt) return;
            proxy = p;
            if (!proxy || !proxy.updatePosition || typeof proxy.updatePosition.subscribe !== 'function') {
                throw Object.assign(new Error('GPS event missing'), { code: 'GPS_EVENT_UNAVAILABLE' });
            }
            return Promise.resolve(proxy.updatePosition.subscribe((payload) => {
                if (!this.running || generation !== this.generation || attempt !== this.attempt) return;
                this.eventsReceived++;
                this.lastEventAt = Date.now();
                this.recoveryDelay = this.silenceMs;
                const receivedAt=Date.now();
                const fix = this.nmea.push(payload, receivedAt);
                this.diagnostics.observe(payload,receivedAt,this.nmea,fix);
                if (!fix) {
                    if (this.nmea.status === 'invalid') this.invalidEvents++;
                    else if (this.nmea.status === 'duplicate') this.duplicateEvents++;
                    else this.pendingEvents++;
                    return;
                }
                this.fix = fix;
                this.lastEventAt = Date.now();
                this.setState('fix', null);
            }));
        }).then(() => {
            if (!this.running || generation !== this.generation || attempt !== this.attempt) return;
            this.proxy = proxy;
            this.connecting=false;
            this.setState('subscribed', null);
        }).catch((err) => {
            if (!this.running || generation !== this.generation || attempt !== this.attempt) return;
            this.connecting=false;
            const code = err && typeof err.code === 'string' && /^[A-Z0-9_.-]{1,48}$/.test(err.code) ?
                err.code : 'GPS_SUBSCRIPTION_FAILED';
            this.setState('unavailable', code);
            const delay = Math.min(this.retryMaxMs, this.retryMs * Math.pow(2, Math.min(attempt - 1, 3)));
            this.retryTimer = setTimeout(() => {
                this.retryTimer = null;
                this.connect(generation);
            }, delay);
        });
    }
    stop() {
        if (!this.running) return;
        this.running = false;
        this.connecting=false;
        this.generation++;
        clearTimeout(this.retryTimer);
        clearInterval(this.staleTimer);
        this.retryTimer = this.staleTimer = null;
        this.fix = null;
        this.proxy = null;
        this.nmea.reset();
        this.setState('stopped', null);
        // The SDK does not expose a verified unsubscribe API here. Generation
        // guards make late callbacks inert; only one subscription attempt is active.
    }
    diagnosticReport(now,effectiveFix) {
        return this.diagnostics.snapshot(now,{running:this.running,state:this.state,errorCode:this.errorCode,
            eventsReceived:this.eventsReceived,invalidEvents:this.invalidEvents,pendingEvents:this.pendingEvents,
            duplicateEvents:this.duplicateEvents,subscriptionAttempts:this.attempt,connecting:this.connecting},effectiveFix);
    }
}
module.exports = { BmwGps, nmeaFix, NmeaAssembler, diagnosticSentence, INTERFACE, INSTANCE };
