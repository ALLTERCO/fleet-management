<template>
    <div class="dps" ref="wrapRef">
        <!-- Gear icon trigger -->
        <button class="dps-trigger" aria-label="Panel scope" @click="showDropdown = !showDropdown">
            <i class="fas fa-sliders dps-icon" />
        </button>

        <!-- Dropdown -->
        <Teleport to="body">
            <div v-if="showDropdown" class="dps-backdrop" @click="showDropdown = false" />
            <div v-if="showDropdown" class="dps-dropdown" :style="dropdownPosition">
                <div class="dps-option" :class="{'dps-option--active': currentScope.scope === 'fleet'}" @click="selectFleet">
                    All devices
                </div>
                <template v-if="groups.length">
                    <div class="dps-section">Groups</div>
                    <div
                        v-for="group in groups"
                        :key="`g-${group.id}`"
                        class="dps-option"
                        :class="{'dps-option--active': currentScope.scope === 'group' && currentScope.groupId === group.id}"
                        @click="selectGroup(group.id)"
                    >
                        {{ group.name }}
                    </div>
                </template>
                <template v-if="locations.length">
                    <div class="dps-section">Locations</div>
                    <div
                        v-for="loc in locations"
                        :key="`l-${loc.id}`"
                        class="dps-option"
                        :class="{'dps-option--active': currentScope.scope === 'location' && currentScope.locationId === loc.id}"
                        @click="selectLocation(loc.id)"
                    >
                        {{ loc.name }}
                    </div>
                </template>
                <template v-if="tags.length">
                    <div class="dps-section">Tags</div>
                    <div
                        v-for="tag in tags"
                        :key="`t-${tag.id}`"
                        class="dps-option"
                        :class="{'dps-option--active': currentScope.scope === 'tag' && currentScope.tagId === tag.id}"
                        @click="selectTag(tag.id)"
                    >
                        {{ tag.name }}
                    </div>
                </template>
                <div class="dps-divider" />
                <div class="dps-option" @click="openPicker">
                    Custom devices...
                </div>
            </div>
        </Teleport>

        <!-- Device picker modal -->
        <Teleport to="body">
            <div
                v-if="showPicker"
                ref="pickerPanelRef"
                class="dps-modal-backdrop"
                role="dialog"
                aria-modal="true"
                :aria-labelledby="pickerTitleId"
                tabindex="-1"
                @click="closePicker"
                @keydown="pickerKeydown"
            >
                <div class="dps-modal" @click.stop>
                    <div class="dps-modal-header">
                        <span :id="pickerTitleId" class="dps-modal-title">Select devices</span>
                        <button class="dps-modal-close" aria-label="Close" @click="closePicker">&times;</button>
                    </div>
                    <div class="dps-modal-search">
                        <input
                            v-model="pickerSearch"
                            class="dps-search-input"
                            placeholder="Search devices..."
                            aria-label="Search devices"
                        />
                    </div>
                    <div class="dps-modal-list">
                        <label
                            v-for="dev in filteredPickerDevices"
                            :key="dev.shellyId"
                            class="dps-device-row"
                        >
                            <input
                                type="checkbox"
                                :checked="pickerSelected.has(dev.shellyId)"
                                @change="togglePickerDevice(dev.shellyId)"
                            />
                            <span class="dps-device-name">{{ dev.name }}</span>
                            <span class="dps-device-type">{{ dev.typeLabel }}</span>
                        </label>
                        <div v-if="!filteredPickerDevices.length" class="dps-picker-empty">
                            No devices match search
                        </div>
                    </div>
                    <div class="dps-modal-footer">
                        <span class="dps-selected-count">{{ pickerSelected.size }} selected</span>
                        <button class="dps-apply-btn" @click="applyPicker">Apply</button>
                    </div>
                </div>
            </div>
        </Teleport>
    </div>
</template>

<script setup lang="ts">
import {computed, ref, useId} from 'vue';
import {useFocusTrap} from '@/composables/useFocusTrap';
import {useDevicesStore} from '@/stores/devices';
import {useGroupsStore} from '@/stores/groups';
import {useLocationsStore} from '@/stores/locations';
import {useTagsStore} from '@/stores/tags';
import type {PanelScope} from '@/types/dashboard-components';

