<template>
    <PageTemplate
        title="Configurations"
        :count="filteredConfigCount"
        :tabs="tabs"
        fill
    >
        <template #actions>
            <Button v-if="canWrite" type="green" size="sm" title="New profile" aria-label="New profile" @click="openCreateProfileModal"><i class="fas fa-plus" /></Button>
            <Button v-if="canWrite && expandedProfile" type="green" size="sm" @click="openAddConfigModal(expandedProfile!)">Config</Button>
        </template>
        <div class="cfg-page">

        <!-- Filter bar -->
        <div class="dp-filter-bar">
            <div class="search-pill">
                <i class="fas fa-search search-pill__icon" />
                <input ref="searchInputRef" v-model.trim="searchQuery" type="text" class="search-pill__input"
                    :class="{'search-pill__input--filtered': !!searchQuery || hasActiveFilters}"
                    placeholder="Search configs…" aria-label="Search" />
                <button v-if="searchQuery" type="button" class="search-pill__clear" @click="searchQuery = ''"><i class="fas fa-xmark" /></button>
                <button type="button" class="search-pill__filter" :class="{'search-pill__filter--active': hasActiveFilters}" @click="filterModalVisible = true">
                    <i class="fas fa-filter" />
                    <span v-if="activeFilterCount > 0" class="cfg-filter-badge">{{ activeFilterCount }}</span>
                </button>
            </div>
            <div class="route-tabs">
                <div class="route-tabs__track" :class="{'route-tabs__track--end': viewMode === 'json'}" />
                <button type="button" class="route-tabs__btn" :class="{'route-tabs__btn--active': viewMode === 'structured'}" @click="viewMode = 'structured'">Config</button>
                <button type="button" class="route-tabs__btn" :class="{'route-tabs__btn--active': viewMode === 'json'}" @click="viewMode = 'json'">JSON</button>
            </div>
        </div>
        <div v-if="hasActiveFilters" class="cfg-chips">
            <span v-if="filters.profile" class="cfg-chip" @click="filters.profile = ''"><i class="fas fa-folder" /> {{ filters.profile }} <i class="fas fa-xmark cfg-chip__x" /></span>
            <span v-if="filters.ws" class="cfg-chip" @click="filters.ws = ''"><i class="fas fa-plug" /> WS: {{ filters.ws }} <i class="fas fa-xmark cfg-chip__x" /></span>
            <span v-if="filters.wifi" class="cfg-chip" @click="filters.wifi = ''"><i class="fas fa-wifi" /> WiFi: {{ filters.wifi }} <i class="fas fa-xmark cfg-chip__x" /></span>
            <span v-if="filters.mqtt" class="cfg-chip" @click="filters.mqtt = ''"><i class="fas fa-tower-broadcast" /> MQTT: {{ filters.mqtt }} <i class="fas fa-xmark cfg-chip__x" /></span>
            <span v-if="filters.bt" class="cfg-chip" @click="filters.bt = ''"><i class="fab fa-bluetooth-b" /> BT: {{ filters.bt }} <i class="fas fa-xmark cfg-chip__x" /></span>
            <span v-if="filters.power" class="cfg-chip" @click="filters.power = ''"><i class="fas fa-power-off" /> {{ filters.power }} <i class="fas fa-xmark cfg-chip__x" /></span>
            <button type="button" class="cfg-chip cfg-chip--clear" @click="clearFilters">Clear all</button>
        </div>

        <!-- ═══ TWO INDEPENDENT CARDS ═══ -->
        <div class="cfg-layout">
            <!-- LEFT CARD -->
            <div class="cfg-card cfg-left">
                <!-- Filtered flat list -->
                <template v-if="hasActiveFilters || searchQuery">
                    <button v-for="item in filteredConfigsFlat" :key="item.profile + '/' + item.key" class="cfg-item" :class="{'cfg-item--active': selectedConfigKey === item.key && profile === item.profile}" @click="selectFlatConfig(item)">
                        <span class="cfg-item__dot" :class="{'cfg-item__dot--active': selectedConfigKey === item.key && profile === item.profile}" />
                        <div class="cfg-item__text">
                            <span class="cfg-item__name">{{ item.data.name || item.key }}</span>
                            <span class="cfg-item__sub">{{ item.profile }}</span>
                        </div>
                    </button>
                    <div v-if="filteredConfigsFlat.length === 0" class="cfg-empty cfg-empty--sm">No matches</div>
                </template>

                <!-- Profile cards -->
                <template v-else>
                    <div v-for="profileName in profileKeys" :key="profileName" class="cfg-profile">
                        <!-- Profile header -->
                        <div class="cfg-profile__head" @click="toggleProfile(profileName)">
                            <span class="cfg-profile__icon" @click.stop="openIconPicker(profileName)">
                                <i :class="getProfileIcon(profileName)" />
                            </span>
                            <div class="cfg-profile__info">
                                <span class="cfg-profile__name">{{ profileName }}</span>
                                <span class="cfg-profile__meta">
                                    {{ configCount(profileName) }} config{{ configCount(profileName) === '1' ? '' : 's' }}
                                    <template v-if="boundGroups[profileName]?.length"> · {{ boundGroups[profileName].length }} group{{ boundGroups[profileName].length === 1 ? '' : 's' }}</template>
                                </span>
                            </div>
                            <i class="fas fa-chevron-down cfg-profile__arrow" :class="{'cfg-profile__arrow--open': expandedProfile === profileName}" />
                        </div>

                        <!-- Config list inside profile -->
                        <div v-if="expandedProfile === profileName" class="cfg-profile__body">
                            <button v-for="(config, key) in configs" :key="key" class="cfg-item" :class="{'cfg-item--active': selectedConfigKey === key}" @click="selectConfig(String(key), config)">
                                <span class="cfg-item__dot" :class="{'cfg-item__dot--active': selectedConfigKey === key}" />
                                <span class="cfg-item__name">{{ config.name || key }}</span>
                            </button>
                            <div v-if="Object.keys(configs).length === 0" class="cfg-empty cfg-empty--sm">No configs in this profile</div>
                            <div class="cfg-profile__foot">
                                <Button v-if="canWrite" type="green" size="sm" @click.stop="openAddConfigModal(profileName)">Config</Button>
                                <Button v-if="canWrite" type="red" size="sm" @click.stop="deleteProfile(profileName)">Delete</Button>
                            </div>
                        </div>
                    </div>
                </template>

                <div v-if="profileKeys.length === 0 && !hasActiveFilters && !searchQuery" class="cfg-empty">
                    <i class="fas fa-folder-open cfg-empty__icon" />
                    <span>No profiles yet</span>
                </div>
            </div>

            <!-- RIGHT CARD -->
            <div class="cfg-card cfg-right">
                <div v-if="!selectedConfigKey" class="cfg-placeholder">
                    <i class="fas fa-arrow-left cfg-placeholder__icon" />
                    <span class="cfg-placeholder__text">Select a configuration</span>
                </div>
                <template v-else>
                    <div class="cfg-detail__head">
                        <span class="cfg-detail__title">{{ selectedConfigKey }}</span>
                        <div class="cfg-detail__actions">
                            <Button v-if="canWrite && deployGroups.length > 0" type="green" size="sm" @click="deployModalVisible = true">Deploy</Button>
                            <Button v-if="canWrite && !inlineEditing" type="blue-hollow" size="sm" @click="startInlineEdit">Edit</Button>
                            <Button v-if="canWrite && inlineEditing" type="blue" size="sm" @click="saveInlineEdit">Save</Button>
                            <Button v-if="canWrite && inlineEditing" type="blue-hollow" size="sm" @click="cancelInlineEdit">Cancel</Button>
                            <Button v-if="canWrite && !inlineEditing" type="red" size="sm" @click="deleteConfig(selectedConfigKey)">Delete</Button>
                        </div>
                    </div>
                    <div class="cfg-detail__body">
                        <div v-if="viewMode === 'structured'" class="cfg-sections">
                            <div v-for="section in settings" :key="section.title" class="cfg-row">
                                <div class="cfg-row__head">
                                    <i :class="sectionIcons[section.title] || 'fas fa-cog'" class="cfg-row__icon" />
                                    <span class="cfg-row__title">{{ section.title }}</span>
                                    <template v-if="!inlineEditing" v-for="opt in section.options" :key="opt.key">
                                        <span v-if="opt.type === 'checkbox' && (opt.label === 'Enabled' || opt.label === 'Enable')" class="cfg-row__status" :class="getNestedValue(selectedConfig, opt.key) ? 'cfg-row__status--on' : 'cfg-row__status--off'">
                                            {{ getNestedValue(selectedConfig, opt.key) ? '✓' : '✗' }}
                                        </span>
                                    </template>
                                </div>
                                <div class="cfg-row__fields">
                                    <div v-for="option in section.options" :key="option.key" class="cfg-row__field">
                                        <span class="cfg-row__label">{{ option.label }}</span>
                                        <template v-if="inlineEditing">
                                            <Input v-if="option.type === 'input'" class="cfg-row__input" :modelValue="getNestedValue(newConfig, option.key) || ''" @update:modelValue="(val: any) => updateOptionValue(option.key, val)" :placeholder="(option as any).placeholder" />
                                            <Dropdown v-else-if="option.type === 'dropdown'" class="cfg-row__input" :options="(option as any).options" :default="getNestedValue(newConfig, option.key)" @selected="value => updateOptionValue(option.key, value)" />
                                            <span v-else-if="option.type === 'checkbox'" class="cfg-row__check">
                                                <Checkbox :id="option.key + '-edit'" :modelValue="getNestedValue(newConfig, option.key) || false" @update:modelValue="(val: any) => updateOptionValue(option.key, val)" />
                                            </span>
                                        </template>
                                        <span v-else class="cfg-row__value">
                                            <template v-if="typeof getNestedValue(selectedConfig, option.key) === 'boolean'">
                                                <i :class="getNestedValue(selectedConfig, option.key) ? 'fas fa-check-circle cfg-on' : 'fas fa-times-circle cfg-off'" />
                                            </template>
                                            <span v-else-if="isVarRef(getNestedValue(selectedConfig, option.key))" class="cfg-var-ref"><i class="fas fa-dollar-sign" /> {{ getNestedValue(selectedConfig, option.key) }}</span>
                                            <template v-else>{{ getNestedValue(selectedConfig, option.key) ?? '—' }}</template>
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div v-else class="cfg-json">
                            <JsonEditor v-if="inlineEditing" v-model="jsonText" :editable="true" placeholder="Enter JSON configuration…" />
                            <JSONViewer v-else :data="selectedConfig" />
                        </div>
                    </div>
                </template>
            </div>
        </div>
        </div>

        <template #modals>
            <FilterModal :visible="filterModalVisible" :sections="filterSections" :initial-state="filterState" :match-count="filteredConfigCount" title="Filter Configurations" match-label="configs" @close="filterModalVisible = false" @apply-generic="applyFilters" />
            <ConfigurationsCreateProfileModal
                v-model:name="newProfileName"
                :visible="createProfileModal"
                :error="profileNameError"
                @close="createProfileModal = false"
                @submit="createProfile"
                @validate="validateProfileName"
            />
            <ConfigurationsConfigFormModal
                :visible="configModalVisible"
                :editing-key="editingConfigKey"
                :settings="settings"
                :config="newConfig"
                :get-nested-value="getNestedValue"
                @close="closeConfigModal"
                @save="saveConfiguration"
                @create="addNewConfiguration"
                @update="updateOptionValue"
            />
            <ConfirmationModal ref="modalRef">
                <template #title><h3>Delete this item?</h3></template>
            </ConfirmationModal>
            <IconPickerModal
                :visible="iconPickerVisible"
                :selected-glyph="iconPickerCurrent"
                @close="iconPickerVisible = false"
                @pick="applyProfileIcon"
            />
            <ConfigDeployModal
                :visible="deployModalVisible"
                :config-name="selectedConfigKey"
                :config="selectedConfig"
                :groups="deployGroups"
                @close="deployModalVisible = false"
            />
        </template>
    </PageTemplate>
