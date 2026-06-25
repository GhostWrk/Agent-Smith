/**
 * Phase-boundary context compaction — reset message history at explore→implement→verify
 * transitions while preserving plan anchor state on disk and in PlanAnchor.
 */
'use strict';

const DEFAULT_KEEP_TOOL_PAIRS = 4;

function isToolPairStart(msg, idx, messages) {
    if (msg.role !== 'assistant' || !msg.tool_calls?.length) return false;
    const next = messages[idx + 1];
    return next && next.role === 'tool';
}

function collectRecentToolPairs(messages, keepPairs) {
    const pairs = [];
    for (let i = messages.length - 1; i >= 0 && pairs.length < keepPairs; i--) {
        const m = messages[i];
        if (m.role !== 'tool') continue;
        const assistantIdx = i - 1;
        if (assistantIdx < 0 || messages[assistantIdx].role !== 'assistant') continue;
        const assistant = messages[assistantIdx];
        if (!assistant.tool_calls?.length) continue;
        pairs.unshift({ assistant, tools: [m] });
        i = assistantIdx;
    }
    return pairs;
}

function flattenPairs(pairs) {
    const out = [];
    for (const p of pairs) {
        out.push(p.assistant);
        out.push(...p.tools);
    }
    return out;
}

/**
 * Compact session.messages when workflow phase changes.
 * @returns {{ messages, droppedCount, keptCount, summary }}
 */
function compactForPhaseTransition(session, opts = {}) {
    const { fromPhase, toPhase, planAnchor } = opts;
    const keepPairs = opts.keepToolPairs ?? DEFAULT_KEEP_TOOL_PAIRS;
    const before = session.messages?.length || 0;

    const transitionNote = [
        `[PHASE ${String(fromPhase || '?').toUpperCase()} → ${String(toPhase || '?').toUpperCase()}]`,
        'Context compacted at phase transition. Prior explore/read noise removed.',
        'Continue from the task block and recent tool results below.',
        planAnchor ? planAnchor.toBlock() : (session.goal ? `[TASK]\n${session.goal}` : '')
    ].filter(Boolean).join('\n\n');

    const recentPairs = collectRecentToolPairs(session.messages || [], keepPairs);
    const recentFlat = flattenPairs(recentPairs);

    const lastUser = (session.messages || []).slice().reverse().find(m => m.role === 'user');
    const userContent = lastUser?.content && !/^\[COMPLETION BLOCKED\]/i.test(String(lastUser.content))
        ? String(lastUser.content).slice(0, 2000)
        : null;

    const compacted = [{ role: 'user', content: transitionNote }];
    if (userContent && userContent !== transitionNote) {
        compacted.push({ role: 'user', content: userContent });
    }
    compacted.push(...recentFlat);

    session.messages = compacted;
    const after = compacted.length;
    return {
        messages: compacted,
        droppedCount: Math.max(0, before - after),
        keptCount: after,
        summary: `Compacted ${before} → ${after} messages (${fromPhase} → ${toPhase})`
    };
}

module.exports = {
    compactForPhaseTransition,
    DEFAULT_KEEP_TOOL_PAIRS,
    collectRecentToolPairs
};
