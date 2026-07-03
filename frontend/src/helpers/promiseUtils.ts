// Log rejections from Promise.allSettled without nuking the whole flow.
// One source of truth for the dashboard load pattern: critical fetch first
// (try/catch + banner), then independent fetches via allSettled with each
// rejection logged but non-fatal.
export function logSettledRejections(
    component: string,
    labeled: Record<string, PromiseSettledResult<unknown>>
): void {
    for (const [label, result] of Object.entries(labeled)) {
        if (result.status === 'rejected') {
            console.warn(`[${component}] ${label} failed:`, result.reason);
        }
    }
}

export async function resolveOptional<T>(
    component: string,
    label: string,
    promise: Promise<T>
): Promise<T | null> {
    try {
        return await promise;
    } catch (error) {
        console.warn(`[${component}] ${label} failed:`, error);
        return null;
    }
}
