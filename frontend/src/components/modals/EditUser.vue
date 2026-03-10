<template>
    <Modal :visible="visible" @close="emit('close')">

        <template #title>{{ props.type === 'add' ? 'Add ' : 'Manage ' }} user</template>

        <template #default>
            <div class="flex flex-row flex-nowrap">
                <figure class="w-16 h-16 rounded-full overflow-hidden">
                    <img class="w-full h-full object-cover" @error="imageLoadError" :src="userImg" alt="User profile picture" />
                </figure>
                <div class="flex flex-col justify-center ml-3">User: {{ localUser.fullName || "<unnamed>" }} ( {{
                    localUser.name }} )</div>
            </div>
        </template>
        <template #footer>
            <TabSelector :tabs="['General', 'Permissions', 'Device Groups', 'Devices']">
                <template #General>
                    <form class="flex flex-col flex-nowrap gap-2 pt-2 pb-2 h-[500px] overflow-y-scroll" @submit.prevent="saveGeneralSettings">
                        <BasicBlock title="User related" bordered padding="md" title-padding>
                            <Input id="username" v-model="localUser.name" :disabled="props.type !== 'add'" required
                                label="Username" placeholder="Please, choose username..." :error="errors.name"
                                @focus="validateField('name')" />
                            <Input id="fullName" v-model="localUser.fullName" label="Full Name" required
                                placeholder="Please, choose a name..." :error="errors.fullName"
                                @focus="validateField('fullName')" />
                            <Input id="email" v-model="localUser.email" label="Email" type="email" required
                                placeholder="Please, enter email..." :error="errors.email"
                                @focus="validateField('email')" />
                            <Input v-model="localUser.password" type="password" label="Password" :required="props.type === 'add'"
                                placeholder="Please, enter password..." :error="errors.password"
                                @focus="validateField('password')" />
                            <hr class="mb-4 mt-5 eu-divider h-[1px]" />
                            <div class="flex gap-5">
                                <div class="flex flex-col gap-2">
                                    <label for="" class="block text-sm font-semibold eu-label pt-2 pb-2">User
                                        active</label>
                                    <Checkbox v-model="localUser.enabled">Enabled</Checkbox>
                                </div>

                                <Dropdown label="Role" :options="['user', 'admin']" :default="localUser.group"
                                    @selected="(option) => localUser.group = option" />
                            </div>
                            <div class="pb-2 pt-2">
                                <Button narrow type="blue" @click="saveGeneralSettings">
                                    <i class="fas fa-save" /> Save
                                </Button>
                            </div>
                        </BasicBlock>
                    </form>
                </template>
                <template #Permissions>
                    <div class="flex flex-col gap-2 h-[500px] overflow-y-scroll ">

                        <div class="container">
                            <div class="groups-container">
                                <div v-for="[group, options] in Object.entries(items)" :key="group" class="group">
                                    <h3>{{ group }}</h3>
                                    <label>
                                        <input
                                            class="w-4 h-4 eu-checkbox rounded"
                                            type="checkbox" :checked="isAllSelected(group)"
                                            @change="toggleAll(group)" />
                                        Select All (*)
                                    </label>
                                    <div class="options px-5">
                                        <label v-for="option in options.filter(o => o !== '*')" :key="option">
                                            <div class="flex flex-column gap-3 justify-left align-center">
                                                <input
                                                    class="w-4 h-4 eu-checkbox rounded"
                                                    type="checkbox" :checked="isOptionSelected(group, option)"
                                                    @change="toggleOption(group, option)" />
                                                <span>{{ option }}</span>
                                            </div>
                                        </label>
                                    </div>
                                </div>
                            </div>

                        </div>
                        <div class="flex justify-end mt-5 ">
                            <Button type="blue" :loading="isLoading" @click="applyPermissions()">
                                <i class="fas fa-save" /> Apply permissions
                            </Button>
                        </div>

                    </div>
                </template>
                <template #DeviceGroups>
                    <BasicBlock darker>
                        <Input v-model="groupNameFilter" class="max-w-sm mt-2 py-5" placeholder="Search" />
                        <div class="max-h-[30rem] overflow-y-scroll grid grid-cols-1 md:grid-cols-2 gap-2">
                            <template v-for="group in groupStore.groups" :key="group.id">
                                <template v-if="filterGroup(group.name)">
                                    <GroupWidget vertical :members="group.devices" :name="group.name"
                                        :selected="isGroupSelected(group.id)" @select="toggleGroupId(group.id)" />
                                </template>
                            </template>
                        </div>
                        <div class="flex justify-end mt-5">
                            <Button size="md" type="blue" :loading="isLoading" @click="applyPermissions()">
                                <i class="fas fa-save" /> Apply Group permissions
                            </Button>
                        </div>
                    </BasicBlock>

                </template>
                <template #Devices>
                    <BasicBlock darker>
                        <Input v-model="deviceNameFilter" class="max-w-sm mt-2 py-5" placeholder="Search" />
                        <div class="grid grid-cols-2 gap-3 max-h-[450px] overflow-auto">
                            <div v-for="device in filteredDevices" :key="device.shellyID">
                                <div class="p-3 flex flex-row gap-2 items-center rounded-lg eu-device-card hover:cursor-pointer"
                                    :class="[isDeviceSelected(device.shellyID) && 'eu-device-selected']"
                                    @click="toggleDeviceId(device.shellyID)">
                                    <input type="checkbox" class="" :checked="isDeviceSelected(device.shellyID)" />
                                    <img :src="device.picture_url" class="w-8 h-8 eu-device-img rounded-full" :alt="device.name || 'Device'" />
                                    <span class="text-sm line-clamp-2">
                                        {{ device.name }}
                                    </span>
                                </div>
                            </div>
                        </div>

                    </BasicBlock>
                    <div class="flex justify-end mt-5">
                        <Button narrow type="blue" :loading="isLoading" @click="applyPermissions()">
                            <i class="fas fa-save" /> Apply devices' permissions
                        </Button>
                    </div>

                </template>
            </TabSelector>
        </template>

    </Modal>
