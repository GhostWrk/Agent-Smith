/**
 * contextPrune — bound the model's context across tool-using agent turns.
 *
 * Big tool outputs (full-page browser snapshots especially) are re-sent every step;
 * left unchecked the context overflows within a few steps — the model slows
 * ("processing context…"), gets cut off, repeats, and starts hallucinating success.
 * We keep the few most-recent tool results (the relevant ones) capped in size and
 * collapse older ones to a stub. User/assistant/system messages are left intact.
 *
 * Pure + idempotent: re-pruning an already-pruned history is a no-op for stubs and
 * keeps caps stable, so it is safe to call every turn.
 */
'use strict';

function pruneChatHistory(historyArray, opts) {
    if (!Array.isArray(historyArray)) return historyArray;
    const MAX_TOOL_CHARS = (opts && opts.maxToolChars) || 1600;
    const KEEP_RECENT_TOOL = (opts && opts.keepRecentTool != null) ? opts.keepRecentTool : 4;
    const isTool = (m) => m && (m.role === 'tool' || m.role === 'function');

    const toolPositions = [];
    for (let i = 0; i < historyArray.length; i++) if (isTool(historyArray[i])) toolPositions.push(i);
    const cutoff = toolPositions.length - KEEP_RECENT_TOOL;

    return historyArray.map((m, i) => {
        if (!isTool(m)) return m;
        const order = toolPositions.indexOf(i);
        let content = String(m.content == null ? '' : m.content);
        if (order > -1 && order < cutoff) {
            content = '[earlier tool output omitted to conserve context]';
        } else if (content.length > MAX_TOOL_CHARS && !content.includes('…[truncated')) {
            content = content.slice(0, MAX_TOOL_CHARS) + `\n…[truncated ${content.length - MAX_TOOL_CHARS} chars; re-run the tool if you need the rest]`;
        }
        return Object.assign({}, m, { content });
    });
}

const api = { pruneChatHistory };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.XKContextPrune = api;
