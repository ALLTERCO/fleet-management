// Leaf holder for the installed runtime, so login-path modules can read it without importing the initializer.
import type {AuthzCache} from './cache';
import type {L1AuthzCache} from './l1-cache';
import type {ResolverDb} from './resolver';

export interface AuthzRuntime {
    cache: AuthzCache;
    db: ResolverDb;
    l1: L1AuthzCache;
    unsubscribeWsInvalidation: () => void;
}

let instance: AuthzRuntime | null = null;

export function tryGetAuthzRuntime(): AuthzRuntime | null {
    return instance;
}

export function setAuthzRuntime(rt: AuthzRuntime | null): void {
    instance = rt;
}

// Test-only: production code must never call this.
export function __setAuthzRuntimeForTests(rt: AuthzRuntime | null): void {
    instance = rt;
}
