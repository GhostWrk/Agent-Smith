/**
 * Continuation drive — finish a build that the main turn loop left incomplete.
 *
 * The common local-model failure is: it writes index.html, then stalls or gives up before
 * writing the files index.html links (script.js, style.css) — so the run ends INCOMPLETE with
 * "script.js missing". Instead of giving up, this assesses what's still missing/broken and
 * writes each remaining piece with a FRESH, MINIMAL request: just the goal + the one file to
 * write. That tiny prompt is fast and far less likely to stall than continuing the bloated,
 * already-stalling conversation — and it tells the model exactly what to produce.
 *
 * Deterministic and bounded: it targets the SPECIFIC items the completion gate flagged, re-checks
 * after each, and stops as soon as the gate passes or the model can't produce the focused piece.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { extractFromMessage } = require('../tools/extractor.js');

const FOCUS_SYSTEM = [
    'You are Agent Smith finishing an unfinished build. The project already exists on disk; ONE piece is missing or broken.',
    'Reply with EXACTLY ONE tool call (write_file) and NOTHING else — no prose, no planning, no reasoning.',
    'Write COMPLETE, working code so the whole app runs end-to-end. No placeholders, stubs, "..." elisions, or TODOs.'
].join(' ');

function readSafe(root, rel) {
    try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch (e) { return ''; }
}

function fileKind(rel) {
    const e = path.extname(rel).toLowerCase();
    if (e === '.css') return 'CSS stylesheet';
    if (/\.(md|markdown)$/.test(e)) return 'README (markdown)';
    if (/\.(js|mjs|cjs)$/.test(e)) return 'JavaScript';
    if (/\.html?$/.test(e)) return 'HTML';
    return 'file';
}

function isGameGoal(goal) {
    return /\b(game|pac-?man|snake|tetris|breakout|pong|arcade|maze|invaders|flappy|platformer|playable)\b/i.test(String(goal || ''));
}

function buildWriteMessages(session, rel) {
    const touched = (session.filesTouched || []).filter(Boolean);
    const indexRel = touched.find(f => /index\.html$/i.test(f))
        || (fs.existsSync(path.join(session.projectRoot, 'index.html')) ? 'index.html' : null);
    let context = '';
    if (indexRel && !/index\.html$/i.test(rel)) {
        const html = readSafe(session.projectRoot, indexRel).slice(0, 4000);
        if (html.trim()) context = `\n\nFor reference, ${indexRel} (the page that links it):\n\`\`\`html\n${html}\n\`\`\``;
    }
    const gameHint = isGameGoal(session.goal) && /\.(js|mjs|cjs)$/i.test(rel)
        ? ' For a game include: keyboard/mouse input, a game loop (requestAnimationFrame/setInterval), rendering, a score, and a win/lose state.'
        : '';
    return [
        { role: 'system', content: FOCUS_SYSTEM },
        {
            role: 'user', content:
                `Goal: ${session.goal}\n\n` +
                `Files already on disk: ${touched.join(', ') || '(none)'}.\n` +
                `The build is missing "${rel}". Write the COMPLETE working ${fileKind(rel)} for "${rel}" so the whole app runs.${gameHint}\n` +
                `Reply with ONE write_file tool call: path="${rel}".${context}`
        }
    ];
}

function buildRepairMessages(session, scriptRel, errMsgs) {
    const script = readSafe(session.projectRoot, scriptRel).slice(0, 8000);
    const indexRel = (session.filesTouched || []).find(f => /index\.html$/i.test(f))
        || (fs.existsSync(path.join(session.projectRoot, 'index.html')) ? 'index.html' : null);
    const html = indexRel ? readSafe(session.projectRoot, indexRel).slice(0, 3000) : '';
    return [
        { role: 'system', content: FOCUS_SYSTEM },
        {
            role: 'user', content:
                `Goal: ${session.goal}\n\n` +
                `${scriptRel} fails validation. Fix ONLY ${scriptRel} (do NOT change the HTML) so these EXACT errors are resolved — every getElementById/querySelector id MUST match an id that actually exists in index.html:\n` +
                `${errMsgs.slice(0, 12).join('\n')}\n\n` +
                `Reply with ONE write_file tool call: path="${scriptRel}" containing the corrected COMPLETE file.` +
                (html ? `\n\nindex.html (the ids you must match):\n\`\`\`html\n${html}\n\`\`\`` : '') +
                `\n\nCurrent ${scriptRel}:\n\`\`\`js\n${script}\n\`\`\``
        }
    ];
}

/** One focused model request to write/patch a single target. Returns true iff a write landed. */
async function focusedWrite(deps, session, messages, expectRel) {
    const { stream, apiBaseUrl, writeTools, signal, emit, runTool } = deps;
    let result;
    try {
        result = await stream({
            apiBaseUrl, model: session.model, messages, tools: writeTools, signal,
            maxTokens: 8192, temperature: session.codeTemperature,
            onDelta: (d) => emit && emit({ type: 'delta', text: d })
        });
    } catch (e) {
        return false; // even the tiny focused request stalled/errored — the model is the wall
    }
    const msg = result && result.message;
    if (!msg) return false;
    extractFromMessage(msg, writeTools, { salvagePath: expectRel || null });
    let wrote = false;
    for (const tc of (msg.tool_calls || [])) {
        const name = tc.function && tc.function.name;
        let args = (tc.function && tc.function.arguments) || {};
        if (typeof args === 'string') { try { args = JSON.parse(args); } catch (e) { args = {}; } }
        if (!/^(write_file|append_file|patch)$/.test(name || '')) continue;
        if ((name === 'write_file' || name === 'patch') && !args.path && expectRel) args.path = expectRel;
        const r = await runTool(name, args);
        if (r && !r.error && !r.skipped) {
            const rel = r.relPath || args.path;
            if (rel && !(session.filesTouched || []).includes(rel)) session.filesTouched.push(rel);
            wrote = true;
        }
    }
    return wrote;
}

