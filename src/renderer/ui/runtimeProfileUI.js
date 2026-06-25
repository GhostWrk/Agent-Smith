/**
 * Runtime profile UI — auto-tune existing TUNING sliders on model change.
 */
(function (global) {
    'use strict';

    const LS_AUTO = 'agentsmith_auto_tune';
    const LS_OVERRIDE = 'agentsmith_profile_override';
    const LS_MAX_TURNS = 'agentsmith_max_turns';
    const LS_CODE_TEMP = 'agentsmith_code_temperature';

    function buildProfile(modelId, telemetry) {
        const fn = global.XKRuntimeProfile?.buildRuntimeProfile;
        if (!fn) return null;
        return fn({ modelId, telemetry });
    }

    function applyProfileToSliders(profile, els) {
        if (!profile || !els) return;
        const { tempSlider, tempVal, ctxSlider, ctxVal, stepsSlider, stepsVal } = els;
        if (tempSlider) {
            tempSlider.value = String(profile.temperature);
            if (tempVal) tempVal.textContent = profile.temperature.toFixed(1);
        }
        if (ctxSlider) {
            ctxSlider.value = String(profile.numCtx);
            if (ctxVal) ctxVal.textContent = String(profile.numCtx);
        }
        if (stepsSlider) {
            stepsSlider.value = String(profile.maxSteps);
            if (stepsVal) stepsVal.textContent = String(profile.maxSteps);
        }
    }

    let _els = null;
    let _chipEl = null;
    let _toggleEl = null;
    let _modelSelect = null;
    let _lastProfile = null;
    let _applying = false;
    let _invoke = null;
    let _getApiBaseUrl = null;
    let _isBusy = null;
    let _debounceMs = 350;
    let _ctxTimer = null;
    let _pendingSync = null;
    let _syncing = false;

    function isAutoTuneEnabled() {
        return localStorage.getItem(LS_AUTO) !== 'false';
    }

    function setOverride(flag) {
        localStorage.setItem(LS_OVERRIDE, flag ? 'true' : 'false');
    }

    function hasOverride() {
        return localStorage.getItem(LS_OVERRIDE) === 'true';
    }

    function persistCodeFields(profile) {
        if (!profile) return;
        localStorage.setItem(LS_MAX_TURNS, String(profile.maxTurns));
        localStorage.setItem(LS_CODE_TEMP, String(profile.codeTemperature));
    }

    function updateChip(profile) {
        if (!_chipEl) return;
        if (!profile) {
            _chipEl.textContent = '';
            _chipEl.title = '';
            return;
        }
        let text = profile.summary;
        if (profile.warnings?.length) text += ' — ' + profile.warnings[0];
        _chipEl.textContent = text;
        _chipEl.title = (profile.warnings || []).join('\n');
    }

    function setChipStatus(text, title) {
        if (!_chipEl) return;
        _chipEl.textContent = text || '';
        _chipEl.title = title || '';
    }

    function apiInvoke() {
        return _invoke || global.window?.api?.invoke || global.api?.invoke;
    }

    function currentApiBase() {
        if (typeof _getApiBaseUrl === 'function') return _getApiBaseUrl();
        return global.currentApiBase || 'http://127.0.0.1:1234';
    }

    function busyNow() {
        try {
            return typeof _isBusy === 'function' && _isBusy();
        } catch (e) {
            return false;
        }
    }

    function syncLabel(result) {
        if (!result) return '';
        if (result.managed === false) {
            if (result.reason === 'remote_endpoint') return 'server-managed context';
            return result.warning || result.error || 'LM Studio unmanaged';
        }
        if (result.fallbackUsed) return `fallback ctx ${result.loadedContext}`;
        if (result.loadedContext) return `LM Studio ctx ${result.loadedContext}`;
        return 'LM Studio ready';
    }

    function applyLoadedContext(result) {
        const loaded = Number(result?.loadedContext);
        if (!Number.isFinite(loaded) || loaded <= 0 || !_els?.ctxSlider) return;
        if (String(_els.ctxSlider.value) === String(loaded)) return;
        _applying = true;
        _els.ctxSlider.value = String(loaded);
        if (_els.ctxVal) _els.ctxVal.textContent = String(loaded);
        _applying = false;
    }

    async function syncContextForModel(modelId, contextLength) {
        if (!modelId || !contextLength) return null;
        const request = {
            apiBaseUrl: currentApiBase(),
            model: modelId,
            contextLength: parseInt(contextLength, 10)
        };
        if (busyNow()) {
            _pendingSync = request;
            setChipStatus(`Context change queued (${request.contextLength})`, 'Will reload LM Studio after the active run finishes.');
            return { queued: true };
        }
        const invoke = apiInvoke();
        if (typeof invoke !== 'function') return null;
        _syncing = true;
        setChipStatus(`Reloading LM Studio ctx ${request.contextLength}...`, '');
        try {
            const result = await invoke('lmstudio-ensure-model', request);
            if (result?.managed === false) {
                setChipStatus(syncLabel(result), result.warning || result.error || '');
                return result;
            }
            applyLoadedContext(result);
            setChipStatus(syncLabel(result), result?.warning || '');
            return result;
        } catch (e) {
            setChipStatus('LM Studio sync failed', e.message || String(e));
            return { managed: false, error: e.message || String(e) };
        } finally {
            _syncing = false;
        }
    }

    async function flushPendingContextSync() {
        if (!_pendingSync || busyNow() || _syncing) return null;
        const pending = _pendingSync;
        _pendingSync = null;
        return syncContextForModel(pending.model, pending.contextLength);
    }

    async function applyForModel(modelId) {
        if (!modelId || !isAutoTuneEnabled() || hasOverride()) return null;
        let telemetry = null;
        try {
            telemetry = await window.api.invoke('get-gpu-telemetry');
        } catch (e) { /* telemetry optional */ }

        const profile = buildProfile(modelId, telemetry);
        if (!profile) return null;

        _lastProfile = profile;
        _applying = true;
        applyProfileToSliders(profile, _els);
        persistCodeFields(profile);
        updateChip(profile);
        _applying = false;
        await syncContextForModel(modelId, profile.numCtx);
        return profile;
    }

    async function applyForCurrentModel() {
        const modelId = _modelSelect?.value;
        if (!modelId) return null;
        return applyForModel(modelId);
    }

    function mount(opts = {}) {
        _modelSelect = opts.modelSelect;
        _els = opts.sliders || {};
        _chipEl = opts.chipEl;
        _toggleEl = opts.toggleEl;
        _invoke = opts.invoke || opts.api?.invoke || null;
        _getApiBaseUrl = opts.getApiBaseUrl || null;
        _isBusy = opts.isBusy || null;
        _debounceMs = Number.isFinite(opts.debounceMs) ? opts.debounceMs : _debounceMs;

        if (_toggleEl) {
            _toggleEl.checked = isAutoTuneEnabled();
            _toggleEl.addEventListener('change', () => {
                localStorage.setItem(LS_AUTO, _toggleEl.checked ? 'true' : 'false');
                if (_toggleEl.checked && !hasOverride()) {
                    applyForCurrentModel();
                }
            });
        }

        if (_modelSelect) {
            _modelSelect.addEventListener('change', () => {
                setOverride(false);
                if (isAutoTuneEnabled()) applyForCurrentModel();
            });
        }

        const sliders = [_els.tempSlider, _els.ctxSlider, _els.stepsSlider].filter(Boolean);
        sliders.forEach((s) => {
            s.addEventListener('input', () => {
                if (_applying) return;
                setOverride(true);
                if (s === _els.ctxSlider) {
                    if (_ctxTimer) clearTimeout(_ctxTimer);
                    _ctxTimer = setTimeout(() => {
                        _ctxTimer = null;
                        syncContextForModel(_modelSelect?.value, _els.ctxSlider?.value);
                    }, _debounceMs);
                }
            });
        });
    }

    function getMaxTurns() {
        const n = parseInt(localStorage.getItem(LS_MAX_TURNS) || '40', 10);
        return Number.isFinite(n) ? n : 40;
    }

    function getCodeTemperature() {
        const t = parseFloat(localStorage.getItem(LS_CODE_TEMP) || '0.2');
        return Number.isFinite(t) ? t : 0.2;
    }

    function getLastProfile() {
        return _lastProfile;
    }

    const api = {
        mount,
        applyForCurrentModel,
        applyForModel,
        applyProfileToSliders,
        syncContextForModel,
        flushPendingContextSync,
        getMaxTurns,
        getCodeTemperature,
        getLastProfile
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') window.XKRuntimeProfileUI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
