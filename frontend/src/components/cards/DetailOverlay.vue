<template>
    <Teleport to="body">
        <Transition name="detail-overlay" @after-leave="$emit('after-leave')">
            <div v-if="visible" ref="backdropRef" class="do-backdrop" :class="{ open: visible }" tabindex="-1" @click.self="close" @keydown="handleKeydown">
                <div class="do-panel" :data-type="normalizedType" role="dialog" aria-modal="true" :aria-labelledby="titleId">
                    <!-- Accent topbar -->
                    <div class="do-accent" />

                    <!-- Header -->
                    <div class="do-header">
                        <div class="do-header-left">
                            <div class="do-icon">
                                <i :class="icon" />
                            </div>
                            <div class="do-header-info">
                                <span :id="titleId" class="do-name">{{ entity.name }}</span>
                                <div class="do-device-row">
                                    <span class="do-device">{{ entity.source }}</span>
                                    <span v-if="isSleeping" class="do-status do-status--sleep">
                                        <i class="fas fa-moon" /> Sleeping
                                        <span v-if="lastSeenText" class="do-last-seen" :class="{'do-last-seen--stale': isStale}">· {{ lastSeenText }}</span>
                                    </span>
                                    <span v-else-if="isOffline" class="do-status do-status--off">
                                        <i class="fas fa-circle-xmark" /> Offline
                                        <span v-if="lastSeenText" class="do-last-seen">· {{ lastSeenText }}</span>
                                    </span>
                                    <span v-else class="do-status do-status--on">
                                        <i class="fas fa-circle" /> Online
                                    </span>
                                </div>
                            </div>
                        </div>
                        <button type="button" class="do-close" @click="close" aria-label="Close">
                            <i class="fas fa-xmark" />
                        </button>
                    </div>

                    <!-- Size picker (write-only). Hidden when the entity allows
                         only one size — nothing to pick. -->
                    <SizePicker
                        v-if="canResize && allowedSizes.length > 1"
                        :size="activeSize"
                        :allowed-sizes="allowedSizes"
                        @change="$emit('update:size', $event)"
                    />

                    <!-- Tab bar -->
                    <div class="do-tabs">
                        <button
                            v-for="tab in tabs"
                            :key="tab.id"
                            type="button"
                            class="do-tab"
                            :class="{'do-tab--active': activeTab === tab.id}"
                            @click="activeTab = tab.id"
                        >
                            <i :class="tab.icon" />
                            {{ tab.label }}
                        </button>
                    </div>

                    <!-- Tab content -->
                    <div class="do-content">
                        <Transition name="tab-fade">
                            <!-- Info tab: entity template -->
                            <div v-if="activeTab === 'info'" key="info" class="do-tab-panel">
                                <DetailContent
                                    :entity="entity"
                                    :device="device"
                                    :status="entityStatus"
                                    :settings="entitySettings"
                                    :can-execute="canExecute"
                                />
                            </div>

                            <!-- Charts tab: placeholder -->
                            <div v-else-if="activeTab === 'charts'" key="charts" class="do-tab-panel do-tab-panel--center">
                                <i class="fas fa-chart-line do-placeholder-icon" />
                                <span class="do-placeholder-text">Charts coming soon</span>
                            </div>

                            <!-- Debug tab: raw JSON -->
                            <div v-else-if="activeTab === 'debug'" key="debug" class="do-tab-panel">
                                <div class="do-debug-section">
                                    <span class="do-debug-label">Entity</span>
                                    <pre class="do-debug-json">{{ JSON.stringify(entity, null, 2) }}</pre>
                                </div>
                                <div class="do-debug-section">
                                    <span class="do-debug-label">Status</span>
                                    <pre class="do-debug-json">{{ JSON.stringify(entityStatus, null, 2) }}</pre>
                                </div>
                                <div class="do-debug-section">
                                    <span class="do-debug-label">Settings</span>
                                    <pre class="do-debug-json">{{ JSON.stringify(entitySettings, null, 2) }}</pre>
                                </div>
                            </div>
                        </Transition>
                    </div>
                </div>
            </div>
        </Transition>
    </Teleport>
</template>

<script setup lang="ts">
import {computed, nextTick, onUnmounted, ref, toRef, watch} from 'vue';
import {useFocusTrap} from '@/composables/useFocusTrap';
import {getEntityIcon} from '@/config/entity-registry';
import {normalizeCardType} from '@/helpers/card-accents';
import {
    allowedSizesForEntity,
    clampSizeForEntity
} from '@/helpers/widgetCatalog';
import {useAuthStore} from '@/stores/auth';
import {useDevicesStore} from '@/stores/devices';
import {useToastStore} from '@/stores/toast';
import * as ws from '@/tools/websocket';
import type {entity_t} from '@/types';
import DetailContent from './DetailContent.vue';
import SizePicker from './SizePicker.vue';

/** Map entity type to the key used in device.status / device.settings */
const STATUS_KEY_ALIAS: Record<string, string> = {
    roller: 'cover'
};

/** Singleton entity types — status key is just the type, no :N suffix */
const SINGLETON_TYPES = new Set(['media', 'ui']);

