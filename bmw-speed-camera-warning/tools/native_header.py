"""Keep BMW's own title/status strip visible in the pinned GPU runtime."""
def patch_display(raw):
    s=raw.decode('utf-8')
    replacements=[
        ("const end = G.header(c,", "const nativeHeader = this.spec.nativeHeader === true;\n        const end = nativeHeader ? hx : G.header(c,"),
        ("if (!this.sheet) this.headMax = Math.max(this.headMax || 0, end);", "if (nativeHeader) this.headMax = 0;\n        else if (!this.sheet) this.headMax = Math.max(this.headMax || 0, end);"),
        ("const sx = this.headEnd = Math.min(HMI.status.x - pl.x, Math.ceil(Math.max(end, this.headMax || 0)));", "const sx = this.headEnd = nativeHeader ? hx : Math.min(HMI.status.x - pl.x, Math.ceil(Math.max(end, this.headMax || 0)));"),
        ("drawCredit(c, W - 18, FULL.headH + 17);", "drawCredit(c, W - 18, FULL.headH + 17);\n        if (nativeHeader) {\n            // Clear our whole overlay strip, including the cached title/tab rectangles.\n            // The OEM title, home and status icons beneath remain untouched.\n            c.clip(0, 0, W, FULL.headH).clear(0).noclip();\n            c.tabRects = [];\n        }"),
        ("this.gpu.claim([{ x: hx, y: 0, w: this.headEnd - hx, h: this.headH() }, { x: hx, y: this.headH(), w: W - hx, h: pl.h - this.headH() }].map(logical));", "const areas = [{ x: hx, y: this.headH(), w: W - hx, h: pl.h - this.headH() }];\n            if (this.spec.nativeHeader !== true) areas.unshift({ x: hx, y: 0, w: this.headEnd - hx, h: this.headH() });\n            this.gpu.claim(areas.map(logical));")
    ]
    for old,new in replacements:
        if s.count(old)!=1:raise ValueError('Pinned display runtime changed; review native title patch: '+old)
        s=s.replace(old,new)
    return s.encode('utf-8')
