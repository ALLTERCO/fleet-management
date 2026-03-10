import {onBeforeUnmount, type Ref, ref, watch} from 'vue';
import type {shelly_device_t} from '@/types';

interface DeviceEntry {
    shellyID: string;
    name: string;
    id: string;
    app: string;
    model: string;
    online: boolean;
}

function toEntry(d: shelly_device_t): DeviceEntry {
    return {
        shellyID: d.shellyID,
        name: d.info?.name || '',
        id: d.info?.id || '',
        app: d.info?.app || '',
        model: d.info?.model || '',
        online: d.online
    };
}

/**
 * Composable that offloads device name-filtering to a Web Worker.
 * Falls back to synchronous filtering if Workers are unavailable.
 *
 * Sends delta patches (added/removed) instead of the full device list
 * on every change to minimize structured-clone overhead.
 */
export function useDeviceFilterWorker(
    devices: Ref<shelly_device_t[]>,
    nameFilter: Ref<string>
) {
    const filteredIDs = ref<Set<string> | null>(null);
    let worker: Worker | null = null;
    let requestId = 0;
    let latestId = 0;

    // Track previous device IDs for delta computation
    let prevSnapshot = new Map<string, string>(); // shellyID → fingerprint

    try {
        worker = new Worker(
            new URL('../workers/deviceFilter.worker.ts', import.meta.url),
            {type: 'module'}
        );
        worker.onmessage = (e: MessageEvent) => {
            if (e.data.type === 'result' && e.data.id >= latestId) {
                latestId = e.data.id;
                filteredIDs.value = new Set(e.data.shellyIDs);
            }
        };
    } catch {
        // Worker not supported — filteredIDs stays null, caller uses sync path
    }

    function fingerprint(d: shelly_device_t): string {
        return `${d.info?.name || ''}|${d.info?.id || ''}|${d.info?.app || ''}|${d.info?.model || ''}|${d.online ? 1 : 0}`;
    }

    function updateIndex(devs: shelly_device_t[]) {
        if (!worker) return;

        const newSnapshot = new Map<string, string>();
        const added: DeviceEntry[] = [];
        const removed: string[] = [];

        for (const d of devs) {
            const fp = fingerprint(d);
            newSnapshot.set(d.shellyID, fp);
            // New or changed device
            if (prevSnapshot.get(d.shellyID) !== fp) {
                added.push(toEntry(d));
            }
        }

        // Devices that were removed
        for (const id of prevSnapshot.keys()) {
            if (!newSnapshot.has(id)) {
                removed.push(id);
            }
        }

        if (prevSnapshot.size === 0) {
            // First load: send full index
            worker.postMessage({
                type: 'setIndex',
                devices: devs.map(toEntry)
            });
        } else if (added.length > 0 || removed.length > 0) {
            worker.postMessage({
                type: 'patchIndex',
                added,
                removed
            });
        }

        prevSnapshot = newSnapshot;
    }

    function applyFilter(name: string) {
        if (!worker) return;
        const id = ++requestId;
        worker.postMessage({
            type: 'filter',
            id,
            nameFilter: name,
            typeFilter: null,
            onlineFilter: null
        });
    }

    // Keep index in sync with device list changes
    watch(devices, (devs) => updateIndex(devs), {immediate: true});

    // Re-filter when name changes
    watch(nameFilter, (n) => applyFilter(n), {immediate: true});

    onBeforeUnmount(() => {
        worker?.terminate();
        worker = null;
    });

    return {filteredIDs, updateIndex, applyFilter};
}
