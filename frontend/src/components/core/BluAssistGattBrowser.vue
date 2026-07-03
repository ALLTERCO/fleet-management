<template>
    <div class="bag-browser">
        <header class="bag-bar">
            <button
                type="button"
                class="bag-btn"
                :disabled="discovering"
                @click="runDiscover"
            >
                <i
                    :class="
                        discovering
                            ? 'fas fa-spinner fa-spin'
                            : 'fas fa-magnifying-glass'
                    "
                />
                {{ services.length === 0 ? 'Discover' : 'Re-discover' }}
            </button>
            <span v-if="services.length > 0" class="bag-count">
                {{ services.length }} services
            </span>
        </header>

        <div v-if="error" class="bag-error">
            <i class="fas fa-triangle-exclamation" /> {{ error }}
        </div>

        <div v-if="services.length === 0 && !discovering" class="bag-empty">
            Discover services to browse characteristics.
        </div>

        <details
            v-for="(svc, sIdx) in services"
            :key="`${sIdx}-${svc.uuid}`"
            class="bag-svc"
            open
        >
            <summary class="bag-svc__head">
                <span class="bag-svc__uuid">{{ svc.uuid }}</span>
                <span v-if="svc.label" class="bag-svc__label">
                    {{ svc.label }}
                </span>
                <span class="bag-svc__count">
                    {{ svc.characteristics.length }} chars
                </span>
            </summary>
            <div class="bag-chars">
                <div
                    v-for="(chr, cIdx) in svc.characteristics"
                    :key="`${cIdx}-${chr.uuid}`"
                    class="bag-chr"
                >
                    <div class="bag-chr__head">
                        <span class="bag-chr__uuid">{{ chr.uuid }}</span>
                        <span class="bag-chr__props">
                            <span
                                v-for="prop in chr.properties"
                                :key="prop"
                                class="bag-prop"
                            >
                                {{ prop }}
                            </span>
                        </span>
                    </div>
                    <div class="bag-chr__actions">
                        <button
                            v-if="chr.canRead"
                            type="button"
                            class="bag-btn bag-btn--xs"
                            :disabled="busyKeys.has(chr.key)"
                            @click="readChar(svc.uuid, chr)"
                        >
                            <i class="fas fa-download" /> Read
                        </button>
                        <button
                            v-if="chr.canWrite"
                            type="button"
                            class="bag-btn bag-btn--xs"
                            @click="openWrite(chr.key)"
                        >
                            <i class="fas fa-pen" /> Write
                        </button>
                        <button
                            v-if="chr.canSubscribe"
                            type="button"
                            class="bag-btn bag-btn--xs"
                            :class="{'bag-btn--on': subscribed.has(chr.key)}"
                            :disabled="busyKeys.has(chr.key)"
                            @click="
                                toggleNotify(
                                    svc.uuid,
                                    chr,
                                    !subscribed.has(chr.key)
                                )
                            "
                        >
                            <i class="fas fa-bell" />
                            {{
                                subscribed.has(chr.key)
                                    ? 'Unsubscribe'
                                    : 'Subscribe'
                            }}
                        </button>
                    </div>
                    <div v-if="readValues[chr.key]" class="bag-chr__value">
                        <span class="bag-chr__value-label">Read:</span>
                        <code class="bag-mono">{{ readValues[chr.key] }}</code>
                    </div>
                    <div
                        v-if="
                            notifications[chr.key] &&
                            notifications[chr.key].length > 0
                        "
                        class="bag-chr__stream"
                    >
                        <header class="bag-chr__stream-head">
                            <i class="fas fa-bell" />
                            Live ({{ notifications[chr.key].length }})
                            <button
                                type="button"
                                class="bag-btn bag-btn--xs bag-btn--ghost"
                                @click="clearNotifications(chr.key)"
                            >
                                Clear
                            </button>
                        </header>
                        <ol class="bag-chr__stream-list">
                            <li
                                v-for="(n, idx) in notifications[chr.key]"
                                :key="`${n.ts}-${idx}`"
                                class="bag-chr__stream-item"
                            >
                                <span class="bag-chr__stream-ts">
                                    {{ formatStreamTs(n.ts) }}
                                </span>
                                <code class="bag-mono">{{ n.data }}</code>
                            </li>
                        </ol>
                    </div>
                    <form
                        v-if="writeOpenKey === chr.key"
                        class="bag-chr__write"
                        @submit.prevent="
                            writeChar(svc.uuid, chr, writeBuffer)
                        "
                    >
                        <input
                            v-model.trim="writeBuffer"
                            type="text"
                            placeholder="hex bytes (e.g. 0102ff)"
                            class="bag-input"
                            :class="{
                                'bag-input--invalid':
                                    writeBuffer && !isValidHex(writeBuffer)
                            }"
                            pattern="^([0-9a-fA-F]{2})*$"
                        />
                        <button
                            type="submit"
                            class="bag-btn bag-btn--xs bag-btn--primary"
                            :disabled="
                                busyKeys.has(chr.key) ||
                                !writeBuffer ||
                                !isValidHex(writeBuffer)
                            "
                        >
                            Send
                        </button>
                        <button
                            type="button"
                            class="bag-btn bag-btn--xs"
                            @click="cancelWrite"
                        >
                            Cancel
                        </button>
                    </form>
                </div>
            </div>
        </details>
    </div>
