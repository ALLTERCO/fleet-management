import {createHash, createHmac, timingSafeEqual} from 'node:crypto';

// Zitadel signature: `ZITADEL-Signature: t=<unix>,v1=<hex>`; HMAC-SHA256 over `${t}.${rawBody}`.

export interface VerifyOptions {
    rawBody: Buffer;
    signatureHeader: string | undefined;
    signingKey: string;
    nowMs?: number;
    skewMs?: number;
}

export type VerifyResult = {ok: true} | {ok: false; reason: string};

const HEADER_RE = /(^|,)\s*([a-zA-Z0-9]+)=([^,\s]+)/g;

function parseSignatureHeader(
    header: string
): {timestamp: number; v1: string} | null {
    let match: RegExpExecArray | null;
    let timestamp: number | null = null;
    let v1: string | null = null;

    HEADER_RE.lastIndex = 0;
    match = HEADER_RE.exec(header);
    while (match !== null) {
        const [, , key, value] = match;
        if (key === 't') {
            const parsed = Number.parseInt(value, 10);
            if (Number.isFinite(parsed)) {
                timestamp = parsed;
            }
        } else if (key === 'v1') {
            v1 = value;
        }
        match = HEADER_RE.exec(header);
    }

    if (timestamp === null || v1 === null || v1.length === 0) {
        return null;
    }
    return {timestamp, v1};
}

function constantTimeHexEqual(a: string, b: string): boolean {
    if (a.length !== b.length) {
        return false;
    }
    let bufA: Buffer;
    let bufB: Buffer;
    try {
        bufA = Buffer.from(a, 'hex');
        bufB = Buffer.from(b, 'hex');
    } catch {
        return false;
    }
    if (bufA.length === 0 || bufA.length !== bufB.length) {
        return false;
    }
    return timingSafeEqual(bufA, bufB);
}

export function zitadelSignatureReplayKey(
    signatureHeader: string | undefined
): string | null {
    if (!signatureHeader || signatureHeader.length === 0) return null;
    const parsed = parseSignatureHeader(signatureHeader);
    if (parsed === null) return null;
    return createHash('sha256')
        .update(`${parsed.timestamp}.${parsed.v1.toLowerCase()}`)
        .digest('hex');
}

export function verifyZitadelSignature(opts: VerifyOptions): VerifyResult {
    return verifyZitadelSignatureMulti({
        rawBody: opts.rawBody,
        signatureHeader: opts.signatureHeader,
        signingKeys: [opts.signingKey],
        nowMs: opts.nowMs,
        skewMs: opts.skewMs
    });
}

export interface VerifyMultiOptions {
    rawBody: Buffer;
    signatureHeader: string | undefined;
    signingKeys: string[];
    nowMs?: number;
    skewMs?: number;
}

// Tries each key in order; first match wins. Used during rotation overlap.
export function verifyZitadelSignatureMulti(
    opts: VerifyMultiOptions
): VerifyResult {
    if (!opts.signatureHeader || opts.signatureHeader.length === 0) {
        return {ok: false, reason: 'missing signature header'};
    }
    const keys = opts.signingKeys.filter((k) => k && k.length > 0);
    if (keys.length === 0) {
        return {ok: false, reason: 'signing key not configured'};
    }

    const parsed = parseSignatureHeader(opts.signatureHeader);
    if (parsed === null) {
        return {ok: false, reason: 'malformed signature header'};
    }

    const skewMs = opts.skewMs ?? 5 * 60 * 1000;
    const nowMs = opts.nowMs ?? Date.now();
    const driftMs = Math.abs(nowMs - parsed.timestamp * 1000);
    if (driftMs > skewMs) {
        return {ok: false, reason: 'timestamp outside replay window'};
    }

    const payload = `${parsed.timestamp}.${opts.rawBody.toString('utf8')}`;
    for (const key of keys) {
        const expected = createHmac('sha256', key)
            .update(payload)
            .digest('hex');
        if (constantTimeHexEqual(expected, parsed.v1)) {
            return {ok: true};
        }
    }
    return {ok: false, reason: 'signature mismatch'};
}
