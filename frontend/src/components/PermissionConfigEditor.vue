<template>
    <div class="space-y-4">
        <!-- Header with Generate/Copy buttons -->
        <BasicBlock darker title="Permission Configuration">
            <p v-if="!directMode" class="text-[var(--color-text-tertiary)] text-sm mb-4">
                Configure CRUD permissions for each component. Use "Generate
                JSON" to export the configuration for pasting into your Zitadel
                user metadata.
            </p>
            <p v-else class="text-[var(--color-text-tertiary)] text-sm mb-4">
                Configure permissions for this user. Changes take effect within 5 minutes or at next login.
            </p>

            <div class="flex flex-wrap items-center gap-2">
                <Dropdown
                    label="Preset"
                    :options="presetOptions"
                    :default="selectedPreset"
                    :inlineLabel="true"
                    @selected="applyPreset"
                />
                <template v-if="!directMode">
                    <Button type="blue" @click="generateJson">
                        <i class="fas fa-code mr-1" /> Generate JSON
                    </Button>
                    <Button
                        v-if="generatedJson"
                        type="green"
                        @click="copyToClipboard"
                    >
                        <i class="fas fa-copy mr-1" /> Copy
                    </Button>
                </template>
                <Button v-else type="green" @click="emitSave">
                    <i class="fas fa-save mr-1" /> Save Permissions
                </Button>
            </div>
        </BasicBlock>

        <!-- Generated JSON Output (standalone mode only) -->
        <BasicBlock
            v-if="!directMode && generatedJson"
            darker
            title="Generated Configuration (fm_permissions)"
        >
            <div
                class="bg-[var(--color-surface-1)] rounded-lg p-4 font-mono text-sm overflow-x-auto"
            >
                <pre class="text-[var(--color-success-text)] whitespace-pre-wrap">{{
                    generatedJson
                }}</pre>
            </div>
            <p class="text-[var(--color-text-tertiary)] text-xs mt-2">
                Copy this JSON and paste it into your Zitadel user metadata with
                key:
                <code class="text-[var(--color-primary-text)]">fm_permissions</code>
            </p>
        </BasicBlock>

        <!-- Component Permission Cards -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <BasicBlock
                v-for="componentName in COMPONENT_ORDER"
                :key="componentName"
                darker
                :title="COMPONENT_DEFINITIONS[componentName].label"
            >
                <p class="text-[var(--color-text-disabled)] text-xs mb-3">
                    {{ COMPONENT_DEFINITIONS[componentName].description }}
                </p>

                <!-- CRUD+E Checkboxes -->
                <div class="flex flex-wrap gap-4 mb-4">
                    <label
                        v-for="op in COMPONENT_DEFINITIONS[componentName]
                            .availableOperations"
                        :key="op"
                        class="flex items-center gap-2 cursor-pointer"
                    >
                        <input
                            type="checkbox"
                            class="w-4 h-4 text-[var(--color-primary)] bg-[var(--color-surface-3)] border-[var(--color-border-strong)] rounded focus:ring-[var(--color-primary)]"
                            :checked="getPermission(componentName, op)"
                            :aria-label="`${getOperationLabel(componentName, op)} permission for ${COMPONENT_DEFINITIONS[componentName].label}`"
                            @change="togglePermission(componentName, op)"
                        />
                        <span
                            class="text-sm capitalize"
                            :class="getOperationClass(op)"
                        >
                            {{ getOperationLabel(componentName, op) }}
                        </span>
                    </label>
                </div>

                <!-- Scope Toggle (for scoped components) -->
                <div
                    v-if="COMPONENT_DEFINITIONS[componentName].scoped"
                    class="border-t border-[var(--color-border-default)] pt-3"
                >
                    <div class="flex items-center gap-4 mb-2">
                        <span class="text-sm text-[var(--color-text-tertiary)]">Scope:</span>
                        <label class="flex items-center gap-2 cursor-pointer">
                            <input
                                type="radio"
                                :name="`scope-${componentName}`"
                                value="ALL"
                                :checked="getScope(componentName) === 'ALL'"
                                :aria-label="`All ${COMPONENT_DEFINITIONS[componentName].label} scope`"
                                @change="setScope(componentName, 'ALL')"
                                class="w-4 h-4 text-[var(--color-primary)] bg-[var(--color-surface-3)] border-[var(--color-border-strong)]"
                            />
                            <span class="text-sm"
                                >All
                                {{
                                    COMPONENT_DEFINITIONS[componentName].label
                                }}</span
                            >
                        </label>
                        <label class="flex items-center gap-2 cursor-pointer">
                            <input
                                type="radio"
                                :name="`scope-${componentName}`"
                                value="SELECTED"
                                :checked="
                                    getScope(componentName) === 'SELECTED'
                                "
                                aria-label="Selected only scope"
                                @change="setScope(componentName, 'SELECTED')"
                                class="w-4 h-4 text-[var(--color-primary)] bg-[var(--color-surface-3)] border-[var(--color-border-strong)]"
                            />
                            <span class="text-sm">Selected Only</span>
                        </label>
                    </div>

                    <!-- Item Picker (when SELECTED scope) -->
                    <div
                        v-if="getScope(componentName) === 'SELECTED'"
                        class="mt-3"
                    >
                        <div class="flex items-center gap-2 mb-2">
                            <span class="text-sm text-[var(--color-text-tertiary)]">
                                {{ getSelectedCount(componentName) }} item(s)
                                selected
                            </span>
                            <Button
                                type="blue"
                                size="sm"
                                @click="openPicker(componentName)"
                            >
                                <i class="fas fa-plus mr-1" /> Select Items
                            </Button>
                        </div>

                        <!-- Selected items preview -->
                        <div
                            v-if="getSelectedItems(componentName).length > 0"
                            class="flex flex-wrap gap-1 mt-2"
                        >
                            <span
                                v-for="item in getSelectedItems(
                                    componentName,
                                ).slice(0, 5)"
                                :key="item"
                                class="px-2 py-1 bg-[var(--color-surface-3)] rounded text-xs"
                            >
                                {{ item }}
                            </span>
                            <span
                                v-if="
                                    getSelectedItems(componentName).length > 5
                                "
                                class="px-2 py-1 text-[var(--color-text-disabled)] text-xs"
                            >
                                +{{
                                    getSelectedItems(componentName).length - 5
                                }}
                                more
                            </span>
                        </div>
                    </div>
                </div>
            </BasicBlock>
        </div>

        <!-- Item Picker Modal -->
        <Modal v-if="pickerComponent" :visible="true" @close="closePicker">
            <template #title
                >Select
                {{ COMPONENT_DEFINITIONS[pickerComponent].label }}</template
            >
            <div class="space-y-4">
                <Input
                    v-model="pickerFilter"
                    placeholder="Search..."
                    class="w-full"
                />

                <div class="max-h-96 overflow-y-auto space-y-2">
                    <!-- Devices picker -->
                    <template v-if="pickerComponent === 'devices'">
                        <div
                            v-for="device in filteredDevices"
                            :key="device.shellyID"
                            class="flex items-center gap-3 p-2 rounded hover:bg-[var(--color-surface-3)] cursor-pointer"
                            @click="togglePickerItem(device.shellyID)"
                        >
                            <input
                                type="checkbox"
                                :checked="isPickerItemSelected(device.shellyID)"
                                :aria-label="`Select ${device.name}`"
                                class="w-4 h-4"
                            />
                            <img
                                :src="device.picture_url"
                                class="w-8 h-8 rounded"
                                :alt="device.name || 'Device'"
                            />
                            <span>{{ device.name }}</span>
                        </div>
                    </template>

                    <!-- Groups picker -->
                    <template v-else-if="pickerComponent === 'groups'">
                        <div
                            v-for="group in filteredGroups"
                            :key="group.id"
                            class="flex items-center gap-3 p-2 rounded hover:bg-[var(--color-surface-3)] cursor-pointer"
                            @click="togglePickerItem(group.id)"
                        >
                            <input
                                type="checkbox"
                                :checked="isPickerItemSelected(group.id)"
                                :aria-label="`Select ${group.name}`"
                                class="w-4 h-4"
                            />
                            <i class="fas fa-cubes text-[var(--color-text-tertiary)]" />
                            <span>{{ group.name }}</span>
                            <span class="text-[var(--color-text-disabled)] text-sm"
                                >({{ group.devices.length }} devices)</span
                            >
                        </div>
                    </template>

                    <!-- Dashboards picker -->
                    <template v-else-if="pickerComponent === 'dashboards'">
                        <div
                            v-for="dashboard in filteredDashboards"
                            :key="dashboard.id"
                            class="flex items-center gap-3 p-2 rounded hover:bg-[var(--color-surface-3)] cursor-pointer"
                            @click="togglePickerItem(dashboard.id)"
                        >
                            <input
                                type="checkbox"
                                :checked="isPickerItemSelected(dashboard.id)"
                                :aria-label="`Select ${dashboard.name}`"
                                class="w-4 h-4"
                            />
                            <i class="fas fa-th-large text-[var(--color-text-tertiary)]" />
                            <span>{{ dashboard.name }}</span>
                            <span class="text-[var(--color-text-disabled)] text-sm"
                                >(ID: {{ dashboard.id }})</span
                            >
                        </div>
                        <p
                            v-if="filteredDashboards.length === 0"
                            class="text-[var(--color-text-disabled)] text-sm"
                        >
                            No dashboards found. Create dashboards first.
                        </p>
                    </template>

                    <!-- Plugins picker -->
                    <template v-else-if="pickerComponent === 'plugins'">
                        <div
                            v-for="plugin in filteredPlugins"
                            :key="plugin.name"
                            class="flex items-center gap-3 p-2 rounded hover:bg-[var(--color-surface-3)] cursor-pointer"
                            @click="togglePickerItem(plugin.name)"
                        >
                            <input
                                type="checkbox"
                                :checked="isPickerItemSelected(plugin.name)"
                                :aria-label="`Select ${plugin.name}`"
                                class="w-4 h-4"
                            />
                            <i class="fas fa-puzzle-piece text-[var(--color-text-tertiary)]" />
                            <span>{{ plugin.name }}</span>
                            <span
                                v-if="plugin.description"
                                class="text-[var(--color-text-disabled)] text-sm truncate"
                                >{{ plugin.description }}</span
                            >
                        </div>
                        <p
                            v-if="filteredPlugins.length === 0"
                            class="text-[var(--color-text-disabled)] text-sm"
                        >
                            No plugins found. Make sure plugins are installed.
                        </p>
                    </template>

                    <!-- Generic picker for other types -->
                    <template v-else>
                        <p class="text-[var(--color-text-disabled)] text-sm">
                            Item selection for
                            {{ COMPONENT_DEFINITIONS[pickerComponent].label }}
                            is not yet implemented.
                        </p>
                    </template>
                </div>

                <div
                    class="flex justify-end gap-2 pt-4 border-t border-[var(--color-border-default)]"
                >
                    <Button type="white" @click="closePicker">Cancel</Button>
                    <Button type="blue" @click="applyPickerSelection"
                        >Apply Selection</Button
                    >
                </div>
            </div>
        </Modal>
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, reactive, ref, shallowRef, watch} from 'vue';
import {getDeviceName, getLogo} from '@/helpers/device';
import {
    COMPONENT_DEFINITIONS,
    COMPONENT_ORDER,
    type ComponentName,
    type CrudOperation,
    createAdminConfig,
    createEmptyConfig,
    createInstallerConfig,
    createOperatorConfig,
    createViewerConfig,
    type FleetPermissionConfig
} from '@/helpers/sharedInfo';
import {useDevicesStore} from '@/stores/devices';
import {useGroupsStore} from '@/stores/groups';
import {useToastStore} from '@/stores/toast';
import {sendRPC} from '@/tools/websocket';
import BasicBlock from './core/BasicBlock.vue';
import Button from './core/Button.vue';
import Dropdown from './core/Dropdown.vue';
import Input from './core/Input.vue';
import Modal from './modals/Modal.vue';

