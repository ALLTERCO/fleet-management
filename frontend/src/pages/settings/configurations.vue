<template>
    <h2 class="sr-only">Configurations</h2>
    <div v-if="initialLoading" class="flex flex-col items-center justify-center py-16">
        <Skeleton variant="rect" width="100%" height="3rem" class="mb-4" />
        <Skeleton variant="rect" width="100%" height="12rem" />
    </div>
    <div v-else class="space-y-2">
        <!-- Profiles & Configurations -->
        <div class="config-grid">
            <!-- Profile selection -->
            <div class="config-grid__card">
                <BasicBlock darker title="Profiles">
                    <template #buttons>
                        <div class="flex flex-row justify-end">
                            <Button type="blue" narrow @click="createProfileModal = true">Add profile</Button>
                        </div>
                    </template>
                    <div v-if="Object.keys(allProfiles).length === 0" class="mt-6">
                        <EmptyBlock>
                            <p class="text-lg font-semibold pb-2">No profiles</p>
                            <p class="text-sm">Create a profile to start managing configurations.</p>
                        </EmptyBlock>
                    </div>
                    <ul v-else v-for="(item, key) in allProfiles" :key="key" class="mt-6 space-y-1">
                        <li class="bg-[var(--color-surface-2)] rounded-xl hover:cursor-pointer shadow-md p-3"
                            :class="key === profile ? 'p-0 border-2 border-[var(--color-primary)]' : ''" @click="profileChanged(key)">
                            <div class="flex flex-row flex-wrap justify-between align-center">
                                <div class="flex">
                                    <span class="px-3">{{ key }}</span>
                                </div>
                                <div class="flex gap-3">
                                    <span
                                        class="whitespace-wrap text-center rounded-full bg-[var(--color-primary)] px-2 py-1 text-sm text-white">
                                        {{ Object.keys(item).length }} configs
                                    </span>
                                    <span
                                        class="whitespace-wrap text-center rounded-lg bg-[var(--color-danger)] px-2 py-1 text-sm text-[var(--color-text-secondary)]"
                                        @click.stop="deleteProfile(key)">
                                        <span class="fas fa-trash-alt" />
                                    </span>
                                </div>
                            </div>
                        </li>
                    </ul>
                </BasicBlock>
            </div>

            <!-- Configurations list and edit/delete buttons -->
            <div class="config-grid__card">
                <BasicBlock darker title="Configurations">
                    <template #buttons>
                        <div class="flex flex-row justify-end">
                            <Button type="blue" narrow @click="openNewConfigModal">
                                <span class="fas fa-plus"></span> Add
                            </Button>
                        </div>
                    </template>
                    <div v-if="profile.length !== 0">
                        <ul v-if="Object.keys(configs).length" class="mt-6 space-y-1">
                            <li v-for="(config, key) in configs" :key="key"
                                class="bg-[var(--color-surface-2)] p-2 rounded-xl hover:cursor-pointer shadow-md"
                                :class="key === selectedConfigKey ? 'p-0 border-2 border-[var(--color-primary)]' : ''"
                                @click="selectConfig(key, config)">
                                <div class="flex flex-row flex-wrap justify-between align-center">
                                    <div class="flex">
                                        <span>{{ config.name }}</span>
                                    </div>
                                    <div class="flex gap-3">
                                        <!-- Edit button -->
                                        <Button narrow @click.stop="editConfig(key, config)" type="blue">
                                            <span class="fas fa-pencil-alt"></span>
                                        </Button>
                                        <Button narrow type="red" @click.stop="deleteConfig(key)">
                                            <span class="fas fa-trash-alt"></span>
                                        </Button>
                                    </div>
                                </div>
                            </li>
                        </ul>
                        <div v-else
                            class="flex flex-row justify-center content-center pt-10 border-[var(--color-border-default)] rounded-lg shadow">
                            <h3 class="mt-0.5 text-lg text-white-900">Profile has no configurations</h3>
                        </div>
                    </div>
                    <div v-else
                        class="flex flex-row justify-center content-center pt-10 border-[var(--color-border-default)] rounded-lg shadow">
                        <h3 class="mt-0.5 text-lg text-white-900">Select profile to view its configurations</h3>
                    </div>
                </BasicBlock>
            </div>
            <div class="config-grid__card">
                <BasicBlock darker title="Settings">
                    <template #buttons>
                        <div class="flex justify-end">
                            <Button type="blue" narrow @click="toggleViewMode"
                                v-if="Object.keys(selectedConfig).length !== 0">
                                {{ viewMode === 'json' ? 'Structured' : 'JSON' }} view
                            </Button>
                        </div>
                    </template>
                    <div class="flex flex-col">
                        <div v-if="Object.keys(selectedConfig).length !== 0">
                            <div v-if="viewMode === 'json'">
                                <JSONViewer :data="selectedConfig" />
                            </div>
                            <div v-else class="mt-4 p-4 bg-[var(--color-surface-2)] rounded-lg">
                                <div v-for="section in settings" :key="section.title" class="mb-4">
                                    <h3 class="text-xl font-bold text-white mb-2 border-b border-[var(--color-border-strong)] pb-1">
                                        {{ section.title }}
                                    </h3>
                                    <div class="grid grid-cols-2 gap-4">
                                        <div v-for="option in section.options" :key="option.key" class="flex flex-col">
                                            <span class="text-sm text-[var(--color-text-secondary)]">{{ option.label }}</span>
                                            <span class="text-base text-white">
                                                {{ getNestedValue(selectedConfig, option.key) || '-' }}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div v-else
                            class="flex flex-row justify-center content-center pt-10 border-[var(--color-border-default)] rounded-lg shadow">
                            <h3 class="mt-0.5 text-lg text-white-900">No config selected</h3>
                        </div>
                    </div>
                </BasicBlock>
            </div>
        </div>

        <!-- Modal for creating a profile -->
        <Modal :visible="createProfileModal">
            <template #title>
                <p class="text-2xl font-semibold">Create Profile</p>
            </template>
            <template #default>
                <Input v-model="newProfileName" type="text" placeholder="Enter profile name" />
            </template>
            <template #footer>
                <Button type="blue" class="mr-2" @click="createProfile">Create profile</Button>
                <Button type="red" @click="createProfileModal = false">Cancel</Button>
            </template>
        </Modal>

        <!-- Modal for creating/editing a configuration -->
        <Modal :visible="createConfigurationPerProfile" @close="closeConfigModal">
            <template #title>
                <p class="text-2xl font-semibold">
                    {{ editingConfigKey ? 'Edit Configuration' : 'Create Configuration' }}
                </p>
            </template>
            <template #default>
                <div v-for="section in settings" :key="section.title" class="p-1">
                    <Collapse :title="section.title">
                        <div v-for="option in section.options" :key="option.key" class="pt-2">
                            <!-- Input -->
                            <Input v-if="option.type === 'input'"
                                :modelValue="getNestedValue(newConfig, option.key) || ''"
                                @update:modelValue="(val: any) => updateOptionValue(option.key, val)"
                                :label="option.label" :placeholder="(option as any).placeholder" />
                            <!-- Dropdown -->
                            <Dropdown v-else-if="option.type === 'dropdown'" :options="(option as any).options"
                                :label="option.label" :default="getNestedValue(newConfig, option.key)"
                                @selected="value => updateOptionValue(option.key, value)" />
                            <!-- Checkbox -->
                            <Checkbox v-else-if="option.type === 'checkbox'" :id="option.key"
                                :modelValue="getNestedValue(newConfig, option.key) || false"
                                @update:modelValue="(val: any) => updateOptionValue(option.key, val)">
                                {{ option.label }}
                            </Checkbox>
                        </div>
                    </Collapse>
                </div>
            </template>
            <template #footer>
                <div class="flex flex-row justify-end">
                    <Button v-if="editingConfigKey" type="green" class="mr-2" @click="saveConfiguration">
                        Save Changes
                    </Button>
                    <Button v-else type="green" class="mr-2" @click="addNewConfiguration">
                        Create Configuration
                    </Button>
                    <Button type="red" narrow @click="closeConfigModal">Cancel</Button>
                </div>
            </template>
        </Modal>
        <!-- Confirmation modal -->
        <ConfirmationModal ref='modalRef' footer>
            <template #title>
                <h1>Are you sure you want to proceed with deletion?</h1>
            </template>
            <template #footer>
            </template>
        </ConfirmationModal>
    </div>
