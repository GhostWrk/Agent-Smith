/**
 * Agent chat loop helpers — tool batch execution + timeline events.
 */
(function (global) {
    'use strict';

    async function firePluginHook(api, event, payload) {
        if (!api) return null;
        try {
            return await api.invoke('plugin-fire-hook', { hookEvent: event, payload: payload || {} });
        } catch (e) {
            return null;
        }
    }

    async function executeAgentToolBatch(validToolCalls, deps) {
        const results = [];
        const emit = deps.emitAgentEvent || (() => {});

        for (const t of validToolCalls) {
            const toolId = t.id || `tool_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            const name = t.function.name;
            const args = t.function.arguments;

            emit({ type: 'tool_start', name, args, callId: toolId });

            const before = await firePluginHook(deps.api, 'beforeToolCall', { tool: name, name, args });
            if (before?.blocked) {
                const blocked = `[BLOCKED] ${before.reason || 'plugin hook'}`;
                emit({ type: 'tool_result', name, ok: false, result: { error: blocked }, callId: toolId, durationMs: 0 });
                results.push({ tool: t, result: blocked, toolId });
                continue;
            }

            const startTool = Date.now();
            let result;
            try {
                if (deps.executeTool) {
                    result = await deps.executeTool(name, args, deps);
                } else {
                    result = 'Error: executeTool not provided';
                }
                if (deps.trace) {
                    deps.trace.addStep('tools.execute', 'tools', 'ok', 'TOOL_OK', Date.now() - startTool, name, name);
                }
            } catch (e) {
                result = `Error: ${e.message}`;
                if (deps.trace) {
                    deps.trace.addStep('tools.execute', 'tools', 'error', 'TOOL_ERR', Date.now() - startTool, e.message, name);
                }
            }

            await firePluginHook(deps.api, 'afterToolCall', { tool: name, name, args, result });

            const ok = !String(result).startsWith('Error:') && !String(result).startsWith('[BLOCKED]');
            emit({
                type: 'tool_result',
                name,
                ok,
                result: typeof result === 'string' ? { output: result } : result,
                callId: toolId,
                durationMs: Date.now() - startTool
            });
            results.push({ tool: t, result: String(result), toolId });
        }
        return results;
    }

    const api = { executeAgentToolBatch, firePluginHook };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') window.XKChatLoop = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