</template>

<script setup lang="ts">
import '@/styles/device-page.css';
import {useLocalStorage} from '@vueuse/core';
import {
    type ComputedRef,
    computed,
    defineAsyncComponent,
    inject,
    onMounted,
    reactive,
    ref,
    watch
} from 'vue';
import Button from '@/components/core/Button.vue';
import Checkbox from '@/components/core/Checkbox.vue';
import Dropdown from '@/components/core/Dropdown.vue';
import FilterModal, {
    type FilterSection,
    type FilterState
} from '@/components/core/FilterModal.vue';
import IconPickerModal from '@/components/core/IconPickerModal.vue';
import Input from '@/components/core/Input.vue';
import JSONViewer from '@/components/core/JSONViewer.vue';
import PageTemplate from '@/components/core/PageTemplate.vue';
import ConfigDeployModal from '@/components/modals/ConfigDeployModal.vue';
import ConfirmationModal from '@/components/modals/ConfirmationModal.vue';
import ConfigurationsConfigFormModal from '@/components/pages/configurations/ConfigurationsConfigFormModal.vue';
import ConfigurationsCreateProfileModal from '@/components/pages/configurations/ConfigurationsCreateProfileModal.vue';
import {usePermissions} from '@/composables/usePermissions';
import {FLEET_MANAGER_WEBSOCKET} from '@/constants';
import {
    getNestedValue,
    isVarRef,
    nestConfig,
    setNestedValue
} from '@/helpers/configPaths';
import {useGroupsStore} from '@/stores/groups';
import {useToastStore} from '@/stores/toast';
import * as ws from '@/tools/websocket';
import type {RouteTab} from '@/types/page-template';

