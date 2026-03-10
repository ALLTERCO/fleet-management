<template>
    <div class="h-full flex flex-col gap-2">
        <!-- Header with step navigation -->
        <BasicBlock bordered blurred padding="sm">
            <div class="flex flex-row items-center justify-between">
                <div class="flex items-center gap-4">
                    <span class="font-bold text-lg">Firmware Management</span>
                    <div class="flex items-center gap-2">
                        <button
                            v-for="step in 3"
                            :key="step"
                            class="flex items-center gap-1 px-3 py-1 rounded-lg text-sm transition-colors"
                            :class="[
                                currentStep === step
                                    ? 'bg-[var(--color-primary)] text-[var(--color-text-primary)]'
                                    : currentStep > step
                                      ? 'bg-[var(--color-success-subtle)] text-[var(--color-success-text)] cursor-pointer hover:bg-[var(--color-success-subtle)]'
                                      : 'bg-[var(--color-surface-3)] text-[var(--color-text-tertiary)] cursor-not-allowed',
                            ]"
                            :disabled="step > currentStep"
                            @click="step < currentStep && goToStep(step as 1 | 2 | 3)"
                        >
                            <span
                                class="w-5 h-5 rounded-full flex items-center justify-center text-xs"
                                :class="[
                                    currentStep === step
                                        ? 'bg-[var(--color-primary)]'
                                        : currentStep > step
                                          ? 'bg-[var(--color-success)]'
                                          : 'bg-[var(--color-surface-4)]',
                                ]"
                            >
                                <i v-if="currentStep > step" class="fas fa-check text-xs"></i>
                                <span v-else>{{ step }}</span>
                            </span>
                            <span>{{ stepLabels[step - 1] }}</span>
                        </button>
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    <span class="text-sm text-[var(--color-text-tertiary)]">
                        {{ selectedCount }} device{{ selectedCount !== 1 ? "s" : "" }} selected
                    </span>
                </div>
            </div>
        </BasicBlock>

        <!-- Step 1: Device Selection -->
        <div v-if="currentStep === 1" class="flex-1 flex flex-col gap-2 overflow-hidden">
            <BasicBlock bordered blurred padding="sm" class="relative z-[var(--z-raised)]">
                <div class="flex flex-col gap-2">
                    <div class="flex flex-row gap-2 items-center justify-between">
                        <div class="flex flex-row gap-2 items-center">
                            <Dropdown
                                :options="groupOptions"
                                label="Add Group"
                                :inline-label="true"
                                @selected="handleGroupSelect"
                            />
                            <Button type="blue" size="sm" narrow data-track="firmware_select_all" @click="selectAll">
                                Select All
                            </Button>
                            <Button type="red" size="sm" narrow data-track="firmware_clear" @click="clearSelection">
                                Clear
                            </Button>
                        </div>
                        <Button
                            type="green"
                            size="sm"
                            data-track="firmware_next"
                            :disabled="!hasSelectedDevices"
                            @click="proceedToStep2"
                        >
                            Next <i class="fas fa-arrow-right ml-1"></i>
                        </Button>
                    </div>
                    <!-- Selected groups display -->
                    <div v-if="selectedGroupsList.length > 0" class="flex flex-wrap gap-2 items-center">
                        <span class="text-xs text-[var(--color-text-tertiary)]">Selected groups:</span>
                        <span
                            v-for="group in selectedGroupsList"
                            :key="group.id"
                            class="inline-flex items-center gap-1 px-2 py-1 bg-[var(--color-primary)]/30 text-[var(--color-primary-text)] rounded-lg text-xs"
                        >
                            {{ group.name }}
                            <button
                                class="hover:text-[var(--color-danger-text)] transition-colors"
                                @click="removeGroup(group.id)"
                            >
                                <i class="fas fa-times"></i>
                            </button>
                        </span>
                    </div>
                </div>
            </BasicBlock>

            <div ref="fwScrollRoot" class="flex-1 overflow-auto">
                <div v-if="executableDevices.length === 0" class="text-center py-8">
                    <p class="text-[var(--color-text-tertiary)]">No online devices available with execute permission.</p>
                </div>
                <div v-else class="widget-grid-devices">
                    <DeviceCard
                        v-for="device in paginatedDevices"
                        :key="device.shellyID"
                        :selected="isSelected(device.shellyID)"
                        :online="!!device.online"
                        :accent-color="device.online ? '#22D3A0' : '#F04E5E'"
                        @select="toggleDevice(device.shellyID)"
                    >
                        <template #upper-corner>
                            {{ device.info?.app || 'Device' }}
                        </template>
                        <template #image>
                            <img
                                :src="getLogo(device)"
                                alt="Device"
                                @error="handleImgError"
                            />
                        </template>
                        <template #name>
                            {{ getDeviceName(device.info, device.shellyID) }}
                        </template>
                        <template #description>
                            {{ device.info?.ver || "Unknown version" }}
                        </template>
                    </DeviceCard>
                </div>
                <div v-if="page < totalPages" class="my-4 flex justify-center h-8 pb-2">
                    <Spinner />
                </div>
                <div ref="fwSentinel" class="h-1" />
            </div>
        </div>

        <!-- Step 2: Firmware Overview (70/30 split) -->
        <div v-else-if="currentStep === 2" class="flex-1 flex gap-2 overflow-hidden">
            <!-- Left side: Device table (70%) -->
            <div class="w-[70%] flex flex-col gap-2 overflow-hidden">
                <BasicBlock bordered blurred padding="sm" class="flex-1 overflow-hidden flex flex-col">
                    <div class="flex items-center justify-between mb-2">
                        <span class="font-semibold">Firmware Status</span>
                        <Button
                            v-if="isCheckingFirmware"
                            type="blue"
                            size="sm"
                            narrow
                            disabled
                        >
                            <Spinner size="xs" class="mr-1" /> Checking...
                        </Button>
                        <Button
                            v-else
                            type="blue"
                            size="sm"
                            narrow
                            @click="recheckFirmware"
                        >
                            <i class="fas fa-refresh mr-1"></i> Refresh
                        </Button>
                    </div>

                    <div class="flex-1 overflow-auto">
                        <table class="w-full text-sm">
                            <thead class="sticky top-0 bg-[var(--table-header-bg)]">
                                <tr class="text-left text-[var(--color-text-tertiary)] border-b border-[var(--table-border)]">
                                    <th scope="col" class="py-2 px-2">Device</th>
                                    <th scope="col" class="py-2 px-2">Current Version</th>
                                    <th scope="col" class="py-2 px-2">Auto-Update</th>
                                    <th scope="col" class="py-2 px-2">Available Stable</th>
                                    <th scope="col" class="py-2 px-2">Available Beta</th>
                                    <th scope="col" class="py-2 px-2">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr
                                    v-for="info in firmwareInfoList"
                                    :key="info.shellyID"
                                    class="border-b border-[var(--table-border)]/50 hover:bg-[var(--color-surface-3)]/30"
                                >
                                    <td class="py-2 px-2 font-medium">
                                        {{ info.deviceName }}
                                    </td>
                                    <td class="py-2 px-2 font-mono text-xs">
                                        {{ info.currentVersion }}
                                    </td>
                                    <td class="py-2 px-2">
                                        <button
                                            class="px-2 py-1 rounded text-xs transition-colors"
                                            :class="[
                                                info.autoUpdate
                                                    ? 'bg-[var(--color-success-subtle)] text-[var(--color-success-text)] hover:bg-[var(--color-success-subtle)]'
                                                    : 'bg-[var(--color-surface-4)]/30 text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-4)]/40',
                                            ]"
                                            @click="toggleAutoUpdate(info.shellyID)"
                                        >
                                            {{ info.autoUpdate ? "ON" : "OFF" }}
                                        </button>
                                    </td>
                                    <td class="py-2 px-2 font-mono text-xs">
                                        <span v-if="info.checkStatus === 'checking'">
                                            <Spinner size="xs" />
                                        </span>
                                        <span
                                            v-else-if="info.availableStable"
                                            class="text-[var(--color-success-text)]"
                                        >
                                            {{ info.availableStable.version }}
                                        </span>
                                        <span v-else class="text-[var(--color-text-disabled)]">-</span>
                                    </td>
                                    <td class="py-2 px-2 font-mono text-xs">
                                        <span v-if="info.checkStatus === 'checking'">
                                            <Spinner size="xs" />
                                        </span>
                                        <span
                                            v-else-if="info.availableBeta"
                                            class="text-[var(--color-warning-text)]"
                                        >
                                            {{ info.availableBeta.version }}
                                        </span>
                                        <span v-else class="text-[var(--color-text-disabled)]">-</span>
                                    </td>
                                    <td class="py-2 px-2">
                                        <span
                                            v-if="info.checkStatus === 'error'"
                                            class="text-[var(--color-danger-text)] text-xs"
                                            :title="info.error"
                                        >
                                            <i class="fas fa-exclamation-triangle"></i> Error
                                        </span>
                                        <span
                                            v-else-if="info.checkStatus === 'checked'"
                                            class="text-[var(--color-success-text)] text-xs"
                                        >
                                            <i class="fas fa-check"></i>
                                        </span>
                                        <span v-else class="text-[var(--color-text-disabled)] text-xs">
                                            <i class="fas fa-clock"></i>
                                        </span>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </BasicBlock>
            </div>

            <!-- Right side: Control Panel (30%) -->
            <div class="w-[30%] flex flex-col gap-2">
                <BasicBlock bordered blurred padding="sm" title="Auto-Update">
                    <div class="flex flex-col gap-2">
                        <Button
                            type="green"
                            size="sm"
                            class="w-full"
                            @click="enableAutoUpdateForAll"
                        >
                            <i class="fas fa-toggle-on mr-1"></i>
                            Enable for All Selected
                        </Button>
                        <Button
                            type="red"
                            size="sm"
                            class="w-full"
                            @click="disableAutoUpdateForAll"
                        >
                            <i class="fas fa-toggle-off mr-1"></i>
                            Disable for All Selected
                        </Button>
                    </div>
                </BasicBlock>

                <BasicBlock bordered blurred padding="sm" title="Update Firmware">
                    <div class="flex flex-col gap-2">
                        <Button
                            type="blue"
                            size="sm"
                            class="w-full"
                            data-track="firmware_update_stable"
                            :disabled="devicesWithStableUpdates.length === 0"
                            @click="updateAllToStable"
                        >
                            <i class="fas fa-download mr-1"></i>
                            Update All to Stable
                            <span v-if="devicesWithStableUpdates.length > 0" class="ml-1">
                                ({{ devicesWithStableUpdates.length }})
                            </span>
                        </Button>
                        <Button
                            type="orange"
                            size="sm"
                            class="w-full"
                            data-track="firmware_update_beta"
                            :disabled="devicesWithBetaUpdates.length === 0"
                            @click="updateAllToBeta"
                        >
                            <i class="fas fa-flask mr-1"></i>
                            Update All to Beta
                            <span v-if="devicesWithBetaUpdates.length > 0" class="ml-1">
                                ({{ devicesWithBetaUpdates.length }})
                            </span>
                        </Button>
                    </div>
                </BasicBlock>

                <BasicBlock bordered blurred padding="sm" title="Navigation">
                    <div class="flex flex-col gap-2">
                        <Button type="blue-hollow" size="sm" class="w-full" @click="goToStep(1)">
                            <i class="fas fa-arrow-left mr-1"></i>
                            Back to Selection
                        </Button>
                    </div>
                </BasicBlock>
            </div>
        </div>

        <!-- Step 3: Update Progress -->
        <div v-else-if="currentStep === 3" class="flex-1 flex flex-col gap-2 overflow-hidden">
            <BasicBlock bordered blurred padding="sm" class="flex-1 overflow-hidden flex flex-col">
                <div class="flex items-center justify-between mb-2">
                    <span class="font-semibold">Update Progress</span>
                    <div class="flex items-center gap-2">
                        <span class="text-sm text-[var(--color-text-tertiary)]">
                            {{ successDevices.length }} success,
                            {{ failedDevices.length }} failed,
                            {{ updatingDevices.length }} updating
                        </span>
                    </div>
                </div>

                <div class="flex-1 overflow-auto">
                    <table class="w-full text-sm">
                        <thead class="sticky top-0 bg-[var(--table-header-bg)]">
                            <tr class="text-left text-[var(--color-text-tertiary)] border-b border-[var(--table-border)]">
                                <th scope="col" class="py-2 px-2">Device</th>
                                <th scope="col" class="py-2 px-2">Progress</th>
                                <th scope="col" class="py-2 px-2">Status</th>
                                <th scope="col" class="py-2 px-2">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr
                                v-for="info in firmwareInfoList"
                                :key="info.shellyID"
                                class="border-b border-[var(--table-border)]/50"
                            >
                                <td class="py-2 px-2 font-medium">
                                    {{ info.deviceName }}
                                </td>
                                <td class="py-2 px-2 w-1/3">
                                    <div class="w-full bg-[var(--color-surface-3)] rounded-full h-2">
                                        <div
                                            class="h-2 rounded-full transition-all duration-300"
                                            :class="[
                                                info.updateStatus === 'updating'
                                                    ? 'bg-[var(--color-primary)] animate-pulse w-2/3'
                                                    : info.updateStatus === 'success'
                                                      ? 'bg-[var(--color-success)] w-full'
                                                      : info.updateStatus === 'failed'
                                                        ? 'bg-[var(--color-danger)] w-full'
                                                        : 'bg-[var(--color-surface-4)] w-0',
                                            ]"
                                        ></div>
                                    </div>
                                </td>
                                <td class="py-2 px-2">
                                    <span
                                        v-if="info.updateStatus === 'updating'"
                                        class="text-[var(--color-primary-text)] flex items-center gap-1"
                                    >
                                        <Spinner size="xs" /> Updating...
                                    </span>
                                    <span
                                        v-else-if="info.updateStatus === 'success'"
                                        class="text-[var(--color-success-text)]"
                                    >
                                        <i class="fas fa-check mr-1"></i>
                                        {{ info.previousVersion }} <i class="fas fa-arrow-right mx-1"></i>
                                        {{ info.currentVersion }}
                                    </span>
                                    <span
                                        v-else-if="info.updateStatus === 'failed'"
                                        class="text-[var(--color-danger-text)]"
                                        :title="info.error"
                                    >
                                        <i class="fas fa-times mr-1"></i>
                                        Failed: {{ info.error }}
                                    </span>
                                    <span v-else class="text-[var(--color-text-disabled)]">
                                        Waiting...
                                    </span>
                                </td>
                                <td class="py-2 px-2">
                                    <Button
                                        v-if="info.updateStatus === 'failed'"
                                        type="blue"
                                        size="xs"
                                        narrow
                                        @click="retryDevice(info.shellyID)"
                                    >
                                        <i class="fas fa-redo"></i> Retry
                                    </Button>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div class="flex items-center justify-between pt-2 border-t border-[var(--table-border)]">
                    <Button
                        v-if="failedDevices.length > 0"
                        type="blue"
                        size="sm"
                        @click="retryAllFailed"
                    >
                        <i class="fas fa-redo mr-1"></i>
                        Retry All Failed ({{ failedDevices.length }})
                    </Button>
                    <div v-else></div>
                    <Button type="green" size="sm" @click="finishAndReset">
                        <i class="fas fa-check mr-1"></i>
                        Done
                    </Button>
                </div>
            </BasicBlock>
        </div>
    </div>