</template>

<script setup lang="ts">
import {onBeforeUnmount, reactive, ref} from 'vue';
import {rpcErrorMessage} from '@/helpers/rpcError';
import {useToastStore} from '@/stores/toast';
import {
    type DeviceEventPayload, 
    onDeviceEvent,
    sendRPC
} from '@/tools/websocket';

interface CharNorm {
    key: string;
    uuid: string;
    handle?: number;
    properties: string[];
    canRead: boolean;
    canWrite: boolean;
    canSubscribe: boolean;
}

interface SvcNorm {
    uuid: string;
    label?: string;
    characteristics: CharNorm[];
}

const props = defineProps<{
    shellyID: string;
    connId: number;
    addr: string;
}>();

const toast = useToastStore();

interface NotificationEntry {
    ts: number;
    data: string;
    raw: Record<string, unknown>;
}

const MAX_NOTIFICATIONS_PER_CHAR = 20;

const discovering = ref(false);
const error = ref<string | null>(null);
const services = ref<SvcNorm[]>([]);
const readValues = reactive<Record<string, string>>({});
const subscribed = ref(new Set<string>());
const busyKeys = ref(new Set<string>());
const writeOpenKey = ref<string | null>(null);
const writeBuffer = ref('');
const notifications = reactive<Record<string, NotificationEntry[]>>({});

// Map of (component, event) → unsubscribe fn. Set on first subscribe, torn
// down on unmount. We can't know which (component, event) pair the firmware
// actually emits on without docs, so we listen to all plausible shapes.
const eventUnsubs: Array<() => void> = [];

// Pattern-match the GATTC notification payload against plausible field
// names (firmware schema undocumented at time of writing).
function extractNotificationFields(attrs: Record<string, unknown>): {
    conn_id?: number;
    chr?: string;
    handle?: number;
    data?: string;
} {
    const conn_id =
        typeof attrs.conn_id === 'number'
            ? attrs.conn_id
            : typeof attrs.id === 'number'
              ? attrs.id
              : undefined;
    const chr =
        typeof attrs.chr === 'string'
            ? attrs.chr
            : typeof attrs.uuid === 'string'
              ? attrs.uuid
              : undefined;
    const handle =
        typeof attrs.handle === 'number' ? attrs.handle : undefined;
    const data =
        typeof attrs.data === 'string'
            ? attrs.data
            : typeof attrs.value === 'string'
              ? attrs.value
              : undefined;
    return {conn_id, chr, handle, data};
}

