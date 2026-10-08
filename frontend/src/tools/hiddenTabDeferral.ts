// Event-driven reads skip hidden tabs; many requests while hidden become one
// run when the tab is visible again.

export interface HiddenTabDeferral {
    request(): void;
    dispose(): void;
}

export function isTabHidden(): boolean {
    return (
        typeof document !== 'undefined' && document.visibilityState === 'hidden'
    );
}

export function deferWhileHidden(run: () => void): HiddenTabDeferral {
    let pending = false;

    function onVisibilityChange(): void {
        if (isTabHidden() || !pending) return;
        pending = false;
        run();
    }

    if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', onVisibilityChange);
    }

    return {
        request() {
            if (isTabHidden()) {
                pending = true;
                return;
            }
            run();
        },
        dispose() {
            pending = false;
            if (typeof document !== 'undefined') {
                document.removeEventListener(
                    'visibilitychange',
                    onVisibilityChange
                );
            }
        }
    };
}

export const RECHECK_AFTER_HIDDEN_MS = 60_000;
export const RECHECK_INTERVAL_MS = 5 * 60_000;

// Re-reads a push-fed value: every 5 min while visible, and on return from a
// hide longer than 60 s. No timer runs while the tab is hidden.
export function recheckWhileVisible(run: () => void): {dispose(): void} {
    let timer: ReturnType<typeof setInterval> | undefined;
    let hiddenAt: number | null = null;

    function stopTimer(): void {
        if (timer === undefined) return;
        clearInterval(timer);
        timer = undefined;
    }

    function startTimer(): void {
        stopTimer();
        timer = setInterval(run, RECHECK_INTERVAL_MS);
    }

    function onVisibilityChange(): void {
        if (isTabHidden()) {
            stopTimer();
            hiddenAt ??= Date.now();
            return;
        }
        const wasHiddenMs = hiddenAt === null ? 0 : Date.now() - hiddenAt;
        hiddenAt = null;
        startTimer();
        if (wasHiddenMs > RECHECK_AFTER_HIDDEN_MS) run();
    }

    if (typeof document === 'undefined') return {dispose() {}};
    document.addEventListener('visibilitychange', onVisibilityChange);
    if (isTabHidden()) hiddenAt = Date.now();
    else startTimer();

    return {
        dispose() {
            stopTimer();
            document.removeEventListener(
                'visibilitychange',
                onVisibilityChange
            );
        }
    };
}

// Dev-only trace so a corrected drift is visible; users see nothing.
export function logCountDrift(
    name: string,
    local: number,
    server: number
): void {
    if (import.meta.env.DEV) {
        console.debug(
            `[count drift] ${name}: local ${local}, server ${server}`
        );
    }
}
