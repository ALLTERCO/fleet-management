// Single source of truth for turning a gateway's BLU remotes into
// device_event alert config. A multi-button remote reports every button on
// one bthomedevice component; the button number is attrs.idx. We target one
// button with {componentType, componentKey, event, predicate:{idx}} — no
// button-specific logic anywhere else.

import type {bthomedevice_entity, entity} from '@/types/entities';

export interface BluButtonTarget {
    /** e.g. 'bthomedevice:200' — the remote's component on the gateway. */
    componentKey: string;
    /** Button index within the remote (0-based). */
    idx: number;
    /** Human label, e.g. 'Button 1'. */
    label: string;
    /** The remote's name, to group buttons by device. */
    deviceLabel: string;
}

export interface BluButtonGesture {
    value: string;
    label: string;
}

// Push gestures a BLU remote emits (BTHomeControl reference).
export const BLU_BUTTON_GESTURES: readonly BluButtonGesture[] = [
    {value: 'single_push', label: 'Single press'},
    {value: 'double_push', label: 'Double press'},
    {value: 'triple_push', label: 'Triple press'},
    {value: 'long_push', label: 'Long press'}
];

function isBthomeDevice(e: entity): e is bthomedevice_entity {
    return e.type === 'bthomedevice';
}

/** Every button across a gateway's bound BLU remotes. Dimmers excluded. */
export function listBluButtons(
    entities: readonly entity[]
): BluButtonTarget[] {
    const out: BluButtonTarget[] = [];
    for (const e of entities) {
        if (!isBthomeDevice(e)) continue;
        const componentKey = `bthomedevice:${e.properties.id}`;
        for (const control of e.properties.controls ?? []) {
            if (control.kind !== 'button') continue;
            out.push({
                componentKey,
                idx: control.idx,
                label: control.label,
                deviceLabel: e.name
            });
        }
    }
    return out;
}

/** The device_event config that fires on one button of one remote. */
export function buildButtonEventConfig(input: {
    componentKey: string;
    idx: number;
    gesture: string;
}): Record<string, unknown> {
    return {
        componentType: 'bthomedevice',
        componentKey: input.componentKey,
        event: input.gesture,
        predicate: {idx: input.idx}
    };
}

/** Reverse of buildButtonEventConfig; null when the config isn't a BLU button. */
export function parseButtonEventConfig(
    config: Record<string, unknown>
): {componentKey: string; idx: number; gesture: string} | null {
    if (config.componentType !== 'bthomedevice') return null;
    const {componentKey, event: gesture, predicate} = config;
    if (typeof componentKey !== 'string' || typeof gesture !== 'string') {
        return null;
    }
    const idx =
        predicate && typeof predicate === 'object' && !Array.isArray(predicate)
            ? (predicate as Record<string, unknown>).idx
            : undefined;
    if (typeof idx !== 'number') return null;
    return {componentKey, idx, gesture};
}