const JsonEditor = defineAsyncComponent(
    () => import('@/components/core/JsonEditor.vue')
);

const tabs = inject<ComputedRef<RouteTab[]>>(
    'settingsTabs',
    computed(() => [])
);

const {canWrite} = usePermissions();
const groupStore = useGroupsStore();
const toast = useToastStore();
const configsRegistry = ws.getRegistry('configs');
const initialLoading = ref(true);

// ── Core state ──

const allProfiles = ref<Record<string, Record<string, any>>>({});
// Tracks which profile bodies have been fetched. Lets configCount /
// getProfileIcon distinguish "not loaded yet" from "loaded, empty".
const loadedProfiles = ref(new Set<string>());
const profile = ref('');
const expandedProfile = ref<string | null>(null);
const configs = ref<Record<string, any>>({});
const selectedConfig = ref<Record<string, unknown>>({});
const selectedConfigKey = ref('');
const viewMode = ref<'json' | 'structured'>('structured');
const searchQuery = ref('');

const profileKeys = computed(() => Object.keys(allProfiles.value));

function configCount(profileName: string): string {
    if (!loadedProfiles.value.has(profileName)) return '…';
    const p = allProfiles.value[profileName];
    if (!p || typeof p !== 'object') return '0';
    return String(Object.keys(p).filter((k) => k !== '__meta').length);
}

// Groups that reference each profile via metadata.configProfile
const boundGroups = computed(() => {
    const map: Record<
        string,
        Array<{id: number; name: string; deviceCount: number}>
    > = {};
    for (const group of Object.values(groupStore.groups)) {
        const cp = (group.metadata as any)?.configProfile;
        if (cp && typeof cp === 'string') {
            if (!map[cp]) map[cp] = [];
            map[cp].push({
                id: group.id,
                name: group.name,
                deviceCount: group.devices?.length ?? 0
            });
        }
    }
    return map;
});

// ── Profile icons ──

const iconPickerVisible = ref(false);
const iconPickerTarget = ref('');
const iconPickerCurrent = ref('');

function getProfileIcon(profileName: string): string {
    const p = allProfiles.value[profileName] as any;
    return p?.__meta?.icon || 'fas fa-folder';
}

function openIconPicker(profileName: string) {
    iconPickerTarget.value = profileName;
    iconPickerCurrent.value = getProfileIcon(profileName);
    iconPickerVisible.value = true;
}

async function applyProfileIcon(icon: string) {
    const profileName = iconPickerTarget.value;
    if (!profileName) return;
    const profileData: Record<string, any> =
        (await configsRegistry.getItem(profileName)) || {};
    profileData.__meta = {...(profileData.__meta || {}), icon};
    await configsRegistry.setItem(profileName, profileData);
    await refreshProfileData(profileName);
    iconPickerVisible.value = false;
}

// ── Deploy ──

const deployModalVisible = ref(false);
const deployGroups = computed(() => {
    if (!profile.value) return [];
    const groups = boundGroups.value[profile.value] ?? [];
    return groups.map((g) => {
        const full = groupStore.groups[g.id];
        return {...g, devices: full?.devices ?? []};
    });
});

// ── Filters ──

const filterModalVisible = ref(false);
const filters = reactive({
    profile: '',
    ws: '',
    wifi: '',
    mqtt: '',
    bt: '',
    power: ''
});
const hasActiveFilters = computed(() => Object.values(filters).some(Boolean));
const activeFilterCount = computed(
    () => Object.values(filters).filter(Boolean).length
);

function clearFilters() {
    Object.assign(filters, {
        profile: '',
        ws: '',
        wifi: '',
        mqtt: '',
        bt: '',
        power: ''
    });
}

