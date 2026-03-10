import {defineStore} from 'pinia';
import {ref} from 'vue';
import * as ws from '../tools/websocket';
import {useDevicesStore} from './devices';

type Group = {
    id: number;
    name: string;
    devices: string[];
    metadata?: Record<string, any>;
    parentId?: number | null;
};

export const useGroupsStore = defineStore('groups', () => {
    const groups = ref<Record<number, Group>>({});
    const loading = ref(true);
    const devicesStore = useDevicesStore();

    function mapGroupEntry(groupEntry: any): Group {
        const mappedDevices = (groupEntry.devices ?? []).map(
            (deviceIdStr: string) => {
                const deviceNumId = Number(deviceIdStr);
                if (!isNaN(deviceNumId)) {
                    const shellyID =
                        devicesStore.idToShellyMap.get(deviceNumId);
                    if (shellyID) return shellyID;
                }
                return deviceIdStr;
            }
        );

        const parentIdRaw = groupEntry.parentId;
        const parentId =
            parentIdRaw === null || typeof parentIdRaw === 'undefined'
                ? null
                : Number.isFinite(Number(parentIdRaw))
                  ? Number(parentIdRaw)
                  : null;

        return {
            id: groupEntry.id,
            name: groupEntry.name,
            devices: mappedDevices,
            metadata: groupEntry.metadata ?? {},
            parentId
        };
    }

    function mergeRaw(raw: Record<string, any>) {
        const next = {...groups.value};
        for (const key in raw) {
            const gid = Number(key);
            next[gid] = mapGroupEntry(raw[key]);
        }
        groups.value = next;
    }

    // ✅ root groups only (so subgroups never show on global list)
    async function fetchGroups() {
        try {
            const raw: Record<string, any> = await ws.sendRPC(
                'FLEET_MANAGER',
                'group.list',
                {parentId: null}
            );
            // Remove old root groups, then merge fresh data
            const next = {...groups.value};
            for (const gid in next) {
                if (
                    next[gid].parentId === null ||
                    typeof next[gid].parentId === 'undefined'
                ) {
                    delete next[gid];
                }
            }
            groups.value = next;
            mergeRaw(raw);
        } finally {
            loading.value = false;
        }
    }

    async function fetchChildren(parentId: number) {
        const raw: Record<string, any> = await ws.sendRPC(
            'FLEET_MANAGER',
            'group.list',
            {parentId}
        );
        // Remove old children of this parent, then merge fresh data
        const next = {...groups.value};
        for (const gid in next) {
            if (next[gid].parentId === parentId) {
                delete next[gid];
            }
        }
        groups.value = next;
        mergeRaw(raw);
    }

    async function fetchGroup(id: number) {
        const g = await ws.sendRPC<any>('FLEET_MANAGER', 'group.get', {id});
        if (g && typeof g === 'object') {
            mergeRaw({[String(g.id)]: g});
        }
    }

    // fetchGroups() is called from websocket.ts onConnect in parallel with devices

    return {
        groups,
        loading,
        fetchGroups,
        fetchChildren,
        fetchGroup
    };
});
