"""Recover the pinned renderer connection without changing BMW foreground ownership."""

def replace(s, old, new):
    if s.count(old) != 1:
        raise ValueError('Pinned runtime changed; review graphics recovery: ' + old[:90])
    return s.replace(old, new)


def patch_display(raw):
    s = raw.decode('utf-8')
    s = replace(s,
        "gpu.on('ready', () => { if (this.gpu !== gpu) return; this._place(); this._syncVisible(); this._grab(); });",
        """gpu.on('ready', () => {
            if (this.gpu !== gpu) return;
            clearTimeout(this.frontTimer); this.rendererFront = null;
            this.softEpoch = (this.softEpoch || 0) + 1; this.softPending = false;
            this.tickT = 0; this.shownT = Date.now(); this.softDone = !!this.recoveryLocked;
            this.softStallT = 0;
            this.hasPresented = false;
            this.rendererSuspended = false;
            const info = gpu.info;
            if (this.spec.responsiveMain && !(gpu.opts && gpu.opts.file) && (!gpu.native || !gpu.touch || !info || !info.controller || (info.modes != null && !(info.modes & 1)))) {
                this.recoveryLocked = 'INPUT_CAPABILITIES'; this.softDone = true;
                this.log.warn('DISPLAY_INPUT_UNAVAILABLE ' + JSON.stringify(info));
            }
            this.bgShown = null; this.lastWords = null;
            this._place(); this._syncVisible(); this._grab();
            // Re-upload cached resources and a frame even when the application is idle.
            if (this.lastGpu && this.active()) gpu.frame(this.lastGpu.frame);
            this.tickHandlers.forEach((fn) => fn());
        });""")
    s = replace(s,
        "gpu.on('tick', () => { if (this.gpu === gpu) { this.tickT = Date.now(); this.tickHandlers.forEach((fn) => fn()); } });",
        """gpu.on('tick', () => { if (this.gpu === gpu) {
            this.tickT = Date.now();
            // TICK also acknowledges PLACE/SHOW. A late one is not proof that
            // the failed layer can render or receive input again. Only READY retries it.
            this.tickHandlers.forEach((fn) => fn());
        } });""")
    s = replace(s,
        "gpu.on('close', () => { if (this.gpu === gpu) { this.blocked = false; this._lost(); } });",
        "gpu.on('close', () => { if (this.gpu === gpu) { this.softEpoch = (this.softEpoch || 0) + 1; this.softPending = false; clearTimeout(this.frontTimer); this.rendererFront = null; this.blocked = false; this._lost(); } });")
    s = replace(s, "if (st.front) {", """clearTimeout(this.frontTimer);
            this.rendererFront = st.front;
            if (st.onScreen) this.hasPresented = true;
            // Initial onScreen=false is normal before the first FRAME.
            // SHOW(false) after a successful PNG handoff is our own visibility
            // intent, not BMW suspending a still-requested GPU surface.
            const suspended = this.hasPresented && gpu.visible !== false && st.front && st.onScreen === false;
            if (this.rendererSuspended !== suspended) {
                this.rendererSuspended = suspended;
                this.suspendedAt = suspended ? Date.now() : 0;
                if (suspended && this._shown()) {
                    this.suspensions = (this.suspensions || []).filter(t => Date.now() - t < 60000);
                    this.suspensions.push(Date.now());
                    if (this.suspensions.length >= 3) {
                        this.recoveryLocked = 'REPEATED_SUSPEND'; this.softDone = true;
                        gpu.claim([]); gpu.show(false);
                    }
                }
                this.ownDown = null; this.downAt = null; this.ccuLast = null;
                this.log.info('DISPLAY_SURFACE ' + JSON.stringify(st));
                if (suspended) { this._grab(); this._lost(); }
                else { this.shownT = Date.now(); this.lastWords = null; this._grab(); this._layoutChanged(); }
            }
            if (st.front) {""")
    s = replace(s, "if (this.gpu !== gpu || gpu.onScreen || this.blocked || !this._shown()) return;",
        "if (this.gpu !== gpu || this.rendererFront !== false || gpu.onScreen || this.blocked || !this._shown()) return;")
    s = replace(s, "this.gpu.grab(this.grabbing || (this.own() && gate && !process.env.MGU_NO_GRAB));",
        "this.gpu.grab(this._shown() && !this.blocked && !this.softDone && !this.rendererSuspended && (this.grabbing || (this.own() && gate && !process.env.MGU_NO_GRAB)));")
    s = replace(s, "const on = this._shown();", "const on = this._shown() && !this.softDone;")
    s = replace(s, "const on = this._shown() && !this.softDone;", """const on = this._shown() && !this.softDone;
        if (!this._shown()) { this.softEpoch = (this.softEpoch || 0) + 1; this.softPending = false; }""")
    s = replace(s, "    present(name, r, softImage) {", """    present(name, r, softImage) {
        // Preserve the last GPU frame and do not overwrite/coalesce the fallback
        // with a plain HMI background while its upload is in flight.
        if (this.softPending) return Promise.resolve();""")
    s = replace(s, "this.gpu.show(on);\n        if (on) this.lastWords = null;",
        "this.gpu.show(on);\n        this._grab();\n        if (on) this.lastWords = null;")
    s = replace(s, "this.gpu.ready && this.place && !this.blocked && (!stateName",
        "this.gpu.ready && this.place && !this.blocked && !this.softDone && !this.rendererSuspended && (!stateName")
    s = replace(s, "this.gpu.ready && !this.blocked && this.gpu.native",
        "this.gpu.ready && !this.blocked && !this.softDone && !this.rendererSuspended && this.gpu.native")
    s = replace(s, "const plain = this.ownable() && !this.blocked;",
        "const plain = this.ownable() && !this.blocked && !this.softDone && !this.rendererSuspended;")
    s = replace(s, "if (this.ownable() && !this.blocked && this.gpu.visible === false",
        "if (this.ownable() && !this.blocked && !this.softDone && this.gpu.visible === false")
    s = replace(s, "this._keep(name, out, softImage);", "this._keep(name, out, softImage);\n        this.lastGpu = this.last;")
    s = replace(s, "if (this.last && this.active() && Date.now() - this.lastSent >= 1000) { this.lastSent = Date.now(); this.gpu.frame(this.last.frame); }",
        "if (this.lastGpu && this.gpu && this.gpu.ready && !this.softDone && !this.blocked && this._shown() && Date.now() - this.lastSent >= 1000) { this.lastSent = Date.now(); this.gpu.frame(this.lastGpu.frame); }")
    s = replace(s, "gpu.on('touch', (phase, x, y) => { if (this.gpu === gpu) this._touch(phase, x, y); });", """gpu.on('touch', (phase, x, y) => {
            if (this.gpu !== gpu) return;
            this.touchEvents = (this.touchEvents || 0) + 1;
            if (phase === 1 && this.touchEvents <= 20) this.log.info('DISPLAY_TOUCH x=' + x + ' y=' + y + ' targets=' + (this.pageTargets || []).length + ' active=' + this.active());
            if (!this.active()) return;
            try { this._touch(phase, x, y); } catch (e) { this.log.warn('DISPLAY_TOUCH_ERROR ' + e.stack); }
        });""")
    s = replace(s, "gpu.on('ccu', (v) => {\n            if (this.gpu !== gpu) return;", "gpu.on('ccu', (v) => {\n            if (this.gpu !== gpu) return;\n            this.ccuEvents = (this.ccuEvents || 0) + 1;\n            if (this.ccuEvents <= 10) this.log.info('DISPLAY_CCU ' + JSON.stringify(v));\n            if (!this.active()) return;")
    s = replace(s, """            const cv = new Canvas(L.w, L.h);
            if (plain) cv.clear(this.theme().bg); else play(L.frame.words(), cv);""",
        """            // The GPU frame includes screen-space chrome. PNG needs the original page.
            const page = this.app && this.app.name === L.name ? this.app : null;
            const cv = new Canvas(page ? page.w : L.w, page ? page.h : L.h);
            if (plain) cv.clear(this.theme().bg); else play(page ? page.words : L.frame.words(), cv);""")
    start = s.index('    /**\n     * Shown for 2 s')
    end = s.index('    _stats() {', start)
    s = s[:start] + """    /** Watch for missing acknowledgements throughout the visible session, not only at startup. */
    _softIfNoTick() {
        const L = this.last, now = Date.now(), g = this.gpu;
        if (!L || !g || !g.ready || !this.place || this.blocked || this.rendererSuspended || !this._shown() || !this.shownT) return;
        const idle = now - (this.softDone && this.softStallT ? this.softStallT : Math.max(this.shownT, this.tickT || 0));
        if (idle < 2000) return;
        // Keep the fallback current; never queue multiple slow HMI image uploads.
        if (!this.softBusy && (!this.softT || now - this.softT >= 1000)) {
            this.softT = now; this.softBusy = true;
            const epoch = this.softEpoch || 0;
            const valid = () => this.gpu === g && g.ready && (this.softEpoch || 0) === epoch && this._shown() && !this.blocked && !this.rendererSuspended;
            if (!this.softDone) {
                this.softPending = true;
                this.log.warn('DISPLAY_FALLBACK_PREPARE ackAgeMs=' + idle);
            }
            Promise.resolve().then(() => {
                if (!valid()) return false;
                const current = this.last, page = this.app && this.app.name === current.name ? this.app : null;
                const cv = new Canvas(page ? page.w : current.w, page ? page.h : current.h);
                play(page ? page.words : current.frame.words(), cv);
                return current.softImage(current.name, cv);
            }).then((sent) => {
                if (!valid()) return;
                if (sent === false) throw new Error('HMI did not accept the fallback image');
                if (!this.softDone) {
                    // setValue has completed: only now remove the covering GPU layer.
                    this.softStallT = now - idle;
                    this.softDone = true; this.softPending = false;
                    this.log.info('DISPLAY_FALLBACK_READY uploadMs=' + (Date.now() - now));
                    if (g.claim) g.claim([]);
                    g.show(false); this._grab();
                }
            }).catch((e) => {
                this.log.warn('display: HMI fallback failed; retaining GPU: ' + e);
            }).then(() => {
                this.softBusy = false;
                if ((this.softEpoch || 0) === epoch) this.softPending = false;
                if (valid()) this._recoverStalled(g);
            });
        }
        this._recoverStalled(g);
    }

    _recoverStalled(g) {
        // Disconnecting also destroys the GPU surface. Never do so before PNG succeeds.
        if (!this.softDone || this.gpu !== g || !g.ready || !this._shown() || this.blocked || this.rendererSuspended) return;
        // Late acknowledgements for SHOW(false) cannot cancel recovery. The
        // timeout belongs to the stalled GPU frame that caused this handoff.
        const now = Date.now(), idle = now - (this.softStallT || Math.max(this.shownT, this.tickT || 0));
        // Reconnect only our socket, never restart the shared renderer or force HMI focus.
        // A foreground disagreement belongs to BMW's gate, not to this watchdog.
        if (idle >= 4000 && this.rendererFront !== false && !this.recoveryLocked && g.recover) {
            if (this.recoveryAttempts >= 1) {
                this.recoveryLocked = 'REPEATED_STALL';
                this.log.warn('DISPLAY_RECOVERY_LOCKED repeated stall; waiting for explicit retry');
                this._layoutChanged();
            } else if (g.recover()) {
                this.recoveryAttempts = (this.recoveryAttempts || 0) + 1;
                this.recoveryT = now;
                this.log.warn('display: reconnecting stalled graphics layer');
            }
        }
    }

""" + s[end:]
    s = replace(s, "if (this.blocked) return 'HMI image: renderer has another app in front';",
        "if (this.blocked) return 'HMI image: renderer has another app in front';\n        if (this.softDone) return 'HMI image: recovering stalled graphics layer';")
    return s.encode('utf-8')