</template>

<script setup lang="ts">
import {useLocalStorage} from '@vueuse/core';
import {onMounted, ref} from 'vue';
import BasicBlock from '@/components/core/BasicBlock.vue';
import Button from '@/components/core/Button.vue';
import EmptyBlock from '@/components/core/EmptyBlock.vue';
import Checkbox from '@/components/core/Checkbox.vue';
import Collapse from '@/components/core/Collapse.vue';
import Dropdown from '@/components/core/Dropdown.vue';
import Input from '@/components/core/Input.vue';
import Skeleton from '@/components/core/Skeleton.vue';
import JSONViewer from '@/components/JSONViewer.vue';
import ConfirmationModal from '@/components/modals/ConfirmationModal.vue';
import Modal from '@/components/modals/Modal.vue';
import {FLEET_MANAGER_WEBSOCKET} from '@/constants';
import {useToastStore} from '@/stores/toast';
import * as ws from '@/tools/websocket';

const toast = useToastStore();
const configsRegistry = ws.getRegistry('configs');
const loading = ref(false);
const initialLoading = ref(true);

// Reactive state declarations
const allProfiles = ref<Record<string, object>>({});
const profiles = ref(['Default']);
const profile = ref('Default');
const selectedProfile = ref({});
const selectedConfig = ref<Record<string, unknown>>({});
const selectedConfigKey = ref('');
const createProfileModal = ref(false);
const createConfigurationPerProfile = ref(false);
const newProfileName = ref('');
const editingConfigKey = ref<string | null>(null);
const viewMode = ref('structured'); // 'json' or 'structured'
const modalRef = ref<InstanceType<typeof ConfirmationModal>>();