const TYPE_LABELS: Record<string, string> = {
    '3ph_em': '3ph em',
    mono_em: 'em1',
    switch: 'switch',
    pm: 'pm',
    sensor: 'sensor'
};

const props = defineProps<{
    panelKey: string;
    currentScope: PanelScope;
}>();

const emit = defineEmits<{
    change: [scope: PanelScope];
}>();

const pickerPanelRef = ref<HTMLElement | null>(null);
const pickerTitleId = `dps-picker-${useId()}`;
const showPicker = ref(false);
const {handleKeydown: pickerKeydown} = useFocusTrap(
    pickerPanelRef,
    showPicker,
    () => closePicker()
);

const groupsStore = useGroupsStore();
const deviceStore = useDevicesStore();
const locationsStore = useLocationsStore();
const tagsStore = useTagsStore();

const wrapRef = ref<HTMLElement | null>(null);
const showDropdown = ref(false);
const pickerSearch = ref('');
const pickerSelected = ref(new Set<string>());

const groups = computed(() => Object.values(groupsStore.groups));
const locations = computed(() => Object.values(locationsStore.locations ?? {}));
const tags = computed(() => Object.values(tagsStore.tags ?? {}));

const dropdownPosition = computed(() => {
    if (!wrapRef.value) return {};
    const rect = wrapRef.value.getBoundingClientRect();
    return {
        position: 'fixed' as const,
        top: `${rect.bottom + 4}px`,
        right: `${window.innerWidth - rect.right}px`,
        zIndex: 9999
    };
});

const allDevices = computed(() => {
    return Object.entries(deviceStore.devices).map(([shellyId, dev]) => {
        const info = dev?.info;
        const status = dev?.status ?? {};
        let type = 'switch';
        for (let i = 0; i < 5; i++) {
            if (status[`em:${i}`] && i > 0) {
                type = '3ph_em';
                break;
            }
            if (status[`em1:${i}`]) {
                type = 'mono_em';
                break;
            }
            if (status[`pm1:${i}`]) {
                type = 'pm';
                break;
            }
        }
        if (type === 'switch') {
            for (const key of Object.keys(status)) {
                if (
                    key.startsWith('temperature:') ||
                    key.startsWith('humidity:') ||
                    key.startsWith('illuminance:')
                ) {
                    type = 'sensor';
                    break;
                }
            }
        }
        return {
            shellyId,
            name: info?.name ?? shellyId,
            typeLabel: TYPE_LABELS[type] ?? type
        };
    });
});

const filteredPickerDevices = computed(() => {
    if (!pickerSearch.value) return allDevices.value;
    const q = pickerSearch.value.toLowerCase();
    return allDevices.value.filter(
        (d) =>
            d.name.toLowerCase().includes(q) ||
            d.shellyId.toLowerCase().includes(q)
    );
});

function selectFleet() {
    emit('change', {scope: 'fleet'});
    showDropdown.value = false;
}

function selectGroup(groupId: number) {
    emit('change', {scope: 'group', groupId});
    showDropdown.value = false;
}

function selectLocation(locationId: number) {
    emit('change', {scope: 'location', locationId});
    showDropdown.value = false;
}

function selectTag(tagId: number) {
    emit('change', {scope: 'tag', tagId});
    showDropdown.value = false;
}

function openPicker() {
    showDropdown.value = false;
    pickerSearch.value = '';
    if (
        props.currentScope.scope === 'devices' &&
        props.currentScope.deviceIds
    ) {
        pickerSelected.value = new Set(props.currentScope.deviceIds);
    } else {
        pickerSelected.value = new Set();
    }
    showPicker.value = true;
}

function closePicker() {
    showPicker.value = false;
}

function togglePickerDevice(shellyId: string) {
    const next = new Set(pickerSelected.value);
    if (next.has(shellyId)) next.delete(shellyId);
    else next.add(shellyId);
    pickerSelected.value = next;
}

function applyPicker() {
    if (pickerSelected.value.size === 0) {
        emit('change', {scope: 'fleet'});
    } else {
        emit('change', {
            scope: 'devices',
            deviceIds: [...pickerSelected.value]
        });
    }
    showPicker.value = false;
}
</script>