// Props & emits
const props = withDefaults(
    defineProps<{
        initialConfig?: FleetPermissionConfig;
        directMode?: boolean;
    }>(),
    {
        directMode: false
    }
);

const emit = defineEmits<{
    save: [config: FleetPermissionConfig];
}>();

// Stores
const groupStore = useGroupsStore();
const devicesStore = useDevicesStore();
const toastStore = useToastStore();

// State
const config = reactive<FleetPermissionConfig>(createEmptyConfig());

// When initialConfig is provided (possibly async), deep-copy it into the reactive config
watch(
    () => props.initialConfig,
    (newVal) => {
        if (newVal) {
            Object.assign(config, JSON.parse(JSON.stringify(newVal)));
            selectedPreset.value = 'Custom';
        }
    },
    {immediate: true, deep: true}
);
const generatedJson = ref('');
const selectedPreset = ref('Custom');

// Picker state
const pickerComponent = ref<ComponentName | null>(null);
const pickerFilter = ref('');
const pickerSelection = ref<Set<string | number>>(new Set());

// Preset options
const presetOptions = ['Custom', 'Viewer', 'Operator', 'Installer', 'Admin'];

// Device list for picker
const devices = shallowRef<
    Array<{
        shellyID: string;
        name: string;
        picture_url: string;
    }>