// Settings definition used for both the edit modal and structured view
const settings = [
    {
        title: 'Name',
        options: [{label: 'Name', key: 'name', placeholder: '', type: 'input'}]
    },
    {
        title: 'Timer',
        options: [
            {
                label: 'Auto On',
                key: 'switch.auto_on_delay',
                type: 'input',
                placeholder:
                    'Seconds to pass until the component is switched back on'
            },
            {label: 'Enable', key: 'switch.auto_on', type: 'checkbox'},
            {
                label: 'Auto Off',
                key: 'switch.auto_off_delay',
                type: 'input',
                placeholder:
                    'Seconds to pass until the component is switched back off'
            },
            {label: 'Enable', key: 'switch.auto_off', type: 'checkbox'}
        ]
    },
    {
        title: 'Power on default',
        options: [
            {
                label: 'Power on option:',
                key: 'switch.initial_state',
                options: ['on', 'off', 'restore_last', 'match_input'],
                type: 'dropdown'
            }
        ]
    },
    {
        title: 'Websocket',
        options: [
            {
                label: 'WS Address',
                key: 'ws.server',
                type: 'input',
                placeholder: 'Enter Fleet Manager address'
            },
            {label: 'Enabled', key: 'ws.enable', type: 'checkbox'}
        ]
    },
    {
        title: 'Wi-Fi',
        options: [
            {
                label: 'Access point password',
                key: 'wifi.ap.pass',
                type: 'input',
                placeholder: 'Provide access point password'
            },
            {type: 'checkbox', label: 'Enable AP', key: 'wifi.ap.enable'},
            {
                type: 'input',
                label: 'Network Name',
                key: 'wifi.sta.ssid',
                placeholder: 'Enter Wi-Fi name'
            },
            {
                type: 'input',
                label: 'Password',
                key: 'wifi.sta.pass',
                placeholder: 'Enter Wi-Fi password'
            },
            {type: 'checkbox', label: 'Enable', key: 'wifi.sta.enable'},
            {
                type: 'input',
                label: 'Network Name 2',
                key: 'wifi.sta1.ssid',
                placeholder: 'Enter second Wi-Fi name'
            },
            {
                type: 'input',
                label: 'Password',
                key: 'wifi.sta1.pass',
                placeholder: 'Enter Wi-Fi password'
            },
            {type: 'checkbox', label: 'Enable', key: 'wifi.sta2.enable'}
        ]
    },
    {
        title: 'MQTT',
        options: [
            {type: 'checkbox', label: 'Enable', key: 'mqtt.enable'},
            {
                type: 'input',
                label: 'Server',
                key: 'mqtt.server',
                placeholder: 'Enter MQTT server'
            },
            {
                type: 'input',
                label: 'Client ID',
                key: 'mqtt.client_id',
                placeholder: 'Enter Client ID'
            },
            {
                type: 'input',
                label: 'User',
                key: 'mqtt.user',
                placeholder: 'Enter User'
            },
            {
                type: 'input',
                label: 'Topic Prefix',
                key: 'mqtt.topic_prefix',
                placeholder: 'Enter Topic Prefix'
            }
        ]
    },
    {
        title: 'Bluetooth',
        options: [{type: 'checkbox', label: 'Enable', key: 'bluetooth.enable'}]
    }
];

