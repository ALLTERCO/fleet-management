// Compatibility facade. StatusStream is the single implementation.
import {
    appendStatusFieldsBestEffort,
    getStatusDrainerStream,
    getStatusStream,
    resetForTests,
    resetSaturationStateForTests
} from './StatusStream';

export {resetForTests, resetSaturationStateForTests};

export async function spillStatusEntry(
    fields: Record<string, string>
): Promise<void> {
    await appendStatusFieldsBestEffort(fields);
}

export function getOverflowStream() {
    return getStatusStream();
}

export function getOverflowDrainerStream() {
    return getStatusDrainerStream();
}
