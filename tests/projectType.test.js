/**
 * Project-type routing: Code Mode must classify the requested artifact BEFORE planning and build
 * the right kind of project — not default every task to index.html/style.css/script.js.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyProjectType, projectTypeProfile } = require('../src/code/plan/projectType.js');
const { defaultPlan } = require('../src/code/plan/codePlan.js');

const planText = (goal) => defaultPlan(goal).steps.map(s => s.title).join('\n');
const noWebScaffold = (text) => assert.doesNotMatch(text, /index\.html|style\.css|script\.js/i,
    'must not scaffold web files: ' + text);

// ---- Regression 1: Python log analyzer CLI -> python files, no web scaffold ----
test('R1: "Build a simple Python log analyzer CLI" -> python_cli, no index.html/style.css/script.js', () => {
    assert.equal(classifyProjectType('Build a simple Python log analyzer CLI'), 'python_cli');
    const text = planText('Build a simple Python log analyzer CLI');
    assert.match(text, /main\.py/);
    noWebScaffold(text);
});

// ---- Regression 2: "a simple AI harness" -> non-web (harness), no button demo ----
test('R2: "Build a simple AI harness" -> test_harness (non-web), no web scaffold', () => {
    assert.equal(classifyProjectType('Build a simple AI harness'), 'test_harness');
    const text = planText('Build a simple AI harness');
    assert.match(text, /harness|runner/i);
    noWebScaffold(text);
});

// ---- Regression 3: explicit browser UI -> web scaffold allowed ----
test('R3: "Build a simple browser AI harness UI" -> static_web_app (web scaffold allowed)', () => {
    assert.equal(classifyProjectType('Build a simple browser AI harness UI'), 'static_web_app');
    const profile = projectTypeProfile('Build a simple browser AI harness UI');
    assert.match(profile.files, /index\.html/);
});

// ---- Regression 4: Node benchmark harness -> node project files, not a webpage ----
test('R4: "Build a Node benchmark harness for testing local LLM endpoints" -> test_harness, node files, no web scaffold', () => {
    assert.equal(classifyProjectType('Build a Node benchmark harness for testing local LLM endpoints'), 'test_harness');
    const profile = projectTypeProfile('Build a Node benchmark harness for testing local LLM endpoints');
    assert.match(profile.files, /package\.json/);
    assert.match(profile.files, /index\.js/);
    noWebScaffold(planText('Build a Node benchmark harness for testing local LLM endpoints'));
});

// ---- Existing web/game flows must NOT regress ----
test('web/game flows still classify as web/game (no regression)', () => {
    assert.equal(classifyProjectType('Build a web based Pac-Man game'), 'game');
    assert.equal(classifyProjectType('Build a budget tracker web app'), 'static_web_app');
    assert.equal(classifyProjectType('Build a personal budget tracker with localStorage'), 'static_web_app');
    assert.match(planText('Build a budget tracker web app'), /HTML/i);
});

// ---- Routing coverage across the type set ----
test('routes CLI/library/API/automation/electron/patch correctly', () => {
    assert.equal(classifyProjectType('Build a REST API server in Node'), 'api_server');
    assert.equal(classifyProjectType('Write a Python package for parsing logs'), 'python_package');
    assert.equal(classifyProjectType('Build a Node library for date math'), 'node_library');
    assert.equal(classifyProjectType('Write an automation script to scrape a website'), 'automation_script');
    assert.equal(classifyProjectType('Build an Electron desktop note app'), 'electron_app');
    assert.equal(classifyProjectType('A command-line tool to rename files'), 'node_cli');
    assert.equal(classifyProjectType('Refactor the existing auth module in this repo'), 'existing_repo_patch');
});

// ---- "anything you want" must not be forced into a web preview ----
test('R6: "build me anything you want" is not forced into a web scaffold', () => {
    assert.equal(classifyProjectType('build me anything you want'), 'unknown');
    const profile = projectTypeProfile('build me anything you want');
    assert.equal(profile.confident, false, 'flags it as an assumption to state');
    noWebScaffold(planText('build me anything you want'));
    assert.match(profile.files, /not a web page|script\/CLI/i, 'defaults away from a web page');
});

// ---- A "tool"/"script"/"harness" must prefer non-web even without a language ----
test('rule 2: harness/CLI/tool/runner/benchmark/automation prefer non-web', () => {
    for (const g of ['Build a log parsing tool', 'Make a test runner', 'Create a benchmark for sorting', 'Write a file rename script']) {
        const t = classifyProjectType(g);
        assert.notEqual(t, 'static_web_app', `${g} -> ${t} should not be web`);
        noWebScaffold(planText(g));
    }
});
