/**
 * SSRF + download path hardening for the built-in web server.
 *
 * The /api/proxy/* endpoint exists only to let the mobile web client reach the
 * local (or user-configured) LLM server; /download_remote only to hand back files
 * the agent produced. Both previously accepted any target/path, turning the app
 * into an SSRF pivot and an arbitrary file reader. These pure helpers constrain
 * them to their legitimate purpose (kept dependency-free so they're unit-testable).
 */
const fs = require('fs');
const path = require('path');

function isLoopbackHost(host) {
    if (!host) return false;
    const h = String(host).toLowerCase().replace(/^\[|\]$/g, ''); // strip IPv6 brackets
    if (h === 'localhost' || h === '::1' || h === '0.0.0.0' || h === '::') return true;
    return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h); // 127.0.0.0/8
}

function isBlockedHost(host) {
    if (!host) return true;
    const h = String(host).toLowerCase().replace(/^\[|\]$/g, '');
    // Cloud metadata / link-local — never allowed, regardless of configuration.
    if (h === 'metadata.google.internal' || h === 'metadata') return true;
    if (h.startsWith('169.254.')) return true;            // IPv4 link-local (incl. 169.254.169.254)
    if (h.startsWith('fe80:') || h.startsWith('fd') || h.startsWith('fc')) return true; // IPv6 link-local / ULA
    return false;
}

/**
 * Parse a host into a 32-bit IPv4 number if it denotes one in any inet_aton form:
 * dotted-quad (`127.0.0.1`), bare integer (`2130706433`), hex (`0x7f000001`), octal,
 * or short dotted forms (`127.1`). Returns null for anything that isn't an IPv4 literal
 * (e.g. real hostnames). Mirrors how Node/glibc coerce these before connecting.
 */
function parseIPv4(host) {
    const parts = String(host).split('.');
    if (parts.length === 0 || parts.length > 4) return null;
    const vals = [];
    for (const p of parts) {
        if (p === '') return null;
        let n;
        if (/^0x[0-9a-f]+$/i.test(p)) n = parseInt(p, 16);
        else if (/^0[0-7]+$/.test(p)) n = parseInt(p, 8);
        else if (/^(?:0|[1-9]\d*)$/.test(p)) n = parseInt(p, 10);
        else return null;
        if (!Number.isInteger(n) || n < 0) return null;
        vals.push(n);
    }
    const last = vals[vals.length - 1];
    const lead = vals.slice(0, -1);
    if (lead.some(v => v > 255)) return null;
    if (last >= Math.pow(256, 4 - lead.length)) return null;
    let num = last;
    for (let i = 0; i < lead.length; i++) num += lead[i] * Math.pow(256, 3 - i);
    return num >>> 0;
}

function isInternalIPv4Num(n) {
    const a = (n >>> 24) & 255;
    const b = (n >>> 16) & 255;
    if (a === 0) return true;                          // 0.0.0.0/8 ("this" network)
    if (a === 10) return true;                         // 10.0.0.0/8 private
    if (a === 127) return true;                        // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true;           // 169.254.0.0/16 link-local
    if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16.0.0/12 private
    if (a === 192 && b === 168) return true;           // 192.168.0.0/16 private
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a >= 224) return true;                          // 224.0.0.0/4 multicast + 240/4 reserved
    return false;
}

/**
 * True when a host points back at the local machine or a private/internal network —
 * including loopback names, RFC1918/CGNAT/link-local/multicast ranges, and the numeric,
 * hex, octal and IPv4-mapped-IPv6 encodings that normalize to those. Real public
 * hostnames return false. Note: this inspects the literal host only and does NOT resolve
 * DNS, so a public name that resolves to a private IP (DNS rebinding) is out of scope.
 */
function isInternalHost(host) {
    if (!host) return true;
    // Strip trailing dot (FQDN form, e.g. "localhost." → "localhost") so
    // trailing-dot SSRF bypasses are blocked.
    const h = String(host).toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (isLoopbackHost(h) || isBlockedHost(h)) return true;
    if (h.includes(':')) { // IPv6
        if (h === '::1' || h === '::') return true;
        // IPv4-mapped (::ffff:a.b.c.d), which Node may normalize to hex (::ffff:7f00:1).
        const mapped = h.match(/^::ffff:(.+)$/);
        if (mapped) {
            const tail = mapped[1];
            let n = null;
            if (/^\d+\.\d+\.\d+\.\d+$/.test(tail)) {
                n = parseIPv4(tail);
            } else {
                const g = tail.split(':');
                if (g.length === 2 && g.every(x => /^[0-9a-f]{1,4}$/.test(x))) {
                    n = (((parseInt(g[0], 16) << 16) >>> 0) | parseInt(g[1], 16)) >>> 0;
                }
            }
            if (n !== null && isInternalIPv4Num(n)) return true;
        }
        if (h.startsWith('fe80') || h.startsWith('fc') || h.startsWith('fd')) return true; // link-local / ULA
        if (h.startsWith('ff')) return true; // multicast
        return false;
    }
    const n = parseIPv4(h);
    if (n !== null) return isInternalIPv4Num(n);
    return false;
}

