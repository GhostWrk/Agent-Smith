const { test } = require('node:test');
const assert = require('node:assert/strict');

const { INVOKE_CHANNELS } = require('../src/shared/ipcChannels.js');
const registerLmStudioIpc = require('../src/main/ipc/lmStudio.js');

test('LM Studio management IPC channels are whitelisted', () => {
    assert.ok(INVOKE_CHANNELS.includes('lmstudio-get-status'));
    assert.ok(INVOKE_CHANNELS.includes('lmstudio-ensure-model'));
});

test('LM Studio IPC forwards only supported fields', async () => {
    const handlers = new Map();
    const ipcMain = {
        handle(name, fn) { handlers.set(name, fn); }
    };
    const calls = [];
    const lmStudioManager = {
        async getStatus(opts) { calls.push(['status', opts]); return { managed: true }; },
        async ensureModel(opts) { calls.push(['ensure', opts]); return { managed: true }; }
    };
    registerLmStudioIpc(ipcMain, { lmStudioManager });

    await handlers.get('lmstudio-get-status')(null, {
        apiBaseUrl: 'http://127.0.0.1:1234',
        model: 'gemma',
        ignored: 'nope'
    });
    await handlers.get('lmstudio-ensure-model')(null, {
        apiBaseUrl: 'http://127.0.0.1:1234',
        model: 'gemma',
        contextLength: 65536,
        command: 'malicious'
    });

    assert.deepEqual(calls, [
        ['status', { apiBaseUrl: 'http://127.0.0.1:1234', model: 'gemma' }],
        ['ensure', {
            apiBaseUrl: 'http://127.0.0.1:1234',
            model: 'gemma',
            contextLength: 65536
        }]
    ]);
});
