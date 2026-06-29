/**
 * Regression tests for the Batch 8 (shared/security-relevant utilities) audit fixes:
 *   - commandPolicy: long-option variants can no longer bypass destructive-root blocking
 *   - netGuard: validatePublicFetchTarget refuses loopback/private SSRF targets
 *   - grepTool: the ripgrep backend honors .xkaliberignore + default ignores
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

const { assessCommand } = require('../src/shared/commandPolicy.js');
const { validatePublicFetchTarget, isInternalHost } = require('../src/shared/netGuard.js');
const { grepProject } = require('../src/shared/grepTool.js');

// --- commandPolicy: long-option destructive-root bypass --------------------

test('commandPolicy blocks long-option variants of destructive-root commands', () => {
    const blocked = [
        'rm --no-preserve-root -rf /',
        'rm -rf --no-preserve-root /',
        'rm --recursive --force /',
        'chmod --recursive 777 /',
        'chown --recursive root /',
        'sudo rm --no-preserve-root -rf /',
        'cd /tmp && rm --recursive --force ~',
    ];
    for (const c of blocked) {
        assert.equal(assessCommand(c).allowed, false, `should block: ${c}`);
    }
});

test('commandPolicy still allows ordinary recursive deletes inside a project', () => {
    const ok = [
        'rm -rf node_modules',
        'rm --recursive --force ./dist',
        'chmod -R 755 ./build',
        'chown -R me ./src',
        'rm -rf /tmp/scratch/build',
    ];
    for (const c of ok) {
        assert.equal(assessCommand(c).allowed, true, `should allow: ${c}`);
    }
});

// --- netGuard: SSRF to loopback / private networks -------------------------

test('validatePublicFetchTarget rejects loopback and private-network targets', () => {
    const blocked = [
        'http://127.0.0.1/',
        'http://localhost:8080/admin',
        'http://10.0.0.5/',
        'http://192.168.1.1/',
        'http://172.16.0.1/',
        'http://169.254.169.254/latest/meta-data/',
        'http://2130706433/',        // integer 127.0.0.1
        'http://0x7f000001/',        // hex 127.0.0.1
        'http://127.1/',             // short-form 127.0.0.1
        'http://[::1]/',
        'http://[::ffff:127.0.0.1]/',
        'http://100.64.0.1/',        // CGNAT
    ];
    for (const u of blocked) {
        assert.equal(validatePublicFetchTarget(u), null, `should reject: ${u}`);
    }
});

test('validatePublicFetchTarget still allows genuine public hosts', () => {
    for (const u of ['https://example.com/', 'http://93.184.216.34/', 'https://api.github.com/repos']) {
        assert.ok(validatePublicFetchTarget(u), `should allow: ${u}`);
    }
});

test('isInternalHost classifies literal IPs without resolving DNS', () => {
    assert.equal(isInternalHost('127.0.0.1'), true);
    assert.equal(isInternalHost('10.255.255.255'), true);
    assert.equal(isInternalHost('8.8.8.8'), false);
    assert.equal(isInternalHost('example.com'), false);
});

// --- grepTool: rg backend respects ignore semantics ------------------------

test('grepProject does not surface matches under default-ignored or .xkaliberignore paths', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grep-ignore-'));
    fs.writeFileSync(path.join(root, '.xkaliberignore'), 'secrets/\n');
    fs.mkdirSync(path.join(root, 'secrets'));
    fs.mkdirSync(path.join(root, 'node_modules'));
    fs.writeFileSync(path.join(root, 'app.js'), 'const TOKEN = "needle";\n');
    fs.writeFileSync(path.join(root, 'secrets', 'key.txt'), 'needle\n');
    fs.writeFileSync(path.join(root, 'node_modules', 'dep.js'), 'needle\n');

    const r = await grepProject(root, 'needle');
    const files = (r.hits || []).map(h => h.file);
    assert.ok(files.includes('app.js'), `expected app.js hit; got ${JSON.stringify(files)}`);
    assert.ok(!files.some(f => f.startsWith('secrets/')), `.xkaliberignore path leaked: ${JSON.stringify(files)}`);
    assert.ok(!files.some(f => f.startsWith('node_modules/')), `default-ignored path leaked: ${JSON.stringify(files)}`);
});
