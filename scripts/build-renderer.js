#!/usr/bin/env node
/**
 * build-renderer — bundles the renderer-side agent modules into a single
 * dist/renderer/bundle.js so index.html loads one script instead of an
 * ordered chain of <script> tags.
 *
 * The bundled modules use the legacy IIFE + window.XK* pattern; esbuild runs
 * each module's top-level code, so the globals are still attached at load time.
 * Their node-only fallbacks (e.g. agentLoop's require(path.join(__dirname,...)))
 * are unreachable in the browser because the window globals win first, so the
 * node builtins are marked external and never execute.
 */
const path = require('path');
const fs = require('fs');

// esbuild (and electron) ship PLATFORM-NATIVE binaries. If node_modules was copied
// from another OS/arch — e.g. a zip built on Windows unpacked on Linux — the require
// below throws a cryptic "@esbuild/<platform>" / "another platform" error. Turn that
// into an actionable message: the fix is always a clean reinstall on THIS machine.
let esbuild;
try {
    esbuild = require('esbuild');
} catch (err) {
    const msg = String(err && err.message || err);
    if (/esbuild|another platform|@esbuild\//i.test(msg)) {
        console.error(
            '\n[build-renderer] esbuild failed to load — its native binary does not match this ' +
            `platform (${process.platform}-${process.arch}).\n` +
            'This usually means node_modules was copied from a different OS (e.g. a Windows zip on Linux).\n' +
            'Fix it on THIS machine:\n' +
            '  rm -rf node_modules package-lock.json   # (or: del /s node_modules on Windows)\n' +
            '  npm install\n'
        );
        process.exit(1);
    }
    throw err;
}

const NODE_BUILTINS = [
  'path', 'fs', 'os', 'http', 'https', 'crypto', 'child_process',
  'util', 'stream', 'events', 'url', 'zlib', 'net', 'tls', 'assert', 'module'
];

const watch = process.argv.includes('--watch');

const options = {
  entryPoints: [path.join(__dirname, '..', 'src', 'renderer', 'entry.js')],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: ['chrome120'],
  outfile: path.join(__dirname, '..', 'dist', 'renderer', 'bundle.js'),
  external: NODE_BUILTINS,
  logLevel: 'info',
  logOverride: {
    // agentLoop's node-only dynamic require() fallback is intentionally
    // unresolvable in the browser bundle; it is guarded by window globals.
    'unsupported-require-call': 'silent'
  }
};

async function run() {
  if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    syncAppVersion();
    console.log('[build-renderer] watching for changes...');
  } else {
    await esbuild.build(options);
    syncAppVersion();
    console.log('[build-renderer] wrote dist/renderer/bundle.js');
  }
}

function syncAppVersion() {
  const pkg = require(path.join(__dirname, '..', 'package.json'));
  const htmlPath = path.join(__dirname, '..', 'index.html');
  let html = fs.readFileSync(htmlPath, 'utf8');
  const ver = `v${pkg.version}`;
  html = html.replace(
    /(<span id="app-version" class="as-version">)v[^<]+(<\/span>)/,
    `$1${ver}$2`
  );
  fs.writeFileSync(htmlPath, html);
  console.log(`[build-renderer] synced #app-version → ${ver}`);
}

run().catch((err) => {
  console.error('[build-renderer] failed:', err);
  process.exit(1);
});