// Helper functions for nested values
function getNestedValue(obj: any, path: string) {
    return path.split('.').reduce((acc, key) => acc && acc[key], obj);
}

function setNestedValue(obj: any, path: string, value: any) {
    const keys = path.split('.');
    const lastKey = keys.pop();
    const target = keys.reduce((acc, key) => {
        if (!acc[key]) acc[key] = {};
        return acc[key];
    }, obj);
    if (lastKey !== undefined) {
        target[lastKey] = value;
    }
    return obj;
}

// Configurations and new configuration state

const newConfig = ref({
    name: 'My configuration',
    ws: {
        server: useLocalStorage(
            'propose-ws',
            FLEET_MANAGER_WEBSOCKET + '/shelly'
        ),
        enable: false
    },
    switch: {
        auto_on_delay: '',
        auto_on: false,
        auto_off_delay: '',
        auto_off: false,
        initial_state: ''
    },
    wifi: {
        ap: {
            pass: '',
            enable: false
        },
        sta: {
            enable: false,
            ssid: '',
            pass: ''
        },
        sta1: {
            enable: false,
            ssid: '',
            pass: ''
        }
    },
    mqtt: {
        enable: false,
        server: '',
        user: '',
        client_id: '',
        topic_prefix: ''
    },
    bluetooth: {
        enable: false
    }
});
const configs = ref<Record<string, any>>({});

function toggleViewMode() {
    viewMode.value = viewMode.value === 'json' ? 'structured' : 'json';
}

function updateOptionValue(key: string, value: any): void {
    setNestedValue(newConfig.value, key, value);
}

function openNewConfigModal() {
    editingConfigKey.value = null;
    resetNewConfig();
    createConfigurationPerProfile.value = true;
}

function closeConfigModal() {
    createConfigurationPerProfile.value = false;
    editingConfigKey.value = null;
    resetNewConfig();
}

function editConfig(key: string, config: any) {
    editingConfigKey.value = key;
    // Deep clone to avoid reactive linkage
    newConfig.value = JSON.parse(JSON.stringify(config));
    createConfigurationPerProfile.value = true;
}

async function saveConfiguration() {
    loading.value = true;
    const nestedConfig = nestConfig(newConfig.value);
    const key = editingConfigKey.value || '-1';
    if (key !== '-1') {
        configs.value[key] = {
            ...nestedConfig,
            name: newConfig.value.name || 'My configuration',
            ws: {
                server: newConfig.value.ws?.server || '',
                enable: newConfig.value.ws?.enable || false
            }
        };
    }
    try {
        await configsRegistry.setItem(profile.value, configs.value);
        await refreshConfigs();
        toast.success('Configuration saved successfully!');
    } catch (error) {
        toast.error('Failed to save configuration');
    } finally {
        loading.value = false;
        await closeConfigModal();
        await refreshConfigs();
        selectConfig(key, configs.value[key]);
    }
}