</template>

<script setup lang="ts">
import {
    computed,
    onMounted,
    reactive,
    ref,
    shallowRef,
    toRefs,
    watch
} from 'vue';
import {FLEET_MANAGER_HTTP} from '@/constants';
import {getDeviceName, getLogo} from '@/helpers/device';
import {possiblePermissionsForUser} from '@/helpers/sharedInfo';
import {useAuthStore} from '@/stores/auth';
import {useDevicesStore} from '@/stores/devices';
import {useGroupsStore} from '@/stores/groups';
import {useToastStore} from '@/stores/toast';
import {sendRPC} from '@/tools/websocket';
import BasicBlock from '../core/BasicBlock.vue';
import Button from '../core/Button.vue';
import Checkbox from '../core/Checkbox.vue';
import Dropdown from '../core/Dropdown.vue';
import Input from '../core/Input.vue';
import TabSelector from '../core/TabSelector.vue';
import GroupWidget from '../widgets/GroupWidget.vue';
import Modal from './Modal.vue';

const authStore = useAuthStore();

const props = withDefaults(
    defineProps<{
        type?: 'add' | 'edit';
        id?: number;
        visible?: boolean;
        name?: string;
        permissions?: string[];
        password?: string;
        fullName?: string;
        group?: string;
        enabled?: boolean;
        email?: string;
    }>(),
    {
        type: 'edit',
        id: -1,
        visible: false,
        fullName: '',
        permissions: () => [],
        password: '',
        name: '',
        group: '',
        enabled: true,
        email: ''
    }
);

const emit = defineEmits(['close']);

const userImg = ref<string>(
    `${FLEET_MANAGER_HTTP}/uploads/profilePics/${authStore.username}.png`
);

function imageLoadError() {
    userImg.value = FLEET_MANAGER_HTTP + '/uploads/profilePics/default.png';
}

// Local reactive state
const localUser = ref({
    permissions: props.permissions,
    password: props.password,
    name: props.name,
    email: props.email,
    fullName: props.fullName,
    group: props.group,
    enabled: props.enabled
});

const isLoading = ref(false);

// Group stuff
const groupNameFilter = ref('');
const groupStore = useGroupsStore();

const deviceNameFilter = ref('');
const devices = shallowRef<
    Array<{
        shellyID: string;
        name: string;
        picture_url: string;
    }>
>([]);
const devicesStore = useDevicesStore();

// Reactive object to track selected items (permissions, devices, groups)
const selected = reactive<Record<string, Set<string>>>({});
const groupIds = reactive(new Set<string>());
const deviceIds = reactive(new Set<string>());

// New reactive object for validation errors
const errors = reactive({
    name: '',
    fullName: '',
    email: '',
    password: ''
});

