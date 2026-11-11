'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const urlModule = require('url');
const DATABASE_URL = 'https://raw.githubusercontent.com/skalitov-bit/bmwcaminfo/main/bmw-speed-camera-warning/data/camera-db.json';
const DATABASE_API_URL = 'https://api.github.com/repos/skalitov-bit/bmwcaminfo/contents/bmw-speed-camera-warning/data/camera-db.json?ref=main';
const MAX_BYTES = 80 * 1024 * 1024;
const MAX_REDIRECTS = 3;

function ensureDirectory(dir) {
    // Create one level at a time for compatibility with the older MGU Node.js runtime.
    if (!dir || dir === path.dirname(dir)) return;
    try {
        const st = fs.statSync(dir);
        if (st.isDirectory()) return;
        throw new Error('CAMERA_DB_PATH_NOT_DIRECTORY: ' + dir);
    } catch (e) {
        if (e && e.code !== 'ENOENT') throw e;
    }
    const parent = path.dirname(dir);
    if (parent && parent !== dir) ensureDirectory(parent);
    try {
        fs.mkdirSync(dir);
    } catch (e) {
        if (e && e.code === 'EEXIST' && fs.statSync(dir).isDirectory()) return;
        throw e;
    }
}

function validateDatabase(value) {
    if (!value || value.schemaVersion !== 1 || !Number.isInteger(value.revision) || value.revision < 1 ||
        !value.cities || typeof value.cities !== 'object' || Array.isArray(value.cities)) {
        throw new Error('CAMERA_DB_SCHEMA_INVALID');
    }
    const datasetId = typeof value.datasetId === 'string' ? value.datasetId : 'legacy';
    if (['legacy','mapcam-rus-v1','mapcam-rus-v2'].indexOf(datasetId)<0) throw new Error('CAMERA_DB_DATASET_INVALID');
    const mapcam=datasetId.indexOf('mapcam-rus-')===0;
    if(datasetId==='mapcam-rus-v2'&&value.warningSchemaVersion!==1)throw new Error('CAMERA_DB_WARNING_SCHEMA_INVALID');
    const cities = {};
    let total = 0;
    Object.keys(value.cities).forEach((city) => {
        if (!/^[a-z0-9-]{2,40}$/.test(city) || !Array.isArray(value.cities[city])) throw new Error('CAMERA_DB_CITY_INVALID');
        const ids = Object.create(null);
        total += value.cities[city].length;
        if (total > 200000) throw new Error('CAMERA_DB_TOO_MANY_RECORDS');
        cities[city] = value.cities[city].map((camera) => {
            if (!camera || typeof camera.id !== 'string' || !/^[a-z0-9-]{2,80}$/.test(camera.id) ||
                typeof camera.name !== 'string' || !camera.name.trim() || camera.name.length > 180) {
                throw new Error('CAMERA_DB_CAMERA_INVALID');
            }
            if (ids[camera.id]) throw new Error('CAMERA_DB_DUPLICATE_ID');
            ids[camera.id] = true;
            if (mapcam && (camera.source !== 'MapCam.info' ||
                !Number.isInteger(camera.mapcamId) || camera.id !== 'mapcam-' + camera.mapcamId ||
                [0,1,2,3].indexOf(camera.mapcamDirectionType) < 0 ||
                !Array.isArray(camera.mapcamTravel) || camera.mapcamTravel.length > 2 ||
                camera.mapcamTravel.some(h => !Number.isFinite(h) || h < 0 || h >= 360))) {
                throw new Error('CAMERA_DB_MAPCAM_INVALID');
            }
            const lat = camera.lat === null || camera.lat === undefined ? null : camera.lat;
            const lon = camera.lon === null || camera.lon === undefined ? null : camera.lon;
            if (mapcam && (lat === null || lon === null)) throw new Error('CAMERA_DB_MAPCAM_COORDINATES_MISSING');
            if ((lat === null) !== (lon === null) ||
                (lat !== null && (typeof lat !== 'number' || !isFinite(lat) || lat < -90 || lat > 90 ||
                    typeof lon !== 'number' || !isFinite(lon) || lon < -180 || lon > 180))) {
                throw new Error('CAMERA_DB_COORDINATES_INVALID');
            }
            const limit = camera.limit === null || camera.limit === undefined ? null : camera.limit;
            if (limit !== null && (typeof limit !== 'number' || !isFinite(limit) || limit < 5 || limit > 250)) {
                throw new Error('CAMERA_DB_LIMIT_INVALID');
            }
            if(datasetId==='mapcam-rus-v2'){
                if(!Number.isInteger(camera.mapcamAngleDeg)||camera.mapcamAngleDeg<0||camera.mapcamAngleDeg>255||
                   !Number.isInteger(camera.mapcamTypeCode)||camera.mapcamTypeCode<1||camera.mapcamTypeCode>255||
                   (camera.mapcamApproachHeadingDeg!==null&&(!Number.isFinite(camera.mapcamApproachHeadingDeg)||camera.mapcamApproachHeadingDeg<0||camera.mapcamApproachHeadingDeg>=360))||
                   !Number.isInteger(camera.mapcamWarningDistanceM)||camera.mapcamWarningDistanceM<0||camera.mapcamWarningDistanceM>2047||
                   !Array.isArray(camera.mapcamPath)||camera.mapcamPath.length>2050||
                   camera.mapcamPath.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)||Math.abs(p[0])>90||Math.abs(p[1])>180)||
                   (camera.mapcamPath.length&& (Math.abs(camera.mapcamPath[0][0]-lat)>0.00001||Math.abs(camera.mapcamPath[0][1]-lon)>0.00001))||
                   (camera.mapcamControlDirection!==null&&[0,1,2,3].indexOf(camera.mapcamControlDirection)<0)||
                   (camera.mapcamHours!==null&&(!Array.isArray(camera.mapcamHours)||camera.mapcamHours.length!==2||camera.mapcamHours.some(h=>!Number.isInteger(h)||h<0||h>31)))){
                    throw new Error('CAMERA_DB_WARNING_FIELDS_INVALID');
                }
            }
            return { id: camera.id, name: camera.name.trim(),
                mapcamId: camera.mapcamId, mapcamType: camera.mapcamType,
                mapcamDirectionType: camera.mapcamDirectionType,
                mapcamApproachHeadingDeg: camera.mapcamApproachHeadingDeg,
                mapcamTravel: camera.mapcamTravel ? camera.mapcamTravel.slice() : [],
                mapcamWarningDistanceM: camera.mapcamWarningDistanceM,
                mapcamTypeCode: camera.mapcamTypeCode, mapcamAngleDeg: camera.mapcamAngleDeg,
                mapcamPath: camera.mapcamPath||[], mapcamControlDirection: camera.mapcamControlDirection,
                mapcamHours: camera.mapcamHours,
                type: typeof camera.type === 'string' ? camera.type.slice(0, 100) : 'Камера',
                limit, lat, lon,
                source: typeof camera.source === 'string' ? camera.source.slice(0, 80) : 'unknown',
                sourceLabel: typeof camera.sourceLabel === 'string' ? camera.sourceLabel.slice(0, 100) : '',
                sourceUrl: typeof camera.sourceUrl === 'string' && /^https:\/\//.test(camera.sourceUrl) ? camera.sourceUrl.slice(0, 300) : '',
                osmId: typeof camera.osmId === 'string' ? camera.osmId.slice(0, 40) : '',
                direction: typeof camera.direction === 'string' ? camera.direction.slice(0, 80) : '',
                description: typeof camera.description === 'string' ? camera.description.slice(0, 500) : '',
                category: typeof camera.category === 'string' ? camera.category.slice(0, 30) : '',
                overpassSnapshot: camera.overpassSnapshot === true,
                note: typeof camera.note === 'string' ? camera.note.slice(0, 300) : '' };
        });
    });
    if (mapcam && (!cities.russia || cities.russia.length < 50000)) {
        throw new Error('CAMERA_DB_COUNTRY_INCOMPLETE');
    }
    return { schemaVersion: 1, datasetId, warningSchemaVersion: value.warningSchemaVersion, revision: value.revision,
        contentHash: typeof value.contentHash === 'string' ? value.contentHash : '',
        attribution: typeof value.attribution === 'string' ? value.attribution : '', 
        updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '', cities };
}
function getHttps(requestUrl, redirects) {
    return new Promise((resolve, reject) => {
        let parsed;
        try { parsed = urlModule.parse(requestUrl); } catch (e) { reject(e); return; }
        if (parsed.protocol !== 'https:' || ['raw.githubusercontent.com', 'api.github.com'].indexOf(parsed.hostname) < 0) {
            reject(new Error('CAMERA_DB_URL_NOT_ALLOWED')); return;
        }
        // kit/uplink.js patches dns.lookup process-wide using the MGU Store lease.
        const req = https.get({
            protocol: 'https:',
            hostname: parsed.hostname,
            port: parsed.port || 443,
            path: parsed.path || '/',
            headers: { 'User-Agent': 'BMWCamInfo/0.9.0', 'Accept': 'application/vnd.github.raw+json' }
        }, (res) => {
            if ([301, 302, 303, 307, 308].indexOf(res.statusCode) >= 0) {
                const location = res.headers.location;
                res.resume();
                if (!location || redirects >= MAX_REDIRECTS) { reject(new Error('CAMERA_DB_REDIRECT_LIMIT')); return; }
                getHttps(urlModule.resolve(requestUrl, location), redirects + 1).then(resolve, reject);
                return;
            }
            if (res.statusCode !== 200) { res.resume(); reject(new Error('CAMERA_DB_HTTP_' + res.statusCode)); return; }
            let body = '', bytes = 0;
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
                bytes += Buffer.byteLength(chunk, 'utf8');
                if (bytes > MAX_BYTES) { req.destroy(new Error('CAMERA_DB_TOO_LARGE')); return; }
                body += chunk;
            });
            res.on('end', () => resolve(body));
            res.on('error', reject);
        });
        req.setTimeout(12000, () => req.destroy(new Error('CAMERA_DB_TIMEOUT')));
        req.on('error', reject);
    });
}
function isTemporaryNetworkError(error) {
    return !!error && ['EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET', 'EHOSTUNREACH'].indexOf(error.code) >= 0;
}
function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function getWithRetry(requestUrl, attempts) {
    let lastError;
    for (let i = 0; i < attempts; i++) {
        try { return await getHttps(requestUrl, 0); }
        catch (error) {
            lastError = error;
            if (!isTemporaryNetworkError(error) || i === attempts - 1) throw error;
            await wait(1000 * Math.pow(2, i));
        }
    }
    throw lastError || new Error('CAMERA_DB_DOWNLOAD_FAILED');
}
async function downloadDatabaseBody(dataDir) {
    try {
        return await getWithRetry(DATABASE_URL, 3);
    } catch (rawError) {
        try {
            const apiBody = await getWithRetry(DATABASE_API_URL, 2);
            const payload = JSON.parse(apiBody);
            if (payload && payload.schemaVersion === 1) return apiBody;
            if (!payload || payload.encoding !== 'base64' || typeof payload.content !== 'string') {
                throw new Error('CAMERA_DB_API_RESPONSE_INVALID');
            }
            return Buffer.from(payload.content.replace(/\s/g, ''), 'base64').toString('utf8');
        } catch (apiError) {
            throw new Error('raw: ' + (rawError.code || rawError.message || 'network') +
                '; api: ' + (apiError.code || apiError.message || 'network'));
        }
    }
}
class CameraStore {
    constructor(options) {
        const o = options || {};
        this.dataDir = o.dataDir || process.cwd();
        this.download = o.download || downloadDatabaseBody;
        this.bundled = validateDatabase(o.bundled);
        this.cachePath = path.join(this.dataDir, 'camera-db-cache.json');
        this.current = this.bundled;
        this.source = 'bundle';
    }
    loadLocal() {
        let cached = null;
        try {
            if (fs.statSync(this.cachePath).size > MAX_BYTES) throw new Error('CAMERA_DB_TOO_LARGE');
            cached = validateDatabase(JSON.parse(fs.readFileSync(this.cachePath, 'utf8')));
        }
        catch (e) { cached = null; }
        // A newly installed app may ship a newer bundled revision than the user's old cache.
        if (cached && cached.datasetId === this.bundled.datasetId && cached.revision >= this.bundled.revision) {
            this.current = cached;
            this.source = 'cache';
        } else {
            this.current = this.bundled;
            this.source = 'bundle';
        }
        return { database: this.current, source: this.source };
    }
    async refresh(onStatus) {
        const status = typeof onStatus === 'function' ? onStatus : function () {};
        try {
            status('Загрузка базы камер...');
            const body = await this.download(this.dataDir);
            status('Проверка полученной базы...');
            const next = validateDatabase(JSON.parse(body));
            if (next.datasetId !== this.current.datasetId) throw new Error('CAMERA_DB_SOURCE_MISMATCH');
            if (next.revision < this.current.revision) throw new Error('CAMERA_DB_OLDER_REVISION');
            if (next.revision === this.current.revision && next.contentHash !== this.current.contentHash) {
                throw new Error('CAMERA_DB_REVISION_CONFLICT');
            }
            if (next.revision > this.current.revision) {
                ensureDirectory(this.dataDir);
                const tmp = this.cachePath + '.tmp';
                fs.writeFileSync(tmp, JSON.stringify(next), 'utf8');
                fs.renameSync(tmp, this.cachePath);
                this.current = next;
                this.source = 'download';
                return { updated: true, database: this.current, source: this.source };
            }
            if (this.source === 'bundle' && !fs.existsSync(this.cachePath)) {
                ensureDirectory(this.dataDir);
                const tmp = this.cachePath + '.tmp';
                fs.writeFileSync(tmp, JSON.stringify(next), 'utf8');
                fs.renameSync(tmp, this.cachePath);
                this.current = next;
                this.source = 'cache';
            }
            return { updated: false, database: this.current, source: this.source };
        } catch (error) {
            return { updated: false, database: this.current, source: this.source,
                error: error && error.message ? error.message : 'CAMERA_DB_UPDATE_FAILED' };
        }
    }
}
module.exports = { CameraStore, validateDatabase, DATABASE_URL };
