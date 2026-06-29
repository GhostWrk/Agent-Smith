/**
 * Project-type router for Code Mode. Classify the REQUESTED artifact before planning so Code Mode
 * builds the right thing — a CLI, library, API server, test harness, script, game, web app, etc. —
 * instead of defaulting every build to index.html/style.css/script.js.
 *
 * Rule: a web scaffold is only chosen when the request clearly asks for a web/browser UI (or names
 * a conventional UI app like a to-do/tracker). "harness/CLI/script/tool/runner/tester/benchmark/
 * automation" route to a non-web implementation unless a browser UI is explicitly requested.
 */
'use strict';

const PROJECT_TYPES = [
    'static_web_app', 'node_cli', 'python_cli', 'node_library', 'python_package',
    'api_server', 'electron_app', 'test_harness', 'game', 'automation_script',
    'existing_repo_patch', 'unknown'
];

const WEB_UI_RE = /\b(web\s?app|web\s?page|webpage|web\s?site|website|web-?based|web\s?ui|browser|front[\s-]?end|frontend|landing\s?page|single[\s-]?page|\bspa\b|\bhtml\b|\bcss\b|\bdom\b|\bui\b|\bgui\b|visual\s?(interface|ui)|graphical\s?(interface|ui)|in\s?the\s?browser|client[\s-]?side)\b/;
const ELECTRON_RE = /\b(electron|desktop\s?app|desktop\s?application)\b/;
const GAME_RE = /\b(game|pac-?man|snake|tetris|breakout|pong|platformer|arcade|maze|invaders|flappy|2048|minesweeper|roguelike|shoot[\s-]?em[\s-]?up|shooter|playable)\b/;
const TERMINAL_RE = /\b(terminal|console|cli|text[\s-]?based|ascii|command[\s-]?line|ncurses)\b/;
const PY_RE = /\b(python|py|pip|pytest|flask|django|fastapi|pandas|numpy|conda|poetry)\b|\.py\b/;
const NODE_RE = /\b(node(?:\.?js)?|npm|javascript|typescript|express|yarn|pnpm|deno|bun)\b|package\.json/;
const HARNESS_RE = /\b(test\s?harness|harness|benchmark(?:ing)?|test\s?runner|tester|test\s?suite|fixtures?|eval(?:uation)?\s?harness|load\s?test)\b/;
const API_RE = /\b(api|rest(?:ful)?|graphql|server|backend|micro[\s-]?services?|endpoints?|http\s?server|web\s?service|express|fastapi|flask|django|webhook|grpc)\b/;
const LIBRARY_RE = /\b(library|libraries|\bsdk\b|reusable|\bpackage\b)\b/;
const AUTOMATION_RE = /\b(automation|automat(?:e|ing|ed)|cron|scheduled|scraper|scrap(?:e|ing)|crawler|batch\s?(?:job|process)|\betl\b|data\s?pipeline|pipeline)\b/;
const CLI_RE = /\b(cli|command[\s-]?line|terminal|console|script|tool(?:kit|chain)?|runner|utility|generator|converter|parser|analy[sz]er|processor|formatter|linter|compiler|transpiler|daemon|wrapper)\b/;
const PATCH_RE = /\b(fix|patch|refactor|modify|update|improve|debug|change|edit|extend|add)\b[\s\S]{0,40}\b(existing|current|this|that|the)\s+(repo|repository|project|codebase|code|app|file|files|module|function|component)\b/;
const WEB_CONVENTIONAL_RE = /\b(tracker|to-?do|todo|kanban|dashboard|calculator|budget|planner|expense|inventory|shopping\s?list|grocery\s?list|reading\s?list|gallery|portfolio|\bblog\b|quiz|flash\s?cards?|weather\s?app|chat\s?app|note-?taking|notes?\s?app|timer|stopwatch|pomodoro|habit\s?tracker|playlist|recipe\s?(app|book))\b/;

