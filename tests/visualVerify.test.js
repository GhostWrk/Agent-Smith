/**
 * Visual game verification: a game must not pass if the preview/canvas is visually blank.
 * The vm smoke runs scripts against a stub canvas (draw calls no-op), so a blank game "executes
 * without errors". analyzeVisual + the real-browser probe close that gap.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyzeVisual, VISUAL_PROBE_SRC } = require('../src/code/governor/visualProbe.js');
const { runAcceptance } = require('../src/code/governor/acceptance.js');
const { checkCompletion } = require('../src/code/governor/completionGate.js');
const { serveAndCheck } = require('../src/code/governor/runtimeVerify.js');

let puppeteer;
try { puppeteer = require('puppeteer'); } catch (e) { /* optional */ }

function mkproj(files) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vv-'));
    for (const [rel, content] of Object.entries(files)) fs.writeFileSync(path.join(root, rel), content);
    return root;
}

test('explicit Mega Man game prompt uses GAME acceptance (not changed)', () => {
    const r = runAcceptance('Build a Mega Man-style web platformer game', { html: '<canvas id="g"></canvas>', js: '' });
    assert.equal(r.applicable, true, 'acceptance applies to a game prompt');
    assert.equal(r.isWeb, true);
    assert.ok(r.checks.some(c => c.id === 'game-area' || c.id === 'player'), 'uses game acceptance checks');
});

test('non-game web app acceptance is unaffected', () => {
    const r = runAcceptance('Build a to-do list app', { html: '<input>', js: "document.addEventListener('click',()=>{document.body.innerHTML='x';[].push(1);});" });
    assert.equal(r.applicable, true);
    assert.ok(r.checks.some(c => c.id === 'interactivity'), 'still uses CRUD/web-app acceptance, not game checks');
});

test('analyzeVisual: a game with a blank canvas and no UI fails [VISUAL]', () => {
    const e = analyzeVisual({ canvases: [{ w: 400, h: 300, blank: true }], bodyHasText: false, visibleEls: 0 }, { isGame: true }).errors;
    assert.ok(e.some(m => /Preview appears blank; game UI\/canvas did not render visible content\./.test(m)));
});
test('analyzeVisual: a game with a zero-size canvas fails [VISUAL]', () => {
    assert.ok(analyzeVisual({ canvases: [{ w: 0, h: 0, blank: true }], bodyHasText: false, visibleEls: 0 }, { isGame: true }).errors.length > 0);
});
test('analyzeVisual: a game that draws to canvas passes', () => {
    assert.deepEqual(analyzeVisual({ canvases: [{ w: 400, h: 300, blank: false }], bodyHasText: false, visibleEls: 0 }, { isGame: true }).errors, []);
});
test('analyzeVisual: a game with a visible DOM start screen passes (click-to-start)', () => {
    assert.deepEqual(analyzeVisual({ canvases: [], bodyHasText: true, visibleEls: 3 }, { isGame: true }).errors, []);
});
test('analyzeVisual: probe unavailable is fail-open (never blocks)', () => {
    assert.deepEqual(analyzeVisual(null, { isGame: true }).errors, []);
});

test('the completion gate surfaces [VISUAL] when the real-browser check reports a blank game', async () => {
    const root = mkproj({
        'index.html': '<!doctype html><html><body><canvas id="g" width="400" height="300"></canvas><script src="script.js"></script></body></html>',
        // has getContext (so static game acceptance passes) but never draws -> blank in a real browser
        'script.js': "const c=document.getElementById('g').getContext('2d');\nwindow.addEventListener('keydown',()=>{});\nfunction loop(){requestAnimationFrame(loop);}loop();"
    });
    const runtimeVerify = async (_pr, _html, opts) => {
        assert.equal(opts && opts.isGame, true, 'gate tells the runtime check it is a game');
        return { ok: false, skipped: false, errors: [], visualErrors: ['Preview appears blank; game UI/canvas did not render visible content.'] };
    };
    const r = await checkCompletion(root, ['index.html', 'script.js'], 'Build a Mega Man platformer game', { grindMode: false, runtimeVerify });
    assert.equal(r.allow, false, 'a blank game must not pass');
    assert.ok((r.messages || []).some(m => /^\[VISUAL\] Preview appears blank/.test(m)), 'gate emits [VISUAL]');
    fs.rmSync(root, { recursive: true, force: true });
});

test('real browser: blank game FAILS, drawing game PASSES, and a re-check reflects new files (not stale)', async (t) => {
    if (!puppeteer) return t.skip('puppeteer not installed');
    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader'] });
    const check = async (url) => {
        const p = await browser.newPage();
        const errors = [];
        p.on('pageerror', e => errors.push(e.message));
        await p.goto(url, { waitUntil: 'networkidle2', timeout: 8000 });
        await p.evaluate(() => new Promise(r => setTimeout(r, 400)));
        let visual = null;
        try { visual = await p.evaluate(VISUAL_PROBE_SRC); } catch (e) { /* unavailable */ }
        await p.close();
        return { errors, visual };
    };
    try {
        const root = mkproj({ 'index.html': '<!doctype html><html><body><canvas id="g" width="400" height="300"></canvas><script src="script.js"></script></body></html>' });
        // 1) blank: canvas never drawn
        fs.writeFileSync(path.join(root, 'script.js'), "window.addEventListener('keydown',()=>{});");
        let r = await serveAndCheck(root, 'index.html', check, { isGame: true });
        assert.equal(r.ok, false, 'blank game must fail');
        assert.ok((r.visualErrors || []).some(m => /blank/i.test(m)));
        // 2) re-check after writing a DRAWING script — must reflect the NEW file (fresh, not stale)
        fs.writeFileSync(path.join(root, 'script.js'), "const c=document.getElementById('g').getContext('2d');c.fillStyle='#2980b9';c.fillRect(0,0,400,300);c.fillStyle='#fff';c.fillRect(40,40,60,60);");
        r = await serveAndCheck(root, 'index.html', check, { isGame: true });
        assert.equal(r.ok, true, 'after drawing, the SAME project verifies fresh and passes; visual: ' + (r.visualErrors || []).join(' | '));
        fs.rmSync(root, { recursive: true, force: true });
    } finally {
        await browser.close();
    }
});
