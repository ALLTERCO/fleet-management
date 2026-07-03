import {getActivePinia} from 'pinia';
import {useAuthStore} from '@/stores/auth';
import {useLogStore} from '@/stores/console';
import {useDevicesStore} from '@/stores/devices';
import {useEntityStore} from '@/stores/entities';
import {useGroupsStore} from '@/stores/groups';
import {useJobsStore} from '@/stores/jobs';
import {useLocationsStore} from '@/stores/locations';
import {useTagsStore} from '@/stores/tags';

type ConnectStores = {
    pinia: ReturnType<typeof getActivePinia>;
    devicesStore?: ReturnType<typeof useDevicesStore>;
    entitiesStore?: ReturnType<typeof useEntityStore>;
    logStore?: ReturnType<typeof useLogStore>;
};

type ResyncStores = {
    pinia: ReturnType<typeof getActivePinia>;
    authStore?: ReturnType<typeof useAuthStore>;
    devicesStore?: ReturnType<typeof useDevicesStore>;
    jobsStore?: ReturnType<typeof useJobsStore>;
};

type OnConnectStores = {
    pinia: ReturnType<typeof getActivePinia>;
    entityStore?: ReturnType<typeof useEntityStore>;
    devicesStore?: ReturnType<typeof useDevicesStore>;
    groupsStore?: ReturnType<typeof useGroupsStore>;
    locationsStore?: ReturnType<typeof useLocationsStore>;
    tagsStore?: ReturnType<typeof useTagsStore>;
};

export function getConnectStores(): ConnectStores {
    const pinia = getActivePinia();
    if (!pinia) {
        return {pinia: undefined};
    }
    return {
        pinia,
        devicesStore: useDevicesStore(pinia),
        entitiesStore: useEntityStore(pinia),
        logStore: useLogStore(pinia)
    };
}

export function getResyncStores(): ResyncStores {
    const pinia = getActivePinia();
    if (!pinia) {
        return {pinia: undefined};
    }
    return {
        pinia,
        authStore: useAuthStore(pinia),
        devicesStore: useDevicesStore(pinia),
        jobsStore: useJobsStore(pinia)
    };
}

export function getOnConnectStores(): OnConnectStores {
    const pinia = getActivePinia();
    if (!pinia) {
        return {pinia: undefined};
    }
    return {
        pinia,
        entityStore: useEntityStore(pinia),
        devicesStore: useDevicesStore(pinia),
        groupsStore: useGroupsStore(pinia),
        locationsStore: useLocationsStore(pinia),
        tagsStore: useTagsStore(pinia)
    };
}