const filterSections = computed<FilterSection[]>(() => [
    {
        key: 'profile',
        label: 'Profile',
        icon: 'fa-folder',
        singleSelect: true,
        options: profileKeys.value.map((p) => ({key: p, label: p}))
    },
    {
        key: 'ws',
        label: 'Websocket',
        icon: 'fa-plug',
        singleSelect: true,
        options: [
            {key: 'enabled', label: 'Enabled'},
            {key: 'disabled', label: 'Disabled'}
        ]
    },
    {
        key: 'wifi',
        label: 'Wi-Fi',
        icon: 'fa-wifi',
        singleSelect: true,
        options: [
            {key: 'enabled', label: 'Enabled'},
            {key: 'disabled', label: 'Disabled'}
        ]
    },
    {
        key: 'mqtt',
        label: 'MQTT',
        icon: 'fa-tower-broadcast',
        singleSelect: true,
        options: [
            {key: 'enabled', label: 'Enabled'},
            {key: 'disabled', label: 'Disabled'}
        ]
    },
    {
        key: 'bt',
        label: 'Bluetooth',
        icon: 'fa-bluetooth-b',
        singleSelect: true,
        options: [
            {key: 'enabled', label: 'Enabled'},
            {key: 'disabled', label: 'Disabled'}
        ]
    },
    {
        key: 'power',
        label: 'Power On',
        icon: 'fa-power-off',
        singleSelect: true,
        options: ['on', 'off', 'restore_last', 'match_input'].map((v) => ({
            key: v,
            label: v
        }))
    }
]);

const filterState = computed<FilterState>(() => {
    const s: FilterState = {};
    for (const [k, v] of Object.entries(filters)) {
        if (v) s[k] = [v];
    }
    return s;
});

function applyFilters(state: FilterState) {
    filters.profile = state.profile?.[0] ?? '';
    filters.ws = state.ws?.[0] ?? '';
    filters.wifi = state.wifi?.[0] ?? '';
    filters.mqtt = state.mqtt?.[0] ?? '';
    filters.bt = state.bt?.[0] ?? '';
    filters.power = state.power?.[0] ?? '';
}

// ── Flat config list for filtering ──

interface FlatConfig {
    profile: string;
    key: string;
    data: any;
}

const allConfigsFlat = computed<FlatConfig[]>(() => {
    const result: FlatConfig[] = [];
    for (const [prof, configs] of Object.entries(allProfiles.value)) {
        if (!configs || typeof configs !== 'object') continue;
        for (const [key, data] of Object.entries(configs)) {
            if (key === '__meta') continue;
            result.push({profile: prof, key, data});
        }
    }
    return result;
});

function matchesBoolFilter(
    data: any,
    rule: {path: string; filter: string}
): boolean {
    if (!rule.filter) return true;
    const val = getNestedValue(data, rule.path);
    return rule.filter === 'enabled' ? val === true : val !== true;
}

const filteredConfigsFlat = computed(() => {
    let result = allConfigsFlat.value;
    if (filters.profile)
        result = result.filter((c) => c.profile === filters.profile);
    if (filters.ws)
        result = result.filter((c) =>
            matchesBoolFilter(c.data, {path: 'ws.enable', filter: filters.ws})
        );
    if (filters.wifi)
        result = result.filter((c) =>
            matchesBoolFilter(c.data, {path: 'wifi.sta.enable', filter: filters.wifi})
        );
    if (filters.mqtt)
        result = result.filter((c) =>
            matchesBoolFilter(c.data, {path: 'mqtt.enable', filter: filters.mqtt})
        );
    if (filters.bt)
        result = result.filter((c) =>
            matchesBoolFilter(c.data, {path: 'bluetooth.enable', filter: filters.bt})
        );
    if (filters.power)
        result = result.filter(
            (c) =>
                getNestedValue(c.data, 'switch.initial_state') === filters.power
        );
    if (searchQuery.value) {
        const q = searchQuery.value.toLowerCase();
        result = result.filter(
            (c) =>
                (c.data.name || c.key).toLowerCase().includes(q) ||
                JSON.stringify(c.data).toLowerCase().includes(q)
        );
    }
    return result;
});

const filteredConfigCount = computed(() =>
    hasActiveFilters.value || searchQuery.value
        ? filteredConfigsFlat.value.length
        : allConfigsFlat.value.length
);

function selectFlatConfig(item: FlatConfig) {
    profile.value = item.profile;
    expandedProfile.value = item.profile;
    selectedConfig.value = item.data;
    selectedConfigKey.value = item.key;
    refreshConfigs();
}

// ── Settings schema ──

const sectionIcons: Record<string, string> = {
    Name: 'fas fa-tag',
    System: 'fas fa-microchip',
    LED: 'fas fa-lightbulb',
    Websocket: 'fas fa-plug',
    'Wi-Fi': 'fas fa-wifi',
    MQTT: 'fas fa-tower-broadcast',
    Bluetooth: 'fab fa-bluetooth-b',
    Switch: 'fas fa-toggle-on',
    Cover: 'fas fa-window-maximize',
    Input: 'fas fa-circle-dot'
};

