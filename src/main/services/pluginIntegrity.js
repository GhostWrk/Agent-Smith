/**
 * Plugin integrity hashing. Enabling a plugin records a content hash ("trust on first
 * enable"); on every later discover the hash is recomputed and a mismatch quarantines
 * the plugin until the user re-enables it. This turns silent post-install tampering or an
 * auto-pulled update into an explicit re-consent step.
 *
 * This is NOT code signing (no author identity) and NOT a sandbox — it is tamper-evidence
 * for the trusted-code model: "the bytes you approved are the bytes that run".
 *
 * Pure-ish: fs/path are injectable for tests.
 */
'use strict';

const crypto = require('crypto');

const CODE_EXT = new Set(['.js', '.cjs', '.mjs', '.json']);

function walk(dir, fs, path, base, out) {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (e.name === 'node_modules' || e.name === '.git') continue;
        const abs = path.join(dir, e.name);
        const rel = path.relative(base, abs).replace(/\\/g, '/');
        if (e.isDirectory()) {
            walk(abs, fs, path, base, out);
        } else if (CODE_EXT.has(path.extname(e.name).toLowerCase())) {
            out.push({ rel, abs });
        }
    }
}

/**
 * Deterministic sha256 over every code/manifest file under the plugin dir
 * (sorted by relative path; content + path included so a rename also changes the hash).
 */
function hashPluginDir(dir, deps = {}) {
    const fs = deps.fs || require('fs');
    const path = deps.path || require('path');
    const files = [];
    walk(dir, fs, path, dir, files);
    files.sort((a, b) => a.rel.localeCompare(b.rel));
    const h = crypto.createHash('sha256');
    for (const f of files) {
        let content = '';
        try { content = fs.readFileSync(f.abs); } catch (e) { content = ''; }
        h.update(f.rel);
        h.update('\0');
        h.update(content);
        h.update('\0');
    }
    return h.digest('hex');
}

module.exports = { hashPluginDir };
