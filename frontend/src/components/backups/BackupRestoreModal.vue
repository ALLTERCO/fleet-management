<template>
    <Modal :visible="visible" :wide="true" @close="emit('close')">
        <template #title>
            <div class="flex items-center gap-2">
                <i class="fas fa-upload"></i>
                <span>Restore Backup: {{ backup?.name }}</span>
            </div>
        </template>

        <div v-if="backup" class="flex flex-col gap-4">
            <!-- Backup Info -->
            <div
                class="flex items-center gap-6 bg-[var(--color-surface-2)] rounded-lg p-3 text-sm"
            >
                <div>
                    <span class="text-[var(--color-text-tertiary)]">Model:</span>
                    {{ backup.model }}
                </div>
                <div>
                    <span class="text-[var(--color-text-tertiary)]">FW:</span>
                    {{ backup.fwVersion }}
                </div>
                <div>
                    <span class="text-[var(--color-text-tertiary)]">Created:</span>
                    {{ new Date(backup.createdAt).toLocaleString() }}
                </div>
            </div>

            <!-- Device selector header -->
            <div class="flex items-center justify-between">
                <div class="text-sm text-[var(--color-text-tertiary)]">
                    Select target devices
                    <span class="text-[var(--color-text-disabled)]"
                        >({{ compatibleDevices.length }} compatible,
                        same model, FW &ge; 1.8.0)</span
                    >
                </div>
                <div class="flex gap-2">
                    <Button
                        type="blue"
                        size="sm"
                        narrow
                        @click="selectAll"
                        >Select All</Button
                    >
                    <Button
                        type="red"
                        size="sm"
                        narrow
                        @click="clearSelection"
                        >Clear</Button
                    >
                </div>
            </div>

            <!-- Device list table -->
            <div
                class="max-h-[40vh] overflow-auto rounded-lg border border-[var(--color-border-default)]"
            >
                <table
                    v-if="deviceList.length > 0"
                    class="w-full text-sm"
                >
                    <thead class="sticky top-0 bg-[var(--color-surface-2)]">
                        <tr
                            class="text-left text-[var(--color-text-tertiary)] border-b border-[var(--color-border-default)]"
                        >
                            <th scope="col" class="py-2 px-3 w-8"></th>
                            <th scope="col" class="py-2 px-3">Device</th>
                            <th scope="col" class="py-2 px-3">Shelly ID</th>
                            <th scope="col" class="py-2 px-3">Firmware</th>
                            <th
                                v-if="running"
                                scope="col"
                                class="py-2 px-3 w-44"
                            >
                                Status
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="device in deviceList"
                            :key="device.shellyID"
                            class="border-b border-[var(--color-border-default)] hover:bg-[var(--color-surface-3)] cursor-pointer"
                            @click="toggleDevice(device.shellyID)"
                        >
                            <td class="py-2 px-3">
                                <input
                                    type="checkbox"
                                    class="w-4 h-4"
                                    :checked="
                                        selectedDevices.has(
                                            device.shellyID,
                                        )
                                    "
                                    :disabled="running"
                                    :aria-label="`Select ${device.name}`"
                                    @click.stop
                                    @change="
                                        toggleDevice(device.shellyID)
                                    "
                                />
                            </td>
                            <td class="py-2 px-3 font-medium">
                                {{ device.name }}
                            </td>
                            <td
                                class="py-2 px-3 text-[var(--color-text-tertiary)] text-xs font-mono"
                            >
                                {{ device.shellyID }}
                            </td>
                            <td class="py-2 px-3 text-[var(--color-text-tertiary)]">
                                {{ device.ver }}
                            </td>
                            <td v-if="running" class="py-2 px-3">
                                <span
                                    v-if="
                                        progress[device.shellyID]
                                            ?.status === 'restoring'
                                    "
                                    class="text-[var(--color-primary-text)]"
                                >
                                    <div
                                        class="flex items-center gap-2 mb-1"
                                    >
                                        <Spinner size="xs" />
                                        <span class="text-xs"
                                            >{{
                                                progress[
                                                    device.shellyID
                                                ]?.percent || 0
                                            }}%</span
                                        >
                                    </div>
                                    <div
                                        class="w-full bg-[var(--color-surface-3)] rounded-full h-1.5"
                                    >
                                        <div
                                            class="bg-[var(--color-primary)] h-1.5 rounded-full transition-all duration-300"
                                            :style="{
                                                width:
                                                    (progress[
                                                        device.shellyID
                                                    ]?.percent || 0) +
                                                    '%',
                                            }"
                                        ></div>
                                    </div>
                                </span>
                                <span
                                    v-else-if="
                                        progress[device.shellyID]
                                            ?.status === 'success'
                                    "
                                    class="text-[var(--color-success-text)]"
                                >
                                    <i class="fas fa-check mr-1"></i>
                                    Done
                                </span>
                                <span
                                    v-else-if="
                                        progress[device.shellyID]
                                            ?.status === 'failed'
                                    "
                                    class="text-[var(--color-danger-text)]"
                                    :title="
                                        progress[device.shellyID]
                                            ?.error
                                    "
                                >
                                    <i class="fas fa-times mr-1"></i>
                                    {{
                                        progress[device.shellyID]
                                            ?.error || "Failed"
                                    }}
                                </span>
                                <span
                                    v-else-if="
                                        selectedDevices.has(
                                            device.shellyID,
                                        )
                                    "
                                    class="text-[var(--color-text-disabled)]"
                                    >Waiting...</span
                                >
                            </td>
                        </tr>
                    </tbody>
                </table>
                <div
                    v-else
                    class="p-6 text-center text-[var(--color-text-tertiary)]"
                >
                    No compatible online devices found ({{
                        backup.model
                    }}, FW &ge; 1.8.0)
                </div>
            </div>

            <!-- Warning -->
            <div
                class="flex items-start gap-2 bg-[var(--color-warning-subtle)] border border-[var(--color-warning)] rounded-lg p-3 text-sm text-[var(--color-warning-text)]"
            >
                <i class="fas fa-exclamation-triangle mt-0.5"></i>
                <span
                    >Selected devices will reboot after the backup
                    is restored. Make sure they are accessible and
                    operational.</span
                >
            </div>
        </div>

        <template #footer>
            <div class="flex items-center justify-between">
                <span class="text-sm text-[var(--color-text-tertiary)]">
                    {{ selectedDevices.size }} device{{
                        selectedDevices.size !== 1 ? "s" : ""
                    }}
                    selected
                    <template v-if="running">
                        &middot; {{ doneCount }} done,
                        {{ failedCount }} failed
                    </template>
                </span>
                <div class="flex gap-2">
                    <Button @click="emit('close')">{{
                        running ? "Close" : "Cancel"
                    }}</Button>
                    <Button
                        v-if="!running"
                        type="blue"
                        :disabled="selectedDevices.size === 0"
                        @click="doRestore"
                    >
                        <i class="fas fa-upload mr-1"></i> Restore to
                        {{ selectedDevices.size }} Device{{
                            selectedDevices.size !== 1 ? "s" : ""
                        }}
                    </Button>
                </div>
            </div>
        </template>
    </Modal>
