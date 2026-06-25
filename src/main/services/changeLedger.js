const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;

class ChangeLedger {
    constructor(userDataPath) {
        this.userDataPath = userDataPath;
        this.snapCounter = 0;
    }

    getLedgerDir(planId) {
        return path.join(this.userDataPath, 'ledger', planId);
    }

    async ensureDir(planId) {
        const dir = this.getLedgerDir(planId);
        await fsPromises.mkdir(dir, { recursive: true });
        return dir;
    }

    manifestPath(planId) {
        return path.join(this.getLedgerDir(planId), 'manifest.json');
    }

    async loadManifest(planId) {
        try {
            const raw = await fsPromises.readFile(this.manifestPath(planId), 'utf-8');
            const data = JSON.parse(raw);
            this.snapCounter = data.snapCounter || 0;
            return data.entries || [];
        } catch (e) {
            return [];
        }
    }

    async saveManifest(planId, entries) {
        await this.ensureDir(planId);
        await fsPromises.writeFile(
            this.manifestPath(planId),
            JSON.stringify({ snapCounter: this.snapCounter, entries }, null, 2),
            'utf-8'
        );
    }

    async snapshotBefore(planId, filePath, action) {
        await this.ensureDir(planId);
        const entries = await this.loadManifest(planId);
        this.snapCounter += 1;
        const snapshotId = `snap_${this.snapCounter}`;
        const snapFile = path.join(this.getLedgerDir(planId), `${snapshotId}.bin`);

        let existed = false;
        try {
            await fsPromises.access(filePath);
            existed = true;
            const content = await fsPromises.readFile(filePath);
            await fsPromises.writeFile(snapFile, content);
        } catch (e) {
            existed = false;
        }

        entries.push({
            path: filePath,
            action,
            snapshotId,
            existed,
            ts: Date.now()
        });
        await this.saveManifest(planId, entries);
        return { snapshotId, existed };
    }

    async recordCreate(planId, filePath) {
        await this.ensureDir(planId);
        const entries = await this.loadManifest(planId);
        this.snapCounter += 1;
        const snapshotId = `snap_${this.snapCounter}`;
        entries.push({
            path: filePath,
            action: 'create',
            snapshotId,
            existed: false,
            ts: Date.now()
        });
        await this.saveManifest(planId, entries);
        return { snapshotId };
    }

    /** Simple unified diff (line-based) */
    diffText(original, current) {
        const oLines = (original || '').split('\n');
        const cLines = (current || '').split('\n');
        const out = [];
        const max = Math.max(oLines.length, cLines.length);
        let oi = 0;
        let ci = 0;
        while (oi < oLines.length || ci < cLines.length) {
            if (oi < oLines.length && ci < cLines.length && oLines[oi] === cLines[ci]) {
                out.push(` ${oLines[oi]}`);
                oi++;
                ci++;
            } else if (ci < cLines.length && (oi >= oLines.length || oLines[oi] !== cLines[ci])) {
                out.push(`+${cLines[ci]}`);
                ci++;
            } else if (oi < oLines.length) {
                out.push(`-${oLines[oi]}`);
                oi++;
            }
        }
        return out.join('\n');
    }

    diffFile(original, current, relPath) {
        const p = relPath || 'file';
        const body = this.diffText(original, current);
        return `--- a/${p}\n+++ b/${p}\n${body}`;
    }

    countDiffStats(diffBody) {
        let linesAdded = 0;
        let linesRemoved = 0;
        for (const line of String(diffBody || '').split('\n')) {
            if (line.startsWith('+') && !line.startsWith('+++')) linesAdded++;
            else if (line.startsWith('-') && !line.startsWith('---')) linesRemoved++;
        }
        return { linesAdded, linesRemoved };
    }

    truncateDiff(fullDiff, maxLines = 200) {
        const lines = String(fullDiff || '').split('\n');
        if (lines.length <= maxLines) return fullDiff;
        return lines.slice(0, maxLines).join('\n') + `\n…[truncated ${lines.length - maxLines} diff lines]`;
    }

    buildFileDiffResult(original, current, relPath, maxLines = 200) {
        const full = this.diffFile(original, current, relPath);
        const stats = this.countDiffStats(full.split('\n').slice(2).join('\n'));
        return {
            fileDiff: this.truncateDiff(full, maxLines),
            linesAdded: stats.linesAdded,
            linesRemoved: stats.linesRemoved,
            relPath
        };
    }

    async diff(planId) {
        const entries = await this.loadManifest(planId);
        const diffs = [];
        const seen = new Set();

        for (const entry of entries) {
            if (seen.has(entry.path)) continue;
            seen.add(entry.path);

            let original = '';
            if (entry.existed && entry.snapshotId) {
                const snapFile = path.join(this.getLedgerDir(planId), `${entry.snapshotId}.bin`);
                try {
                    original = (await fsPromises.readFile(snapFile, 'utf-8')).toString();
                } catch (e) {
                    original = '';
                }
            }

            let current = '';
            let existsNow = false;
            try {
                await fsPromises.access(entry.path);
                existsNow = true;
                current = await fsPromises.readFile(entry.path, 'utf-8');
            } catch (e) {
                existsNow = false;
            }

            if (!entry.existed && existsNow) {
                diffs.push(`--- /dev/null\n+++ ${entry.path}\n${this.diffText('', current)}`);
            } else if (entry.existed && !existsNow) {
                diffs.push(`--- ${entry.path}\n+++ /dev/null\n${this.diffText(original, '')}`);
            } else if (original !== current) {
                diffs.push(`--- ${entry.path}\n+++ ${entry.path}\n${this.diffText(original, current)}`);
            }
        }

        return { diff: diffs.join('\n\n'), fileCount: seen.size };
    }

    async revertAll(planId) {
        const entries = await this.loadManifest(planId);
        const reverted = [];
        const errors = [];

        for (let i = entries.length - 1; i >= 0; i--) {
            const entry = entries[i];
            try {
                if (entry.action === 'create' || !entry.existed) {
                    try {
                        await fsPromises.unlink(entry.path);
                        reverted.push(`Deleted created file: ${entry.path}`);
                    } catch (e) {
                        if (e.code !== 'ENOENT') errors.push(`${entry.path}: ${e.message}`);
                    }
                } else if (entry.snapshotId) {
                    const snapFile = path.join(this.getLedgerDir(planId), `${entry.snapshotId}.bin`);
                    const content = await fsPromises.readFile(snapFile);
                    await fsPromises.mkdir(path.dirname(entry.path), { recursive: true });
                    await fsPromises.writeFile(entry.path, content);
                    reverted.push(`Restored: ${entry.path}`);
                }
            } catch (e) {
                errors.push(`${entry.path}: ${e.message}`);
            }
        }

        return { success: errors.length === 0, reverted, errors };
    }
}

module.exports = ChangeLedger;
