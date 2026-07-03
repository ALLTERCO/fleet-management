<template>
    <div class="bac-panel">
        <header class="bac-bar">
            <span class="bac-title">
                GATT connections
                <span class="bac-pool">{{ inUse }} / {{ capacity }}</span>
            </span>
            <button
                type="button"
                class="bac-btn bac-btn--ghost"
                :disabled="refreshing"
                @click="refresh"
            >
                <i
                    :class="
                        refreshing
                            ? 'fas fa-spinner fa-spin'
                            : 'fas fa-arrows-rotate'
                    "
                />
                Refresh
            </button>
            <form class="bac-connect-form" @submit.prevent="manualConnect">
                <input
                    v-model.trim="manualAddr"
                    type="text"
                    placeholder="aa:bb:cc:dd:ee:ff[,N]"
                    class="bac-input"
                    :disabled="connecting"
                />
                <button
                    type="submit"
                    class="bac-btn bac-btn--primary"
                    :disabled="connecting || !manualAddr"
                >
                    <i
                        :class="
                            connecting ? 'fas fa-spinner fa-spin' : 'fas fa-plug'
                        "
                    />
                    Connect
                </button>
            </form>
        </header>

        <div v-if="error" class="bac-error">
            <i class="fas fa-triangle-exclamation" /> {{ error }}
        </div>

        <div class="bac-slots">
            <article
                v-for="slot in slots"
                :key="slot.conn_id"
                class="bac-slot"
                :class="{'bac-slot--selected': selectedConnId === slot.conn_id}"
            >
                <header class="bac-slot__head">
                    <div class="bac-slot__title">
                        <span class="bac-slot__addr">{{ slot.addr }}</span>
                        <span class="bac-slot__id">conn_id {{ slot.conn_id }}</span>
                    </div>
                    <div class="bac-slot__actions">
                        <button
                            type="button"
                            class="bac-btn bac-btn--ghost"
                            @click="selectSlot(slot.conn_id)"
                        >
                            <i
                                :class="
                                    selectedConnId === slot.conn_id
                                        ? 'fas fa-chevron-up'
                                        : 'fas fa-chevron-down'
                                "
                            />
                            {{
                                selectedConnId === slot.conn_id
                                    ? 'Hide'
                                    : 'Browse'
                            }}
                        </button>
                        <button
                            type="button"
                            class="bac-btn bac-btn--danger"
                            :disabled="disconnectingIds.has(slot.conn_id)"
                            @click="disconnect(slot.conn_id)"
                        >
                            <i
                                :class="
                                    disconnectingIds.has(slot.conn_id)
                                        ? 'fas fa-spinner fa-spin'
                                        : 'fas fa-link-slash'
                                "
                            />
                            Disconnect
                        </button>
                    </div>
                </header>
                <dl class="bac-slot__meta">
                    <div>
                        <dt>Opened</dt>
                        <dd>{{ formatTime(slot.openedAt) }}</dd>
                    </div>
                    <div v-if="slot.mtu">
                        <dt>MTU</dt>
                        <dd>{{ slot.mtu }}</dd>
                    </div>
                    <div v-if="slot.discoveredAt">
                        <dt>Discovered</dt>
                        <dd>{{ formatTime(slot.discoveredAt) }}</dd>
                    </div>
                </dl>
                <BluAssistGattBrowser
                    v-if="selectedConnId === slot.conn_id"
                    :shelly-i-d="shellyID"
                    :conn-id="slot.conn_id"
                    :addr="slot.addr"
                />
            </article>
            <article
                v-for="i in emptySlotCount"
                :key="`empty-${i}`"
                class="bac-slot bac-slot--empty"
            >
                <i class="fas fa-circle-dashed bac-slot__placeholder" />
                <span class="bac-slot__placeholder-text">Free slot</span>
            </article>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref, watch} from 'vue';
import {useBluAssistRefresh} from '@/composables/useBluAssistRefresh';
import {rpcErrorMessage} from '@/helpers/rpcError';
import {useToastStore} from '@/stores/toast';
import {sendRPC} from '@/tools/websocket';
import BluAssistGattBrowser from './BluAssistGattBrowser.vue';

const ADDR_RE = /^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){5}(,[0-9])?$/;

interface ConnectionEntry {
    conn_id: number;
    addr: string;
    openedAt: string;
    discoveredAt?: string;
    mtu?: number;
}

interface ConnectionListResponse {
    slots: ConnectionEntry[];
    capacity: number;
    inUse: number;
}

const props = defineProps<{shellyID: string}>();
const toast = useToastStore();
const {token: refreshToken} = useBluAssistRefresh(props.shellyID);

const slots = ref<ConnectionEntry[]>([]);
const capacity = ref(5);
const inUse = ref(0);
const refreshing = ref(false);
const connecting = ref(false);
const disconnectingIds = ref(new Set<number>());
const selectedConnId = ref<number | null>(null);
const manualAddr = ref('');
const error = ref<string | null>(null);

const emptySlotCount = computed(() =>
    Math.max(0, capacity.value - slots.value.length)
);

let pollTimer: ReturnType<typeof setTimeout> | null = null;