function notificationKeyFor(chrUuid?: string, handle?: number): string {
    // We don't know the svc UUID from the notification payload alone;
    // match on chr or handle. CharNorm.key uses svc/chr/handle.
    for (const svc of services.value) {
        for (const c of svc.characteristics) {
            const chrMatch =
                chrUuid !== undefined ? c.uuid === chrUuid : true;
            const handleMatch =
                handle !== undefined ? c.handle === handle : true;
            const matched =
                (chrUuid !== undefined || handle !== undefined) &&
                chrMatch &&
                handleMatch;
            if (matched) return c.key;
        }
    }
    return chrUuid
        ? `?/${chrUuid}/${handle ?? ''}`
        : `?/handle:${handle ?? ''}`;
}

function recordNotification(payload: DeviceEventPayload): void {
    if (payload.shellyID !== props.shellyID) return;
    const extracted = extractNotificationFields(payload.attrs);
    if (extracted.conn_id !== undefined && extracted.conn_id !== props.connId) {
        return;
    }
    if (extracted.chr === undefined && extracted.handle === undefined) return;
    const key = notificationKeyFor(extracted.chr, extracted.handle);
    const entry: NotificationEntry = {
        ts: payload.ts ?? Date.now() / 1000,
        data: extracted.data ?? '(no data)',
        raw: payload.attrs
    };
    const existing = notifications[key];
    if (existing) {
        existing.unshift(entry);
        if (existing.length > MAX_NOTIFICATIONS_PER_CHAR) {
            existing.length = MAX_NOTIFICATIONS_PER_CHAR;
        }
    } else {
        notifications[key] = [entry];
    }
}

// Listen to plausible firmware event tuples. We don't know the exact
// (component, event) the firmware emits, so subscribe broadly. Each
// listener filters by conn_id inside recordNotification.
const COMPONENT_KEYS = ['gattc', `gattc:${props.connId}`];
const EVENT_KEYS = ['notify', 'indicate', 'data'];
for (const component of COMPONENT_KEYS) {
    for (const event of EVENT_KEYS) {
        eventUnsubs.push(
            onDeviceEvent(component, event, recordNotification)
        );
    }
}

onBeforeUnmount(() => {
    // Tear down listeners.
    for (const off of eventUnsubs) off();
    eventUnsubs.length = 0;
    // Best-effort: unsubscribe all active notifications on the device so
    // we don't leave orphaned subscriptions consuming firmware resources.
    for (const key of subscribed.value) {
        const [svcUuid, chrUuid] = key.split('/');
        if (!svcUuid || !chrUuid) continue;
        void sendRPC('FLEET_MANAGER', 'bluassist.SetNotify', {
            shellyID: props.shellyID,
            conn_id: props.connId,
            svc: svcUuid,
            chr: chrUuid,
            mode: 'none'
        }).catch(() => {
            // Component is unmounting — nothing to do on error.
        });
    }
});

function setBusy(key: string, on: boolean): void {
    const next = new Set(busyKeys.value);
    if (on) next.add(key);
    else next.delete(key);
    busyKeys.value = next;
}

async function runDiscover(): Promise<void> {
    if (discovering.value) return;
    discovering.value = true;
    error.value = null;
    try {
        const resp = await sendRPC<unknown>(
            'FLEET_MANAGER',
            'bluassist.Discover',
            {shellyID: props.shellyID, conn_id: props.connId}
        );
        services.value = normalizeServices(resp);
    } catch (err) {
        error.value = rpcErrorMessage(err, 'Discover failed');
        services.value = [];
    } finally {
        discovering.value = false;
    }
}

