import {ref} from 'vue';

export interface BufferEntry {
    timestamp: number;
    value: number;
}

export function useRollingBuffer(maxEntries = 60) {
    const buffer = ref<BufferEntry[]>([]);

    function push(value: number) {
        buffer.value = [
            ...buffer.value.slice(-(maxEntries - 1)),
            {timestamp: Date.now(), value}
        ];
    }

    function clear() {
        buffer.value = [];
    }

    return {buffer, push, clear};
}
