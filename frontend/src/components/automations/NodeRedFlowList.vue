<template>
    <div class="nrf">
        <EmptyBlock
            v-if="!canManageAutomations"
            title="You don't have access to automations"
            description="Ask an administrator for the automation permission to see and switch Node-RED flows."
        >
            <template #icon><i class="fas fa-lock" /></template>
        </EmptyBlock>

        <template v-else>
            <Notification v-if="unavailableNote" type="warning">
                {{ unavailableNote }}
            </Notification>
            <Notification v-else-if="loadError" type="warning">
                <div class="nrf__notice">
                    <span>{{ loadError.message }}</span>
                    <Button v-if="loadError.canRetry" type="blue-hollow" size="sm" @click="load">Try again</Button>
                </div>
            </Notification>

            <div v-if="loading && flows.length === 0" class="nrf__state">
                <Spinner />
                <span>Loading flows</span>
            </div>

            <EmptyBlock
                v-else-if="flows.length === 0 && !loadError && !unavailableNote"
                title="No flows yet"
                description="Build your first flow in the Node-RED editor. It shows up here once it is deployed."
            >
                <template #icon><i class="fas fa-diagram-project" /></template>
                <template #action>
                    <Button type="blue" size="sm" @click="emit('open', null)">
                        Open editor
                    </Button>
                </template>
            </EmptyBlock>

            <ul v-else-if="flows.length > 0" class="nrf__list" aria-label="Node-RED flows">
                <li v-for="flow in flows" :key="flow.id" class="nrf-row">
                    <div class="nrf-row__main">
                        <div class="nrf-row__title">
                            <i class="fas fa-diagram-project nrf-row__icon" />
                            <b class="nrf-row__name">{{ flow.label }}</b>
                            <span
                                class="nrf-chip"
                                :class="flow.enabled ? 'nrf-chip--on' : 'nrf-chip--off'"
                            >
                                {{ flow.enabled ? 'On' : 'Off' }}
                            </span>
                        </div>

                        <div class="nrf-row__meta">
                            <span>{{ flow.nodeCount }} {{ flow.nodeCount === 1 ? 'node' : 'nodes' }}</span>
                            <span class="nrf-row__sep">·</span>
                            <span>{{ lastRunText(flow.id) }}</span>
                        </div>

                        <ul v-if="errorsOf(flow.id).length" class="nrf-errors" aria-label="Recent errors">
                            <li v-for="(err, index) in errorsOf(flow.id)" :key="index" class="nrf-errors__item">
                                <i class="fas fa-triangle-exclamation" />
                                <span class="nrf-errors__msg">{{ err.message }}</span>
                                <small v-if="err.at !== null">{{ formatRelative(err.at) }}</small>
                            </li>
                        </ul>

                        <div v-if="flow.usesFleetManager" class="nrf-devices">
                            <button
                                type="button"
                                class="nrf-devices__toggle"
                                :aria-expanded="expanded.has(flow.id)"
                                @click="toggleDevices(flow.id)"
                            >
                                <i :class="expanded.has(flow.id) ? 'fas fa-chevron-down' : 'fas fa-chevron-right'" />
                                Devices used
                            </button>
                            <template v-if="expanded.has(flow.id)">
                                <span v-if="flow.deviceIds.length === 0" class="nrf-devices__note">
                                    No specific devices. It may act on groups, places or the whole fleet.
                                </span>
                                <div v-else class="nrf-devices__chips">
                                    <button
                                        v-for="id in flow.deviceIds"
                                        :key="id"
                                        type="button"
                                        class="nrf-device"
                                        @click="openDevice(id)"
                                    >
                                        <i class="fas fa-microchip" />
                                        {{ deviceLabel(id) }}
                                    </button>
                                </div>
                            </template>
                        </div>
                    </div>

                    <div class="nrf-row__actions">
                        <Switch
                            :model-value="flow.enabled"
                            :busy="flow.saving"
                            :label="`${flow.enabled ? 'Turn off' : 'Turn on'} ${flow.label}`"
                            @update:model-value="toggleFlow(flow.id, $event)"
                        />
                        <Button
                            type="blue-hollow"
                            size="sm"
                            :title="`Open ${flow.label} in the editor`"
                            @click="emit('open', flow.id)"
                        >
                            Open in editor
                        </Button>
                    </div>
                </li>
            </ul>
        </template>
    </div>
</template>