</template>

<script setup lang="ts">
import {storeToRefs} from 'pinia';
import {computed, onMounted, onUnmounted, ref} from 'vue';
import BasicBlock from '@/components/core/BasicBlock.vue';
import Button from '@/components/core/Button.vue';
import Dropdown from '@/components/core/Dropdown.vue';
import Spinner from '@/components/core/Spinner.vue';
import DeviceCard from '@/components/widgets/WidgetsTemplates/DeviceWidget.vue';
import useInfiniteScroll from '@/composables/useInfiniteScroll';
import {getDeviceName, getLogo} from '@/helpers/device';
import {type FirmwareDeviceInfo, useFirmwareStore} from '@/stores/firmware';
import {useGroupsStore} from '@/stores/groups';
import {useToastStore} from '@/stores/toast';

const firmwareStore = useFirmwareStore();
const groupsStore = useGroupsStore();
const toastStore = useToastStore();

const {
    selectedDevices,
    currentStep,
    selectedCount,
    executableDevices,
    hasSelectedDevices,
    firmwareInfoList,
    isCheckingFirmware,
    failedDevices,
    successDevices,
    updatingDevices
} = storeToRefs(firmwareStore);

// Paginate Step 1 device grid — avoids rendering 1.5k+ Widgets at once
const {
    items: paginatedDevices,
    page,
    totalPages,
    loadItems
} = useInfiniteScroll(executableDevices);
const fwScrollRoot = ref<HTMLElement | null>(null);
const fwSentinel = ref<HTMLElement | null>(null);
let fwObserver: IntersectionObserver | null = null;