async function addNewConfiguration() {
    loading.value = true;
    const nestedConfig = nestConfig(newConfig.value);
    const key = newConfig.value.name;
    configs.value[key] = {
        ...nestedConfig,
        name: newConfig.value.name || 'My configuration',
        ws: {
            server: newConfig.value.ws?.server || '',
            enable: newConfig.value.ws?.enable || false
        }
    };
    try {
        await configsRegistry.setItem(profile.value, configs.value);
        await refreshConfigs();
        toast.success('Configuration created successfully!');
    } catch (error) {
        console.error('Failed to save new configuration:', error);
        toast.error('Failed to create a new configuration');
    } finally {
        loading.value = false;
        closeConfigModal();
    }
}

async function createProfile() {
    const name = newProfileName.value;
    if (name.length === 0) return;
    try {
        await configsRegistry.setItem(name, {});

        toast.success('Profile created successfully!');
    } catch (error) {
        toast.error('Failed to create a new profile');
    } finally {
        createProfileModal.value = false;
        await getallProfiles();
    }
}

async function profileChanged(val: string) {
    profile.value = val;
    selectedConfig.value = {};
    await refreshConfigs();
}

async function getallProfiles() {
    allProfiles.value = await configsRegistry.getAll();
}

async function refreshConfigs() {
    configs.value = {};
    if (!profile.value) return;
    configs.value = (await configsRegistry.getItem(profile.value)) || {};
}

function resetNewConfig() {
    newConfig.value = {
        name: 'My configuration',
        ws: {
            server: useLocalStorage(
                'propose-ws',
                FLEET_MANAGER_WEBSOCKET + '/shelly'
            ),
            enable: false
        },
        switch: {
            auto_on_delay: '',
            auto_on: false,
            auto_off_delay: '',
            auto_off: false,
            initial_state: ''
        },
        wifi: {
            ap: {
                pass: '',
                enable: false
            },
            sta: {
                enable: false,
                ssid: '',
                pass: ''
            },
            sta1: {
                enable: false,
                ssid: '',
                pass: ''
            }
        },
        mqtt: {
            enable: false,
            server: '',
            user: '',
            client_id: '',
            topic_prefix: ''
        },
        bluetooth: {
            enable: false
        }
    };
}

async function deleteProfile(name: string) {
    if (modalRef.value) {
        modalRef.value.storeAction(async () => {
            try {
                await configsRegistry.removeItem(name);
                await getallProfiles();
                await refreshProfiles();
                await refreshConfigs();
                toast.success(`Deleted profile '${name}'`);
            } catch (error) {
                toast.error(`Failed to delete profile '${name}'`);
            }
        });
    }
}
async function deleteConfig(name: string) {
    if (modalRef.value) {
        modalRef.value.storeAction(async () => {
            try {
                selectedConfig.value = {};
                delete configs.value[name];
                await configsRegistry.setItem(profile.value, configs.value);
                await getallProfiles();
                toast.success(`Deleted config '${name}'`);
            } catch (error) {
                toast.error(`Failed to delete config '${name}'`);
            }
        });
    }
}

function nestConfig(obj: Record<string, any>) {
    const nested: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
        const keys = key.split('.');
        let current = nested;
        while (keys.length > 1) {
            const k = keys.shift()!;
            if (!current[k]) {
                current[k] = {};
            }
            current = current[k];
        }
        current[keys[0]] = value;
    }
    return nested;
}

async function refreshProfiles() {
    profiles.value = await configsRegistry.keys();
    if (profiles.value.length === 0) return;
    if (!profiles.value.includes(profile.value)) {
        profileChanged(profiles.value[0]);
    }
}

async function selectConfig(key: string, config: any) {
    selectedConfig.value = config;
    selectedConfigKey.value = key;
}

onMounted(async () => {
    try {
        await getallProfiles();
        await refreshProfiles();
        await refreshConfigs();
    } catch (error) {
        toast.error('cannot refresh configs');
        console.error('cannot refresh configs', error);
    } finally {
        initialLoading.value = false;
    }
});
</script>

<style scoped>
.config-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: var(--space-5);
    padding-top: var(--space-5);
    align-items: start;
}
.config-grid__card {
    min-height: 240px;
}
</style>