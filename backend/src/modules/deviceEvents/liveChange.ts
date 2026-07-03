// Wire shape for a single live delta on the DeviceEvent.Change event. The
// device id rides on the event params (one per message); each change carries
// only what the console renders — the device timestamp stays verbatim.

import type {DeviceEventEntry} from './deviceEventRow';

export interface LiveChange {
    ts?: string;
    component: string;
    field: string;
    prev: unknown;
    next: unknown;
    kind: string;
    source: string;
}

export function toLiveChange(entry: DeviceEventEntry): LiveChange {
    return {
        ts: entry.ts,
        component: entry.component,
        field: entry.field,
        prev: entry.prev,
        next: entry.next,
        kind: entry.kind,
        source: entry.source
    };
}
