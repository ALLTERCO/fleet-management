/**
 * Tiny helpers shared by every status-based evaluator so fingerprints
 * and status traversal look identical across rule kinds.
 */
import type AbstractDevice from '../../../model/AbstractDevice';
import {fieldFingerprintV2} from '../fingerprint';
import type {LoadedAlertRule, NormalizedEvent} from '../types';

// Same fingerprint as the fire path, so clear matches.
export function deviceFieldClearMatch(
    event: NormalizedEvent,
    rule: LoadedAlertRule,
    kind: LoadedAlertRule['kind'],
    readConfig: (
        cfg: Record<string, unknown>
    ) => {component: string; field: string} | null
): {fingerprintV2: string} | null {
    if (rule.kind !== kind) return null;
    if (event.kind !== 'device_status_changed') return null;
    const cfg = readConfig(rule.config);
    if (!cfg) return null;
    return {
        fingerprintV2: fieldFingerprintV2({
            ruleId: rule.id,
            subjectType: 'device',
            subjectId: event.shellyID,
            component: cfg.component,
            field: cfg.field
        })
    };
}

/**
 * Read a nested field from a status object using a dot-path. Returns
 * undefined rather than throwing so evaluators can test presence.
 */
export function readField(obj: unknown, path: string): unknown {
    if (obj == null || typeof obj !== 'object') return undefined;
    let cur: unknown = obj;
    for (const part of path.split('.')) {
        if (cur == null || typeof cur !== 'object') return undefined;
        cur = (cur as Record<string, unknown>)[part];
    }
    return cur;
}

export function readNumber(obj: unknown, path: string): number | null {
    const v = readField(obj, path);
    // NaN/Infinity read as missing, never compared.
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function readBoolean(obj: unknown, path: string): boolean | null {
    const v = readField(obj, path);
    return typeof v === 'boolean' ? v : null;
}

export function deviceDisplayName(device?: AbstractDevice): string | undefined {
    return device?.info?.name as string | undefined;
}

/**
 * Scan a device.status object for channels matching a prefix ("smoke:",
 * "flood:", etc.) and return a list of {idx, component}. Sensors ship
 * one-per-channel so indices matter for message attribution.
 */
export function collectChannels(
    status: Record<string, unknown> | undefined,
    prefix: string
): Array<{idx: string; component: Record<string, unknown>}> {
    if (!status) return [];
    const out: Array<{idx: string; component: Record<string, unknown>}> = [];
    for (const key of Object.keys(status)) {
        if (!key.startsWith(prefix)) continue;
        const component = status[key];
        if (component && typeof component === 'object') {
            out.push({
                idx: key.slice(prefix.length),
                component: component as Record<string, unknown>
            });
        }
    }
    return out;
}
