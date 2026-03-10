/**
 * Web Worker for device filtering.
 * Runs name/type/online filtering off the main thread.
 *
 * Protocol:
 *   Main → Worker: { type: 'setIndex', devices: DeviceEntry[] }
 *   Main → Worker: { type: 'patchIndex', added: DeviceEntry[], removed: string[] }
 *   Main → Worker: { type: 'filter', id: number, nameFilter, typeFilter, onlineFilter }
 *   Worker → Main: { type: 'result', id: number, shellyIDs: string[] }
 */

interface DeviceEntry {
    shellyID: string;
    name: string;
    id: string;
    app: string;
    model: string;
    online: boolean;
}

const index = new Map<string, DeviceEntry>();

self.onmessage = (e: MessageEvent) => {
    const msg = e.data;

    if (msg.type === 'setIndex') {
        index.clear();
        for (const d of msg.devices as DeviceEntry[]) {
            index.set(d.shellyID, d);
        }
        return;
    }

    if (msg.type === 'patchIndex') {
        const {added, removed} = msg as {
            added: DeviceEntry[];
            removed: string[];
        };
        for (const id of removed) {
            index.delete(id);
        }
        for (const d of added) {
            index.set(d.shellyID, d);
        }
        return;
    }

    if (msg.type === 'filter') {
        const {id, nameFilter, typeFilter, onlineFilter} = msg;
        let results = Array.from(index.values());

        if (nameFilter) {
            const needle = nameFilter.toLowerCase();
            results = results.filter(
                (d) =>
                    d.name?.toLowerCase().includes(needle) ||
                    d.shellyID.toLowerCase().includes(needle) ||
                    d.id?.toLowerCase().includes(needle)
            );
        }

        if (typeFilter && typeFilter !== 'All devices') {
            results = results.filter(
                (d) => d.app === typeFilter || d.model === typeFilter
            );
        }

        if (onlineFilter !== null && onlineFilter !== undefined) {
            results = results.filter((d) => d.online === onlineFilter);
        }

        (self as unknown as Worker).postMessage({
            type: 'result',
            id,
            shellyIDs: results.map((d) => d.shellyID)
        });
    }
};