function normalize(goal) {
    return ' ' + String(goal || '').toLowerCase() + ' ';
}

/** @returns {string} one of PROJECT_TYPES */
function classifyProjectType(goal) {
    const g = normalize(goal);
    const has = (re) => re.test(g);
    const webExplicit = has(WEB_UI_RE);

    if (has(ELECTRON_RE)) return 'electron_app';
    if (has(GAME_RE)) {
        // a "terminal"/"ascii" game is a CLI program; otherwise a game means canvas/DOM (web).
        if (has(TERMINAL_RE) && !webExplicit) return has(PY_RE) ? 'python_cli' : 'node_cli';
        return 'game';
    }
    // A scraper/crawler is a SCRIPT even though it names a website/URL as its target — the
    // incidental "website" must not route it to a web scaffold.
    if (has(/\b(scraper|scrap(?:e|ed|es|ing)|crawler|crawl(?:ed|ing)?|web\s?spider)\b/)) return 'automation_script';
    // Non-web implementations win UNLESS the user explicitly asked for a browser UI.
    if (!webExplicit) {
        if (has(HARNESS_RE)) return 'test_harness';
        if (has(API_RE)) return 'api_server';
        if (has(LIBRARY_RE)) return has(PY_RE) ? 'python_package' : 'node_library';
        if (has(AUTOMATION_RE)) return 'automation_script';
        if (has(CLI_RE)) return has(PY_RE) ? 'python_cli' : 'node_cli';
    }
    if (webExplicit || has(WEB_CONVENTIONAL_RE)) return 'static_web_app';
    if (has(PATCH_RE)) return 'existing_repo_patch';
    return 'unknown';
}

function lang(goal) {
    const g = normalize(goal);
    if (PY_RE.test(g)) return 'python';
    if (NODE_RE.test(g)) return 'node';
    return null;
}

/**
 * Type profile used to drive the planning prompt, the default plan, and the "create files" nudge.
 * @returns {{ type, label, files, steps:string[], verify, confident:boolean }}
 */