async function readChar(svcUuid: string, chr: CharNorm): Promise<void> {
    setBusy(chr.key, true);
    try {
        const resp = await sendRPC<{data?: string}>(
            'FLEET_MANAGER',
            'bluassist.Read',
            {
                shellyID: props.shellyID,
                conn_id: props.connId,
                svc: svcUuid,
                chr: chr.uuid
            }
        );
        readValues[chr.key] = resp.data ?? '(no data)';
    } catch (err) {
        toast.error(rpcErrorMessage(err, 'Read failed'));
    } finally {
        setBusy(chr.key, false);
    }
}

function openWrite(key: string): void {
    writeOpenKey.value = writeOpenKey.value === key ? null : key;
    writeBuffer.value = '';
}

function cancelWrite(): void {
    writeOpenKey.value = null;
    writeBuffer.value = '';
}

function clearNotifications(key: string): void {
    notifications[key] = [];
}

function isValidHex(s: string): boolean {
    return /^([0-9a-fA-F]{2})+$/.test(s);
}

function formatStreamTs(ts: number): string {
    // Device ts is unix seconds; backend forwards as-is.
    const ms = ts > 1e12 ? ts : ts * 1000;
    try {
        return new Date(ms).toLocaleTimeString();
    } catch {
        return String(ts);
    }
}

async function writeChar(
    svcUuid: string,
    chr: CharNorm,
    data: string
): Promise<void> {
    if (!data) return;
    setBusy(chr.key, true);
    try {
        await sendRPC('FLEET_MANAGER', 'bluassist.Write', {
            shellyID: props.shellyID,
            conn_id: props.connId,
            svc: svcUuid,
            chr: chr.uuid,
            data
        });
        toast.success(`Wrote ${data.length / 2} bytes to ${chr.uuid}`);
        writeOpenKey.value = null;
        writeBuffer.value = '';
    } catch (err) {
        toast.error(rpcErrorMessage(err, 'Write failed'));
    } finally {
        setBusy(chr.key, false);
    }
}

async function toggleNotify(
    svcUuid: string,
    chr: CharNorm,
    on: boolean
): Promise<void> {
    setBusy(chr.key, true);
    try {
        const mode = on
            ? chr.properties.includes('indicate') &&
              !chr.properties.includes('notify')
                ? 'indicate'
                : 'notify'
            : 'none';
        await sendRPC('FLEET_MANAGER', 'bluassist.SetNotify', {
            shellyID: props.shellyID,
            conn_id: props.connId,
            svc: svcUuid,
            chr: chr.uuid,
            mode
        });
        const next = new Set(subscribed.value);
        if (on) next.add(chr.key);
        else next.delete(chr.key);
        subscribed.value = next;
    } catch (err) {
        toast.error(rpcErrorMessage(err, 'SetNotify failed'));
    } finally {
        setBusy(chr.key, false);
    }
}

// Normalize the firmware's discover response. Shape is undocumented; handle
// the common BLE GATT tree and any reasonable variant defensively.
function normalizeServices(resp: unknown): SvcNorm[] {
    const arr = (resp as {services?: unknown})?.services;
    if (!Array.isArray(arr)) return [];
    const out: SvcNorm[] = [];
    for (const svc of arr) {
        const s = svc as Record<string, unknown>;
        const uuid = typeof s.uuid === 'string' ? s.uuid : '?';
        const label = typeof s.label === 'string' ? s.label : undefined;
        const chars = Array.isArray(s.characteristics)
            ? s.characteristics
            : [];
        const characteristics: CharNorm[] = [];
        for (const c of chars) {
            const cc = c as Record<string, unknown>;
            const charUuid = typeof cc.uuid === 'string' ? cc.uuid : '?';
            const handle =
                typeof cc.handle === 'number' ? cc.handle : undefined;
            const props = Array.isArray(cc.properties)
                ? (cc.properties as unknown[]).filter(
                      (p): p is string => typeof p === 'string'
                  )
                : [];
            characteristics.push({
                key: `${uuid}/${charUuid}/${handle ?? ''}`,
                uuid: charUuid,
                handle,
                properties: props,
                canRead: props.includes('read'),
                canWrite:
                    props.includes('write') ||
                    props.includes('write_no_response'),
                canSubscribe:
                    props.includes('notify') || props.includes('indicate')
            });
        }
        out.push({uuid, label, characteristics});
    }
    return out;
}
</script>