function normOrigin(u) {
    let host = u.hostname.toLowerCase();
    if (host === 'localhost') host = '127.0.0.1';
    const port = u.port || (u.protocol === 'https:' ? '443' : '80');
    return `${u.protocol}//${host}:${port}`;
}

/**
 * Returns the parsed URL if the proxy target is permitted, else null.
 * Allows loopback (default LM Studio/Ollama) or the configured LLM origin only.
 */
function validateProxyTarget(targetUrl, lmsHostUrl) {
    let u;
    try { u = new URL(targetUrl); } catch (e) { return null; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (isBlockedHost(u.hostname)) return null;
    if (isLoopbackHost(u.hostname)) return u;
    const allowed = new Set();
    try { allowed.add(normOrigin(new URL(lmsHostUrl))); } catch (e) { /* ignore */ }
    if (allowed.has(normOrigin(u))) return u;
    return null;
}

/**
 * Validate a target for an OUTBOUND fetch (plugin `net` capability, plugin
 * installer downloads). Unlike validateProxyTarget this intentionally allows
 * arbitrary PUBLIC https/http hosts — plugins legitimately reach the internet —
 * but refuses any host that points back at the local machine or a private/internal
 * network (loopback, RFC1918, link-local, CGNAT, multicast, cloud-metadata) so the
 * app can't be used as an SSRF pivot at intranet services or local admin panels.
 * Numeric/hex/octal and IPv4-mapped-IPv6 loopback encodings are covered too.
 * Returns the parsed URL or null.
 */
function validatePublicFetchTarget(targetUrl) {
    let u;
    try { u = new URL(targetUrl); } catch (e) { return null; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (isInternalHost(u.hostname)) return null;
    return u;
}

/**
 * Returns an absolute, symlink-resolved path if rawPath is a real file inside one
 * of `allowedRoots`, else null. Roots that don't exist are skipped.
 */
function validateDownloadPath(rawPath, allowedRoots) {
    if (!rawPath) return null;
    let abs;
    try {
        abs = fs.realpathSync(path.resolve(rawPath)); // resolves symlinks too
        if (!fs.statSync(abs).isFile()) return null;
    } catch (e) {
        return null; // missing / unreadable / not a file
    }
    for (const root of allowedRoots || []) {
        let realRoot;
        try { realRoot = fs.realpathSync(root); } catch (e) { continue; }
        const rel = path.relative(realRoot, abs);
        if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return abs;
    }
    return null;
}

function validatePreviewAssetPath(rawPath, userDataPath) {
    if (!userDataPath) return null;
    const previewsRoot = path.join(userDataPath, 'previews');
    return validateDownloadPath(rawPath, [previewsRoot]);
}

function validatePreviewUrl(targetUrl) {
    const pub = validatePublicFetchTarget(targetUrl);
    if (pub) return pub;
    let u;
    try { u = new URL(targetUrl); } catch (e) { return null; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (isBlockedHost(u.hostname)) return null;
    if (isLoopbackHost(u.hostname)) return u;
    return null;
}

function normalizeLlmBaseUrl(base) {
    let b = String(base || 'http://127.0.0.1:1234').trim();
    if (!/^https?:\/\//i.test(b)) b = `http://${b}`;
    b = b.replace(/\/+$/, '').replace(/\/v1$/, '').replace(/\/api$/, '');
    try {
        const u = new URL(b);
        let host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
        if (host === 'localhost' || host === '::1') u.hostname = '127.0.0.1';
        let out = `${u.protocol}//${u.hostname}`;
        if (u.port) out += `:${u.port}`;
        return out;
    } catch (e) {
        return b;
    }
}

module.exports = {
    isLoopbackHost,
    isBlockedHost,
    isInternalHost,
    normOrigin,
    normalizeLlmBaseUrl,
    validateProxyTarget,
    validatePublicFetchTarget,
    validateDownloadPath,
    validatePreviewAssetPath,
    validatePreviewUrl
};
