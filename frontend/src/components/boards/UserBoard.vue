<template>
<div class="w-full max-w-7xl mx-auto">
    <BasicBlock>
        <div class="user-card w-full max-w-sm border rounded-lg shadow">
            <div class="flex justify-end px-4 pt-4">
            </div>
            <div class="flex flex-col items-center pb-10">
                <img class="w-24 h-24 mb-3 rounded-full shadow-lg" :src="userImg" @error="imageLoadError" :alt="props.user.name + ' avatar'" />
                <h5 class="mb-1 text-xl font-medium text-[var(--color-text-primary)]">{{ props.user.name }}</h5>
                <span class="text-md text-[var(--color-text-tertiary)]">{{ props.user.group }}</span>
                <span class="text-md" :class="[props.user.enabled ? 'text-[var(--color-success-text)]' : 'text-[var(--color-danger-text)]']">{{
                    props.user.enabled ?
                        'Enabled' : 'Disabled' }}</span>
            </div>
        </div>
    </BasicBlock>

    <BasicBlock title="General information" title-padding>
        <TabSelector :tabs="['Permissions', 'Groups', 'Devices', 'FleetManager']">
            <!-- Permissions Tab -->
            <template #Permissions>
                <div v-if="summarizedPermissions.permissions.length > 0">
                    <div class="max-w-7xl mx-auto">
                        <div class="user-table shadow overflow-hidden">
                            <table class="min-w-full divide-y divide-[var(--table-border)] border border-[var(--table-border)]">
                                <thead class="user-table__head">
                                    <tr>
                                        <th class="px-3 py-3 text-left text-xs font-medium text-[var(--table-header-text)] uppercase tracking-wider">Scope</th>
                                        <th class="px-3 py-3 text-left text-xs font-medium text-[var(--table-header-text)] uppercase tracking-wider">Permission</th>
                                    </tr>
                                </thead>
                                <tbody class="user-table__body divide-y divide-[var(--table-border)]">
                                    <tr v-for="permission in summarizedPermissions.permissions" :key="permission.key + permission.value">
                                        <td class="px-3 py-4 whitespace-nowrap">
                                            <div class="text-sm font-medium text-[var(--color-text-secondary)]">{{ permission.key }}</div>
                                        </td>
                                        <td class="px-3 py-4 whitespace-nowrap">
                                            <div class="text-sm font-medium text-[var(--color-text-secondary)]">
                                                {{ permission.value==='*'? 'All permissions': permission.value }}
                                            </div>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
                <div v-else>
                    <p class="text-center text-[var(--color-text-disabled)]">No permissions found</p>
                </div>
            </template>

            <!-- Groups Tab -->
            <template #Groups>
                <div v-if="summarizedPermissions.groups.length > 0">
                    <div class="max-w-7xl mx-auto">
                        <div class="user-table shadow overflow-hidden">
                            <table class="min-w-full divide-y divide-[var(--table-border)] border border-[var(--table-border)]">
                                <thead class="user-table__head">
                                    <tr>
                                        <th class="px-3 py-3 text-left text-xs font-medium text-[var(--table-header-text)] uppercase tracking-wider">Scope</th>
                                        <th class="px-3 py-3 text-left text-xs font-medium text-[var(--table-header-text)] uppercase tracking-wider">Group</th>
                                    </tr>
                                </thead>
                                <tbody class="user-table__body divide-y divide-[var(--table-border)]">
                                    <tr v-for="group in summarizedPermissions.groups" :key="group.key + group.value">
                                        <td class="px-3 py-4 whitespace-nowrap">
                                            <div class="text-sm font-medium text-[var(--color-text-secondary)]">{{ group.key }}</div>
                                        </td>
                                        <td class="px-3 py-4 whitespace-nowrap">
                                            <div class="text-sm font-medium text-[var(--color-text-secondary)]">
                                                {{ group.value ==='*'? 'All permissions': group.value }}
                                            </div>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
                <div v-else>
                    <p class="text-center text-[var(--color-text-disabled)]">No groups found</p>
                </div>
            </template>

            <!-- Devices Tab -->
            <template #Devices>
                <div v-if="summarizedPermissions.devices.length > 0">
                    <div class="max-w-7xl mx-auto">
                        <div class="user-table shadow overflow-hidden">
                            <table class="min-w-full divide-y divide-[var(--table-border)] border border-[var(--table-border)]">
                                <thead class="user-table__head">
                                    <tr>
                                        <th class="px-3 py-3 text-left text-xs font-medium text-[var(--table-header-text)] uppercase tracking-wider">Scope</th>
                                        <th class="px-3 py-3 text-left text-xs font-medium text-[var(--table-header-text)] uppercase tracking-wider">Device</th>
                                    </tr>
                                </thead>
                                <tbody class="user-table__body divide-y divide-[var(--table-border)]">
                                    <tr v-for="device in summarizedPermissions.devices" :key="device.key + device.value">
                                        <td class="px-3 py-4 whitespace-nowrap">
                                            <div class="text-sm font-medium text-[var(--color-text-secondary)]">{{ device.key }}</div>
                                        </td>
                                        <td class="px-3 py-4 whitespace-nowrap">
                                            <div class="text-sm font-medium text-[var(--color-text-secondary)]">
                                                {{ device.value ==='*'? 'All permissions': device.value }}
                                            </div>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
                <div v-else>
                    <p class="text-center text-[var(--color-text-disabled)]">No devices found</p>
                </div>
            </template>
            <template #FleetManager>
                <div v-if="summarizedPermissions.fleetManager.length > 0">
                    <div class="max-w-7xl mx-auto">
                        <div class="user-table shadow overflow-hidden">
                            <table class="min-w-full divide-y divide-[var(--table-border)] border border-[var(--table-border)]">
                                <thead class="user-table__head">
                                    <tr>
                                        <th class="px-3 py-3 text-left text-xs font-medium text-[var(--table-header-text)] uppercase tracking-wider">Scope</th>
                                        <th class="px-3 py-3 text-left text-xs font-medium text-[var(--table-header-text)] uppercase tracking-wider">Permission</th>
                                    </tr>
                                </thead>
                                <tbody class="user-table__body divide-y divide-[var(--table-border)]">
                                    <tr v-for="fm in summarizedPermissions.fleetManager" :key="fm.key + fm.value">
                                        <td class="px-3 py-4 whitespace-nowrap">
                                            <div class="text-sm font-medium text-[var(--color-text-secondary)]">{{ fm.key }}</div>
                                        </td>
                                        <td class="px-3 py-4 whitespace-nowrap">
                                            <div class="text-sm font-medium text-[var(--color-text-secondary)]">
                                                {{ fm.value ==='*'? 'All permissions': fm.value }}
                                            </div>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
                <div v-else>
                    <p class="text-center text-[var(--color-text-disabled)]">No permissions found</p>
                </div>
            </template>
        </TabSelector>
    </BasicBlock>