const props = defineProps<{
    canResize: boolean;
    entity: entity_t;
    size: '1x1' | '2x1' | '2x2';
    visible: boolean;
}>();

const emit = defineEmits<{
    close: [];
    'update:size': [size: '1x1' | '2x1' | '2x2'];
    'after-leave': [];
}>();

const deviceStore = useDevicesStore();
const authStore = useAuthStore();
const toastStore = useToastStore();
const backdropRef = ref<HTMLElement | null>(null);
const titleId = `do-title-${Math.random().toString(36).slice(2, 9)}`;
const {handleKeydown} = useFocusTrap(backdropRef, toRef(props, 'visible'), () =>
    close()
);

const device = computed(() => deviceStore.devices[props.entity.source]);
const canExecute = computed(() =>
    authStore.canExecuteDevice(props.entity.source)
);

const normalizedType = computed(() => normalizeCardType(props.entity.type));
const icon = computed(() =>
    getEntityIcon(props.entity.type, props.entity.properties)
);
// Same per-entity cap the dashboard render enforces, so the picker can't offer a
// size that clamps back (e.g. 2x2 on a single-button BLU remote or a battery).
const allowedSizes = computed(() => allowedSizesForEntity(props.entity));
// A legacy tile can hold an over-cap size; clamp it so the picker highlights the
// size the dashboard actually renders, not a filtered-out option.
const activeSize = computed(() => clampSizeForEntity(props.size, props.entity));

const isSleeping = computed(() => !!device.value?.sleeping);
const isOffline = computed(() => !device.value?.online && !isSleeping.value);
const lastSeenText = computed(() => {
    const s = device.value?.status;
    const ts = s?.ts ?? s?.sys?.unixtime ?? 0;
    if (!ts) return null;
    const diffS = Math.floor(Date.now() / 1000 - ts);
    if (diffS < 60) return 'just now';
    if (diffS < 3600) return `${Math.floor(diffS / 60)}m ago`;
    if (diffS < 86400) return `${Math.floor(diffS / 3600)}h ago`;
    return `${Math.floor(diffS / 86400)}d ago`;
});
const isStale = computed(() => {
    const s = device.value?.status;
    const ts = s?.ts ?? s?.sys?.unixtime ?? 0;
    if (!ts) return false;
    return Math.floor(Date.now() / 1000 - ts) > 7200;
});

/** Resolve the status/settings key — handles aliases (roller→cover) and singletons (media) */
function statusKey(e: entity_t): string {
    const type = STATUS_KEY_ALIAS[e.type] ?? e.type;
    if (SINGLETON_TYPES.has(e.type)) return type;
    return `${type}:${e.properties.id}`;
}

const entityStatus = computed(() => {
    const d = device.value;
    if (!d?.status) return undefined;
    const e = props.entity;
    if (e.type === 'temperature' && e.properties.embeddedIn) {
        return d.status[e.properties.embeddedIn]?.temperature;
    }
    return d.status[statusKey(e)];
});

const entitySettings = computed(() => {
    const d = device.value;
    if (!d?.settings) return undefined;
    const e = props.entity;
    if (e.type === 'temperature' && e.properties.embeddedIn) {
        return d.settings[e.properties.embeddedIn]?.temperature;
    }
    return d.settings[statusKey(e)];
});

const tabs = [
    {id: 'info', label: 'Info', icon: 'fas fa-circle-info'},
    {id: 'charts', label: 'Charts', icon: 'fas fa-chart-line'},
    {id: 'debug', label: 'Debug', icon: 'fas fa-bug'}
];

const activeTab = ref('info');

// Body lock is owned by useFocusTrap → helpers/modalStack.
// Here we only freeze the page-level scroll container so the panel sits over
// a fixed snapshot of the page rather than a live-scrolling list.
let scrollOwnerPrevOverflow: string | null = null;

function lockScrollOwner() {
    const owner = document.querySelector(
        '[data-scroll-owner="page"]'
    ) as HTMLElement | null;
    if (!owner) return;
    scrollOwnerPrevOverflow = owner.style.overflow;
    owner.style.overflow = 'hidden';
}

function unlockScrollOwner() {
    const owner = document.querySelector(
        '[data-scroll-owner="page"]'
    ) as HTMLElement | null;
    if (!owner || scrollOwnerPrevOverflow === null) return;
    owner.style.overflow = scrollOwnerPrevOverflow;
    scrollOwnerPrevOverflow = null;
}

// Reset tab when opening, focus backdrop for keyboard events, lock scroll
watch(
    () => props.visible,
    (v) => {
        if (v) {
            activeTab.value = 'info';
            lockScrollOwner();
            nextTick(() => backdropRef.value?.focus());
            // Fetch full device data (settings may be missing from list view)
            ws.sendRPC('FLEET_MANAGER', 'device.Get', {
                shellyID: props.entity.source
            })
                .then((fullDevice: any) => {
                    if (fullDevice) deviceStore.handleNewDevice(fullDevice);
                })
                .catch(() => {
                    toastStore.error('Failed to load device details');
                });
        } else {
            unlockScrollOwner();
        }
    }
);

function close() {
    emit('close');
}

onUnmounted(() => {
    unlockScrollOwner();
});
</script>