<script setup lang="ts">
import {onMounted, ref} from 'vue';
import Button from '@/components/core/Button.vue';
import EmptyBlock from '@/components/core/EmptyBlock.vue';
import Notification from '@/components/core/Notification.vue';
import Spinner from '@/components/core/Spinner.vue';
import Switch from '@/components/core/Switch.vue';
import {useAutomationFlows} from '@/composables/useAutomationFlows';
import {usePermissions} from '@/composables/usePermissions';
import type {FlowActivityError} from '@/helpers/automationActivity';
import {DeviceBoard} from '@/helpers/components';
import {getDeviceName} from '@/helpers/device';
import {formatRelative} from '@/helpers/format';
import {useDevicesStore} from '@/stores/devices';
import {useRightSideMenuStore} from '@/stores/right-side';
import {useToastStore} from '@/stores/toast';

const emit = defineEmits<{open: [flowId: string | null]}>();

const {
    flows,
    loading,
    loadError,
    unavailableNote,
    activity,
    activitySupported,
    load,
    setEnabled
} = useAutomationFlows();
const {canManageAutomations} = usePermissions();
const toastStore = useToastStore();
const devicesStore = useDevicesStore();
const rightSideStore = useRightSideMenuStore();
const expanded = ref(new Set<string>());

defineExpose({reload: load});

// Every automation RPC needs this permission; skip calls the server refuses.
onMounted(() => {
    if (canManageAutomations.value) void load();
});

function lastRunText(flowId: string): string {
    const lastRunAt = activity.value.get(flowId)?.lastRunAt ?? null;
    if (!activitySupported.value || lastRunAt === null) return 'No activity yet';
    return `Last run ${formatRelative(lastRunAt)}`;
}

function errorsOf(flowId: string): FlowActivityError[] {
    return activity.value.get(flowId)?.recentErrors ?? [];
}

function deviceLabel(shellyID: string): string {
    const device = devicesStore.devices[shellyID];
    return device ? getDeviceName(device.info, shellyID) : shellyID;
}

function toggleDevices(flowId: string): void {
    const next = new Set(expanded.value);
    if (next.has(flowId)) next.delete(flowId);
    else next.add(flowId);
    expanded.value = next;
}

async function toggleFlow(flowId: string, enabled: boolean): Promise<void> {
    const failure = await setEnabled(flowId, enabled);
    if (failure) toastStore.error(failure);
}

function openDevice(shellyID: string): void {
    void rightSideStore.showInspector(DeviceBoard, {shellyID});
}
</script>

<style scoped>
.nrf {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
}

.nrf__notice {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
}

.nrf__state {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-12) var(--space-4);
    color: var(--color-text-secondary);
}

.nrf__list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
}

.nrf-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--color-border-muted);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
}

.nrf-row__main {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: var(--space-1-5);
    min-width: 0;
}

.nrf-row__title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
}

.nrf-row__icon {
    color: var(--color-text-tertiary);
}

.nrf-row__name {
    overflow: hidden;
    color: var(--color-text-primary);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.nrf-row__meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}

.nrf-row__sep {
    opacity: 0.6;
}

.nrf-row__actions {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: var(--space-3);
}

.nrf-chip {
    flex: 0 0 auto;
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-full);
    font-size: var(--type-caption);
}

.nrf-chip--on {
    background: var(--color-success-subtle);
    color: var(--color-success-text);
}

.nrf-chip--off {
    background: var(--color-surface-3);
    color: var(--color-text-secondary);
}

.nrf-errors {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
}

.nrf-errors__item {
    display: flex;
    align-items: baseline;
    gap: var(--space-1-5);
    color: var(--color-danger-text);
    font-size: var(--type-caption);
}

.nrf-errors__msg {
    overflow-wrap: anywhere;
}

.nrf-errors__item small {
    color: var(--color-text-tertiary);
    white-space: nowrap;
}

.nrf-devices {
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
}

.nrf-devices__toggle {
    display: inline-flex;
    align-self: flex-start;
    align-items: center;
    gap: var(--space-1-5);
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-primary-text);
    font-size: var(--type-caption);
    cursor: pointer;
}

.nrf-devices__note {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}

.nrf-devices__chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1-5);
}

.nrf-device {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    padding: var(--space-1) var(--space-2-5);
    border: 1px solid var(--color-border-muted);
    border-radius: var(--radius-full);
    background: var(--color-surface-2);
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
    cursor: pointer;
}

.nrf-device:hover {
    background: var(--color-surface-3);
    color: var(--color-text-primary);
}

/* Stack actions under the text on small screens. */
@media (max-width: 767px) {
    .nrf-row {
        flex-direction: column;
        align-items: stretch;
    }

    .nrf-row__actions {
        justify-content: space-between;
    }
}
</style>
