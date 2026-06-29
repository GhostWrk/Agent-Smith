/**
 * Code Mode repair targeting: when validation/blocker feedback names the file to patch (script.js),
 * the repair must be LOCKED to that file — the model must not be allowed to keep rewriting the
 * (correct) index.html. Covers the Budget Tracker DOM-contract failure.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildForcedDomRepairNudge } = require('../src/code/context/htmlContract.js');
const { driveToCompletion } = require('../src/code/loop/completionDrive.js');
const { runValidation } = require('../src/code/governor/completionGate.js');

function mkproj(files) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-'));
    for (const [rel, content] of Object.entries(files)) {
        const abs = path.join(root, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content);
    }
    return root;
}
const writeReply = (p, c) => ({ message: { role: 'assistant', content: '', tool_calls: [
    { id: 'c', function: { name: 'write_file', arguments: JSON.stringify({ path: p, content: c }) } }
] } });

test('forced repair is target-locked to script.js: names the wrong file, lists real ids, guards no-match, never edits HTML', () => {
    const root = mkproj({
        'index.html': '<input id="import-input"><label id="import-label"></label><table id="transactions-table"></table><div id="category-summary-content"></div>',
        'script.js': "getElementById('import-btn');getElementById('file-input');getElementById('transaction-list');getElementById('category-summary');getElementById('edit-modal');"
    });
    const nudge = buildForcedDomRepairNudge({ projectRoot: root }, [], { blockedPath: 'index.html' });
    assert.match(nudge, /PATCH script\.js ONLY/);
    assert.match(nudge, /tried to edit "index\.html"/, 'calls out the wrong file the model just tried');
    assert.match(nudge, /Do NOT rewrite index\.html/);
    assert.match(nudge, /transaction-list.*transactions-table/, 'gives a concrete rename');
    assert.match(nudge, /Ids that exist in index\.html:[^\n]*import-input/, 'lists the real ids so file-input can map to import-input');
    assert.match(nudge, /'edit-modal' has NO matching element/, 'guards the id with no HTML element');
    assert.doesNotMatch(nudge, /add .* to index\.html|rewrite the HTML|edit index\.html to add/i, 'never instructs editing the HTML');
    fs.rmSync(root, { recursive: true, force: true });
});

test('Budget Tracker DOM contract: drive patches the JS selectors to the real ids, leaving index.html untouched', async () => {
    const root = mkproj({
        'index.html': '<!doctype html><html><body><table id="transactions-table"></table><div id="category-summary-content"></div><script src="script.js"></script></body></html>',
        // wrong ids: transaction-list / category-summary (the HTML has transactions-table / category-summary-content)
        'script.js': "const t=document.getElementById('transaction-list');\nconst c=document.getElementById('category-summary');\ndocument.addEventListener('click',()=>{const a=[];a.push(1);t.innerHTML=a.length;c.textContent=a.length;});"
    });
    const htmlBefore = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const session = { projectRoot: root, goal: 'Build a budget tracker page with a transactions table and category summary', model: 'm', codeTemperature: 0.2, filesTouched: ['index.html', 'script.js'] };
    const stream = async ({ messages }) => {
        if (/path=\\"script\.js\\"/.test(JSON.stringify(messages))) {
            return writeReply('script.js', "const t=document.getElementById('transactions-table');\nconst c=document.getElementById('category-summary-content');\ndocument.addEventListener('click',()=>{const a=[];a.push(1);t.innerHTML=a.length;c.textContent=a.length;});");
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
    assert.match(js, /transactions-table/, 'JS selector fixed to the real id');
    assert.match(js, /category-summary-content/, 'JS selector fixed to the real id');
    assert.equal(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), htmlBefore, 'index.html is NOT rewritten');
    assert.equal(res.completed, true, 'validation passes after patching JS; remaining: ' + (res.gate.messages || []).join(' | '));
    fs.rmSync(root, { recursive: true, force: true });
});

test('when the model still cannot patch, the drive stops and the result names the file + selectors', async () => {
    const root = mkproj({
        'index.html': '<!doctype html><html><body><input id="import-input"><script src="script.js"></script></body></html>',
        'script.js': "document.getElementById('file-input').addEventListener('change',()=>{});"
    });
    const session = { projectRoot: root, goal: 'Build a web page with a file import', model: 'm', codeTemperature: 0.2, filesTouched: ['index.html', 'script.js'] };
    const stream = async () => ({ message: { role: 'assistant', content: 'I will keep checking.', tool_calls: [] } }); // never patches
    const runTool = async () => ({ error: 'unused' });
    const res = await driveToCompletion({
        session, runValidation, gateOpts: { grindMode: false },
        stream, apiBaseUrl: 'x', writeTools: [], signal: null, emit: () => {}, runTool, maxCycles: 4
    });
    assert.equal(res.completed, false);
    const msgs = (res.gate.messages || []).join(' | ');
    assert.match(msgs, /script references #file-input|file-input/, 'final result names the exact unresolved selector');
    fs.rmSync(root, { recursive: true, force: true });
});
