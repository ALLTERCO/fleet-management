// Monotonic token guarding shared state against stale async merges.
// Writes bump; reads snapshot before the await and bail if it moved.
export interface StaleGuard {
    bump(): number;
    current(): number;
    isStale(token: number): boolean;
}

export function createStaleGuard(): StaleGuard {
    let seq = 0;
    return {
        bump: () => ++seq,
        current: () => seq,
        isStale: (token) => token !== seq
    };
}
