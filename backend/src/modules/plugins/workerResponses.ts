export interface PendingPluginCall {
    resolve: (r?: any) => any;
    reject: (r?: any) => any;
}

export function settlePluginCallResponse(
    waiting: Map<number, PendingPluginCall>,
    id: number,
    responseType: unknown,
    data: unknown,
    warn: (message: string, id: number) => void = console.warn
): boolean {
    const entry = waiting.get(id);
    if (!entry) {
        warn('plugin worker received response for unknown call id:', id);
        return false;
    }
    waiting.delete(id);
    if (responseType === 'resolve') {
        entry.resolve(data);
    } else {
        entry.reject(data);
    }
    return true;
}