function projectTypeProfile(goal) {
    const type = classifyProjectType(goal);
    const l = lang(goal);
    const P = {
        static_web_app: {
            label: 'static web app', files: 'index.html plus the CSS and JS it links (e.g. style.css, script.js) and a README',
            steps: [
                'Create index.html structure with the required UI elements',
                'Create style.css for layout and styling',
                'Create script.js with the app logic',
                'Add README.md and verify the page loads with all linked files'
            ],
            verify: 'open the page in a browser — linked CSS/JS load, DOM ids match, the UI renders'
        },
        game: {
            label: 'browser game', files: 'index.html, style.css, script.js (canvas/DOM game) and a README',
            steps: [
                'Create index.html with the game container/canvas',
                'Create style.css for the game layout',
                'Create script.js with input, game loop, rendering, and win/lose',
                'Add README.md and verify the game renders and responds to input'
            ],
            verify: 'load the page — the canvas/UI renders visible content and responds to input'
        },
        node_cli: {
            label: 'Node.js CLI', files: 'package.json, the CLI entry (index.js or bin/cli.js), and README.md',
            steps: [
                'Create package.json and the CLI entry (index.js)',
                'Implement argument parsing and the core CLI logic',
                'Add README.md with usage and an example invocation',
                'Verify: run the CLI (node index.js …) or `npm test`'
            ],
            verify: 'run the CLI with sample arguments (node index.js …) or `npm test`'
        },
        python_cli: {
            label: 'Python CLI', files: 'main.py (CLI entry), requirements.txt if needed, README.md, and a test',
            steps: [
                'Create main.py as the CLI entry',
                'Implement argument parsing (argparse) and the core logic',
                'Add README.md and a test (test_*.py)',
                'Verify: run `python main.py …` and `pytest`'
            ],
            verify: 'run `python main.py …` and `pytest`'
        },
        node_library: {
            label: 'Node.js library', files: 'package.json (with main/exports), src/index.js, tests, README.md',
            steps: [
                'Create package.json and the library entry (index.js) with its exports',
                'Implement the library API',
                'Add tests and a README with usage examples',
                'Verify: `npm test`'
            ],
            verify: '`npm test`'
        },
        python_package: {
            label: 'Python package', files: 'the package (pkg/__init__.py), pyproject.toml or setup.py, tests, README.md',
            steps: [
                'Create the package structure (pkg/__init__.py + pyproject.toml/setup.py)',
                'Implement the package API',
                'Add tests (test_*.py) and a README',
                'Verify: `pytest`'
            ],
            verify: '`pytest`'
        },
        api_server: {
            label: l === 'python' ? 'Python API server' : 'API server',
            files: l === 'python' ? 'app.py (the server), requirements.txt, README.md' : 'server.js (the server), package.json, README.md',
            steps: [
                'Set up the server project (package.json/requirements + the entry file)',
                'Implement the routes/endpoints and any data layer',
                'Add README.md with run instructions and an example request',
                'Verify: start the server and hit an endpoint (curl/fetch)'
            ],
            verify: 'start the server and request an endpoint'
        },
        test_harness: {
            label: l === 'python' ? 'Python test harness' : 'test harness',
            files: l === 'python'
                ? 'runner.py (the harness), a sample config/fixture, requirements.txt if needed, README.md'
                : 'package.json, the harness runner (index.js), a sample config/fixture, README.md',
            steps: [
                l === 'python' ? 'Create runner.py and a sample config/fixture' : 'Create package.json, the harness runner (index.js), and a sample config/fixture',
                'Implement the harness: load the config, run the cases, collect results',
                'Add a sample fixture/config and a README explaining how to run it',
                'Verify: run the harness on the sample and check it produces the expected output'
            ],
            verify: 'run the harness on the sample fixture and verify the output'
        },
        electron_app: {
            label: 'Electron app', files: 'package.json, main.js (main process), index.html (renderer), README.md',
            steps: [
                'Create package.json, main.js (main process), and index.html (renderer)',
                'Implement the renderer UI and any IPC',
                'Add README.md with how to run (`electron .`)',
                'Verify: the app launches and the window loads (smoke)'
            ],
            verify: '`electron .` launches and the window loads without errors'
        },
        automation_script: {
            label: l === 'python' ? 'Python automation script' : 'automation script',
            files: l === 'python' ? 'script.py, a config if needed, README.md' : 'script.js, a config if needed, README.md',
            steps: [
                l === 'python' ? 'Create script.py and any config' : 'Create script.js (or index.js) and any config',
                'Implement the automation logic',
                'Add README.md with how to run it',
                'Verify: run the script and confirm it completes without errors'
            ],
            verify: 'run the script and confirm it completes'
        },
        existing_repo_patch: {
            label: 'change to the existing project', files: 'edit the existing files the task names — do not scaffold a new app',
            steps: [
                'Explore the relevant existing files',
                'Apply the targeted change with patch',
                'Verify with the project’s tests / a syntax check'
            ],
            verify: 'run the project’s tests or a syntax check'
        },
        unknown: {
            label: 'tool/script (assumed — restate with "web UI" for a browser app)',
            files: 'the source files the task needs — likely a script/CLI, NOT a web page unless you want a browser UI',
            steps: [
                'Create the source files the task needs (a script/module, not a web page unless a UI was requested)',
                'Implement the core logic',
                'Add a README explaining how to run it',
                'Verify: run the code (or its tests)'
            ],
            verify: 'run the code or its tests'
        }
    };
    const profile = P[type] || P.unknown;
    const confident = type !== 'unknown';
    return Object.assign({ type, confident }, profile);
}

module.exports = { classifyProjectType, projectTypeProfile, PROJECT_TYPES };
