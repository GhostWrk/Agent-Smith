/**
 * IPC domain: local LM Studio model/context management.
 */
'use strict';

module.exports = function registerLmStudioIpc(ipcMain, deps) {
    const { lmStudioManager } = deps;
    if (!lmStudioManager) return;

    ipcMain.handle('lmstudio-get-status', async (_event, opts) => {
        try {
            return await lmStudioManager.getStatus({
                apiBaseUrl: opts?.apiBaseUrl,
                model: opts?.model
            });
        } catch (e) {
            return { managed: false, error: e.message || String(e) };
        }
    });

    ipcMain.handle('lmstudio-ensure-model', async (_event, opts) => {
        try {
            return await lmStudioManager.ensureModel({
                apiBaseUrl: opts?.apiBaseUrl,
                model: opts?.model,
                contextLength: opts?.contextLength
            });
        } catch (e) {
            return { managed: false, error: e.message || String(e) };
        }
    });
};
