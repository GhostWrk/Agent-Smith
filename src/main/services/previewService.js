/**
 * Preview service — project path resolve, snapshot storage, URL/window capture.
 */
'use strict';

const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { validatePreviewUrl, validatePreviewAssetPath } = require('../../shared/netGuard.js');

const CAPTURE_TIMEOUT_MS = 20000;
const DEFAULT_VIEWPORT = { width: 1280, height: 720 };

function newPreviewId() {
    return `pv_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function previewsDir(userDataPath) {
    return path.join(userDataPath, 'previews');
}

function resolveProjectFile(projectContext, relPath) {
    const target = String(relPath || 'index.html').replace(/^[/\\]+/, '');
    const resolved = projectContext.resolvePath(target);
    if (resolved.error) return { error: resolved.error };
    return { absPath: resolved.path, relPath: target };
}

function buildProjectPreviewUrl(host, port, relPath, token) {
    const clean = String(relPath || 'index.html').replace(/^[/\\]+/, '').split(/[/\\]/).map(encodeURIComponent).join('/');
    const base = `http://${host}:${port}/preview/project/${clean}`;
    if (token) return `${base}?token=${encodeURIComponent(token)}`;
    return base;
}

function buildAssetUrl(host, port, previewId, ext, token) {
    const base = `http://${host}:${port}/preview/asset/${previewId}.${ext}`;
    if (token) return `${base}?token=${encodeURIComponent(token)}`;
    return base;
}

async function saveSnapshot(userDataPath, pngBuffer, meta) {
    const id = newPreviewId();
    const dir = previewsDir(userDataPath);
    await fsPromises.mkdir(dir, { recursive: true });
    const pngPath = path.join(dir, `${id}.png`);
    const jsonPath = path.join(dir, `${id}.json`);
    await fsPromises.writeFile(pngPath, pngBuffer);
    const sidecar = Object.assign({
        id,
        createdAt: Date.now()
    }, meta || {});
    await fsPromises.writeFile(jsonPath, JSON.stringify(sidecar, null, 2), 'utf-8');
    return { previewId: id, pngPath, jsonPath, meta: sidecar };
}

async function loadSnapshotMeta(userDataPath, previewId) {
    const jsonPath = path.join(previewsDir(userDataPath), `${previewId}.json`);
    if (!fs.existsSync(jsonPath)) return null;
    try {
        return JSON.parse(await fsPromises.readFile(jsonPath, 'utf-8'));
    } catch (e) {
        return null;
    }
}

function getElectron() {
    try {
        return require('electron');
    } catch (e) {
        return null;
    }
}

async function captureWebUrl(targetUrl, viewport, deps) {
    const u = validatePreviewUrl(targetUrl);
    if (!u) return { error: 'URL rejected (must be http(s) to a public or loopback host).' };

    const electron = getElectron();
    const BrowserWindow = deps?.BrowserWindow || electron?.BrowserWindow;
    if (!BrowserWindow) return { error: 'Web capture requires Electron (not available in this environment).' };

    const vp = Object.assign({}, DEFAULT_VIEWPORT, viewport || {});
    let win;
    try {
        win = new BrowserWindow({
            width: vp.width,
            height: vp.height,
            show: false,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: true
            }
        });

        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Page load timed out (20s).')), CAPTURE_TIMEOUT_MS);
            win.webContents.once('did-finish-load', () => {
                clearTimeout(timer);
                resolve();
            });
            win.webContents.once('did-fail-load', (_e, _code, desc) => {
                clearTimeout(timer);
                reject(new Error(desc || 'Page failed to load'));
            });
            win.loadURL(u.toString()).catch(reject);
        });

        await new Promise(r => setTimeout(r, 500));
        const img = await win.webContents.capturePage();
        const png = img.toPNG();
        return { pngBuffer: png, url: u.toString() };
    } catch (e) {
        return { error: e.message || String(e) };
    } finally {
        if (win && !win.isDestroyed()) win.destroy();
    }
}

async function captureAppWindow(getMainWindow) {
    const electron = getElectron();
    if (!electron) return { error: 'Capture requires Electron.' };
    const win = getMainWindow?.();
    if (!win || win.isDestroyed()) return { error: 'Main window not available.' };
    try {
        const img = await win.webContents.capturePage();
        return { pngBuffer: img.toPNG() };
    } catch (e) {
        return { error: e.message || String(e) };
    }
}

async function captureDesktopSource(sourceId) {
    const electron = getElectron();
    const { desktopCapturer } = electron || {};
    if (!desktopCapturer) {
        return { error: 'Desktop capture requires Electron.' };
    }
    try {
        const sources = await desktopCapturer.getSources({
            types: ['screen', 'window'],
            thumbnailSize: { width: 1920, height: 1080 }
        });
        const source = sources.find(s => s.id === sourceId);
        if (!source || !source.thumbnail) {
            return { error: 'Source not found or thumbnail unavailable.' };
        }
        return { pngBuffer: source.thumbnail.toPNG() };
    } catch (e) {
        return { error: e.message || String(e) };
    }
}

async function listDesktopSources() {
    const electron = getElectron();
    const { desktopCapturer } = electron || {};
    if (!desktopCapturer) return { error: 'Desktop capture requires Electron.', sources: [] };
    try {
        const sources = await desktopCapturer.getSources({
            types: ['screen', 'window'],
            thumbnailSize: { width: 200, height: 120 }
        });
        return {
            sources: sources.map(s => ({
                id: s.id,
                name: s.name,
                thumbnail: s.thumbnail?.toDataURL?.() || null
            }))
        };
    } catch (e) {
        return { error: e.message, sources: [] };
    }
}

function assetPathForId(userDataPath, previewId, ext) {
    const p = path.join(previewsDir(userDataPath), `${previewId}.${ext}`);
    return validatePreviewAssetPath(p, userDataPath) ? p : null;
}

module.exports = {
    newPreviewId,
    previewsDir,
    resolveProjectFile,
    buildProjectPreviewUrl,
    buildAssetUrl,
    saveSnapshot,
    loadSnapshotMeta,
    captureWebUrl,
    captureAppWindow,
    captureDesktopSource,
    listDesktopSources,
    assetPathForId,
    DEFAULT_VIEWPORT
};
