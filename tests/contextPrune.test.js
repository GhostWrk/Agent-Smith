/**
 * contextPrune — bounds agent context so big browser snapshots don't overflow it.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pruneChatHistory } = require('../src/shared/contextPrune.js');

const big = (n) => 'x'.repeat(n);

test('caps the size of recent tool results', () => {
    const h = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }, { role: 'tool', content: big(5000), name: 'browser_snapshot' }];
    const out = pruneChatHistory(h);
    assert.ok(out[2].content.length < 2000, 'recent tool result capped');
    assert.match(out[2].content, /truncated/);
});

test('collapses older tool results to a stub, keeps recent ones', () => {
    const h = [{ role: 'system', content: 's' }];
    for (let i = 0; i < 7; i++) { h.push({ role: 'assistant', content: '', tool_calls: [{}] }); h.push({ role: 'tool', content: 'RESULT_' + i + ' ' + big(50), name: 't' }); }
    const out = pruneChatHistory(h, undefined);
    const tools = out.filter(m => m.role === 'tool');
    // 7 tool results, keepRecentTool default 4 -> first 3 stubbed
    const stubs = tools.filter(t => /omitted to conserve context/.test(t.content));
    assert.equal(stubs.length, 3);
    // the last 4 keep their real content
    assert.match(tools[6].content, /RESULT_6/);
    assert.match(tools[3].content, /RESULT_3/);
});

test('leaves user/assistant/system messages untouched', () => {
    const h = [{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }, { role: 'assistant', content: 'A' }];
    const out = pruneChatHistory(h);
    assert.deepEqual(out, h);
});

test('idempotent: re-pruning is stable', () => {
    const h = [{ role: 'tool', content: big(5000) }];
    const a = pruneChatHistory(h);
    const b = pruneChatHistory(a);
    assert.equal(a[0].content, b[0].content);
});

test('non-array input returned as-is', () => {
    assert.equal(pruneChatHistory(null), null);
});
