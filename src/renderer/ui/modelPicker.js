/**
 * Themed model picker.
 *
 * The native <select> dropdown is rendered by the OS and ignores our Matrix
 * theme — when opened it shows a white panel with washed-out option text. This
 * module hides the native control and renders a styled button + listbox that
 * mirrors the same <option> list, then syncs changes back to the native
 * <select id="model-select"> so the rest of app.js (which reads
 * modelSelect.value) keeps working unchanged.
 */
(function () {
    'use strict';

    function init() {
        const select = document.getElementById('model-select');
        if (!select || select.dataset.themed === '1') return;
        select.dataset.themed = '1';

        const label = select.closest('.ctx-model') || select.parentElement;
        if (!label) return;

        // Hide the native control but keep it in the DOM as the source of truth.
        select.classList.add('ctx-select--hidden');
        const legacyIco = label.querySelector('.ctx-ico');
        if (legacyIco) legacyIco.classList.add('ctx-ico--hidden');

        const wrap = document.createElement('div');
        wrap.className = 'mp';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mp-btn';
        btn.setAttribute('aria-haspopup', 'listbox');
        btn.setAttribute('aria-expanded', 'false');
        btn.innerHTML = `
            <span class="mp-ico" aria-hidden="true">▮</span>
            <span class="mp-label">Scanning…</span>
            <span class="mp-caret" aria-hidden="true">▾</span>
        `;
        const menu = document.createElement('div');
        menu.className = 'mp-menu';
        menu.setAttribute('role', 'listbox');
        menu.hidden = true;

        wrap.appendChild(btn);
        wrap.appendChild(menu);
        label.insertBefore(wrap, select);

        const labelEl = btn.querySelector('.mp-label');

        function renderMenu() {
            menu.innerHTML = '';
            const opts = Array.from(select.options);
            for (const o of opts) {
                const item = document.createElement('div');
                item.className = 'mp-item';
                item.setAttribute('role', 'option');
                item.tabIndex = o.disabled ? -1 : 0;
                item.dataset.value = o.value;
                item.textContent = o.textContent || o.value;
                if (o.disabled) item.classList.add('mp-item--disabled');
                if (o.selected) item.classList.add('mp-item--active');
                const choose = () => {
                    if (o.disabled) return;
                    select.value = o.value;
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                    syncLabel();
                    close();
                };
                item.addEventListener('click', choose);
                item.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        choose();
                    }
                });
                menu.appendChild(item);
            }
        }

        function syncLabel() {
            const opt = select.options[select.selectedIndex];
            labelEl.textContent = opt ? (opt.textContent || opt.value || '—') : '—';
            // Mark the active item in the open menu (if any).
            for (const el of menu.querySelectorAll('.mp-item')) {
                el.classList.toggle('mp-item--active', el.dataset.value === select.value);
            }
        }

        function open() {
            renderMenu();
            menu.hidden = false;
            btn.setAttribute('aria-expanded', 'true');
            wrap.classList.add('mp--open');
            document.addEventListener('mousedown', onDocDown, true);
            document.addEventListener('keydown', onKey, true);
        }

        function close() {
            menu.hidden = true;
            btn.setAttribute('aria-expanded', 'false');
            wrap.classList.remove('mp--open');
            document.removeEventListener('mousedown', onDocDown, true);
            document.removeEventListener('keydown', onKey, true);
        }

        function onDocDown(e) { if (!wrap.contains(e.target)) close(); }
        function onKey(e) { if (e.key === 'Escape') close(); }

        btn.addEventListener('click', () => {
            if (menu.hidden) open(); else close();
        });

        // Keep our UI in sync when app.js replaces the <option> list.
        const mo = new MutationObserver(() => {
            syncLabel();
            if (!menu.hidden) renderMenu();
        });
        mo.observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['value'] });
        select.addEventListener('change', syncLabel);

        syncLabel();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