<style scoped>
.bag-browser {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-top: var(--space-2);
    border-top: 1px solid var(--color-border-subtle);
}
.bag-bar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}
.bag-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border);
    background: var(--color-surface-2);
    color: var(--color-text-primary);
    cursor: pointer;
    font-size: var(--type-body);
}
.bag-btn--xs {
    padding: 2px var(--space-1-5);
}
.bag-btn--primary {
    background: var(--color-primary);
    color: white;
    border-color: var(--color-primary);
}
.bag-btn--on {
    background: color-mix(in srgb, var(--color-primary) 18%, transparent);
    border-color: var(--color-primary);
    color: var(--color-primary-text);
}
.bag-btn:disabled {
    opacity: 0.6;
    cursor: progress;
}
.bag-count {
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
}
.bag-error {
    background: color-mix(in srgb, var(--color-danger) 12%, transparent);
    color: var(--color-danger-text);
    padding: var(--space-2);
    border-radius: var(--radius-md);
    font-size: var(--type-body);
}
.bag-empty {
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
    padding: var(--space-2);
    text-align: center;
}
.bag-svc {
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    padding: var(--space-2);
}
.bag-svc__head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    cursor: pointer;
    color: var(--color-text-secondary);
    font-size: var(--type-body);
}
.bag-svc__uuid {
    color: var(--color-text-primary);
    font-family: var(--font-mono, monospace);
}
.bag-svc__label {
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
}
.bag-svc__count {
    margin-left: auto;
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
}
.bag-chars {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-top: var(--space-2);
}
.bag-chr {
    background: var(--color-surface-2);
    border-radius: var(--radius-sm);
    padding: var(--space-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}
.bag-chr__head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--type-body);
}
.bag-chr__uuid {
    color: var(--color-text-primary);
    font-family: var(--font-mono, monospace);
}
.bag-chr__props {
    display: flex;
    gap: var(--space-1);
    margin-left: auto;
}
.bag-prop {
    padding: 0 var(--space-1);
    border-radius: var(--radius-xs, 2px);
    background: var(--color-surface-1);
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    text-transform: uppercase;
    letter-spacing: 0.04em;
}
.bag-chr__actions {
    display: flex;
    gap: var(--space-1);
    flex-wrap: wrap;
}
.bag-chr__value {
    background: var(--color-surface-1);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-xs, 2px);
    display: flex;
    gap: var(--space-1);
    align-items: center;
    font-size: var(--type-body);
}
.bag-chr__value-label {
    color: var(--color-text-tertiary);
}
.bag-mono {
    font-family: var(--font-mono, monospace);
    color: var(--color-text-primary);
    word-break: break-all;
}
.bag-chr__write {
    display: flex;
    gap: var(--space-1);
    align-items: center;
}
.bag-chr__stream {
    background: var(--color-surface-1);
    border-radius: var(--radius-xs, 2px);
    padding: var(--space-1) var(--space-2);
    font-size: var(--type-body);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}
.bag-chr__stream-head {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--color-text-tertiary);
}
.bag-chr__stream-head .bag-btn {
    margin-left: auto;
}
.bag-chr__stream-list {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 8rem;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
}
.bag-chr__stream-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}
.bag-chr__stream-ts {
    color: var(--color-text-tertiary);
    font-variant-numeric: tabular-nums;
}
.bag-input {
    flex: 1;
    background: var(--color-surface-1);
    border: 1px solid var(--color-border);
    color: var(--color-text-primary);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-xs, 2px);
    font-family: var(--font-mono, monospace);
    font-size: var(--type-body);
}
.bag-input--invalid {
    border-color: var(--color-danger);
}
</style>
