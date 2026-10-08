// Pill mode picker source. The backend assembles the one mode list from
// device signals at discovery (capabilities.ui.pillModes); the frontend
// renders it. The only local addition is the device's current mode, which
// guards a torn moment between a settings patch and a capability refresh.

import {computed} from 'vue';

export const PILL_MODE_LABELS: Record<string, string> = {
    onewire: '1-Wire (DS18B20)',
    dht22: 'DHT22 (temperature + humidity)',
    analog_in: 'Analog input (0-2.5V)',
    ssr: 'SSR (2 channels)',
    digital_io: 'Digital I/O',
    uart: 'UART (beta)',
    js_uart: 'UART (scripting)',
    mb_client: 'Modbus client',
    ledstrip: 'Addressable LED strip'
};

export function pillModeLabel(value: string): string {
    return PILL_MODE_LABELS[value] ?? value;
}

export interface PillModeSource {
    capabilities?: {ui?: {pillModes?: string[]}};
}

export function usePillModes(
    device: () => PillModeSource | undefined,
    currentMode: () => string | undefined
) {
    const modes = computed<string[]>(() => {
        const list = [...(device()?.capabilities?.ui?.pillModes ?? [])];
        const cur = currentMode();
        if (cur && !list.includes(cur)) list.push(cur);
        return list;
    });

    return {modes};
}