>([]);

// Plugin list for picker
const plugins = shallowRef<
    Array<{
        name: string;
        description: string;
    }>
>([]);

// Dashboard list for picker
const dashboards = shallowRef<
    Array<{
        id: number;
        name: string;
    }>
>([]);

onMounted(async () => {
    devices.value = Object.values(devicesStore.devices).map((dev) => ({
        shellyID: dev.shellyID,
        name: getDeviceName(dev.info, dev.shellyID),
        picture_url: getLogo(dev)
    }));

    try {
        const pluginsData = await sendRPC(
            'FLEET_MANAGER',
            'FleetManager.ListPlugins',
            {}
        );
        if (pluginsData && typeof pluginsData === 'object') {
            plugins.value = Object.values(pluginsData).map((p: any) => ({
                name: p.info?.name || 'Unknown',
                description: p.info?.description || ''
            }));
        }
    } catch (error) {
        console.warn('Failed to load plugins list:', error);
    }

    try {
        const dashboardsData = await sendRPC<
            Array<{
                id: number;
                name: string;
                group_id: number;
                dashboard_type: number;
                items: any[];
            }>
        >('FLEET_MANAGER', 'Storage.GetItem', {
            registry: 'ui',
            key: 'dashboards'
        });
        if (Array.isArray(dashboardsData)) {
            dashboards.value = dashboardsData.map((d) => ({
                id: d.id,
                name: d.name || `Dashboard ${d.id}`
            }));
        }
    } catch (error) {
        console.warn('Failed to load dashboards list:', error);
    }
});

