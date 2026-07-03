// "${attrName}" → number resolved against the firing device.

import type AbstractDevice from '../../model/AbstractDevice';

const TOKEN_RE = /^\$\{([a-zA-Z0-9_.]+)\}$/;

export function resolveThreshold(
    raw: number | string | undefined,
    device: AbstractDevice | undefined
): number | null {
    if (typeof raw === 'number') return raw;
    if (typeof raw !== 'string') return null;
    const match = TOKEN_RE.exec(raw);
    if (!match) return null;
    const path = match[1];
    const value = readDeviceAttr(device, path);
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readDeviceAttr(
    device: AbstractDevice | undefined,
    path: string
): unknown {
    if (!device) return undefined;
    // info is the closest thing to "device attributes" we have today.
    let cur: unknown = device.info as unknown;
    for (const segment of path.split('.')) {
        if (cur == null || typeof cur !== 'object') return undefined;
        cur = (cur as Record<string, unknown>)[segment];
    }
    return cur;
}