const settings = [
    // ── Universal (all devices) ──
    {
        title: 'Name',
        options: [
            {
                label: 'Config Name',
                key: 'name',
                placeholder: 'My configuration',
                type: 'input'
            }
        ]
    },
    {
        title: 'System',
        options: [
            {
                label: 'Device Name',
                key: 'sys.device.name',
                type: 'input',
                placeholder: 'Device display name'
            },
            {label: 'Eco Mode', key: 'sys.device.eco_mode', type: 'checkbox'}
        ]
    },
    {
        title: 'LED',
        options: [
            {
                label: 'LED Mode',
                key: 'sys_led.mode',
                options: ['power', 'switch', 'off'],
                type: 'dropdown'
            }
        ]
    },
    {
        title: 'Websocket',
        options: [
            {
                label: 'Server',
                key: 'ws.server',
                type: 'input',
                placeholder: 'Fleet Manager address'
            },
            {label: 'Enabled', key: 'ws.enable', type: 'checkbox'}
        ]
    },
    {
        title: 'Wi-Fi',
        options: [
            {
                label: 'SSID',
                key: 'wifi.sta.ssid',
                type: 'input',
                placeholder: 'Wi-Fi name'
            },
            {
                label: 'Password',
                key: 'wifi.sta.pass',
                type: 'input',
                placeholder: 'Wi-Fi password'
            },
            {label: 'Enabled', key: 'wifi.sta.enable', type: 'checkbox'},
            {
                label: 'SSID 2',
                key: 'wifi.sta1.ssid',
                type: 'input',
                placeholder: 'Backup Wi-Fi name'
            },
            {
                label: 'Password 2',
                key: 'wifi.sta1.pass',
                type: 'input',
                placeholder: 'Backup Wi-Fi password'
            },
            {label: 'Enabled 2', key: 'wifi.sta1.enable', type: 'checkbox'},
            {
                label: 'AP Password',
                key: 'wifi.ap.pass',
                type: 'input',
                placeholder: 'Access point password'
            },
            {label: 'AP Enabled', key: 'wifi.ap.enable', type: 'checkbox'}
        ]
    },
    {
        title: 'MQTT',
        options: [
            {label: 'Enabled', key: 'mqtt.enable', type: 'checkbox'},
            {
                label: 'Server',
                key: 'mqtt.server',
                type: 'input',
                placeholder: 'MQTT broker address'
            },
            {
                label: 'User',
                key: 'mqtt.user',
                type: 'input',
                placeholder: 'Username'
            },
            {
                label: 'Client ID',
                key: 'mqtt.client_id',
                type: 'input',
                placeholder: 'Client ID'
            },
            {
                label: 'Topic Prefix',
                key: 'mqtt.topic_prefix',
                type: 'input',
                placeholder: 'Topic prefix'
            }
        ]
    },
    {
        title: 'Bluetooth',
        options: [{label: 'Enabled', key: 'bluetooth.enable', type: 'checkbox'}]
    },
    // ── Device-type specific ──
    {
        title: 'Switch',
        options: [
            {
                label: 'Initial State',
                key: 'switch.initial_state',
                options: ['on', 'off', 'restore_last', 'match_input'],
                type: 'dropdown'
            },
            {
                label: 'Auto On Delay',
                key: 'switch.auto_on_delay',
                type: 'input',
                placeholder: 'Seconds'
            },
            {label: 'Auto On', key: 'switch.auto_on', type: 'checkbox'},
            {
                label: 'Auto Off Delay',
                key: 'switch.auto_off_delay',
                type: 'input',
                placeholder: 'Seconds'
            },
            {label: 'Auto Off', key: 'switch.auto_off', type: 'checkbox'},
            {
                label: 'Power Limit (W)',
                key: 'switch.power_limit',
                type: 'input',
                placeholder: 'Max watts'
            }
        ]
    },
    {
        title: 'Cover',
        options: [
            {label: 'Swap Inputs', key: 'cover.swap_inputs', type: 'checkbox'},
            {
                label: 'Invert Directions',
                key: 'cover.invert_directions',
                type: 'checkbox'
            }
        ]
    },
    {
        title: 'Input',
        options: [
            {
                label: 'Type',
                key: 'input.type',
                options: ['button', 'switch', 'analog'],
                type: 'dropdown'
            },
            {label: 'Invert', key: 'input.invert', type: 'checkbox'}
        ]
    }
];

// ── Helpers ──


// ── Validation ──

const createProfileModal = ref(false);
const newProfileName = ref('');
const profileNameError = ref('');

function validateProfileName(): boolean {
    if (!newProfileName.value.trim()) {
        profileNameError.value = 'Name is required';
        return false;
    }
    if (allProfiles.value[newProfileName.value.trim()]) {
        profileNameError.value = 'Already exists';
        return false;
    }
    profileNameError.value = '';
    return true;
}

// ── Config form ──

const configModalVisible = ref(false);
const editingConfigKey = ref<string | null>(null);
const newConfig = ref<Record<string, any>>({});
const modalRef = ref<InstanceType<typeof ConfirmationModal>>();

function createDefaultConfig(): Record<string, any> {
    return {
        name: 'My configuration',
        sys: {device: {name: '', eco_mode: false}},
        sys_led: {mode: 'power'},
        ws: {
            server: useLocalStorage(
                'propose-ws',
                `${FLEET_MANAGER_WEBSOCKET}/shelly`
            ),
            enable: false
        },
        wifi: {
            ap: {pass: '', enable: false},
            sta: {enable: false, ssid: '', pass: ''},
            sta1: {enable: false, ssid: '', pass: ''}
        },
        mqtt: {
            enable: false,
            server: '',
            user: '',
            client_id: '',
            topic_prefix: ''
        },
        bluetooth: {enable: false},
        switch: {
            auto_on_delay: '',
            auto_on: false,
            auto_off_delay: '',
            auto_off: false,
            initial_state: '',
            power_limit: ''
        },
        cover: {swap_inputs: false, invert_directions: false},
        input: {type: 'button', invert: false}
    };
}

function updateOptionValue(key: string, value: any) {
    setNestedValue(newConfig.value, {path: key, value});
}

// ── Actions ──

async function toggleProfile(name: string) {
    if (expandedProfile.value === name) {
        expandedProfile.value = null;
        selectedConfig.value = {};
        selectedConfigKey.value = '';
        return;
    }
    expandedProfile.value = name;
    profile.value = name;
    selectedConfig.value = {};
    selectedConfigKey.value = '';
    // Lazy populate sidebar metadata (count, icon) for this profile.
    await loadProfileData(name);
    refreshConfigs();
}

function selectConfig(key: string, config: any) {
    selectedConfig.value = config;
    selectedConfigKey.value = key;
    inlineEditing.value = false;
}

function openCreateProfileModal() {
    newProfileName.value = '';
    profileNameError.value = '';
    createProfileModal.value = true;
}