def patch_mgu(raw):
    s = raw.decode('utf-8')
    start = s.index('    _image(name, img, cell) {')
    end = s.index('\n}\n', start)
    image = s[start:end]
    image = replace(image, 'if (!c) return;', 'if (!c) return false;')
    image = replace(image, 'px.equals(st.lastPx)) return;', 'px.equals(st.lastPx)) return true;')
    image = replace(image, "        };\n        st.busy = run(img).catch((e) => log.warn('image ' + name + ': ' + e)).then(() => {",
        "        return true;\n        };\n        st.busy = run(img).catch((e) => { log.warn('image ' + name + ': ' + e); return false; }).then((accepted) => {")
    image = replace(image, 'return this._image(name, n, cell); }', 'return this._image(name, n, cell); }\n            return accepted;')
    return (s[:start] + image + s[end:]).encode('utf-8')


def patch_renderd(raw):
    s = raw.decode('utf-8')
    start = s.index("// the Store's renderer (mgu-render) first")
    end = s.index('const SOCKET = SOCKETS[0];', start)
    s = s[:start] + """// SpeedCAM uses the shared idrive7-apps service. Do not silently select the
// other renderer when both are installed. Missing/incompatible graphics use PNG.
// An explicit environment override remains available for diagnostics/replay.
const SOCKETS = process.env.MGU_RENDERD_SOCKET ? [process.env.MGU_RENDERD_SOCKET] : ['/run/mgu-renderd/renderd.sock'];
""" + s[end:]
    s = replace(s, '    close() {', """    // Use the existing reconnect path; close() would disable retries permanently.
    recover() {
        if (this.closed || this.opts.file || !this.sock || !this.ready) return false;
        this.grab(false);
        this.ready = false; this.waiting = false;
        this.sock.destroy();
        this.emit('close');
        return true;
    }
    close() {""")
    s = replace(s, 'this.connected = true;\n            this._reset();',
        'this.connected = true;\n            this.inbuf = Buffer.alloc(0); // A partial packet belongs to the previous connection.\n            this._reset();')
    s = replace(s, 'this.info = { touch:', 'this.info = { modes: p.readUInt32LE(4), touch:')
    # Ignore callbacks belonging to a socket replaced by recovery/manual retry.
    s = replace(s, "s.on('data', (d) => this._data(d));", "s.on('data', (d) => { if (this.sock === s) this._data(d); });")
    s = replace(s, "s.on('connect', () => {", "s.on('connect', () => {\n            if (this.sock !== s) return;")
    s = replace(s, "s.on('error', (e) => {", "s.on('error', (e) => {\n            if (this.sock !== s) return;")
    s = replace(s, "s.on('close', () => {\n            const was", "s.on('close', () => {\n            if (this.sock !== s) return;\n            const was")
    return s.encode('utf-8')