onMounted(() => {
    firmwareStore.activateExecutableDevices();
    if (!fwSentinel.value || !fwScrollRoot.value) return;
    fwObserver = new IntersectionObserver(
        (entries) => {
            if (entries[0]?.isIntersecting && page.value < totalPages.value) {
                loadItems();
            }
        },
        {root: fwScrollRoot.value, rootMargin: '0px 0px 400px 0px'}
    );
    fwObserver.observe(fwSentinel.value);
});

onUnmounted(() => {
    firmwareStore.deactivateExecutableDevices();
    fwObserver?.disconnect();
});

const stepLabels = ['Selection', 'Overview', 'Progress'];

// Track selected groups
const selectedGroups = ref<Set<number>>(new Set());

// Group options for dropdown (exclude already selected groups)
const groupOptions = computed(() => {
    const groups = Object.values(groupsStore.groups).filter(
        (g) => !selectedGroups.value.has(g.id)
    );
    return ['-- Select Group --', ...groups.map((g) => g.name)];
});

// Get selected groups as list for display
const selectedGroupsList = computed(() => {
    return Array.from(selectedGroups.value)
        .map((id) => groupsStore.groups[id])
        .filter(Boolean);
});

// Computed for devices with available updates
const devicesWithStableUpdates = computed(() => {
    return firmwareInfoList.value.filter(
        (info: FirmwareDeviceInfo) => info.availableStable
    );
});

