/**
 * Regression tests for the Batch 10 (examples / plugins / ghosttrace) audit fixes:
 *   - ghosttrace: run ids used in paths / archive commands are validated to a safe slug
 *   - example beforeToolCall hook reads the real payload field ({ tool, name }), not toolName
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ghosttrace = require('../src/ghosttrace/index.js');
const auditHook = require('../src/examples/plugins/hello/hooks/audit.js');

test('PipelineTrace rejects an unsafe caller-supplied run_id', () => {
    for (const bad of ['../escape', 'a/b', 'a"; rm -rf /', 'id with space', 'x$y']) {
        assert.throws(() => new ghosttrace.PipelineTrace(bad), /Invalid run_id/, `should reject: ${bad}`);
    }
});

test('PipelineTrace accepts a safe run_id and auto-generated ids', () => {
    assert.equal(new ghosttrace.PipelineTrace('run_123-AB').run_id, 'run_123-AB');
    const auto = new ghosttrace.PipelineTrace().run_id;
    assert.match(auto, /^[A-Za-z0-9_-]+$/, 'generated id is itself a safe slug');
});

test('exportBundle refuses an unsafe run_id before any fs / archive work', () => {
    assert.throws(() => ghosttrace.exportBundle('../../etc/passwd'), /Invalid run_id/);
    assert.throws(() => ghosttrace.exportBundle('x"; touch pwned; "'), /Invalid run_id/);
});

test('generateReport refuses an unsafe run_id on the trace', () => {
    const fakeTrace = { run_id: '../../evil', outcome: 'ok', started_at: '', closed_at: '', steps: [] };
    const explanation = { summary: '', failed_layer: null, failed_stage: null, stable_code: 'OK', likely_cause: '', suggested_fix: '' };
    assert.throws(() => ghosttrace.generateReport(fakeTrace, explanation), /Invalid run_id/);
});

test('example beforeToolCall hook logs the real tool name from the fired payload', async () => {
    const logs = [];
    const host = { log: (m) => logs.push(m) };
    // Payload shape actually fired by the renderer Agent loop and Code Mode executor.
    await auditHook.run({ tool: 'echo', name: 'echo', args: {} }, host);
    assert.deepEqual(logs, ['about to run tool: echo']);

    logs.length = 0;
    await auditHook.run({ name: 'read_file', args: {} }, host); // tool absent → fall back to name
    assert.deepEqual(logs, ['about to run tool: read_file']);
});