</template>

<script setup lang="ts">
import {computed, onMounted, onUnmounted, reactive, ref, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import Spinner from '@/components/core/Spinner.vue';
import Modal from '@/components/modals/Modal.vue';
import {fwVersionAtLeast, getDeviceName} from '@/helpers/device';
import type {BackupMetadata} from '@/stores/backups';
import {useBackupsStore} from '@/stores/backups';
import {useDevicesStore} from '@/stores/devices';
import {useToastStore} from '@/stores/toast';
import {onComponentStatus} from '@/tools/websocket';

const props = defineProps<{
    visible: boolean;
    backup: BackupMetadata | null;
}>();

const emit = defineEmits<{
    (e: 'close'): void;
    (e: 'restored'): void;
}>();

const backupsStore = useBackupsStore();
const devicesStore = useDevicesStore();
const toastStore = useToastStore();

const selectedDevices = reactive<Set<string>>(new Set());
const progress = reactive<
    Record<string, {status: string; error?: string; percent?: number}>
>({});
const running = ref(false);

// Frozen device list so rows don't disappear when devices disconnect during restore
const deviceSnapshot = ref<
    Array<{shellyID: string; name: string; ver: string}>
>([]);

const compatibleDevices = computed(() => {
    if (!props.backup) return [];
    const model = props.backup.model;
    return Object.values(devicesStore.devices).filter(
        (d) =>
            d.online &&
            d.info?.model === model &&
            fwVersionAtLeast(d.info?.ver || '0.0.0', 1, 8, 0)
    );
});

const deviceList = computed(() => {
    if (running.value && deviceSnapshot.value.length > 0) {
        return deviceSnapshot.value;
    }
    return compatibleDevices.value.map((d) => ({
        shellyID: d.shellyID,
        name: getDeviceName(d.info, d.shellyID),
        ver: d.info?.ver || 'Unknown'
    }));
});

const doneCount = computed(
    () => Object.values(progress).filter((p) => p.status === 'success').length
);

const failedCount = computed(
    () => Object.values(progress).filter((p) => p.status === 'failed').length
);

// Listen for real-time restore progress from backend
let cleanupProgressListener: (() => void) | null = null;

onMounted(() => {
    cleanupProgressListener = onComponentStatus('backup', (data: any) => {
        const p = data?.restoreProgress;
        if (p?.shellyID && progress[p.shellyID]?.status === 'restoring') {
            progress[p.shellyID].percent = p.percent;
        }
    });
});

onUnmounted(() => {
    cleanupProgressListener?.();
});

// Reset state when modal opens
watch(
    () => props.visible,
    (isVisible) => {
        if (isVisible) {
            selectedDevices.clear();
            for (const key of Object.keys(progress)) delete progress[key];
            running.value = false;
            deviceSnapshot.value = [];
        }
    }
);

function toggleDevice(shellyID: string) {
    if (running.value) return;
    if (selectedDevices.has(shellyID)) {
        selectedDevices.delete(shellyID);
    } else {
        selectedDevices.add(shellyID);
    }
}

function selectAll() {
    if (running.value) return;
    for (const d of compatibleDevices.value) {
        selectedDevices.add(d.shellyID);
    }
}

function clearSelection() {
    if (running.value) return;
    selectedDevices.clear();
}

async function doRestore() {
    if (!props.backup || selectedDevices.size === 0) return;

    const count = selectedDevices.size;
    const confirmed = confirm(
        `Restore backup "${props.backup.name}" to ${count} device${count !== 1 ? 's' : ''}? Each device will reboot.`
    );
    if (!confirmed) return;

    running.value = true;
    // Snapshot device list so rows don't disappear when devices go offline during restore
    deviceSnapshot.value = compatibleDevices.value.map((d) => ({
        shellyID: d.shellyID,
        name: getDeviceName(d.info, d.shellyID),
        ver: d.info?.ver || 'Unknown'
    }));
    const backupId = props.backup.id;
    const devices = Array.from(selectedDevices);

    for (const shellyID of devices) {
        progress[shellyID] = {status: 'restoring'};
        try {
            await backupsStore.restoreBackup(backupId, shellyID);
            progress[shellyID] = {status: 'success'};
        } catch (error: any) {
            progress[shellyID] = {
                status: 'failed',
                error: error?.message || String(error)
            };
        }
    }

    const failed = Object.values(progress).filter(
        (p) => p.status === 'failed'
    ).length;
    const succeeded = Object.values(progress).filter(
        (p) => p.status === 'success'
    ).length;
    if (failed === 0) {
        toastStore.success(
            `Backup restored to ${succeeded} device${succeeded !== 1 ? 's' : ''}`
        );
    } else {
        toastStore.error(
            `${failed} device${failed !== 1 ? 's' : ''} failed, ${succeeded} succeeded`
        );
    }

    emit('restored');
}
</script>