const filteredDevices = computed(() => {
    const filter = pickerFilter.value.toLowerCase();
    return devices.value.filter(
        (dev) =>
            dev.name.toLowerCase().includes(filter) ||
            dev.shellyID.toLowerCase().includes(filter)
    );
});

const filteredGroups = computed(() => {
    const filter = pickerFilter.value.toLowerCase();
    return Object.values(groupStore.groups).filter(
        (group: {id: number; name: string; devices: string[]}) =>
            group.name.toLowerCase().includes(filter)
    );
});

const filteredPlugins = computed(() => {
    const filter = pickerFilter.value.toLowerCase();
    return plugins.value.filter(
        (plugin) =>
            plugin.name.toLowerCase().includes(filter) ||
            plugin.description.toLowerCase().includes(filter)
    );
});

const filteredDashboards = computed(() => {
    const filter = pickerFilter.value.toLowerCase();
    return dashboards.value.filter(
        (dashboard) =>
            dashboard.name.toLowerCase().includes(filter) ||
            dashboard.id.toString().includes(filter)
    );
});

function getPermission(
    component: ComponentName,
    operation: CrudOperation
): boolean {
    const comp = config.components[component];
    if (!comp) return false;
    if (operation === 'execute' && 'execute' in comp) {
        return (comp as any).execute;
    }
    return ((comp as any)[operation] as boolean) ?? false;
}

