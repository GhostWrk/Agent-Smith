/**
 * Workflow phases — shrink tool surface per stage for small models.
 */
'use strict';

const fs = require('fs');
const { isNonTrivialTask } = require('../context/planArtifacts.js');
const { goalImpliesNewArtifacts } = require('../context/artifactHints.js');

const PHASE_TOOLS = {
    explore: ['read_file', 'grep', 'glob', 'list_project', 'show_preview'],
    implement: ['read_file', 'grep', 'glob', 'list_project', 'write_file', 'append_file', 'patch', 'show_preview', 'mark_code_step_done'],
    // Writes stay available in verify so the agent can fix gate failures (missing refs, syntax, etc.).
    verify: ['read_file', 'grep', 'glob', 'run_command', 'list_project', 'write_file', 'append_file', 'patch', 'show_preview', 'browser_verify', 'query_run_trace', 'mark_code_step_done']
};

const WRITE_TOOLS = new Set(['write_file', 'append_file', 'patch']);

function initialPhase() {
    return 'explore';
}

function allowedToolsForPhase(phase) {
    return PHASE_TOOLS[phase] || PHASE_TOOLS.implement;
}

function isToolAllowed(phase, toolName) {
    return allowedToolsForPhase(phase).includes(toolName);
}

function phaseHint(phase) {
    const hints = {
        explore: 'Phase: EXPLORE — read and search only. No write_file, append_file, or patch until you understand the project.',
        implement: 'Phase: IMPLEMENT — write_file (complete files), patch (change existing code; replace_all for repeated text), append_file (extend only). Verify syntax after each write.',
        verify: 'Phase: VERIFY — run tests/commands and read files. Use write_file/append_file/patch to fix issues before declaring done.'
    };
    return hints[phase] || hints.implement;
}

/**
 * Advance phase based on turn activity.
 * @returns {string|null} new phase if changed
 */
function maybeAdvancePhase(session, { lastTool, toolWasWrite }) {
    const cur = session.phase || 'explore';
    if (cur === 'explore') {
        if (toolWasWrite || (session.turn >= 3 && lastTool === 'read_file')) {
            return 'implement';
        }
    }
    if (cur === 'implement') {
        const allMilestonesDone = session.planArtifacts?.milestones?.every(m => m.done);
        if (allMilestonesDone || (toolWasWrite && session.turn >= 8)) {
            return 'verify';
        }
    }
    return null;
}

function phaseGateError(phase, toolName) {
    const next = phase === 'explore'
        ? 'Read the project first (read_file, grep, list_project). Writes unlock in implement phase after turn 3 or first read.'
        : phase === 'verify'
            ? 'Use read_file, grep, run_command to verify. Use write_file/patch to fix any remaining issues.'
            : 'Complete exploration before writing.';
    // `error` is a STRING (consistent with every other tool result) so consumers that
    // read result.error as text don't break; phaseBlocked carries the structured signal.
    return {
        error: `Tool "${toolName}" is not available in ${phase} phase. ${next}`,
        phaseBlocked: true,
        message: `Tool "${toolName}" is not available in ${phase} phase. ${next}`
    };
}

const SKIP_DIRS = new Set(['.agentsmith', '.git', 'node_modules', 'dist']);

/** Empty or nearly empty workspace — greenfield scaffold tasks should write immediately. */
function isGreenfieldWorkspace(projectRoot, treeSummary) {
    try {
        const entries = fs.readdirSync(projectRoot).filter((e) => {
            if (SKIP_DIRS.has(e)) return false;
            if (e.startsWith('.') && e !== '.') return false;
            return true;
        });
        const meaningful = entries.filter(e => e !== '.agentsmith');
        if (meaningful.length === 0) return true;
    } catch (e) { /* fall through */ }
    const t = String(treeSummary || '').trim();
    if (!t || t === '[]' || t === '{}' || t.length < 24) return true;
    return false;
}

/**
 * Greenfield build tasks start in implement (write tools available turn 1).
 * Brownfield / non-build tasks stay in explore first.
 */
function resolveInitialPhase({ projectRoot, treeSummary, goal }) {
    if (!isNonTrivialTask(goal)) return initialPhase();
    if (isGreenfieldWorkspace(projectRoot, treeSummary)) return 'implement';
    // Brownfield but task is "create/build a new game/app" — writes unlock turn 1.
    if (goalImpliesNewArtifacts(goal)) return 'implement';
    return initialPhase();
}

module.exports = {
    PHASE_TOOLS,
    WRITE_TOOLS,
    initialPhase,
    resolveInitialPhase,
    isGreenfieldWorkspace,
    goalImpliesNewArtifacts,
    allowedToolsForPhase,
    isToolAllowed,
    phaseHint,
    maybeAdvancePhase,
    phaseGateError
};
