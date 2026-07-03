// JSONB write SoT — node-pg serializes JS arrays as `{a,b}` (PG-array).
// Kept zero-dep so light callers can import without pulling the PG pool.
export function jsonbParam(value: unknown): string {
    return JSON.stringify(value ?? null);
}