onMounted(() => {
    devices.value = Object.values(devicesStore.devices).map((dev) => {
        return {
            shellyID: dev.shellyID,
            name: getDeviceName(dev.info, dev.shellyID),
            picture_url: getLogo(dev)
        };
    });
});

// Watch props to sync when `visible` changes
watch(
    () => props.visible,
    (newVal) => {
        if (newVal) {
            localUser.value = {
                permissions: props.permissions,
                password: props.password,
                name: props.name,
                group: props.group,
                enabled: props.enabled,
                email: props.email,
                fullName: props.fullName
            };
        }
        loadPermissions(localUser.value.permissions as string[]);
    }
);

// Validate a single field on blur
function validateField(field: keyof typeof errors) {
    switch (field) {
        case 'name':
            errors.name = (!localUser.value.name || localUser.value.name.trim() === '')
                ? 'Username is required' : '';
            break;
        case 'fullName':
            errors.fullName = (!localUser.value.fullName || localUser.value.fullName.trim() === '')
                ? 'Full Name is required' : '';
            break;
        case 'email':
            if (!localUser.value.email || localUser.value.email.trim() === '') {
                errors.email = 'Email is required';
            } else {
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                errors.email = !emailRegex.test(localUser.value.email) ? 'Please enter a valid email' : '';
            }
            break;
        case 'password':
            if (props.type === 'add' && (!localUser.value.password || localUser.value.password.trim() === '')) {
                errors.password = 'Password is required';
            } else {
                errors.password = '';
            }
            break;
    }
}

// Save general settings
async function saveGeneralSettings() {
    const toastStore = useToastStore();

    // Clear previous errors
    errors.name = '';
    errors.fullName = '';
    errors.email = '';
    errors.password = '';

    // Validate required fields
    let hasError = false;
    if (!localUser.value.name || localUser.value.name.trim() === '') {
        errors.name = 'Username is required';
        hasError = true;
    }
    if (!localUser.value.fullName || localUser.value.fullName.trim() === '') {
        errors.fullName = 'Full Name is required';
        hasError = true;
    }
    if (!localUser.value.email || localUser.value.email.trim() === '') {
        errors.email = 'Email is required';
        hasError = true;
    } else {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(localUser.value.email)) {
            errors.email = 'Please enter a valid email';
            hasError = true;
        }
    }
    if (
        props.type === 'add' &&
        (!localUser.value.password || localUser.value.password.trim() === '')
    ) {
        errors.password = 'Password is required';
        hasError = true;
    }
    if (hasError) {
        return; // Stop processing if there are validation errors
    }

    isLoading.value = true;
    try {
        let user: Record<PropertyKey, unknown> = {
            name: localUser.value.name,
            fullName: localUser.value.fullName,
            group: localUser.value.group || 'user',
            email: localUser.value.email,
            permissions: flatSelected.value
        };
        if (localUser.value.password) {
            user.password = localUser.value.password;
        }
        if (props.type !== 'add') {
            user.enabled =
                String(localUser.value.enabled) === 'true' ? true : false;
            user.id = props.id;
            await sendRPC('FLEET_MANAGER', 'User.Update', user);
        } else {
            await sendRPC('FLEET_MANAGER', 'User.Create', user);
        }
        isLoading.value = false;
        toastStore.success('User updated successfully.');
    } catch (error) {
        toastStore.error('Failed to update user.');
        isLoading.value = false;
    }
    emit('close');
}

async function applyPermissions() {
    const toastStore = useToastStore();
    isLoading.value = true;
    try {
        const user = {
            id: props.id,
            permissions: flatSelected.value
        };
        await sendRPC('FLEET_MANAGER', 'User.Update', user);
        toastStore.success('Permissions updated.');
        isLoading.value = false;
    } catch (error) {
        toastStore.error('Cannot update permissions');
        isLoading.value = false;
    }
}
// Permissions shananigans

// Define items with groups and their options
const items: Record<string, string[]> = possiblePermissionsForUser;

// Computed property to return a flat array of selected permissions
const flatSelected = computed(() => {
    const result: string[] = [];
    for (const [group, options] of Object.entries(selected)) {
        if (options.has('*')) {
            result.push(`${group}.*`);
        } else {
            result.push(
                ...Array.from(options).map((option) => `${group}.${option}`)
            );
        }
    }
    for (const group of groupIds) {
        result.push('Group.get.' + group);
    }
    for (const device of deviceIds) {
        result.push('Device.get.' + device);
    }
    return result;
});

