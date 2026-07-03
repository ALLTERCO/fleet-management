// Per-(host, org) circuit breaker for outbound webhooks. Scoped by org so
// one tenant's broken endpoint can't gate every other tenant pointing
// at the same host (api.telegram.org, slack hooks, etc.). Open = fail
// fast so a flapping upstream cannot drain the delivery worker.
import {envInt} from '../../../config/envReader';

type State = 'closed' | 'open' | 'half-open';

interface HostState {
    state: State;
    failureTimes: number[]; // ms timestamps within the window
    openedAt?: number;
    halfOpenInFlight: boolean;
}

interface BreakerConfig {
    threshold: number;
    windowMs: number;
    cooldownMs: number;
    maxHosts: number;
}

export interface BreakerScope {
    host: string;
    organizationId: string;
}

function readConfig(): BreakerConfig {
    return {
        threshold: envInt('FM_HTTP_BREAKER_THRESHOLD', 5),
        windowMs: envInt('FM_HTTP_BREAKER_WINDOW_MS', 30_000),
        cooldownMs: envInt('FM_HTTP_BREAKER_COOLDOWN_MS', 60_000),
        maxHosts: envInt('FM_HTTP_BREAKER_MAX_HOSTS', 1024)
    };
}

function keyFor(scope: BreakerScope): string {
    return `${scope.organizationId}|${scope.host}`;
}

// Map iteration order is insertion order — used as a cheap LRU.
const states = new Map<string, HostState>();

function evictIfOverCap(maxHosts: number): void {
    while (states.size > maxHosts) {
        const oldest = states.keys().next().value;
        if (oldest === undefined) break;
        states.delete(oldest);
    }
}

function touchLru(key: string, state: HostState): void {
    states.delete(key);
    states.set(key, state);
}

function getOrInit(key: string): HostState {
    let s = states.get(key);
    if (!s) {
        s = {
            state: 'closed',
            failureTimes: [],
            halfOpenInFlight: false
        };
        states.set(key, s);
    } else {
        touchLru(key, s);
    }
    return s;
}

export interface BreakerDecision {
    allow: boolean;
    reason?: string;
}

export function beforeRequest(scope: BreakerScope): BreakerDecision {
    const cfg = readConfig();
    const key = keyFor(scope);
    const s = getOrInit(key);
    evictIfOverCap(cfg.maxHosts);
    const now = Date.now();

    if (s.state === 'open') {
        if (s.openedAt !== undefined && now - s.openedAt >= cfg.cooldownMs) {
            s.state = 'half-open';
            s.halfOpenInFlight = false;
        } else {
            return {allow: false, reason: `CircuitOpen: ${scope.host}`};
        }
    }

    if (s.state === 'half-open') {
        if (s.halfOpenInFlight) {
            return {allow: false, reason: `CircuitOpen: ${scope.host}`};
        }
        s.halfOpenInFlight = true;
    }
    return {allow: true};
}

export function onSuccess(scope: BreakerScope): void {
    const s = states.get(keyFor(scope));
    if (!s) return;
    if (s.state === 'half-open') {
        s.state = 'closed';
    }
    s.failureTimes = [];
    s.openedAt = undefined;
    s.halfOpenInFlight = false;
}

export function onFailure(scope: BreakerScope): void {
    const cfg = readConfig();
    const s = getOrInit(keyFor(scope));
    const now = Date.now();
    s.halfOpenInFlight = false;

    if (s.state === 'half-open') {
        s.state = 'open';
        s.openedAt = now;
        return;
    }

    s.failureTimes = s.failureTimes.filter((t) => now - t < cfg.windowMs);
    s.failureTimes.push(now);
    if (s.failureTimes.length >= cfg.threshold) {
        s.state = 'open';
        s.openedAt = now;
    }
}

export function __resetForTests(): void {
    states.clear();
}

export function __getStateForTests(scope: BreakerScope): State | undefined {
    return states.get(keyFor(scope))?.state;
}