</div>
</template>


<script setup lang="ts">
import {computed, ref, toRef} from 'vue';
import {FLEET_MANAGER_HTTP} from '@/constants';
import {possiblePermissionsForUser} from '@/helpers/sharedInfo';
import {useAuthStore} from '@/stores/auth';
import BasicBlock from '../core/BasicBlock.vue';
import TabSelector from '../core/TabSelector.vue';

const authStore = useAuthStore();

const props = defineProps<{
    user: any;
}>();

const user = toRef(props, 'user');

const emit = defineEmits<{
    close: [];
}>();

const userImg = ref<string>(
    `${FLEET_MANAGER_HTTP}/uploads/profilePics/${props.user.username}.png`
);

function imageLoadError() {
    userImg.value = FLEET_MANAGER_HTTP + '/uploads/profilePics/default.png';
}

function parsePermissions(permissions: Array<string>) {
    const result = {
        permissions: [] as {key: string; value: string}[],
        devices: [] as {key: string; value: string}[],
        groups: [] as {key: string; value: string}[],
        fleetManager: [] as {key: string; value: string}[]
    };

    permissions.forEach((permission) => {
        const [key, ...rest] = permission.split('.');
        const value = rest.join('.');
        if (key === 'Device') {
            result.devices.push({key, value});
        } else if (key === 'Group' || key === 'Groups') {
            result.groups.push({key, value});
        } else if (key === 'FleetManager') {
            result.fleetManager.push({key, value});
        } else {
            result.permissions.push({key, value});
        }
    });

    return result;
}

const summarizedPermissions = computed(() => {
    const parsed = parsePermissions(props.user.permissions);

    // Summarize categories that have dedicated keys
    if (
        possiblePermissionsForUser.Device &&
        parsed.devices.length &&
        parsed.devices.length === possiblePermissionsForUser.Device.length
    ) {
        parsed.devices = [{key: 'Device', value: '*'}];
    }
    if (
        possiblePermissionsForUser.Group &&
        parsed.groups.length &&
        parsed.groups.length === possiblePermissionsForUser.Group.length
    ) {
        parsed.groups = [{key: 'Group', value: '*'}];
    }
    if (
        possiblePermissionsForUser.FleetManager &&
        parsed.fleetManager.length &&
        parsed.fleetManager.length ===
            possiblePermissionsForUser.FleetManager.length
    ) {
        parsed.fleetManager = [{key: 'FleetManager', value: '*'}];
    }

    // Process other permission categories from parsed.permissions by grouping them by key
    const grouped: Record<string, {key: string; value: string}[]> = {};
    parsed.permissions.forEach((item) => {
        if (!grouped[item.key]) grouped[item.key] = [];
        grouped[item.key].push(item);
    });
    const summarizedOther: {key: string; value: string}[] = [];
    for (const group in grouped) {
        if (
            possiblePermissionsForUser[group] &&
            grouped[group].length === possiblePermissionsForUser[group].length
        ) {
            summarizedOther.push({key: group, value: '*'});
        } else {
            summarizedOther.push(...grouped[group]);
        }
    }
    parsed.permissions = summarizedOther;

    return parsed;
});

const categorizedPermissions = computed(() =>
    parsePermissions(props.user.permissions)
);
const isPermissionEmpty = computed(() => {
    const {permissions, devices, groups} = categorizedPermissions.value;
    return (
        permissions.length === 0 && devices.length === 0 && groups.length === 0
    );
});
</script>


<style scoped>
.user-card {
    background-color: var(--color-surface-2);
    border-color: var(--color-border-default);
}
.user-table {
    background-color: var(--color-surface-2);
}
.user-table__head {
    background-color: var(--color-surface-2);
}
.user-table__body {
    background-color: var(--color-surface-2);
}
</style>
