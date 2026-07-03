<template>
    <div class="do-detail">
        <!-- Online: render entity template from registry -->
        <div v-if="device?.online && entityTemplate" class="do-detail-template">
            <component
                :is="entityTemplate"
                :status="status"
                :settings="settings"
                :can-execute="canExecute"
                v-bind="templateExtraProps"
                v-on="templateListeners"
            />
        </div>

        <!-- Offline state -->
        <div v-else-if="!device?.online" class="do-detail-offline">
            <i class="fas fa-wifi-slash do-detail-offline-icon" />
            <span>Device is offline</span>
        </div>

        <!-- Loading / no template -->
        <div v-else-if="device?.loading" class="do-detail-offline">
            <Spinner size="sm" />
            <span>Loading…</span>
        </div>

        <div v-else class="do-detail-offline">
            <i class="fas fa-puzzle-piece do-detail-offline-icon" />
            <span>No detail view for this component type</span>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import Spinner from '@/components/core/Spinner.vue';
import {
    getEntityActions,
    getEntityExtraProps,
    getEntityTemplate
} from '@/config/entity-registry';
import {useEntityStore} from '@/stores/entities';
import {useToastStore} from '@/stores/toast';
import type {entity_t} from '@/types';

const props = defineProps<{
    entity: entity_t;
    device: any;
    status: any;
    settings: any;
    canExecute: boolean;
}>();

const entityStore = useEntityStore();
const toastStore = useToastStore();

const deviceProfile = computed(() => props.entity.properties.deviceProfile);

const entityTemplate = computed(() =>
    getEntityTemplate(props.entity.type, deviceProfile.value)
);

/** Extra props — resolved with profile override, plus device-level data for profiles */
const templateExtraProps = computed(() => {
    const fn = getEntityExtraProps(props.entity.type, deviceProfile.value);
    const base = fn?.(props.entity) ?? {};

    // Profile-specific device-level data injection
    if (deviceProfile.value === 'dali' && props.device) {
        return {
            ...base,
            daliStatus: props.device.status?.dali,
            daliConfig: props.device.settings?.dali
        };
    }

    // Camera: inject storage status + camera zones from device
    if (props.entity.type === 'camera' && props.device) {
        const zones: Array<{
            id: number;
            motion?: boolean;
            config?: Record<string, any>;
        }> = [];
        const st = props.device.status ?? {};
        const cfg = props.device.settings ?? {};
        for (const key of Object.keys(st)) {
            if (key.startsWith('camerazone:')) {
                const zoneId = Number(key.split(':')[1]);
                if (!Number.isNaN(zoneId)) {
                    zones.push({id: zoneId, ...st[key], config: cfg[key]});
                }
            }
        }
        return {
            ...base,
            storageStatus: st['storage:0'],
            cameraZones: zones
        };
    }

    return base;
});

async function dispatchAction(call: {
    kind: 'entityAction';
    action: string;
    params?: Record<string, any>;
}) {
    try {
        await entityStore.invokeAction(
            props.entity.id,
            call.action,
            call.params
        );
    } catch (e: any) {
        const msg = e?.message || String(e);
        if (msg.includes('timeout')) {
            toastStore.error(`${call.action} timed out — device may be busy`);
        } else {
            toastStore.error(`${call.action} failed: ${msg}`);
        }
    }
}

const templateListeners = computed(() => {
    const actions = getEntityActions(props.entity.type, deviceProfile.value);
    if (!actions) return {};

    const listeners: Record<string, (...args: any[]) => void> = {};
    for (const [eventName, handler] of Object.entries(actions)) {
        listeners[eventName] = (...args: any[]) => {
            const call = handler(
                props.entity.properties.id,
                props.status,
                ...args
            );
            void dispatchAction(call);
        };
    }
    return listeners;
});
</script>
