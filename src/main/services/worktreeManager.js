/**
 * Git worktree isolation for Code Mode runs — file isolation v1 (single port deferred).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function worktreeBase(projectRoot) {
    return path.join(projectRoot, '.agentsmith', 'worktrees');
}

function branchName(sessionId) {
    const safe = String(sessionId).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 40);
    return `agentsmith/run-${safe}`;
}

function worktreePath(projectRoot, sessionId) {
    const safe = String(sessionId).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 40);
    return path.join(worktreeBase(projectRoot), safe);
}

function milestoneKey(parentSessionId, milestoneId) {
    const parent = String(parentSessionId).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 32);
    const ms = String(milestoneId).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 12);
    return `${parent}--${ms}`;
}

function milestoneWorktreePath(projectRoot, parentSessionId, milestoneId) {
    return path.join(worktreeBase(projectRoot), milestoneKey(parentSessionId, milestoneId));
}

function milestoneBranchName(parentSessionId, milestoneId) {
    return `agentsmith/milestone-${milestoneKey(parentSessionId, milestoneId)}`;
}

function childSessionId(parentSessionId, milestoneId) {
    return `${parentSessionId}__${String(milestoneId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 20)}`;
}

function gitOk(projectRoot) {
    try {
        execSync('git rev-parse --git-dir', { cwd: projectRoot, stdio: 'pipe' });
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Create an isolated worktree for a Code run.
 * @returns {{ path, branch, error? }}
 */
function createRunWorktree(projectRoot, sessionId) {
    if (!gitOk(projectRoot)) {
        return { error: 'Git repository required for isolated runs. Run git init first.' };
    }
    const wtPath = worktreePath(projectRoot, sessionId);
    const branch = branchName(sessionId);
    fs.mkdirSync(worktreeBase(projectRoot), { recursive: true });

    if (fs.existsSync(wtPath)) {
        return { path: wtPath, branch, reused: true };
    }

    try {
        execSync(`git worktree add -B "${branch}" "${wtPath}"`, {
            cwd: projectRoot,
            stdio: 'pipe',
            encoding: 'utf-8'
        });
        return { path: wtPath, branch };
    } catch (e) {
        return { error: `Failed to create worktree: ${e.message}` };
    }
}

function cleanupWorktree(projectRoot, sessionId) {
    const wtPath = worktreePath(projectRoot, sessionId);
    if (!fs.existsSync(wtPath)) return { ok: true, skipped: true };
    try {
        execSync(`git worktree remove "${wtPath}" --force`, {
            cwd: projectRoot,
            stdio: 'pipe',
            encoding: 'utf-8'
        });
    } catch (e) {
        try { fs.rmSync(wtPath, { recursive: true, force: true }); } catch (e2) { /* ignore */ }
    }
    const branch = branchName(sessionId);
    try {
        execSync(`git branch -D "${branch}"`, { cwd: projectRoot, stdio: 'pipe' });
    } catch (e) { /* branch may not exist */ }
    return { ok: true };
}

/**
 * Create a worktree for one PLAN milestone subagent.
 * @returns {{ path, branch, error? }}
 */
function createMilestoneWorktree(projectRoot, parentSessionId, milestoneId) {
    if (!gitOk(projectRoot)) {
        return { error: 'Git repository required for milestone worktrees. Run git init first.' };
    }
    const wtPath = milestoneWorktreePath(projectRoot, parentSessionId, milestoneId);
    const branch = milestoneBranchName(parentSessionId, milestoneId);
    fs.mkdirSync(worktreeBase(projectRoot), { recursive: true });

    if (fs.existsSync(wtPath)) {
        return { path: wtPath, branch, reused: true };
    }

    try {
        execSync(`git worktree add -B "${branch}" "${wtPath}"`, {
            cwd: projectRoot,
            stdio: 'pipe',
            encoding: 'utf-8'
        });
        return { path: wtPath, branch };
    } catch (e) {
        return { error: `Failed to create milestone worktree: ${e.message}` };
    }
}

function cleanupMilestoneWorktree(projectRoot, parentSessionId, milestoneId) {
    const wtPath = milestoneWorktreePath(projectRoot, parentSessionId, milestoneId);
    if (!fs.existsSync(wtPath)) return { ok: true, skipped: true };
    try {
        execSync(`git worktree remove "${wtPath}" --force`, {
            cwd: projectRoot,
            stdio: 'pipe',
            encoding: 'utf-8'
        });
    } catch (e) {
        try { fs.rmSync(wtPath, { recursive: true, force: true }); } catch (e2) { /* ignore */ }
    }
    const branch = milestoneBranchName(parentSessionId, milestoneId);
    try {
        execSync(`git branch -D "${branch}"`, { cwd: projectRoot, stdio: 'pipe' });
    } catch (e) { /* branch may not exist */ }
    return { ok: true };
}

/** Copy touched files from milestone worktree into main checkout. */
function syncWorktreeFiles(mainRoot, worktreeRoot, relPaths) {
    const synced = [];
    const errors = [];
    for (const rel of [...new Set((relPaths || []).filter(Boolean))]) {
        const normalized = rel.replace(/\\/g, '/');
        const src = path.join(worktreeRoot, normalized);
        const dst = path.join(mainRoot, normalized);
        try {
            if (!fs.existsSync(src)) {
                errors.push({ path: normalized, error: 'missing in worktree' });
                continue;
            }
            fs.mkdirSync(path.dirname(dst), { recursive: true });
            fs.copyFileSync(src, dst);
            synced.push(normalized);
        } catch (e) {
            errors.push({ path: normalized, error: e.message });
        }
    }
    return { synced, errors };
}

module.exports = {
    createRunWorktree,
    cleanupWorktree,
    worktreePath,
    branchName,
    createMilestoneWorktree,
    cleanupMilestoneWorktree,
    syncWorktreeFiles,
    milestoneWorktreePath,
    milestoneBranchName,
    milestoneKey,
    childSessionId,
    gitOk
};
