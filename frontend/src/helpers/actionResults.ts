/** Whether an RPC result indicates failure */
export function isFailed(result: any): boolean {
    return result?.code != null && result.code !== 0;
}

/** Strip internal fields (__promiseStatus) from an RPC result */
export function stripInternal(result: any): any {
    if (!result || typeof result !== 'object') return result;
    const {__promiseStatus, ...rest} = result;
    return rest;
}

/** Whether an RPC result has response data beyond status fields */
export function hasResponseData(result: any): boolean {
    if (!result || typeof result !== 'object') return false;
    return Object.keys(result).some(
        (k) => k !== '__promiseStatus' && k !== 'code' && k !== 'message'
    );
}

/** Count total and failed results from a run */
export function countResults(results: Record<string, any>): {
    total: number;
    failed: number;
} {
    const entries = Object.values(results);
    const failed = entries.filter(isFailed).length;
    return {total: entries.length, failed};
}
