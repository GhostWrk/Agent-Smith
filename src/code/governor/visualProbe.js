/**
 * Visual render probe — proves a built page actually shows something, so a game can't "pass"
 * while the preview is blank/white. The vm smoke runs scripts against a STUB canvas whose draw
 * calls no-op, so a game that renders nothing (or draws to a zero-size / off-screen / blank
 * canvas) executes "without errors". This module runs in a REAL browser (Electron in-app,
 * Puppeteer in tests): VISUAL_PROBE_JS inspects the live DOM/canvas; analyzeVisual turns the
 * result into a verdict the completion gate surfaces as [VISUAL] failures.
 */
'use strict';

// A self-contained function (no closures) so it can be stringified and run via executeJavaScript
// / page.evaluate. Returns plain JSON: canvas sizes + whether each canvas has varied (non-blank)
// pixels, plus whether the body has any visible content. Tolerant of tainted/cross-origin canvas.
const VISUAL_PROBE_JS = function () {
    var out = { canvases: [], bodyHasText: false, visibleEls: 0, bodyArea: 0 };
    try {
        var cs = document.querySelectorAll('canvas');
        for (var i = 0; i < cs.length; i++) {
            var c = cs[i];
            var w = c.width | 0, h = c.height | 0;
            var blank = true;
            try {
                var ctx = c.getContext('2d');
                if (ctx && w > 0 && h > 0) {
                    var sw = Math.min(w, 240), sh = Math.min(h, 240);
                    var data = ctx.getImageData(0, 0, sw, sh).data;
                    var r = data[0], g = data[1], b = data[2], a = data[3];
                    for (var p = 4; p < data.length; p += 4) {
                        if (data[p] !== r || data[p + 1] !== g || data[p + 2] !== b || data[p + 3] !== a) { blank = false; break; }
                    }
                } else if (w === 0 || h === 0) {
                    blank = true;
                } else {
                    blank = null; // no 2d context (maybe webgl) -> unknown
                }
            } catch (e) { blank = null; } // tainted / readback unsupported -> unknown
            out.canvases.push({ w: w, h: h, blank: blank });
        }
        var body = document.body;
        out.bodyHasText = !!(body && (body.innerText || '').trim().length > 0);
        if (body) {
            var br = body.getBoundingClientRect ? body.getBoundingClientRect() : null;
            out.bodyArea = br ? Math.round(br.width * br.height) : 0;
            var all = body.querySelectorAll('*');
            for (var j = 0; j < all.length; j++) {
                var el = all[j];
                var tag = (el.tagName || '').toLowerCase();
                // Don't count the canvas (a blank canvas is "visible" but shows nothing) or
                // non-visual tags — we want visible DOM UI BESIDES the canvas.
                if (tag === 'canvas' || tag === 'script' || tag === 'style' || tag === 'link' || tag === 'meta') continue;
                var rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
                if (rect && rect.width > 1 && rect.height > 1) { out.visibleEls++; if (out.visibleEls > 4) break; }
            }
        }
    } catch (e) { /* return whatever we have */ }
    return out;
};

/** Source string usable as `(<fn>)()` inside a page. */
const VISUAL_PROBE_SRC = '(' + VISUAL_PROBE_JS.toString() + ')()';

/**
 * Turn a probe result into [VISUAL] error messages.
 * @param {object|null} probe  result of VISUAL_PROBE_JS (null/undefined -> fail-open, no errors)
 * @param {{ isGame?: boolean }} [opts]
 * @returns {{ errors: string[] }}
 */
function analyzeVisual(probe, opts = {}) {
    if (!probe || typeof probe !== 'object') return { errors: [] }; // probe unavailable -> don't block
    const canvases = Array.isArray(probe.canvases) ? probe.canvases : [];
    const bodyVisible = !!probe.bodyHasText || (probe.visibleEls || 0) > 0;
    const errors = [];

    if (opts.isGame) {
        if (canvases.length) {
            const drew = canvases.some(c => c.w > 0 && c.h > 0 && c.blank === false);
            const allZeroDim = canvases.every(c => !c.w || !c.h);
            const anyUnknown = canvases.some(c => c.blank === null);
            if (drew) return { errors: [] };                       // a canvas rendered visible content
            if (allZeroDim) {
                errors.push('Preview appears blank; the game canvas has zero size — set its width/height and draw to it.');
            } else if (!anyUnknown && !bodyVisible) {
                // canvas exists, is readable, but all pixels are identical, and no visible DOM UI
                errors.push('Preview appears blank; game UI/canvas did not render visible content.');
            }
        } else if (!bodyVisible) {
            errors.push('Preview appears blank; game UI/canvas did not render visible content.');
        }
    } else {
        // Non-game page: just confirm it's not a blank/white screen.
        const anyCanvasDrew = canvases.some(c => c.blank === false);
        if (!bodyVisible && !anyCanvasDrew) {
            errors.push('Preview appears blank; the page did not render visible content.');
        }
    }
    return { errors };
}

module.exports = { VISUAL_PROBE_JS, VISUAL_PROBE_SRC, analyzeVisual };
