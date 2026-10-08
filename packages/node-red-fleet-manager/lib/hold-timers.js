// "Only if it stays that way for N seconds": one pending action per key.

class HoldTimers {
    constructor() {
        this.timers = new Map();
    }

    /** hold: {delayMs, action()} */
    start(key, hold) {
        this.cancel(key);
        if (!(hold.delayMs > 0)) {
            hold.action();
            return;
        }
        const timer = setTimeout(() => {
            this.timers.delete(key);
            hold.action();
        }, hold.delayMs);
        this.timers.set(key, timer);
    }

    isPending(key) {
        return this.timers.has(key);
    }

    cancel(key) {
        clearTimeout(this.timers.get(key));
        this.timers.delete(key);
    }

    clear() {
        for (const timer of this.timers.values()) clearTimeout(timer);
        this.timers.clear();
    }
}

function secondsToMs(value) {
    const seconds = Number(value);
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
}

module.exports = {
    HoldTimers,
    secondsToMs
};