/**
 * @param {object} deps { session, runValidation, gateOpts, stream, apiBaseUrl, writeTools,
 *                         signal, emit, runTool, maxCycles? }
 * @returns {Promise<{gate, completed, cycles}>}
 */
async function driveToCompletion(deps) {
    const { session, runValidation, gateOpts, emit, maxCycles = 6 } = deps;
    let gate = await runValidation(session.projectRoot, session.filesTouched, session.goal, gateOpts);
    if (gate.allow) return { gate, completed: true, cycles: 0 };

    let cycles = 0;
    for (; cycles < maxCycles; cycles++) {
        const messages = gate.messages || [];
        // 1) Missing linked files / required prompt artifacts first — nothing runs without them.
        const missing = (gate.missingRefs && gate.missingRefs[0])
            || messages.map(m => /^\[ARTIFACT\]\s+(\S+)/i.exec(m) && /^\[ARTIFACT\]\s+(\S+)/i.exec(m)[1]).filter(Boolean)[0];
        let progressed = false;
        if (missing) {
            if (emit) emit({ type: 'run_continue', reason: 'finish_missing_file', target: missing, turn: session.turn });
            progressed = await focusedWrite(deps, session, buildWriteMessages(session, missing), missing);
        } else {
            // 2) Otherwise a script-level failure — a DOM id mismatch, an uncaught runtime error
            //    (e.g. addEventListener on null), a failing smoke test, or an undefined reference.
            //    Repair the script so its ids match the HTML and it runs clean.
            const repairMsgs = messages.filter(m => /^\[(DOM|FUNCTIONAL|RUNTIME|SMOKE|UNDEF|SELECTOR)\]/i.test(m));
            const scriptRel = (session.filesTouched || []).find(f => /\.(js|mjs|cjs)$/i.test(f));
            if (repairMsgs.length && scriptRel) {
                if (emit) emit({ type: 'run_continue', reason: 'finish_repair', target: scriptRel, turn: session.turn });
                progressed = await focusedWrite(deps, session, buildRepairMessages(session, scriptRel, repairMsgs), scriptRel);
            }
        }
        if (!progressed) break; // can't produce the focused piece — stop (don't loop pointlessly)
        gate = await runValidation(session.projectRoot, session.filesTouched, session.goal, gateOpts);
        if (gate.allow) return { gate, completed: true, cycles: cycles + 1 };
    }
    return { gate, completed: !!gate.allow, cycles };
}

module.exports = { driveToCompletion, focusedWrite, buildWriteMessages, buildRepairMessages };