async function refresh(): Promise<void> {
    if (refreshing.value) return;
    refreshing.value = true;
    error.value = null;
    try {
        const resp = await sendRPC<ConnectionListResponse>(
            'FLEET_MANAGER',
            'bluassist.Connection.List',
            {shellyID: props.shellyID}
        );
        slots.value = resp.slots;
        capacity.value = resp.capacity;
        inUse.value = resp.inUse;
        if (
            selectedConnId.value !== null &&
            !resp.slots.some((s) => s.conn_id === selectedConnId.value)
        ) {
            selectedConnId.value = null;
        }
    } catch (err) {
        error.value = rpcErrorMessage(err, 'Connection list failed');
    } finally {
        refreshing.value = false;
    }
}

async function manualConnect(): Promise<void> {
    const addr = manualAddr.value;
    if (!addr || connecting.value) return;
    if (!ADDR_RE.test(addr)) {
        error.value = 'Invalid MAC. Use aa:bb:cc:dd:ee:ff or aa:bb:cc:dd:ee:ff,N';
        return;
    }
    connecting.value = true;
    error.value = null;
    try {
        await sendRPC('FLEET_MANAGER', 'bluassist.Connect', {
            shellyID: props.shellyID,
            addr
        });
        manualAddr.value = '';
        toast.success(`Connected to ${addr}`);
        await refresh();
    } catch (err) {
        error.value = rpcErrorMessage(err, 'Connect failed');
    } finally {
        connecting.value = false;
    }
}

async function disconnect(conn_id: number): Promise<void> {
    if (disconnectingIds.value.has(conn_id)) return;
    disconnectingIds.value = new Set([...disconnectingIds.value, conn_id]);
    try {
        await sendRPC('FLEET_MANAGER', 'bluassist.Disconnect', {
            shellyID: props.shellyID,
            conn_id
        });
        if (selectedConnId.value === conn_id) selectedConnId.value = null;
        toast.success(`Disconnected ${conn_id}`);
        await refresh();
    } catch (err) {
        toast.error(rpcErrorMessage(err, 'Disconnect failed'));
    } finally {
        const next = new Set(disconnectingIds.value);
        next.delete(conn_id);
        disconnectingIds.value = next;
    }
}

function selectSlot(conn_id: number): void {
    selectedConnId.value = selectedConnId.value === conn_id ? null : conn_id;
}

function formatTime(iso: string): string {
    try {
        return new Date(iso).toLocaleTimeString();
    } catch {
        return iso;
    }
}

function schedulePoll(): void {
    stopPoll();
    pollTimer = setTimeout(async () => {
        await refresh();
        schedulePoll();
    }, 5000);
}

function stopPoll(): void {
    if (pollTimer !== null) {
        clearTimeout(pollTimer);
        pollTimer = null;
    }
}

onMounted(() => {
    void refresh().then(schedulePoll);
});

watch(
    () => props.shellyID,
    () => {
        slots.value = [];
        selectedConnId.value = null;
        void refresh();
    }
);

// External nudge: scan panel bumps this when it Connects so we don't wait
// for the 5 s poll.
watch(refreshToken, () => {
    void refresh();
});

onBeforeUnmount(stopPoll);
</script>

<style scoped>
.bac-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}
.bac-bar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
}
.bac-title {
    color: var(--color-text-primary);
    font-weight: var(--font-medium);
    font-size: var(--type-body);
}
.bac-pool {
    color: var(--color-text-tertiary);
    font-variant-numeric: tabular-nums;
    margin-left: var(--space-1);
    font-size: var(--type-body);
}
.bac-connect-form {
    display: inline-flex;
    gap: var(--space-1);
    margin-left: auto;
}
.bac-input {
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    color: var(--color-text-primary);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono, monospace);
    font-size: var(--type-body);
    width: 14rem;
}
.bac-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    cursor: pointer;
    font-size: var(--type-body);
}
.bac-btn--primary {
    background: var(--color-primary);
    border-color: var(--color-primary);
    color: white;
}
.bac-btn--danger {
    color: var(--color-danger-text);
    border-color: var(--color-danger);
}
.bac-btn--ghost {
    background: transparent;
}
.bac-btn:disabled {
    opacity: 0.6;
    cursor: progress;
}
.bac-error {
    background: color-mix(in srgb, var(--color-danger) 12%, transparent);
    color: var(--color-danger-text);
    padding: var(--space-2);
    border-radius: var(--radius-md);
    font-size: var(--type-body);
}
.bac-slots {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.bac-slot {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    border-left: 3px solid var(--color-success);
}
.bac-slot--selected {
    border-color: var(--color-primary);
}
.bac-slot--empty {
    border-left-color: var(--color-border);
    border-style: dashed;
    align-items: center;
    flex-direction: row;
    justify-content: center;
    color: var(--color-text-tertiary);
    padding: var(--space-2);
}
.bac-slot__placeholder {
    margin-right: var(--space-1);
    opacity: 0.5;
}
.bac-slot__placeholder-text {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
.bac-slot__head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--space-2);
}
.bac-slot__title {
    display: flex;
    flex-direction: column;
    gap: 2px;
}
.bac-slot__addr {
    color: var(--color-text-primary);
    font-family: var(--font-mono, monospace);
    font-size: var(--type-body);
}
.bac-slot__id {
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
}
.bac-slot__actions {
    display: flex;
    gap: var(--space-1);
}
.bac-slot__meta {
    display: flex;
    gap: var(--space-3);
    margin: 0;
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
}
.bac-slot__meta dt {
    color: var(--color-text-tertiary);
    margin-bottom: 2px;
}
.bac-slot__meta dd {
    color: var(--color-text-secondary);
    margin: 0;
    font-variant-numeric: tabular-nums;
}
</style>
