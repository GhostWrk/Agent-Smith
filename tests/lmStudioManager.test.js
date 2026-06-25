const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
    isLoopbackApiBase,
    buildContextCandidates,
    createLmStudioManager
} = require('../src/main/services/lmStudioManager.js');

function modelPayload(contextLength = 4096, parallel = 4) {
    return {
        models: [{
            key: 'google/gemma-4-e4b',
            max_context_length: 131072,
            loaded_instances: [{
                id: 'google/gemma-4-e4b',
                config: { context_length: contextLength, parallel }
            }]
        }]
    };
}

test('isLoopbackApiBase permits local LM Studio only', () => {
    assert.equal(isLoopbackApiBase('http://127.0.0.1:1234'), true);
    assert.equal(isLoopbackApiBase('http://localhost:1234/v1'), true);
    assert.equal(isLoopbackApiBase('http://[::1]:1234'), true);
    assert.equal(isLoopbackApiBase('https://example.com/v1'), false);
    assert.equal(isLoopbackApiBase('not a url'), false);
});

test('buildContextCandidates clamps to model max and descends through standard sizes', () => {
    assert.deepEqual(
        buildContextCandidates(70000, 65536).slice(0, 3),
        [65536, 49152, 32768]
    );
    assert.deepEqual(buildContextCandidates(8192, 131072), [8192, 4096]);
});

test('getStatus reports the loaded LM Studio instance', async () => {
    const manager = createLmStudioManager({
        requestJson: async () => modelPayload()
    });
    const status = await manager.getStatus({
        apiBaseUrl: 'http://127.0.0.1:1234',
        model: 'google/gemma-4-e4b'
    });
    assert.deepEqual(status, {
        managed: true,
        model: 'google/gemma-4-e4b',
        loadedContext: 4096,
        maxContext: 131072,
        parallel: 4
    });
});

test('getStatus leaves remote OpenAI-compatible endpoints unmanaged', async () => {
    let requested = false;
    const manager = createLmStudioManager({
        requestJson: async () => { requested = true; return modelPayload(); }
    });
    const status = await manager.getStatus({
        apiBaseUrl: 'https://example.com',
        model: 'google/gemma-4-e4b'
    });
    assert.equal(status.managed, false);
    assert.equal(status.reason, 'remote_endpoint');
    assert.equal(requested, false);
});

test('ensureModel is a no-op when context and parallel already match', async () => {
    const calls = [];
    const manager = createLmStudioManager({
        requestJson: async () => modelPayload(65536, 1),
        execFile: async (...args) => calls.push(args)
    });
    const result = await manager.ensureModel({
        apiBaseUrl: 'http://127.0.0.1:1234',
        model: 'google/gemma-4-e4b',
        contextLength: 65536
    });
    assert.equal(result.reloaded, false);
    assert.equal(result.loadedContext, 65536);
    assert.equal(calls.length, 0);
});

test('ensureModel reloads with safe fixed CLI arguments', async () => {
    const calls = [];
    let statusReads = 0;
    const manager = createLmStudioManager({
        requestJson: async () => {
            statusReads++;
            return modelPayload(statusReads === 1 ? 4096 : 65536, statusReads === 1 ? 4 : 1);
        },
        execFile: async (file, args) => {
            calls.push({ file, args });
            return { stdout: '', stderr: '' };
        },
        lmsPath: 'lms'
    });
    const result = await manager.ensureModel({
        apiBaseUrl: 'http://127.0.0.1:1234',
        model: 'google/gemma-4-e4b',
        contextLength: 65536
    });
    assert.equal(result.reloaded, true);
    assert.equal(result.loadedContext, 65536);
    assert.deepEqual(calls.map(c => c.args), [
        ['load', 'google/gemma-4-e4b', '--context-length', '65536', '--parallel', '1', '--gpu', 'max', '--estimate-only', '-y'],
        ['unload', 'google/gemma-4-e4b'],
        ['load', 'google/gemma-4-e4b', '--context-length', '65536', '--parallel', '1', '--gpu', 'max', '--identifier', 'google/gemma-4-e4b', '-y']
    ]);
});

test('ensureModel falls back to the highest context whose estimate succeeds', async () => {
    const attempted = [];
    let loadedContext = 4096;
    const manager = createLmStudioManager({
        requestJson: async () => modelPayload(loadedContext, loadedContext === 4096 ? 4 : 1),
        execFile: async (_file, args) => {
            if (args.includes('--estimate-only')) {
                const context = Number(args[args.indexOf('--context-length') + 1]);
                attempted.push(context);
                if (context > 49152) throw new Error('insufficient memory');
            } else if (args[0] === 'load') {
                loadedContext = Number(args[args.indexOf('--context-length') + 1]);
            }
            return { stdout: '', stderr: '' };
        }
    });
    const result = await manager.ensureModel({
        apiBaseUrl: 'http://localhost:1234',
        model: 'google/gemma-4-e4b',
        contextLength: 65536
    });
    assert.deepEqual(attempted.slice(0, 2), [65536, 49152]);
    assert.equal(result.loadedContext, 49152);
    assert.equal(result.fallbackUsed, true);
    assert.match(result.warning, /49152/);
});