const devicesWithBetaUpdates = computed(() => {
    return firmwareInfoList.value.filter(
        (info: FirmwareDeviceInfo) => info.availableBeta
    );
});

// Helper to check if device is selected
function isSelected(shellyID: string) {
    return selectedDevices.value.has(shellyID);
}

// Image error handler
function handleImgError(e: Event) {
    const target = e.target as HTMLImageElement;
    target.src = '/shelly_logo_black.jpg';
}

// Step 1 actions
function toggleDevice(shellyID: string) {
    firmwareStore.toggleDevice(shellyID);
}

function selectAll() {
    firmwareStore.selectAll();
}

function clearSelection() {
    firmwareStore.clearSelection();
    selectedGroups.value.clear();
}

function handleGroupSelect(groupName: string) {
    if (groupName === '-- Select Group --') return;

    const group = Object.values(groupsStore.groups).find(
        (g) => g.name === groupName
    );
    if (group) {
        selectedGroups.value.add(group.id);
        firmwareStore.selectGroup(group.id);
        toastStore.success(
            `Added ${group.devices.length} device(s) from "${group.name}"`
        );
    }
}

function removeGroup(groupId: number) {
    const group = groupsStore.groups[groupId];
    if (group) {
        selectedGroups.value.delete(groupId);
        // Deselect devices from this group (only if not in another selected group)
        for (const shellyID of group.devices) {
            // Check if device is in any other selected group
            const inOtherGroup = Array.from(selectedGroups.value).some(
                (gid) => {
                    const g = groupsStore.groups[gid];
                    return g && g.devices.includes(shellyID);
                }
            );
            if (!inOtherGroup) {
                firmwareStore.deselectDevice(shellyID);
            }
        }
        toastStore.success(`Removed group "${group.name}"`);
    }
}