const filteredDevices = computed(() => {
    return devices.value.filter((dev) =>
        dev.name.includes(deviceNameFilter.value)
    );
});

// Check if all options (or `*`) are selected for a group
const isAllSelected = (group: string): boolean => {
    const groupItems = items[group];
    const selectedItems = selected[group] || new Set();
    return groupItems.every((item) => selectedItems.has(item));
};

// Check if a specific option is selected for a group
const isOptionSelected = (group: string, option: string): boolean => {
    return selected[group]?.has(option) || false;
};

// Select/Deselect all options for a group
const toggleAll = (group: string): void => {
    if (!selected[group]) {
        selected[group] = new Set();
    }
    if (isAllSelected(group)) {
        selected[group].clear();
    } else {
        items[group].forEach((item) => selected[group].add(item));
    }
};

const toggleOption = (group: string, option: string): void => {
    if (!selected[group]) {
        selected[group] = new Set();
    }

    if (option === '*') {
        // If toggling `*`, add or clear all options
        if (selected[group].has(option)) {
            selected[group].clear();
        } else {
            items[group].forEach((item) => selected[group].add(item)); // Select all options
        }
    } else {
        // Toggle individual option
        if (selected[group].has(option)) {
            selected[group].delete(option); // Remove the selected option
            selected[group].delete('*'); // Ensure `*` is removed
        } else {
            selected[group].add(option); // Add the selected option
            // Automatically add `*` if all individual options are now selected
            const allOptionsSelected = items[group]
                .filter((item) => item !== '*')
                .every((item) => selected[group].has(item));
            if (allOptionsSelected) {
                selected[group].add('*');
            }
        }
    }
};

const loadPermissions = (permissions: string[] = []): void => {
    groupIds.clear();
    deviceIds.clear();
    Object.keys(items).forEach((group) => {
        selected[group] = new Set();
    });

    permissions.forEach((permission) => {
        const parts = permission.split('.');
        const group = parts[0];
        const option = parts[1];
        const id = parts[2] || null;

        if (group === 'Device' && option.toLowerCase() === 'get' && id) {
            deviceIds.add(id);
        } else if (group === 'Group' && option.toLowerCase() === 'get' && id) {
            groupIds.add(id);
        } else {
            if (!selected[group]) {
                selected[group] = new Set();
            }
            if (option === '*') {
                if (items[group]) {
                    items[group].forEach((item) => selected[group].add(item));
                }
            } else {
                selected[group].add(option);
            }
        }
    });
};

const toggleDeviceId = (id: string): void => {
    if (deviceIds.has(String(id))) {
        deviceIds.delete(String(id));
    } else {
        deviceIds.add(String(id));
    }
};

const isDeviceSelected = (id: string): boolean => {
    return deviceIds.has(String(id));
};

const toggleGroupId = (id: number): void => {
    if (groupIds.has(String(id))) {
        groupIds.delete(String(id));
    } else {
        groupIds.add(String(id));
    }
};

const isGroupSelected = (id: number): boolean => {
    return groupIds.has(String(id));
};

const filterGroup = (groupName: string): boolean => {
    return groupName
        .toLowerCase()
        .includes(groupNameFilter.value.toLowerCase());
};
</script>

<style scoped>
.container {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
}

.groups-container {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;
    overflow-y: auto;
    padding: 1rem;
    height: 100%;
}

.group {
    border: 1px solid var(--color-border-default);
    padding: 1rem;
    border-radius: var(--radius-lg);
}

.options {
    margin-top: 1rem;
}

/* -- Labels & dividers -- */
.eu-label { color: var(--color-text-primary); }
.eu-divider { background-color: var(--color-text-primary); }

/* -- Checkboxes -- */
.eu-checkbox {
    color: var(--color-primary-hover);
    background-color: var(--color-surface-3);
    border-color: var(--color-border-strong);
}
.eu-checkbox:focus {
    --tw-ring-color: var(--color-primary);
    --tw-ring-offset-color: var(--color-surface-2);
}

/* -- Device card -- */
.eu-device-card {
    background-color: var(--color-surface-0);
}
.eu-device-selected {
    border: 1px solid var(--color-border-focus);
    box-shadow: var(--shadow-primary);
}
.eu-device-img {
    background-color: var(--color-surface-2);
}
</style>