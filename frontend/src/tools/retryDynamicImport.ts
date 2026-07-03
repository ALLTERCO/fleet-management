// Retry a dynamic import() with bounded backoff so transient network
// blips don't crash the page. Final failure rethrows so the router /
// preloadError handlers can trigger a full reload.

const DEFAULT_RETRIES = 3;
const DEFAULT_BACKOFF_MS = 250;

export function retryDynamicImport<T>(
    loader: () => Promise<T>,
    options: {retries?: number; backoffMs?: number} = {}
): Promise<T> {
    const retries = options.retries ?? DEFAULT_RETRIES;
    const backoff = options.backoffMs ?? DEFAULT_BACKOFF_MS;
    return attempt(loader, retries, backoff, 0);
}

function attempt<T>(
    loader: () => Promise<T>,
    retries: number,
    backoff: number,
    failures: number
): Promise<T> {
    return loader().catch((err) => {
        if (failures >= retries) throw err;
        const delay = backoff * 2 ** failures;
        return new Promise<T>((resolve, reject) => {
            setTimeout(() => {
                attempt(loader, retries, backoff, failures + 1).then(
                    resolve,
                    reject
                );
            }, delay);
        });
    });
}