async function proceedToStep2() {
    firmwareStore.goToStep(2);
    await firmwareStore.checkFirmwareForSelected();
}

// Step 2 actions
function goToStep(step: 1 | 2 | 3) {
    firmwareStore.goToStep(step);
}

async function recheckFirmware() {
    await firmwareStore.checkFirmwareForSelected();
}

async function toggleAutoUpdate(shellyID: string) {
    const info = firmwareStore.firmwareInfo[shellyID];
    if (!info) return;

    try {
        await firmwareStore.setAutoUpdate(shellyID, !info.autoUpdate);
        toastStore.success(
            `Auto-update ${!info.autoUpdate ? 'enabled' : 'disabled'} for ${info.deviceName}`
        );
    } catch (error) {
        toastStore.error('Failed to update auto-update setting');
    }
}

async function enableAutoUpdateForAll() {
    const confirmed = confirm(
        'Enable auto-update for all selected devices?\n\n' +
            'Auto-updates run automatically every Sunday at 3:00 AM.\n' +
            'Devices will be updated to the latest stable firmware version.'
    );
    if (!confirmed) return;

    try {
        await firmwareStore.enableAutoUpdateForSelected();
        toastStore.success('Auto-update enabled for all selected devices');
    } catch (error) {
        toastStore.error('Failed to enable auto-update');
    }
}