function openAddConfigModal(profileName: string) {
    profile.value = profileName;
    editingConfigKey.value = null;
    newConfig.value = createDefaultConfig();
    configModalVisible.value = true;
}

const inlineEditing = ref(false);
const jsonText = ref('');

function startInlineEdit() {
    editingConfigKey.value = selectedConfigKey.value;
    newConfig.value = JSON.parse(JSON.stringify(selectedConfig.value));
    jsonText.value = JSON.stringify(selectedConfig.value, null, 2);
    inlineEditing.value = true;
}

function cancelInlineEdit() {
    inlineEditing.value = false;
    editingConfigKey.value = null;
}

function parseJsonEdit(): Record<string, any> | null {
    try {
        return JSON.parse(jsonText.value);
    } catch {
        toast.error('Cannot save — JSON is invalid');
        return null;
    }
}

function buildConfigFromForm(): Record<string, any> {
    const nested = nestConfig(newConfig.value);
    return {
        ...nested,
        name: newConfig.value.name || 'My configuration',
        ws: {
            server: newConfig.value.ws?.server || '',
            enable: newConfig.value.ws?.enable || false
        }
    };
}

async function saveInlineEdit() {
    if (!editingConfigKey.value) return;
    const config =
        viewMode.value === 'json' ? parseJsonEdit() : buildConfigFromForm();
    if (!config) return;
    try {
        configs.value[editingConfigKey.value] = config;
        await saveConfigsToRegistry();
        toast.success('Configuration saved');
        inlineEditing.value = false;
        await refreshConfigs();
        selectConfig(
            editingConfigKey.value,
            configs.value[editingConfigKey.value]
        );
        editingConfigKey.value = null;
    } catch {
        toast.error('Failed to save configuration');
    }
}

function closeConfigModal() {
    configModalVisible.value = false;
    editingConfigKey.value = null;
}

// ── API ──

async function createProfile() {
    if (!validateProfileName()) return;
    try {
        const name = newProfileName.value.trim();
        await configsRegistry.setItem(name, {});
        toast.success('Profile created');
        createProfileModal.value = false;
        await fetchAllProfiles();
        // Pre-warm the new profile's cache so its sidebar count/icon
        // render correctly without waiting for an expand click.
        await loadProfileData(name);
    } catch {
        toast.error('Failed to create profile');
    }
}

async function deleteProfile(name: string) {
    modalRef.value?.storeAction(async () => {
        try {
            await configsRegistry.removeItem(name);
            toast.success(`Deleted profile '${name}'`);
            if (expandedProfile.value === name) {
                expandedProfile.value = null;
                selectedConfig.value = {};
                selectedConfigKey.value = '';
            }
            await fetchAllProfiles();
        } catch {
            toast.error(`Failed to delete profile '${name}'`);
        }
    });
}

// Save configs while preserving __meta (icon, etc.)
async function saveConfigsToRegistry() {
    const existing: Record<string, any> =
        (await configsRegistry.getItem(profile.value)) || {};
    const toSave: Record<string, any> = {...configs.value};
    if (existing.__meta) toSave.__meta = existing.__meta;
    await configsRegistry.setItem(profile.value, toSave);
}

async function addNewConfiguration() {
    try {
        const nested = nestConfig(newConfig.value);
        const key = newConfig.value.name || 'My configuration';
        configs.value[key] = {
            ...nested,
            name: key,
            ws: {
                server: newConfig.value.ws?.server || '',
                enable: newConfig.value.ws?.enable || false
            }
        };
        await saveConfigsToRegistry();
        toast.success('Configuration created');
        closeConfigModal();
        await refreshConfigs();
        // Only the active profile's body changed — keys-list is stable.
        if (profile.value) await refreshProfileData(profile.value);
    } catch {
        toast.error('Failed to create configuration');
    }
}

async function saveConfiguration() {
    if (!editingConfigKey.value) return;
    try {
        const nested = nestConfig(newConfig.value);
        configs.value[editingConfigKey.value] = {
            ...nested,
            name: newConfig.value.name || 'My configuration',
            ws: {
                server: newConfig.value.ws?.server || '',
                enable: newConfig.value.ws?.enable || false
            }
        };
        await saveConfigsToRegistry();
        toast.success('Configuration saved');
        closeConfigModal();
        await refreshConfigs();
        selectConfig(
            editingConfigKey.value,
            configs.value[editingConfigKey.value]
        );
    } catch {
        toast.error('Failed to save configuration');
    }
}

async function deleteConfig(name: string) {
    modalRef.value?.storeAction(async () => {
        try {
            selectedConfig.value = {};
            selectedConfigKey.value = '';
            delete configs.value[name];
            await saveConfigsToRegistry();
            toast.success(`Deleted '${name}'`);
            // Only the active profile's body changed — keys-list is stable.
            if (profile.value) await refreshProfileData(profile.value);
        } catch {
            toast.error(`Failed to delete '${name}'`);
        }
    });
}

// Lazy load: keys-only first pass so the page renders without pulling
// the whole registry (~50KB × N profiles). Profile bodies fill in on
// expand via loadProfileData(), or in bulk via ensureAllProfilesLoaded()
// the first time a filter is applied.
async function fetchAllProfiles() {
    const keys = ((await configsRegistry.keys()) as string[]) ?? [];
    const next: Record<string, Record<string, any>> = {};
    for (const k of keys) {
        // Preserve previously-loaded body so a refresh doesn't blank
        // out icons / counts the user already sees.
        next[k] = allProfiles.value[k] ?? {};
    }
    allProfiles.value = next;
    // Drop any cache entries whose key no longer exists. Snapshot before
    // mutating so we don't lean on Set's "delete during iteration" rules.
    for (const k of [...loadedProfiles.value]) {
        if (!(k in next)) loadedProfiles.value.delete(k);
    }
}

async function loadProfileData(name: string) {
    if (loadedProfiles.value.has(name)) return;
    const data =
        ((await configsRegistry.getItem(name)) as Record<string, any>) || {};
    allProfiles.value = {...allProfiles.value, [name]: data};
    loadedProfiles.value.add(name);
}

