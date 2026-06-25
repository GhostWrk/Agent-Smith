/**
 * Code tool schemas — IPC channel whitelist integrity.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { toolNames, CODE_TOOLS } = require('../src/code/tools/schemas.js');
const ipcChannels = require('../src/shared/ipcChannels.js');

test('code IPC channels are whitelisted', () => {
    for (const ch of [
        'code-run', 'code-stop', 'code-get-status', 'code-ledger-diff',
        'code-list-sessions', 'code-resume', 'code-plan-approve', 'code-plan-reject',
        'preview-show', 'preview-close', 'preview-list-sources', 'preview-capture-source'
    ]) {
        assert.ok(ipcChannels.INVOKE_CHANNELS.includes(ch), `${ch} missing from INVOKE_CHANNELS`);
    }
    assert.ok(ipcChannels.INVOKE_CHANNELS.includes('ghosttrace-append'));
    assert.ok(ipcChannels.RECEIVE_CHANNELS.includes('code-event'), 'code-event missing from RECEIVE_CHANNELS');
    assert.ok(ipcChannels.RECEIVE_CHANNELS.includes('preview-event'), 'preview-event missing from RECEIVE_CHANNELS');
});

test('code tools v1 surface is minimal', () => {
    const names = toolNames();
    assert.ok(names.includes('read_file'));
    assert.ok(names.includes('patch'));
    assert.ok(names.includes('run_command'));
    assert.ok(names.includes('show_preview'));
    assert.ok(names.includes('browser_verify'));
    // Pin the exact surface so adding/removing a Code-Mode tool is a deliberate, visible
    // change (the old `CODE_TOOLS.length === names.length` was a tautology — names is
    // derived from CODE_TOOLS, so it could never fail).
    assert.deepEqual(names.slice().sort(), [
        'append_file', 'browser_verify', 'glob', 'grep', 'list_project', 'patch',
        'query_run_trace', 'read_file', 'run_command', 'show_preview', 'write_file'
    ]);
    assert.equal(CODE_TOOLS.length, names.length);
});