async function disableAutoUpdateForAll() {
    try {
        await firmwareStore.disableAutoUpdateForSelected();
        toastStore.success('Auto-update disabled for all selected devices');
    } catch (error) {
        toastStore.error('Failed to disable auto-update');
    }
}

async function updateAllToStable() {
    const count = devicesWithStableUpdates.value.length;
    if (count === 0) {
        toastStore.error('No devices have stable updates available');
        return;
    }

    const confirmed = confirm(
        `You are about to update ${count} device(s) to the latest stable firmware. The devices will reboot. Continue?`
    );
    if (!confirmed) return;

    await firmwareStore.updateSelected('stable');
}

async function updateAllToBeta() {
    const count = devicesWithBetaUpdates.value.length;
    if (count === 0) {
        toastStore.error('No devices have beta updates available');
        return;
    }

    const confirmed = confirm(
        `You are about to update ${count} device(s) to the latest beta firmware. Beta versions may be unstable. The devices will reboot. Continue?`
    );
    if (!confirmed) return;

    await firmwareStore.updateSelected('beta');
}

// Step 3 actions
async function retryDevice(shellyID: string) {
    await firmwareStore.retryDevice(shellyID, 'stable');
}

async function retryAllFailed() {
    await firmwareStore.retryFailed('stable');
}

function finishAndReset() {
    firmwareStore.reset();
    selectedGroups.value.clear();
}
</script>
