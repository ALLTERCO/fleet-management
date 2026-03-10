import {computed, type Ref, ref, type WatchStopHandle, watch} from 'vue';
import {useAuthStore} from '@/stores/auth';
import {useDevicesStore} from '@/stores/devices';
import {useGroupsStore} from '@/stores/groups';

/**
 * Shared composable for device selection logic.
 * Used by both backups and firmware stores.
 *
 * @param filterFn Optional extra filter applied to executable devices
 */
export function useDeviceSelection(filterFn?: (device: any) => boolean) {
    const authStore = useAuthStore();
    const devicesStore = useDevicesStore();
    const groupsStore = useGroupsStore();

    const selectedDevices = ref(new Set<string>());
    const executableDevices = ref<any[]>([]);

    let _refCount = 0;
    let _stopWatch: WatchStopHandle | null = null;

    function activate() {
        _refCount++;
        if (_refCount === 1) {
            _stopWatch = watch(
                () => devicesStore.devicesVersion,
                () => {
                    executableDevices.value = Object.values(
                        devicesStore.devices
                    ).filter(
                        (device) =>
                            device.online &&
                            authStore.canExecuteDevice(device.shellyID) &&
                            (filterFn ? filterFn(device) : true)
                    );
                },
                {immediate: true}
            );
        }
    }

    function deactivate() {
        _refCount = Math.max(0, _refCount - 1);
        if (_refCount === 0 && _stopWatch) {
            _stopWatch();
            _stopWatch = null;
            executableDevices.value = [];
        }
    }

    function toggleDevice(shellyID: string) {
        if (selectedDevices.value.has(shellyID)) {
            selectedDevices.value.delete(shellyID);
        } else if (authStore.canExecuteDevice(shellyID)) {
            selectedDevices.value.add(shellyID);
        }
    }

    function selectDevice(shellyID: string) {
        if (authStore.canExecuteDevice(shellyID)) {
            selectedDevices.value.add(shellyID);
        }
    }

    function deselectDevice(shellyID: string) {
        selectedDevices.value.delete(shellyID);
    }

    function selectGroup(groupId: number) {
        const group = groupsStore.groups[groupId];
        if (!group) return;
        for (const shellyID of group.devices) {
            if (authStore.canExecuteDevice(shellyID)) {
                selectedDevices.value.add(shellyID);
            }
        }
    }

    function selectAll() {
        for (const device of executableDevices.value) {
            selectedDevices.value.add(device.shellyID);
        }
    }

    function clearSelection() {
        selectedDevices.value.clear();
    }

    const selectedCount = computed(() => selectedDevices.value.size);
    const hasSelectedDevices = computed(() => selectedDevices.value.size > 0);

    return {
        selectedDevices,
        executableDevices,
        selectedCount,
        hasSelectedDevices,
        activate,
        deactivate,
        toggleDevice,
        selectDevice,
        deselectDevice,
        selectGroup,
        selectAll,
        clearSelection
    };
}