// Drop one profile from the lazy cache + re-fetch its body. Used after
// a mutation (add/edit/remove config, icon change, etc) so the sidebar
// metadata and any open filter results reflect the server's new state.
async function refreshProfileData(name: string) {
    loadedProfiles.value.delete(name);
    await loadProfileData(name);
}

let allLoadInFlight: Promise<void> | null = null;
async function ensureAllProfilesLoaded() {
    if (allLoadInFlight) return allLoadInFlight;
    const missing = profileKeys.value.filter(
        (k) => !loadedProfiles.value.has(k)
    );
    if (missing.length === 0) return;
    allLoadInFlight = (async () => {
        await Promise.all(missing.map((k) => loadProfileData(k)));
    })();
    try {
        await allLoadInFlight;
    } finally {
        allLoadInFlight = null;
    }
}

async function refreshConfigs() {
    if (!profile.value) {
        configs.value = {};
        return;
    }
    const raw: Record<string, any> =
        (await configsRegistry.getItem(profile.value)) || {};
    const {__meta, ...rest} = raw;
    configs.value = rest;
}

onMounted(async () => {
    try {
        await fetchAllProfiles();
        if (profileKeys.value.length > 0) {
            const first = profileKeys.value[0];
            profile.value = first;
            expandedProfile.value = first;
            await loadProfileData(first);
            await refreshConfigs();
        }
    } catch {
        toast.error('Failed to load configurations');
    } finally {
        initialLoading.value = false;
    }
});

// Cross-profile filtering needs every body. Trigger a bulk fetch the
// first time any filter chip becomes non-empty.
watch(
    () => Object.values(filters).some((v) => !!v),
    (anyActive) => {
        if (anyActive) void ensureAllProfilesLoaded();
    }
);
</script>

<style scoped>
/* ── Page container ── */
.cfg-page { display: flex; flex-direction: column; flex: 1; min-height: 0; gap: var(--gap-xs); }
.cfg-chips { display: flex; flex-wrap: wrap; gap: var(--gap-xs); padding: 0 var(--gap-md); }

/* ── Two separate frosted cards side by side ── */
.cfg-layout {
    display: flex;
    gap: var(--gap-sm);
    flex: 1;
    min-height: 0;
}
@media (max-width: 768px) { .cfg-layout { flex-direction: column; } }

/* ── Frosted glass card — replaces BasicBlock (no wrapper divs, clean flex chain) ── */
.cfg-card {
    background: var(--glass-1-bg);
    backdrop-filter: blur(var(--glass-1-blur));
    -webkit-backdrop-filter: blur(var(--glass-1-blur));
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-lg);
    padding: var(--gap-sm);
}

/* ── Left card — always 38.2% (golden ratio) ── */
.cfg-left {
    flex: 0 0 38.2%;
    display: flex;
    flex-direction: column;
    gap: var(--gap-xs);
    overflow-y: auto;
    min-width: 0;
}
@media (max-width: 768px) { .cfg-left { flex: none; } }

/* ── Right card — 61.8%, JSON fills full height ── */
.cfg-right {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
}

/* ── Empty / placeholder ── */
.cfg-empty {
    padding: var(--gap-lg);
    text-align: center;
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--gap-xs);
}
.cfg-empty--sm { padding: var(--gap-sm); }
.cfg-empty__icon { font-size: var(--type-heading); opacity: 0.2; }

.cfg-placeholder {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--gap-sm);
    color: var(--color-text-tertiary);
}
.cfg-placeholder__icon { font-size: var(--type-heading); opacity: 0.2; }
.cfg-placeholder__text { font-size: var(--type-subheading); font-weight: var(--font-semibold); }

/* ── Profile card (Option B) ── */
.cfg-profile {
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    overflow: hidden;
}
.cfg-profile + .cfg-profile { margin-top: var(--gap-xs); }

.cfg-profile__head {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
    padding: var(--gap-sm);
    cursor: pointer;
    transition: background var(--duration-fast);
}
.cfg-profile__head:hover { background: var(--color-surface-3); }

.cfg-profile__icon {
    width: var(--touch-target-min);
    height: var(--touch-target-min);
    border-radius: var(--radius-md);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    background: rgba(var(--ar-action), 0.06);
    border: 1.5px solid rgba(var(--ar-action), 0.18);
    color: var(--a-action);
    font-size: var(--type-subheading);
    cursor: pointer;
    transition: background var(--duration-fast);
}
.cfg-profile__icon:hover { background: rgba(var(--ar-action), 0.15); }

.cfg-profile__info { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.cfg-profile__name { font-size: var(--type-body); font-weight: var(--font-bold); color: var(--color-text-primary); }
.cfg-profile__meta { font-size: var(--type-card-footer); color: var(--color-text-tertiary); }

.cfg-profile__arrow {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    transition: transform var(--duration-fast);
    flex-shrink: 0;
}
.cfg-profile__arrow--open { transform: rotate(180deg); }

.cfg-profile__body {
    border-top: 1px solid var(--color-border-default);
    padding: var(--gap-xs);
}
.cfg-profile__foot {
    display: flex;
    gap: var(--gap-xs);
    padding-top: var(--gap-xs);
    border-top: 1px solid var(--color-border-default);
    margin-top: var(--gap-xs);
}

/* ── Config item row ── */
.cfg-item {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
    width: 100%;
    padding: 0 var(--gap-sm);
    min-height: var(--touch-target-min);
    border-radius: var(--radius-sm);
    border: none;
    background: none;
    font-family: inherit;
    font-size: var(--type-body);
    text-align: left;
    cursor: pointer;
    transition: background var(--duration-fast);
}
.cfg-item:hover { background: var(--color-surface-3); }
.cfg-item:focus-visible { outline: 2px solid var(--color-border-focus); outline-offset: -2px; }
.cfg-item--active { background: color-mix(in srgb, var(--color-primary) 8%, transparent); }

/* Active dot indicator */
.cfg-item__dot {
    width: var(--gap-xs);
    height: var(--gap-xs);
    border-radius: var(--radius-full);
    background: var(--color-border-medium);
    flex-shrink: 0;
}
.cfg-item__dot--active { background: var(--color-primary); }

.cfg-item__name { flex: 1; font-weight: var(--font-semibold); color: var(--color-text-secondary); }
.cfg-item--active .cfg-item__name { color: var(--color-text-primary); font-weight: var(--font-bold); }

.cfg-item__text { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.cfg-item__sub { font-size: var(--type-card-footer); color: var(--color-text-quaternary); }

/* ── Detail ── */
.cfg-detail__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-xs);
    padding-bottom: var(--gap-xs);
    border-bottom: 1px solid var(--color-border-default);
    margin-bottom: var(--gap-xs);
    flex-wrap: wrap;
}
.cfg-detail__title { font-size: var(--type-subheading); font-weight: var(--font-bold); color: var(--color-text-primary); }
.cfg-detail__actions { display: flex; align-items: center; gap: var(--gap-xs); flex-wrap: wrap; }

