import {defineStore} from 'pinia';
import {ref} from 'vue';
import type {DeviceChange} from '@/tools/deviceEventFormat';

// One live row per leaf change. Never coalesced — two flips of the same field
// are two rows, because merging them would hide a bug. The device `ts` is kept
// verbatim; `receivedAt` is the client clock, for display only.
export interface DeviceEventRow extends DeviceChange {
    shellyId: string;
    receivedAt: number;
    seq: number;
}

// Bounded ring so a burst can't grow the tab unbounded. Sized well above a
// single 2k-device fan-out so nothing is lost between renders.
const BUFFER_MAX = 5000;

export const useDeviceEventsStore = defineStore('deviceEvents', () => {
    const events = ref<DeviceEventRow[]>([]);
    // Smart-parse toggle. Off shows the raw, unparsed change for every row.
    const parsed = ref(true);
    let seq = 0;

    function addChanges(shellyId: string, changes: DeviceChange[]): void {
        for (const change of changes) {
            events.value.push({
                ...change,
                shellyId,
                receivedAt: Date.now(),
                seq: seq++
            });
        }
        const overflow = events.value.length - BUFFER_MAX;
        if (overflow > 0) events.value.splice(0, overflow);
    }

    function clear(): void {
        events.value = [];
    }

    function setParsed(value: boolean): void {
        parsed.value = value;
    }

    return {events, parsed, addChanges, clear, setParsed};
});
