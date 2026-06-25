/**
 * Code run panel UI — status bar, review + Revert All (replaces plan drawer).
 */
(function (global) {
    'use strict';

    function routeEvent(type) {
        if (type === 'tool_start' || type === 'tool_result' || type === 'delta') return 'timeline';
        return 'code-panel';
    }

    function renderReviewPanel(container, diffText, sessionId, onRevert) {
        if (!container) return;
        container.innerHTML = '';
        const wrap = document.createElement('div');
        wrap.className = 'code-review-panel';
        wrap.innerHTML = `
            <div class="code-review-header">Code Run Review</div>
            <pre class="code-diff">${escapeHtml(diffText || '(no file changes)')}</pre>
            <button type="button" class="test-btn code-revert-btn">REVERT ALL</button>
        `;
        wrap.querySelector('.code-revert-btn')?.addEventListener('click', () => {
            if (onRevert) onRevert(sessionId);
        });
        container.appendChild(wrap);
    }

    function escapeHtml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function updateStatusBar(el, { turn, toolCount, budgetPct, planProgress }) {
        if (!el) return;
        const parts = [];
        if (planProgress) parts.push(`Plan ${planProgress}`);
        if (turn != null) parts.push(`Turn ${turn}`);
        if (toolCount != null) parts.push(`${toolCount} tools`);
        if (budgetPct != null) parts.push(`ctx ${budgetPct}%`);
        el.textContent = parts.join(' · ') || 'Code Mode idle';
    }

    const api = { routeEvent, renderReviewPanel, updateStatusBar };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') window.XKCodeRunUI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
