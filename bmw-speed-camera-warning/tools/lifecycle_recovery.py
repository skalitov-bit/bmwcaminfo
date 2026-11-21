"""Patch the pinned SDK bridge, preserving the OEM ACTIVE/shutdown contract."""
from render_recovery import replace


def patch_mgu(raw):
    s = raw.decode('utf-8')
    s = replace(s, "    const app = new OnlineApp();", """    const app = new OnlineApp();
    if (process.env.SPEEDCAM_SUPERVISED_WORKER === '1' && typeof process.send === 'function') {
        let stopping = false;
        const stop = () => { if (!stopping) { stopping = true; app.emit('shutdown'); } };
        app.on('shutdown', () => {
            stopping = true;
            if (process.connected) process.send({speedcamLifecycle: 1, event: 'shutdown'}, () => {});
        });
        process.on('message', m => { if (m && m.speedcamLifecycle === 1 && m.event === 'stop') stop(); });
        process.on('SIGTERM', stop);
        process.on('SIGINT', stop);
        // Never leave an orphan controlling cameras after its owner was stopped.
        process.on('disconnect', () => { stop(); setTimeout(() => process.exit(0), 1000); });
    }""")
    s = replace(s, "if (impl && impl.start) await step('app start', Promise.resolve().then(() => impl.start(ctx)), 5000);",
                """if (impl && impl.start) {
        // Do not swallow a fatal startup error and leave a silent, idle app.
        // Recovery happens in a new worker, never by double-starting this SDK.
        await impl.start(ctx);
        log.info('app start done');
    }""")
    s = replace(s, "if (lastEntry && ['ENTRY_POINT', 'BOOKMARK', 'LUM'].indexOf(String(app.startReason)) >= 0)",
                "if (lastEntry && !(Number(process.env.SPEEDCAM_RESTART_COUNT) > 0) && ['ENTRY_POINT', 'BOOKMARK', 'LUM'].indexOf(String(app.startReason)) >= 0)")
    s = replace(s, "    await app.start();", """    const launchGate = new (require('../manual-launch').ManualLaunchGate)(app, DATA_DIR, {log: m => log.info(m)});
    await app.start();
    if (!launchGate.allowStart()) {
        // No Display, database, GPS, audio, camera timers or impl.start here.
        // MainApp still owns a valid SDK entry point for the next user launch.
        active();
        await app.initialized();
        return {app, pausedByUser: true};
    }""")
    s = replace(s, "        app, ui, settings, log, spec: SPEC, dataDir: DATA_DIR, display, widget,", """        app, ui, settings, log, spec: SPEC, dataDir: DATA_DIR, display, widget,
        requestUserClose: () => {
            launchGate.close();
            // Hand the central screen back to BMW before replacing the worker.
            display.grab(false);
            if (display.gpu) display.gpu.show(false);
            Promise.resolve(ui.close('MAIN')).catch(e => log.warn('manual close UI: ' + e));
        },""")
    s = replace(s, "    const lastEntry = app.getLastExecutedEntryPointUuid && app.getLastExecutedEntryPointUuid();", """    const lastEntry = process.env.SPEEDCAM_RESUME_ENTRY || (app.getLastExecutedEntryPointUuid && app.getLastExecutedEntryPointUuid());
    if (process.env.SPEEDCAM_USER_RESUME === '1' && lastEntry) openEntry(lastEntry);""")
    return s.encode('utf-8')
