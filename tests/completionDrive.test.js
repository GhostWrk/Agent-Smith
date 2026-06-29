/**
 * Continuation drive — when a run ends INCOMPLETE with files already created, it assesses what's
 * missing/broken and finishes it with focused, minimal requests (the fix for "wrote index.html,
 * stalled on script.js -> incomplete"). Deterministic and bounded.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { driveToCompletion } = require('../src/code/loop/completionDrive.js');
const { runValidation } = require('../src/code/governor/completionGate.js');

function mkproj(files) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-'));
    for (const [rel, content] of Object.entries(files)) {
        const abs = path.join(root, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content);
    }
    return root;
}

// A mock model reply with a native write_file tool call (args as a JSON string, as a model emits).
function writeReply(p, content) {
    return { message: { role: 'assistant', content: '', tool_calls: [
        { id: 'c1', function: { name: 'write_file', arguments: JSON.stringify({ path: p, content }) } }
    ] } };
}

test('driveToCompletion writes the missing linked file and passes the gate', async () => {
    const root = mkproj({
        'index.html': '<!doctype html><html><body><div id="app"></div><script src="script.js"></script></body></html>'
    });
    const session = { projectRoot: root, goal: 'Build a simple web page', model: 'm', codeTemperature: 0.2, filesTouched: ['index.html'] };
    let calls = 0;
    const stream = async ({ messages }) => {
        calls++;
        // the focused prompt must name exactly the missing file
        assert.match(JSON.stringify(messages), /script\.js/);
        return writeReply('script.js', "document.getElementById('app').textContent = 'ready';\n");
    };
    const runTool = async (name, args) => { fs.writeFileSync(path.join(root, args.path), args.content, 'utf8'); return { relPath: args.path }; };

    const res = await driveToCompletion({
        session, runValidation, gateOpts: { grindMode: false },
        stream, apiBaseUrl: 'http://x', writeTools: [{ type: 'function', function: { name: 'write_file', parameters: {} } }],
        signal: null, emit: () => {}, runTool
    });

    assert.ok(calls >= 1, 'made at least one focused request');
    assert.ok(fs.existsSync(path.join(root, 'script.js')), 'wrote the missing script.js');
    assert.equal(res.completed, true, 'gate passes after finishing; remaining: ' + (res.gate.messages || []).join(' | '));
    fs.rmSync(root, { recursive: true, force: true });
});

test('driveToCompletion stops gracefully when the model still cannot produce the file', async () => {
    const root = mkproj({ 'index.html': '<body><script src="script.js"></script></body>' });
    const session = { projectRoot: root, goal: 'Build a web page', model: 'm', codeTemperature: 0.2, filesTouched: ['index.html'] };
    const stream = async () => ({ message: { role: 'assistant', content: 'I cannot do that.', tool_calls: [] } }); // no tool call
    const runTool = async () => ({ error: 'should not be called' });

    const res = await driveToCompletion({
        session, runValidation, gateOpts: { grindMode: false },
        stream, apiBaseUrl: 'x', writeTools: [], signal: null, emit: () => {}, runTool
    });

    assert.equal(res.completed, false, 'cannot complete without the file');
    assert.ok((res.gate.messages || []).length > 0, 'still reports what is missing');
    assert.ok(!fs.existsSync(path.join(root, 'script.js')), 'no file fabricated');
    fs.rmSync(root, { recursive: true, force: true });
});

test('driveToCompletion finishes the stuck-at-verify case: empty README + DOM id mismatches', async () => {
    // Reproduces the screenshot: README.md exists but is empty, and script.js uses kebab-case ids
    // that index.html defines in camelCase. The model was stuck "verifying" instead of fixing.
    const root = mkproj({
        'index.html': '<!doctype html><html><body><form id="transactionForm"></form><ul id="transactionsList"></ul><script src="script.js"></script></body></html>',
        'script.js': "const f=document.getElementById('transaction-form');\nf.addEventListener('submit',(e)=>{e.preventDefault();document.getElementById('transaction-list').innerHTML='x';});",
        'README.md': ''
    });
    const session = { projectRoot: root, goal: 'Build a simple web page with a form (index.html, script.js, README.md)', model: 'm', codeTemperature: 0.2, filesTouched: ['index.html', 'script.js', 'README.md'] };
    const stream = async ({ messages }) => {
        const s = JSON.stringify(messages);
        // match the explicit target the focused prompt asks for (path="..."), not stray mentions
        if (/path=\\"script\.js\\"/.test(s)) return writeReply('script.js', "const f=document.getElementById('transactionForm');\nf.addEventListener('submit',(e)=>{e.preventDefault();document.getElementById('transactionsList').innerHTML='x';});");
        if (/path=\\"README\.md\\"/.test(s)) return writeReply('README.md', '# Form App\n\nOpen index.html and submit the form.\n');
        return { message: { role: 'assistant', content: '', tool_calls: [] } };
    };
    const runTool = async (name, args) => { fs.writeFileSync(path.join(root, args.path), args.content, 'utf8'); return { relPath: args.path }; };

    const res = await driveToCompletion({
        session, runValidation, gateOpts: { grindMode: false },
        stream, apiBaseUrl: 'x', writeTools: [{ type: 'function', function: { name: 'write_file', parameters: {} } }],
        signal: null, emit: () => {}, runTool, maxCycles: 6
    });

    assert.equal(res.completed, true, 'drive finishes the stuck build; remaining: ' + (res.gate.messages || []).join(' | '));
    assert.ok(fs.readFileSync(path.join(root, 'README.md'), 'utf8').trim().length > 0, 'README filled with content');
    assert.match(fs.readFileSync(path.join(root, 'script.js'), 'utf8'), /transactionForm/, 'script.js ids fixed to match the HTML');
    fs.rmSync(root, { recursive: true, force: true });
});

test('REGRESSION: drive repairs a null-addEventListener from a wrong DOM id (#file-input -> #import-input)', async () => {
    // index.html only has #import-input; script.js calls getElementById('file-input') -> null ->
    // "Cannot read properties of null (reading 'addEventListener')". Code Mode must patch the JS.
    const root = mkproj({
        'index.html': '<!doctype html><html><body><input id="import-input"><script src="script.js"></script></body></html>',
        'script.js': "document.getElementById('file-input').addEventListener('change', () => { document.body.textContent = 'imported'; });"
    });
    const session = { projectRoot: root, goal: 'Build a web page with a file import input', model: 'm', codeTemperature: 0.2, filesTouched: ['index.html', 'script.js'] };
    const stream = async ({ messages }) => {
        if (/path=\\"script\.js\\"/.test(JSON.stringify(messages))) {
            // the focused repair prompt carries index.html, so the model can use the real id
            return writeReply('script.js', "document.getElementById('import-input').addEventListener('change', () => { document.body.textContent = 'imported'; });");
        }
        return { message: { role: 'assistant', content: '', tool_calls: [] } };
    };
    const runTool = async (name, args) => { fs.writeFileSync(path.join(root, args.path), args.content, 'utf8'); return { relPath: args.path }; };

    const res = await driveToCompletion({
        session, runValidation, gateOpts: { grindMode: false },
        stream, apiBaseUrl: 'x', writeTools: [{ type: 'function', function: { name: 'write_file', parameters: {} } }],
        signal: null, emit: () => {}, runTool, maxCycles: 6
    });

    const js = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
    assert.match(js, /import-input/, 'script.js patched to the real id');
    assert.doesNotMatch(js, /file-input/, "the wrong id 'file-input' is gone");
    assert.equal(res.completed, true, 'validation passes after the repair; remaining: ' + (res.gate.messages || []).join(' | '));
    fs.rmSync(root, { recursive: true, force: true });
});

test('driveToCompletion is a no-op when the build is already complete', async () => {
    const root = mkproj({
        'index.html': '<!doctype html><html><body><div id="app"></div><script src="script.js"></script></body></html>',
        'script.js': "document.getElementById('app').textContent = 'ok';\n"
    });
    const session = { projectRoot: root, goal: 'Build a simple web page', model: 'm', codeTemperature: 0.2, filesTouched: ['index.html', 'script.js'] };
    let calls = 0;
    const stream = async () => { calls++; return writeReply('x', 'y'); };
    const res = await driveToCompletion({
        session, runValidation, gateOpts: { grindMode: false },
        stream, apiBaseUrl: 'x', writeTools: [], signal: null, emit: () => {}, runTool: async () => ({})
    });
    assert.equal(calls, 0, 'no model call when already complete');
    assert.equal(res.completed, true);
    fs.rmSync(root, { recursive: true, force: true });
});
