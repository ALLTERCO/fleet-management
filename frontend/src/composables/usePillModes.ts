// Pill peripheral mode discovery.

import {onMounted, ref, watch} from 'vue';
import {domainErrorKind, toastRpcError} from '@/helpers/domainErrors';
import {useToastStore} from '@/stores/toast';
import {sendRPC} from '@/tools/websocket';

const FALLBACK_MODES = [
    'onewire',
    'dht22',
    'analog_in',
    'ssr',
    'digital_io',
    'serial'
];

// Seeds used to spot a "mode list" array in unknown response shapes.
const MODE_SEEDS = new Set([
    'onewire',
    'dht22',
    'analog_in',
    'ssr',
    'digital_io',
    'serial',
    'uart',
    'ledstrip'
]);

export const PILL_MODE_LABELS: Record<string, string> = {
    onewire: '1-Wire (DS18B20)',
    dht22: 'DHT22 (temperature + humidity)',
    analog_in: 'Analog input (0-2.5V)',
    ssr: 'SSR (2 channels)',
    digital_io: 'Digital I/O',
    serial: 'Serial (UART / Modbus RTU)',
    uart: 'UART (beta)',
    ledstrip: 'Addressable LED strip'
};

export function pillModeLabel(value: string): string {
    return PILL_MODE_LABELS[value] ?? value;
}

// fw >24.12 → adds beta `uart` mode (per product owner).
function isBetaUartFw(ver: string | undefined): boolean {
    if (!ver) return false;
    const m = /^(\d+)\.(\d+)/.exec(ver);
    if (!m) return false;
    const major = Number(m[1]);
    const minor = Number(m[2]);
    if (!Number.isFinite(major) || !Number.isFinite(minor)) return false;
    return major > 24 || (major === 24 && minor > 12);
}

// Recursively scan for a string[] containing at least one mode seed.
function scanForModeArray(node: unknown, depth = 0): string[] | null {
    if (depth > 6 || node == null) return null;
    if (Array.isArray(node)) {
        if (
            node.every((v) => typeof v === 'string') &&
            (node as string[]).some((v) => MODE_SEEDS.has(v))
        ) {
            return node as string[];
        }
        for (const item of node) {
            const hit = scanForModeArray(item, depth + 1);
            if (hit) return hit;
        }
        return null;
    }
    if (typeof node === 'object') {
        for (const v of Object.values(node as Record<string, unknown>)) {
            const hit = scanForModeArray(v, depth + 1);
            if (hit) return hit;
        }
    }
    return null;
}

// Field name not officially documented — probe likely shapes, then scan.
function extractModesFromComponents(resp: unknown): string[] | null {
    const components = (resp as {components?: unknown})?.components;
    if (!Array.isArray(components)) return null;
    const pill = components.find(
        (c) => (c as {key?: string})?.key === 'pill'
    ) as Record<string, unknown> | undefined;
    if (!pill) return null;
    const candidates: unknown[] = [
        (pill.attrs as Record<string, unknown> | undefined)?.modes,
        (pill.attrs as Record<string, unknown> | undefined)?.mode_options,
        (pill.meta as Record<string, unknown> | undefined)?.modes,
        (pill.config as Record<string, unknown> | undefined)?.mode_options
    ];
    for (const c of candidates) {
        if (Array.isArray(c) && c.every((v) => typeof v === 'string')) {
            return c as string[];
        }
    }
    const scanned = scanForModeArray(pill);
    if (scanned) return scanned;
    // Null is the signal — caller falls back to inferModesFromComponents.
    return null;
}

// Active serial:N / ledstrip:N proves the mode exists in fw.
function inferModesFromComponents(resp: unknown): string[] {
    const components = (resp as {components?: unknown})?.components;
    if (!Array.isArray(components)) return [];
    const found = new Set<string>();
    for (const c of components) {
        const key = (c as {key?: string})?.key;
        if (typeof key !== 'string') continue;
        if (key.startsWith('serial:')) found.add('serial');
        if (key.startsWith('ledstrip:')) found.add('ledstrip');
    }
    return [...found];
}

export function usePillModes(
    shellyID: () => string | undefined,
    fwVersion: () => string | undefined,
    currentMode: () => string | undefined,
    enabled: () => boolean = () => true
) {
    const modes = ref<string[]>([]);
    const loading = ref(false);
    const fromFirmware = ref(false);
    const toast = useToastStore();
    let loadErrorToasted = false;

    function ensureCurrent(list: string[]): string[] {
        const cur = currentMode();
        if (cur && !list.includes(cur)) return [...list, cur];
        return list;
    }

    function fallbackModeList(): string[] {
        const list = [...FALLBACK_MODES];
        if (isBetaUartFw(fwVersion())) list.push('uart');
        return list;
    }

    // Old fw without Shelly.GetComponents surfaces as the stable
    // UnsupportedOperation domain code (backend maps device 404 to it) —
    // expected, fall back silently. Anything else gets one toast.
    function reportUnexpectedLoadError(err: unknown): void {
        if (domainErrorKind(err) === 'UnsupportedOperation') return;
        if (loadErrorToasted) return;
        loadErrorToasted = true;
        toastRpcError(toast, err, 'Failed to read Pill modes from the device');
    }

    async function load(): Promise<void> {
        // Skip RPCs entirely for non-Pill devices — caller opts in.
        if (!enabled()) {
            modes.value = [];
            return;
        }
        const id = shellyID();
        if (!id) {
            modes.value = [];
            return;
        }
        loading.value = true;
        try {
            // Filtered = capability data, unfiltered = component enumeration.
            const [pillResp, allResp] = await Promise.all([
                sendRPC<unknown>('FLEET_MANAGER', 'Shelly.GetComponents', {
                    shellyID: id,
                    keys: ['pill']
                }),
                sendRPC<unknown>('FLEET_MANAGER', 'Shelly.GetComponents', {
                    shellyID: id
                })
            ]);
            const fw = extractModesFromComponents(pillResp);
            if (fw && fw.length > 0) {
                modes.value = ensureCurrent(fw);
                fromFirmware.value = true;
                return;
            }
            // No capability list — use documented set + inferred.
            const inferred = inferModesFromComponents(allResp);
            const list = [...FALLBACK_MODES];
            for (const m of inferred) if (!list.includes(m)) list.push(m);
            if (isBetaUartFw(fwVersion()) && !list.includes('uart'))
                list.push('uart');
            modes.value = ensureCurrent(list);
            fromFirmware.value = false;
        } catch (err) {
            reportUnexpectedLoadError(err);
            modes.value = ensureCurrent(fallbackModeList());
            fromFirmware.value = false;
        } finally {
            loading.value = false;
        }
    }

    onMounted(load);
    watch([shellyID, fwVersion, currentMode], load);

    return {modes, loading, fromFirmware, reload: load};
}
