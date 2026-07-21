import {getActivePinia} from 'pinia';
import {useAlertsStore} from '@/stores/alerts';
import {useAuthStore} from '@/stores/auth';
import {useCertificatesStore} from '@/stores/certificates';
import {useChannelsStore} from '@/stores/channels';
import {useLogStore} from '@/stores/console';
import {useCredentialsStore} from '@/stores/credentials';
import {useDestinationsStore} from '@/stores/destinations';
import {useDevicesStore} from '@/stores/devices';
import {useEntityStore} from '@/stores/entities';
import {useGroupsStore} from '@/stores/groups';
import {useJobsStore} from '@/stores/jobs';
import {useLocationsStore} from '@/stores/locations';
import {useNotificationsStore} from '@/stores/notifications';
import {useOrganizationStore} from '@/stores/organization';
import {usePersonasStore} from '@/stores/personas';
import {useTagsStore} from '@/stores/tags';
import {useToastStore} from '@/stores/toast';
import {useUserGroupsStore} from '@/stores/userGroups';
import {useUsersStore} from '@/stores/users';

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
    alertsStore?: ReturnType<typeof useAlertsStore>;
    notificationsStore?: ReturnType<typeof useNotificationsStore>;
};

type OnConnectStores = {
    pinia: ReturnType<typeof getActivePinia>;
    entityStore?: ReturnType<typeof useEntityStore>;
    devicesStore?: ReturnType<typeof useDevicesStore>;
    groupsStore?: ReturnType<typeof useGroupsStore>;
    locationsStore?: ReturnType<typeof useLocationsStore>;
    tagsStore?: ReturnType<typeof useTagsStore>;
};

// Stores the WS dispatcher's org-scoped CRUD liveness branches refetch.
type LivenessStores = {
    pinia: ReturnType<typeof getActivePinia>;
    groupsStore?: ReturnType<typeof useGroupsStore>;
    tagsStore?: ReturnType<typeof useTagsStore>;
    channelsStore?: ReturnType<typeof useChannelsStore>;
    toastStore?: ReturnType<typeof useToastStore>;
    alertsStore?: ReturnType<typeof useAlertsStore>;
    certificatesStore?: ReturnType<typeof useCertificatesStore>;
    credentialsStore?: ReturnType<typeof useCredentialsStore>;
    destinationsStore?: ReturnType<typeof useDestinationsStore>;
    organizationStore?: ReturnType<typeof useOrganizationStore>;
    personasStore?: ReturnType<typeof usePersonasStore>;
    userGroupsStore?: ReturnType<typeof useUserGroupsStore>;
    usersStore?: ReturnType<typeof useUsersStore>;
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
        jobsStore: useJobsStore(pinia),
        alertsStore: useAlertsStore(pinia),
        notificationsStore: useNotificationsStore(pinia)
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

export function getLivenessStores(): LivenessStores {
    const pinia = getActivePinia();
    if (!pinia) {
        return {pinia: undefined};
    }
    return {
        pinia,
        groupsStore: useGroupsStore(pinia),
        tagsStore: useTagsStore(pinia),
        channelsStore: useChannelsStore(pinia),
        toastStore: useToastStore(pinia),
        alertsStore: useAlertsStore(pinia),
        certificatesStore: useCertificatesStore(pinia),
        credentialsStore: useCredentialsStore(pinia),
        destinationsStore: useDestinationsStore(pinia),
        organizationStore: useOrganizationStore(pinia),
        personasStore: usePersonasStore(pinia),
        userGroupsStore: useUserGroupsStore(pinia),
        usersStore: useUsersStore(pinia)
    };
}
