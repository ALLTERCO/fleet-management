// Format an RPC error into a human-readable string. Handles both shapes:
//   device-RPC: {message, data: {deviceMessage, deviceCode}}
//   http-RPC:   {message, data: {message}}
// Falls back to the supplied label when nothing meaningful can be extracted.
export function rpcErrorMessage(
    err: unknown,
    fallback = 'Unknown error'
): string {
    if (typeof err === 'string') return err;
    const msg = primaryMessage(err);
    const data = extractData(err);
    const httpMsg = stringField(data, 'message');
    const deviceMsg = stringField(data, 'deviceMessage');
    const code = numberField(data, 'deviceCode');
    const parts = composeParts({msg, httpMsg, deviceMsg, code});
    return parts.length ? parts.join(' ') : fallback;
}

function primaryMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (err && typeof err === 'object') {
        const m = (err as {message?: unknown}).message;
        if (typeof m === 'string') return m;
    }
    return '';
}

function extractData(err: unknown): Record<string, unknown> | undefined {
    if (err && typeof err === 'object') {
        const d = (err as {data?: unknown}).data;
        if (d && typeof d === 'object') return d as Record<string, unknown>;
    }
    return undefined;
}

function stringField(
    data: Record<string, unknown> | undefined,
    key: string
): string | undefined {
    const v = data?.[key];
    return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function numberField(
    data: Record<string, unknown> | undefined,
    key: string
): number | undefined {
    const v = data?.[key];
    return typeof v === 'number' ? v : undefined;
}

interface MessageParts {
    msg: string;
    httpMsg?: string;
    deviceMsg?: string;
    code?: number;
}

function composeParts(p: MessageParts): string[] {
    const out: string[] = [];
    if (p.msg && p.msg !== 'undefined') out.push(p.msg);
    appendIfNew(out, p.deviceMsg, p.msg);
    appendIfNew(out, p.httpMsg, p.msg);
    if (p.code !== undefined) out.push(`(device code ${p.code})`);
    return out;
}

function appendIfNew(
    out: string[],
    candidate: string | undefined,
    seen: string
): void {
    if (candidate && !seen.includes(candidate)) out.push(candidate);
}
