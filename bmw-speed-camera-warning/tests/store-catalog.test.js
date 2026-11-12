'use strict';
// Integration contract against upstream's actual parser and dependency planner.
// argv: upstream native/mgu-updater folder, release folder.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const upstream = path.resolve(process.argv[2]);
const release = path.resolve(process.argv[3]);
const lib = require(path.join(upstream, 'js/catalog'));
const Updater = require(path.join(upstream, 'js/updater')).Updater;
const app = 'aurelm_speed_camera_warning', voice = 'bmwcaminfo-voice';
const catalogText = fs.readFileSync(path.join(release, 'store/catalog.json'), 'utf8');
const entries = lib.parse(catalogText).components;
const checks = [];
function check(name, fn) { fn(); checks.push(name); }
function planner(have, list = entries) {
    const u = Object.create(Updater.prototype);
    const rows = new Map(list.map(entry => [entry.id, {entry, source:'speedcam'}]));
    u.installedOf = id => have[id] ? {id,version:have[id]} : null;
    u.resolved = () => rows;
    u.src = new Map([['speedcam',{}],['builtin',{}]]);
    u.defs = () => [{id:'speedcam'},{id:'builtin'}];
    u.providerIds = () => [];
    u.incompatible = entry => lib.compat(entry.mguHmi, 'ID7') === 'no' ? 'wrong HMI' : null;
    return {u, rows, plan:() => u.installPlan(rows.get(app), []).map(s=>s.id)};
}
check('schema 2: native service is a tool, dependency retained', () => {
    assert.equal(entries.find(e=>e.id===voice).kind,'tool');
    assert.equal(entries.find(e=>e.id===app).requires[voice],'0.1.14');
});
check('fresh application: voice installs before SpeedCAM', () => {
    assert.deepStrictEqual(planner({'mgu-deploy':'0.8.16'}).plan(),[voice,app]);
});
check('existing SpeedCAM 0.9.40 + old voice: both update in order', () => {
    assert.deepStrictEqual(planner({'mgu-deploy':'0.8.16',[app]:'0.9.40',[voice]:'0.1.12'}).plan(),[voice,app]);
});
check('matching voice is reused', () => {
    assert.deepStrictEqual(planner({'mgu-deploy':'0.8.16',[voice]:'0.1.14'}).plan(),[app]);
});
check('newer voice is not downgraded', () => {
    assert.deepStrictEqual(planner({'mgu-deploy':'0.8.16',[voice]:'0.1.15'}).plan(),[app]);
});
check('missing dependency is refused', () => {
    assert.throws(()=>planner({'mgu-deploy':'0.8.16'},entries.filter(e=>e.id!==voice)).plan(),/no source has/);
});
check('insufficient deploy is refused when no update source is present', () => {
    assert.throws(()=>planner({'mgu-deploy':'0.6.0'}).plan(),/mgu-deploy 0.7.0/);
});
check('old deploy updates from the built-in source before voice/app', () => {
    const p=planner({'mgu-deploy':'0.6.0'});
    p.rows.set('mgu-deploy',{source:'builtin',entry:{id:'mgu-deploy',kind:'tool',version:'0.8.16',requires:{},mguHmi:['ID7']}});
    assert.deepStrictEqual(p.plan(),['mgu-deploy',voice,app]);
});
check('failed/missing voice does not satisfy the pre-install requirement', () => {
    assert.equal(planner({'mgu-deploy':'0.8.16',[voice]:'0.1.12'}).u.requirementMet(voice,'0.1.14'),false);
});
check('ID8 not advertised as compatible', () => {
    entries.forEach(e=>assert.equal(lib.compat(e.mguHmi,'ID8'),'no'));
});
check('all download URLs, sizes and SHA-256 match real packages', () => {
    entries.forEach(e=>{
        const bytes=fs.readFileSync(path.join(release,e.artifact.name));
        assert.equal(bytes.length,e.artifact.size);
        assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),e.artifact.sha256);
        const url=new URL(e.artifact.url);
        assert.equal(url.hostname,'github.com');
        assert.equal(decodeURIComponent(url.pathname),'/skalitov-bit/bmwcaminfo/releases/download/'+app+'@0.9.41/'+e.artifact.name);
    });
});
check('USB catalog uses identical bytes and retains GitHub origin', () => {
    const root=path.join(release,'store/usb/mgu-repo/speedcam');
    const local=lib.parse(fs.readFileSync(path.join(root,'catalog.json'),'utf8')).components;
    assert.equal(JSON.parse(fs.readFileSync(path.join(root,'mgu-copy.json'),'utf8')).copyOf,'github:skalitov-bit/bmwcaminfo');
    local.forEach(e=>{
        const online=entries.find(r=>r.id===e.id);
        assert.equal(e.artifact.url,e.artifact.name);
        assert.equal(e.artifact.sha256,online.artifact.sha256);
        assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,e.artifact.name))).digest('hex'),e.artifact.sha256);
    });
});
check('store icon is a bounded PNG with a matching hash', () => {
    const raw=JSON.parse(catalogText).components.find(e=>e.id===app);
    const bytes=fs.readFileSync(path.join(release,'store',raw.icon));
    assert(bytes.length<=128*1024);
    assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),raw.iconSha256);
});
console.log(JSON.stringify({upstreamCommit:'407f13e2091a028f7855568c51ba36f10dfab40d',realMguTest:false,passed:checks.length,checks},null,2));
