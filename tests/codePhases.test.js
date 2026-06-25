const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    initialPhase, isToolAllowed, phaseGateError, maybeAdvancePhase
} = require('../src/code/loop/phases.js');
const { selectToolsForTurn } = require('../src/code/tools/router.js');
const { createDefaultMiddleware, runMiddlewareChain } = require('../src/code/loop/middleware.js');

test('explore phase blocks write tools', () => {
    assert.equal(isToolAllowed('explore', 'read_file'), true);
    assert.equal(isToolAllowed('explore', 'write_file'), false);
    assert.equal(isToolAllowed('explore', 'append_file'), false);
    assert.equal(isToolAllowed('implement', 'write_file'), true);
    assert.equal(isToolAllowed('implement', 'append_file'), true);
});

test('phaseGateError is actionable', () => {
    const err = phaseGateError('explore', 'write_file');
    assert.match(err.message, /explore phase/i);
    assert.equal(err.phaseBlocked, true);
});

test('maybeAdvancePhase moves explore to implement on write', () => {
    const session = { phase: 'explore', turn: 1 };
    const next = maybeAdvancePhase(session, { lastTool: 'write_file', toolWasWrite: true });
    assert.equal(next, 'implement');
});

test('router respects phase tool subset', () => {
    const tools = selectToolsForTurn({ userPrompt: 'build app', turnIndex: 2, phase: 'explore' });
    const names = tools.map(t => t.function.name);
    assert.ok(names.includes('read_file'));
    assert.ok(!names.includes('write_file'));
});

test('middleware phaseGate vetoes write in explore', async () => {
    const session = { phase: 'explore' };
    const mw = createDefaultMiddleware({});
    const veto = await runMiddlewareChain(mw, 'beforeTool', {
        ctx: {},
        session,
        payload: { name: 'write_file', args: { path: 'x.js' }, dup: false }
    });
    assert.equal(veto.veto, true);
    assert.equal(veto.result.phaseBlocked, true);
});

test('initialPhase is explore', () => {
    assert.equal(initialPhase(), 'explore');
});

test('resolveInitialPhase starts implement on greenfield build tasks', () => {
    const { resolveInitialPhase, isGreenfieldWorkspace } = require('../src/code/loop/phases.js');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-green-'));
    assert.equal(isGreenfieldWorkspace(root, ''), true);
    assert.equal(resolveInitialPhase({ projectRoot: root, treeSummary: '', goal: 'Build a Pac-Man game' }), 'implement');
});

test('resolveInitialPhase starts implement for new web game in brownfield app repo', () => {
    const { resolveInitialPhase } = require('../src/code/loop/phases.js');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-brown-'));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'host', main: 'main.js' }));
    fs.writeFileSync(path.join(root, 'main.js'), 'require("electron");\n');
    fs.writeFileSync(path.join(root, 'index.html'), '<!DOCTYPE html><html></html>\n');
    const goal = 'Create a web based pac-man game and show preview';
    assert.equal(resolveInitialPhase({ projectRoot: root, treeSummary: 'index.html main.js', goal }), 'implement');
});

test('verify phase allows write tools for fixes', () => {
    assert.equal(isToolAllowed('verify', 'write_file'), true);
    assert.equal(isToolAllowed('verify', 'patch'), true);
});