<style scoped>
.dps { position: relative; display: inline-flex; }
.dps-trigger {
    background: none; border: none; cursor: pointer; padding: var(--space-0-5);
    color: var(--color-text-disabled); transition: color 0.2s;
    display: flex; align-items: center;
}
.dps-trigger:hover { color: var(--color-text-tertiary); }
.dps-icon { font-size: var(--type-body); }

/* Backdrop */
.dps-backdrop { position: fixed; inset: 0; z-index: 9998; }

/* Dropdown */
.dps-dropdown {
    background: rgba(var(--color-surface-1-rgb), 0.95);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    min-width: 180px;
    padding: var(--space-1) 0;
    max-height: 300px;
    overflow-y: auto;
    backdrop-filter: blur(var(--glass-1-blur));
}
.dps-option {
    padding: var(--space-2) var(--space-3);
    font-size: var(--type-body);
    color: var(--color-text-secondary);
    cursor: pointer;
    transition: background 0.15s;
}
.dps-option:hover { background: var(--state-hover-bg); }
.dps-option--active { color: var(--color-primary); font-weight: 500; }
.dps-divider { height: 1px; background: var(--color-border-subtle); margin: var(--space-1) 0; }
.dps-section {
    padding: var(--space-1) var(--space-3);
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
}

/* Modal */
.dps-modal-backdrop {
    position: fixed; inset: 0;
    background: var(--color-overlay);
    z-index: var(--z-modal, 10000);
    display: flex; align-items: center; justify-content: center;
}
.dps-modal {
    background: rgba(var(--color-surface-1-rgb), 0.97);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-xl);
    width: min(400px, 90vw);
    max-height: 500px;
    display: flex; flex-direction: column;
    box-shadow: var(--shadow-xl);
    backdrop-filter: blur(var(--glass-1-blur));
}
.dps-modal-header {
    display: flex; justify-content: space-between; align-items: center;
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--color-border-subtle);
}
.dps-modal-title { font-size: var(--type-body); font-weight: 600; color: var(--color-text-primary); }
.dps-modal-close { background: none; border: none; font-size: var(--type-subheading); color: var(--color-text-disabled); cursor: pointer; padding: var(--space-1); }
.dps-modal-close:hover { color: var(--color-text-tertiary); }

.dps-modal-search { padding: var(--space-2) var(--space-4); }
.dps-search-input {
    width: 100%;
    background: var(--color-surface-0);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    padding: var(--space-1-5) 10px;
    font-size: var(--type-body);
    color: var(--color-text-secondary);
    outline: none;
}
.dps-search-input:focus { border-color: var(--color-primary); }
.dps-search-input::placeholder { color: var(--color-text-disabled); }

.dps-modal-list {
    flex: 1; overflow-y: auto; padding: 0 var(--space-4);
    max-height: 300px;
}
.dps-device-row {
    display: flex; align-items: center; gap: var(--space-2);
    padding: var(--space-1-5) 0;
    border-bottom: 1px solid var(--color-border-subtle);
    cursor: pointer;
    font-size: var(--type-body);
}
.dps-device-row:last-child { border-bottom: none; }
.dps-device-row:hover { background: var(--state-hover-bg); }
.dps-device-row input[type="checkbox"] { accent-color: var(--color-primary); }
.dps-device-name { flex: 1; color: var(--color-text-secondary); }
.dps-device-type { font-size: var(--type-body); color: var(--color-text-disabled); }
.dps-picker-empty { padding: var(--space-4) 0; text-align: center; font-size: var(--type-body); color: var(--color-text-disabled); }

.dps-modal-footer {
    display: flex; justify-content: space-between; align-items: center;
    padding: 10px var(--space-4);
    border-top: 1px solid var(--color-border-subtle);
}
.dps-selected-count { font-size: var(--type-body); color: var(--color-text-tertiary); }
.dps-apply-btn {
    background: var(--color-primary);
    color: var(--color-text-primary);
    border: none;
    border-radius: var(--radius-md);
    padding: var(--space-1-5) var(--space-4);
    font-size: var(--type-body);
    font-weight: 500;
    cursor: pointer;
    transition: opacity 0.2s;
}
.dps-apply-btn:hover { opacity: 0.9; }
</style>
