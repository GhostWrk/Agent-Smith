const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
    runProjectRulesForFile,
    runProjectRulesForProject,
    clearRulesCache,
    rulesDir
} = require('../src/code/governor/projectRules.js');
const { checkCompletion } = require('../src/code/governor/completionGate.js');

function resetRuleMarker() {
    delete global.__AGENT_SMITH_RULE_EXECUTED;
}

test('project JS rules are not loaded unless explicitly enabled', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prules-disabled-'));
    clearRulesCache(root);
    const dir = rulesDir(root);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'marker.js'), `
global.__AGENT_SMITH_RULE_EXECUTED = true;
module.exports = { id: 'marker', match: () => true, check: async () => ({ ok: false, message: 'loaded' }) };
`);
    fs.writeFileSync(path.join(root, 'a.js'), 'const ok = true;\n');

    resetRuleMarker();
    const r = await runProjectRulesForProject(root, ['a.js']);
    assert.equal(r.ok, true);
    assert.equal(global.__AGENT_SMITH_RULE_EXECUTED, undefined);
});

test('runProjectRulesForProject collects violations when enabled', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prules-'));
    clearRulesCache(root);
    const dir = rulesDir(root);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'ban-todo.js'), `
module.exports = {
    id: 'ban-todo',
    match: () => true,
    check: async (ctx) => /TODO/.test(ctx.content)
        ? { ok: false, message: 'TODO found', fix: 'Resolve TODO comments' }
        : { ok: true }
};
`);
    fs.writeFileSync(path.join(root, 'a.js'), '// TODO fix\n');

    const r = await runProjectRulesForProject(root, ['a.js'], { enabled: true });
    assert.equal(r.ok, false);
    assert.match(r.messages[0], /\[RULE:ban-todo\]/);
});

test('project rule blocks completion when grind validates rules', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prules-gate-'));
    clearRulesCache(root);
    const dir = rulesDir(root);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'ban-evil.js'), `
module.exports = {
    id: 'ban-evil',
    match: (p) => p.endsWith('.js'),
    check: async (ctx) => ctx.content.includes('EVIL')
        ? { ok: false, message: 'EVIL token present', fix: 'Remove EVIL' }
        : { ok: true }
};
`);
    fs.writeFileSync(path.join(root, 'bad.js'), 'const EVIL = 1;\n');

    const gate = await checkCompletion(root, ['bad.js'], 'fix the file', { grindMode: false, projectRulesEnabled: true });
    assert.equal(gate.allow, false);
    assert.ok(gate.messages.some(m => /\[RULE:ban-evil\]/.test(m)));
});
