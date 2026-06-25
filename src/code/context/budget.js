/**
 * Context budget — rough token estimate + eviction of old turns / fat tool results.
 */
'use strict';

const { digestDropped } = require('../../shared/chatSummarizer.js');

const CHARS_PER_TOKEN = 4;

function estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil(String(text).length / CHARS_PER_TOKEN);
}

function estimateMessages(messages) {
    let total = 0;
    for (const m of messages) {
        if (m.content) total += estimateTokens(typeof m.content === 'string' ? m.content : JSON.stringify(m.content));
        if (m.tool_calls) total += estimateTokens(JSON.stringify(m.tool_calls));
    }
    return total;
}

function trimToolResults(messages, maxResultChars = 3000) {
    return messages.map(m => {
        if (m.role !== 'tool' && m.role !== 'function') return m;
        const c = String(m.content || '');
        if (c.length <= maxResultChars) return m;
        return Object.assign({}, m, {
            content: c.slice(0, maxResultChars) + `\n…[truncated ${c.length - maxResultChars} chars]`
        });
    });
}

// reserve = tokens kept FREE for the model's reply. 512 was far too small: a full
// source file (e.g. a ~5KB script.js ≈ 1.5k tokens) could never be emitted before the
// output hit the context-window boundary and got truncated. Default to a real file-sized
// budget so the model can actually write the files it's asked to.
function fitBudget(messages, budgetTokens, reserve = 2048) {
    const target = Math.max(1024, budgetTokens - reserve);
    let out = trimToolResults(messages.slice());
    const dropped = [];
    while (estimateMessages(out) > target && out.length > 3) {
        // Drop oldest non-system message after index 1 (keep system + latest user goal)
        const dropIdx = out.findIndex((m, i) => i > 0 && m.role !== 'system');
        if (dropIdx === -1) break;
        dropped.push(out[dropIdx]);
        out.splice(dropIdx, 1);
    }
    // Leave a breadcrumb so evicted context isn't silently lost (state also lives in
    // .agentsmith/*.md). Inserted after the leading system block; tiny, so it won't
    // re-overflow the budget.
    if (dropped.length) {
        const digest = digestDropped(dropped);
        if (digest) {
            let insertAt = 0;
            while (insertAt < out.length && out[insertAt].role === 'system') insertAt++;
            out.splice(insertAt, 0, { role: 'system', content: digest });
        }
    }
    return out;
}

module.exports = { estimateTokens, estimateMessages, fitBudget, trimToolResults, CHARS_PER_TOKEN };
