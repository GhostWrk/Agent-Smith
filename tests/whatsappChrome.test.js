/**
 * WhatsApp QR linking needs a Chrome/Chromium binary. resolveChromeExecutable should
 * fall back to a system browser when Puppeteer's cache is empty.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const Module = require('module');

const realLoad = Module._load;

test('resolveChromeExecutable falls back to system Chrome when puppeteer cache is empty', () => {
    Module._load = function (request, parent, isMain) {
        if (request === 'puppeteer') throw new Error('Could not find Chrome (ver. 146.0.7680.153).');
        return realLoad.apply(this, arguments);
    };
    delete require.cache[require.resolve('../src/main/lifecycle/whatsapp.js')];
    const { resolveChromeExecutable } = require('../src/main/lifecycle/whatsapp.js');
    Module._load = realLoad;

    const candidates = [
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser'
    ];
    const found = candidates.find((p) => fs.existsSync(p));
    if (!found) {
        assert.equal(resolveChromeExecutable(), null);
        return;
    }
    assert.equal(resolveChromeExecutable(), found);
});
