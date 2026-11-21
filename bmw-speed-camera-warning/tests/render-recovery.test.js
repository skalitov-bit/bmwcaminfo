'use strict';
// Exercise the packaged runtime, with failures injected at the renderer boundary.
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const EventEmitter = require('events');
const root = path.resolve(process.argv[2]);
let now = 10000, timers = [], images = [], reconnects = 0;
class Clock extends Date { static now() { return now; } }
class FakeRenderer extends EventEmitter {
    constructor() { super(); this.ready = true; this.visible = true; this.frames = []; }
    connect() {} show(on) { this.visible = on; } grab(on) { this.grabbing = on; }
    frame(r) { this.frames.push(r); } recover() { reconnects++; return true; }
}
const mod = {exports: {}};
vm.runInNewContext(fs.readFileSync(root + '/kit/display.js', 'utf8'), {
    module: mod, exports: mod.exports, Buffer, process, console, Date: Clock,
    require: p => p === './renderd' ? {RenderClient: FakeRenderer} : require(root + '/kit/' + p),
    setTimeout: fn => { const t = {fn}; timers.push(t); return t; }, clearTimeout: t => { if(t)t.cancelled = true; },
    setInterval: () => ({unref() {}}), clearInterval() {}
});
const Display = mod.exports.Display;
const {Recorder} = require(root + '/kit/record');
function frame(d, color) {
    const r = new Recorder(8, 8); r.clear(color || '#112233');
    d._keep('IMAGE', r, (name, cv) => { images.push(cv); });
    d.lastGpu=d.last;
}
function fixture() {
    const d = Object.create(Display.prototype);
    Object.assign(d, {
        spec: {id: 'recovery-test'}, screen: {name: 'MAIN'}, settings: {get: () => 'full'},
        ui: {isVisible: s => s === 'MAIN', hasFocus: () => true, _invalidate() {}},
        log: {info() {}, warn() {}, error() {}}, theme: () => ({bg: '#000000'}),
        place: {full: true, scale: 1}, tickHandlers: [], layoutHandlers: [],
        _place() {}, _lost() { this.lost = (this.lost || 0) + 1; },
        _hmiBar() {}, closeSheet() {}, own: () => true, _claimTabs() {},
        shownT: 10000, tickT: 10000
    });
    d._startGpu(); frame(d); return d;
}
const flush = () => Promise.resolve().then(() => Promise.resolve()).then(() => Promise.resolve());
async function run() {
    let d = fixture(); now = 11999; d._softIfNoTick(); await flush(); assert.equal(images.length, 0);
    now = 12000; d._softIfNoTick(); await flush(); assert.equal(images.length, 1, 'startup fallback');
    d.gpu.emit('tick'); assert.equal(d.softDone, true); assert.equal(d.gpu.grabbing, false);
    d.gpu.emit('ready');assert.equal(d.softDone,false);
    now = 22000; d._softIfNoTick(); await flush(); assert.equal(images.length, 2, 'late stall also has fallback');
    assert.equal(reconnects, 1); assert.equal(d.gpu.grabbing, false, 'release controller while stalled');
    frame(d, '#ff0000'); now = 23000; d._softIfNoTick(); await flush();
    assert.equal(images.length, 3, 'fallback keeps current frame'); assert.equal(reconnects, 1, 'retry throttled');
    now = 37000; d._softIfNoTick(); await flush(); assert.equal(reconnects, 1);
    assert.equal(d.recoveryLocked,'REPEATED_STALL');d.gpu.emit('tick');assert.equal(d.softDone,true);
    d.recoveryLocked=null;d.recoveryAttempts=0;d.gpu.emit('ready');assert.equal(d.softDone,false);assert.equal(d.bgShown,null);
    const count = images.length;
    now += 10000; d.ui.hasFocus = () => false; d._syncVisible(); d._softIfNoTick(); await flush();
    assert.equal(images.length, count); assert.equal(d.gpu.visible, false); assert.equal(d.gpu.grabbing, false);
    d.ui.hasFocus = () => true; d.ui.isVisible = s => s === 'MAIN' || s === 'SETTINGS';
    d._syncVisible(); d._softIfNoTick(); await flush(); assert.equal(images.length, count, 'OEM settings respected');
    d.ui.isVisible = () => false; d._softIfNoTick(); await flush(); assert.equal(images.length, count, 'hidden app respected');
    d.ui.isVisible = s => s === 'MAIN'; d._syncVisible(); assert.equal(d.gpu.visible, true); assert.equal(d.shownT, now);
    d._softIfNoTick(); await flush(); assert.equal(images.length, count, 'fresh grace period on return');
    d.lastWords = Buffer.from('old'); d.bgShown = '#000'; const sent = d.gpu.frames.length;
    d.gpu.emit('ready'); assert.equal(d.lastWords, null); assert.equal(d.bgShown, null); assert.equal(d.tickT, 0);
    assert.equal(d.gpu.frames.length, sent + 1, 'reconnect replays cached frame without app updates');
    // A stale delayed foreground-loss callback must not undo a new foreground event.
    d.gpu.onScreen = false; d.gpu.emit('state', {front: false}); const t = timers[timers.length - 1];
    d.gpu.emit('state', {front: true}); t.fn(); assert(!d.blocked); assert(t.cancelled);
    now += 5000; d.rendererFront = false; const tries = reconnects;
    d._softIfNoTick(); await flush(); assert.equal(reconnects, tries, 'do not fight renderer foreground gate');
    // Single in-flight software upload, latest content picked just before upload.
    d = fixture(); now += 5000; d.shownT = now - 5000; d.tickT = 0;
    let uploads = 0, finish;
    d.last.softImage = () => { uploads++; return new Promise(resolve => {finish = resolve;}); };
    d._softIfNoTick(); await flush(); now += 1000; d._softIfNoTick(); await flush(); assert.equal(uploads, 1);
    finish(); await flush(); assert.equal(d.softBusy, false);
    d.last.softImage = () => { throw Error('simulated HMI failure'); };
    now += 1000; d._softIfNoTick(); await flush(); assert.equal(d.softBusy, false, 'failure permits next attempt');
    // Production RenderClient: reconnect through normal socket close, reset resource cache and partial input.
    let socket, reconnectTimer, closeEvents = 0;
    const clientMod = {exports: {}};
    vm.runInNewContext(fs.readFileSync(root + '/kit/renderd.js', 'utf8'), {
        module: clientMod, exports: clientMod.exports, Buffer, process, console, Uint32Array,
        setImmediate, setInterval: () => 1, clearInterval() {}, clearTimeout() {},
        setTimeout: fn => { reconnectTimer = fn; return 1; },
        require: p => p === 'net' ? {createConnection: () => {
            socket = new EventEmitter(); socket.write = () => true;
            socket.destroy = () => socket.emit('close'); return socket;
        }} : p === './record' ? require(root + '/kit/record') : require(p)
    });
    const c = new clientMod.exports.RenderClient('test', {info() {}, warn() {}}, {socket: '/test'});
    c.on('close', () => closeEvents++); c.connect(); socket.emit('connect'); c.ready = true; c.visible = true;
    c.inbuf = Buffer.from([1,2,3]); c.sent.atlas.add(42);
    assert(c.recover()); assert.equal(closeEvents, 1); assert.equal(c.closed, false); assert(reconnectTimer);
    reconnectTimer(); socket.emit('connect'); assert.equal(c.inbuf.length, 0); assert.equal(c.sent.atlas.size, 0);
    assert.equal(c.visible, true, 'visibility intent survives reconnect');
    c.close(); assert.equal(c.recover(), false, 'intentional close never resurrects client');
    console.log('PASS graphics recovery: startup/late stall, live fallback, throttled reconnect, resource reset, cached replay, focus/settings/hidden gates, input release, stale timer, failed/slow HMI uploads. Hardware not tested.');
}
run().catch(e => { console.error(e); process.exitCode = 1; });
