/**
 * Task-specific acceptance checks. For a "game" request the harness must see PROOF
 * of the moving parts — not just that files parse. Static analysis over the combined
 * HTML + JS source. Pure; no DOM, no filesystem.
 *
 * These are deliberately permissive in HOW (any keydown handler counts as input) but
 * strict in WHETHER the capability exists at all. A weak model that ships a title +
 * score and nothing else will fail here.
 */
'use strict';

function classifyTask(goal) {
    const g = String(goal || '').toLowerCase();
    const isGame = /\b(game|pac-?man|snake|tetris|breakout|pong|platformer|arcade|maze|invaders|flappy|2048|minesweeper|playable|play)\b/.test(g);
    const isWeb = isGame || /\b(web|html|css|page|site|website|browser|frontend|front-end|webpage)\b/.test(g);
    return { isGame, isWeb };
}

/**
 * @param {object} src { html, js } concatenated source strings for the project.
 * @returns {Array<{id,label,required,present,detail}>}
 */
function gameAcceptanceChecks({ html, js }) {
    const H = String(html || '');
    const J = String(js || '');
    const all = H + '\n' + J;

    const has = (re) => re.test(all);
    const hasJs = (re) => re.test(J);

    const checks = [];
    const add = (id, label, present, detail) => checks.push({ id, label, required: true, present: !!present, detail: detail || '' });

    // Visible game area: a board/canvas/maze/grid container in HTML or created in JS.
    add('game-area', 'visible game area',
        /<canvas[\s>]/i.test(H) ||
        /id=["'][^"']*(board|game|maze|grid|canvas|stage|arena|playfield)[^"']*["']/i.test(H) ||
        /class=["'][^"']*(board|game|maze|grid|canvas|stage|arena|playfield)[^"']*["']/i.test(H) ||
        /getElementById\(['"][^'"]*(board|game|maze|grid|canvas|stage)[^'"]*['"]\)/i.test(J),
        'board/canvas/maze container');

    // Player element renders.
    add('player', 'player element renders',
        has(/\b(pacman|pac-?man|player|hero|paddle|snake|ship|bird|character|avatar)\b/i),
        'player class/element present');

    // Input handler.
    add('input', 'input handler exists',
        hasJs(/addEventListener\s*\(\s*['"](keydown|keyup|keypress|click|mousedown|mouseup|pointerdown|touchstart)['"]/i) ||
        hasJs(/\bon(keydown|keyup|keypress|click|mousedown|pointerdown|touchstart)\s*=/i),
        'keyboard/mouse/touch listener');

    // Score updates: a score value mutated AND written to the DOM (or a score element).
    const scoreMutated = hasJs(/\bscore\b\s*(\+\+|--|\+=|-=|=)/i) || hasJs(/\bscore\s*=\s*score\b/i);
    const scoreShown = hasJs(/score[A-Za-z]*\.(textContent|innerText|innerHTML)\s*=/i) ||
        hasJs(/\.(textContent|innerText|innerHTML)\s*=\s*[`'"][^`'"]*\$?\{?\s*score/i) ||
        /id=["'][^"']*score[^"']*["']/i.test(H);
    add('score', 'score updates',
        scoreMutated && scoreShown,
        'score variable mutated and rendered');

    // Game loop / movement.
    add('loop', 'game loop or movement exists',
        hasJs(/\b(setInterval|requestAnimationFrame|setTimeout)\s*\(/) ||
        hasJs(/function\s+(gameLoop|update|tick|move|step|render)\b/i),
        'interval/raf/loop function');

    // Win / lose / completion state.
    add('endstate', 'win/lose or completion state',
        has(/\b(you\s*win|game\s*over|you\s*lose|win|won|lose|lost|defeat|victory|caught|complete[d]?)\b/i) ||
        hasJs(/clearInterval\s*\(/),
        'win/lose/end text or stop condition');

    return checks;
}

function runAcceptance(goal, src) {
    const { isGame, isWeb } = classifyTask(goal);
    if (!isGame) return { applicable: false, isWeb, checks: [], failed: [] };
    const checks = gameAcceptanceChecks(src);
    const failed = checks.filter(c => c.required && !c.present);
    return { applicable: true, isWeb, checks, failed };
}

module.exports = { classifyTask, gameAcceptanceChecks, runAcceptance };