.cfg-detail__body {
    flex: 1 1 0;
    display: flex;
    flex-direction: column;
    min-height: 0;
}

/* ── Structured view ── */
.cfg-sections {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding-right: var(--gap-xs);
}

.cfg-row {
    border-bottom: 1px solid var(--color-border-default);
    padding: var(--gap-xs) 0;
}
.cfg-row:last-child { border-bottom: none; padding-bottom: 0; }
.cfg-row:first-child { padding-top: 0; }

.cfg-row__head {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
    min-height: var(--touch-target-min);
    white-space: nowrap;
}
.cfg-row__icon {
    color: var(--color-text-tertiary);
    width: var(--gap-md);
    text-align: center;
    flex-shrink: 0;
    font-size: var(--type-body);
}
.cfg-row__title {
    flex: 1;
    font-size: var(--type-body);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
    white-space: nowrap;
}
.cfg-row__status {
    font-size: var(--type-body);
    font-weight: var(--font-bold);
    width: var(--gap-md);
    height: var(--gap-md);
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-full);
    flex-shrink: 0;
}
.cfg-row__status--on { color: var(--color-status-on); background: color-mix(in srgb, var(--color-status-on) 10%, transparent); }
.cfg-row__status--off { color: var(--color-status-off); background: color-mix(in srgb, var(--color-status-off) 10%, transparent); }

.cfg-row__fields {
    display: grid;
    grid-template-columns: minmax(auto, 38.2%) 1fr;
    gap: 0 var(--gap-sm);
    padding-left: calc(var(--gap-md) + var(--gap-xs));
    max-width: 480px;
}
@media (max-width: 640px) {
    .cfg-row__fields {
        grid-template-columns: 1fr;
        gap: var(--gap-xs) 0;
        padding-left: var(--gap-sm);
    }
}
.cfg-row__field {
    display: contents;
}
.cfg-row__label {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    white-space: nowrap;
    padding: var(--gap-xs) 0;
    display: flex;
    align-items: center;
    min-height: var(--gap-lg);
}
.cfg-row__value {
    font-size: var(--type-body);
    color: var(--color-text-primary);
    font-family: var(--font-mono);
    padding: var(--gap-xs) 0;
    display: flex;
    align-items: center;
    min-height: var(--gap-lg);
}
.cfg-on { color: var(--color-status-on); }
.cfg-off { color: var(--color-status-off); }

.cfg-var-ref {
    display: inline-flex;
    align-items: center;
    gap: var(--gap-xs);
    padding: var(--space-0-5) var(--gap-xs);
    border-radius: var(--radius-sm);
    background: rgba(var(--ar-action), 0.08);
    border: 1px solid rgba(var(--ar-action), 0.2);
    color: var(--a-action);
    font-family: var(--font-mono);
    font-weight: var(--font-bold);
    font-size: var(--type-body);
}

/* ── JSON view — MUST fill all available height ── */
.cfg-json {
    flex: 1 1 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-default);
    background: var(--color-surface-0);
    padding: var(--gap-sm);
}

/* ── Inline edit controls ── */
.cfg-row__input {
    max-width: 220px;
    min-width: 0;
    padding: var(--gap-xs) 0;
}
.cfg-row__check {
    display: flex;
    align-items: center;
    padding: var(--gap-xs) 0;
    min-height: var(--gap-lg);
}

/* ── Filter chips ── */
.cfg-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--gap-xs);
    padding: var(--gap-xs) var(--gap-sm);
    border-radius: var(--radius-full);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-medium);
    color: var(--color-text-primary);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    white-space: nowrap;
    cursor: pointer;
    flex-shrink: 0;
    transition: background var(--duration-fast);
}
.cfg-chip:hover { border-color: var(--color-text-tertiary); }
.cfg-chip__x { color: var(--color-text-disabled); }
.cfg-chip--clear { background: color-mix(in srgb, var(--color-danger-text) 8%, transparent); border-color: transparent; color: var(--color-danger-text); }
.cfg-chip--clear:hover { background: color-mix(in srgb, var(--color-danger-text) 15%, transparent); }

.cfg-filter-badge {
    position: absolute;
    top: var(--space-0-5); right: var(--space-0-5);
    width: var(--gap-sm);
    height: var(--gap-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-primary);
    color: var(--color-text-primary);
    font-size: var(--icon-size-2xs); /* icon-only */
    font-weight: var(--font-bold);
    border-radius: var(--radius-full);
    line-height: 1;
}

/* ─�� Modals ── */
.cfg-footer { display: flex; justify-content: flex-end; gap: var(--gap-sm); }
.cfg-form { display: flex; flex-direction: column; gap: var(--gap-xs); }
.cfg-form__field { padding: var(--gap-xs) 0; }
</style>
