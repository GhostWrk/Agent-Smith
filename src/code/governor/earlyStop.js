/**
 * Early stop detector — halt run on repeated failures or stagnation.
 */
'use strict';

class EarlyStopDetector {
    constructor(opts = {}) {
        this.maxTurns = opts.maxTurns || 40;
        this.maxConsecutiveErrors = opts.maxConsecutiveErrors || 5;
        this.maxDuplicateTools = opts.maxDuplicateTools || 8;
        this.turn = 0;
        this.consecutiveErrors = 0;
        this.duplicateCount = 0;
    }

    onTurn() {
        this.turn++;
        if (this.turn >= this.maxTurns) {
            return { stop: true, reason: `Max turns (${this.maxTurns}) reached` };
        }
        return { stop: false };
    }

    onToolResult(ok, wasDuplicate) {
        if (ok) {
            this.consecutiveErrors = 0;
        } else if (!wasDuplicate) {
            // A duplicate-skip is NOT a tool error — it has its own `duplicateCount`
            // budget below. Counting it toward consecutiveErrors used to kill runs that
            // were merely repeating a call while trying to recover from a real failure.
            this.consecutiveErrors++;
            if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
                return { stop: true, reason: `${this.maxConsecutiveErrors} consecutive tool errors` };
            }
        }
        if (wasDuplicate) {
            this.duplicateCount++;
            if (this.duplicateCount >= this.maxDuplicateTools) {
                return { stop: true, reason: 'Too many duplicate tool calls' };
            }
        }
        return { stop: false };
    }
}

module.exports = { EarlyStopDetector };
