import {computed, type Ref} from 'vue';
import {useDevicesStore} from '@/stores/devices';
import {useEntityStore} from '@/stores/entities';
import {useGroupsStore} from '@/stores/groups';

/**
 * Recursive group statistics — device counts, online/offline, power, temperature.
 * Walks the entire subtree from the given group ID.
 */
export function useGroupStats(groupId: Ref<number | null | undefined>) {
    const groupStore = useGroupsStore();
    const devicesStore = useDevicesStore();
    const entityStore = useEntityStore();

    function collectDeviceIds(gid: number): string[] {
        const g = groupStore.groups[gid];
        const ids = [...(g?.devices ?? [])];
        for (const child of Object.values(groupStore.groups)) {
            if (child.parentGroupId === gid)
                ids.push(...collectDeviceIds(child.id));
        }
        return ids;
    }

    // BLE/BTHome devices live as `entity`-typed group members.
    function collectEntityIds(gid: number): string[] {
        const g = groupStore.groups[gid];
        const ids = (g?.members ?? [])
            .filter((m) => m.subjectType === 'entity')
            .map((m) => m.subjectId);
        for (const child of Object.values(groupStore.groups)) {
            if (child.parentGroupId === gid)
                ids.push(...collectEntityIds(child.id));
        }
        return ids;
    }

    function countSubgroupsRecursive(gid: number): number {
        let count = 0;
        for (const child of Object.values(groupStore.groups)) {
            if (child.parentGroupId === gid) {
                count++;
                count += countSubgroupsRecursive(child.id);
            }
        }
        return count;
    }

    const allDeviceIds = computed(() => {
        const id = groupId.value;
        return id != null ? collectDeviceIds(id) : [];
    });

    const allEntityIds = computed(() => {
        const id = groupId.value;
        return id != null ? collectEntityIds(id) : [];
    });

    const totalDeviceCount = computed(() => allDeviceIds.value.length);
    const totalEntityCount = computed(() => allEntityIds.value.length);
    const totalSubgroupCount = computed(() => {
        const id = groupId.value;
        return id != null ? countSubgroupsRecursive(id) : 0;
    });

    const allResolvedDevices = computed(() =>
        allDeviceIds.value
            .map((sid) => devicesStore.devices[sid])
            .filter(Boolean)
    );

    const onlineDeviceCount = computed(
        () =>
            allResolvedDevices.value.filter((d) => d.sleeping || d.online)
                .length
    );
    const offlineDeviceCount = computed(
        () => allResolvedDevices.value.length - onlineDeviceCount.value
    );

    // BLE entity reachability proxies through the parent gateway: if the
    // gateway is offline, FM can't reach the BLU child. Best signal
    // available client-side; entity.list does not carry online state.
    const onlineEntityCount = computed(() => {
        let count = 0;
        for (const eid of allEntityIds.value) {
            const entity = entityStore.entities[eid];
            const gateway = entity
                ? devicesStore.devices[entity.source]
                : undefined;
            if (gateway && (gateway.online || gateway.sleeping)) count++;
        }
        return count;
    });
    const offlineEntityCount = computed(
        () => totalEntityCount.value - onlineEntityCount.value
    );

    // Combined totals — callers asking "how many devices are online?"
    // get the answer for the whole group, including BLE.
    const onlineCount = computed(
        () => onlineDeviceCount.value + onlineEntityCount.value
    );
    const offlineCount = computed(
        () => offlineDeviceCount.value + offlineEntityCount.value
    );

    // Door / window / cover — how many are open vs closed.
    const openClosed = computed(() => {
        let open = 0;
        let closed = 0;
        for (const dev of allResolvedDevices.value) {
            const s = dev.status;
            if (!s) continue;
            for (const key of Object.keys(s)) {
                const v = s[key];
                if (!v || typeof v !== 'object') continue;
                const state = v.state;
                if (state === 'open' || state === 'opening') open++;
                else if (state === 'closed' || state === 'closing') closed++;
            }
        }
        return {open, closed, total: open + closed};
    });

    // Triggered smoke / flood alarms across the group.
    const activeAlarms = computed(() => {
        let count = 0;
        for (const dev of allResolvedDevices.value) {
            const s = dev.status;
            if (!s) continue;
            for (const key of Object.keys(s)) {
                const v = s[key];
                if (!v || typeof v !== 'object') continue;
                if (
                    (key.startsWith('smoke') || key.startsWith('flood')) &&
                    v.alarm === true
                ) {
                    count++;
                }
            }
        }
        return count;
    });

    const motionDetected = computed(() => {
        let count = 0;
        for (const dev of allResolvedDevices.value) {
            const s = dev.status;
            if (!s) continue;
            for (const key of Object.keys(s)) {
                const v = s[key];
                if (!v || typeof v !== 'object') continue;
                if (
                    v.motion === true ||
                    (key.startsWith('presence') && v.value === true)
                ) {
                    count++;
                }
            }
        }
        return count;
    });

    // Devices reporting a low battery (< 20%).
    const batteryLow = computed(() => {
        let count = 0;
        for (const dev of allResolvedDevices.value) {
            const s = dev.status;
            if (!s) continue;
            for (const key of Object.keys(s)) {
                const v = s[key];
                if (!v || typeof v !== 'object') continue;
                const pct =
                    v.battery && typeof v.battery.percent === 'number'
                        ? v.battery.percent
                        : null;
                if (pct != null && pct < 20) count++;
            }
        }
        return count;
    });

    return {
        allDeviceIds,
        allEntityIds,
        totalDeviceCount,
        totalEntityCount,
        totalSubgroupCount,
        onlineCount,
        offlineCount,
        onlineDeviceCount,
        offlineDeviceCount,
        onlineEntityCount,
        offlineEntityCount,
        openClosed,
        activeAlarms,
        motionDetected,
        batteryLow
    };
}

export function formatPower(w: number): string {
    if (Math.abs(w) >= 1000) return `${(w / 1000).toFixed(1)} kW`;
    return `${w.toFixed(0)} W`;
}
