/**
 * Bounded recursive project file search. Several Code Mode checks (required-artifact existence,
 * index.html discovery, partial-build / plan-step scans) only looked at the project root + one
 * level of subdirectories, so a deliverable at e.g. src/js/app.js or apps/web/index.html was
 * reported missing — a false [ARTIFACT] block or a spurious recovery nudge. This walks a few
 * levels deep (breadth-first, so the shallowest match wins) while skipping vendor/build dirs.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const IGNORE = new Set([
    'node_modules', 'dist', 'build', '.git', '.agentsmith', 'release', 'coverage',
    '.cache', 'out', '.next', '.nuxt', 'vendor', 'tmp', '.venv', 'venv', '__pycache__', 'target'
]);

/** @returns {string|null} project-relative path of the shallowest file named `basename`, or null. */
function findFileDeep(root, basename, maxDepth = 4) {
    const target = String(basename || '').toLowerCase();
    if (!root || !target) return null;
    const queue = [{ dir: root, depth: 0, rel: '' }];
    while (queue.length) {
        const { dir, depth, rel } = queue.shift();
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { continue; }
        for (const e of entries) {
            if (e.isFile() && e.name.toLowerCase() === target) {
                return rel ? `${rel}/${e.name}` : e.name;
            }
        }
        if (depth < maxDepth) {
            for (const e of entries) {
                if (e.isDirectory() && !e.name.startsWith('.') && !IGNORE.has(e.name)) {
                    queue.push({ dir: path.join(dir, e.name), depth: depth + 1, rel: rel ? `${rel}/${e.name}` : e.name });
                }
            }
        }
    }
    return null;
}

/** True if a file named `basename` exists within `maxDepth` levels (any size). */
function fileExistsDeep(root, basename, maxDepth = 4) {
    const rel = findFileDeep(root, basename, maxDepth);
    return !!rel;
}

// Files that are legitimately empty (existence is enough — matches completionGate.artifactExists).
const EMPTY_OK = /(?:^|\/)(?:\.gitkeep|__init__\.py|py\.typed|\.nojekyll|\.gitignore)$/i;

/** True only if a NON-EMPTY file named `basename` exists. Matches the completion gate's
 *  required-artifact check, so the plan and the gate agree (a 0-byte README is NOT "done"). */
function fileHasContentDeep(root, basename, maxDepth = 4) {
    const rel = findFileDeep(root, basename, maxDepth);
    if (!rel) return false;
    if (EMPTY_OK.test(basename)) return true;
    try { return fs.readFileSync(path.join(root, rel), 'utf8').trim().length > 0; } catch (e) { return false; }
}

function findIndexHtmlDeep(root, maxDepth = 4) {
    return findFileDeep(root, 'index.html', maxDepth);
}

module.exports = { findFileDeep, fileExistsDeep, fileHasContentDeep, findIndexHtmlDeep, SCAN_IGNORE: IGNORE };