function togglePermission(
    component: ComponentName,
    operation: CrudOperation
): void {
    const comp = config.components[component];
    if (!comp) return;

    if (operation === 'execute' && 'execute' in comp) {
        (comp as any).execute = !(comp as any).execute;
    } else if (operation in comp) {
        (comp as any)[operation] = !(comp as any)[operation];
    }

    selectedPreset.value = 'Custom';
}

function getScope(component: ComponentName): 'ALL' | 'SELECTED' {
    const comp = config.components[component];
    if (!comp || !('scope' in comp)) return 'ALL';
    return (comp as any).scope;
}

function setScope(component: ComponentName, scope: 'ALL' | 'SELECTED'): void {
    const comp = config.components[component];
    if (!comp || !('scope' in comp)) return;
    (comp as any).scope = scope;
    selectedPreset.value = 'Custom';
}

function getSelectedItems(component: ComponentName): (string | number)[] {
    const comp = config.components[component];
    if (!comp || !('selected' in comp)) return [];
    return ((comp as any).selected ?? []) as (string | number)[];
}

function getSelectedCount(component: ComponentName): number {
    return getSelectedItems(component).length;
}

function getOperationLabel(
    component: ComponentName,
    op: CrudOperation
): string {
    const specialLabels: Record<string, Record<string, string>> = {
        waiting_room: {create: 'Approve', delete: 'Reject'},
        plugins: {create: 'Upload'}
    };

    return (specialLabels as any)[component]?.[op] ?? op;
}

function getOperationClass(op: CrudOperation): string {
    const classes: Record<CrudOperation, string> = {
        create: 'text-[var(--color-success-text)]',
        read: 'text-[var(--color-primary-text)]',
        update: 'text-[var(--color-warning-text)]',
        delete: 'text-[var(--color-danger-text)]',
        execute: 'text-[var(--color-accent-text)]'
    };
    return classes[op];
}

function applyPreset(preset: string): void {
    selectedPreset.value = preset;

    let newConfig: FleetPermissionConfig;
    switch (preset) {
        case 'Viewer':
            newConfig = createViewerConfig();
            break;
        case 'Operator':
            newConfig = createOperatorConfig();
            break;
        case 'Installer':
            newConfig = createInstallerConfig();
            break;
        case 'Admin':
            newConfig = createAdminConfig();
            break;
        default:
            return;
    }

    Object.assign(config.components, newConfig.components);
    toastStore.success(`Applied "${preset}" preset`);
}

function openPicker(component: ComponentName): void {
    pickerComponent.value = component;
    pickerFilter.value = '';
    pickerSelection.value = new Set(getSelectedItems(component));
}

function closePicker(): void {
    pickerComponent.value = null;
    pickerSelection.value = new Set();
}

function togglePickerItem(item: string | number): void {
    if (pickerSelection.value.has(item)) {
        pickerSelection.value.delete(item);
    } else {
        pickerSelection.value.add(item);
    }
}

function isPickerItemSelected(item: string | number): boolean {
    return pickerSelection.value.has(item);
}

function applyPickerSelection(): void {
    if (!pickerComponent.value) return;

    const comp = config.components[pickerComponent.value];
    if (!comp || !('selected' in comp)) return;

    (comp as any).selected = Array.from(pickerSelection.value) as any;
    closePicker();
    toastStore.success('Selection applied');
}

function emitSave(): void {
    emit('save', JSON.parse(JSON.stringify(config)));
}

function generateJson(): void {
    generatedJson.value = JSON.stringify(config, null, 2);
    toastStore.success('JSON configuration generated');
}

async function copyToClipboard(): Promise<void> {
    try {
        await navigator.clipboard.writeText(generatedJson.value);
        toastStore.success('Copied to clipboard');
    } catch (error) {
        toastStore.error('Failed to copy to clipboard');
    }
}
</script>

<style scoped>
.capitalize {
    text-transform: capitalize;
}
</style>
